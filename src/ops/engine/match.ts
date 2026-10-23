// Three-way match: what we ordered, what arrived, and what the supplier billed should all agree.
// Receipts and invoices are simulated from the seed, with a few deliberate mismatches.
import { getIngredient, getSupplier } from "./data.ts";
import { packPhrase } from "./purchasing.ts";
import { formatCents } from "./money.ts";
import { streamFor } from "./random.ts";
import { addLog, type PurchaseOrder, type World } from "./sim.ts";

/** What showed up at the door. Occasionally a supplier ships one pack short. */
export function simulateReceipt(world: World, po: PurchaseOrder): Array<{ ingredientId: string; packs: number }> {
  const rng = streamFor(world.seed, "receipt", po.id);
  const shortLine = rng.chance(0.08) ? po.lines.filter((line) => line.packs >= 2)[0] : undefined;
  return po.lines.map((line) => ({ ingredientId: line.ingredientId, packs: line === shortLine ? line.packs - 1 : line.packs }));
}

/** The supplier's bill. Usually right; sometimes it bills for what was ordered, a higher price, or shipping. */
export function simulateInvoice(world: World, po: PurchaseOrder): NonNullable<PurchaseOrder["invoice"]> {
  const rng = streamFor(world.seed, "invoice", po.id);
  const priceSlip = rng.chance(0.07) ? po.lines[rng.int(0, po.lines.length - 1)] : undefined;
  const shippingSlip = po.shippingCents === 0 && rng.chance(0.05);
  const lines = po.lines.map((line) => {
    // Suppliers bill for what they believe they shipped: the ordered amount.
    const packPriceCents = line === priceSlip ? Math.round(line.packPriceCents * (1 + 0.03 + rng.next() * 0.05)) : line.packPriceCents;
    return { ingredientId: line.ingredientId, packs: line.packs, packPriceCents };
  });
  const shippingCents = shippingSlip ? getSupplier(po.supplierId).shippingCents : po.shippingCents;
  return { lines, shippingCents, totalCents: lines.reduce((sum, line) => sum + line.packs * line.packPriceCents, 0) + shippingCents };
}

export type MatchResult = { ok: boolean; notes: string[]; overchargeCents: number };

/** Compares ordered, received, and billed quantities and prices, line by line. */
export function threeWayMatch(po: PurchaseOrder): MatchResult {
  const notes: string[] = [];
  let overchargeCents = 0;
  const receipt = po.receipt ?? [];
  const invoice = po.invoice;
  if (!invoice) return { ok: false, notes: ["No invoice yet."], overchargeCents: 0 };
  for (const line of po.lines) {
    const name = getIngredient(line.ingredientId).name;
    const received = receipt.find((item) => item.ingredientId === line.ingredientId)?.packs ?? 0;
    const billed = invoice.lines.find((item) => item.ingredientId === line.ingredientId);
    if (!billed) { notes.push(`${name}: not on the invoice.`); continue; }
    if (billed.packs > received) {
      const extra = (billed.packs - received) * billed.packPriceCents;
      overchargeCents += extra;
      notes.push(`Billed for ${packPhrase(billed.packs, line.packLabel, name)}, but only ${received} arrived: ${formatCents(extra)} too much.`);
    } else if (received < line.packs) {
      notes.push(`${name}: ${line.packs - received} short, but not billed for them.`);
    }
    if (billed.packPriceCents !== line.packPriceCents) {
      const extra = (billed.packPriceCents - line.packPriceCents) * billed.packs;
      overchargeCents += extra;
      notes.push(`${name} billed at ${formatCents(billed.packPriceCents)} each instead of the agreed ${formatCents(line.packPriceCents)}: ${formatCents(extra)} more.`);
    }
  }
  if (invoice.shippingCents !== po.shippingCents) {
    overchargeCents += invoice.shippingCents - po.shippingCents;
    notes.push(`Charged ${formatCents(invoice.shippingCents)} shipping on an order that qualified for free shipping.`);
  }
  const mismatches = notes.filter((note) => !note.includes("not billed for them"));
  return { ok: mismatches.length === 0, notes, overchargeCents };
}

/** Runs when an order arrives: the invoice comes in and is checked against the order and the receipt. */
export function invoiceAndMatch(world: World, po: PurchaseOrder): void {
  po.invoice = simulateInvoice(world, po);
  po.status = "invoiced";
  const result = threeWayMatch(po);
  po.matchNotes = result.ok ? ["Ordered, received, and billed all agree.", ...result.notes] : result.notes;
  if (result.ok) {
    po.status = "matched";
    addLog(world, "agent", `${po.id} invoice matches`, `Ordered, received, and billed agree (${formatCents(po.invoice.totalCents)}).`, po.id);
  } else {
    po.status = "flagged";
    addLog(world, "agent", `${po.id} invoice flagged for review`, `${result.notes.join(" ")} Not paid until a person reviews it.`, po.id);
  }
}

export function resolveInvoice(world: World, poId: string, decision: "accept" | "dispute"): boolean {
  const po = world.purchaseOrders.find((candidate) => candidate.id === poId);
  if (!po || po.status !== "flagged" || !po.invoice) return false;
  const result = threeWayMatch(po);
  po.status = decision === "accept" ? "matched" : "disputed";
  po.matchNotes = [...(po.matchNotes ?? []), decision === "accept" ? "You accepted the invoice as billed." : `You disputed ${formatCents(result.overchargeCents)} with the supplier (simulated).`];
  addLog(world, "you", decision === "accept" ? `You accepted the ${po.id} invoice as billed` : `You disputed the ${po.id} invoice`, decision === "accept" ? `${formatCents(po.invoice.totalCents)} approved for payment.` : `Asked ${getSupplier(po.supplierId).name} to correct ${formatCents(result.overchargeCents)} (simulated; nothing is sent).`, po.id);
  return true;
}
