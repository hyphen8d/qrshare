import { useCallback, useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { encodeFileToFrames, type FileManifest } from '../lib/chunker';

const DEFAULT_INTERVAL_MS = 150;

// Chunk size trades frame count against how dense (and hard to scan) each QR
// code is. Measured against a 360px render at error-correction level M:
//   150B/chunk -> QR v9  (53x53 modules,  ~6.8px/module)
//   350B/chunk -> QR v15 (77x77 modules,  ~4.7px/module)
//   700B/chunk -> QR v22 (105x105 modules, ~3.4px/module)
// Denser codes need a bigger screen, better focus, and closer range to
// scan reliably — a laptop webcam reading a phone screen wants "Reliable"
// or "Balanced", not "Fast".
const QUALITY_PRESETS = [
  { id: 'reliable', label: 'Reliable', chunkBytes: 150, hint: 'Best for small screens or older cameras' },
  { id: 'balanced', label: 'Balanced', chunkBytes: 350, hint: 'Good default for most phones and webcams' },
  { id: 'fast', label: 'Fast', chunkBytes: 700, hint: 'Fewer frames — needs a larger screen and a good camera' }
] as const;

type QualityId = (typeof QUALITY_PRESETS)[number]['id'];

interface Props {
  onBack: () => void;
}

export default function SenderView({ onBack }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [quality, setQuality] = useState<QualityId>('balanced');
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

  const encode = useCallback(async (selected: File, qualityId: QualityId) => {
    setError(null);
    setEncoding(true);
    try {
      const chunkBytes = QUALITY_PRESETS.find((q) => q.id === qualityId)!.chunkBytes;
      const { frames: encoded, manifest: m } = await encodeFileToFrames(selected, chunkBytes);
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
    if (f) encode(f, quality);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) encode(f, quality);
  };

  const onQualityChange = (qualityId: QualityId) => {
    setQuality(qualityId);
    if (file) encode(file, qualityId);
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

      <fieldset className="quality-picker">
        <legend>Scan reliability</legend>
        {QUALITY_PRESETS.map((q) => (
          <label key={q.id} className={quality === q.id ? 'quality-opt selected' : 'quality-opt'}>
            <input
              type="radio"
              name="quality"
              value={q.id}
              checked={quality === q.id}
              onChange={() => onQualityChange(q.id)}
            />
            <span className="quality-name">{q.label}</span>
            <span className="quality-hint">{q.hint}</span>
          </label>
        ))}
      </fieldset>

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
