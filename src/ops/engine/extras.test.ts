import test from "node:test";
import assert from "node:assert/strict";
import { runComparison, runPolicy } from "./compare.ts";
import { getIngredient } from "./data.ts";
import { freshnessOutlook, startSpecial, suggestSpecial } from "./freshness.ts";
import { resolveInvoice, threeWayMatch } from "./match.ts";
import { itemState, planSmart } from "./planner.ts";
import { drinkProfits, marginLosers, TARGET_MARGIN } from "./profit.ts";
import { approvePo, checkGuardrails } from "./purchasing.ts";
import { createScenarioWorld, SCENARIOS } from "./scenarios.ts";
import { runToDay } from "./shop.ts";
import type { PurchaseOrder } from "./sim.ts";

test("every scenario replays identically and keeps the agent inside its guardrails", () => {
  for (const scenario of SCENARIOS) {
    const first = runPolicy(2026, scenario.id, "smart", 21);
    assert.deepEqual(runPolicy(2026, scenario.id, "smart", 21), first, scenario.id);
    assert.deepEqual(checkGuardrails(first), [], scenario.id);
  }
});

test("each scenario makes the agent do something different and explainable", () => {
  const logFor = (id: string) => runPolicy(2026, id, "smart", 10).log.map((entry) => `${entry.title} ${entry.detail ?? ""}`).join("\n");

  const heat = createScenarioWorld(2026, "heat-wave");
  assert.equal(heat.conditions.tempF, 93);
  const iced = runPolicy(2026, "heat-wave", "smart", 7).days.reduce((sum, day) => sum + day.drinksMade, 0);
  assert.ok(iced > 0);

  assert.match(logFor("price-increase"), /WebstaurantStore[^\n]*culinary matcha|culinary matcha[^\n]*WebstaurantStore|cheaper from WebstaurantStore/);
  assert.match(logFor("late-delivery"), /is late/);
  assert.match(logFor("late-delivery"), /Drafted backup PO-\d+/);
  assert.match(logFor("near-expiry"), /use it up/);
  assert.match(logFor("catering"), /upcoming booked order/);
});

test("the late-delivery backup keeps the cups from running out when approved", () => {
  const world = createScenarioWorld(2026, "late-delivery");
  runToDay(world, 14, (current) => {
    for (const po of current.purchaseOrders.filter((candidate) => candidate.status === "awaiting")) approvePo(current, po.id);
    return false;
  });
  assert.ok(world.purchaseOrders.some((po) => po.isBackup && po.approvedBy === "you"));
  assert.equal(world.days.reduce((sum, day) => sum + day.drinksMissed, 0), 0);
});

test("the heat wave sends more iced cups out the door than a normal week", () => {
  const cups = (id: string) => {
    const world = runPolicy(2026, id, "smart", 7);
    return world.demandHistory["cold-cups"].slice(-7).reduce((sum, value) => sum + value, 0);
  };
  assert.ok(cups("heat-wave") > cups("normal") * 1.25);
});

test("freshness: the expiring matcha batch is spotted, and the special saves stock", () => {
  const world = createScenarioWorld(2026, "near-expiry");
  const outlook = freshnessOutlook(world).filter((item) => item.ingredientId === "ceremonial-matcha");
  assert.ok(outlook[0].leftover > 0, "some matcha would be thrown out at today's pace");
  const suggestion = suggestSpecial(world)!;
  assert.equal(suggestion.ingredientId, "ceremonial-matcha");
  assert.ok(["classic-matcha", "fig-matcha", "strawberry-booza"].includes(suggestion.drinkId), "features a drink that uses ceremonial matcha");
  assert.ok(suggestion.savedQty > 0 && suggestion.savedCents > 0);
  assert.match(suggestion.text, /matcha of the day/);

  const wasteWith = (special: boolean) => {
    const copy = createScenarioWorld(2026, "near-expiry");
    if (special) startSpecial(copy, suggestSpecial(copy)!);
    runToDay(copy, 7, (current) => {
      for (const po of current.purchaseOrders.filter((candidate) => candidate.status === "awaiting")) approvePo(current, po.id);
      return false;
    });
    return copy.waste.filter((item) => item.ingredientId === "ceremonial-matcha").reduce((sum, item) => sum + item.qty, 0);
  };
  assert.ok(wasteWith(true) < wasteWith(false), "running the special wastes less matcha");
});

test("profit per drink: cost from current prices, and a price rise shows which drinks lose margin", () => {
  const world = createScenarioWorld(2026);
  const base = drinkProfits(world);
  for (const profit of base) {
    assert.ok(Number.isInteger(profit.costCents) && profit.costCents > 0);
    assert.equal(profit.marginCents, profit.priceCents - profit.costCents);
  }
  const pricier = drinkProfits(world, { supplierId: "ippodo", percent: 50 });
  const classic = (list: typeof base) => list.find((profit) => profit.drink.id === "classic-matcha")!;
  assert.ok(classic(pricier).costCents > classic(base).costCents);
  assert.ok(marginLosers(base, pricier).every((profit) => profit.margin < TARGET_MARGIN));
  // Culinary matcha switches to WebstaurantStore once Ippodo Tea is pricier, which caps the hit.
  const raised = createScenarioWorld(2026, "price-increase");
  const state = itemState(raised, getIngredient("culinary-matcha"));
  assert.ok(state.usage > 0);
});

