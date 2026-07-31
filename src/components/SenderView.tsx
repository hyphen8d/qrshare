import { useCallback, useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { encodeFileToFrames, type FileManifest } from '../lib/chunker';
import { encodeSdpToFrames, SdpFrameReceiver } from '../lib/sdpFrames';
import { createOfferer, closeConnection, type Offerer } from '../lib/rtc';
import { sendFile } from '../lib/transfer';
import { openCamera, startScanning, type ScannerHandle } from '../lib/scanner';
import { ThroughputTracker } from '../lib/throughput';
import { formatBytes, formatDuration } from '../lib/format';
import QRCarousel from './QRCarousel';
import StatusBanner from './StatusBanner';
import StepIndicator from './StepIndicator';

const QUALITY_PRESETS = [
  { id: 'reliable', label: 'Reliable', chunkBytes: 150, hint: 'Best for small screens or older cameras' },
  { id: 'balanced', label: 'Balanced', chunkBytes: 350, hint: 'Good default for most phones and webcams' },
  { id: 'fast', label: 'Fast', chunkBytes: 700, hint: 'Fewer frames — needs a larger screen and a good camera' }
] as const;
type QualityId = (typeof QUALITY_PRESETS)[number]['id'];

type Stage = 'picking' | 'pairing' | 'connecting' | 'transferring' | 'done' | 'error' | 'legacy';

interface Props {
  onBack: () => void;
}

export default function SenderView({ onBack }: Props) {
  const [stage, setStage] = useState<Stage>('picking');
  const [file, setFile] = useState<File | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [offerFrames, setOfferFrames] = useState<string[] | null>(null);
  const [answerProgress, setAnswerProgress] = useState({ received: 0, total: 0 });
  const [sendProgress, setSendProgress] = useState({ sent: 0, total: 0 });
  const [sendSpeed, setSendSpeed] = useState(0);

  // Legacy (QR-only, no network) mode state
  const [quality, setQuality] = useState<QualityId>('balanced');
  const [legacyFrames, setLegacyFrames] = useState<string[] | null>(null);
  const [legacyManifest, setLegacyManifest] = useState<FileManifest | null>(null);
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [intervalMs, setIntervalMs] = useState(150);
  const [encoding, setEncoding] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const offererRef = useRef<Offerer | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scannerRef = useRef<ScannerHandle | null>(null);
  const cancelledRef = useRef(false);

  const stopCameraAndScanner = useCallback(() => {
    scannerRef.current?.stop();
    scannerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const teardownConnection = useCallback(() => {
    if (offererRef.current) {
      closeConnection(offererRef.current.pc);
      offererRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      stopCameraAndScanner();
      teardownConnection();
    };
  }, [stopCameraAndScanner, teardownConnection]);

  const handleError = useCallback((e: unknown) => {
    if (cancelledRef.current) return;
    stopCameraAndScanner();
    setErrorMsg(e instanceof Error ? e.message : 'Connection failed.');
    setStage('error');
  }, [stopCameraAndScanner]);

  const finishPairing = useCallback(async (selected: File, offerer: Offerer, receiver: SdpFrameReceiver) => {
    try {
      setStage('connecting');
      const answerSdp = await receiver.assemble();
      await offerer.applyAnswer(answerSdp);
      await offerer.waitUntilConnected();
      if (cancelledRef.current) return;
      setStage('transferring');
      setSendProgress({ sent: 0, total: selected.size });
      setSendSpeed(0);
      const tracker = new ThroughputTracker();
      await sendFile(offerer.channel, selected, (sent, total) => {
        setSendProgress({ sent, total });
        setSendSpeed(tracker.update(sent));
      });
      if (cancelledRef.current) return;
      setStage('done');
    } catch (e) {
      handleError(e);
    }
  }, [handleError]);

  const startPairing = useCallback(async (selected: File) => {
    setFile(selected);
    setErrorMsg('');
    setAnswerProgress({ received: 0, total: 0 });
    setStage('pairing');
    try {
      const offerer = await createOfferer();
      offererRef.current = offerer;
      const frames = await encodeSdpToFrames(offerer.offerSdp);
      if (cancelledRef.current) return;
      setOfferFrames(frames);

      const stream = await openCamera();
      if (cancelledRef.current) { stream.getTracks().forEach((t) => t.stop()); return; }
      streamRef.current = stream;
      if (!videoRef.current) return;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();

      const receiver = new SdpFrameReceiver();
      scannerRef.current = startScanning(videoRef.current, (value) => {
        const changed = receiver.ingest(value);
        if (!changed) return;
        setAnswerProgress({ received: receiver.receivedCount, total: receiver.totalCount ?? 0 });
        if (receiver.isComplete) {
          stopCameraAndScanner();
          finishPairing(selected, offerer, receiver);
        }
      });
    } catch (e) {
      handleError(e);
    }
  }, [finishPairing, handleError, stopCameraAndScanner]);

  const useLegacy = useCallback(async (selected: File | null, qualityId: QualityId = quality) => {
    stopCameraAndScanner();
    teardownConnection();
    if (!selected) return;
    setErrorMsg('');
    setStage('legacy');
    setEncoding(true);
    try {
      const chunkBytes = QUALITY_PRESETS.find((q) => q.id === qualityId)!.chunkBytes;
      const { frames, manifest } = await encodeFileToFrames(selected, chunkBytes);
      if (cancelledRef.current) return;
      setLegacyFrames(frames);
      setLegacyManifest(manifest);
      setCurrent(0);
      setPlaying(true);
    } catch (e) {
      handleError(e);
    } finally {
      setEncoding(false);
    }
  }, [handleError, quality, stopCameraAndScanner, teardownConnection]);

  useEffect(() => {
    if (stage !== 'legacy' || !playing || !legacyFrames) return;
    const id = setInterval(() => {
      setCurrent((c) => (c + 1) % legacyFrames.length);
    }, intervalMs);
    return () => clearInterval(id);
  }, [stage, playing, legacyFrames, intervalMs]);

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) startPairing(f);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) startPairing(f);
  };

  const reset = () => {
    stopCameraAndScanner();
    teardownConnection();
    setFile(null);
    setOfferFrames(null);
    setLegacyFrames(null);
    setLegacyManifest(null);
    setCurrent(0);
    setErrorMsg('');
    setStage('picking');
  };

  const rtcStep: 0 | 1 | 2 = stage === 'transferring' ? 1 : stage === 'done' ? 2 : 0;

  return (
    <div className="view">
      <button className="back-btn" onClick={onBack}>&larr; Back</button>
      <h2>Send a file</h2>

      {stage === 'picking' && (
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

      {(stage === 'pairing' || stage === 'connecting' || stage === 'transferring' || stage === 'done') && (
        <StepIndicator current={rtcStep} />
      )}

      {stage === 'pairing' && (
        <div className="pairing-panel">
          {offerFrames ? <QRCarousel frames={offerFrames} /> : <p className="hint">Preparing&hellip;</p>}
          <p className="hint">Point this device&rsquo;s camera at the receiving screen&rsquo;s QR code</p>
          <video ref={videoRef} muted playsInline className="scan-video scan-video-small" />
          {answerProgress.total > 0 ? (
            <StatusBanner tone="progress">Reading response from other device: {answerProgress.received} of {answerProgress.total}</StatusBanner>
          ) : (
            <p className="hint">Waiting for the other device to scan this&hellip;</p>
          )}
          <button onClick={() => useLegacy(file)}>Use QR-only instead (no network)</button>
        </div>
      )}

      {stage === 'connecting' && (
        <div className="pairing-panel">
          <StatusBanner tone="success">Response received &mdash; paired with the other device</StatusBanner>
          <StatusBanner tone="progress">Opening a direct connection&hellip;</StatusBanner>
        </div>
      )}

      {stage === 'transferring' && (
        <div className="pairing-panel">
          <StatusBanner tone="success">Connected &mdash; sending directly, no more QR needed</StatusBanner>
          <p className="hint">{file?.name}</p>
          <p className="hint">
            {formatBytes(sendProgress.sent)} of {formatBytes(sendProgress.total)}
            {sendSpeed > 0 && sendProgress.sent < sendProgress.total && (
              <> &middot; {formatBytes(sendSpeed)}/s &middot; {formatDuration((sendProgress.total - sendProgress.sent) / sendSpeed)} left</>
            )}
          </p>
          <progress value={sendProgress.sent} max={sendProgress.total || 1} />
        </div>
      )}

      {stage === 'done' && (
        <div className="pairing-panel">
          <StatusBanner tone="success">Sent {file?.name}</StatusBanner>
          <button onClick={reset}>Send another file</button>
        </div>
      )}

      {stage === 'error' && (
        <div className="pairing-panel">
          <p className="error">{errorMsg}</p>
          <div className="controls">
            <button onClick={() => file && startPairing(file)}>Try again</button>
            <button onClick={() => useLegacy(file)}>Use QR-only instead</button>
          </div>
        </div>
      )}

      {stage === 'legacy' && (
        <div className="sender-active">
          <fieldset className="quality-picker">
            <legend>Scan reliability</legend>
            {QUALITY_PRESETS.map((q) => (
              <label key={q.id} className={quality === q.id ? 'quality-opt selected' : 'quality-opt'}>
                <input
                  type="radio"
                  name="quality"
                  value={q.id}
                  checked={quality === q.id}
                  onChange={() => { setQuality(q.id); if (file) useLegacy(file, q.id); }}
                />
                <span className="quality-name">{q.label}</span>
                <span className="quality-hint">{q.hint}</span>
              </label>
            ))}
          </fieldset>

          {encoding && <p className="hint">Compressing and encoding&hellip;</p>}

          {legacyFrames && legacyManifest && (
            <>
              <p className="hint">{legacyManifest.name} &middot; {formatBytes(legacyManifest.size)} &middot; {legacyFrames.length} QR frames</p>
              <div className="qr-wrap">
                <QRCodeSVG value={legacyFrames[current]} size={Math.min(360, window.innerWidth * 0.85)} level="M" marginSize={2} />
              </div>
              <p className="hint">Frame {current + 1} of {legacyFrames.length} &mdash; point the receiving camera at this screen</p>

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
                max={legacyFrames.length - 1}
                value={current}
                onChange={(e) => { setPlaying(false); setCurrent(parseInt(e.target.value, 10)); }}
                aria-label="Manually scrub frames"
              />
            </>
          )}
        </div>
      )}

      {errorMsg && stage !== 'error' && <p className="error">{errorMsg}</p>}
    </div>
  );
}
