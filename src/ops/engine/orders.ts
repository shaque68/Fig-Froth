// Seeded customer order generator: weekday/weekend rhythm, hourly peaks, and weather.
import { DRINKS, SETTINGS, type Drink } from "./data.ts";
import { streamFor, type Rng } from "./random.ts";

export type Milk = "whole" | "oat";
export type OrderLine = { drinkId: string; iced: boolean; milk: Milk };
export type Order = { id: string; day: number; minute: number; lines: OrderLine[]; note?: string };

export type DayConditions = {
  day: number;
  weekday: number; // 0 = Sunday
  tempF: number;
  isWeekend: boolean;
};

export type DemandOptions = {
  /** Fixed temperature for the day (scenarios), otherwise seeded June weather. */
  tempF?: number;
  /** Extra popularity for a drink, e.g. 0.6 = 60% more likely (a "use it up" special). */
  drinkBoosts?: Record<string, number>;
  /** Live promotions: a sale brings extra customers, a bundle talks some customers into a second drink. */
  promotions?: PromotionDemand[];
};

/** The parts of a promotion that change demand. */
export type PromotionDemand = { id: string; kind: "discount" | "bundle"; productIds: string[]; percentOff: number };

export const AVERAGE_DRINKS_PER_ORDER = 1.34;
/** Each 1% off a drink sells about 2% more of it. */
export const PROMO_ELASTICITY = 2;
/** Each 1% off a bundle talks about 1.5% of customers buying one of its drinks into adding the other. */
export const BUNDLE_UPSELL = 1.5;
/** How many drinks orders hold: 1 (72%), 2 (22%), or 3 (6%). */
const DRINK_COUNTS = [{ drinks: 1, share: 0.72 }, { drinks: 2, share: 0.22 }, { drinks: 3, share: 0.06 }];

// Hour-of-day weights from 7 am to 6 pm: a morning rush and an afternoon pick-me-up.
const HOUR_WEIGHTS = [6, 10, 9, 7, 7, 9, 9, 10, 11, 9, 7, 5];
const HOURS = HOUR_WEIGHTS.map((weight, index) => ({ hour: 7 + index, weight }));

export function weekdayOf(day: number): number {
  const start = new Date(`${SETTINGS.startDate}T12:00:00`);
  start.setDate(start.getDate() + day);
  return start.getDay();
}

export function dayConditions(seed: number, day: number, options: DemandOptions = {}): DayConditions {
  const weekday = weekdayOf(day);
  const rng = streamFor(seed, "weather", day);
  const tempF = options.tempF ?? Math.round(72 + rng.next() * 16);
  return { day, weekday, tempF, isWeekend: weekday === 0 || weekday === 6 };
}

export function expectedOrderCount(conditions: DayConditions): number {
  const base = conditions.isWeekend ? 100 : conditions.weekday === 5 ? 80 : 70;
  const weather = conditions.tempF >= 88 ? 1.15 : conditions.tempF <= 62 ? 0.9 : 1;
  return base * weather;
}

/** Chance a drink is iced: rises with temperature. */
export function icedChance(tempF: number, drink: Drink): number {
  const base = 0.25 + (tempF - 60) * 0.018;
  return Math.min(0.95, Math.max(0.1, base + drink.icedBias));
}

/** A drink's share of all drinks ordered, given any specials running. */
export function drinkShare(drinkId: string, boosts: Record<string, number> = {}): number {
  const weight = (drink: Drink) => drink.popularity * (1 + (boosts[drink.id] ?? 0));
  const total = DRINKS.reduce((sum, drink) => sum + weight(drink), 0);
  const drink = DRINKS.find((candidate) => candidate.id === drinkId);
  return drink ? weight(drink) / total : 0;
}

/** Extra single-drink orders a sale brings, per regular order (price elasticity). */
export function saleLift(drinkId: string, percentOff: number, boosts: Record<string, number> = {}): number {
  return (AVERAGE_DRINKS_PER_ORDER * drinkShare(drinkId, boosts) * PROMO_ELASTICITY * percentOff) / 100;
}

/** Chance a regular order holds the first drink and not the second. */
export function onlyFirstChance(first: number, second: number): number {
  return DRINK_COUNTS.reduce((sum, { drinks, share }) => sum + share * ((1 - second) ** drinks - (1 - first - second) ** drinks), 0);
}

/** Chance a regular order already holds both drinks. */
export function bothChance(first: number, second: number): number {
  return DRINK_COUNTS.reduce((sum, { drinks, share }) => sum + share * (1 - (1 - first) ** drinks - (1 - second) ** drinks + (1 - first - second) ** drinks), 0);
}

/** Chance a customer buying just one of a bundle's drinks adds the other. */
export function upsellChance(percentOff: number): number {
  return Math.min(0.6, (BUNDLE_UPSELL * percentOff) / 100);
}

/**
 * The extra customers sales bring from `fromMinute` to closing. They come from their own random
 * stream, so the regular customers are the same with or without a promotion.
 */
