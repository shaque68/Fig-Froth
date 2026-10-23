// Words, not decisions. Demo mode writes these from templates; Claude mode asks the local server
// to write them from the same snapshot. Quantities and money always come from the engine.
import { getIngredient, getSupplier, SETTINGS } from "./data.ts";
import { formatQty } from "./inventory.ts";
import { formatCents, formatDollars } from "./money.ts";
import { formatDay } from "./orders.ts";
import { needsAttention, statusLabel, summarizePantry } from "./pantry.ts";
import { packPhrase } from "./purchasing.ts";
import { getScenario } from "./scenarios.ts";
import type { PurchaseOrder, World } from "./sim.ts";

export type WritingKind = "brief" | "explain" | "supplier-message";

const daysText = (days: number) => (!Number.isFinite(days) ? "plenty" : days < 1 ? "under a day" : `${days.toFixed(1).replace(/\.0$/, "")} days`);

/** A compact, plain-data picture of the shop for writing. Everything in it was computed by the engine. */
export function buildSnapshot(world: World, poId?: string) {
  const tins = summarizePantry(world);
  const yesterday = world.days.at(-1);
  const po = poId ? world.purchaseOrders.find((candidate) => candidate.id === poId) : undefined;
  const describePo = (order: PurchaseOrder) => ({
    id: order.id,
    supplier: getSupplier(order.supplierId).name,
    status: order.status,
    total: formatCents(order.totalCents),
    shipping: order.shippingCents === 0 ? "free" : formatCents(order.shippingCents),
    due: formatDay(order.promisedDay),
    lines: order.lines.map((line) => `${packPhrase(line.packs, line.packLabel, getIngredient(line.ingredientId).name)} at ${formatCents(line.packPriceCents)} each`),
    reasons: order.reasons.map((reason) => `${reason.rule}: ${reason.text}`),
    savings: { bulkDiscount: formatCents(order.savings.bulkCents), shippingAvoided: formatCents(order.savings.shippingAvoidedCents) },
  });
  return {
    note: "Demo with fictional, simulated data.",
    shop: "Fig & Froth, a small matcha bar",
    today: formatDay(world.day, "long"),
    weatherF: world.conditions.tempF,
    scenario: getScenario(world.scenarioId).name,
    approvalLimit: formatDollars(SETTINGS.approvalThresholdCents),
    yesterday: yesterday ? { orders: yesterday.orders, drinksMade: yesterday.drinksMade, drinksMissed: yesterday.drinksMissed, sales: formatCents(yesterday.revenueCents), thrownOut: formatCents(yesterday.wasteCents) } : null,
    needsAttention: needsAttention(tins).slice(0, 5).map((tin) => ({ item: tin.ingredient.name, onShelf: formatQty(tin.ingredient.id, tin.onHand), daysLeft: daysText(tin.daysLeft), status: statusLabel(tin) })),
    waitingForApproval: world.purchaseOrders.filter((order) => order.status === "awaiting").map(describePo),
    arrivingToday: world.purchaseOrders.filter((order) => order.receivedDay === world.day).map((order) => `${order.id} from ${getSupplier(order.supplierId).name}`),
    invoicesToReview: world.purchaseOrders.filter((order) => order.status === "flagged").map((order) => ({ id: order.id, notes: order.matchNotes ?? [] })),
    special: world.specialSuggestion?.text ?? null,
    order: po ? describePo(po) : undefined,
  };
}

export type ShopSnapshot = ReturnType<typeof buildSnapshot>;

