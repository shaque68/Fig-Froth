import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import express from "express";
import { createOwnerAuth } from "./admin-auth.js";

// No Square settings in this file: the storefront falls back to pay-at-pickup orders.
delete process.env.SQUARE_ACCESS_TOKEN;
delete process.env.SQUARE_LOCATION_ID;
process.env.OWNER_PASSWORD = "matcha-owner-test";
const { app } = await import("./index.js");

async function serve(handler, run) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const json = (body) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const cookieFrom = (response) => (response.headers.get("set-cookie") ?? "").split(";")[0];

function authApp(options) {
  const auth = createOwnerAuth({ secret: "test-secret", secureCookies: false, ...options });
  const testApp = express();
  testApp.use(express.json());
  auth.register(testApp);
  testApp.get("/owner-only", auth.requireOwner, (_req, res) => res.json({ ok: true }));
  return testApp;
}

test("the owner signs in with the server's password and gets an HTTP-only session cookie", async () => {
  await serve(authApp({ password: "letmein" }), async (base) => {
    assert.deepEqual(await (await fetch(`${base}/api/admin/session`)).json(), { configured: true, signedIn: false });
    assert.equal((await fetch(`${base}/owner-only`)).status, 401);

    const wrong = await fetch(`${base}/api/admin/login`, json({ password: "nope" }));
    assert.equal(wrong.status, 401);
    assert.equal(wrong.headers.get("set-cookie"), null);

    const right = await fetch(`${base}/api/admin/login`, json({ password: "letmein" }));
    assert.equal(right.status, 200);
    const setCookie = right.headers.get("set-cookie") ?? "";
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Strict/);
    const cookie = cookieFrom(right);
    assert.deepEqual(await (await fetch(`${base}/api/admin/session`, { headers: { cookie } })).json(), { configured: true, signedIn: true });
    assert.equal((await fetch(`${base}/owner-only`, { headers: { cookie } })).status, 200);

    const tampered = cookie.replace(/\.[^.]+$/, ".forged");
    assert.equal((await fetch(`${base}/owner-only`, { headers: { cookie: tampered } })).status, 401);

    const out = await fetch(`${base}/api/admin/logout`, { method: "POST" });
    assert.match(out.headers.get("set-cookie") ?? "", /Max-Age=0/);
  });
});

test("sessions expire, and sign-in is closed until a password is configured", async () => {
  let clock = 1_000_000;
  await serve(authApp({ password: "letmein", now: () => clock }), async (base) => {
    const cookie = cookieFrom(await fetch(`${base}/api/admin/login`, json({ password: "letmein" })));
    clock += 13 * 60 * 60 * 1000;
    assert.equal((await fetch(`${base}/owner-only`, { headers: { cookie } })).status, 401);
  });
  await serve(authApp({ password: "" }), async (base) => {
    assert.deepEqual(await (await fetch(`${base}/api/admin/session`)).json(), { configured: false, signedIn: false });
    assert.equal((await fetch(`${base}/api/admin/login`, json({ password: "" }))).status, 503);
  });
});

test("repeated wrong passwords are slowed down", async () => {
  await serve(authApp({ password: "letmein" }), async (base) => {
    let last = 0;
    for (let attempt = 0; attempt < 9; attempt += 1) last = (await fetch(`${base}/api/admin/login`, json({ password: "guess" }))).status;
    assert.equal(last, 429);
  });
});

test("without Square, a pickup order is recorded once and shows up in the owner's feed", async () => {
  await serve(app, async (base) => {
    const status = await (await fetch(`${base}/api/checkout/status`)).json();
    assert.equal(status.available, false);
    assert.equal(status.pickupAvailable, true);

    const order = {
      idempotencyKey: randomUUID(),
      items: [{ productId: "strawberry-booza", quantity: 2, selections: { Milk: "Oat milk", Sweetness: "Regular" } }],
      pickupTime: "In 30 minutes",
      buyer: { name: "Test Customer", email: "customer@example.com" },
    };
    const placed = await fetch(`${base}/api/orders/pickup`, json(order));
    assert.equal(placed.status, 201);
    const { orderNumber } = await placed.json();
    assert.match(orderNumber, /^W-\d{4}$/);
    const retried = await (await fetch(`${base}/api/orders/pickup`, json(order))).json();
    assert.equal(retried.orderNumber, orderNumber, "a retry doesn't create a second order");

    assert.equal((await fetch(`${base}/api/orders/pickup`, json({ ...order, idempotencyKey: randomUUID(), items: [{ productId: "not-a-drink", quantity: 1, selections: {} }] }))).status, 400);

    assert.equal((await fetch(`${base}/api/admin/orders`)).status, 401, "the feed is owner-only");
    assert.equal((await fetch(`${base}/api/ops/claude/status`)).status, 401, "Claude mode is owner-only");

    const cookie = cookieFrom(await fetch(`${base}/api/admin/login`, json({ password: "matcha-owner-test" })));
    const { orders } = await (await fetch(`${base}/api/admin/orders?after=0`, { headers: { cookie } })).json();
    assert.equal(orders.length, 1);
    assert.equal(orders[0].number, orderNumber);
    assert.equal(orders[0].source, "pickup");
    assert.deepEqual(orders[0].items, [{ productId: "strawberry-booza", name: "Strawberry Booza Matcha", quantity: 2, selections: { Milk: "Oat milk", Sweetness: "Regular" } }]);
    assert.ok(!JSON.stringify(orders).includes("customer@example.com"), "buyer details stay out of the feed");
    const later = await (await fetch(`${base}/api/admin/orders?after=${orders[0].id}`, { headers: { cookie } })).json();
    assert.deepEqual(later.orders, []);
  });
});
