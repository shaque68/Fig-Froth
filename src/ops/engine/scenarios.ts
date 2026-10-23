// Preset stories for the presentation. Each one changes something visible and gives the agent
// something different to respond to.
import { createWorld, emptyEffects, type World, type WorldOptions } from "./sim.ts";

export type Scenario = {
  id: string;
  name: string;
  /** One sentence for the banner. */
  banner: string;
};

export const SCENARIOS: Scenario[] = [
  { id: "normal", name: "Normal week", banner: "A typical June week: busier weekends, a few warm afternoons, nothing unusual." },
];

export function getScenario(id: string): Scenario {
  return SCENARIOS.find((scenario) => scenario.id === id) ?? SCENARIOS[0];
}

export function createScenarioWorld(seed: number, scenarioId = "normal", options: WorldOptions = {}): World {
  return createWorld(seed, getScenario(scenarioId).id, { effects: emptyEffects(), ...options });
}
