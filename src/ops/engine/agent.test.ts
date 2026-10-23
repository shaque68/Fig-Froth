import test from "node:test";
import assert from "node:assert/strict";
import { runAgent } from "./agent.ts";
import { INGREDIENTS, SETTINGS, getIngredient, getSupplier, offerFor } from "./data.ts";
import { onHand } from "./inventory.ts";
import { freshnessCap, itemState, planSimple, planSmart } from "./planner.ts";
import { approvePo, checkGuardrails, committedThisWeek, receiveDeliveries, rejectPo } from "./purchasing.ts";
import { runToDay } from "./shop.ts";
import { createWorld, emptyEffects, newBatch, type PurchaseOrder, type World } from "./sim.ts";

/** Sets an item's stock to `daysOfStock` days of its current usage, as one fresh batch. */
function setDays(world: World, ingredientId: string, daysOfStock: number) {
  const usage = itemState(world, getIngredient(ingredientId)).usage;
  world.stock[ingredientId] = [newBatch(world, ingredientId, Math.round(usage * daysOfStock), 1000, world.day, "test")];
}

/** A world where everything is comfortably stocked, so each test can make one thing low. */
function calmWorld(seed = 3): World {
  const world = createWorld(seed);
  for (const ingredient of INGREDIENTS) setDays(world, ingredient.id, 25);
  return world;
}

const linesFor = (pos: Array<{ supplierId: string; lines: Array<{ ingredientId: string }> }>, supplierId: string) =>
  pos.filter((po) => po.supplierId === supplierId).flatMap((po) => po.lines.map((line) => line.ingredientId));

test("rule 1: only items at or below their reorder point start an order", () => {
  const world = calmWorld();
  setDays(world, "hot-cups", 3); // Paper Crane: 4-day lead + 2 safety days = reorder at 6 days
  const plan = planSmart(world);
  assert.deepEqual(plan.atReorderPoint, ["hot-cups"]);
  assert.deepEqual(plan.pos.map((po) => po.supplierId), ["paper-crane"]);
  assert.match(plan.pos[0].reasons[0].text, /reorder point/);
});

test("rule 2: items from the same supplier that will need ordering soon ship together", () => {
  const world = calmWorld();
  setDays(world, "hot-cups", 3);
  setDays(world, "lids", 8); // above its 6-day reorder point, but within the 4-day look-ahead
  setDays(world, "straws", 20); // not soon: stays off the order
  const plan = planSmart(world);
  const lines = plan.pos[0].lines;
  assert.equal(lines.find((line) => line.ingredientId === "lids")?.role, "pulled-forward");
  assert.ok(!lines.some((line) => line.ingredientId === "straws"));
  assert.ok(plan.pos[0].reasons.some((reason) => /early/.test(reason.text) && reason.savingsCents === getSupplier("paper-crane").shippingCents));
});

test("rule 3: an order just under free shipping is topped up with items we'll use soon", () => {
  const world = calmWorld();
  setDays(world, "whole-milk", 2); // a milk order that lands just under Little Meadow's free-shipping line
  const plan = planSmart(world);
  const po = plan.pos.find((candidate) => candidate.supplierId === "little-meadow")!;
  assert.ok(po.subtotalCents >= getSupplier("little-meadow").freeShippingAtCents, `subtotal ${po.subtotalCents}`);
  assert.equal(po.shippingCents, 0);
  const reason = po.reasons.find((candidate) => candidate.rule === "Free shipping");
  assert.ok(reason, "explains the top-up");
  assert.match(reason!.text, /^Added 1 gallon jug of whole milk \(\$4\.70\) to reach free shipping, saving \$12\.00/);
  assert.equal(po.savings.shippingAvoidedCents, 1200);
});

test("rule 3: no top-up when the gap is too big to be worth it", () => {
  const world = calmWorld();
  for (const id of ["cold-cups", "lids", "straws"]) setDays(world, id, 30);
  world.demandHistory["hot-cups"] = world.demandHistory["hot-cups"].map(() => 10);
  setDays(world, "hot-cups", 3);
  const po = planSmart(world).pos[0];
  assert.ok(!po.reasons.some((reason) => reason.rule === "Free shipping"));
  assert.equal(po.shippingCents, getSupplier("paper-crane").shippingCents);
});

test("rule 4: bulk tiers are only taken when perishables will be used before they expire", () => {
  const world = calmWorld();
  setDays(world, "strawberry-puree", 1);
  setDays(world, "cold-cups", 5);
  const plan = planSmart(world);
  for (const po of plan.pos) {
    for (const line of po.lines) {
      const state = itemState(world, getIngredient(line.ingredientId));
      const cap = freshnessCap(world, state, getSupplier(po.supplierId));
      if (cap !== null && line.packs > 1) assert.ok(line.packs * line.packSize <= cap, `${line.ingredientId} would spoil`);
    }
  }
  const cups = plan.pos.flatMap((po) => po.lines).find((line) => line.ingredientId === "cold-cups")!;
  assert.ok(cups.packPriceCents < cups.basePackPriceCents, "non-perishable cups move up to a bulk tier");
  assert.ok(plan.pos.some((po) => po.reasons.some((reason) => reason.rule === "Bulk price" && /before it expires|within about/.test(reason.text))));
});

