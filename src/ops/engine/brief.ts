// Words, not decisions. Demo mode writes these from templates; Claude mode asks the local server
// to write them from the same snapshot. Quantities and money always come from the engine.
import { bundlePriceCents, type PromotionKind } from "../../pricing.ts";
import { drinkById, getIngredient, getSupplier, SETTINGS } from "./data.ts";
import { formatQty } from "./inventory.ts";
import { formatCents, formatDollars } from "./money.ts";
import { formatDay } from "./orders.ts";
import { needsAttention, statusLabel, summarizePantry } from "./pantry.ts";
import { threeWayMatch } from "./match.ts";
import { currentPriceCents, promotionCopy, promotionTitle, suggestPromotions } from "./promotions.ts";
import { packPhrase } from "./purchasing.ts";
import { getScenario } from "./scenarios.ts";
import { livePromotions, type PurchaseOrder, type World } from "./sim.ts";

export type WritingKind = "brief" | "explain" | "supplier-message" | "dispute" | "promo";

/** A promotion to write marketing for: one that's live, or a suggestion at the step the owner picked. */
export type PromoPost = { kind: PromotionKind; productIds: string[]; percentOff: number };

const drinkName = (id: string) => drinkById.get(id)?.name ?? id;

/** The prices a customer would see for a promotion, and any bundle that pairs with a sale. */
function promoFacts(world: World, promo: PromoPost) {
  const names = promo.productIds.map(drinkName);
  if (promo.kind === "discount") {
    const regular = drinkById.get(promo.productIds[0])!.priceCents;
    const pairedBundle = livePromotions(world).find((live) => live.kind === "bundle" && live.productIds.includes(promo.productIds[0]));
    return {
      type: "Sale" as const,
      drinks: names,
      percentOff: promo.percentOff,
      regularPrice: formatCents(regular),
      promoPrice: formatCents(regular - Math.round((regular * promo.percentOff) / 100)),
      pairedBundle: pairedBundle ? { withDrink: drinkName(pairedBundle.productIds.find((id) => id !== promo.productIds[0])!), extraPercentOff: pairedBundle.percentOff } : null,
      storefrontBanner: promotionCopy(promo.kind, promo.productIds, promo.percentOff).headline,
    };
  }
  const regular = promo.productIds.reduce((sum, id) => sum + drinkById.get(id)!.priceCents, 0);
  const [first, second] = promo.productIds.map((id) => currentPriceCents(world, id));
  return {
    type: "Bundle" as const,
    drinks: names,
    percentOff: promo.percentOff,
    regularPrice: formatCents(regular),
    promoPrice: formatCents(bundlePriceCents(first, second, promo.percentOff)),
    pairedBundle: null,
    storefrontBanner: promotionCopy(promo.kind, promo.productIds, promo.percentOff).headline,
  };
}

const daysText = (days: number) => (!Number.isFinite(days) ? "plenty of stock" : days < 1 ? "under a day of stock" : `${days.toFixed(1).replace(/\.0$/, "")} days of stock`);

