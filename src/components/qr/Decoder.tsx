import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Camera, ImageUp, ScanQrCode, Square } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FountainCollector } from "@/lib/fountain";
import { unpackBulkPayload } from "@/lib/bulk";
import { decodeImageFile, hasNativeBarcodeDetector, startScanning } from "@/lib/scanner";
import { chunkBlip, errorBuzz, successChime } from "@/lib/sound";
import { ScanReticle } from "./ScanReticle";
import { ChunkGrid } from "./ChunkGrid";
import { OnboardingDiagram } from "./OnboardingDiagram";
import { CompletionCelebration } from "./CompletionCelebration";

type TransferFile = { name: string; blob: Blob };
const emptyProgress = { received: 0, total: 0, framesSeen: 0, bytesReceived: 0, elapsedSeconds: 0, bytesPerSecond: 0 };
const formatBytes = (bytes: number) => !bytes ? "0 B" : bytes < 1024 ? `${Math.round(bytes)} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(2)} MB`;

export function Decoder() {
  const videoRef = useRef<HTMLVideoElement>(null); const canvasRef = useRef<HTMLCanvasElement>(null);
  const collectorRef = useRef(new FountainCollector()); const stopRef = useRef<(() => void) | null>(null);
  const [scanning, setScanning] = useState(false); const [progress, setProgress] = useState(emptyProgress);
  const [error, setError] = useState<string | null>(null); const [result, setResult] = useState<TransferFile[] | null>(null); const [flash, setFlash] = useState(false);
  const lastToastRef = useRef<Record<string, number>>({});
  useEffect(() => () => stopRef.current?.(), []);

  // Sonner toasts for things worth telling the user about that aren't
  // outright errors — invalid scans, corrupted symbols, a stray unrelated QR
  // wandering through frame. Throttled per-kind so a repeatedly-bad signal
  // (e.g. holding the camera over a poster) doesn't spam the toast queue.
  function notify(kind: string, message: string) {
    const now = Date.now();
    if (now - (lastToastRef.current[kind] ?? 0) < 3000) return;
    lastToastRef.current[kind] = now;
    toast.warning(message);
  }

  async function finalize() {
    try {
      const { blob, name } = await collectorRef.current.finalize(); successChime();
      const verifiedName = name ?? "received-file.bin";
      setResult(verifiedName.endsWith(".zip") && verifiedName.startsWith("bundle_") ? await unpackBulkPayload(blob) : [{ name: verifiedName, blob }]);
    } catch (cause) { errorBuzz(); setError(cause instanceof Error ? cause.message : "Verification failed"); }
  }
  function decoded(text: string) {
    const collector = collectorRef.current; const status = collector.addFrame(text);
    if (!status.ok) { notify("invalid", "That QR isn't part of a transfer — keep scanning."); return; }
    if (status.foreign) { notify("foreign", "Ignoring a QR from a different transfer. Press Stop then Start to switch senders."); return; }
    if (status.rejected) { notify("rejected", "Discarded a misread frame — it'll self-heal from the next one."); return; }
    if (!status.duplicate) { chunkBlip(); setFlash(true); window.setTimeout(() => setFlash(false), 140); }
    setProgress(collector.progress()); if (collector.isComplete()) { stopRef.current?.(); setScanning(false); void finalize(); }
  }
  async function start() {
    setError(null); setResult(null); collectorRef.current.reset(); setProgress(emptyProgress); setScanning(true);
    if (!videoRef.current || !canvasRef.current) return;
    stopRef.current = await startScanning(videoRef.current, canvasRef.current, decoded, (cause: Error) => { setError(cause.message); setScanning(false); });
  }
  function stop() { stopRef.current?.(); setScanning(false); }
  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    try { decoded(await decodeImageFile(file)); } catch (cause) { setError(cause instanceof Error ? cause.message : "No QR code found"); }
  }
  function download(file: TransferFile) { const url = URL.createObjectURL(file.blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = file.name; anchor.click(); URL.revokeObjectURL(url); }

  if (result) {
    const collector = collectorRef.current;
    const elapsedSeconds = collector.completeTime && collector.startTime ? (collector.completeTime - collector.startTime) / 1000 : 0;
    return <section className="work-panel"><CompletionCelebration frameCount={collector.k ?? 0} elapsedSeconds={elapsedSeconds} bytes={collector.bytesReceived} />{result.map((file) => <div key={file.name} className="flex items-center justify-between border-t border-border py-3"><span className="truncate text-sm font-medium">{file.name}</span><Button onClick={() => download(file)}>Download</Button></div>)}<Button variant="ghost" className="mt-4 w-full" onClick={() => setResult(null)}>Receive another</Button></section>;
  }

  const pct = progress.total ? Math.round(progress.received / progress.total * 100) : 0;
  return (
    <section className="work-panel">
      <div className="mb-4 flex items-center justify-between"><div><p className="font-mono text-[9px] uppercase text-signal">Camera receiver</p><h2 className="mt-1 text-base font-semibold">Align the moving QR inside the frame</h2></div><ScanQrCode className="size-6 text-primary" /></div>
      <div className="camera-well">
        <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
        <canvas ref={canvasRef} hidden />
        {scanning ? <ScanReticle locked={flash} /> : <div className="absolute inset-0 grid place-items-center"><div className="text-center text-surface"><Camera className="mx-auto mb-3 size-9"/><p className="font-mono text-[10px] uppercase">Camera is standing by</p></div></div>}
      </div>
      {!hasNativeBarcodeDetector() && <p className="mt-3 font-mono text-[9px] uppercase text-muted-foreground">Software scanner active · Chrome offers the fastest capture</p>}
      <div className="mt-4 grid grid-cols-2 gap-2">
        {scanning ? <Button variant="outline" onClick={stop}><Square /> Stop camera</Button> : <Button onClick={() => void start()}><Camera /> Start camera</Button>}
        <Button variant="outline" asChild><label className="cursor-pointer"><ImageUp /> Upload QR image<input type="file" accept="image/*" hidden onChange={upload} /></label></Button>
      </div>
      {progress.total === 0 && !scanning && <OnboardingDiagram />}
      {progress.total > 0 && <div className="mt-6"><ChunkGrid total={progress.total} doneIndexes={new Set(collectorRef.current.resolved.keys())} /><div className="my-3 flex justify-between font-mono text-[10px] uppercase text-muted-foreground"><span>{progress.received}/{progress.total} blocks</span><span>{pct}%</span><span>{formatBytes(progress.bytesPerSecond)}/s</span></div><div className="h-1 overflow-hidden bg-muted"><div className="h-full bg-success" style={{ width: `${pct}%` }} /></div>{progress.framesSeen > progress.received && <p className="mt-2 font-mono text-[9px] uppercase text-muted-foreground">{progress.framesSeen} symbols scanned for {progress.received} blocks resolved · fountain overhead {Math.round((progress.framesSeen / Math.max(1, progress.received) - 1) * 100)}%</p>}</div>}
      {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
    </section>
  );
}
