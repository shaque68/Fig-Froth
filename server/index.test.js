import test from "node:test";
import assert from "node:assert/strict";
import { initialProducts } from "../src/catalog.ts";
import { createServer } from "node:http";

process.env.SQUARE_ENVIRONMENT = "sandbox";
process.env.SQUARE_ACCESS_TOKEN = "test-square-token";
process.env.SQUARE_LOCATION_ID = "test-location";
process.env.APP_BASE_URL = "http://localhost:5173";

const { app, buildLineItems, validatePaymentUrl } = await import("./index.js");

test("builds Square line items using trusted prices and selected modifier prices", () => {
  const lineItems = buildLineItems([{
    productId: "fig-matcha",
    quantity: 2,
    selections: { Milk: "Oat milk", Sweetness: "Regular" },
    price: 0.01,
  }]);

  assert.deepEqual(lineItems, [{
    name: "Fig & Froth Matcha",
    quantity: "2",
    base_price_money: { amount: 950, currency: "USD" },
    modifiers: [
      { name: "Milk: Oat milk", base_price_money: { amount: 75, currency: "USD" } },
      { name: "Sweetness: Regular", base_price_money: { amount: 0, currency: "USD" } },
    ],
  }]);
});

test("rejects unavailable items and invalid or missing modifier selections", () => {
  assert.throws(() => buildLineItems([{
    productId: "sha3r-matcha",
    quantity: 1,
    selections: { Milk: "Whole milk", Sweetness: "Regular" },
  }]), /no longer available/);

  assert.throws(() => buildLineItems([{
    productId: "fig-matcha",
    quantity: 1,
    selections: { Milk: "Rice milk", Sweetness: "Regular" },
  }]), /choices have changed/);

  assert.throws(() => buildLineItems([{
    productId: "fig-matcha",
    quantity: 1,
    selections: { Sweetness: "Regular" },
  }]), /choose an option for milk/i);

  assert.throws(() => buildLineItems([{
    productId: "oat-latte",
    quantity: 1,
    selections: { Unknown: "value" },
  }]), /choices have changed/);
});

test("server payment prices are separate from browser catalog edits", () => {
  assert.equal(initialProducts.find((product) => product.id === "fig-matcha")?.price, 9.5);
  assert.equal(buildLineItems([{
    productId: "fig-matcha",
    quantity: 1,
    selections: { Milk: "Whole milk", Sweetness: "Regular" },
    price: 0,
  }])[0].base_price_money.amount, 950);
});

test("accepts only secure Square-hosted payment URLs", () => {
  assert.equal(validatePaymentUrl("https://square.link/u/example"), true);
  assert.equal(validatePaymentUrl("https://sandbox.square.link/u/example"), true);
  assert.equal(validatePaymentUrl("https://attacker.example/"), false);
  assert.equal(validatePaymentUrl("http://square.link/u/example"), false);
});

test("creates a Square hosted link from validated catalog data and preserves pickup time", async () => {
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  const realFetch = globalThis.fetch;
  let squareRequest;
  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith("https://connect.squareupsandbox.com/")) {
      squareRequest = { input: String(input), init, body: JSON.parse(String(init?.body)) };
      return new Response(JSON.stringify({ payment_link: { url: "https://sandbox.square.link/u/test-link" } }), { status: 200 });
    }
    return realFetch(input, init);
  };

  try {
    const body = {
      idempotencyKey: "f4e7d38a-0a9f-4ed3-9fe8-cad1a3eeddb4",
      items: [{
        productId: "fig-matcha",
        quantity: 1,
        selections: { Milk: "Oat milk", Sweetness: "Regular" },
      }],
      pickupTime: "In 30 minutes",
      buyer: { name: "Test Customer", email: "customer@example.com" },
    };
    const forgedResponse = await realFetch(`http://127.0.0.1:${address.port}/api/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, items: [{ ...body.items[0], price: 0.01 }] }),
    });
    assert.equal(forgedResponse.status, 400);
    assert.equal(squareRequest, undefined);

    const response = await realFetch(`http://127.0.0.1:${address.port}/api/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json();

    assert.equal(response.status, 201, JSON.stringify(result));
    assert.equal(result.checkoutUrl, "https://sandbox.square.link/u/test-link");
    assert.equal(squareRequest.body.order.line_items[0].base_price_money.amount, 950);
    assert.equal(squareRequest.body.order.line_items[0].modifiers[0].base_price_money.amount, 75);
    assert.equal(squareRequest.body.order.location_id, "test-location");
    assert.equal(squareRequest.body.idempotency_key, body.idempotencyKey);
    assert.equal(squareRequest.body.order.pricing_options.auto_apply_taxes, true);
    assert.equal(squareRequest.body.order.fulfillments[0].pickup_details.schedule_type, "SCHEDULED");
    assert.ok(squareRequest.body.order.fulfillments[0].pickup_details.pickup_at);
    assert.equal(squareRequest.body.pre_populated_data.buyer_email, "customer@example.com");
  } finally {
    globalThis.fetch = realFetch;
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
