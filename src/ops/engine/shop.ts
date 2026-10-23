// The full shop loop used by the UI and the comparison: the simulation plus the day hooks.
import { SETTINGS } from "./data.ts";
import { advanceDay, nextOrder, runUntil, type DayHooks, type ServedOrder, type World } from "./sim.ts";

export const shopHooks: DayHooks = {};

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
