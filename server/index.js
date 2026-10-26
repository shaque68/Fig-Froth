import "dotenv/config";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { z } from "zod";
import { initialProducts } from "../src/catalog.ts";
import { priceCart, saleUnitCents } from "../src/pricing.ts";
import { createOwnerAuth } from "./admin-auth.js";
import { registerOpsClaude } from "./ops-claude.js";
import { createPromotionBoard, registerPromotions } from "./promotions.js";
import { createOrderBook, orderItems } from "./shop-orders.js";

const app = express();
const port = Number(process.env.PORT || 3001);
const environment = process.env.SQUARE_ENVIRONMENT || "sandbox";
const accessToken = process.env.SQUARE_ACCESS_TOKEN;
const locationId = process.env.SQUARE_LOCATION_ID;
const publicBaseUrl = process.env.APP_BASE_URL;
const apiVersion = process.env.SQUARE_API_VERSION || "2025-08-20";
const squareBaseUrl = environment === "production"
  ? "https://connect.squareup.com"
  : "https://connect.squareupsandbox.com";
const productsById = new Map(initialProducts.map((product) => [product.id, product]));
const requestSchema = z.object({
  idempotencyKey: z.string().uuid(),
  items: z.array(z.object({
    productId: z.string().min(1).max(100),
    quantity: z.number().int().min(1).max(25),
    selections: z.record(z.string().max(80)).default({}),
  }).strict()).min(1).max(20),
  pickupTime: z.enum(["Next available", "In 30 minutes", "In 1 hour"]),
  buyer: z.object({
    name: z.string().trim().min(1).max(100),
    email: z.string().trim().email().max(254),
    phone: z.string().trim().max(30).optional(),
  }).strict(),
}).strict();
const rateLimits = new Map();
const serverDirectory = path.dirname(fileURLToPath(import.meta.url));
const distDirectory = path.resolve(serverDirectory, "../dist");
const allowedCheckoutHosts = new Set([
  "square.link",
  "sandbox.square.link",
  "checkout.square.site",
  "sandbox.checkout.square.site",
]);

app.disable("x-powered-by");
app.use(express.json({ limit: "32kb", strict: true }));

// Behind the Counter: owner sign-in, the storefront orders it shows as they arrive, and the
// promotions it publishes.
const ownerAuth = createOwnerAuth();
const orderBook = createOrderBook();
const promotionBoard = createPromotionBoard();
ownerAuth.register(app);
registerPromotions(app, { board: promotionBoard, productsById, guard: ownerAuth.requireOwner });

function validateConfiguration() {
  if (environment !== "sandbox" && environment !== "production") {
    return "SQUARE_ENVIRONMENT must be sandbox or production.";
  }
  if (!accessToken || !locationId || !publicBaseUrl) return null;
  try {
    const url = new URL(publicBaseUrl);
    if (url.protocol !== "https:" && !(environment === "sandbox" && url.hostname === "localhost" || environment === "sandbox" && url.hostname === "127.0.0.1")) {
      return "APP_BASE_URL must use HTTPS, except for localhost during sandbox development.";
    }
  } catch {
    return "APP_BASE_URL must be a valid absolute URL.";
  }
  return null;
}

function enforceRateLimit(req, res, next) {
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const maximumRequests = 12;
  const key = req.ip;
  const current = rateLimits.get(key);
  if (!current || current.resetAt <= now) {
    rateLimits.set(key, { count: 1, resetAt: now + windowMs });
    return next();
  }
  if (current.count >= maximumRequests) {
    res.set("Retry-After", String(Math.ceil((current.resetAt - now) / 1000)));
    return res.status(429).json({ error: "Too many checkout attempts. Please wait a little and try again." });
  }
  current.count += 1;
  return next();
}

const regularCents = (product) => Math.round((product.salePrice ?? product.price) * 100);

