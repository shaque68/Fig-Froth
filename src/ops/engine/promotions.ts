// Promotions: put drinks on sale when stock would otherwise be thrown out, and bundle two drinks
// for an extra discount. Every percent, price, and forecast comes from these rules. The owner
// publishes, and the storefront and checkout server charge exactly these prices (src/pricing.ts).
import { initialProducts } from "../../catalog.ts";
import { bundlePriceCents, saleUnitCents, type PromotionKind, type StorePromotion } from "../../pricing.ts";
import { DRINKS, drinkById, getIngredient, SETTINGS, type Drink } from "./data.ts";
import { freshnessOutlook } from "./freshness.ts";
import { formatQty } from "./inventory.ts";
import { formatCents } from "./money.ts";
import { applyBundles, AVERAGE_DRINKS_PER_ORDER, bothChance, dayConditions, drinkShare, expectedOrderCount, formatDay, onlyFirstChance, promotionOrders, saleLift, upsellChance } from "./orders.ts";
import { drinkProfits } from "./profit.ts";
import { addLog, livePromotions, type Promotion, type World } from "./sim.ts";

/** No promotion may take a drink, or a bundle, under this margin. */
export const MARGIN_FLOOR = 0.6;
export const DISCOUNT_STEPS = [10, 15, 20, 25, 30];
export const BUNDLE_STEPS = [5, 10, 15];
/** Smallest amount of stock at risk that's worth a promotion. */
const MIN_AT_RISK_CENTS = 1500;
/** The bundle builder forecasts a week. */
export const BUILDER_DAYS = 7;

export type PromoOption = {
  percentOff: number;
  /** Sale price of the drink, or the price of both bundle drinks. */
  priceCents: number;
  /** Price before this promotion. */
  regularCents: number;
  marginAfter: number;
  allowed: boolean;
  blockedReason?: string;
  /** Extra drinks a day: sale customers (discount) or second drinks added for the bundle (bundle). */
  extraPerDay: number;
  /** How much of the at-risk ingredient those extra sales use per day. */
  usePerDay: number;
  savedQty: number;
  savedCents: number;
  /** The discount on sales we'd have made anyway. */
  givenAwayCents: number;
  /** Profit on the extra sales, after the discount. */
  extraProfitCents: number;
  netCents: number;
  days: number;
};

export type AtRisk = {
  ingredientId: string;
  batchId: string;
  expiresDay: number;
  daysOfUse: number;
  /** Still expected to be thrown out after the promotions already running. */
  qty: number;
  cents: number;
};

export type PromoSuggestion = {
  key: string;
  kind: PromotionKind;
  /** For a bundle, the drink that uses the at-risk stock comes first. */
  productIds: string[];
  atRisk?: AtRisk;
  options: PromoOption[];
  recommended: number;
};

const pct = (value: number) => `${Math.round(value * 100)}%`;
const drinkName = (id: string) => drinkById.get(id)?.name ?? id;
const uses = (drink: Drink, ingredientId: string) => drink.recipe.find((line) => line.ingredientId === ingredientId)?.amount ?? 0;

/** Drinks customers can order online (the storefront has some switched off). */
export function sellableDrinks(): Drink[] {
  return DRINKS.filter((drink) => initialProducts.some((product) => product.id === drink.id && product.available));
}

function costOf(world: World, drinkId: string): number {
  return drinkProfits(world).find((profit) => profit.drink.id === drinkId)?.costCents ?? 0;
}

/** A drink's price right now, with any live discount. */
export function currentPriceCents(world: World, drinkId: string): number {
  return saleUnitCents(drinkId, drinkById.get(drinkId)?.priceCents ?? 0, livePromotions(world)).cents;
}

function ordersPerDay(world: World): number {
  return expectedOrderCount(dayConditions(world.seed, world.day + 1, { tempF: world.effects.tempByDay[world.day + 1] }));
}

