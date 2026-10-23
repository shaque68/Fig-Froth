// Ordering rules. "Smarter ordering" applies the six rules from the project guide, each with a
// plain-English reason; "Simple ordering" is the baseline (one item per order, base price, full shipping).
import { INGREDIENTS, SETTINGS, SUPPLIERS, getIngredient, getSupplier, offerFor, type Ingredient, type Supplier } from "./data.ts";
import { dailyUsage, lineUsage } from "./forecast.ts";
import { formatQty, onHand } from "./inventory.ts";
import { formatCents, formatDollars } from "./money.ts";
import { onOrderQty } from "./pantry.ts";
import { cashLeftThisWeek, isApprovedSupplier, makeLine, nextTier, openPoFor, packPhrase, packPriceCents, shippingFor, tierFor } from "./purchasing.ts";
import type { PoLine, PoReason, World } from "./sim.ts";

export type ItemState = {
  ingredient: Ingredient;
  home: Supplier;
  onHand: number;
  onOrder: number;
  openPoId?: string;
  usage: number;
  daysLeft: number;
  reorderPoint: number;
};

export type PlannedPo = {
  supplierId: string;
  lines: PoLine[];
  subtotalCents: number;
  shippingCents: number;
  totalCents: number;
  reasons: PoReason[];
  savings: { bulkCents: number; shippingAvoidedCents: number };
};

export type Plan = {
  pos: PlannedPo[];
  /** Items the agent looked at but didn't order, with why. */
  notes: string[];
  deferred: Array<{ ingredientId: string; reason: string }>;
  atReorderPoint: string[];
};

/** Upcoming pre-booked demand (e.g. a catering order) for the next `days` days. */
export function bookedDemand(world: World, ingredientId: string, days: number): number {
  let total = 0;
  for (const order of world.effects.bookings) {
    if (order.day <= world.day || order.day > world.day + days) continue;
    for (const line of order.lines) for (const use of lineUsage(line)) if (use.ingredientId === ingredientId) total += use.amount;
  }
  return total;
}

export function itemState(world: World, ingredient: Ingredient): ItemState {
  const home = getSupplier(ingredient.homeSupplierId);
  const usage = dailyUsage(world.demandHistory[ingredient.id]);
  const qty = onHand(world.stock[ingredient.id]);
  return {
    ingredient,
    home,
    onHand: qty,
    onOrder: onOrderQty(world, ingredient.id),
    openPoId: openPoFor(world, ingredient.id)?.id,
    usage,
    daysLeft: usage > 0 ? qty / usage : Number.POSITIVE_INFINITY,
    reorderPoint: usage * (home.leadDays + SETTINGS.safetyDays),
  };
}

/** Rule 1 trigger: stock on hand plus on order, minus known bookings, is at or below the reorder point. */
export function atReorderPoint(world: World, state: ItemState, withBookings = true): boolean {
  const window = state.home.leadDays + SETTINGS.safetyDays;
  const booked = withBookings ? bookedDemand(world, state.ingredient.id, window) : 0;
  return state.onHand + state.onOrder - booked <= state.reorderPoint;
}

/** Rule 2 trigger: will hit the reorder point within the look-ahead window. */
export function hitsReorderPointSoon(world: World, state: ItemState): boolean {
  const window = state.home.leadDays + SETTINGS.safetyDays + SETTINGS.lookaheadDays;
  return state.onHand + state.onOrder - bookedDemand(world, state.ingredient.id, window) - state.usage * SETTINGS.lookaheadDays <= state.reorderPoint;
}

/** Order-up-to amount: lead time + safety stock + one order cycle, plus bookings, minus what we have. */
export function targetQty(world: World, state: ItemState, supplier: Supplier, withBookings = true): number {
  const horizon = supplier.leadDays + SETTINGS.safetyDays + supplier.orderCycleDays;
  const booked = withBookings ? bookedDemand(world, state.ingredient.id, horizon) : 0;
  return Math.max(0, state.usage * horizon + booked - state.onHand - state.onOrder);
}

/** The most of a perishable we can buy and still use before it expires. `null` = no limit. */
export function freshnessCap(world: World, state: ItemState, supplier: Supplier): number | null {
  const days = state.ingredient.freshnessDays;
  if (days === null) return null;
  const beforeArrival = state.usage * Math.max(0, supplier.leadDays - 1) + bookedDemand(world, state.ingredient.id, Math.max(0, supplier.leadDays - 1));
  const leftAtArrival = Math.max(0, state.onHand - beforeArrival);
  return Math.max(0, state.usage * days + bookedDemand(world, state.ingredient.id, supplier.leadDays + days) - leftAtArrival);
}

