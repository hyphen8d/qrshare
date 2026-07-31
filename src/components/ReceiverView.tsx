import { useEffect, useRef, useState } from 'react';
import { FrameReceiver, isFileFrame, type FileManifest } from '../lib/chunker';
import { encodeSdpToFrames, isSdpFrame, SdpFrameReceiver } from '../lib/sdpFrames';
import { createAnswerer, closeConnection, type Answerer } from '../lib/rtc';
import { receiveFile, type TransferManifest } from '../lib/transfer';
import { openCamera, startScanning, type ScannerHandle } from '../lib/scanner';
import { ThroughputTracker } from '../lib/throughput';
import { formatBytes, formatDuration } from '../lib/format';
import QRCarousel from './QRCarousel';
import ProgressBar from './ProgressBar';
import StatusBanner from './StatusBanner';
import StepIndicator from './StepIndicator';

interface Props {
  onBack: () => void;
}

type Stage =
  | 'starting'
  | 'scanning'        // waiting to see either an H1 (pairing) or Q1 (legacy file) frame
  | 'pairing-answer'  // got the full offer, showing our answer QR, waiting for the connection
  | 'transferring-rtc'
  | 'transferring-legacy'
  | 'done'
  | 'error';

type Mode = 'rtc' | 'legacy' | null;