export function promotionOrders(seed: number, conditions: DayConditions, promotions: PromotionDemand[], options: { drinkBoosts?: Record<string, number>; fromMinute?: number } = {}): Order[] {
  const fromMinute = options.fromMinute ?? SETTINGS.openMinute;
  const slots = HOURS.filter((slot) => (slot.hour + 1) * 60 > fromMinute);
  const totalWeight = HOURS.reduce((sum, slot) => sum + slot.weight, 0);
  const remaining = slots.reduce((sum, slot) => sum + slot.weight * Math.min(1, ((slot.hour + 1) * 60 - fromMinute) / 60), 0) / totalWeight;
  const orders: Order[] = [];
  for (const promo of promotions) {
    if (promo.kind !== "discount") continue;
    const rng = streamFor(seed, "promotion", promo.id, conditions.day, fromMinute);
    const expected = expectedOrderCount(conditions) * saleLift(promo.productIds[0], promo.percentOff, options.drinkBoosts) * remaining;
    const count = Math.round(expected * (0.85 + rng.next() * 0.3));
    for (let index = 0; index < count && slots.length > 0; index += 1) {
      const { hour } = rng.weighted(slots, (slot) => slot.weight);
      const minute = Math.max(fromMinute, hour * 60 + rng.int(0, 59));
      orders.push({ id: `${conditions.day + 1}-${promo.id.replace(/^PR-/, "P")}-${String(index + 1).padStart(2, "0")}`, day: conditions.day, minute, lines: [randomLine(rng, conditions, promo.productIds[0])], note: "On sale" });
    }
  }
  return orders.sort((a, b) => a.minute - b.minute || a.id.localeCompare(b.id));
}

function randomLine(rng: Rng, conditions: DayConditions, drinkId: string): OrderLine {
  const drink = DRINKS.find((candidate) => candidate.id === drinkId)!;
  return { drinkId, iced: rng.chance(icedChance(conditions.tempF, drink)), milk: rng.chance(SETTINGS.oatShare) ? "oat" : "whole" };
}

/**
 * Bundles: some customers ordering one of a bundle's drinks add the other to get the bundle price.
 * Only orders at or after `fromMinute` change, and the choice comes from its own random stream.
 */
export function applyBundles(seed: number, conditions: DayConditions, orders: Order[], promotions: PromotionDemand[], fromMinute: number = SETTINGS.openMinute): Order[] {
  const bundles = promotions.filter((promo) => promo.kind === "bundle" && promo.productIds.length === 2);
  if (bundles.length === 0) return orders;
  return orders.map((order) => {
    // Booked orders are fixed; a website order is served as placed.
    if (order.minute < fromMinute || (order.note && order.note !== "On sale")) return order;
    let lines = order.lines;
    for (const promo of bundles) {
      const rng = streamFor(seed, "bundle", promo.id, conditions.day, order.id);
      const has = promo.productIds.map((id) => lines.some((line) => line.drinkId === id));
      if (has[0] === has[1] || !rng.chance(upsellChance(promo.percentOff))) continue;
      lines = [...lines, randomLine(rng, conditions, promo.productIds[has[0] ? 1 : 0])];
    }
    return lines === order.lines ? order : { ...order, lines, note: "Bundle" };
  });
}

export function generateDayOrders(seed: number, conditions: DayConditions, options: DemandOptions = {}): Order[] {
  const rng = streamFor(seed, "orders", conditions.day);
  const count = Math.round(expectedOrderCount(conditions) * (0.92 + rng.next() * 0.16));
  const boosts = options.drinkBoosts ?? {};
  const orders: Array<Omit<Order, "id">> = [];
  for (let index = 0; index < count; index += 1) {
    const { hour } = rng.weighted(HOURS, (slot) => slot.weight);
    const minute = hour * 60 + rng.int(0, 59);
    const roll = rng.next();
    const drinkCount = roll < 0.72 ? 1 : roll < 0.94 ? 2 : 3;
    const lines: OrderLine[] = [];
    for (let line = 0; line < drinkCount; line += 1) {
      const drink = rng.weighted(DRINKS, (candidate) => candidate.popularity * (1 + (boosts[candidate.id] ?? 0)));
      lines.push({ drinkId: drink.id, iced: rng.chance(icedChance(conditions.tempF, drink)), milk: rng.chance(SETTINGS.oatShare) ? "oat" : "whole" });
    }
    orders.push({ day: conditions.day, minute, lines });
  }
  const regular = orders
    .sort((a, b) => a.minute - b.minute)
    .map((order, index) => ({ ...order, id: `${conditions.day + 1}-${String(index + 1).padStart(3, "0")}` }));
  if (!options.promotions || options.promotions.length === 0) return regular;
  const extra = promotionOrders(seed, conditions, options.promotions, { drinkBoosts: boosts });
  return applyBundles(seed, conditions, [...regular, ...extra], options.promotions).sort((a, b) => a.minute - b.minute || a.id.localeCompare(b.id));
}

export function formatClock(minute: number): string {
  const hour = Math.floor(minute / 60);
  const mins = minute % 60;
  const suffix = hour >= 12 ? "pm" : "am";
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${displayHour}:${String(mins).padStart(2, "0")} ${suffix}`;
}

/** "Jun 6": compact, for small labels. */
export function formatShortDate(day: number): string {
  const date = new Date(`${SETTINGS.startDate}T12:00:00`);
  date.setDate(date.getDate() + day);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function formatDay(day: number, style: "short" | "long" = "short"): string {
  const date = new Date(`${SETTINGS.startDate}T12:00:00`);
  date.setDate(date.getDate() + day);
  return date.toLocaleDateString("en-US", style === "long"
    ? { weekday: "long", month: "long", day: "numeric" }
    : { weekday: "short", month: "short", day: "numeric" });
}