/** Does this supplier deliver before we run out? */
export function arrivesInTime(state: ItemState, supplier: Supplier): boolean {
  return supplier.leadDays - 1 < state.daysLeft;
}

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const days = (value: number) => {
  if (value < 1) return "under a day";
  const shown = value < 10 ? value.toFixed(1).replace(/\.0$/, "") : String(Math.round(value));
  return `${shown} ${shown === "1" ? "day" : "days"}`;
};

type DraftLine = { ingredientId: string; packs: number; role: PoLine["role"]; basePacks: number; topUpPacks: number; reasons: PoReason[] };
type DraftPo = { supplierId: string; lines: DraftLine[]; reasons: PoReason[]; shippingAvoidedCents: number };

function packsFor(qty: number, packSize: number): number {
  return Math.max(1, Math.ceil(qty / packSize));
}

function draftSubtotal(world: World, draft: DraftPo, pricing: "tiered" | "base" = "tiered"): number {
  return draft.lines.reduce((sum, line) => sum + makeLine(world, draft.supplierId, line.ingredientId, line.packs, line.role, pricing).totalCents, 0);
}

function finalize(world: World, draft: DraftPo, pricing: "tiered" | "base", alwaysPayShipping: boolean): PlannedPo {
  const supplier = getSupplier(draft.supplierId);
  const lines = draft.lines.map((line) => makeLine(world, draft.supplierId, line.ingredientId, line.packs, line.role, pricing));
  const subtotalCents = lines.reduce((sum, line) => sum + line.totalCents, 0);
  const shippingCents = alwaysPayShipping ? supplier.shippingCents : shippingFor(supplier, subtotalCents);
  const bulkCents = lines.reduce((sum, line) => sum + (line.basePackPriceCents - line.packPriceCents) * line.packs, 0);
  return {
    supplierId: draft.supplierId,
    lines,
    subtotalCents,
    shippingCents,
    totalCents: subtotalCents + shippingCents,
    reasons: [...draft.reasons, ...draft.lines.flatMap((line) => line.reasons)],
    savings: { bulkCents, shippingAvoidedCents: draft.shippingAvoidedCents },
  };
}

function landedCost(world: World, drafts: Map<string, DraftPo>, supplier: Supplier, ingredientId: string, packs: number): number {
  const offer = offerFor(supplier, ingredientId)!;
  const goods = packPriceCents(world, supplier.id, offer, packs) * packs;
  const draft = drafts.get(supplier.id);
  const before = draft ? draftSubtotal(world, draft) : 0;
  return goods + shippingFor(supplier, before + goods) - shippingFor(supplier, before);
}

