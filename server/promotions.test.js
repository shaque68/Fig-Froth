import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

// No Square settings: storefront orders are pay-at-pickup, priced by the server.
delete process.env.SQUARE_ACCESS_TOKEN;
delete process.env.SQUARE_LOCATION_ID;
process.env.OWNER_PASSWORD = "matcha-owner-test";
const { app, priceOrder } = await import("./index.js");

async function serve(run) {
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const sale = { id: "PR-1", kind: "discount", productIds: ["fig-matcha"], percentOff: 20, headline: "Last call: 20% off the Fig & Froth Matcha", detail: "While this batch lasts." };
const bundle = { id: "PR-2", kind: "bundle", productIds: ["fig-matcha", "classic-matcha"], percentOff: 10, headline: "Better together", detail: "Add both to your bag." };
const fig = { productId: "fig-matcha", quantity: 2, selections: { Milk: "Oat milk", Sweetness: "Regular" } };
const classic = { productId: "classic-matcha", quantity: 1, selections: { Milk: "Whole milk", Sweetness: "Regular" } };

test("sale prices go on the line items and bundles become a Square order discount", () => {
  const plain = priceOrder([fig, classic], []);
  assert.equal(plain.lineItems[0].base_price_money.amount, 950);
  assert.deepEqual(plain.discounts, []);
  assert.equal(plain.subtotalCents, 2 * (950 + 75) + 800);

  const promoted = priceOrder([fig, classic], [sale, bundle]);
  assert.equal(promoted.lineItems[0].base_price_money.amount, 760);
  assert.equal(promoted.lineItems[0].modifiers[0].base_price_money.amount, 75, "add-ons are never discounted");
  assert.equal(promoted.lineItems[1].base_price_money.amount, 800);
  // One pair: 10% off $7.60 + $8.00.
  assert.deepEqual(promoted.discounts, [{ uid: "PR-2", name: "Bundle: Fig & Froth Matcha + Classic Matcha", type: "FIXED_AMOUNT", amount_money: { amount: 156, currency: "USD" }, scope: "ORDER" }]);
  assert.equal(promoted.subtotalCents, 2 * (760 + 75) + 800 - 156);
  assert.equal(promoted.savingsCents, 2 * 190 + 156);
});

test("only the signed-in owner can publish promotions, and the storefront reads them", async () => {
  await serve(async (base) => {
    assert.deepEqual(await (await fetch(`${base}/api/promotions`)).json(), { promotions: [] });
    const put = (body, cookie) => fetch(`${base}/api/admin/promotions`, { method: "PUT", headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
    assert.equal((await put({ promotions: [sale] })).status, 401);

    const login = await fetch(`${base}/api/admin/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "matcha-owner-test" }) });
    const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];

    const invalid = [
      [{ ...sale, productIds: ["not-a-drink"] }],
      [{ ...sale, productIds: ["sha3r-matcha"] }],
      [{ ...sale, percentOff: 60 }],
      [{ ...sale, percentOff: 2 }],
      [{ ...bundle, productIds: ["fig-matcha", "fig-matcha"] }],
      [{ ...bundle, percentOff: 30 }],
      [{ ...sale, productIds: ["fig-matcha", "classic-matcha"] }],
      [sale, { ...sale }],
      [{ ...sale, price: 0.01 }],
      [{ ...sale, headline: "x".repeat(141) }],
    ];
    for (const promotions of invalid) assert.equal((await put({ promotions }, cookie)).status, 400, JSON.stringify(promotions));

    assert.equal((await put({ promotions: [sale, bundle] }, cookie)).status, 200);
    assert.deepEqual((await (await fetch(`${base}/api/promotions`)).json()).promotions, [sale, bundle]);

    const placed = await fetch(`${base}/api/orders/pickup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idempotencyKey: randomUUID(), items: [fig, classic], pickupTime: "Next available", buyer: { name: "Test Customer", email: "customer@example.com" } }),
    });
    assert.equal(placed.status, 201);
    const result = await placed.json();
    assert.equal(result.subtotalCents, 2 * (760 + 75) + 800 - 156);
    assert.equal(result.savingsCents, 2 * 190 + 156);

    assert.equal((await put({ promotions: [] }, cookie)).status, 200);
    assert.deepEqual((await (await fetch(`${base}/api/promotions`)).json()).promotions, []);
  });
});
