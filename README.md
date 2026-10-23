# Fig & Froth storefront

## Run locally

```sh
npm install
npm run dev
```

The storefront includes a responsive home page and menu, product customizations, search and category filters, a persistent cart, pickup details, Square-hosted checkout, and a local menu editor. Open **Edit the menu** in the footer to update the browser's preview catalog.

## Behind the Counter demo

A demo-only operations page inside the site: **Behind the counter** in the main menu, or open `http://localhost:5173/#behind-the-counter`. It runs on made-up data (fictional suppliers, recipes, stock, and prices) and works fully offline. Nothing is ordered, paid, or sent.

Run it with the same `npm run dev` as the storefront. What it shows:

- **The pantry.** Each ingredient is a tin, carton, jar, or box that drains as simulated customer orders come in (oldest batch first). The dashed line is the reorder point.
- **Time controls.** **Next order**, **Run one day**, **Run one week**, a speed setting, and **Reset demo**. The seed and scenario make every run repeatable: the same seed and scenario always give the same results.
- **The restock agent.** Every night at closing it runs *Observe stock → Plan orders → Draft POs → Request approval → Log*. Orders over $300 wait for **Approve order** or **Reject**, and a run pauses when one does. Approved orders arrive after the supplier's delivery time and refill the tins. Every decision is in the **Audit log**.
- **Smarter ordering.** Ships items together, tops up to free shipping, takes bulk prices only when the stock will be used before it expires, keeps to a $3,000 weekly cash cap, and picks the cheapest approved supplier that delivers in time. Each order card has **Why this order?** and its savings. **Simple vs smarter** compares 30 simulated days of both.
- **Scenarios.** Normal week, heat wave, supplier price increase, late delivery, matcha near expiry, and a large catering order, each with a banner and a summary of how the agent is responding.
- **Extras.** A freshness timeline with "use it up" specials, profit per drink with a what-if price slider, and an invoice check (ordered vs. arrived vs. billed).
- **Presenter mode.** A six-step guided tour of the demo script below. Use ← → to move between steps, with an option for larger text.

### Optional: Claude mode

Off by default. When it's on, Claude writes the morning brief, the plain-language order explanations, and draft supplier messages from a snapshot of the demo's state. Every quantity and dollar amount still comes from the demo's tested rules. To enable it, add `ANTHROPIC_API_KEY` to `.env` (see `.env.example`), restart `npm run dev`, and turn on **Claude mode**. The key is read only by the local Node server (`server/ops-claude.js`) and never reaches the browser. With no key, or if a request fails, the demo falls back to its built-in templates and shows a small notice.

### Five-minute demo script

1. **The shop:** open the pantry. "Each tin is an ingredient. This is what's on the shelf right now."
2. **Orders drive stock:** click **Next order** a few times and watch the tins drain.
3. **The agent:** run one week. The agent spots low stock, plans, drafts orders, and asks for approval. Approve one.
4. **Smarter ordering:** open **Why this order?** on an order, then **Simple vs smarter**. Read the one-line takeaway.
5. **A curveball:** pick the heat wave or late delivery scenario and show how the agent adapts.
6. **Controls:** show the audit log and the approval limit. Close with: "It saves time and money, and a human stays in charge."

The demo's business rules live in `src/ops/engine` (plain TypeScript with unit tests); the screens are in `src/ops/ui`.

## Configure Square checkout

1. Create a Square application in the [Square Developer Console](https://developer.squareup.com/apps) and select its **Sandbox** environment while testing.
2. Copy `.env.example` to `.env`. Set `SQUARE_ACCESS_TOKEN` to the Sandbox access token, `SQUARE_LOCATION_ID` to the matching Sandbox location, and `APP_BASE_URL=http://localhost:5173`.
3. Run `npm run dev`, add an item to your bag, and complete checkout using Square's Sandbox test card details. Sandbox credentials do not take real payments.
4. For production, use the production access token and location ID, set `SQUARE_ENVIRONMENT=production`, and set `APP_BASE_URL` to the public HTTPS site origin. Keep `.env` private. The deployment must run the Node server and serve the built `dist` directory from that same origin (or proxy `/api` to the Node server). Review Square's tax and pickup settings in the merchant account before accepting live orders.

The server validates product IDs, availability, modifier choices, and prices against `src/catalog.ts`; it ignores client-submitted prices and creates a Square order/payment link using server-side credentials. Square applies tax according to the merchant's Square settings. Card details are entered on Square's hosted page. The browser never receives the access token. For local HTTP development, checkout stays on Square's confirmation page; on a public HTTPS site, Square redirects back to the storefront.

Catalog and cart edits in the browser's local menu editor are **preview-only** and aren't shared with Square or other devices. Before publishing a catalog/price/stock change for sale, update the trusted server catalog in `src/catalog.ts` and deploy the change. The local menu editor is not an authenticated admin system. Checkout return messaging deliberately does not claim an order is paid; verify payment in Square. Fulfillment should be handled using Square's order/payment dashboard until a verified webhook and order-processing workflow is added.

This implementation supports pickup at the configured Square location. It uses the cart's "Next available", "In 30 minutes", or "In 1 hour" selection as the Square pickup schedule, and sets automatic taxes on the Square order. Configure accurate pickup availability and tax rates in Square before going live.

## Production build

```sh
npm run build
npm run preview
```

Run the checkout validation tests and the Behind the Counter engine tests with:

```sh
npm test
```
