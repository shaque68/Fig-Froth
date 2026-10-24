// Seeded customer order generator: weekday/weekend rhythm, hourly peaks, and weather.
import { DRINKS, SETTINGS, type Drink } from "./data.ts";
import { streamFor } from "./random.ts";

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
};

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
  return orders
    .sort((a, b) => a.minute - b.minute)
    .map((order, index) => ({ ...order, id: `${conditions.day + 1}-${String(index + 1).padStart(3, "0")}` }));
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
