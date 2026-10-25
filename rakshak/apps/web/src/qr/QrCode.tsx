import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

/** A QR code as an image (generated on the device; nothing is sent anywhere). */
export function QrCode({ text, size = 220 }: { text: string; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(text, { margin: 1, width: size * 2, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } })
      .then((url) => live && setSrc(url))
      .catch(() => live && setSrc(null));
    return () => {
      live = false;
    };
  }, [text, size]);
  return <div className="qr-box" style={{ width: size, height: size }}>{src && <img src={src} width={size} height={size} alt="QR code" />}</div>;
}
