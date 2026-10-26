// The simulated shop. A World is plain data (safe to structuredClone); the functions below
// mutate it in place so the UI can clone, step, and render.
import { DRINKS, INGREDIENTS, SETTINGS, STARTING_STOCK, getIngredient, getSupplier, offerFor } from "./data.ts";
import { lineUsage } from "./forecast.ts";
import { deductOldestFirst, expiryFor, onHand, removeExpired, stockValueCents, type Batch } from "./inventory.ts";
import { dayConditions, generateDayOrders, type DayConditions, type Order, type OrderLine } from "./orders.ts";
import { priceCart, type PromotionKind } from "../../pricing.ts";

export type Policy = "smart" | "simple";

export type ServedOrder = {
  order: Order;
  made: number;
  missed: number;
  /** Ingredients that ran out for the missed drinks. */
  missing: string[];
  usage: Record<string, number>;
  revenueCents: number;
};

export type DayStats = {
  day: number;
  tempF: number;
  orders: number;
  drinksMade: number;
  drinksMissed: number;
  revenueCents: number;
  wasteCents: number;
  spendCents: number;
  shippingCents: number;
  /** Value of everything on the shelf at close, at cost. */
  inventoryValueCents: number;
};

export type LogActor = "agent" | "you" | "system";

export type LogEntry = {
  id: number;
  day: number;
  minute: number;
  actor: LogActor;
  title: string;
  detail?: string;
  poId?: string;
};

export type WasteRecord = { day: number; ingredientId: string; qty: number; valueCents: number };

export type ScenarioEffects = {
  /** Fixed temperatures for specific days. */
  tempByDay: Record<number, number>;
  /** Multiplies a supplier's pack prices (1.2 = 20% more). */
  priceFactor: Record<string, number>;
  /** A supplier's deliveries arrive late during a window of days. */
  delays: Array<{ supplierId: string; extraDays: number; fromDay: number; toDay: number }>;
  /** Pre-booked orders, known in advance. */
  bookings: Order[];
};

// Purchase orders are defined here (not in the agent) so the World stays one plain type.
export type PoStatus = "draft" | "awaiting" | "approved" | "sent" | "received" | "invoiced" | "matched" | "flagged" | "disputed" | "rejected";

export type PoLine = {
  ingredientId: string;
  packs: number;
  packSize: number;
  packLabel: string;
  brand: string;
  packPriceCents: number;
  /** Base-tier pack price, so bulk savings can be shown. */
  basePackPriceCents: number;
  totalCents: number;
  /** Why the line exists: needed now, pulled forward, free-shipping top-up, etc. */
  role: "needed" | "pulled-forward" | "top-up" | "backup";
};

export type PoReason = { rule: string; text: string; savingsCents?: number };

export type PurchaseOrder = {
  id: string;
  supplierId: string;
  status: PoStatus;
  lines: PoLine[];
  subtotalCents: number;
  shippingCents: number;
  totalCents: number;
  reasons: PoReason[];
  createdDay: number;
  /** When the supplier promised it. */
  promisedDay: number;
  /** When it will actually show up (late-delivery scenario can push this out). */
  arrivalDay: number;
  sentDay?: number;
  receivedDay?: number;
  needsApproval: boolean;
  /** Who let it go out: a person, the comparison run, or automatically (under the limit). */
  approvedBy?: "you" | "same-day" | "auto";
  isBackup?: boolean;
  /** For a backup order, the late order it covers. */
  backupFor?: string;
  savings: { bulkCents: number; shippingAvoidedCents: number };
  receipt?: Array<{ ingredientId: string; packs: number }>;
  invoice?: { lines: Array<{ ingredientId: string; packs: number; packPriceCents: number }>; shippingCents: number; totalCents: number };
  matchNotes?: string[];
  lateNoticeDay?: number;
};

