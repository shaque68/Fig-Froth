# Fig & Froth storefront

## Run locally

```sh
npm install
npm run dev
```

The storefront includes a responsive home page and menu, product customizations, search and category filters, a persistent cart, pickup details, Square-hosted checkout, and a local menu editor. Open **Edit the menu** in the footer to update the browser's preview catalog.

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

Run the server-side checkout validation tests with:

```sh
npm test
```
