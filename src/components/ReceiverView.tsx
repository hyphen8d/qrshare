import { useEffect, useRef, useState } from 'react';
import { FrameReceiver, type FileManifest } from '../lib/chunker';
import { openCamera, startScanning } from '../lib/scanner';
import ProgressBar from './ProgressBar';

interface Props {
  onBack: () => void;
}

type Status = 'starting' | 'scanning' | 'done' | 'error';

export default function ReceiverView({ onBack }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const receiverRef = useRef(new FrameReceiver());
  const [status, setStatus] = useState<Status>('starting');
  const [errorMsg, setErrorMsg] = useState('');
  const [manifest, setManifest] = useState<FileManifest | null>(null);
  const [received, setReceived] = useState(0);
  const [total, setTotal] = useState(0);
  const [missing, setMissing] = useState<number[]>([]);
  const [result, setResult] = useState<{ blob: Blob; manifest: FileManifest } | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let scanner: { stop: () => void } | null = null;
    let cancelled = false;

    (async () => {
      try {
        stream = await openCamera();
        if (cancelled || !videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setStatus('scanning');

        scanner = startScanning(videoRef.current, (value) => {
          const receiver = receiverRef.current;
          const changed = receiver.ingest(value);
          if (!changed) return;

          setManifest(receiver.manifest);
          setReceived(receiver.receivedCount);
          setTotal(receiver.totalCount ?? 0);
          setMissing(receiver.missingIndices());

          if (receiver.isComplete) {
            receiver.assemble().then((r) => {
              setResult(r);
              setStatus('done');
              scanner?.stop();
              stream?.getTracks().forEach((t) => t.stop());
            });
          }
        });
      } catch (e) {
        setStatus('error');
        setErrorMsg(e instanceof Error ? e.message : 'Could not access the camera.');
      }
    })();

    return () => {
      cancelled = true;
      scanner?.stop();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const save = async () => {
    if (!result) return;
    const anyWindow = window as any;
    if (typeof anyWindow.showSaveFilePicker === 'function') {
      try {
        const handle = await anyWindow.showSaveFilePicker({ suggestedName: result.manifest.name });
        const writable = await handle.createWritable();
        await writable.write(result.blob);
        await writable.close();
        setSaved(true);
        return;
      } catch {
        // user cancelled the picker or it's unsupported for this file — fall through to download
      }
    }
    const url = URL.createObjectURL(result.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = result.manifest.name;
    a.click();
    URL.revokeObjectURL(url);
    setSaved(true);
  };

  return (
    <div className="view">
      <button className="back-btn" onClick={onBack}>&larr; Back</button>
      <h2>Receive a file</h2>

      {status === 'error' && <p className="error">{errorMsg}</p>}

      {status !== 'done' && (
        <>
          <video ref={videoRef} muted playsInline className="scan-video" />
          {status === 'starting' && <p className="hint">Requesting camera access&hellip;</p>}
          {status === 'scanning' && !manifest && <p className="hint">Point the camera at the sending screen&rsquo;s QR code</p>}
          {manifest && total > 0 && (
            <>
              <p className="hint">{manifest.name} &middot; {formatBytes(manifest.size)}</p>
              <ProgressBar received={received} total={total} missing={missing} />
            </>
          )}
        </>
      )}

      {status === 'done' && result && (
        <div className="done-panel">
          <p>Received <strong>{result.manifest.name}</strong> ({formatBytes(result.manifest.size)})</p>
          {result.manifest.mime.startsWith('image/') && (
            <img className="preview" src={URL.createObjectURL(result.blob)} alt={result.manifest.name} />
          )}
          <button onClick={save}>{saved ? 'Saved ✓' : 'Save file'}</button>
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
