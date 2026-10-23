// Preset stories for the presentation. Each one changes something visible and gives the agent
// something different to respond to.
import { SETTINGS } from "./data.ts";
import type { Order, OrderLine } from "./orders.ts";
import { addLog, createWorld, emptyEffects, type ScenarioEffects, type World, type WorldOptions } from "./sim.ts";

export type Scenario = {
  id: string;
  name: string;
  /** One sentence for the banner. */
  banner: string;
  effects?: () => Partial<ScenarioEffects>;
  extraStock?: WorldOptions["extraStock"];
  /** Picks the audit-log entries that show how the agent responded. */
  response?: RegExp;
};

const cateringLines = (count: number, drinkId: string): OrderLine[] =>
  Array.from({ length: count }, () => ({ drinkId, iced: true, milk: "whole" as const }));

const CATERING: Order = {
  id: "3-CATER",
  day: 2,
  minute: 10 * 60,
  note: "Catering order",
  lines: [...cateringLines(36, "strawberry-booza"), ...cateringLines(24, "mango-sticky")],
};

export const SCENARIOS: Scenario[] = [
  {
    id: "normal",
    name: "Normal week",
    banner: "A typical June week: busier weekends, a few warm afternoons, nothing unusual.",
  },
  {
    id: "heat-wave",
    name: "Heat wave",
    banner: "A heat wave hits this week (93–99°F), so far more drinks are ordered iced. Watch the cups, straws, and purées.",
    effects: () => ({ tempByDay: { 0: 93, 1: 96, 2: 98, 3: 99, 4: 97, 5: 95, 6: 93 } }),
    response: /iced cups|straws/i,
  },
  {
    id: "price-increase",
    name: "Supplier price increase",
    banner: "Mossy Hill Tea Co. raises its matcha prices 25% starting today. Watch where the agent buys matcha instead.",
    effects: () => ({ priceFactor: { "mossy-hill": 1.25 } }),
    response: /Mossy Hill|cheaper|culinary matcha/i,
  },
  {
    id: "late-delivery",
    name: "Late delivery",
    banner: "Paper Crane Packaging is running 5 days behind on deliveries. Watch the iced cups.",
    effects: () => ({ delays: [{ supplierId: "paper-crane", extraDays: 5, fromDay: 0, toDay: 9 }] }),
    response: /late|backup/i,
  },
  {
    id: "near-expiry",
    name: "Matcha near expiry",
    banner: "A big bag of ceremonial matcha expires on Saturday. Can we use it up before it goes to waste?",
    extraStock: { "ceremonial-matcha": [{ qty: 2000, ageDays: 40 }] },
    response: /use it up|special|ceremonial matcha/i,
  },
  {
    id: "catering",
    name: "Large catering order",
    banner: "A local office booked 60 iced drinks for Wednesday at 10 am, and the agent knows about it in advance.",
    effects: () => ({ bookings: [CATERING] }),
    response: /booked order|catering/i,
  },
];

export function getScenario(id: string): Scenario {
  return SCENARIOS.find((scenario) => scenario.id === id) ?? SCENARIOS[0];
}

export function createScenarioWorld(seed: number, scenarioId = "normal", options: WorldOptions = {}): World {
  const scenario = getScenario(scenarioId);
  const effects: ScenarioEffects = { ...emptyEffects(), ...scenario.effects?.() };
  const world = createWorld(seed, scenario.id, { effects, extraStock: scenario.extraStock, ...options });
  if (scenario.id !== "normal") {
    world.minute = SETTINGS.openMinute;
    addLog(world, "system", `Scenario: ${scenario.name}`, scenario.banner);
  }
  return world;
}
