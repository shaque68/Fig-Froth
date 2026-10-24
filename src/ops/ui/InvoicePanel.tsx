import { getIngredient, getSupplier } from "../engine/data";
import { formatCents } from "../engine/money";
import { formatDay } from "../engine/orders";
import type { PurchaseOrder, World } from "../engine/sim";
import { MessageSquareWarning } from "lucide-react";
import { PO_STATUS_LABEL, type WriteRequest } from "./PoCard";

function MatchTable({ po }: { po: PurchaseOrder }) {
  return (
    <table className="ops-table match-table">
      <thead><tr><th scope="col">Item</th><th scope="col" className="num">Ordered</th><th scope="col" className="num">Arrived</th><th scope="col" className="num">Billed</th><th scope="col" className="num">Price billed</th></tr></thead>
      <tbody>
        {po.lines.map((line) => {
          const received = po.receipt?.find((item) => item.ingredientId === line.ingredientId)?.packs ?? 0;
          const billed = po.invoice?.lines.find((item) => item.ingredientId === line.ingredientId);
          const qtyOff = billed && billed.packs !== received;
          const priceOff = billed && billed.packPriceCents !== line.packPriceCents;
          return (
            <tr key={line.ingredientId}>
              <th scope="row">{getIngredient(line.ingredientId).name}</th>
              <td className="num">{line.packs}</td>
              <td className={`num ${received < line.packs ? "is-off" : ""}`}>{received}</td>
              <td className={`num ${qtyOff ? "is-off" : ""}`}>{billed?.packs ?? "—"}</td>
              <td className={`num ${priceOff ? "is-off" : ""}`}>{billed ? formatCents(billed.packPriceCents) : "—"}{priceOff && <small> (agreed {formatCents(line.packPriceCents)})</small>}</td>
            </tr>
          );
        })}
        <tr>
          <th scope="row">Shipping</th><td className="num" colSpan={2}>{po.shippingCents === 0 ? "Free" : formatCents(po.shippingCents)}</td>
          <td className={`num ${po.invoice && po.invoice.shippingCents !== po.shippingCents ? "is-off" : ""}`} colSpan={2}>{po.invoice ? (po.invoice.shippingCents === 0 ? "Free" : formatCents(po.invoice.shippingCents)) : "—"}</td>
        </tr>
      </tbody>
    </table>
  );
}

export function InvoicePanel({ world, onResolve, onWrite }: { world: World; onResolve: (id: string, decision: "accept" | "dispute") => void; onWrite?: WriteRequest }) {
  const checked = [...world.purchaseOrders].reverse().filter((po) => po.invoice);
  const flagged = checked.filter((po) => po.status === "flagged");
  const settled = checked.filter((po) => po.status !== "flagged");
  const mismatches = checked.filter((po) => po.status === "flagged" || po.status === "disputed" || (po.matchNotes ?? []).some((note) => note.includes("accepted")));
  const takeaway = checked.length === 0
    ? "No invoices yet. They arrive with each delivery and are checked against the order and what actually showed up."
    : `${checked.length} ${checked.length === 1 ? "invoice" : "invoices"} checked; ${mismatches.length === 0 ? "all matched" : `${mismatches.length} didn’t match and ${flagged.length === 0 ? "were reviewed by you" : `${flagged.length} ${flagged.length === 1 ? "is" : "are"} waiting for your review`}`}.`;
  return (
    <div className="invoices">
      <p className="compare-takeaway">{takeaway}</p>
      <p className="ops-muted compare-sub">Three-way match: what we ordered, what arrived, and what the supplier billed should all agree. Anything that doesn’t is held for your review.</p>
      {flagged.map((po) => (
        <article key={po.id} className="match-card is-flagged">
          <header className="po-head"><div><h3>{po.id} · {getSupplier(po.supplierId).name}</h3><p className="po-dates">Arrived {formatDay(po.receivedDay ?? po.arrivalDay)} · billed {formatCents(po.invoice!.totalCents)} vs ordered {formatCents(po.totalCents)}</p></div><span className="po-status po-status-flagged">Needs review</span></header>
          <ul className="po-match is-flagged">{(po.matchNotes ?? []).map((note, index) => <li key={index}>{note}</li>)}</ul>
          <MatchTable po={po} />
          <div className="po-actions">
            <button className="ops-button ops-button-primary" onClick={() => onResolve(po.id, "dispute")}>Dispute with supplier</button>
            <button className="ops-button" onClick={() => onResolve(po.id, "accept")}>Accept as billed</button>
            {onWrite && <button className="ops-button" onClick={() => onWrite("dispute", po.id)}><MessageSquareWarning size={16} /> Draft dispute message</button>}
          </div>
        </article>
      ))}
      {settled.length > 0 && (
        <table className="ops-table invoice-list">
          <thead><tr><th scope="col">Order</th><th scope="col">Supplier</th><th scope="col">Arrived</th><th scope="col" className="num">Billed</th><th scope="col">Result</th></tr></thead>
          <tbody>
            {settled.map((po) => (
              <tr key={po.id}>
                <th scope="row">{po.id}</th>
                <td>{getSupplier(po.supplierId).name}</td>
                <td>{po.receivedDay !== undefined ? formatDay(po.receivedDay) : "—"}</td>
                <td className="num">{formatCents(po.invoice!.totalCents)}</td>
                <td><span className={`po-status po-status-${po.status}`}>{PO_STATUS_LABEL[po.status]}</span> <span className="ops-muted">{(po.matchNotes ?? [])[0]}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