/** A discount or bundle the owner published to the storefront. */
export type Promotion = {
  id: string;
  kind: PromotionKind;
  productIds: string[];
  percentOff: number;
  headline: string;
  detail: string;
  status: "live" | "ended";
  startDay: number;
  /** Runs through this day (the batch's use-by day). Bundles from the builder run until ended. */
  endDay?: number;
  /** The perishable batch it's meant to use up. */
  ingredientId?: string;
  batchId?: string;
  endedDay?: number;
  endedReason?: string;
  /** What the forecast expected when it was published. */
  forecast: { extraPerDay: number; usePerDay: number; savedQty: number; savedCents: number; netCents: number };
  results: { drinks: number; bundles: number; discountCents: number };
};

/** One pass of the restock agent's loop, summarized for the step trace. */
export type AgentRun = {
  day: number;
  observe: string;
  plan: string;
  draft: string;
  approval: string;
  log: string;
  poIds: string[];
  awaitingIds: string[];
};

export type World = {
  seed: number;
  scenarioId: string;
  policy: Policy;
  /** Headless runs (the 30-day comparison) approve everything the same day. */
  autoApproveAll: boolean;
  day: number;
  minute: number;
  conditions: DayConditions;
  stock: Record<string, Batch[]>;
  queue: Order[];
  recent: ServedOrder[];
  demandHistory: Record<string, number[]>;
  todayDemand: Record<string, number>;
  today: DayStats;
  days: DayStats[];
  waste: WasteRecord[];
  purchaseOrders: PurchaseOrder[];
  log: LogEntry[];
  effects: ScenarioEffects;
  /** "Use it up" specials currently running: drink id → popularity boost. */
  specials: Record<string, number>;
  /** The special that's running and the batch it's meant to use up. */
  specialFor?: { drinkId: string; batchId: string; untilDay: number };
  /** The agent's latest "use it up" suggestion, if any. */
  specialSuggestion?: { drinkId: string; ingredientId: string; batchId: string; expiresDay: number; leftover: number; savedQty: number; savedCents: number; text: string } | null;
  agentRuns: AgentRun[];
  promotions: Promotion[];
  counters: { po: number; batch: number; log: number; promo: number };
};

const RECENT_LIMIT = 40;
const OAT_UPCHARGE_CENTS = 75;

export function emptyEffects(): ScenarioEffects {
  return { tempByDay: {}, priceFactor: {}, delays: [], bookings: [] };
}

function blankDay(day: number, tempF: number): DayStats {
  return { day, tempF, orders: 0, drinksMade: 0, drinksMissed: 0, revenueCents: 0, wasteCents: 0, spendCents: 0, shippingCents: 0, inventoryValueCents: 0 };
}

export function addLog(world: World, actor: LogActor, title: string, detail?: string, poId?: string): void {
  world.counters.log += 1;
  world.log.push({ id: world.counters.log, day: world.day, minute: world.minute, actor, title, detail, poId });
}

export function newBatch(world: World, ingredientId: string, qty: number, costCents: number, receivedDay: number, source: string): Batch {
  world.counters.batch += 1;
  return { id: `B${world.counters.batch}`, qty, initialQty: qty, costCents, receivedDay, expiresDay: expiryFor(getIngredient(ingredientId), receivedDay), source };
}

/** Cost of stock at the home supplier's base price, used to value the starting shelf. */
function homeCostCents(ingredientId: string, qty: number): number {
  const ingredient = getIngredient(ingredientId);
  const offer = offerFor(getSupplier(ingredient.homeSupplierId), ingredientId);
  if (!offer) return 0;
  return Math.round((offer.tiers[0].packPriceCents * qty) / offer.packSize);
}

export type DayHooks = {
  /** Runs right after the shop opens (deliveries). */
  onOpen?: (world: World) => void;
  /** Runs at close, after expired stock is thrown out (the restock agent). */
  onClose?: (world: World) => void;
};