/** Perishable batches we still expect to throw out, after what live promotions should use. */
export function atRiskStock(world: World): AtRisk[] {
  const live = livePromotions(world);
  return freshnessOutlook(world)
    .filter((item) => item.daysOfUse >= 1 && item.daysOfUse <= 7 && item.leftoverCents >= MIN_AT_RISK_CENTS)
    .map((item) => {
      const covered = live.filter((promo) => promo.batchId === item.batch.id).reduce((sum, promo) => sum + promo.forecast.usePerDay * item.daysOfUse, 0);
      const qty = Math.max(0, item.leftover - covered);
      return { ingredientId: item.ingredientId, batchId: item.batch.id, expiresDay: item.batch.expiresDay!, daysOfUse: item.daysOfUse, qty, cents: Math.round((item.leftoverCents * qty) / Math.max(1, item.leftover)) };
    })
    .sort((a, b) => b.cents - a.cents);
}

function finish(option: Omit<PromoOption, "netCents" | "allowed">): PromoOption {
  return { ...option, allowed: !option.blockedReason, netCents: option.savedCents + option.extraProfitCents - option.givenAwayCents };
}

function saved(target: AtRisk | undefined, usePerDay: number, days: number) {
  if (!target || target.qty <= 0) return { savedQty: 0, savedCents: 0 };
  const savedQty = Math.min(target.qty, usePerDay * days);
  return { savedQty, savedCents: Math.round((target.cents * savedQty) / target.qty) };
}

/** Each discount step for one drink: price, margin, and what it should sell, save, and cost. */
export function discountOptions(world: World, drinkId: string, target?: AtRisk): PromoOption[] {
  const drink = drinkById.get(drinkId)!;
  const live = livePromotions(world);
  const cost = costOf(world, drinkId);
  const orders = ordersPerDay(world);
  const base = orders * AVERAGE_DRINKS_PER_ORDER * drinkShare(drinkId, world.specials);
  const days = target ? target.daysOfUse : BUILDER_DAYS;
  const perDrink = target ? uses(drink, target.ingredientId) : 0;
  return DISCOUNT_STEPS.map((percentOff) => {
    const priceCents = drink.priceCents - Math.round((drink.priceCents * percentOff) / 100);
    const extraPerDay = orders * saleLift(drinkId, percentOff, world.specials);
    const marginAfter = (priceCents - cost) / priceCents;
    let blockedReason = marginAfter < MARGIN_FLOOR ? `Would leave a ${pct(marginAfter)} margin, under the ${pct(MARGIN_FLOOR)} floor.` : undefined;
    for (const bundle of live.filter((promo) => promo.kind === "bundle" && promo.productIds.includes(drinkId))) {
      const other = bundle.productIds.find((id) => id !== drinkId)!;
      const pairPrice = bundlePriceCents(priceCents, currentPriceCents(world, other), bundle.percentOff);
      const pairMargin = (pairPrice - cost - costOf(world, other)) / pairPrice;
      if (!blockedReason && pairMargin < MARGIN_FLOOR) blockedReason = `With the live ${drinkName(bundle.productIds[0])} + ${drinkName(bundle.productIds[1])} bundle on top, the pair would fall to a ${pct(pairMargin)} margin.`;
    }
    const usePerDay = extraPerDay * perDrink;
    return finish({
      percentOff, priceCents, regularCents: drink.priceCents, marginAfter, blockedReason, extraPerDay, usePerDay, days,
      ...saved(target, usePerDay, days),
      givenAwayCents: Math.round(base * days * (drink.priceCents - priceCents)),
      extraProfitCents: Math.round(extraPerDay * days * (priceCents - cost)),
    });
  });
}

/**
 * Each bundle step for a pair, on top of any live discount on either drink. A bundle works by
 * talking customers who came for one of the drinks into adding the other, so the discount goes
 * mostly to second drinks we wouldn't otherwise have sold.
 */
