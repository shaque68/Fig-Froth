// How fast stock is used and when to reorder it.
import { drinkById, SETTINGS, type RecipeLine } from "./data.ts";
import type { Order, OrderLine } from "./orders.ts";

/** Everything one drink uses: its recipe, its milk, and its cup, lid, and straw. */
export function lineUsage(line: OrderLine): RecipeLine[] {
  const drink = drinkById.get(line.drinkId);
  if (!drink) throw new Error(`Unknown drink ${line.drinkId}`);
  return [
    ...drink.recipe,
    { ingredientId: line.milk === "oat" ? "oat-milk" : "whole-milk", amount: drink.milkMl },
    { ingredientId: line.iced ? "cold-cups" : "hot-cups", amount: 1 },
    { ingredientId: "lids", amount: 1 },
    ...(line.iced ? [{ ingredientId: "straws", amount: 1 }] : []),
  ];
}

export function orderUsage(order: Order): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const line of order.lines) {
    for (const use of lineUsage(line)) totals[use.ingredientId] = (totals[use.ingredientId] ?? 0) + use.amount;
  }
  return totals;
}

/** Rolling average of the most recent days of demand. */
export function dailyUsage(history: number[], windowDays = SETTINGS.usageWindowDays): number {
  const recent = history.slice(-windowDays);
  if (recent.length === 0) return 0;
  return recent.reduce((sum, value) => sum + value, 0) / recent.length;
}

/** On-hand ÷ daily usage. Infinity when nothing is being used. */
export function daysLeft(onHandQty: number, usagePerDay: number): number {
  if (usagePerDay <= 0) return Number.POSITIVE_INFINITY;
  return onHandQty / usagePerDay;
}

/** Daily usage × supplier lead time + safety stock (default two days of usage). */
export function reorderPoint(usagePerDay: number, leadDays: number, safetyDays = SETTINGS.safetyDays): number {
  return usagePerDay * (leadDays + safetyDays);
}

export type StockStatus = "ok" | "soon" | "now" | "out";

/**
 * OK, Reorder soon (within the look-ahead window), Reorder now (at or below the reorder point),
 * or Out. Uses the inventory position (on hand plus already on order) so an item that's
 * on its way doesn't keep shouting.
 */
export function stockStatus(onHandQty: number, onOrderQty: number, usagePerDay: number, point: number): StockStatus {
  if (onHandQty <= 0) return "out";
  const position = onHandQty + onOrderQty;
  if (position <= point) return "now";
  if (position <= point + usagePerDay * SETTINGS.lookaheadDays) return "soon";
  return "ok";
}

export function formatDaysLeft(days: number): string {
  if (!Number.isFinite(days)) return "Plenty";
  if (days < 1) return days <= 0 ? "Out" : "Under a day";
  return `${days < 10 ? days.toFixed(1).replace(/\.0$/, "") : Math.round(days)} days`;
}
