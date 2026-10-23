# Matcha Ops Demo: Project Guide for Claude Code

## What we're building
A demo-only "Behind the Counter" section inside this existing matcha website. It shows, visually:
- **Inventory that updates from customer orders.** Each simulated order subtracts the ingredients and materials in that drink's recipe.
- **A restock agent.** It watches stock, drafts purchase orders (POs), asks a human to approve bigger ones, and logs every decision.
- **Smarter ordering.** It combines and times orders to save money (bulk discounts, free shipping, cash limits) without running out or wasting stock.
- **Stretch:** freshness tracking with "use it up" specials, profit per drink, and a three-way match (checking that what was ordered, what arrived, and what was billed all agree).

Audience: a non-technical interviewer. The goal is a clear, visual, repeatable demo, not a live system.

## Hard rules
- **Demo only, fake data only.** No real orders, payments, emails, store platforms, or supplier contacts. Use clearly fictional supplier names.
- **Works offline.** The default "Demo mode" needs no network and no API keys. The optional "Claude mode" is off by default.
- **Repeatable.** All randomness uses a seeded random generator, so the same seed and scenario always give the same results. Provide a visible "Reset demo" control.
- **Don't break the existing site.** Add the demo as a new page or route plus one navigation link. Don't restyle or refactor existing pages unless asked.
- **Logic separate from UI.** Business rules live in plain, testable functions with unit tests.
- **Money in cents.** Store amounts as integer cents and format them only for display.
- **Label simulated results** clearly, for example "Simulated over 30 days."
- **No secrets in code.** If Claude mode exists, the API key is read from an environment variable on a small local server and is never sent to or stored in browser code.

## Domain model (plain language)
- **Ingredient or material:** name, unit (g, ml, each), on-hand amount, whether it's perishable, freshness window in days, and batches (amount plus received date).
- **Menu item:** price and recipe (which ingredients and how much per drink).
- **Order:** time, drinks, and quantities. Deduct recipe amounts from inventory, oldest batch first.
- **Supplier:** items offered, price tiers (bulk discounts), shipping fee, free-shipping threshold, lead time in days, and an "approved" flag.
- **Purchase order:** supplier and line items, with a status that moves Draft → Awaiting approval → Approved → Sent (simulated) → Received → Invoiced → Matched.
- **Audit log:** every agent decision and human action, with time and reason.

## Core rules
- **Daily usage** = rolling average of recent simulated sales, converted to ingredients through the recipes.
- **Days of stock left** = on-hand ÷ daily usage.
- **Reorder point** = daily usage × supplier lead time + safety stock (default: 2 days of usage).

### Smarter ordering
These rules run per supplier and must be explainable:
1. Start with items at or below their reorder point.
2. Pull forward items from the same supplier that will hit their reorder point within a look-ahead window, so they ship together.
3. If an order is just under the free-shipping threshold, top it up with the next-most-needed items when that costs less than paying shipping.
4. Move up to a bulk price tier only if the extra stock will be used before it expires (for perishables) and fits the cash cap.
5. Respect a weekly cash cap. If over, prioritize by risk of running out (days left vs. lead time) and defer the rest.
6. Choose the supplier with the lowest landed cost (price plus share of shipping) that still delivers before a stockout.

Every decision produces a short plain-English reason, for example: "Added 2 sleeves of lids to reach free shipping, saving $12."

### Guardrails
- POs over the approval threshold need human approval.
- Only approved suppliers can be used.
- No duplicate open POs for the same item.
- The cash cap is never exceeded.

### Baseline for comparison ("Simple ordering")
Each item is ordered separately at its reorder point, at base price, with full shipping.

## The agent
- It runs a visible loop: **Observe stock → Plan orders → Draft POs → Request approval → Log**.
- Quantities and money decisions come from the tested rules above, never from the language model.
- **Demo mode:** explanations come from templates.
- **Claude mode (optional):** Claude writes the plain-language explanations, a draft supplier message, and a morning brief, working from a snapshot of the current state through a small local server endpoint. If a call fails, fall back to Demo mode and show a small notice.

## Design guidance
- **Match the existing site's brand** (colors, fonts, tone) so the demo feels like part of the site.
- **One memorable visual:** inventory shown as matcha tins or jars that fill and drain. Keep everything around it quiet and readable.
- **One orchestrated motion moment:** when an order arrives, its ingredients visibly drain from the tins. Avoid scattered animations elsewhere.
- **Hierarchy over a wall of identical cards.** Show what needs attention first.
- **Plain-language copy for a non-technical audience:** "Days of matcha left," not "SKU velocity." Buttons say exactly what they do: "Approve order," "Run one week."
- **Every chart gets a one-sentence takeaway caption.**
- **Accessible and projector-friendly:** readable contrast, visible keyboard focus, reduced motion respected, legible at laptop and projector sizes.

## Workflow
- Work one phase at a time from `docs/BUILD_PLAN.md`. Start each phase in plan mode, show the plan, and wait for approval before editing.
- After each phase: run the tests, run the site locally, review the new screens (screenshots if possible), and commit with a clear message.
- Keep changes small and reviewable. Ask before adding large new dependencies.
