import { useEffect, useRef, useState, type MouseEvent } from "react";
import { QRCodeSVG } from "qrcode.react";
import { ScanLine } from "lucide-react";

export function QRStage({ value, pulseSeconds, frame, total }: { value: string; pulseSeconds: number; frame: number; total: number }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const [fadeKey, setFadeKey] = useState(0);
  useEffect(() => setFadeKey((key) => key + 1), [value]);
  function move(event: MouseEvent<HTMLDivElement>) {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTilt({ x: -((event.clientY - rect.top) / rect.height - 0.5) * 7, y: ((event.clientX - rect.left) / rect.width - 0.5) * 8 });
  }
  return (
    <div ref={wrapRef} className="qr-stage" onMouseMove={move} onMouseLeave={() => setTilt({ x: 0, y: 0 })} style={{ "--pulse-speed": `${pulseSeconds}s` } as React.CSSProperties}>
      <div className="qr-beam" />
      <div className="qr-plinth" />
      <div className="qr-card" style={{ transform: `perspective(900px) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg) translateZ(28px)` }}>
        <div className="absolute left-3 top-3 flex items-center gap-1.5 font-mono text-[8px] uppercase text-muted-foreground"><ScanLine className="size-3 text-signal" /> optical frame</div>
        <div key={fadeKey} className="qr-frame-in mt-5">
          <QRCodeSVG value={value} size={260} level="M" bgColor="transparent" fgColor="currentColor" includeMargin />
        </div>
        <div className="mt-2 flex items-center justify-between border-t border-border pt-2 font-mono text-[9px] uppercase text-muted-foreground"><span>TX / {String(frame).padStart(4, "0")}</span><span>{total} frames</span></div>
      </div>
      <svg className="sketch-square pointer-events-none absolute left-1/2 top-1/2 h-[340px] w-[340px] -translate-x-1/2 -translate-y-1/2 text-signal" viewBox="0 0 100 100" aria-hidden="true"><path d="M7 11C31 4 69 7 91 13c3 20 2 53-2 76-21 4-55 3-81-2C5 63 5 36 7 11Z" /></svg>
    </div>
  );
}
