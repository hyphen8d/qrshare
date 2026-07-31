import { base45Decode, base45Encode } from './base45';
import { crc16Hex } from './crc16';

// Wire format, kept deliberately plain-text/alphanumeric so it packs into
// QR "alphanumeric mode" instead of the less dense "byte mode":
//   Manifest frame: Q1:M:<totalChunks>:<crc>:<base45(manifestJson)>
//   Data frame:     Q1:<index>:<totalChunks>:<crc>:<base45(chunkBytes)>
//
// The sender loops through these frames on a timer (a "QR carousel"). The
// receiver just needs to see each frame once, in any order, at any point in
// the loop — missed a frame? it comes back around. No connection, no
// handshake, no network of any kind between the two devices.

const PROTOCOL = 'Q1';

export interface FileManifest {
  name: string;
  mime: string;
  size: number;
}

export interface EncodedFrames {
  frames: string[];
  manifest: FileManifest;
}

const DEFAULT_CHUNK_BYTES = 700; // ~ QR version 14-ish at M error correction

export async function encodeFileToFrames(
  file: File,
  chunkBytes: number = DEFAULT_CHUNK_BYTES
): Promise<EncodedFrames> {
  const raw = new Uint8Array(await file.arrayBuffer());
  const compressed = await gzip(raw);

  const dataChunks: Uint8Array[] = [];
  for (let i = 0; i < compressed.length; i += chunkBytes) {
    dataChunks.push(compressed.subarray(i, i + chunkBytes));
  }
  // Guarantee at least one chunk for zero-byte files.
  if (dataChunks.length === 0) dataChunks.push(new Uint8Array());

  const manifest: FileManifest = { name: file.name, mime: file.type || 'application/octet-stream', size: file.size };
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));

  const frames: string[] = [];
  frames.push(
    `${PROTOCOL}:M:${dataChunks.length}:${crc16Hex(manifestBytes)}:${base45Encode(manifestBytes)}`
  );
  dataChunks.forEach((chunk, idx) => {
    frames.push(`${PROTOCOL}:${idx}:${dataChunks.length}:${crc16Hex(chunk)}:${base45Encode(chunk)}`);
  });

  return { frames, manifest };
}

type ParsedFrame =
  | { kind: 'manifest'; total: number; crc: string; payload: Uint8Array }
  | { kind: 'data'; index: number; total: number; crc: string; payload: Uint8Array };

function parseFrame(raw: string): ParsedFrame | null {
  // NOTE: can't just raw.split(':') — base45's alphabet includes ':' as a
  // valid symbol, so the payload itself may contain colons. Only the first
  // three separators (after the "Q1" prefix) are structural; everything
  // after the third belongs to the payload.
  if (!raw.startsWith(`${PROTOCOL}:`)) return null;
  let rest = raw.slice(PROTOCOL.length + 1);

  const take = (): string | null => {
    const i = rest.indexOf(':');
    if (i === -1) return null;
    const piece = rest.slice(0, i);
    rest = rest.slice(i + 1);
    return piece;
  };

  const idxStr = take();
  const totalStr = take();
  const crc = take();
  const encoded = rest;
  if (idxStr === null || totalStr === null || crc === null || !encoded) return null;

  const total = parseInt(totalStr, 10);
  if (Number.isNaN(total)) return null;

  let payload: Uint8Array;
  try {
    payload = base45Decode(encoded);
  } catch {
    return null;
  }
  if (crc16Hex(payload) !== crc) return null; // corrupted/partial scan, drop it silently

  if (idxStr === 'M') {
    return { kind: 'manifest', total, crc, payload };
  }
  const index = parseInt(idxStr, 10);
  if (Number.isNaN(index)) return null;
  return { kind: 'data', index, total, crc, payload };
}

export class FrameReceiver {
  private chunks = new Map<number, Uint8Array>();
  private total: number | null = null;
  manifest: FileManifest | null = null;

  /** Feed a raw scanned string in. Returns true if this frame was new/useful. */
  ingest(raw: string): boolean {
    const frame = parseFrame(raw);
    if (!frame) return false;

    if (frame.kind === 'manifest') {
      if (!this.manifest) {
        try {
          this.manifest = JSON.parse(new TextDecoder().decode(frame.payload));
        } catch {
          return false;
        }
      }
      if (this.total === null) this.total = frame.total;
      return true;
    }

    if (this.total === null) this.total = frame.total;
    if (this.chunks.has(frame.index)) return false;
    this.chunks.set(frame.index, frame.payload);
    return true;
  }

  get receivedCount(): number {
    return this.chunks.size;
  }

  get totalCount(): number | null {
    return this.total;
  }

  get isComplete(): boolean {
    return this.manifest !== null && this.total !== null && this.chunks.size === this.total;
  }

  missingIndices(): number[] {
    if (this.total === null) return [];
    const missing: number[] = [];
    for (let i = 0; i < this.total; i++) if (!this.chunks.has(i)) missing.push(i);
    return missing;
  }

  async assemble(): Promise<{ blob: Blob; manifest: FileManifest }> {
    if (!this.isComplete || !this.manifest || this.total === null) {
      throw new Error('Transfer is not complete yet');
    }
    const ordered: Uint8Array[] = [];
    for (let i = 0; i < this.total; i++) ordered.push(this.chunks.get(i)!);
    const compressed = concat(ordered);
    const raw = await gunzip(compressed);
    return { blob: new Blob([raw as BlobPart], { type: this.manifest.mime }), manifest: this.manifest };
  }
}

function concat(arrays: Uint8Array[]): Uint8Array {
  const size = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

async function gzip(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
