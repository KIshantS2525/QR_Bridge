export function ChunkGrid({ total, doneIndexes, activeIndex }: { total: number; doneIndexes: Set<number>; activeIndex?: number | undefined }) {
  const visible = Math.min(total, 240);
  return (
    <div className="contact-sheet" aria-label={`${doneIndexes.size} of ${total} chunks processed`}>
      {Array.from({ length: visible }, (_, index) => (
        <span key={index} className={`chunk-cell ${index === activeIndex ? "chunk-cell-active" : doneIndexes.has(index) ? "chunk-cell-done" : ""}`} />
      ))}
      {total > visible && <span className="col-span-full mt-1 font-mono text-[9px] text-muted-foreground">+ {total - visible} more frames</span>}
    </div>
  );
}
