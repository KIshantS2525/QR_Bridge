export function ScanReticle({ locked }: { locked: boolean }) {
  return (
    <div className={`scan-reticle ${locked ? "scan-reticle-locked" : ""}`} aria-hidden="true">
      <i className="left-0 top-0 border-l-2 border-t-2" /><i className="right-0 top-0 border-r-2 border-t-2" />
      <i className="bottom-0 left-0 border-b-2 border-l-2" /><i className="bottom-0 right-0 border-b-2 border-r-2" />
      <span className="scan-line" />
    </div>
  );
}