export type WorldOptions = {
  policy?: Policy;
  autoApproveAll?: boolean;
  effects?: ScenarioEffects;
  /** Replace or add starting batches (scenarios). */
  extraStock?: Record<string, Array<{ qty: number; ageDays: number }>>;
  hooks?: DayHooks;
};

export function createWorld(seed: number, scenarioId = "normal", options: WorldOptions = {}): World {
  const hooks = options.hooks ?? {};
  const effects = options.effects ?? emptyEffects();
  const conditions = dayConditions(seed, 0, { tempF: effects.tempByDay[0] });
  const world: World = {
    seed,
    scenarioId,
    policy: options.policy ?? "smart",
    autoApproveAll: options.autoApproveAll ?? false,
    day: 0,
    minute: SETTINGS.openMinute,
    conditions,
    stock: {},
    queue: [],
    recent: [],
    demandHistory: {},
    todayDemand: {},
    today: blankDay(0, conditions.tempF),
    days: [],
    waste: [],
    purchaseOrders: [],
    log: [],
    effects,
    specials: {},
    agentRuns: [],
    promotions: [],
    counters: { po: 1000, batch: 0, log: 0, promo: 0 },
  };

  for (const ingredient of INGREDIENTS) {
    const batches = [...(STARTING_STOCK[ingredient.id] ?? []), ...(options.extraStock?.[ingredient.id] ?? [])];
    world.stock[ingredient.id] = batches.map((start) => newBatch(world, ingredient.id, start.qty, homeCostCents(ingredient.id, start.qty), -start.ageDays, "Starting shelf"));
    world.demandHistory[ingredient.id] = [];
  }

  // A week of simulated history so daily usage is realistic from the first morning.
  for (let day = -SETTINGS.historyDays; day < 0; day += 1) {
    const demand: Record<string, number> = {};
    for (const order of generateDayOrders(seed, dayConditions(seed, day))) {
      for (const line of order.lines) for (const use of lineUsage(line)) demand[use.ingredientId] = (demand[use.ingredientId] ?? 0) + use.amount;
    }
    for (const ingredient of INGREDIENTS) world.demandHistory[ingredient.id].push(demand[ingredient.id] ?? 0);
  }

  openDay(world, hooks);
  return world;
}

export function openDay(world: World, hooks: DayHooks = {}): void {
  world.conditions = dayConditions(world.seed, world.day, { tempF: world.effects.tempByDay[world.day] });
  world.minute = SETTINGS.openMinute;
  world.today = blankDay(world.day, world.conditions.tempF);
  world.todayDemand = {};
  const generated = generateDayOrders(world.seed, world.conditions, { drinkBoosts: world.specials, promotions: livePromotions(world) });
  const booked = world.effects.bookings.filter((order) => order.day === world.day);
  world.queue = [...generated, ...booked].sort((a, b) => a.minute - b.minute || a.id.localeCompare(b.id));
  hooks.onOpen?.(world);
}

export function livePromotions(world: World): Promotion[] {
  return world.promotions.filter((promo) => promo.status === "live");
}

export function serveOrder(world: World, order: Order): ServedOrder {
  const served: ServedOrder = { order, made: 0, missed: 0, missing: [], usage: {}, revenueCents: 0 };
  const made: OrderLine[] = [];
  for (const line of order.lines) {
    const needs = lineUsage(line);
    for (const use of needs) world.todayDemand[use.ingredientId] = (world.todayDemand[use.ingredientId] ?? 0) + use.amount;
    const short = needs.filter((use) => onHand(world.stock[use.ingredientId]) < use.amount).map((use) => use.ingredientId);
    if (short.length > 0) {
      served.missed += 1;
      for (const id of short) if (!served.missing.includes(id)) served.missing.push(id);
      continue;
    }
    for (const use of needs) {
      deductOldestFirst(world.stock[use.ingredientId], use.amount);
      served.usage[use.ingredientId] = (served.usage[use.ingredientId] ?? 0) + use.amount;
    }
    served.made += 1;
    made.push(line);
  }
  served.revenueCents = chargeFor(world, made);
  world.minute = Math.max(world.minute, order.minute);
  world.today.orders += 1;
  world.today.drinksMade += served.made;
  world.today.drinksMissed += served.missed;
  world.today.revenueCents += served.revenueCents;
  world.recent.unshift(served);
  if (world.recent.length > RECENT_LIMIT) world.recent.length = RECENT_LIMIT;
  return served;
}

