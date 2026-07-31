# QR Share

An offline way to share files between two devices with nothing but QR codes and a camera. No network connection, no server, no pairing code, no account — one device shows a looping QR "carousel," the other watches it with a camera and reassembles the file.

Live demo: (see your fork's deploy — Netlify/Vercel/GitHub Pages all work, it's a static site)

Originally built in 2019 (Create React App, React 16, a hand-rolled Emscripten/WASM QR decoder run in a Web Worker via `rawr` RPC). This is a 2026 rebuild of the same core idea on a modern stack.

## How it works

1. **Sender** picks a file. It's gzip-compressed (`CompressionStream`), split into chunks, and each chunk is packed into a small text frame: `Q1:<index>:<total>:<crc16>:<base45(chunk)>`.
2. Frames are base45-encoded (RFC 9285 — same trick the EU digital covid cert used) so they land in QR "alphanumeric mode," which has meaningfully more capacity per code than byte-mode base64 would.
3. The sender cycles through frames on-screen as a rendered QR code, one at a time, on a loop.
4. The **receiver** points its camera at the screen. Every decoded frame is checked against its CRC16 and accumulated. The transfer needs no acknowledgment or connection — a missed frame just comes back around on the next loop.
5. Once every chunk plus the manifest (filename/mime/size) has been seen, the receiver decompresses and offers to save the file (File System Access API where available, plain download otherwise).

## Stack

- **Vite + React 19 + TypeScript** (replacing Create React App / react-scripts, which is no longer maintained)
- **[`barcode-detector`](https://www.npmjs.com/package/barcode-detector)** — uses the native `BarcodeDetector` API where the browser has it, falls back to a maintained WASM (zxing) decoder where it doesn't. Replaces the original's custom Emscripten build + Web Worker RPC bridge.
- **`requestVideoFrameCallback`** for frame-accurate scanning instead of polling every animation frame.
- **`qrcode.react`** v4 for QR rendering.
- **`vite-plugin-pwa`** — the app itself is installable and works offline (fitting, given the whole point is an offline transfer).
- Native `CompressionStream`/`DecompressionStream` for gzip — no compression library needed.

## Improvements over the original

- Any file type, not just images (the original only ever reassembled a `dataUrl` into an `<img>`).
- Per-chunk CRC16 rejects corrupted camera reads instead of trusting whatever the scanner returns.
- Gzip + base45 packing instead of raw base64 data-URL text — meaningfully more payload per QR frame, so fewer frames for the same file.
- Adjustable carousel speed and a manual scrub slider for slow scanners/low light.
- Installable PWA shell.

## Develop

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

Output goes to `dist/` — it's a static site, deploy it anywhere (Netlify, Vercel, GitHub Pages, etc).

## Limitations

- Both devices need a working camera (receiver) and screen (sender), obviously.
- Very large files mean a long, slow QR carousel — this is a good fit for documents, images, and small archives, not multi-gigabyte transfers. If both devices *do* have a network path to each other, a WebRTC-based transfer would be faster; this project intentionally trades speed for needing absolutely nothing — no Wi-Fi, no Bluetooth, no shared network, no server.