test("three-way match catches short shipments, price slips, and surprise shipping", () => {
  const po: PurchaseOrder = {
    id: "PO-T", supplierId: "imperial-dade", status: "invoiced", subtotalCents: 0, shippingCents: 0, totalCents: 0, reasons: [],
    createdDay: 0, promisedDay: 4, arrivalDay: 4, needsApproval: false, savings: { bulkCents: 0, shippingAvoidedCents: 0 },
    lines: [
      { ingredientId: "lids", packs: 6, packSize: 100, packLabel: "sleeve of 100", packPriceCents: 1050, basePackPriceCents: 1200, totalCents: 6300, role: "needed" },
      { ingredientId: "straws", packs: 4, packSize: 250, packLabel: "box of 250", packPriceCents: 1300, basePackPriceCents: 1500, totalCents: 5200, role: "needed" },
    ],
    receipt: [{ ingredientId: "lids", packs: 5 }, { ingredientId: "straws", packs: 4 }],
    invoice: { lines: [{ ingredientId: "lids", packs: 6, packPriceCents: 1050 }, { ingredientId: "straws", packs: 4, packPriceCents: 1400 }], shippingCents: 2000, totalCents: 0 },
  };
  const result = threeWayMatch(po);
  assert.equal(result.ok, false);
  assert.equal(result.overchargeCents, 1050 + 400 + 2000);
  assert.equal(result.notes.length, 3);
  assert.match(result.notes[0], /^Billed for 6 sleeves of lids, but only 5 arrived: \$10\.50 too much\.$/);

  const clean = threeWayMatch({ ...po, receipt: [{ ingredientId: "lids", packs: 6 }, { ingredientId: "straws", packs: 4 }], invoice: { lines: [{ ingredientId: "lids", packs: 6, packPriceCents: 1050 }, { ingredientId: "straws", packs: 4, packPriceCents: 1300 }], shippingCents: 0, totalCents: 11500 } });
  assert.equal(clean.ok, true);
});

test("received orders are invoiced and matched; mismatches wait for a person", () => {
  const world = runPolicy(2026, "normal", "smart", 21);
  const arrived = world.purchaseOrders.filter((po) => po.receivedDay !== undefined);
  assert.ok(arrived.length > 5);
  assert.ok(arrived.every((po) => po.invoice && ["matched", "flagged"].includes(po.status)));
  const flagged = arrived.find((po) => po.status === "flagged");
  assert.ok(flagged, "the default seed includes at least one deliberate mismatch");
  assert.equal(resolveInvoice(world, flagged!.id, "dispute"), true);
  assert.equal(flagged!.status, "disputed");
  assert.ok(world.log.some((entry) => entry.actor === "you" && /disputed/.test(entry.title)));
});

test("smarter ordering misses no more drinks than simple ordering in any scenario", () => {
  for (const scenario of SCENARIOS) {
    const result = runComparison(2026, scenario.id);
    assert.ok(result.smart.drinksMissed <= result.simple.drinksMissed, scenario.id);
    assert.ok(result.smart.spendCents < result.simple.spendCents, scenario.id);
  }
});

test("smarter ordering never deliberately plans an unapproved supplier", () => {
  const world = createScenarioWorld(2026, "price-increase");
  const plan = planSmart(world);
  assert.ok(plan.pos.every((po) => po.supplierId !== "amazon-seller"));
});

test("demo-mode writing comes from templates and uses only engine numbers", async () => {
  const { buildSnapshot, demoBrief, demoExplanation, demoSupplierMessage } = await import("./brief.ts");
  const world = runPolicy(2026, "normal", "smart", 3);
  const brief = demoBrief(world);
  assert.match(brief, /^Good morning! It’s Thursday, June 4/);
  assert.match(brief, /Yesterday we made \d+ drinks/);
  const po = world.purchaseOrders[0];
  assert.match(demoExplanation(po), new RegExp(`^This \\$[\\d,.]+ order to ${po.supplierId === "restaurant-depot" ? "Restaurant Depot" : ".+"}`));
  const message = demoSupplierMessage(po);
  assert.match(message, /^Hi .+ team,/);
  assert.ok(!/@|\bphone\b|\d{3}-\d{4}/.test(message), "no contact details in the draft");
  const snapshot = buildSnapshot(world, po.id);
  assert.equal(snapshot.order?.id, po.id);
  assert.ok(JSON.stringify(snapshot).length < 16000, "small enough to send to the local server");
});
