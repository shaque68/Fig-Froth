// A read-only summary of the shelf for the Pantry screen.
import { INGREDIENTS, SETTINGS, getSupplier, type Ingredient, type Supplier } from "./data.ts";
import { dailyUsage, daysLeft, formatDaysLeft, formatStockDays, reorderPoint, stockStatus, type StockStatus } from "./forecast.ts";
import { formatQty, onHand, type Batch } from "./inventory.ts";
import type { PurchaseOrder, World } from "./sim.ts";

export type TinSummary = {
  ingredient: Ingredient;
  supplier: Supplier;
  onHand: number;
  onOrder: number;
  usagePerDay: number;
  /** Days of stock at today's pace (not the use-by date). */
  daysLeft: number;
  /** The soonest use-by day among the batches on the shelf, if any expire. */
  nextUseByDay: number | null;
  reorderPoint: number;
  status: StockStatus;
  /** 0–1 against a fixed "full shelf" level, so tins are comparable across days. */
  fill: number;
  batches: Batch[];
  openOrders: PurchaseOrder[];
};

const OPEN_STATUSES = new Set(["draft", "awaiting", "approved", "sent"]);

export function isOpenPo(po: PurchaseOrder): boolean {
  return OPEN_STATUSES.has(po.status);
}

/** Quantity of an ingredient on open purchase orders (not yet received). */
export function onOrderQty(world: World, ingredientId: string): number {
  return world.purchaseOrders
    .filter(isOpenPo)
    .flatMap((po) => po.lines)
    .filter((line) => line.ingredientId === ingredientId)
    .reduce((sum, line) => sum + line.packs * line.packSize, 0);
}

/** A full shelf: enough for lead time, safety stock, and one order cycle, at the starting pace. */
export function shelfCapacity(world: World, ingredient: Ingredient): number {
  const supplier = getSupplier(ingredient.homeSupplierId);
  const startingUsage = dailyUsage(world.demandHistory[ingredient.id].slice(0, SETTINGS.historyDays));
  return startingUsage * (supplier.leadDays + SETTINGS.safetyDays + supplier.orderCycleDays) * 1.1;
}

export function usageFor(world: World, ingredientId: string): number {
  return dailyUsage(world.demandHistory[ingredientId] ?? []);
}

export function summarizeTin(world: World, ingredient: Ingredient): TinSummary {
  const supplier = getSupplier(ingredient.homeSupplierId);
  const qty = onHand(world.stock[ingredient.id]);
  const usage = usageFor(world, ingredient.id);
  const point = reorderPoint(usage, supplier.leadDays);
  const onOrder = onOrderQty(world, ingredient.id);
  return {
    ingredient,
    supplier,
    onHand: qty,
    onOrder,
    usagePerDay: usage,
    daysLeft: daysLeft(qty, usage),
    nextUseByDay: world.stock[ingredient.id].reduce<number | null>((soonest, batch) => (batch.expiresDay === null ? soonest : soonest === null ? batch.expiresDay : Math.min(soonest, batch.expiresDay)), null),
    reorderPoint: point,
    status: stockStatus(qty, onOrder, usage, point),
    fill: Math.max(0, Math.min(1, qty / Math.max(1, shelfCapacity(world, ingredient)))),
    batches: [...world.stock[ingredient.id]].sort((a, b) => a.receivedDay - b.receivedDay),
    openOrders: world.purchaseOrders.filter((po) => isOpenPo(po) && po.lines.some((line) => line.ingredientId === ingredient.id)),
  };
}

export function summarizePantry(world: World): TinSummary[] {
  return INGREDIENTS.map((ingredient) => summarizeTin(world, ingredient));
}

const STATUS_RANK: Record<StockStatus, number> = { out: 0, now: 1, soon: 2, ok: 3 };

/** Items that need attention, most urgent first. */
export function needsAttention(tins: TinSummary[]): TinSummary[] {
  return tins
    .filter((tin) => tin.status !== "ok")
    .sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.daysLeft - b.daysLeft);
}

/** One sentence explaining the reorder point in plain language. */
export function explainReorderPoint(tin: TinSummary): string {
  const { ingredient, supplier } = tin;
  const usage = formatQty(ingredient.id, Math.round(tin.usagePerDay));
  const point = formatQty(ingredient.id, Math.round(tin.reorderPoint));
  const days = supplier.leadDays + SETTINGS.safetyDays;
  return `We use about ${usage} a day and ${supplier.name} takes ${supplier.leadDays} ${supplier.leadDays === 1 ? "day" : "days"} to deliver, plus ${SETTINGS.safetyDays} days of safety stock, so we reorder at ${point} (${days} days' worth).`;
}

export const STATUS_LABEL: Record<StockStatus, string> = {
  ok: "OK",
  soon: "Reorder soon",
  now: "Reorder now",
  out: "Out",
};

export function statusLabel(tin: TinSummary): string {
  if (tin.status === "now" && tin.onOrder > 0) return "On order";
  return STATUS_LABEL[tin.status];
}

export { formatDaysLeft, formatStockDays };