/** What the drinks that were made cost the customer, with any live promotions applied. */
function chargeFor(world: World, lines: OrderLine[]): number {
  const promotions = livePromotions(world);
  const cartLines = lines.map((line) => ({
    productId: line.drinkId,
    quantity: 1,
    unitCents: DRINKS.find((candidate) => candidate.id === line.drinkId)?.priceCents ?? 0,
    extrasCents: line.milk === "oat" ? OAT_UPCHARGE_CENTS : 0,
  }));
  if (promotions.length === 0) return cartLines.reduce((sum, line) => sum + line.unitCents + line.extrasCents, 0);
  const priced = priceCart(cartLines, promotions);
  for (const line of priced.lines) {
    const promo = line.promotionId ? promotions.find((candidate) => candidate.id === line.promotionId) : undefined;
    if (!promo) continue;
    promo.results.drinks += 1;
    promo.results.discountCents += line.unitCents - line.saleUnitCents;
  }
  for (const bundle of priced.bundles) {
    const promo = promotions.find((candidate) => candidate.id === bundle.promotionId)!;
    promo.results.bundles += bundle.count;
    promo.results.discountCents += bundle.discountCents;
  }
  return priced.subtotalCents;
}

/** Serves every remaining order before `minute`. Returns what was served. */
export function runUntil(world: World, minute: number): ServedOrder[] {
  const served: ServedOrder[] = [];
  while (world.queue.length > 0 && world.queue[0].minute < minute) {
    served.push(serveOrder(world, world.queue.shift()!));
  }
  world.minute = Math.max(world.minute, Math.min(minute, SETTINGS.closeMinute));
  return served;
}

export function closeDay(world: World, hooks: DayHooks = {}): void {
  world.minute = SETTINGS.closeMinute;
  for (const ingredient of INGREDIENTS) {
    const expired = removeExpired(world.stock[ingredient.id], world.day);
    for (const batch of expired) {
      const valueCents = Math.round((batch.costCents * batch.qty) / batch.initialQty);
      world.waste.push({ day: world.day, ingredientId: ingredient.id, qty: batch.qty, valueCents });
      world.today.wasteCents += valueCents;
    }
    world.demandHistory[ingredient.id].push(world.todayDemand[ingredient.id] ?? 0);
  }
  hooks.onClose?.(world);
  world.today.inventoryValueCents = INGREDIENTS.reduce((sum, ingredient) => sum + stockValueCents(world.stock[ingredient.id]), 0);
  world.days.push(world.today);
}

/** Closes today and opens tomorrow. */
export function advanceDay(world: World, hooks: DayHooks = {}): void {
  closeDay(world, hooks);
  world.day += 1;
  openDay(world, hooks);
}

/** Serves the rest of today, closes, and opens tomorrow. */
export function simulateDay(world: World, hooks: DayHooks = {}): void {
  runUntil(world, Number.POSITIVE_INFINITY);
  advanceDay(world, hooks);
}

/** The next customer order. If today is done, closes the day and opens the next one first. */
export function nextOrder(world: World, hooks: DayHooks = {}): ServedOrder {
  if (world.queue.length === 0) advanceDay(world, hooks);
  return serveOrder(world, world.queue.shift()!);
}

export function onHandOf(world: World, ingredientId: string): number {
  return onHand(world.stock[ingredientId] ?? []);
}
