# Matcha Ops Demo: Build Plan

How to use this plan:
1. Put `CLAUDE.md` in the root of your website's project folder. If you already have one, add these sections to it.
2. Put this file at `docs/BUILD_PLAN.md`.
3. Create a separate git branch so your live site code stays untouched: `git checkout -b ops-demo`.
4. Open Claude Code in the project folder and work through one phase at a time. Paste the prompt, review the plan Claude proposes, approve it, then do the checks before moving on.

**Core phases (0–6) are enough for a strong interview demo.** Phases 7–9 are extras if you have time.

---

## Phase 0: Get oriented (no code changes)
**Prompt:**
> Read CLAUDE.md and docs/BUILD_PLAN.md. Explore this website's code and tell me: the framework and language, how to run it locally, where pages and routes live, how styling works, and whether there is a server or it's a static site. Then propose where the "Behind the Counter" demo page should live and how it will get its data (static JSON plus an in-browser simulation is the default). Don't change any files yet.

**Check:** you understand the proposal and it adds a new page without touching existing ones.

---

## Phase 1: Fake data and simulation engine (logic only, no UI)
**Prompt:**
> Phase 1. Create the fake data and the simulation engine described in CLAUDE.md, with no UI yet.
> - Menu: 6 matcha drinks (hot and iced), each with a recipe.
> - About 12 ingredients and materials (ceremonial and culinary matcha, milks, syrups, purée, cups, lids, straws), with batches and freshness windows for perishables.
> - 3–4 fictional suppliers with price tiers, shipping fees, free-shipping thresholds, and lead times.
> - A seeded order generator with weekday/weekend patterns and a weather effect (hot days mean more iced drinks).
> - Functions: simulate a day, deduct an order (oldest batch first), daily usage, days of stock left, reorder point.
> - Unit tests, including one proving the same seed gives identical results.

**Check:** tests pass, and running 30 simulated days twice with the same seed gives identical results.

---

## Phase 2: The Pantry (inventory visual)
**Prompt:**
> Phase 2. Build the "Behind the Counter" page with the Pantry: each ingredient as a matcha tin or jar that shows its fill level, with "days left" and a status (OK, Reorder soon, Reorder now). Clicking a tin shows its batches, supplier, and a one-sentence explanation of its reorder point. Match the existing site's brand. Add one nav link to the page.

**Check:** it looks like part of your site, and it's readable from across a room (try it at full screen).

---

## Phase 3: Live orders and time controls
**Prompt:**
> Phase 3. Add a live orders feed and time controls: "Next order," "Run one day," "Run one week," a speed control, and "Reset demo." When an order arrives, animate its ingredients draining from the tins. This is the one signature motion moment, so keep other motion minimal and respect reduced-motion settings. Show the current simulated date and seed.

**Check:** you can tell a clear story by clicking "Next order" a few times, and "Reset demo" always returns the same starting point.

---

## Phase 4: Restock agent with approvals and audit log
**Prompt:**
> Phase 4. Add the restock agent. Show its loop visually as a step trace: Observe stock → Plan orders → Draft POs → Request approval → Log. Draft POs appear as order cards with line items, totals, and a plain-English reason. POs over the approval threshold wait for "Approve order" or "Reject." Approved orders are "sent" (simulated) and arrive after the supplier's lead time in simulated days, refilling the tins. Add an Audit log view listing every decision and action. Enforce the guardrails in CLAUDE.md, with tests.

**Check:** run a week, approve an order, and watch the stock refill when it "arrives." The audit log should tell the story on its own.

---

## Phase 5: Smarter ordering and the side-by-side comparison
**Prompt:**
> Phase 5. Implement the six smarter-ordering rules in CLAUDE.md, each producing a plain-English reason. On every PO card, add a "Why this order?" section and a savings breakdown (bulk discount, shipping avoided). Then build a comparison screen that runs "Simple ordering" vs "Smarter ordering" for 30 simulated days with the same seed and compares total spend, shipping fees, stockouts, wasted stock, and average cash tied up in inventory. Use one clear chart with a one-sentence takeaway, labeled "Simulated." Add tests for each rule.

**Check:** the comparison is easy to understand in under 10 seconds, and every number traces back to the simulation.

---

## Phase 6: Scenarios for the presentation
**Prompt:**
> Phase 6. Add a scenario picker that resets the demo into a preset story, each with a visible change and a visible agent response:
> - Normal week
> - Heat wave (iced drinks spike)
> - Supplier price increase (matcha costs more)
> - Late delivery (a supplier slips by several days)
> - Matcha batch near expiry
> - Large catering order
> Show a short banner explaining each scenario in one sentence.

**Check:** each scenario makes the agent do something different and explainable.

---

## Phase 7 (extra): Freshness, profit per drink, three-way match
Run these as separate prompts.

**Freshness:**
> Add a freshness view: a timeline of batches by expiry. When a perishable is near expiry, the agent suggests a "use it up" special (for example, a "matcha of the day") and shows the estimated stock saved.

**Profit per drink:**
> Add profit per drink: cost of each drink from current ingredient prices, price, and margin. Add a "what if a supplier raises prices by X%" slider that shows which drinks lose margin.

**Three-way match:**
> Add a three-way match view. For each received PO, generate a simulated supplier invoice (some with small deliberate mismatches) and check that ordered, received, and billed quantities and prices agree. Flag mismatches for human review with a plain-English explanation.

---

## Phase 8 (extra): Optional Claude mode
**Prompt:**
> Add an optional "Claude mode," off by default. Create a small local server endpoint that reads ANTHROPIC_API_KEY from an environment variable (never in browser code). Send it a snapshot of the current state. Claude writes the plain-language order explanations, a draft supplier message, and a short morning brief. Quantities and money decisions still come from the tested rules. If a call fails or there's no key, fall back to Demo mode with a small notice. Check Anthropic's documentation for current model names.

**Check:** the demo still works perfectly with Claude mode off and no internet.

---

## Phase 9 (extra): Presenter polish
**Prompt:**
> Add a Presenter mode: a 5–7 step guided tour that follows the demo script below, advanced with the arrow keys, with an option for larger text. Write a README section on how to run the demo locally. Finally, scan the project for anything that looks like real data, real supplier contacts, or secrets, and remove it.

**Check:** you can run the full demo twice in a row without anything changing unexpectedly.

---

## Five-minute demo script
1. **The shop:** open the Pantry. "Each tin is an ingredient. This is what's on the shelf right now."
2. **Orders drive stock:** click "Next order" a few times and watch the tins drain.
3. **The agent:** run one week. The agent spots low stock, plans, drafts orders, and asks for approval. Approve one.
4. **Smarter ordering:** open "Why this order?" on a PO, then the comparison screen. Read the one-line takeaway.
5. **A curveball:** pick the Heat wave or Late delivery scenario and show how the agent adapts.
6. **Controls:** show the audit log and the approval threshold. Close with: "It saves time and money, and a human stays in charge."

## If something goes wrong
- Ask Claude Code to explain what changed and why before fixing it.
- Roll back a phase with git if needed. That's why you commit after each phase.
- Keep phases small. If a prompt grows too big, split it.
