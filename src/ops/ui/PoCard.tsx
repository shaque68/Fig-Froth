import { Check, X } from "lucide-react";
import { getIngredient, getSupplier } from "../engine/data";
import { formatQty } from "../engine/inventory";
import { formatCents } from "../engine/money";
import { formatDay } from "../engine/orders";
import type { PoStatus, PurchaseOrder } from "../engine/sim";

export const PO_STATUS_LABEL: Record<PoStatus, string> = {
  draft: "Draft",
  awaiting: "Awaiting approval",
  approved: "Approved",
  sent: "Sent (simulated)",
  received: "Received",
  invoiced: "Invoiced",
  matched: "Matched",
  flagged: "Needs review",
  disputed: "Disputed",
  rejected: "Rejected",
};

const ROLE_LABEL = { needed: "", "pulled-forward": "ships early", "top-up": "free-shipping top-up", backup: "backup" } as const;

function arrivalText(po: PurchaseOrder, today: number) {
  if (po.status === "awaiting") return "Waiting for your approval";
  if (po.status === "rejected") return "Not sent";
  if (po.receivedDay !== undefined) return `Arrived ${formatDay(po.receivedDay)}${po.receivedDay > po.promisedDay ? ` · ${po.receivedDay - po.promisedDay} days late` : ""}`;
  if (po.promisedDay < today) return `Late: was due ${formatDay(po.promisedDay)}`;
  return `Due ${formatDay(po.promisedDay)}`;
}

export function PoCard({ po, today, onApprove, onReject, defaultOpen = false }: { po: PurchaseOrder; today: number; onApprove?: (id: string) => void; onReject?: (id: string) => void; defaultOpen?: boolean }) {
  const supplier = getSupplier(po.supplierId);
  const totalSavings = po.savings.bulkCents + po.savings.shippingAvoidedCents;
  return (
    <article className={`po-card po-${po.status}`} aria-labelledby={`${po.id}-title`}>
      <header className="po-head">
        <div>
          <h3 id={`${po.id}-title`}>{po.id} · {supplier.name}</h3>
          <p className="po-dates">Drafted {formatDay(po.createdDay)} · {arrivalText(po, today)}</p>
        </div>
        <span className={`po-status po-status-${po.status}`}>{PO_STATUS_LABEL[po.status]}</span>
      </header>
      <table className="ops-table po-lines">
        <thead><tr><th scope="col">Item</th><th scope="col" className="num">Each</th><th scope="col" className="num">Total</th></tr></thead>
        <tbody>
          {po.lines.map((line) => (
            <tr key={line.ingredientId}>
              <td>
                <strong className="po-line-name">{getIngredient(line.ingredientId).name}</strong>
                {ROLE_LABEL[line.role] && <span className="po-role">{ROLE_LABEL[line.role]}</span>}
                <span className="po-line-qty">{line.packs} × {line.packLabel} · {formatQty(line.ingredientId, line.packs * line.packSize)}</span>
              </td>
              <td className="num">{formatCents(line.packPriceCents)}{line.packPriceCents < line.basePackPriceCents && <del>{formatCents(line.basePackPriceCents)}</del>}</td>
              <td className="num">{formatCents(line.totalCents)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr><td colSpan={2}>Shipping</td><td className="num">{po.shippingCents === 0 ? "Free" : formatCents(po.shippingCents)}</td></tr>
          <tr className="po-total"><td colSpan={2}>Total</td><td className="num">{formatCents(po.totalCents)}</td></tr>
        </tfoot>
      </table>
      {totalSavings > 0 && (
        <p className="po-savings">
          <strong>Saved {formatCents(totalSavings)}</strong>
          {po.savings.bulkCents > 0 && <span>Bulk discount {formatCents(po.savings.bulkCents)}</span>}
          {po.savings.shippingAvoidedCents > 0 && <span>Shipping avoided {formatCents(po.savings.shippingAvoidedCents)}</span>}
        </p>
      )}
      <details className="po-why" open={defaultOpen}>
        <summary>Why this order?</summary>
        <ul>
          {po.reasons.map((reason, index) => (
            <li key={index}><span className="po-rule">{reason.rule}</span>{reason.text}</li>
          ))}
        </ul>
      </details>
      {po.matchNotes && po.matchNotes.length > 0 && (
        <ul className={`po-match ${po.status === "flagged" ? "is-flagged" : ""}`}>
          {po.matchNotes.map((note, index) => <li key={index}>{note}</li>)}
        </ul>
      )}
      {po.status === "awaiting" && onApprove && onReject && (
        <div className="po-actions">
          <button className="ops-button ops-button-primary" onClick={() => onApprove(po.id)}><Check size={17} /> Approve order</button>
          <button className="ops-button ops-button-danger" onClick={() => onReject(po.id)}><X size={17} /> Reject</button>
        </div>
      )}
    </article>
  );
}
