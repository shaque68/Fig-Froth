import test from "node:test";
import assert from "node:assert/strict";
import { DRINKS, INGREDIENTS, SUPPLIERS } from "./data.ts";
import { dailyUsage, daysLeft, lineUsage, reorderPoint, stockStatus } from "./forecast.ts";
import { deductOldestFirst, removeExpired, type Batch } from "./inventory.ts";
import { formatCents } from "./money.ts";
import { dayConditions, generateDayOrders, icedChance } from "./orders.ts";
import { createRng, hashSeed } from "./random.ts";
import { createWorld, nextOrder, onHandOf, simulateDay } from "./sim.ts";

const batch = (id: string, qty: number, receivedDay: number, expiresDay: number | null = null): Batch => ({
  id, qty, initialQty: qty, costCents: qty * 10, receivedDay, expiresDay, source: "test",
});

test("seeded random numbers repeat exactly for the same seed", () => {
  const a = createRng(42);
  const b = createRng(42);
  const c = createRng(43);
  const first = Array.from({ length: 5 }, () => a.next());
  assert.deepEqual(first, Array.from({ length: 5 }, () => b.next()));
  assert.notDeepEqual(first, Array.from({ length: 5 }, () => c.next()));
  assert.equal(hashSeed(1, "orders", 3), hashSeed(1, "orders", 3));
  assert.notEqual(hashSeed(1, "orders", 3), hashSeed(1, "orders", 4));
});

test("deducting an order uses the oldest batch first", () => {
  const batches = [batch("new", 300, 5), batch("old", 100, 1), batch("mid", 200, 3)];
  const taken = deductOldestFirst(batches, 250);
  assert.equal(taken, 250);
  assert.deepEqual(batches.map((b) => [b.id, b.qty]), [["mid", 50], ["new", 300]]);
});

test("deducting more than is on hand takes what's there and reports the shortfall", () => {
  const batches = [batch("only", 40, 0)];
  assert.equal(deductOldestFirst(batches, 100), 40);
  assert.equal(batches.length, 0);
});

test("expired batches are removed at the end of their last day", () => {
  const batches = [batch("fresh", 10, 0, 9), batch("stale", 10, 0, 4), batch("forever", 10, 0, null)];
  const expired = removeExpired(batches, 4);
  assert.deepEqual(expired.map((b) => b.id), ["stale"]);
  assert.deepEqual(batches.map((b) => b.id), ["fresh", "forever"]);
});

test("daily usage is a rolling average of recent days", () => {
  assert.equal(dailyUsage([100, 100, 100, 100, 100, 100, 100, 800]), 200);
  assert.equal(dailyUsage([30, 60], 7), 45);
  assert.equal(dailyUsage([]), 0);
});

test("days of stock left and reorder point follow the plain-language rules", () => {
  assert.equal(daysLeft(1200, 300), 4);
  assert.equal(daysLeft(50, 0), Number.POSITIVE_INFINITY);
  // 300 a day × (5-day lead time + 2 safety days)
  assert.equal(reorderPoint(300, 5), 2100);
  assert.equal(reorderPoint(300, 5, 0), 1500);
});

test("stock status uses on hand plus what's already on order", () => {
  const point = reorderPoint(100, 2); // 400
  assert.equal(stockStatus(0, 500, 100, point), "out");
  assert.equal(stockStatus(350, 0, 100, point), "now");
  assert.equal(stockStatus(350, 300, 100, point), "soon");
  assert.equal(stockStatus(900, 0, 100, point), "ok");
});

test("each drink uses its recipe, milk, cup, lid, and (iced) straw", () => {
  const usage = lineUsage({ drinkId: "strawberry-booza", iced: true, milk: "oat" });
  const ids = usage.map((use) => use.ingredientId);
  assert.ok(ids.includes("strawberry-puree"));
  assert.ok(ids.includes("oat-milk"));
  assert.ok(ids.includes("cold-cups"));
  assert.ok(ids.includes("straws"));
  const hot = lineUsage({ drinkId: "classic-matcha", iced: false, milk: "whole" }).map((use) => use.ingredientId);
  assert.ok(hot.includes("hot-cups"));
  assert.ok(!hot.includes("straws"));
});

test("weekends are busier and hot days order more iced drinks", () => {
  let weekday = 0;
  let weekend = 0;
  for (let day = 0; day < 28; day += 1) {
    const conditions = dayConditions(7, day);
    const count = generateDayOrders(7, conditions).length;
    if (conditions.isWeekend) weekend += count / 8;
    else weekday += count / 20;
  }
  assert.ok(weekend > weekday * 1.2, `weekend ${weekend} vs weekday ${weekday}`);

  const icedShare = (tempF: number) => {
    const orders = generateDayOrders(7, { ...dayConditions(7, 2), tempF });
    const lines = orders.flatMap((order) => order.lines);
    return lines.filter((line) => line.iced).length / lines.length;
  };
  assert.ok(icedShare(97) > icedShare(65) + 0.2);
  assert.ok(icedChance(95, DRINKS[0]) > icedChance(70, DRINKS[0]));
});

test("orders on a day are sorted by time and fall within opening hours", () => {
  const orders = generateDayOrders(11, dayConditions(11, 3));
  assert.ok(orders.length > 50);
  for (let index = 1; index < orders.length; index += 1) assert.ok(orders[index].minute >= orders[index - 1].minute);
  assert.ok(orders.every((order) => order.minute >= 7 * 60 && order.minute < 19 * 60));
});

test("serving an order drains exactly the recipe amounts", () => {
  const world = createWorld(5);
  const before = Object.fromEntries(INGREDIENTS.map((item) => [item.id, onHandOf(world, item.id)]));
  const served = nextOrder(world);
  for (const [id, amount] of Object.entries(served.usage)) assert.equal(onHandOf(world, id), before[id] - amount);
  assert.equal(served.made + served.missed, served.order.lines.length);
});

test("running 30 days twice with the same seed gives identical results", () => {
  const run = (seed: number) => {
    const world = createWorld(seed);
    for (let day = 0; day < 30; day += 1) simulateDay(world);
    return world;
  };
  const first = run(2026);
  const second = run(2026);
  assert.deepEqual(first, second);
  assert.equal(first.days.length, 30);
  assert.notDeepEqual(run(2027).days, first.days);
});

test("all money in the data is whole cents", () => {
  for (const supplier of SUPPLIERS) {
    assert.ok(Number.isInteger(supplier.shippingCents) && Number.isInteger(supplier.freeShippingAtCents));
    for (const offer of supplier.offers) for (const tier of offer.tiers) assert.ok(Number.isInteger(tier.packPriceCents));
  }
  for (const drink of DRINKS) assert.ok(Number.isInteger(drink.priceCents) && drink.priceCents > 0);
  const world = createWorld(1);
  for (let day = 0; day < 3; day += 1) simulateDay(world);
  for (const stats of world.days) assert.ok(Number.isInteger(stats.revenueCents) && Number.isInteger(stats.inventoryValueCents));
  assert.equal(formatCents(123456), "$1,234.56");
});
