// Once the DataChannel is open, this is a completely ordinary chunked
// binary transfer — no QR, no base45, no CRC (SCTP/DTLS already guarantees
// order and integrity). The only job here is backpressure: don't call
// channel.send() faster than the channel can drain, or bufferedAmount grows
// without bound on a large file.

export interface TransferManifest {
  name: string;
  mime: string;
  size: number;
}

const CHUNK_SIZE = 16 * 1024;
const BUFFERED_LOW = 1 * 1024 * 1024;
const BUFFERED_HIGH_WATERMARK = 4 * 1024 * 1024;

export async function sendFile(
  channel: RTCDataChannel,
  file: File,
  onProgress: (sent: number, total: number) => void
): Promise<void> {
  channel.bufferedAmountLowThreshold = BUFFERED_LOW;

  const manifest: TransferManifest = {
    name: file.name,
    mime: file.type || 'application/octet-stream',
    size: file.size
  };
  channel.send(JSON.stringify(manifest));
  onProgress(0, file.size);

  if (file.size === 0) return;

  const reader = file.stream().getReader();
  let sent = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      let offset = 0;
      while (offset < value.length) {
        const piece = value.subarray(offset, offset + CHUNK_SIZE);
        await waitForBufferedAmountBelow(channel, BUFFERED_HIGH_WATERMARK);
        if (channel.readyState !== 'open') throw new Error('Connection closed mid-transfer');
        channel.send(piece);
        sent += piece.length;
        offset += piece.length;
        onProgress(sent, file.size);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function waitForBufferedAmountBelow(channel: RTCDataChannel, threshold: number): Promise<void> {
  if (channel.bufferedAmount <= threshold) return Promise.resolve();
  return new Promise((resolve) => {
    const check = () => {
      if (channel.bufferedAmount <= threshold) {
        channel.removeEventListener('bufferedamountlow', check);
        resolve();
      }
    };
    channel.addEventListener('bufferedamountlow', check);
  });
}

export interface ReceivedFile {
  blob: Blob;
  manifest: TransferManifest;
}

export function receiveFile(
  channel: RTCDataChannel,
  onProgress: (received: number, total: number) => void
): Promise<ReceivedFile> {
  return new Promise((resolve, reject) => {
    let manifest: TransferManifest | null = null;
    const parts: BlobPart[] = [];
    let received = 0;
    let settled = false;

    channel.binaryType = 'arraybuffer';

    channel.onmessage = (ev) => {
      if (settled) return;
      if (typeof ev.data === 'string') {
        try {
          manifest = JSON.parse(ev.data) as TransferManifest;
        } catch {
          settled = true;
          reject(new Error('Bad transfer header'));
          return;
        }
        onProgress(0, manifest.size);
        if (manifest.size === 0) {
          settled = true;
          resolve({ blob: new Blob([], { type: manifest.mime }), manifest });
        }
        return;
      }
      if (!manifest) {
        settled = true;
        reject(new Error('Received data before the transfer header'));
        return;
      }
      const chunk = ev.data as ArrayBuffer;
      parts.push(chunk);
      received += chunk.byteLength;
      onProgress(received, manifest.size);
      if (received >= manifest.size) {
        settled = true;
        resolve({ blob: new Blob(parts, { type: manifest.mime }), manifest });
      }
    };

    channel.onerror = () => {
      if (settled) return;
      settled = true;
      reject(new Error('Transfer connection error'));
    };

    channel.onclose = () => {
      if (settled) return;
      settled = true;
      reject(new Error('Connection closed before the transfer finished'));
    };
  });
}
