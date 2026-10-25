import jsQR from 'jsqr';
import { Camera, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

/** Full-screen camera that reads a QR code (decoded on the device with jsQR). */
export function QrScanner({ onResult, onClose, hint }: { onResult: (text: string) => void; onClose: () => void; hint: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const result = useRef(onResult);
  result.current = onResult;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let done = false;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const tick = () => {
      const v = video.current;
      if (done || !v || !ctx) return;
      if (v.readyState === v.HAVE_ENOUGH_DATA && v.videoWidth) {
        // Scan a downscaled frame: fast enough on low-end phones.
        const scale = Math.min(1, 640 / v.videoWidth);
        canvas.width = Math.round(v.videoWidth * scale);
        canvas.height = Math.round(v.videoHeight * scale);
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
        if (code?.data) {
          done = true;
          navigator.vibrate?.(40);
          result.current(code.data);
          return;
        }
      }
      raf = requestAnimationFrame(tick);
    };

    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false })
      .then((s) => {
        stream = s;
        if (video.current) {
          video.current.srcObject = s;
          void video.current.play();
        }
        raf = requestAnimationFrame(tick);
      })
      .catch(() => setError('Camera not available. Allow camera access for RAKSHAK, or enter the details by hand.'));
    if (!navigator.mediaDevices) setError('Camera not available on this device. Enter the details by hand.');

    return () => {
      done = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="scanner">
      <video ref={video} className="scanner-video" playsInline muted />
      <div className="scanner-frame" />
      <div className="scanner-top">
        <button className="scanner-x" onClick={onClose} aria-label="Close">
          <X size={20} />
        </button>
      </div>
      <div className="scanner-hint">
        {error ? (
          error
        ) : (
          <>
            <Camera size={16} /> {hint}
          </>
        )}
      </div>
    </div>
  );
}
