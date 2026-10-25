import test from "node:test";
import assert from "node:assert/strict";
import { initialProducts } from "../../catalog.ts";
import { priceCart, saleUnitCents } from "../../pricing.ts";
import { dayConditions, generateDayOrders } from "./orders.ts";
import { drinkProfits } from "./profit.ts";
import { bestOption, bundleOptions, discountOptions, endPromotion, MARGIN_FLOOR, promotionCopy, publishPromotion, storePromotions, suggestPromotions } from "./promotions.ts";
import { approvePo } from "./purchasing.ts";
import { createScenarioWorld } from "./scenarios.ts";
import { runToDay } from "./shop.ts";
import { serveOrder, type World } from "./sim.ts";

const discount = { id: "PR-1", kind: "discount" as const, productIds: ["classic-matcha"], percentOff: 20 };
const bundle = { id: "PR-2", kind: "bundle" as const, productIds: ["classic-matcha", "fig-matcha"], percentOff: 10 };

test("sale prices and bundles price a cart the same way everywhere", () => {
  assert.deepEqual(saleUnitCents("classic-matcha", 800, [discount]), { cents: 640, promotionId: "PR-1" });
  assert.deepEqual(saleUnitCents("fig-matcha", 950, [discount]), { cents: 950 });

  const lines = [
    { productId: "classic-matcha", quantity: 3, unitCents: 800, extrasCents: 75 },
    { productId: "fig-matcha", quantity: 2, unitCents: 950 },
  ];
  assert.equal(priceCart(lines, []).subtotalCents, 3 * 875 + 2 * 950);
  assert.equal(priceCart(lines, []).savingsCents, 0);

  const priced = priceCart(lines, [discount, bundle]);
  // Classic is on sale at $6.40 (oat milk is never discounted); two pairs get 10% off $6.40 + $9.50.
  assert.equal(priced.lines[0].saleUnitCents, 640);
  assert.deepEqual(priced.bundles, [{ promotionId: "PR-2", productIds: ["classic-matcha", "fig-matcha"], count: 2, discountCents: 2 * 159 }]);
  assert.equal(priced.subtotalCents, 3 * (640 + 75) + 2 * 950 - 318);
  assert.equal(priced.savingsCents, 3 * 160 + 318);

  // A drink counts toward one bundle at most.
  const overlapping = priceCart([{ productId: "classic-matcha", quantity: 1, unitCents: 800 }, { productId: "fig-matcha", quantity: 1, unitCents: 950 }, { productId: "mango-sticky", quantity: 1, unitCents: 1000 }],
    [bundle, { id: "PR-3", kind: "bundle", productIds: ["classic-matcha", "mango-sticky"], percentOff: 15 }]);
  assert.equal(overlapping.bundles.length, 1);
});

test("promotions don't change the regular customers, and a sale brings extra ones", () => {
  const conditions = dayConditions(2026, 3);
  const regular = generateDayOrders(2026, conditions);
  assert.deepEqual(generateDayOrders(2026, conditions, { promotions: [] }), regular);
  const withSale = generateDayOrders(2026, conditions, { promotions: [discount] });
  const extra = withSale.filter((order) => order.note === "On sale");
  assert.ok(extra.length >= 4, `expected sale customers, got ${extra.length}`);
  assert.ok(extra.every((order) => order.lines.length === 1 && order.lines[0].drinkId === "classic-matcha"));
  assert.deepEqual(withSale.filter((order) => !order.note), regular);

  const withBundle = generateDayOrders(2026, conditions, { promotions: [bundle] });
  const upsold = withBundle.filter((order) => order.note === "Bundle");
  assert.ok(upsold.length >= 2);
  assert.ok(upsold.every((order) => order.lines.some((line) => line.drinkId === "classic-matcha") && order.lines.some((line) => line.drinkId === "fig-matcha")));
  assert.equal(withBundle.length, regular.length);
});

test("nothing is suggested when nothing is at risk", () => {
  assert.deepEqual(suggestPromotions(createScenarioWorld(2026, "normal")), []);
});

test("near expiry, the agent suggests a sale and a bundle that keep every margin above the floor", () => {
  const world = createScenarioWorld(2026, "near-expiry");
  const suggestions = suggestPromotions(world);
  const sale = suggestions.find((suggestion) => suggestion.kind === "discount")!;
  const pair = suggestions.find((suggestion) => suggestion.kind === "bundle")!;
  assert.ok(sale && pair);
  assert.equal(sale.atRisk?.ingredientId, "ceremonial-matcha");
  const usesMatcha = (id: string) => drinkProfits(world).find((profit) => profit.drink.id === id)!.drink.recipe.some((line) => line.ingredientId === "ceremonial-matcha");
  assert.ok(usesMatcha(sale.productIds[0]));
  assert.ok(usesMatcha(pair.productIds[0]));
  for (const suggestion of suggestions) {
    const chosen = suggestion.options.find((option) => option.percentOff === suggestion.recommended)!;
    assert.equal(chosen, bestOption(suggestion.options));
    assert.ok(chosen.allowed && chosen.marginAfter >= MARGIN_FLOOR);
    assert.ok(chosen.netCents > 0 && chosen.savedQty > 0);
    assert.equal(chosen.netCents, chosen.savedCents + chosen.extraProfitCents - chosen.givenAwayCents);
    for (const option of suggestion.options) assert.equal(option.allowed, option.marginAfter >= MARGIN_FLOOR, `${suggestion.key} ${option.percentOff}%`);
  }
  // The sale is only offered on drinks customers can order online.
  const offline = initialProducts.filter((product) => !product.available).map((product) => product.id);
  assert.ok(suggestions.every((suggestion) => suggestion.productIds.every((id) => !offline.includes(id))));
});

