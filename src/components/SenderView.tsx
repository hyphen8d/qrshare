import { useCallback, useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { encodeFileToFrames, type FileManifest } from '../lib/chunker';

const DEFAULT_INTERVAL_MS = 150;

interface Props {
  onBack: () => void;
}

export default function SenderView({ onBack }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [frames, setFrames] = useState<string[] | null>(null);
  const [manifest, setManifest] = useState<FileManifest | null>(null);
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [intervalMs, setIntervalMs] = useState(DEFAULT_INTERVAL_MS);
  const [encoding, setEncoding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!playing || !frames) return;
    const id = setInterval(() => {
      setCurrent((c) => (c + 1) % frames.length);
    }, intervalMs);
    return () => clearInterval(id);
  }, [playing, frames, intervalMs]);

  const handleFile = useCallback(async (selected: File) => {
    setError(null);
    setEncoding(true);
    setFrames(null);
    try {
      const { frames: encoded, manifest: m } = await encodeFileToFrames(selected);
      setFile(selected);
      setManifest(m);
      setFrames(encoded);
      setCurrent(0);
      setPlaying(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that file.');
    } finally {
      setEncoding(false);
    }
  }, []);

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  };

  const reset = () => {
    setFile(null);
    setFrames(null);
    setManifest(null);
    setCurrent(0);
  };

  return (
    <div className="view">
      <button className="back-btn" onClick={onBack}>&larr; Back</button>
      <h2>Send a file</h2>

      {!file && (
        <div
          className="dropzone"
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <p>Drop a file here, or tap to choose one</p>
          <input ref={fileInputRef} type="file" hidden onChange={onInputChange} />
        </div>
      )}

      {encoding && <p className="hint">Compressing and encoding&hellip;</p>}
      {error && <p className="error">{error}</p>}

      {frames && manifest && (
        <div className="sender-active">
          <p className="hint">{manifest.name} &middot; {formatBytes(manifest.size)} &middot; {frames.length} QR frames</p>
          <div className="qr-wrap">
            <QRCodeSVG value={frames[current]} size={Math.min(360, window.innerWidth * 0.85)} level="M" marginSize={2} />
          </div>
          <p className="hint">Frame {current + 1} of {frames.length} &mdash; point the receiving camera at this screen</p>

          <div className="controls">
            <button onClick={() => setPlaying((p) => !p)}>{playing ? 'Pause' : 'Play'}</button>
            <button onClick={reset}>Choose a different file</button>
          </div>

          <label className="speed-label">
            Speed: {intervalMs}ms/frame
            <input
              type="range"
              min={60}
              max={500}
              step={10}
              value={intervalMs}
              onChange={(e) => setIntervalMs(parseInt(e.target.value, 10))}
            />
          </label>

          <input
            type="range"
            min={0}
            max={frames.length - 1}
            value={current}
            onChange={(e) => { setPlaying(false); setCurrent(parseInt(e.target.value, 10)); }}
            aria-label="Manually scrub frames"
          />
        </div>
      )}
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(1)} ${units[i]}`;
}