export function bundleOptions(world: World, productIds: [string, string], target?: AtRisk): PromoOption[] {
  const [first, second] = productIds.map((id) => ({ id, drink: drinkById.get(id)!, price: currentPriceCents(world, id), cost: costOf(world, id), share: drinkShare(id, world.specials) }));
  const orders = ordersPerDay(world);
  // Orders with only the first drink can add the second, and the other way round.
  const addSecond = orders * onlyFirstChance(first.share, second.share);
  const addFirst = orders * onlyFirstChance(second.share, first.share);
  const natural = orders * bothChance(first.share, second.share);
  const days = target ? target.daysOfUse : BUILDER_DAYS;
  const use = (drink: Drink) => (target ? uses(drink, target.ingredientId) : 0);
  return BUNDLE_STEPS.map((percentOff) => {
    const priceCents = bundlePriceCents(first.price, second.price, percentOff);
    const pairDiscount = first.price + second.price - priceCents;
    const upsell = upsellChance(percentOff);
    const extraPerDay = (addSecond + addFirst) * upsell;
    const marginAfter = (priceCents - first.cost - second.cost) / priceCents;
    const usePerDay = (addSecond * use(second.drink) + addFirst * use(first.drink)) * upsell;
    const profitPerDay = addSecond * upsell * (second.price - second.cost) + addFirst * upsell * (first.price - first.cost) - extraPerDay * pairDiscount;
    return finish({
      percentOff, priceCents, regularCents: first.price + second.price, marginAfter, extraPerDay, usePerDay, days,
      blockedReason: marginAfter < MARGIN_FLOOR ? `Would leave the pair a ${pct(marginAfter)} margin, under the ${pct(MARGIN_FLOOR)} floor.` : undefined,
      ...saved(target, usePerDay, days),
      givenAwayCents: Math.round(natural * days * pairDiscount),
      extraProfitCents: Math.round(profitPerDay * days),
    });
  });
}

/** The allowed step that's best for the shop overall; the smaller discount wins a tie. */
export function bestOption(options: PromoOption[]): PromoOption | undefined {
  return options.filter((option) => option.allowed).sort((a, b) => b.netCents - a.netCents || a.percentOff - b.percentOff)[0];
}

const isBundleLive = (world: World, a: string, b: string) => livePromotions(world).some((promo) => promo.kind === "bundle" && promo.productIds.includes(a) && promo.productIds.includes(b));

/**
 * For each batch we still expect to throw out: the drink to put on sale and the bundle to offer,
 * each only if it's forecast to come out ahead (stock saved plus profit on extra sales, minus the
 * discount given on sales we'd have made anyway).
 */
export function suggestPromotions(world: World): PromoSuggestion[] {
  const live = livePromotions(world);
  const sellable = sellableDrinks();
  const suggestions: PromoSuggestion[] = [];
  const keep = (candidates: PromoSuggestion[]) => {
    const scored = candidates
      .map((candidate) => ({ candidate, best: bestOption(candidate.options) }))
      .filter((item) => item.best && item.best.netCents > 0 && item.best.savedQty >= 1)
      .sort((a, b) => b.best!.netCents - a.best!.netCents);
    if (scored[0]) suggestions.push({ ...scored[0].candidate, recommended: scored[0].best!.percentOff });
  };
  for (const target of atRiskStock(world).slice(0, 2)) {
    if (target.cents < MIN_AT_RISK_CENTS / 2) continue;
    const users = sellable.filter((drink) => uses(drink, target.ingredientId) > 0);
    if (!live.some((promo) => promo.kind === "discount" && promo.batchId === target.batchId)) {
      keep(users
        .filter((drink) => !live.some((promo) => promo.kind === "discount" && promo.productIds[0] === drink.id))
        .map((drink) => ({ key: `discount:${drink.id}:${target.batchId}`, kind: "discount", productIds: [drink.id], atRisk: target, options: discountOptions(world, drink.id, target), recommended: 0 })));
    }
    if (!live.some((promo) => promo.kind === "bundle" && promo.batchId === target.batchId)) {
      const pairs: PromoSuggestion[] = [];
      for (const first of users) {
        for (const second of sellable) {
          if (second.id === first.id || isBundleLive(world, first.id, second.id)) continue;
          if (uses(second, target.ingredientId) > 0 && second.id < first.id) continue;
          pairs.push({ key: `bundle:${first.id}+${second.id}:${target.batchId}`, kind: "bundle", productIds: [first.id, second.id], atRisk: target, options: bundleOptions(world, [first.id, second.id], target), recommended: 0 });
        }
      }
      keep(pairs);
    }
  }
  return suggestions;
}

/** Owner-facing name, and the customer-facing banner. Never mentions expiry or waste. */
export function promotionCopy(kind: PromotionKind, productIds: string[], percentOff: number): { title: string; headline: string; detail: string } {
  if (kind === "discount") {
    const name = drinkName(productIds[0]);
    return { title: `${percentOff}% off ${name}`, headline: `Last call: ${percentOff}% off the ${name}`, detail: "While this batch lasts. Order ahead for pickup." };
  }
  const [first, second] = productIds.map(drinkName);
  return { title: `${first} + ${second} bundle, ${percentOff}% off`, headline: `Better together: the ${first} and ${second}, ${percentOff}% off the pair`, detail: "Add both to your bag and the bundle price applies automatically." };
}

