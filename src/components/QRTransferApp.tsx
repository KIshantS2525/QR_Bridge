import { useState } from "react";
import { Box, Camera, Send, ShieldCheck, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { Encoder } from "./qr/Encoder";
import { Decoder } from "./qr/Decoder";
import { OpticalScene } from "./OpticalScene";
import { isMuted, toggleMuted } from "@/lib/sound";

export function QRTransferApp() {
  const [mode, setMode] = useState<"send" | "receive">("send");
  const [muted, setMuted] = useState(() => isMuted());
  return (
    <main className="relative isolate min-h-screen overflow-hidden px-4 py-5 sm:px-7 lg:px-10">
      <Toaster position="bottom-center" />
      <OpticalScene />
      <div className="blueprint-grid pointer-events-none fixed inset-0 -z-20" />
      <div className="mx-auto max-w-6xl">
        <header className="flex items-center justify-between border-b border-border pb-4">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center border border-foreground bg-foreground text-background shadow-block"><Box className="size-5" /></div>
            <div><p className="font-mono text-[9px] uppercase text-signal">Optical utility / POC 01</p><p className="text-sm font-semibold">QR File Transfer</p></div>
          </div>
          <div className="flex items-center gap-3"><span className="hidden items-center gap-2 font-mono text-[9px] uppercase text-muted-foreground sm:flex"><i className="size-1.5 animate-pulse rounded-full bg-success" /> entirely offline</span><Button variant="outline" size="icon" aria-label={muted ? "Unmute scan sounds" : "Mute scan sounds"} onClick={() => setMuted(toggleMuted())}>{muted ? <VolumeX /> : <Volume2 />}</Button></div>
        </header>

        <div className="grid items-end gap-8 py-9 lg:grid-cols-[1fr_460px] lg:py-12">
          <div className="relative max-w-2xl">
            <p className="mb-4 font-mono text-[10px] uppercase text-primary">Screen → air → camera</p>
            <h1 className="text-balance text-5xl font-semibold leading-[0.92] tracking-normal sm:text-7xl">Move files<br/><span className="text-primary">through light.</span></h1>
            <svg className="sketch-underline mt-3 h-5 w-72 text-signal sm:w-96" viewBox="0 0 400 22" aria-hidden="true"><path d="M4 14c64-12 119 3 188-4 72-8 133 5 203-3" /></svg>
            <p className="mt-5 max-w-lg text-base leading-7 text-muted-foreground">No WiFi, Bluetooth, or cable. Your screen broadcasts compressed data as animated QR frames; another camera rebuilds and verifies every byte.</p>
          </div>
          <div className="grid grid-cols-3 border border-border bg-surface/80 shadow-lift backdrop-blur-sm">
            {[{ n: "01", t: "Gzip" }, { n: "02", t: "QR frames" }, { n: "03", t: "SHA-256" }].map((item) => <div key={item.n} className="border-r border-border p-4 last:border-r-0"><p className="font-mono text-[9px] text-signal">{item.n}</p><p className="mt-3 text-xs font-semibold uppercase">{item.t}</p></div>)}
          </div>
        </div>

        <div className="mx-auto max-w-3xl">
          <nav className="mb-3 grid grid-cols-2 border border-border bg-background/90 p-1 shadow-sm" aria-label="Transfer direction">
            <Button variant={mode === "send" ? "default" : "ghost"} className="h-11 rounded-none" onClick={() => setMode("send")}><Send /> Send from this screen</Button>
            <Button variant={mode === "receive" ? "default" : "ghost"} className="h-11 rounded-none" onClick={() => setMode("receive")}><Camera /> Receive with camera</Button>
          </nav>
          {mode === "send" ? <Encoder /> : <Decoder />}
        </div>

        <footer className="mx-auto mt-8 flex max-w-3xl flex-col gap-3 border-t border-border py-5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>Proof of concept · best for small files and patient cameras.</p>
          <p className="flex items-center gap-2 font-mono text-[9px] uppercase"><ShieldCheck className="size-4 text-success" /> Byte-for-byte verification</p>
        </footer>
      </div>
    </main>
  );
}
