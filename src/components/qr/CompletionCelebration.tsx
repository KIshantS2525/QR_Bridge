import { Check, ShieldCheck } from "lucide-react";
export function CompletionCelebration({ frameCount, elapsedSeconds, bytes }: { frameCount: number; elapsedSeconds: number; bytes: number }) {
  return (
    <div className="py-8 text-center">
      <div className="relative mx-auto mb-5 grid size-28 place-items-center border border-success bg-success/10 shadow-lift">
        <Check className="size-12 text-success" strokeWidth={1.7} />
        <svg className="sketch-square absolute -inset-3 size-34 text-success" viewBox="0 0 100 100" aria-hidden="true"><path d="M7 11C31 4 69 7 91 13c3 20 2 53-2 76-21 4-55 3-81-2C5 63 5 36 7 11Z" /></svg>
      </div>
      <h2 className="text-2xl font-semibold">Transfer verified</h2>
      <p className="mt-2 flex items-center justify-center gap-2 font-mono text-[10px] uppercase text-success"><ShieldCheck className="size-4" /> SHA-256 byte match</p>
      <p className="mt-4 text-sm text-muted-foreground">{frameCount} frames · {(bytes / 1024).toFixed(1)} KB · {elapsedSeconds.toFixed(1)} seconds</p>
    </div>
  );
}
