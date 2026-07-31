# QR Share

An offline-*first* way to share files between two devices — point one screen at another and go. No account, no shared app, no server you have to run.

Originally built in 2019 (Create React App, React 16, a hand-rolled Emscripten/WASM QR decoder run in a Web Worker via `rawr` RPC). This is a 2026 rebuild on a modern stack, with a hybrid transfer strategy added on top of the original idea.

## How it works

**Pairing (always QR, always camera-only):** the sender creates a WebRTC offer, waits for ICE gathering to finish (so the *whole* connection description — SDP + candidates — is known upfront), and encodes it into a couple of QR frames using the same gzip + base45 + CRC16 packing described below. The receiver scans those, generates an answer, and shows *its* answer back as a QR carousel for the sender to scan. This handshake is small (a couple of KB of SDP compresses to 1-3 QR frames) — seconds, not minutes, regardless of the file size.

**Transfer (fast path, when the devices can actually reach each other):** once paired, the file itself moves over a direct WebRTC DataChannel — ordered, reliable, encrypted (DTLS), no QR involved, megabytes per second instead of chunks per second. This needs both devices on a network that can route between them (typically: same Wi-Fi — the common case), plus a STUN server for trickier NATs. If the connection can't form, there's a one-click fallback.

**Fallback / legacy mode (pure QR carousel, zero network of any kind):** the original mechanism, still fully intact. The sender cycles through QR frames encoding the (gzip + base45 + CRC16-packed) file itself, on a loop; the receiver's camera scans them and reassembles once every chunk has been seen at least once, in any order. No pairing, no network, works purely by one screen being visible to one camera. This is what the app falls back to automatically if you choose "QR-only" from an error screen, or if you pick it manually — it's slower (fine for documents/small images, not multi-MB photos) but needs absolutely nothing else to work.

The receiver auto-detects which mode the sender is broadcasting (an `H1:` prefix means "pairing handshake," a `Q1:` prefix means "legacy file frame") — no mode toggle needed on the receiving end.

## Stack

- **Vite + React 19 + TypeScript** (replacing Create React App / react-scripts, unmaintained)
- **`barcode-detector`** — native `BarcodeDetector` where the browser has it, WASM (zxing) fallback otherwise. Replaces the original's custom Emscripten build + Web Worker RPC bridge.
- **`requestVideoFrameCallback`** for frame-accurate scanning instead of polling every animation frame.
- **`qrcode.react`** v4 for QR rendering.
- **Native `RTCPeerConnection`/`RTCDataChannel`** for the fast path — no signaling server, ever; the only "signaling channel" is the QR handshake.
- **`vite-plugin-pwa`** — the app itself is installable and works offline.
- Native `CompressionStream`/`DecompressionStream` for gzip — no compression library needed.

## Legacy QR wire format

Kept from the original design, still used for the fallback path:

```
Manifest frame: Q1:M:<totalChunks>:<crc16>:<base45(manifestJson)>
Data frame:     Q1:<index>:<totalChunks>:<crc16>:<base45(chunkBytes)>
```

Base45 (RFC 9285) packs bytes into QR "alphanumeric mode," which has more capacity per code than byte-mode base64 would. Chunk size is adjustable in the UI (Reliable/Balanced/Fast), trading frame count against how dense — and hard to scan — each code is:

| Preset | Bytes/chunk | QR version | Modules/side | px/module @360px |
|---|---|---|---|---|
| Reliable | 150 | v9 | 53×53 | 6.8 |
| Balanced (default) | 350 | v15 | 77×77 | 4.7 |
| Fast | 700 | v22 | 105×105 | 3.4 |

The pairing handshake (`H1:` frames) uses the same packing at the Balanced density, since it's only ever a couple of frames regardless.

## Develop

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

Output goes to `dist/` — deploy anywhere static (Netlify, Vercel, GitHub Pages). Camera access requires HTTPS (or `localhost`).

## Limitations

- The WebRTC fast path needs the two devices to actually reach each other over a network — same Wi-Fi is the common case. If they can't, the app surfaces an error with a one-click "use QR-only instead."
- Legacy/fallback QR-carousel mode is genuinely zero-network but scales poorly — great for documents and small images, not multi-MB photos or video.
- Both devices need a working camera (receiver, and briefly the sender during pairing) and screen.