const list = (items: string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

/** Demo-mode morning brief, written from a template. */
export function demoBrief(world: World): string {
  const snapshot = buildSnapshot(world);
  const parts: string[] = [`Good morning! It’s ${snapshot.today}, ${snapshot.weatherF}°F.`];
  if (snapshot.yesterday) {
    const missed = snapshot.yesterday.drinksMissed > 0 ? `, but ${snapshot.yesterday.drinksMissed} couldn’t be made` : ", with nothing missed";
    parts.push(`Yesterday we made ${snapshot.yesterday.drinksMade} drinks (${snapshot.yesterday.sales} in sales)${missed}.`);
  }
  if (snapshot.waitingForApproval.length > 0) {
    parts.push(`${snapshot.waitingForApproval.length === 1 ? "One order needs" : `${snapshot.waitingForApproval.length} orders need`} your approval: ${list(snapshot.waitingForApproval.map((order) => `${order.id} (${order.supplier}, ${order.total})`))}.`);
  }
  if (snapshot.arrivingToday.length > 0) parts.push(`Arrived this morning: ${list(snapshot.arrivingToday)}.`);
  const urgent = snapshot.needsAttention.filter((item) => item.status !== "Reorder soon").slice(0, 3);
  if (urgent.length > 0) parts.push(`Keep an eye on ${list(urgent.map((item) => `${item.item.toLowerCase()} (${item.daysLeft} left, ${item.status.toLowerCase()})`))}.`);
  else parts.push("Nothing on the shelf is urgent.");
  if (snapshot.invoicesToReview.length > 0) parts.push(`${snapshot.invoicesToReview.length === 1 ? "One invoice doesn’t" : `${snapshot.invoicesToReview.length} invoices don’t`} match what we ordered and received.`);
  if (snapshot.special) parts.push("There’s a “use it up” special suggestion on the Freshness tab.");
  return parts.join(" ");
}

/** Demo-mode plain-language explanation of a purchase order: a short summary of its reasons. */
export function demoExplanation(po: PurchaseOrder): string {
  const supplier = getSupplier(po.supplierId).name;
  const names = (role: string) => po.lines.filter((line) => line.role === role).map((line) => getIngredient(line.ingredientId).name.toLowerCase());
  const sentences = [`This ${formatCents(po.totalCents)} order to ${supplier} buys ${list(po.lines.map((line) => getIngredient(line.ingredientId).name.toLowerCase()))}.`];
  const low = names("needed");
  const early = names("pulled-forward");
  const backup = names("backup");
  if (backup.length > 0) sentences.push(`It’s a backup: another supplier’s delivery is late, and ${list(backup)} would run out before it arrives.`);
  if (low.length > 0) sentences.push(`${list(low).replace(/^./, (c) => c.toUpperCase())} reached the reorder point.`);
  if (early.length > 0) sentences.push(`${list(early).replace(/^./, (c) => c.toUpperCase())} would need ordering within a few days, so ${early.length === 1 ? "it ships" : "they ship"} now instead of in a second delivery.`);
  const rules = new Set(po.reasons.map((reason) => reason.rule));
  if (po.reasons.some((reason) => reason.text.startsWith("Switched to"))) sentences.push(`${supplier} was the cheapest option once shipping is included.`);
  if (rules.has("Freshness")) sentences.push("Perishables were capped so nothing spoils before we use it.");
  if (rules.has("Known orders")) sentences.push("It includes what an upcoming booked order needs.");
  const savings: string[] = [];
  if (po.savings.bulkCents > 0) savings.push(`${formatCents(po.savings.bulkCents)} from bulk prices`);
  if (po.savings.shippingAvoidedCents > 0) savings.push(`${formatCents(po.savings.shippingAvoidedCents)} in shipping`);
  if (savings.length > 0) sentences.push(`It saves ${list(savings)}.`);
  sentences.push(po.needsApproval ? `It needs a person’s OK${po.isBackup ? " because it duplicates an open order" : ` because it’s over the ${formatDollars(SETTINGS.approvalThresholdCents)} limit`}.` : "It was under the approval limit, so it went out on its own.");
  return sentences.join(" ");
}

/** Demo-mode draft message to a supplier. Never sent anywhere. */
export function demoSupplierMessage(po: PurchaseOrder): string {
  const supplier = getSupplier(po.supplierId);
  const lines = po.lines.map((line) => `- ${packPhrase(line.packs, line.packLabel, getIngredient(line.ingredientId).name)} at ${formatCents(line.packPriceCents)} each`);
  const late = po.lateNoticeDay !== undefined && !po.isBackup
    ? `\n\nWe saw that ${po.id} is running late. Could you confirm the new delivery date? We’ve arranged a backup in the meantime.`
    : "";
  return [
    `Hi ${supplier.name} team,`,
    "",
    `We’d like to place order ${po.id}:`,
    ...lines,
    "",
    `Total ${formatCents(po.totalCents)}${po.shippingCents === 0 ? " with free shipping" : `, including ${formatCents(po.shippingCents)} shipping`}. We’re hoping for delivery by ${formatDay(po.promisedDay)}.${late}`,
    "",
    "Thank you!",
    "The Fig & Froth team",
  ].join("\n");
}