function buildLineItems(items, promotions = []) {
  return items.map(({ productId, quantity, selections }) => {
    const product = productsById.get(productId);
    if (!product || !product.available || product.stock !== undefined && product.stock <= 0) {
      throw new Error("One or more selected drinks are no longer available. Please refresh the menu.");
    }

    const selectedNames = Object.keys(selections);
    if (selectedNames.length > product.modifiers.length) {
      throw new Error("One or more drink choices have changed. Please refresh the menu.");
    }
    if (selectedNames.some((name) => !product.modifiers.some((group) => group.name === name))) {
      throw new Error("One or more drink choices have changed. Please refresh the menu.");
    }

    const modifiers = [];
    for (const group of product.modifiers) {
      const selectedOption = selections[group.name];
      if (!selectedOption) {
        if (group.required) throw new Error(`Choose an option for ${group.name.toLowerCase()}.`);
        continue;
      }
      if (typeof selectedOption !== "string") {
        throw new Error("One or more drink choices are invalid. Please refresh the menu.");
      }
      const option = group.options.find((candidate) => candidate.name === selectedOption);
      if (!option) throw new Error("One or more drink choices have changed. Please refresh the menu.");
      modifiers.push({
        name: `${group.name}: ${option.name}`,
        base_price_money: { amount: Math.round(option.price * 100), currency: "USD" },
      });
    }

    return {
      name: product.name,
      quantity: String(quantity),
      base_price_money: {
        amount: saleUnitCents(product.id, regularCents(product), promotions).cents,
        currency: "USD",
      },
      ...(modifiers.length > 0 ? { modifiers } : {}),
    };
  });
}

/**
 * Trusted prices for an order, with the owner's live promotions: sale prices go on the line items
 * and bundle savings become order-level discounts, so Square charges what the storefront showed.
 */
function priceOrder(items, promotions = promotionBoard.list()) {
  const lineItems = buildLineItems(items, promotions);
  const priced = priceCart(items.map((item, index) => ({
    productId: item.productId,
    quantity: item.quantity,
    unitCents: regularCents(productsById.get(item.productId)),
    extrasCents: (lineItems[index].modifiers ?? []).reduce((sum, modifier) => sum + modifier.base_price_money.amount, 0),
  })), promotions);
  const discounts = priced.bundles.map((bundle) => ({
    uid: bundle.promotionId,
    name: `Bundle: ${bundle.productIds.map((id) => productsById.get(id)?.name ?? id).join(" + ")}`,
    type: "FIXED_AMOUNT",
    amount_money: { amount: bundle.discountCents, currency: "USD" },
    scope: "ORDER",
  }));
  return { lineItems, discounts, subtotalCents: priced.subtotalCents, savingsCents: priced.savingsCents };
}

function validatePaymentUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && allowedCheckoutHosts.has(url.hostname);
  } catch {
    return false;
  }
}

function squareCheckoutReady() {
  return validateConfiguration() === null && Boolean(accessToken && locationId && publicBaseUrl);
}

app.get("/api/checkout/status", (_req, res) => {
  const available = squareCheckoutReady();
  // Without Square, customers can still place a pickup order and pay at the counter.
  res.json({ available, environment, pickupAvailable: !available });
});

