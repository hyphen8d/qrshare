import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';

interface Props {
  frames: string[];
  intervalMs?: number;
}

/** A simple always-looping QR carousel — used for the small pairing handshake frames (a handful of frames, seconds to scan), as opposed to the full-featured carousel with play/pause/scrub used for the legacy whole-file QR mode. */
export default function QRCarousel({ frames, intervalMs = 150 }: Props) {
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    setCurrent(0);
  }, [frames]);

  useEffect(() => {
    if (frames.length <= 1) return;
    const id = setInterval(() => setCurrent((c) => (c + 1) % frames.length), intervalMs);
    return () => clearInterval(id);
  }, [frames, intervalMs]);

  const size = Math.min(280, window.innerWidth * 0.7);

  return (
    <div className="qr-wrap qr-wrap-small">
      <QRCodeSVG value={frames[current]} size={size} level="M" marginSize={2} />
    </div>
  );
}
