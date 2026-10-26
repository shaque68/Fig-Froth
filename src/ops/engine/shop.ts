// The full shop loop used by the UI and the comparison: the simulation plus the day hooks.
import { runAgent } from "./agent.ts";
import { drinkById, SETTINGS } from "./data.ts";
import type { OrderLine } from "./orders.ts";
import { receiveDeliveries } from "./purchasing.ts";
import { advanceDay, nextOrder, runUntil, serveOrder, type DayHooks, type ServedOrder, type World } from "./sim.ts";

export const shopHooks: DayHooks = {
  onOpen: (world) => { receiveDeliveries(world); },
  onClose: (world) => { runAgent(world); },
};

export function stepNextOrder(world: World): ServedOrder {
  return nextOrder(world, shopHooks);
}

/** Serves the next simulated hour of orders; at closing time, closes the day and opens the next. */
export function stepHour(world: World): ServedOrder[] {
  if (world.queue.length === 0 || world.minute >= SETTINGS.closeMinute) {
    advanceDay(world, shopHooks);
    return [];
  }
  return runUntil(world, (Math.floor(world.minute / 60) + 1) * 60);
}

/** Runs to the start of `untilDay`. Stops early if `shouldStop` says so after a day closes. */
export function runToDay(world: World, untilDay: number, shouldStop?: (world: World) => boolean): void {
  while (world.day < untilDay) {
    runUntil(world, Number.POSITIVE_INFINITY);
    advanceDay(world, shopHooks);
    if (shouldStop?.(world)) return;
  }
}

/** An order placed on the storefront, as the server's order feed reports it. */
export type WebOrder = {
  id: number;
  number: string;
  items: Array<{ productId: string; name: string; quantity: number; selections: Record<string, string> }>;
};

/**
 * Serves a storefront order right now: its drinks come off the shelf like any other order and it
 * shows in Live orders. Website drinks are made iced; items without a tracked recipe are noted.
 */
export function serveWebOrder(world: World, webOrder: WebOrder): ServedOrder {
  const lines: OrderLine[] = [];
  const untracked: string[] = [];
  for (const item of webOrder.items) {
    if (!drinkById.has(item.productId)) {
      untracked.push(`${item.quantity} ${item.name}`);
      continue;
    }
    const milk = /oat/i.test(item.selections.Milk ?? "") ? "oat" : "whole";
    for (let count = 0; count < item.quantity; count += 1) lines.push({ drinkId: item.productId, iced: true, milk });
  }
  const minute = Math.min(Math.max(world.minute, SETTINGS.openMinute), SETTINGS.closeMinute - 1);
  const note = `Website order${untracked.length > 0 ? ` · also ${untracked.join(", ")} (not tracked)` : ""}`;
  return serveOrder(world, { id: webOrder.number, day: world.day, minute, lines, note });
}