test("rule 5: the weekly cash cap is respected and the least urgent items are deferred", () => {
  const world = calmWorld();
  setDays(world, "ceremonial-matcha", 3);
  setDays(world, "hot-cups", 5.8);
  setDays(world, "strawberry-puree", 1);
  const spent: PurchaseOrder = {
    id: "PO-TEST", supplierId: "mossy-hill", status: "received", lines: [], subtotalCents: 0, shippingCents: 0,
    totalCents: SETTINGS.weeklyCashCapCents - 25000, reasons: [], createdDay: world.day, promisedDay: 0, arrivalDay: 0,
    needsApproval: false, savings: { bulkCents: 0, shippingAvoidedCents: 0 },
  };
  world.purchaseOrders.push(spent);
  const plan = planSmart(world);
  const total = plan.pos.reduce((sum, po) => sum + po.totalCents, 0);
  assert.ok(total <= 25000, `plan total ${total} exceeds the remaining budget`);
  assert.ok(plan.deferred.length > 0);
  // Matcha is the most at risk but far too big for what's left; strawberry purée (1 day left) still fits.
  assert.ok(plan.pos.some((po) => po.lines.some((line) => line.ingredientId === "strawberry-puree")));
  assert.ok(plan.deferred.some((item) => item.ingredientId === "ceremonial-matcha" && /Couldn't fit .* Flagged for you/.test(item.reason)));
});

test("rule 6: picks the lowest landed cost among approved suppliers that deliver in time", () => {
  const world = calmWorld();
  setDays(world, "oat-milk", 2.5);
  setDays(world, "strawberry-puree", 1.5);
  setDays(world, "mango-puree", 1.5);
  setDays(world, "fig-syrup", 2);
  setDays(world, "banana-syrup", 2);
  const plan = planSmart(world);
  // Orchard Lane is already shipping (free), so its oat milk lands cheaper than a separate dairy delivery.
  assert.ok(linesFor(plan.pos, "orchard-lane").includes("oat-milk"));
  const reason = plan.pos.flatMap((po) => po.reasons).find((candidate) => candidate.rule === "Best supplier" && /Orchard Lane/.test(candidate.text));
  assert.ok(reason, "explains the switch");
});

test("rule 6: never uses an unapproved supplier, even when it's cheaper", () => {
  const world = calmWorld();
  setDays(world, "ceremonial-matcha", 6);
  const plan = planSmart(world);
  assert.deepEqual(plan.pos.map((po) => po.supplierId), ["mossy-hill"]);
  assert.ok(plan.pos[0].reasons.some((reason) => /Bargain Leaf Imports is cheaper but isn't an approved supplier/.test(reason.text)));
});

test("rule 6: skips a supplier that can't deliver before we run out", () => {
  const world = calmWorld();
  setDays(world, "culinary-matcha", 2); // Mossy Hill takes 5 days; Orchard Lane takes 2
  const plan = planSmart(world);
  assert.ok(linesFor(plan.pos, "orchard-lane").includes("culinary-matcha"));
  assert.ok(!linesFor(plan.pos, "mossy-hill").includes("culinary-matcha"));
});

test("simple ordering: one item per order, base price, full shipping", () => {
  const world = calmWorld();
  setDays(world, "hot-cups", 2);
  setDays(world, "lids", 2);
  const plan = planSimple(world);
  assert.equal(plan.pos.length, 2);
  for (const po of plan.pos) {
    assert.equal(po.lines.length, 1);
    assert.equal(po.shippingCents, getSupplier(po.supplierId).shippingCents);
    assert.equal(po.lines[0].packPriceCents, offerFor(getSupplier(po.supplierId), po.lines[0].ingredientId)!.tiers[0].packPriceCents);
  }
});

test("guardrail: orders over the approval limit wait for a person; smaller ones go out", () => {
  const world = calmWorld();
  setDays(world, "ceremonial-matcha", 3);
  setDays(world, "whole-milk", 2);
  const run = runAgent(world);
  const matcha = world.purchaseOrders.find((po) => po.supplierId === "mossy-hill")!;
  const milk = world.purchaseOrders.find((po) => po.supplierId === "little-meadow")!;
  assert.ok(matcha.totalCents > SETTINGS.approvalThresholdCents);
  assert.equal(matcha.status, "awaiting");
  assert.ok(milk.totalCents <= SETTINGS.approvalThresholdCents);
  assert.equal(milk.status, "sent");
  assert.deepEqual(run.awaitingIds, [matcha.id]);
  assert.deepEqual(checkGuardrails(world), []);
});

test("guardrail: no duplicate open orders for the same item", () => {
  const world = calmWorld();
  setDays(world, "whole-milk", 2);
  runAgent(world);
  const first = world.purchaseOrders.length;
  world.demandHistory["whole-milk"] = world.demandHistory["whole-milk"].map((value) => value * 3);
  runAgent(world); // milk now looks low even counting the open order, but it's already on order
  assert.equal(world.purchaseOrders.length, first);
  assert.ok(world.log.some((entry) => /already on order/.test(entry.detail ?? "")));
});

test("approving sends the order; it arrives after the lead time and refills the shelf", () => {
  const world = calmWorld();
  setDays(world, "ceremonial-matcha", 3);
  runAgent(world);
  const po = world.purchaseOrders.find((candidate) => candidate.status === "awaiting")!;
  assert.equal(approvePo(world, po.id), true);
  assert.equal(po.status, "sent");
  assert.equal(po.approvedBy, "you");
  assert.equal(po.arrivalDay, world.day + getSupplier("mossy-hill").leadDays);
  const before = onHand(world.stock["ceremonial-matcha"]);
  world.day = po.arrivalDay;
  receiveDeliveries(world);
  assert.ok(["matched", "flagged"].includes(po.status), "the invoice is checked on arrival");
  const ordered = po.lines.find((line) => line.ingredientId === "ceremonial-matcha")!;
  const received = po.receipt!.find((line) => line.ingredientId === "ceremonial-matcha")!;
  assert.ok(received.packs >= ordered.packs - 1);
  assert.equal(onHand(world.stock["ceremonial-matcha"]), before + received.packs * ordered.packSize);
  assert.ok(world.log.some((entry) => entry.actor === "you" && entry.poId === po.id));
});

test("rejecting frees the item so the agent can plan it again", () => {
  const world = calmWorld();
  setDays(world, "ceremonial-matcha", 3);
  runAgent(world);
  const po = world.purchaseOrders.find((candidate) => candidate.status === "awaiting")!;
  assert.equal(rejectPo(world, po.id), true);
  assert.equal(approvePo(world, po.id), false, "a rejected order can't be approved");
  runAgent(world);
  assert.ok(world.purchaseOrders.some((candidate) => candidate.id !== po.id && candidate.status === "awaiting"));
});

test("a late delivery gets a backup order that only a person can send", () => {
  const effects = { ...emptyEffects(), delays: [{ supplierId: "paper-crane", extraDays: 5, fromDay: 0, toDay: 10 }] };
  const world = createWorld(2026, "late-delivery", { effects });
  runToDay(world, 12, (current) => current.purchaseOrders.some((po) => po.isBackup));
  const backup = world.purchaseOrders.find((po) => po.isBackup);
  assert.ok(backup, "a backup was drafted");
  assert.equal(backup!.status, "awaiting");
  assert.notEqual(backup!.supplierId, "paper-crane");
  assert.ok(world.log.some((entry) => / is late$/.test(entry.title)));
  assert.deepEqual(checkGuardrails(world), []);
});

test("30 days of smarter ordering never breaks a guardrail, across seeds", () => {
  for (const seed of [1, 7, 2026, 31415]) {
    const world = createWorld(seed, "normal", { autoApproveAll: true });
    runToDay(world, 30);
    assert.deepEqual(checkGuardrails(world), [], `seed ${seed}`);
    for (let day = 0; day < 30; day += 7) assert.ok(committedThisWeek(world, day) <= SETTINGS.weeklyCashCapCents);
    assert.ok(world.purchaseOrders.every((po) => getSupplier(po.supplierId).approved));
    assert.ok(world.purchaseOrders.every((po) => po.lines.every((line) => Number.isInteger(line.totalCents)) && Number.isInteger(po.totalCents)));
  }
});

test("the agent replays identically with the same seed", () => {
  const run = () => {
    const world = createWorld(2026, "normal", { autoApproveAll: true });
    runToDay(world, 21);
    return world;
  };
  assert.deepEqual(run(), run());
});

test("the comparison runs both policies on the same customers and explains the result", async () => {
  const { runComparison } = await import("./compare.ts");
  const result = runComparison(2026);
  assert.equal(result.simple.drinksMade + result.simple.drinksMissed, result.smart.drinksMade + result.smart.drinksMissed, "same customer demand");
  assert.equal(result.simple.goodsCents + result.simple.shippingCents, result.simple.spendCents);
  assert.ok(result.smart.shippingCents < result.simple.shippingCents);
  assert.ok(result.smart.spendCents < result.simple.spendCents);
  assert.match(result.takeaway, /^Over 30 simulated days, smarter ordering spent \$[\d,]+ less/);
  assert.deepEqual(runComparison(2026), result, "repeatable");
});
