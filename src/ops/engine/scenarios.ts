// Preset stories for the presentation. Each one changes something visible and gives the agent
// something different to respond to.
import { SETTINGS } from "./data.ts";
import type { Order, OrderLine } from "./orders.ts";
import { addLog, createWorld, emptyEffects, type ScenarioEffects, type World, type WorldOptions } from "./sim.ts";

export type Scenario = {
  id: string;
  name: string;
  /** Who the notice comes from, e.g. "Weather alert" or "Delivery delay · Imperial Dade". */
  source: string;
  /** One sentence for the notice. */
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
    source: "",
    banner: "A typical June week: busier weekends, a few warm afternoons, nothing unusual.",
  },
  {
    id: "heat-wave",
    name: "Heat wave",
    source: "Weather alert",
    banner: "Heat advisory for Paterson this week, with highs of 93–99°F. Expect far more iced drinks.",
    effects: () => ({ tempByDay: { 0: 93, 1: 96, 2: 98, 3: 99, 4: 97, 5: 95, 6: 93 } }),
    response: /iced cups|straws/i,
  },
  {
    id: "price-increase",
    name: "Supplier price increase",
    source: "Price change · Ippodo Tea",
    banner: "Matcha prices are going up 25%, effective today.",
    effects: () => ({ priceFactor: { "ippodo": 1.25 } }),
    response: /Ippodo Tea|cheaper|culinary matcha/i,
  },
  {
    id: "late-delivery",
    name: "Late delivery",
    source: "Delivery delay · Imperial Dade",
    banner: "Shipments are running about 5 days behind schedule.",
    effects: () => ({ delays: [{ supplierId: "imperial-dade", extraDays: 5, fromDay: 0, toDay: 9 }] }),
    response: /late|backup/i,
  },
  {
    id: "near-expiry",
    name: "Matcha near expiry",
    source: "Use-by alert",
    banner: "A 2 kg bag of ceremonial matcha must be used by Saturday.",
    extraStock: { "ceremonial-matcha": [{ qty: 2000, ageDays: 40 }] },
    response: /use it up|special|ceremonial matcha/i,
  },
  {
    id: "catering",
    name: "Large catering order",
    source: "New catering booking",
    banner: "60 iced drinks for a local office, Wednesday at 10 am.",
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
    addLog(world, "system", scenario.source, scenario.banner);
  }
  return world;
}
