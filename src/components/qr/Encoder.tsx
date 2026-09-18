import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Pause, Play, RotateCcw, SkipBack, SkipForward, Video } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { QRCodeCanvas } from "qrcode.react";
import { encodeFileToFountainSource } from "@/lib/fountain";
import { prepareBulkPayload } from "@/lib/bulk";
import { frameTick } from "@/lib/sound";
import { FileDrop } from "./FileDrop";
import { AudioCapture } from "./AudioCapture";
import { QRStage } from "./QRStage";
import { ChunkGrid } from "./ChunkGrid";
import { OnboardingDiagram } from "./OnboardingDiagram";

const canRecordVideo =
  typeof window !== "undefined" &&
  "MediaRecorder" in window &&
  typeof HTMLCanvasElement !== "undefined" &&
  "captureStream" in HTMLCanvasElement.prototype;

type Status = "idle" | "preparing" | "ready" | "playing" | "paused";
type Meta = { name: string; size: number; gz: number; chunkCount: number; compressedSize: number; blockBytes: number; isBundle: boolean; fileCount: number };
type Source = { getFrame: (seed: number) => string };
const formatBytes = (bytes: number) => bytes < 1024 ? `${Math.round(bytes)} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(2)} MB`;

export function Encoder() {
  const [status, setStatus] = useState<Status>("idle");
  const [source, setSource] = useState<Source | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  // "seed" replaces the old fixed frameIndex. There is no upper bound: seeds
  // < chunkCount are systematic (one raw source block each, so a loss-free
  // scan behaves just like the old protocol); seeds >= chunkCount are random
  // fountain combinations that keep the transfer self-healing forever.
  const [seed, setSeed] = useState(0);
  const [maxSeedSeen, setMaxSeedSeen] = useState(0);
  const [fps, setFps] = useState(5);
  const [error, setError] = useState<string | null>(null);
  const [prepProgress, setPrepProgress] = useState(0);
  const [recording, setRecording] = useState(false);
  const [bakeProgress, setBakeProgress] = useState(0);
  // Only ever holds a value while an export (PNG snapshot or video bake) is
  // actively in flight — the hidden canvas below unmounts the rest of the
  // time so we're not paying to QR-encode every frame twice (once for the
  // visible SVG, once for a canvas nobody asked for yet) during ordinary playback.
  const [exportValue, setExportValue] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (status !== "playing") return;
    timerRef.current = setInterval(() => {
      setSeed((current) => { frameTick(); return current + 1; });
    }, 1000 / fps);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [status, fps]);

  useEffect(() => { setMaxSeedSeen((max) => Math.max(max, seed)); }, [seed]);

  async function handleFiles(files: FileList | File[]) {
    setError(null); setStatus("preparing"); setPrepProgress(0);
    try {
      const payload = await prepareBulkPayload(files, setPrepProgress);
      const encoded = await encodeFileToFountainSource(payload.file);
      setSource({ getFrame: encoded.getFrame });
      setMeta({ ...encoded.meta, isBundle: payload.isBundle, fileCount: payload.fileCount });
      setSeed(0); setMaxSeedSeen(0); setStatus("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to prepare these files"); setStatus("idle");
    }
  }
  function reset() { if (timerRef.current) clearInterval(timerRef.current); setSource(null); setMeta(null); setSeed(0); setMaxSeedSeen(0); setStatus("idle"); setError(null); setRecording(false); setExportValue(null); setBakeProgress(0); }

  // ---- Export: single PNG (ported from QR_Bridge's "one code, download PNG"
  // idea) and a baked-in .webm video of the sequence (ported from its
  // "download as video" idea, but using our fountain redundancy instead of
  // recording two brute-force loops: K systematic frames + ~30% extra
  // fountain symbols gives a played-back scan real loss tolerance for a lot
  // less video length than looping the whole thing twice). ----
  async function downloadPng() {
    if (!frameValue) return;
    try {
      setExportValue(frameValue);
      // Wait for the hidden canvas to mount and paint this value before we
      // read pixels back out of it.
      await new Promise((resolve) => setTimeout(resolve, 60));
      const canvas = recordCanvasRef.current;
      if (!canvas) throw new Error("Canvas not ready");
      const url = canvas.toDataURL("image/png");
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `${meta?.name ?? "qr-frame"}.png`; anchor.click();
    } catch {
      toast.error("Couldn't export a PNG in this browser.");
    } finally {
      setExportValue(null);
    }
  }

  async function downloadVideo() {
    if (!source || !meta || recording) return;
    if (!canRecordVideo) { toast.error("This browser doesn't support recording a video (needs MediaRecorder + canvas.captureStream)."); return; }
    setRecording(true); setBakeProgress(0);
    const totalFrames = meta.chunkCount + Math.max(3, Math.ceil(meta.chunkCount * 0.3));
    const recordFps = 8;

    try {
      setExportValue(source.getFrame(0));
      await new Promise((resolve) => setTimeout(resolve, 120)); // let the first frame paint before we start capturing
      const canvas = recordCanvasRef.current;
      if (!canvas) throw new Error("Canvas not ready");

      const stream = (canvas as HTMLCanvasElement & { captureStream: (fps?: number) => MediaStream }).captureStream(recordFps);
      const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm";
      const recorder = new MediaRecorder(stream, { mimeType });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      const stopped = new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });
      recorder.start();

      let frame = 1;
      await new Promise<void>((resolve) => {
        const drawTimer = setInterval(() => {
          if (frame >= totalFrames) {
            clearInterval(drawTimer);
            setTimeout(() => { recorder.stop(); resolve(); }, 1000 / recordFps + 100);
            return;
          }
          setExportValue(source.getFrame(frame));
          setBakeProgress(Math.round((frame / totalFrames) * 100));
          frame++;
        }, 1000 / recordFps);
      });
      await stopped;

      const blob = new Blob(chunks, { type: "video/webm" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `${meta.name || "qr-transfer"}.webm`; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch {
      toast.error("Video export failed partway through — try again, or use the PNG/live camera path instead.");
    } finally {
      setRecording(false); setExportValue(null); setBakeProgress(0);
    }
  }

  const frameValue = useMemo(() => source?.getFrame(seed) ?? null, [source, seed]);

  if (status === "idle") return <section className="work-panel"><FileDrop onFiles={handleFiles} /><AudioCapture onFile={(file) => handleFiles([file])} />{error && <p className="mt-4 text-sm text-destructive">{error}</p>}<OnboardingDiagram /></section>;
  if (status === "preparing") return <section className="work-panel grid min-h-96 place-items-center"><div className="text-center"><div className="loader-grid mx-auto mb-5"/><p className="font-mono text-xs uppercase text-primary">Preparing optical frames — {Math.round(prepProgress)}%</p></div></section>;
  if (!meta || !frameValue) return null;

  const K = meta.chunkCount;
  const inSystematicPass = seed < K;
  const passProgress = Math.round((Math.min(seed + 1, K) / K) * 100);
  const redundancyCount = Math.max(0, seed - K + 1);
  // Once the systematic pass has gone by once, every source block has been
  // transmitted directly at least once — so from a "has this data been on
  // screen" standpoint, mark the whole grid done rather than pretending the
  // random combo frames map to a single visible index.
  const doneIndexes = inSystematicPass
    ? new Set(Array.from({ length: seed + 1 }, (_, index) => index))
    : new Set(Array.from({ length: K }, (_, index) => index));
  const sliderMax = Math.max(K - 1, maxSeedSeen);

  return (
    <section className="work-panel">
      {/* Off-screen canvas render, mounted only while an export is actually
          in flight — used to back the PNG/video export buttons below, since
          QRCodeSVG has no pixel buffer to capture from. */}
      <div aria-hidden="true" style={{ position: "fixed", left: -9999, top: -9999, pointerEvents: "none" }}>
        {exportValue && <QRCodeCanvas ref={recordCanvasRef} value={exportValue} size={512} level="M" includeMargin />}
      </div>
      <div className="mb-4 flex items-start justify-between gap-4 border-b border-border pb-4">
        <div>
          <p className="font-mono text-[9px] uppercase text-signal">Payload mounted · fountain coded</p>
          <h2 className="mt-1 max-w-md truncate text-base font-semibold">{meta.isBundle ? `${meta.fileCount} files / bundle` : meta.name}</h2>
          <p className="mt-1 font-mono text-[10px] text-muted-foreground">{formatBytes(meta.size)} · {meta.gz ? "gzip" : "raw"} · {K} source blocks</p>
        </div>
        <Button variant="ghost" size="sm" onClick={reset}><RotateCcw /> Reset</Button>
      </div>
      <QRStage value={frameValue} pulseSeconds={Math.max(0.15, 1 / fps)} frame={seed + 1} total={inSystematicPass ? K : K + redundancyCount} />
      <ChunkGrid total={K} doneIndexes={doneIndexes} activeIndex={inSystematicPass ? seed : undefined} />
      <div className="my-3 flex justify-between font-mono text-[10px] uppercase text-muted-foreground">
        <span>{inSystematicPass ? `Block ${seed + 1}/${K}` : `Redundancy symbol ${redundancyCount}`}</span>
        <span>{inSystematicPass ? `${passProgress}% exposed` : "self-healing pass"}</span>
        <span>~{formatBytes(meta.blockBytes * fps)}/s</span>
      </div>
      <div className="h-1 overflow-hidden bg-muted"><div className="h-full bg-primary transition-[width]" style={{ width: inSystematicPass ? `${passProgress}%` : "100%" }} /></div>
      {!inSystematicPass && <p className="mt-2 font-mono text-[9px] uppercase text-muted-foreground">First pass complete — now emitting extra fountain symbols so a receiver that missed frames keeps making progress without you scrubbing back.</p>}
      <div className="mt-5 grid grid-cols-[1fr_auto_auto] gap-2">
        <Button onClick={() => setStatus(status === "playing" ? "paused" : "playing")}><span className="inline-flex items-center gap-2">{status === "playing" ? <><Pause /> Pause sequence</> : <><Play /> {seed > 0 ? "Resume sequence" : "Start sequence"}</>}</span></Button>
        <Button variant="outline" size="icon" aria-label="Previous frame" disabled={seed === 0} onClick={() => setSeed((s) => Math.max(0, s - 1))}><SkipBack /></Button>
        <Button variant="outline" size="icon" aria-label="Next frame" onClick={() => setSeed((s) => s + 1)}><SkipForward /></Button>
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="font-mono text-[10px] uppercase text-muted-foreground">Exposure rate / {fps} fps<Slider className="mt-3" min={1} max={15} step={1} value={[fps]} onValueChange={(value) => setFps(value[0] ?? 5)} /></label>
        <label className="font-mono text-[10px] uppercase text-muted-foreground">Frame scrub / {seed + 1}<Slider className="mt-3" min={0} max={sliderMax} step={1} value={[seed]} onValueChange={(value) => { setStatus("paused"); setSeed(value[0] ?? 0); }} /></label>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-2 border-t border-border pt-5">
        <Button variant="outline" size="sm" onClick={() => void downloadPng()}><Download /> Download this frame (PNG)</Button>
        <Button variant="outline" size="sm" disabled={recording || !canRecordVideo} title={canRecordVideo ? undefined : "Not supported in this browser"} onClick={() => void downloadVideo()}>
          <Video /> {recording ? `Baking… ${bakeProgress}%` : "Download as video (.webm)"}
        </Button>
      </div>
      {recording && (
        <div className="mt-2">
          <div className="h-1 overflow-hidden bg-muted"><div className="h-full bg-primary transition-[width]" style={{ width: `${bakeProgress}%` }} /></div>
          <p className="mt-2 font-mono text-[9px] uppercase text-muted-foreground">Baking {K}+{Math.max(3, Math.ceil(K * 0.3))} fountain-coded frames into a video — anyone can scan it later off any screen, and dropped frames while scanning still self-heal.</p>
        </div>
      )}
      {!canRecordVideo && !recording && <p className="mt-2 font-mono text-[9px] uppercase text-muted-foreground">Video export needs MediaRecorder support — try a Chromium-based browser.</p>}
    </section>
  );
}
