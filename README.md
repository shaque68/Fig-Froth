# Fig & Froth storefront

## Run locally

```sh
npm install
npm run dev
```

The storefront includes a responsive home page and menu, product customizations, search and category filters, a persistent cart, pickup details, and Square-hosted checkout. Until Square is configured, checkout offers **Place order · pay at pickup** instead, which sends the order to the shop.

The owner's pages live under `/admin` and need a sign-in (see below): **Behind the counter** at `/admin` and the menu editor at `/admin/menu`. The storefront doesn't link to them except for a small **Staff sign-in** link in the footer.

## Owner sign-in

Copy `.env.example` to `.env` and set `OWNER_PASSWORD` to the password you'll use, then restart `npm run dev`. Open `http://localhost:5173/admin` and sign in. The password is checked on the server, which keeps you signed in with an HTTP-only cookie for 12 hours. Set `SESSION_SECRET` to a long random string to stay signed in across server restarts. Behind the Counter's data feeds and Claude mode refuse requests without that sign-in.

## Behind the Counter console

An operations console for the owner at `http://localhost:5173/admin` (sign in first; old `#behind-the-counter` links redirect there). Supplier and product names are real brands (Ippodo, Restaurant Depot, WebstaurantStore, Imperial Dade, Monin, Oatly, Dart, and others), but every price, stock level, delivery, and invoice is simulated, as are the walk-in customer orders (orders placed on the storefront are real and show up too). It works fully offline, and nothing is actually ordered from suppliers, paid, or sent.

Run it with the same `npm run dev` as the storefront. What it shows:

- **The pantry.** Each ingredient is a tin, carton, jar, or box that drains as simulated customer orders come in (oldest batch first). The dashed line is the reorder point.
- **Controls.** **Next order**, **Run one day**, **Run one week**, a speed setting, the scenario picker, and **Reset**, in a toolbar you can hide with **Hide controls**. The seed and scenario make every run repeatable: the same seed and scenario always give the same results.
- **The restock agent.** Every night at closing it runs *Observe stock → Plan orders → Draft POs → Request approval → Log*. Orders over $300 wait for **Approve order** or **Reject**, and a run pauses when one does. Approved orders arrive after the supplier's delivery time and refill the tins. Every decision is in the **Activity log**.
- **Smarter ordering.** Ships items together, tops up to free shipping, takes bulk prices only when the stock will be used before it expires, keeps to a $3,000 weekly cash cap, and picks the cheapest approved supplier that delivers in time. Each order card has **Why this order?** and its savings. **Savings** compares 30 days of both.
- **Scenarios.** Normal week, heat wave, supplier price increase, late delivery, matcha near expiry, and a large catering order. Each shows up as a notice (a weather alert, a supplier's delay notice, a price change, a use-by alert, or a new booking) with what the agent did about it.
- **Promotions.** When a perishable batch would otherwise be thrown out, the agent suggests a sale on a drink that uses it and a two-drink bundle for an extra discount, with a forecast for each step (stock saved, profit on extra sales, and the discount given on sales you'd have made anyway). Nothing goes under a 60% margin, and nothing reaches the storefront until you click **Publish to storefront**. **Build a bundle** pairs any two drinks. Promotions tied to a batch end on their own once it's used up or reaches its use-by date. **Draft social post** writes a social caption and a text message that never mention expiry.
- **Extras.** A freshness timeline with "use it up" specials, profit per drink with a what-if price slider, and an invoice check (ordered vs. arrived vs. billed).
- **Presenter mode.** Hidden from the page: press **P** to start or end a six-step guided tour of the script below. Use ← → to move between steps, with an option for larger text.

### Storefront orders in the console

Orders placed on the storefront show up in Behind the Counter within a few seconds: they appear in **Live orders** marked as website orders, their ingredients come off the shelf, and they count toward the agent's next restock. To demo it, open the storefront in one window and `/admin` (signed in) in another, side by side, and place an order. Website drinks are counted as iced; drinks without a pantry recipe (the coffee drinks) are listed but not tracked. Orders are kept in the server's memory; in production they would come from Square's order webhooks and a database.

### Promotions on the storefront

A published promotion shows on the storefront within a few seconds: a banner at the top, a **This week's sweet deals** section on the home page, sale prices and tags on the menu, and in the bag, the bundle discount plus a nudge to add the second drink. Prices come from one set of rules (`src/pricing.ts`) shared by the storefront, the checkout server, and the console. The server applies the owner's live promotions itself, as sale prices on Square line items and bundles as an order discount, so a browser can't set its own price. Publishing goes through an owner-only endpoint that only accepts drinks on the menu, at most 40% off a drink and 20% off a bundle. Promotions are kept in the server's memory, and the console is the source of truth: reloading or resetting it clears them from the storefront. To see one, choose the **Matcha near expiry** scenario and open **Promotions**.

### Optional: Claude mode

Off by default. When it's on, Claude writes the morning brief, the plain-language order explanations, draft supplier messages, invoice dispute drafts (from **Draft dispute message** on a flagged invoice), and promotion marketing (from **Draft social post**) from a snapshot of the console's state. Every quantity and dollar amount still comes from the tested ordering rules. To enable it, add `ANTHROPIC_API_KEY` to `.env` (see `.env.example`), restart `npm run dev`, and turn on **Claude mode**. The key is read only by the local Node server (`server/ops-claude.js`) and never reaches the browser. With no key, or if a request fails, it falls back to the built-in standard text and shows a small notice.

### Five-minute demo script

1. **The shop:** open the pantry. "Each tin is an ingredient. This is what's on the shelf right now."
2. **Orders drive stock:** click **Next order** a few times and watch the tins drain.
3. **The agent:** run one week. The agent spots low stock, plans, drafts orders, and asks for approval. Approve one.
4. **Smarter ordering:** open **Why this order?** on an order, then **Savings**. Read the one-line takeaway.
5. **A curveball:** pick the heat wave or late delivery scenario and show how the agent adapts. Or pick matcha near expiry, publish the suggested sale and bundle from **Promotions**, and show them on the storefront.
6. **Controls:** show the activity log and the approval limit. Close with: "It saves time and money, and a human stays in charge."

The console's business rules live in `src/ops/engine` (plain TypeScript with unit tests); the screens are in `src/ops/ui`.

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
