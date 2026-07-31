import 'barcode-detector/side-effects';
// The above registers window.BarcodeDetector if the browser doesn't already
// have a native one, backed by a WASM (zxing) decoder under the hood. Same
// "native first, WASM fallback" idea the original app hand-rolled with a
// custom Emscripten build + Web Worker RPC layer — the modern ponyfill gets
// us that for free with a maintained decoder and the real native API where
// it exists (fast, hardware-accelerated on Chrome/Android today).

export type FrameHandler = (value: string) => void;

export interface ScannerHandle {
  stop: () => void;
}

/**
 * Starts scanning `video` for QR codes, calling `onFrame` for every decode.
 * Uses requestVideoFrameCallback when available (frame-accurate, only runs
 * when a new frame actually exists) instead of polling with
 * requestAnimationFrame every paint.
 */
export function startScanning(video: HTMLVideoElement, onFrame: FrameHandler): ScannerHandle {
  const detector = new BarcodeDetector({ formats: ['qr_code'] });
  let stopped = false;
  let rvfcId: number | null = null;
  let rafId: number | null = null;

  const tick = async () => {
    if (stopped) return;
    if (video.videoWidth > 0) {
      try {
        const codes = await detector.detect(video);
        if (codes.length > 0) onFrame(codes[0].rawValue);
      } catch {
        // transient decode failure on a bad frame — just try the next one
      }
    }
    scheduleNext();
  };

  const hasRVFC = typeof (video as any).requestVideoFrameCallback === 'function';

  function scheduleNext() {
    if (stopped) return;
    if (hasRVFC) {
      rvfcId = (video as any).requestVideoFrameCallback(() => tick());
    } else {
      rafId = requestAnimationFrame(() => tick());
    }
  }

  scheduleNext();

  return {
    stop() {
      stopped = true;
      if (rvfcId !== null) (video as any).cancelVideoFrameCallback?.(rvfcId);
      if (rafId !== null) cancelAnimationFrame(rafId);
    }
  };
}

export async function openCamera(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' } },
    audio: false
  });
}
