import { Aperture, FileArchive, MonitorUp, ScanLine } from "lucide-react";
const steps = [
  { icon: FileArchive, label: "Compress" },
  { icon: Aperture, label: "Encode" },
  { icon: MonitorUp, label: "Display" },
  { icon: ScanLine, label: "Capture" },
];
export function OnboardingDiagram() {
  return (
    <div className="mt-7 border-t border-border pt-6">
      <div className="relative grid grid-cols-4 gap-2">
        <svg className="absolute left-[9%] top-5 h-3 w-[82%] overflow-visible text-primary" viewBox="0 0 400 12" preserveAspectRatio="none" aria-hidden="true"><path className="sketch-path" d="M0 7c48-5 89 2 136-1 68-5 119 4 180-1 27-2 55-1 84 0" /></svg>
        {steps.map(({ icon: Icon, label }, index) => (
          <div key={label} className="relative z-10 flex flex-col items-center gap-2">
            <span className="grid size-10 place-items-center border border-border bg-background shadow-sm"><Icon className="size-4 text-primary" /></span>
            <span className="font-mono text-[9px] uppercase text-muted-foreground">0{index + 1} / {label}</span>
          </div>
        ))}
      </div>
      <p className="mx-auto mt-5 max-w-md text-center text-xs leading-5 text-muted-foreground">Screen becomes transmitter. Camera becomes receiver. The air gap stays entirely offline.</p>
    </div>
  );
}