export default function ReceiverView({ onBack }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stage, setStage] = useState<Stage>('starting');
  const [errorMsg, setErrorMsg] = useState('');
  const [mode, setMode] = useState<Mode>(null);

  const [offerProgress, setOfferProgress] = useState({ received: 0, total: 0 });
  const [answerFrames, setAnswerFrames] = useState<string[] | null>(null);
  const [rtcProgress, setRtcProgress] = useState({ received: 0, total: 0 });
  const [rtcSpeed, setRtcSpeed] = useState(0);
  const [rtcManifest, setRtcManifest] = useState<TransferManifest | null>(null);

  const [legacyManifest, setLegacyManifest] = useState<FileManifest | null>(null);
  const [legacyReceived, setLegacyReceived] = useState(0);
  const [legacyTotal, setLegacyTotal] = useState(0);
  const [legacyMissing, setLegacyMissing] = useState<number[]>([]);

  const [result, setResult] = useState<{ blob: Blob; name: string; mime: string; size: number } | null>(null);
  const [saved, setSaved] = useState(false);

  const modeRef = useRef<Mode>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let scanner: ScannerHandle | null = null;
    let answerer: Answerer | null = null;

    const sdpReceiver = new SdpFrameReceiver();
    const fileReceiver = new FrameReceiver();

    const stopScanning = () => {
      scanner?.stop();
      scanner = null;
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
    };

    const fail = (e: unknown) => {
      if (cancelledRef.current) return;
      stopScanning();
      setErrorMsg(e instanceof Error ? e.message : 'Something went wrong.');
      setStage('error');
    };

    const runPairing = async () => {
      try {
        const offerSdp = await sdpReceiver.assemble();
        stopScanning();
        setStage('pairing-answer');
        answerer = await createAnswerer(offerSdp);
        const frames = await encodeSdpToFrames(answerer.answerSdp);
        if (cancelledRef.current) return;
        setAnswerFrames(frames);

        const channel = await answerer.waitForChannel();
        if (cancelledRef.current) return;
        setStage('transferring-rtc');
        setRtcSpeed(0);
        const tracker = new ThroughputTracker();
        const { blob, manifest } = await receiveFile(channel, (received, total) => {
          setRtcProgress({ received, total });
          setRtcSpeed(tracker.update(received));
        });
        if (cancelledRef.current) return;
        setRtcManifest(manifest);
        setResult({ blob, name: manifest.name, mime: manifest.mime, size: manifest.size });
        setStage('done');
      } catch (e) {
        fail(e);
      }
    };

    const onFrame = (raw: string) => {
      if (modeRef.current === null) {
        if (isSdpFrame(raw)) { modeRef.current = 'rtc'; setMode('rtc'); }
        else if (isFileFrame(raw)) { modeRef.current = 'legacy'; setMode('legacy'); }
        else return;
      }

      if (modeRef.current === 'rtc') {
        const changed = sdpReceiver.ingest(raw);
        if (!changed) return;
        setOfferProgress({ received: sdpReceiver.receivedCount, total: sdpReceiver.totalCount ?? 0 });
        if (sdpReceiver.isComplete) runPairing();
        return;
      }

      // legacy Q1 file mode
      const changed = fileReceiver.ingest(raw);
      if (!changed) return;
      setLegacyManifest(fileReceiver.manifest);
      setLegacyReceived(fileReceiver.receivedCount);
      setLegacyTotal(fileReceiver.totalCount ?? 0);
      setLegacyMissing(fileReceiver.missingIndices());
      setStage('transferring-legacy');
      if (fileReceiver.isComplete) {
        stopScanning();
        fileReceiver.assemble().then((r) => {
          if (cancelledRef.current) return;
          setResult({ blob: r.blob, name: r.manifest.name, mime: r.manifest.mime, size: r.manifest.size });
          setStage('done');
        }).catch(fail);
      }
    };

    (async () => {
      try {
        stream = await openCamera();
        if (cancelledRef.current || !videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setStage('scanning');
        scanner = startScanning(videoRef.current, onFrame);
      } catch (e) {
        fail(e);
      }
    })();

    return () => {
      cancelledRef.current = true;
      stopScanning();
      if (answerer) closeConnection(answerer.pc);
    };
  }, []);

  const save = async () => {
    if (!result) return;
    const anyWindow = window as any;
    if (typeof anyWindow.showSaveFilePicker === 'function') {
      try {
        const handle = await anyWindow.showSaveFilePicker({ suggestedName: result.name });
        const writable = await handle.createWritable();
        await writable.write(result.blob);
        await writable.close();
        setSaved(true);
        return;
      } catch {
        // cancelled or unsupported for this file — fall through to a plain download
      }
    }
    const url = URL.createObjectURL(result.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = result.name;
    a.click();
    URL.revokeObjectURL(url);
    setSaved(true);
  };

  const showVideo = stage === 'starting' || stage === 'scanning' || stage === 'transferring-legacy';
  const showRtcStepper = mode === 'rtc' && (stage === 'scanning' || stage === 'pairing-answer' || stage === 'transferring-rtc' || stage === 'done');
  const rtcStep: 0 | 1 | 2 = stage === 'transferring-rtc' ? 1 : stage === 'done' ? 2 : 0;

  return (
    <div className="view">
      <button className="back-btn" onClick={onBack}>&larr; Back</button>
      <h2>Receive a file</h2>

      {stage === 'error' && <p className="error">{errorMsg}</p>}

      {showRtcStepper && <StepIndicator current={rtcStep} />}

      {showVideo && <video ref={videoRef} muted playsInline className="scan-video" />}

      {stage === 'starting' && <p className="hint">Requesting camera access&hellip;</p>}
      {stage === 'scanning' && <p className="hint">Point the camera at the sending screen&rsquo;s QR code</p>}

      {stage === 'scanning' && mode === 'rtc' && offerProgress.total > 0 && (
        <StatusBanner tone="progress">Reading handshake from sender: {offerProgress.received} of {offerProgress.total}</StatusBanner>
      )}

      {stage === 'pairing-answer' && answerFrames && (
        <div className="pairing-panel">
          <StatusBanner tone="success">Handshake received &mdash; here&rsquo;s our response</StatusBanner>
          <QRCarousel frames={answerFrames} />
          <p className="hint">Point the sending device&rsquo;s camera at this code</p>
        </div>
      )}

      {stage === 'transferring-rtc' && (
        <div className="pairing-panel">
          <StatusBanner tone="success">Connected &mdash; receiving directly, no more QR needed</StatusBanner>
          <p className="hint">{rtcManifest?.name}</p>
          <p className="hint">
            {formatBytes(rtcProgress.received)} of {formatBytes(rtcProgress.total)}
            {rtcSpeed > 0 && rtcProgress.received < rtcProgress.total && (
              <> &middot; {formatBytes(rtcSpeed)}/s &middot; {formatDuration((rtcProgress.total - rtcProgress.received) / rtcSpeed)} left</>
            )}
          </p>
          <progress value={rtcProgress.received} max={rtcProgress.total || 1} />
        </div>
      )}

      {stage === 'transferring-legacy' && legacyManifest && legacyTotal > 0 && (
        <>
          <p className="hint">{legacyManifest.name} &middot; {formatBytes(legacyManifest.size)}</p>
          <ProgressBar received={legacyReceived} total={legacyTotal} missing={legacyMissing} />
        </>
      )}

      {stage === 'done' && result && (
        <div className="done-panel">
          {mode === 'rtc' && <StatusBanner tone="success">Transfer complete</StatusBanner>}
          <p>Received <strong>{result.name}</strong> ({formatBytes(result.size)})</p>
          {result.mime.startsWith('image/') && (
            <img className="preview" src={URL.createObjectURL(result.blob)} alt={result.name} />
          )}
          <button onClick={save}>{saved ? 'Saved ✓' : 'Save file'}</button>
        </div>
      )}
    </div>
  );
}