export function promotionTitle(promo: Pick<Promotion, "kind" | "productIds" | "percentOff">): string {
  return promotionCopy(promo.kind, promo.productIds, promo.percentOff).title;
}

export type PublishInput = {
  kind: PromotionKind;
  productIds: string[];
  percentOff: number;
  option: PromoOption;
  atRisk?: AtRisk;
};

/** The owner publishes a promotion: it's live on the storefront and at the counter right away. */
export function publishPromotion(world: World, input: PublishInput): Promotion {
  world.counters.promo += 1;
  const copy = promotionCopy(input.kind, input.productIds, input.percentOff);
  const promo: Promotion = {
    id: `PR-${world.counters.promo}`,
    kind: input.kind,
    productIds: input.productIds,
    percentOff: input.percentOff,
    headline: copy.headline,
    detail: copy.detail,
    status: "live",
    startDay: world.day,
    endDay: input.atRisk?.expiresDay,
    ingredientId: input.atRisk?.ingredientId,
    batchId: input.atRisk?.batchId,
    forecast: { extraPerDay: input.option.extraPerDay, usePerDay: input.option.usePerDay, savedQty: input.option.savedQty, savedCents: input.option.savedCents, netCents: input.option.netCents },
    results: { drinks: 0, bundles: 0, discountCents: 0 },
  };
  world.promotions.push(promo);
  // Customers still to come today see it too.
  if (world.queue.length > 0 && world.minute < SETTINGS.closeMinute) {
    const extra = promotionOrders(world.seed, world.conditions, [promo], { drinkBoosts: world.specials, fromMinute: world.minute });
    world.queue = applyBundles(world.seed, world.conditions, [...world.queue, ...extra], [promo], world.minute).sort((a, b) => a.minute - b.minute || a.id.localeCompare(b.id));
  }
  const why = input.atRisk
    ? `To use up about ${formatQty(input.atRisk.ingredientId, Math.round(input.atRisk.qty))} of ${getIngredient(input.atRisk.ingredientId).name.toLowerCase()} before ${formatDay(input.atRisk.expiresDay)}. Forecast: saves about ${formatCents(input.option.savedCents)} of it, ${formatCents(input.option.netCents)} ahead overall.`
    : `Forecast: about ${Math.round(input.option.extraPerDay * BUILDER_DAYS)} extra drinks a week, ${formatCents(input.option.netCents)} ahead, at a ${pct(input.option.marginAfter)} margin.`;
  addLog(world, "you", `You published a promotion: ${copy.title}`, `Live on the storefront now. ${why}`);
  return promo;
}

export function endPromotion(world: World, id: string, actor: "you" | "agent", reason: string): void {
  const promo = world.promotions.find((candidate) => candidate.id === id);
  if (!promo || promo.status !== "live") return;
  promo.status = "ended";
  promo.endedDay = world.day;
  promo.endedReason = reason;
  const results = `${promo.results.drinks + promo.results.bundles * 2} drinks sold with it, ${formatCents(promo.results.discountCents)} in discounts.`;
  addLog(world, actor, `${actor === "you" ? "You ended" : "Ended"} the promotion: ${promotionTitle(promo)}`, `${reason} ${results}`);
}

/** At closing: a use-it-up promotion ends once its batch is used up or reaches its use-by date. */
export function endFinishedPromotions(world: World): void {
  for (const promo of livePromotions(world)) {
    if (!promo.batchId) continue;
    const stillThere = Object.values(world.stock).some((batches) => batches.some((batch) => batch.id === promo.batchId));
    if (promo.endDay !== undefined && world.day >= promo.endDay) endPromotion(world, promo.id, "agent", "The batch it was for reached its use-by date.");
    else if (!stillThere) endPromotion(world, promo.id, "agent", "The batch it was for is used up.");
  }
}

/** What the storefront shows and the checkout server charges. */
export function storePromotions(world: World): StorePromotion[] {
  return livePromotions(world).map((promo) => ({ id: promo.id, kind: promo.kind, productIds: promo.productIds, percentOff: promo.percentOff, headline: promo.headline, detail: promo.detail }));
}
