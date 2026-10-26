// Prices, guardrails, and the purchase order lifecycle.
import { SETTINGS, SUPPLIERS, getIngredient, getSupplier, offerFor, type PriceTier, type Supplier, type SupplierOffer } from "./data.ts";
import { formatQty } from "./inventory.ts";
import { formatCents } from "./money.ts";
import { invoiceAndMatch, simulateReceipt } from "./match.ts";
import { isOpenPo } from "./pantry.ts";
import { addLog, newBatch, type PoLine, type PurchaseOrder, type World } from "./sim.ts";

export function tierFor(offer: SupplierOffer, packs: number): PriceTier {
  return [...offer.tiers].reverse().find((tier) => packs >= tier.minPacks) ?? offer.tiers[0];
}

export function nextTier(offer: SupplierOffer, packs: number): PriceTier | undefined {
  return offer.tiers.find((tier) => tier.minPacks > packs);
}

/** A supplier's pack price after any scenario price change, in whole cents. */
export function adjustedPrice(world: World, supplierId: string, priceCents: number): number {
  return Math.round(priceCents * (world.effects.priceFactor[supplierId] ?? 1));
}

export function packPriceCents(world: World, supplierId: string, offer: SupplierOffer, packs: number, pricing: "tiered" | "base" = "tiered"): number {
  const tier = pricing === "base" ? offer.tiers[0] : tierFor(offer, packs);
  return adjustedPrice(world, supplierId, tier.packPriceCents);
}

export function shippingFor(supplier: Supplier, subtotalCents: number): number {
  if (subtotalCents <= 0) return 0;
  return subtotalCents >= supplier.freeShippingAtCents ? 0 : supplier.shippingCents;
}

export function makeLine(world: World, supplierId: string, ingredientId: string, packs: number, role: PoLine["role"], pricing: "tiered" | "base" = "tiered"): PoLine {
  const offer = offerFor(getSupplier(supplierId), ingredientId);
  if (!offer) throw new Error(`${supplierId} doesn't sell ${ingredientId}`);
  const packPrice = packPriceCents(world, supplierId, offer, packs, pricing);
  return {
    ingredientId,
    packs,
    packSize: offer.packSize,
    packLabel: offer.packLabel,
    brand: offer.brand,
    packPriceCents: packPrice,
    basePackPriceCents: adjustedPrice(world, supplierId, offer.tiers[0].packPriceCents),
    totalCents: packPrice * packs,
    role,
  };
}

const pluralWord = (word: string) => (/(ch|sh|x|s)$/.test(word) ? `${word}es` : `${word}s`);

/** "2 sleeves of Dart lids", "18 gallon jugs of Horizon Organic whole milk", "5 bottles (1 L each) of Monin mango purée". */
export function packPhrase(count: number, packLabel: string, ingredientName: string, brand?: string): string {
  const [unit] = packLabel.split(" of ");
  const sized = unit.match(/^([\d.]+ (?:g|kg|ml|L)) (.+)$/);
  const noun = sized ? sized[2] : unit;
  const words = noun.split(" ");
  if (count !== 1) words[words.length - 1] = pluralWord(words[words.length - 1]);
  const size = sized ? ` (${sized[1]}${count === 1 ? "" : " each"})` : "";
  const product = brand && brand !== "Unbranded" ? `${brand} ${ingredientName.toLowerCase()}` : ingredientName.toLowerCase();
  return `${count} ${words.join(" ")}${size} of ${product}`;
}

export function describeLine(line: PoLine): string {
  return `${packPhrase(line.packs, line.packLabel, getIngredient(line.ingredientId).name, line.brand)} (${formatQty(line.ingredientId, line.packs * line.packSize)})`;
}

// ── Guardrails ────────────────────────────────────────────────────────────────

export function needsApproval(totalCents: number): boolean {
  return totalCents > SETTINGS.approvalThresholdCents;
}

export function isApprovedSupplier(supplierId: string): boolean {
  return SUPPLIERS.some((supplier) => supplier.id === supplierId && supplier.approved);
}

export function openPoFor(world: World, ingredientId: string): PurchaseOrder | undefined {
  return world.purchaseOrders.find((po) => isOpenPo(po) && po.lines.some((line) => line.ingredientId === ingredientId));
}

export function weekOf(day: number): number {
  return Math.floor(day / 7);
}

/** Money already committed this week (anything not rejected counts, including orders awaiting approval). */
export function committedThisWeek(world: World, day = world.day): number {
  return world.purchaseOrders
    .filter((po) => po.status !== "rejected" && weekOf(po.createdDay) === weekOf(day))
    .reduce((sum, po) => sum + po.totalCents, 0);
}

export function cashLeftThisWeek(world: World, day = world.day): number {
  return SETTINGS.weeklyCashCapCents - committedThisWeek(world, day);
}

export type GuardrailViolation = { poId: string; rule: string; detail: string };

