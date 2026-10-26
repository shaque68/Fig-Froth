import { useEffect, useRef, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { buildSnapshot, demoBrief, demoDisputeMessage, demoExplanation, demoPromoPost, demoSupplierMessage, type PromoPost, type WritingKind } from "../engine/brief";
import type { World } from "../engine/sim";

export type Written = { text: string; source: "claude" | "demo"; notice?: string };

/** Demo mode always uses templates. Claude mode asks the local server and falls back to templates on any failure. */
export async function writeText(kind: WritingKind, world: World, claudeMode: boolean, poId?: string, promo?: PromoPost): Promise<Written> {
  const po = poId ? world.purchaseOrders.find((candidate) => candidate.id === poId) : undefined;
  const template = kind === "brief" ? demoBrief(world)
    : kind === "promo" ? demoPromoPost(world, promo!)
    : kind === "explain" ? demoExplanation(po!)
    : kind === "dispute" ? demoDisputeMessage(po!)
    : demoSupplierMessage(po!);
  if (!claudeMode) return { text: template, source: "demo" };
  try {
    const response = await fetch("/api/ops/claude/write", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, snapshot: buildSnapshot(world, poId, promo) }),
    });
    const result = await response.json() as { text?: string; error?: string };
    if (!response.ok || !result.text) return { text: template, source: "demo", notice: result.error ?? "Claude mode isn’t available. Showing the standard version." };
    return { text: result.text, source: "claude" };
  } catch {
    return { text: template, source: "demo", notice: "Couldn’t reach the local server. Showing the standard version." };
  }
}

export function SourceTag({ written }: { written: Written }) {
  return <span className={`source-tag source-${written.source}`}>{written.source === "claude" ? <><Sparkles size={13} aria-hidden="true" /> Written by Claude</> : "Standard"}</span>;
}

export function MorningBrief({ world, claudeMode }: { world: World; claudeMode: boolean }) {
  const [written, setWritten] = useState<Written & { day: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const current = written && written.day === world.day && (written.source === "claude" || !claudeMode) ? written : null;
  const shown: Written = current ?? { text: demoBrief(world), source: "demo" };
  async function ask() {
    setBusy(true);
    const result = await writeText("brief", world, true);
    setWritten({ ...result, day: world.day });
    setBusy(false);
  }
  return (
    <section className="ops-panel brief-panel" aria-labelledby="brief-title">
      <div className="brief-head">
        <h2 id="brief-title" className="ops-side-title">Morning brief</h2>
        <SourceTag written={shown} />
      </div>
      <p className="brief-text">{shown.text}</p>
      {written?.notice && written.day === world.day && <p className="writer-notice" role="status">{written.notice}</p>}
      {claudeMode && <button className="ops-button" onClick={ask} disabled={busy}><Sparkles size={16} /> {busy ? "Claude is writing…" : "Write today’s brief with Claude"}</button>}
    </section>
  );
}

export function WritingDialog({ title, written, busy, kind, onClose }: { title: string; written: Written | null; busy: boolean; kind: WritingKind; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); previous?.focus(); };
  }, [onClose]);
  return (
    <div className="ops-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="ops-dialog writing-dialog" role="dialog" aria-modal="true" aria-labelledby="writing-title">
        <button ref={closeRef} className="ops-dialog-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        <h2 id="writing-title">{title}</h2>
        {busy || !written ? <p className="ops-muted" role="status">Claude is writing…</p> : <>
          <SourceTag written={written} />
          <p className="writing-text">{written.text}</p>
          {written.notice && <p className="writer-notice" role="status">{written.notice}</p>}
          {(kind === "supplier-message" || kind === "dispute") && <p className="ops-fineprint">Draft only. Copy it into your email to send.</p>}
          {kind === "promo" && <p className="ops-fineprint">Draft only. Copy it into Instagram or your text list to send.</p>}
        </>}
      </div>
    </div>
  );
}