export function planSmart(world: World): Plan {
  const states = INGREDIENTS.map((ingredient) => itemState(world, ingredient));
  const plan: Plan = { pos: [], notes: [], deferred: [], atReorderPoint: [] };
  const drafts = new Map<string, DraftPo>();
  const draftFor = (supplierId: string) => {
    if (!drafts.has(supplierId)) drafts.set(supplierId, { supplierId, lines: [], reasons: [], shippingAvoidedCents: 0 });
    return drafts.get(supplierId)!;
  };
  const inDraft = (ingredientId: string) => [...drafts.values()].some((draft) => draft.lines.some((line) => line.ingredientId === ingredientId));
  const stateOf = (ingredientId: string) => states.find((state) => state.ingredient.id === ingredientId)!;

  // Rule 1: start with items at or below their reorder point, most at risk first.
  const low = states.filter((state) => atReorderPoint(world, state));
  plan.atReorderPoint = low.map((state) => state.ingredient.id);
  const needed = low
    .filter((state) => {
      if (!state.openPoId) return true;
      plan.notes.push(`${state.ingredient.name} is low but already on order (${state.openPoId}), so no second order.`);
      return false;
    })
    .sort((a, b) => (a.daysLeft - a.home.leadDays) - (b.daysLeft - b.home.leadDays));

  for (const state of needed) {
    const qty = targetQty(world, state, state.home);
    const sellers = SUPPLIERS.filter((supplier) => offerFor(supplier, state.ingredient.id));
    const valid = sellers.filter((supplier) => supplier.approved && arrivesInTime(state, supplier));
    const fallback = sellers.filter((supplier) => supplier.approved).sort((a, b) => a.leadDays - b.leadDays)[0];
    const options = (valid.length > 0 ? valid : [fallback]).map((supplier) => {
      const offer = offerFor(supplier, state.ingredient.id)!;
      const cap = freshnessCap(world, state, supplier);
      const wanted = packsFor(qty, offer.packSize);
      const packs = cap === null ? wanted : Math.max(1, Math.min(wanted, Math.floor(cap / offer.packSize)));
      return { supplier, packs, wanted, landed: landedCost(world, drafts, supplier, state.ingredient.id, packs) };
    }).sort((a, b) => a.landed - b.landed || (a.supplier.id === state.home.id ? -1 : 1));
    const choice = options[0];
    const reasons: PoReason[] = [{
      rule: "Low stock",
      text: `${state.ingredient.name} is down to ${formatQty(state.ingredient.id, state.onHand)} (${days(state.daysLeft)} left), at or below its reorder point of ${formatQty(state.ingredient.id, Math.round(state.reorderPoint))}.`,
    }];
    const booked = bookedDemand(world, state.ingredient.id, choice.supplier.leadDays + SETTINGS.safetyDays + choice.supplier.orderCycleDays);
    if (booked > 0) reasons.push({ rule: "Known orders", text: `Includes ${formatQty(state.ingredient.id, booked)} for an upcoming booked order.` });
    if (choice.packs < choice.wanted) {
      reasons.push({ rule: "Freshness", text: `Ordered ${plural(choice.packs, "pack")} instead of ${choice.wanted}: more would spoil before we could use it.` });
    }
    if (valid.length === 0) {
      reasons.push({ rule: "Best supplier", text: `No supplier can deliver before we run out, so this goes to the fastest one, ${choice.supplier.name} (${plural(choice.supplier.leadDays, "day")}).` });
    } else if (options.length > 1) {
      const runnerUp = options[1];
      const prefix = choice.supplier.id === state.home.id ? `${choice.supplier.name} is the lowest landed cost` : `Switched to ${choice.supplier.name}: lowest landed cost`;
      reasons.push({ rule: "Best supplier", text: `${prefix} (${formatCents(choice.landed)} including shipping, vs ${formatCents(runnerUp.landed)} from ${runnerUp.supplier.name}).` });
    }
    const slow = sellers.filter((supplier) => supplier.approved && !arrivesInTime(state, supplier));
    if (slow.length > 0 && valid.length > 0) reasons.push({ rule: "Best supplier", text: `Skipped ${slow.map((s) => s.name).join(" and ")}: wouldn't arrive before we run out.` });
    for (const supplier of sellers.filter((candidate) => !candidate.approved)) {
      const offer = offerFor(supplier, state.ingredient.id)!;
      if (packPriceCents(world, supplier.id, offer, choice.packs) * choice.packs < choice.landed) {
        reasons.push({ rule: "Approved suppliers only", text: `${supplier.name} is cheaper but isn't an approved supplier, so it wasn't used.` });
      }
    }
    draftFor(choice.supplier.id).lines.push({ ingredientId: state.ingredient.id, packs: choice.packs, basePacks: choice.packs, topUpPacks: 0, role: "needed", reasons });
  }

  // Rule 2: pull forward items from the same supplier that will need ordering soon.
  for (const draft of drafts.values()) {
    const supplier = getSupplier(draft.supplierId);
    for (const state of states) {
      if (state.home.id !== supplier.id || state.openPoId || inDraft(state.ingredient.id) || atReorderPoint(world, state)) continue;
      if (!hitsReorderPointSoon(world, state)) continue;
      const offer = offerFor(supplier, state.ingredient.id)!;
      const cap = freshnessCap(world, state, supplier);
      let packs = packsFor(targetQty(world, state, supplier), offer.packSize);
      if (cap !== null) packs = Math.min(packs, Math.floor(cap / offer.packSize));
      if (packs <= 0) continue;
      const untilReorder = Math.max(0, (state.onHand - state.reorderPoint) / Math.max(1, state.usage));
      draft.lines.push({
        ingredientId: state.ingredient.id, packs, basePacks: packs, topUpPacks: 0, role: "pulled-forward",
        reasons: [{ rule: "Ship together", text: `Added ${state.ingredient.name.toLowerCase()} early: it would need reordering ${untilReorder < 1 ? "within a day" : `in about ${days(untilReorder)}`}, and shipping it now avoids a separate ${formatDollars(supplier.shippingCents)} delivery.`, savingsCents: supplier.shippingCents }],
      });
      draft.shippingAvoidedCents += supplier.shippingCents;
    }
  }

  // Rule 4: move up to a bulk price tier only if the extra stock gets used before it expires.
  for (const draft of drafts.values()) {
    const supplier = getSupplier(draft.supplierId);
    for (const line of draft.lines) {
      const offer = offerFor(supplier, line.ingredientId)!;
      const tier = nextTier(offer, line.packs);
      if (!tier) continue;
      const state = stateOf(line.ingredientId);
      const total = tier.minPacks * offer.packSize;
      const cap = freshnessCap(world, state, supplier);
      const withinOneMoreCycle = total <= targetQty(world, state, supplier) + state.usage * supplier.orderCycleDays;
      if (!withinOneMoreCycle || (cap !== null && total > cap)) continue;
      const current = packPriceCents(world, supplier.id, offer, line.packs);
      const bulk = packPriceCents(world, supplier.id, offer, tier.minPacks);
      const saving = (current - bulk) * tier.minPacks;
      const usedWithin = Math.ceil((state.onHand + state.onOrder + total) / Math.max(1, state.usage));
      const freshness = state.ingredient.freshnessDays ? `, before it expires` : "";
      line.reasons.push({ rule: "Bulk price", text: `Bought ${tier.minPacks} instead of ${line.packs} to get the bulk price (${formatCents(bulk)} vs ${formatCents(current)} each), saving ${formatCents(saving)}. It will all be used within about ${usedWithin} days${freshness}.`, savingsCents: saving });
      line.packs = tier.minPacks;
    }
  }

  // Rule 3: top up an order that's just under free shipping, using items we'd need within two weeks.
  for (const draft of drafts.values()) {
    const supplier = getSupplier(draft.supplierId);
    const subtotal = draftSubtotal(world, draft);
    const gap = supplier.freeShippingAtCents - subtotal;
    if (gap <= 0 || gap > supplier.shippingCents * 3) continue;
    const candidates = supplier.offers
      .map((offer) => ({ offer, state: stateOf(offer.ingredientId) }))
      .filter(({ state }) => !state.openPoId && (state.home.id === supplier.id || inDraftFor(draft, state.ingredient.id)) && (!inDraft(state.ingredient.id) || inDraftFor(draft, state.ingredient.id)))
      .map(({ offer, state }) => {
        const existing = draft.lines.find((line) => line.ingredientId === state.ingredient.id);
        const already = (existing?.packs ?? 0) * offer.packSize;
        const horizonLimit = state.usage * SETTINGS.topUpHorizonDays - state.onHand - state.onOrder - already;
        const cap = freshnessCap(world, state, supplier);
        const freshLimit = cap === null ? Number.POSITIVE_INFINITY : cap - already;
        return { offer, state, room: Math.floor(Math.min(horizonLimit, freshLimit) / offer.packSize) };
      })
      .filter((candidate) => candidate.room > 0)
      .sort((a, b) => a.state.daysLeft - b.state.daysLeft);
    if (candidates.length === 0) continue;
    const added: Record<string, number> = {};
    const trial: DraftPo = { ...draft, lines: draft.lines.map((line) => ({ ...line })) };
    let progressed = true;
    while (draftSubtotal(world, trial) < supplier.freeShippingAtCents && progressed) {
      progressed = false;
      for (const candidate of candidates) {
        if ((added[candidate.state.ingredient.id] ?? 0) >= candidate.room) continue;
        const line = trial.lines.find((l) => l.ingredientId === candidate.state.ingredient.id);
        if (line) { line.packs += 1; line.topUpPacks += 1; }
        else trial.lines.push({ ingredientId: candidate.state.ingredient.id, packs: 1, basePacks: 0, topUpPacks: 1, role: "top-up", reasons: [] });
        added[candidate.state.ingredient.id] = (added[candidate.state.ingredient.id] ?? 0) + 1;
        progressed = true;
        if (draftSubtotal(world, trial) >= supplier.freeShippingAtCents) break;
      }
    }
    if (draftSubtotal(world, trial) < supplier.freeShippingAtCents) continue;
    const extraCost = draftSubtotal(world, trial) - subtotal;
    const what = Object.entries(added).map(([id, packs]) => packPhrase(packs, offerFor(supplier, id)!.packLabel, getIngredient(id).name)).join(" and ");
    draft.lines = trial.lines;
    draft.reasons.push({ rule: "Free shipping", text: `Added ${what} (${formatCents(extraCost)}) to reach free shipping, saving ${formatCents(supplier.shippingCents)}. We'd use it within two weeks anyway.`, savingsCents: supplier.shippingCents });
    draft.shippingAvoidedCents += supplier.shippingCents;
  }

  // Rule 5: respect the weekly cash cap. Drop extras first, then the least urgent items.
  const budget = cashLeftThisWeek(world);
  const totalOf = () => [...drafts.values()].reduce((sum, draft) => sum + finalize(world, draft, "tiered", false).totalCents, 0);
  if (totalOf() > budget) {
    const trims: Array<() => string | null> = [];
    for (const draft of drafts.values()) {
      trims.push(() => {
        const topUps = draft.lines.filter((line) => line.role === "top-up");
        if (topUps.length === 0 && !draft.reasons.some((reason) => reason.rule === "Free shipping")) return null;
        for (const line of draft.lines) { line.packs -= line.topUpPacks; line.topUpPacks = 0; }
        draft.lines = draft.lines.filter((line) => line.role !== "top-up");
        draft.reasons = draft.reasons.filter((reason) => reason.rule !== "Free shipping");
        draft.shippingAvoidedCents = 0;
        return `Dropped the free-shipping top-up for ${getSupplier(draft.supplierId).name} to stay under this week's cash cap.`;
      });
    }
    for (const draft of drafts.values()) for (const line of draft.lines) {
      trims.push(() => {
        if (line.packs - line.topUpPacks <= line.basePacks) return null;
        line.packs = line.basePacks + line.topUpPacks;
        line.reasons = line.reasons.filter((reason) => reason.rule !== "Bulk price");
        return `Skipped the bulk price on ${getIngredient(line.ingredientId).name.toLowerCase()} to stay under this week's cash cap.`;
      });
    }
    for (const trim of trims) {
      if (totalOf() <= budget) break;
      const note = trim();
      if (note) plan.notes.push(note);
    }
    if (totalOf() > budget) {
      // Still over: keep the most at-risk items (days left vs. delivery time) that fit, and defer the rest.
      const risk = (draft: DraftPo, line: DraftLine) => stateOf(line.ingredientId).daysLeft - getSupplier(draft.supplierId).leadDays;
      const ranked = [...drafts.values()].flatMap((draft) => draft.lines.map((line) => ({ draft, line })))
        .sort((a, b) => (a.line.role === "pulled-forward" ? 1 : 0) - (b.line.role === "pulled-forward" ? 1 : 0) || risk(a.draft, a.line) - risk(b.draft, b.line));
      for (const draft of drafts.values()) draft.lines = [];
      for (const { draft, line } of ranked) {
        draft.lines.push(line);
        if (totalOf() <= budget) continue;
        draft.lines.pop();
        const state = stateOf(line.ingredientId);
        const lead = getSupplier(draft.supplierId).leadDays;
        const cost = formatCents(makeLine(world, draft.supplierId, line.ingredientId, line.packs, line.role).totalCents);
        const reason = risk(draft, line) < 1
          ? `Couldn't fit ${state.ingredient.name.toLowerCase()} (${cost}) in what's left of this week's cash cap. Flagged for you: ${days(state.daysLeft)} left.`
          : `Deferred ${state.ingredient.name.toLowerCase()} to next week's budget: ${days(state.daysLeft)} left and delivery takes ${plural(lead, "day")}.`;
        plan.deferred.push({ ingredientId: line.ingredientId, reason });
      }
    }
  }

  for (const draft of drafts.values()) {
    if (draft.lines.length === 0) continue;
    const po = finalize(world, draft, "tiered", false);
    if (plan.deferred.length > 0 || plan.notes.some((note) => note.includes("cash cap"))) {
      po.reasons.push({ rule: "Cash cap", text: `Kept this week's spending under the ${formatDollars(SETTINGS.weeklyCashCapCents)} cash cap.` });
    }
    plan.pos.push(po);
  }
  return plan;
}

