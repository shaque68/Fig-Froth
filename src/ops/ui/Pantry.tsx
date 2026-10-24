import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { offerFor, SHELVES } from "../engine/data";
import { formatQty } from "../engine/inventory";
import { formatClock, formatDay, formatShortDate } from "../engine/orders";
import { explainReorderPoint, formatDaysLeft, formatStockDays, shelfCapacity, statusLabel, type TinSummary } from "../engine/pantry";
import type { World } from "../engine/sim";
import { TinGraphic } from "./Tin";

export type Drain = { key: number; usage: Record<string, number> };

function statusClass(tin: TinSummary) {
  return `status-${tin.status}${tin.onOrder > 0 && tin.status !== "ok" ? " status-on-order" : ""}`;
}

/** Show the use-by date on the tin only when a batch expires within a week. */
function useBySoon(tin: TinSummary, world: World): boolean {
  return tin.nextUseByDay !== null && tin.nextUseByDay - world.day <= 7;
}

function TinCard({ tin, world, drain, drainIndex, onOpen }: { tin: TinSummary; world: World; drain: Drain | null; drainIndex?: number; onOpen: () => void }) {
  const capacity = Math.max(1, shelfCapacity(world, tin.ingredient));
  const drained = drain && drainIndex !== undefined ? drain.usage[tin.ingredient.id] : undefined;
  return (
    <button className={`tin-card ${statusClass(tin)} ${drained ? "is-draining" : ""}`} onClick={onOpen} aria-label={`${tin.ingredient.name}: ${formatStockDays(tin.daysLeft)}${useBySoon(tin, world) ? `, use by ${formatDay(tin.nextUseByDay!)}` : ""}, ${statusLabel(tin)}. Show details.`}>
      <span className="tin-art">
        <TinGraphic id={tin.ingredient.id} vessel={tin.ingredient.vessel} color={tin.ingredient.color} fill={tin.fill} reorderLine={tin.reorderPoint / capacity} drainIndex={drainIndex} />
        {drained && drain && <span key={drain.key} className="drain-label" style={{ animationDelay: `${(drainIndex ?? 0) * 110}ms` }}>−{formatQty(tin.ingredient.id, drained)}</span>}
      </span>
      <span className="tin-name">{tin.ingredient.name}</span>
      <span className="tin-days">{Number.isFinite(tin.daysLeft) && tin.daysLeft >= 1 ? <><strong>{formatDaysLeft(tin.daysLeft)}</strong><small>of stock</small></> : <strong>{formatStockDays(tin.daysLeft)}</strong>}</span>
      {useBySoon(tin, world) && <span className="tin-useby">Use by {formatShortDate(tin.nextUseByDay!)}</span>}
      <span className="tin-status">{statusLabel(tin)}</span>
    </button>
  );
}

export function Pantry({ tins, world, drain, onOpen }: { tins: TinSummary[]; world: World; drain: Drain | null; onOpen: (id: string) => void }) {
  const drainOrder = drain ? Object.keys(drain.usage) : [];
  return (
    <div className="pantry">
      {SHELVES.map((shelf) => (
        <section key={shelf.id} className="shelf" aria-label={shelf.name} style={{ "--span": tins.filter((tin) => tin.ingredient.shelf === shelf.id).length } as React.CSSProperties}>
          <h3 className="shelf-name">{shelf.name}</h3>
          <div className="shelf-row">
            {tins.filter((tin) => tin.ingredient.shelf === shelf.id).map((tin) => {
              const index = drainOrder.indexOf(tin.ingredient.id);
              return <TinCard key={tin.ingredient.id} tin={tin} world={world} drain={drain} drainIndex={index >= 0 ? index : undefined} onOpen={() => onOpen(tin.ingredient.id)} />;
            })}
          </div>
          <div className="shelf-plank" aria-hidden="true" />
        </section>
      ))}
      <p className="pantry-legend"><span className="legend-line" aria-hidden="true" /> Dashed line: reorder point. Days of stock: how long each item lasts at today’s pace. Use-by dates show when a batch expires within a week.</p>
    </div>
  );
}

export function TinDetail({ tin, world, onClose }: { tin: TinSummary; world: World; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); previous?.focus(); };
  }, [onClose]);
  const capacity = Math.max(1, shelfCapacity(world, tin.ingredient));
  return (
    <div className="ops-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="ops-dialog tin-detail" role="dialog" aria-modal="true" aria-labelledby="tin-detail-title">
        <button ref={closeRef} className="ops-dialog-close" onClick={onClose} aria-label="Close details"><X size={18} /></button>
        <div className="tin-detail-head">
          <TinGraphic id={`${tin.ingredient.id}-detail`} vessel={tin.ingredient.vessel} color={tin.ingredient.color} fill={tin.fill} reorderLine={tin.reorderPoint / capacity} size={84} />
          <div>
            <p className="ops-eyebrow">{statusLabel(tin)}</p>
            <h2 id="tin-detail-title">{tin.ingredient.name}</h2>
            <p className="tin-detail-stats"><strong>{formatQty(tin.ingredient.id, tin.onHand)}</strong> on the shelf · lasts <strong>{Number.isFinite(tin.daysLeft) ? (tin.daysLeft < 1 ? "under a day" : `about ${formatDaysLeft(tin.daysLeft)}`) : "a long while"}</strong> at today’s pace{tin.nextUseByDay !== null && <> · oldest batch use by <strong>{formatDay(tin.nextUseByDay)}</strong></>}</p>
          </div>
        </div>
        <p className="tin-detail-why">{explainReorderPoint(tin)}</p>
        <dl className="tin-detail-facts">
          <div><dt>Product</dt><dd>{offerFor(tin.supplier, tin.ingredient.id)?.brand ?? "—"}</dd></div>
          <div><dt>Supplier</dt><dd>{tin.supplier.name}</dd></div>
          <div><dt>Delivery time</dt><dd>{tin.supplier.leadDays} {tin.supplier.leadDays === 1 ? "day" : "days"}</dd></div>
          <div><dt>Used per day</dt><dd>{formatQty(tin.ingredient.id, Math.round(tin.usagePerDay))}</dd></div>
          <div><dt>Stays fresh</dt><dd>{tin.ingredient.freshnessDays ? `${tin.ingredient.freshnessDays} days` : "Doesn't expire"}</dd></div>
          {tin.onOrder > 0 && <div><dt>On order</dt><dd>{formatQty(tin.ingredient.id, tin.onOrder)} ({tin.openOrders.map((po) => po.id).join(", ")})</dd></div>}
        </dl>
        <h3>Batches on the shelf <span>(used oldest first)</span></h3>
        {tin.batches.length === 0 ? <p className="ops-muted">Nothing left on the shelf.</p> : (
          <table className="ops-table">
            <thead><tr><th scope="col">Amount</th><th scope="col">Arrived</th><th scope="col">Use by</th></tr></thead>
            <tbody>
              {tin.batches.map((batch) => (
                <tr key={batch.id}>
                  <td>{formatQty(tin.ingredient.id, batch.qty)}</td>
                  <td>{formatDay(batch.receivedDay)}</td>
                  <td>{batch.expiresDay === null ? "—" : batch.expiresDay < world.day + 3 ? <strong className="text-warn">{formatDay(batch.expiresDay)}</strong> : formatDay(batch.expiresDay)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="ops-fineprint">As of {formatDay(world.day)}, {formatClock(world.minute)}</p>
      </div>
    </div>
  );
}