/** A compact, plain-data picture of the shop for writing. Everything in it was computed by the engine. */
export function buildSnapshot(world: World, poId?: string, promo?: PromoPost) {
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
    lines: order.lines.map((line) => `${packPhrase(line.packs, line.packLabel, getIngredient(line.ingredientId).name, line.brand)} at ${formatCents(line.packPriceCents)} each`),
    reasons: order.reasons.map((reason) => `${reason.rule}: ${reason.text}`),
    savings: { bulkDiscount: formatCents(order.savings.bulkCents), shippingAvoided: formatCents(order.savings.shippingAvoidedCents) },
    invoice: order.invoice ? { billed: formatCents(order.invoice.totalCents), issues: (order.matchNotes ?? []).filter((note) => !/^Ordered, received, and billed all agree|^You (accepted|disputed)/.test(note)) } : undefined,
  });
  return {
    note: "All numbers are simulated.",
    shop: "Fig & Froth, a small matcha bar",
    today: formatDay(world.day, "long"),
    weatherF: world.conditions.tempF,
    scenario: getScenario(world.scenarioId).name,
    approvalLimit: formatDollars(SETTINGS.approvalThresholdCents),
    yesterday: yesterday ? { orders: yesterday.orders, drinksMade: yesterday.drinksMade, drinksMissed: yesterday.drinksMissed, sales: formatCents(yesterday.revenueCents), thrownOut: formatCents(yesterday.wasteCents) } : null,
    needsAttention: needsAttention(tins).slice(0, 5).map((tin) => ({ item: tin.ingredient.name, onShelf: formatQty(tin.ingredient.id, tin.onHand), daysOfStock: daysText(tin.daysLeft), useBy: tin.nextUseByDay === null ? null : formatDay(tin.nextUseByDay), status: statusLabel(tin) })),
    waitingForApproval: world.purchaseOrders.filter((order) => order.status === "awaiting").map(describePo),
    arrivingToday: world.purchaseOrders.filter((order) => order.receivedDay === world.day).map((order) => `${order.id} from ${getSupplier(order.supplierId).name}`),
    invoicesToReview: world.purchaseOrders.filter((order) => order.status === "flagged").map((order) => ({ id: order.id, notes: order.matchNotes ?? [] })),
    special: world.specialSuggestion?.text ?? null,
    promotions: { liveOnStorefront: livePromotions(world).map(promotionTitle), ideas: suggestPromotions(world).length },
    order: po ? describePo(po) : undefined,
    promotion: promo ? promoFacts(world, promo) : undefined,
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
  const urgent = snapshot.needsAttention.filter((item) => item.status === "Reorder now" || item.status.startsWith("Out")).slice(0, 3);
  if (urgent.length > 0) parts.push(`Keep an eye on ${list(urgent.map((item) => `${item.item.toLowerCase()} (${item.daysOfStock}, ${item.status.toLowerCase()})`))}.`);
  else parts.push("Nothing on the shelf is urgent.");
  if (snapshot.invoicesToReview.length > 0) parts.push(`${snapshot.invoicesToReview.length === 1 ? "One invoice doesn’t" : `${snapshot.invoicesToReview.length} invoices don’t`} match what we ordered and received.`);
  if (snapshot.special) parts.push("There’s a “use it up” special suggestion on the Freshness tab.");
  if (snapshot.promotions.liveOnStorefront.length > 0) parts.push(`Live on the storefront: ${list(snapshot.promotions.liveOnStorefront)}.`);
  if (snapshot.promotions.ideas > 0) parts.push(`${snapshot.promotions.ideas === 1 ? "A promotion idea is" : `${snapshot.promotions.ideas} promotion ideas are`} waiting on the Promotions tab.`);
  return parts.join(" ");
}

/** Standard marketing for a promotion: a social caption and a text message. Never mentions expiry. */
export function demoPromoPost(world: World, promo: PromoPost): string {
  const facts = promoFacts(world, promo);
  if (facts.type === "Sale") {
    const name = facts.drinks[0];
    const pairing = facts.pairedBundle ? ` Pair it with the ${facts.pairedBundle.withDrink} and save another ${facts.pairedBundle.extraPercentOff}%.` : "";
    return [
      "Social post:",
      `Last call on the ${name}: it’s ${facts.percentOff}% off, now ${facts.promoPrice} (normally ${facts.regularPrice}), while this batch lasts.${pairing} Whisked to order in Paterson. Order ahead for pickup.`,
      "#figandfroth #matcha",
      "",
      "Text message:",
      `Fig & Froth: the ${name} is ${facts.percentOff}% off (${facts.promoPrice}) while it lasts. Order ahead for pickup.`,
    ].join("\n");
  }
  const [first, second] = facts.drinks;
  return [
    "Social post:",
    `Better together: the ${first} and the ${second} for ${facts.promoPrice} (normally ${facts.regularPrice}). Bring a friend, or keep both for yourself. Put both in your bag and the bundle price applies on its own.`,
    "#figandfroth #matcha",
    "",
    "Text message:",
    `Fig & Froth: ${first} + ${second}, ${facts.promoPrice} for both. Order ahead for pickup.`,
  ].join("\n");
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

/** Standard draft for disputing a flagged invoice: each mismatch, the amount, and the fix we want. */
export function demoDisputeMessage(po: PurchaseOrder): string {
  const supplier = getSupplier(po.supplierId);
  const result = threeWayMatch(po);
  const issues = result.notes.filter((note) => !/not billed for them/.test(note));
  return [
    `Hi ${supplier.name} team,`,
    "",
    `Thanks for delivering ${po.id}. When we checked the invoice against our order and what arrived, ${issues.length === 1 ? "one thing didn’t" : "a few things didn’t"} line up:`,
    ...issues.map((issue) => `- ${issue}`),
    "",
    `That comes to ${formatCents(result.overchargeCents)} more than we owe. Could you send a corrected invoice or a credit for the difference? We’ll pay the rest as soon as it’s sorted.`,
    "",
    "Thank you!",
    "The Fig & Froth team",
  ].join("\n");
}

/** Demo-mode draft message to a supplier. Never sent anywhere. */
export function demoSupplierMessage(po: PurchaseOrder): string {
  const supplier = getSupplier(po.supplierId);
  const lines = po.lines.map((line) => `- ${packPhrase(line.packs, line.packLabel, getIngredient(line.ingredientId).name, line.brand)} at ${formatCents(line.packPriceCents)} each`);
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