test("a discount that breaks the margin floor can't be chosen", () => {
  // Matcha costs 25% more in this scenario, so the deepest sale on the Fig & Froth Matcha is off the table.
  const world = createScenarioWorld(2026, "price-increase");
  const options = discountOptions(world, "fig-matcha");
  const fig = drinkProfits(world).find((profit) => profit.drink.id === "fig-matcha")!;
  for (const option of options) assert.equal(option.allowed, (option.priceCents - fig.costCents) / option.priceCents >= MARGIN_FLOOR);
  const deepest = options.at(-1)!;
  assert.equal(deepest.allowed, false);
  assert.match(deepest.blockedReason ?? "", /under the 60% floor/);
  assert.notEqual(bestOption(options)?.percentOff, deepest.percentOff);
  assert.ok(bundleOptions(world, ["fig-matcha", "classic-matcha"]).every((option) => option.extraPerDay > 0 && option.givenAwayCents > 0));
});

function runWeek(world: World, publish: boolean) {
  if (publish) {
    for (let round = 0; round < 2; round += 1) {
      const suggestion = suggestPromotions(world)[0];
      if (!suggestion) break;
      const option = suggestion.options.find((candidate) => candidate.percentOff === suggestion.recommended)!;
      publishPromotion(world, { kind: suggestion.kind, productIds: suggestion.productIds, percentOff: suggestion.recommended, option, atRisk: suggestion.atRisk });
    }
  }
  runToDay(world, 8, (current) => {
    for (const po of current.purchaseOrders.filter((candidate) => candidate.status === "awaiting")) approvePo(current, po.id);
    return false;
  });
  return world;
}

test("publishing the suggested promotions throws out less matcha, and they end on the use-by date", () => {
  const wasted = (world: World) => world.waste.filter((record) => record.ingredientId === "ceremonial-matcha").reduce((sum, record) => sum + record.valueCents, 0);
  const without = runWeek(createScenarioWorld(2026, "near-expiry"), false);
  const withPromos = runWeek(createScenarioWorld(2026, "near-expiry"), true);
  assert.ok(wasted(withPromos) < wasted(without) * 0.5, `${wasted(withPromos)} vs ${wasted(without)}`);
  assert.equal(withPromos.promotions.length, 2);
  for (const promo of withPromos.promotions) {
    assert.equal(promo.status, "ended");
    assert.match(promo.endedReason ?? "", /use-by date|used up/);
    assert.ok(promo.results.discountCents > 0);
  }
  assert.ok(withPromos.log.some((entry) => entry.actor === "you" && /You published a promotion/.test(entry.title)));
  assert.ok(withPromos.log.some((entry) => entry.actor === "agent" && /Ended the promotion/.test(entry.title)));
  assert.deepEqual(storePromotions(withPromos), []);
});

test("a live sale charges the sale price, records results, and shows on the storefront until ended", () => {
  const world = createScenarioWorld(2026, "normal");
  const option = discountOptions(world, "classic-matcha")[1];
  const promo = publishPromotion(world, { kind: "discount", productIds: ["classic-matcha"], percentOff: option.percentOff, option });
  const served = serveOrder(world, { id: "T-1", day: world.day, minute: world.minute, lines: [{ drinkId: "classic-matcha", iced: true, milk: "oat" }] });
  assert.equal(served.revenueCents, option.priceCents + 75);
  assert.deepEqual(promo.results, { drinks: 1, bundles: 0, discountCents: 800 - option.priceCents });
  assert.ok(world.queue.some((order) => order.note === "On sale"), "today's remaining customers see it too");

  const [store] = storePromotions(world);
  assert.deepEqual(Object.keys(store).sort(), ["detail", "headline", "id", "kind", "percentOff", "productIds"]);
  endPromotion(world, promo.id, "you", "Ended early.");
  assert.deepEqual(storePromotions(world), []);
  assert.match(world.log.at(-1)!.title, /You ended the promotion/);
});

test("customer-facing copy never mentions expiry or waste", () => {
  for (const kind of ["discount", "bundle"] as const) {
    const copy = promotionCopy(kind, kind === "discount" ? ["fig-matcha"] : ["fig-matcha", "classic-matcha"], 15);
    assert.doesNotMatch(`${copy.headline} ${copy.detail}`, /expir|waste|thrown|use-by|old/i);
    assert.ok(copy.headline.length <= 140);
  }
});