function inDraftFor(draft: DraftPo, ingredientId: string): boolean {
  return draft.lines.some((line) => line.ingredientId === ingredientId);
}

/** Baseline: each item ordered separately at its reorder point, at base price, with full shipping. */
export function planSimple(world: World): Plan {
  const plan: Plan = { pos: [], notes: [], deferred: [], atReorderPoint: [] };
  for (const ingredient of INGREDIENTS) {
    const state = itemState(world, ingredient);
    if (!atReorderPoint(world, state, false)) continue;
    plan.atReorderPoint.push(ingredient.id);
    if (state.openPoId || !isApprovedSupplier(state.home.id)) continue;
    const offer = offerFor(state.home, ingredient.id)!;
    const packs = packsFor(targetQty(world, state, state.home, false), offer.packSize);
    const draft: DraftPo = {
      supplierId: state.home.id,
      lines: [{ ingredientId: ingredient.id, packs, basePacks: packs, topUpPacks: 0, role: "needed", reasons: [] }],
      reasons: [{ rule: "Simple ordering", text: `${ingredient.name} hit its reorder point, so it was ordered on its own at the base price.` }],
      shippingAvoidedCents: 0,
    };
    plan.pos.push(finalize(world, draft, "base", true));
  }
  return plan;
}

export { tierFor };
