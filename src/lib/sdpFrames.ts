import { base45Decode, base45Encode } from './base45';
import { crc16Hex } from './crc16';
import { gzip, gunzip } from './compression';

// Same idea as the file chunk protocol (chunker.ts), simplified: there's no
// filename/mime to carry, just one gzip-compressed text blob (an SDP offer
// or answer), so there's no separate manifest frame — every frame is a data
// frame and `total` tells the receiver when it has them all.
//   H1:<index>:<totalChunks>:<crc>:<base45(chunk)>
//
// SDP is small (typically well under a KB once gzipped for a single
// data-channel-only connection), so this is usually 1-2 QR frames —
// seconds to scan, not minutes.

const PROTOCOL = 'H1';
const CHUNK_BYTES = 350; // same "Balanced" density as the file protocol's default

export async function encodeSdpToFrames(sdp: string): Promise<string[]> {
  const raw = new TextEncoder().encode(sdp);
  const compressed = await gzip(raw);

  const chunks: Uint8Array[] = [];
  for (let i = 0; i < compressed.length; i += CHUNK_BYTES) {
    chunks.push(compressed.subarray(i, i + CHUNK_BYTES));
  }
  if (chunks.length === 0) chunks.push(new Uint8Array());

  return chunks.map((chunk, idx) => `${PROTOCOL}:${idx}:${chunks.length}:${crc16Hex(chunk)}:${base45Encode(chunk)}`);
}

interface ParsedSdpFrame {
  index: number;
  total: number;
  payload: Uint8Array;
}

/** Returns null if `raw` isn't a well-formed, checksum-valid H1 frame. */
export function parseSdpFrame(raw: string): ParsedSdpFrame | null {
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

  const index = parseInt(idxStr, 10);
  const total = parseInt(totalStr, 10);
  if (Number.isNaN(index) || Number.isNaN(total)) return null;

  let payload: Uint8Array;
  try {
    payload = base45Decode(encoded);
  } catch {
    return null;
  }
  if (crc16Hex(payload) !== crc) return null;

  return { index, total, payload };
}

/** True if `raw` at least starts with the H1 tag — used by the receiver to route frames without fully parsing them. */
export function isSdpFrame(raw: string): boolean {
  return raw.startsWith(`${PROTOCOL}:`);
}

export class SdpFrameReceiver {
  private chunks = new Map<number, Uint8Array>();
  private total: number | null = null;

  ingest(raw: string): boolean {
    const frame = parseSdpFrame(raw);
    if (!frame) return false;
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
    return this.total !== null && this.chunks.size === this.total;
  }

  async assemble(): Promise<string> {
    if (!this.isComplete || this.total === null) throw new Error('SDP transfer is not complete yet');
    const ordered: Uint8Array[] = [];
    for (let i = 0; i < this.total; i++) ordered.push(this.chunks.get(i)!);
    const size = ordered.reduce((n, a) => n + a.length, 0);
    const compressed = new Uint8Array(size);
    let offset = 0;
    for (const c of ordered) {
      compressed.set(c, offset);
      offset += c.length;
    }
    const raw = await gunzip(compressed);
    return new TextDecoder().decode(raw);
  }
}
