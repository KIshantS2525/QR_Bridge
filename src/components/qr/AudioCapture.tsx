import { useEffect, useRef, useState } from "react";
import { Check, Mic, Square, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

const MAX_SECONDS = 300; // 5 min — long enough for a real voice note, short enough to keep K sane
const canRecordAudio = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof window !== "undefined" && "MediaRecorder" in window;

// Ported from QR_Bridge's audio tab: record straight from the mic, preview
// it, then hand the resulting Blob off as a regular File so it flows through
// the exact same fountain-coded pipeline as any other upload — no separate
// "audio mode" needed on the wire.
export function AudioCapture({ onFile }: { onFile: (file: File) => void }) {
  const [recording, setRecording] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const blobRef = useRef<Blob | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function start() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        blobRef.current = blob;
        setPreviewUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach((track) => track.stop());
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
      setSeconds(0);
      timerRef.current = setInterval(() => {
        setSeconds((s) => {
          if (s + 1 >= MAX_SECONDS) {
            toast.warning(`Stopped automatically at ${Math.round(MAX_SECONDS / 60)} minutes.`);
            stop();
            return MAX_SECONDS;
          }
          return s + 1;
        });
      }, 1000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Microphone access denied or unavailable");
    }
  }

  function stop() {
    recorderRef.current?.stop();
    setRecording(false);
    if (timerRef.current) clearInterval(timerRef.current);
  }

  function discard() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    blobRef.current = null;
    setSeconds(0);
  }

  function use() {
    if (!blobRef.current) return;
    onFile(new File([blobRef.current], `voice-note-${Date.now()}.webm`, { type: "audio/webm" }));
    discard();
  }

  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");

  return (
    <div className="mt-4 flex flex-col gap-3 border border-dashed border-border bg-surface/50 p-4">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase text-muted-foreground">Or record a voice clip</p>
        {recording && <span className="font-mono text-[10px] text-destructive">{mm}:{ss}</span>}
      </div>
      {previewUrl ? (
        <div className="flex flex-wrap items-center gap-2">
          <audio className="h-9 min-w-0 flex-1" controls src={previewUrl} />
          <Button size="sm" onClick={use}><Check /> Use clip</Button>
          <Button size="sm" variant="ghost" aria-label="Discard clip" onClick={discard}><Trash2 /></Button>
        </div>
      ) : canRecordAudio ? (
        <Button size="sm" variant={recording ? "destructive" : "outline"} onClick={recording ? stop : start}>
          {recording ? <><Square /> Stop recording</> : <><Mic /> Record from microphone</>}
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">Microphone recording isn't supported in this browser.</p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
