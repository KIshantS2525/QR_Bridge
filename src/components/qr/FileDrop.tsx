import { useRef, useState, type DragEvent } from "react";
import { FileUp, Layers3 } from "lucide-react";

export function FileDrop({ onFiles }: { onFiles: (files: FileList) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      className={`group relative grid min-h-64 cursor-pointer place-items-center overflow-hidden border border-dashed p-8 text-center transition-all ${over ? "border-primary bg-primary/5" : "border-border bg-surface/70 hover:border-primary/60"}`}
      onClick={() => inputRef.current?.click()}
      onDragOver={(event) => { event.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(event: DragEvent<HTMLDivElement>) => { event.preventDefault(); setOver(false); if (event.dataTransfer.files.length) onFiles(event.dataTransfer.files); }}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") inputRef.current?.click(); }}
    >
      <input ref={inputRef} type="file" multiple hidden onChange={(event) => { const files = event.target.files; if (files?.length) onFiles(files); }} />
      <div className="absolute left-4 top-4 font-mono text-[10px] uppercase text-muted-foreground">Input bay / 01</div>
      <div className="relative">
        <div className="mx-auto mb-5 grid size-20 place-items-center border border-border bg-background shadow-lift transition-transform duration-300 group-hover:-translate-y-1 group-hover:rotate-2">
          <FileUp className="size-8 text-primary" strokeWidth={1.5} />
          <svg className="sketch-square absolute -inset-2 size-24 text-signal" viewBox="0 0 100 100" aria-hidden="true"><path d="M7 11C31 4 69 7 91 13c3 20 2 53-2 76-21 4-55 3-81-2C5 63 5 36 7 11Z" /></svg>
        </div>
        <h2 className="text-xl font-semibold text-foreground">Drop files onto the light table</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">Choose one file or a whole set. Multiple files are bundled automatically.</p>
        <span className="mt-5 inline-flex items-center gap-2 font-mono text-[11px] uppercase text-primary"><Layers3 className="size-3.5" /> Click to browse</span>
      </div>
    </div>
  );
}