/** Checks every guardrail across the world. The agent should never produce a violation. */
export function checkGuardrails(world: World): GuardrailViolation[] {
  const violations: GuardrailViolation[] = [];
  for (const po of world.purchaseOrders) {
    if (!isApprovedSupplier(po.supplierId)) violations.push({ poId: po.id, rule: "approved-suppliers", detail: `${po.supplierId} isn't approved` });
    const sentWithoutApproval = po.needsApproval && !po.approvedBy && ["approved", "sent", "received", "invoiced", "matched", "flagged", "disputed"].includes(po.status);
    if (sentWithoutApproval) violations.push({ poId: po.id, rule: "approval", detail: "sent without approval" });
  }
  const open = world.purchaseOrders.filter(isOpenPo);
  for (const po of open) {
    for (const line of po.lines) {
      const duplicates = open.filter((other) => other !== po && other.lines.some((l) => l.ingredientId === line.ingredientId));
      // A backup for a late delivery is the one allowed duplicate, and only a person can send it.
      const allowed = duplicates.every((other) => (other.isBackup && (other.status === "awaiting" || other.approvedBy === "you")) || (po.isBackup && (po.status === "awaiting" || po.approvedBy === "you")));
      if (duplicates.length > 0 && !allowed) violations.push({ poId: po.id, rule: "no-duplicates", detail: `${line.ingredientId} is on more than one open order` });
    }
  }
  const weeks = new Set(world.purchaseOrders.map((po) => weekOf(po.createdDay)));
  for (const week of weeks) {
    const spent = world.purchaseOrders.filter((po) => po.status !== "rejected" && weekOf(po.createdDay) === week).reduce((sum, po) => sum + po.totalCents, 0);
    if (spent > SETTINGS.weeklyCashCapCents) violations.push({ poId: `week-${week}`, rule: "cash-cap", detail: `${formatCents(spent)} committed in week ${week + 1}` });
  }
  return violations;
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

export function deliveryDelay(world: World, supplierId: string, sentDay: number): number {
  return world.effects.delays
    .filter((delay) => delay.supplierId === supplierId && sentDay >= delay.fromDay && sentDay <= delay.toDay)
    .reduce((sum, delay) => sum + delay.extraDays, 0);
}

/** Marks an order as sent (simulated): it will arrive after the supplier's lead time. */
export function sendPo(world: World, po: PurchaseOrder): void {
  const supplier = getSupplier(po.supplierId);
  po.status = "sent";
  po.sentDay = world.day;
  po.promisedDay = world.day + supplier.leadDays;
  po.arrivalDay = po.promisedDay + deliveryDelay(world, po.supplierId, world.day);
}

export function approvePo(world: World, poId: string): boolean {
  const po = world.purchaseOrders.find((candidate) => candidate.id === poId);
  if (!po || po.status !== "awaiting") return false;
  po.approvedBy = "you";
  po.status = "approved";
  addLog(world, "you", `You approved ${po.id} (${formatCents(po.totalCents)})`, `${getSupplier(po.supplierId).name}. Sent to the supplier.`, po.id);
  sendPo(world, po);
  return true;
}

export function rejectPo(world: World, poId: string): boolean {
  const po = world.purchaseOrders.find((candidate) => candidate.id === poId);
  if (!po || po.status !== "awaiting") return false;
  po.status = "rejected";
  addLog(world, "you", `You rejected ${po.id}`, `${formatCents(po.totalCents)} from ${getSupplier(po.supplierId).name} won't be sent. The agent will look again tonight.`, po.id);
  return true;
}

/** Morning deliveries: anything due today arrives and goes on the shelf. */
export function receiveDeliveries(world: World): PurchaseOrder[] {
  const arriving = world.purchaseOrders.filter((po) => po.status === "sent" && po.arrivalDay <= world.day);
  for (const po of arriving) {
    po.receipt = po.receipt ?? simulateReceipt(world, po);
    for (const received of po.receipt) {
      const line = po.lines.find((candidate) => candidate.ingredientId === received.ingredientId);
      if (!line || received.packs <= 0) continue;
      world.stock[line.ingredientId].push(newBatch(world, line.ingredientId, received.packs * line.packSize, received.packs * line.packPriceCents, world.day, po.id));
    }
    po.status = "received";
    po.receivedDay = world.day;
    const late = po.arrivalDay > po.promisedDay ? ` (${po.arrivalDay - po.promisedDay} days late)` : "";
    const short = po.lines.filter((line) => (po.receipt?.find((item) => item.ingredientId === line.ingredientId)?.packs ?? 0) < line.packs);
    const shortNote = short.length > 0 ? ` Short: ${short.map((line) => getIngredient(line.ingredientId).name.toLowerCase()).join(", ")}.` : "";
    addLog(world, "system", `${po.id} arrived from ${getSupplier(po.supplierId).name}${late}`, `${po.lines.map(describeLine).join("; ")}.${shortNote}`, po.id);
    invoiceAndMatch(world, po);
  }
  return arriving;
}