app.post("/api/checkout", enforceRateLimit, async (req, res) => {
  const configurationError = validateConfiguration();
  if (configurationError) {
    console.error("Square checkout configuration error:", configurationError);
    return res.status(500).json({ error: "Square checkout is misconfigured. Review the server environment settings." });
  }
  if (!accessToken || !locationId || !publicBaseUrl) {
    return res.status(503).json({ error: "Square checkout is not configured yet. Add the Square sandbox settings to the server environment." });
  }

  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Some checkout details are missing or invalid. Please review the form and your bag." });
  }

  let pricing;
  try {
    pricing = priceOrder(parsed.data.items);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "One or more items could not be checked." });
  }

  const { buyer, pickupTime } = parsed.data;
  const pickupDetails = {
    schedule_type: pickupTime === "Next available" ? "ASAP" : "SCHEDULED",
    recipient: {
      display_name: buyer.name,
      email_address: buyer.email,
      ...(buyer.phone ? { phone_number: buyer.phone } : {}),
    },
    ...(pickupTime === "In 30 minutes" ? { pickup_at: new Date(Date.now() + 30 * 60 * 1000).toISOString() } : {}),
    ...(pickupTime === "In 1 hour" ? { pickup_at: new Date(Date.now() + 60 * 60 * 1000).toISOString() } : {}),
  };
  const redirectUrl = new URL(publicBaseUrl).protocol === "https:"
    ? `${publicBaseUrl.replace(/\/+$/, "")}/?square_checkout=returned`
    : undefined;
  const requestBody = {
    idempotency_key: parsed.data.idempotencyKey,
    order: {
      location_id: locationId,
      line_items: pricing.lineItems,
      ...(pricing.discounts.length > 0 ? { discounts: pricing.discounts } : {}),
      pricing_options: { auto_apply_taxes: true },
      fulfillments: [{
        type: "PICKUP",
        state: "PROPOSED",
        pickup_details: {
          ...pickupDetails,
        },
      }],
    },
    checkout_options: {
      ...(redirectUrl ? { redirect_url: redirectUrl } : {}),
      merchant_support_email: process.env.MERCHANT_SUPPORT_EMAIL || "figandfroth@gmail.com",
      ask_for_shipping_address: false,
      allow_tipping: false,
    },
    pre_populated_data: { buyer_email: buyer.email },
  };

  try {
    const squareResponse = await fetch(`${squareBaseUrl}/v2/online-checkout/payment-links`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "Square-Version": apiVersion,
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(15_000),
    });
    const result = await squareResponse.json().catch(() => null);
    if (!squareResponse.ok) {
      const errors = Array.isArray(result?.errors) ? result.errors : [];
      console.error("Square payment-link request failed:", {
        status: squareResponse.status,
        codes: errors.map((error) => error.code).filter(Boolean),
        categories: errors.map((error) => error.category).filter(Boolean),
      });
      return res.status(502).json({ error: "Square couldn’t start checkout. Please try again or contact the shop." });
    }
    const checkoutUrl = result?.payment_link?.url;
    if (!validatePaymentUrl(checkoutUrl)) {
      console.error("Square returned an unexpected checkout URL host.");
      return res.status(502).json({ error: "Square returned an invalid checkout link. Please contact the shop." });
    }
    orderBook.add({ idempotencyKey: parsed.data.idempotencyKey, source: "square", pickupTime, items: orderItems(parsed.data.items, productsById) });
    return res.status(201).json({ checkoutUrl });
  } catch (error) {
    console.error("Square checkout request failed:", error instanceof Error ? error.message : "Unknown network error");
    return res.status(502).json({ error: "Couldn’t reach Square to start checkout. Please try again." });
  }
});

const pickupLimits = new Map();
function limitPickupOrders(req, res, next) {
  const now = Date.now();
  const entry = pickupLimits.get(req.ip);
  if (!entry || entry.resetAt <= now) {
    pickupLimits.set(req.ip, { count: 1, resetAt: now + 15 * 60 * 1000 });
    return next();
  }
  if (entry.count >= 40) return res.status(429).json({ error: "Too many orders at once. Please wait a little and try again." });
  entry.count += 1;
  return next();
}

app.post("/api/orders/pickup", limitPickupOrders, (req, res) => {
  if (squareCheckoutReady()) return res.status(409).json({ error: "Please check out with Square." });
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Some order details are missing or invalid. Please review the form and your bag." });
  }
  let pricing;
  try {
    pricing = priceOrder(parsed.data.items);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "One or more items could not be checked." });
  }
  const order = orderBook.add({ idempotencyKey: parsed.data.idempotencyKey, source: "pickup", pickupTime: parsed.data.pickupTime, items: orderItems(parsed.data.items, productsById) });
  return res.status(201).json({ orderNumber: order.number, subtotalCents: pricing.subtotalCents, savingsCents: pricing.savingsCents });
});

app.get("/api/admin/orders", ownerAuth.requireOwner, (req, res) => {
  const after = Number.parseInt(String(req.query.after ?? "0"), 10);
  res.json({ orders: orderBook.since(Number.isFinite(after) ? after : 0) });
});

// Optional Claude mode for Behind the Counter (off unless ANTHROPIC_API_KEY is set). Owner only.
registerOpsClaude(app, { guard: ownerAuth.requireOwner });

if (existsSync(distDirectory)) {
  app.use(express.static(distDirectory, { index: false, maxAge: "1h" }));
  app.get("*", (_req, res) => res.sendFile(path.join(distDirectory, "index.html")));
}

app.use((error, _req, res, _next) => {
  if (error instanceof SyntaxError && "body" in error) {
    return res.status(400).json({ error: "The checkout request wasn’t valid. Please try again." });
  }
  if (error?.type === "entity.too.large") {
    return res.status(413).json({ error: "The checkout request is too large. Please reduce your bag and try again." });
  }
  console.error("Request failed:", error instanceof Error ? error.message : "Unknown request error");
  return res.status(500).json({ error: "Something went wrong. Please try again." });
});

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  app.listen(port, "0.0.0.0", () => {
    console.log(`Fig & Froth checkout server listening on port ${port} (${environment}).`);
  });
}

export { app, buildLineItems, priceOrder, validatePaymentUrl };
