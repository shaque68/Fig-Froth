// "Simple ordering" vs "Smarter ordering": the same seed, scenario, and customers for 30 days.
import { formatDollars } from "./money.ts";
import { createScenarioWorld } from "./scenarios.ts";
import { runToDay } from "./shop.ts";
import type { Policy, World } from "./sim.ts";

export type PolicyResult = {
  policy: Policy;
  label: string;
  goodsCents: number;
  shippingCents: number;
  wasteCents: number;
  spendCents: number;
  drinksMissed: number;
  drinksMade: number;
  avgInventoryCents: number;
  endInventoryCents: number;
  orders: number;
};

export type Comparison = {
  seed: number;
  scenarioId: string;
  days: number;
  simple: PolicyResult;
  smart: PolicyResult;
  takeaway: string;
  stockNote: string;
};

function summarize(world: World, label: string): PolicyResult {
  const sum = (pick: (day: World["days"][number]) => number) => world.days.reduce((total, day) => total + pick(day), 0);
  const spendCents = sum((day) => day.spendCents);
  const shippingCents = sum((day) => day.shippingCents);
  return {
    policy: world.policy,
    label,
    goodsCents: spendCents - shippingCents,
    shippingCents,
    wasteCents: sum((day) => day.wasteCents),
    spendCents,
    drinksMissed: sum((day) => day.drinksMissed),
    drinksMade: sum((day) => day.drinksMade),
    avgInventoryCents: Math.round(sum((day) => day.inventoryValueCents) / Math.max(1, world.days.length)),
    endInventoryCents: world.days.at(-1)?.inventoryValueCents ?? 0,
    orders: world.purchaseOrders.length,
  };
}

export function runPolicy(seed: number, scenarioId: string, policy: Policy, days: number): World {
  const world = createScenarioWorld(seed, scenarioId, { policy, autoApproveAll: true });
  runToDay(world, days);
  return world;
}

export function runComparison(seed: number, scenarioId = "normal", days = 30): Comparison {
  const simple = summarize(runPolicy(seed, scenarioId, "simple", days), "Simple ordering");
  const smart = summarize(runPolicy(seed, scenarioId, "smart", days), "Smarter ordering");
  return { seed, scenarioId, days, simple, smart, takeaway: takeaway(simple, smart, days), stockNote: stockNote(simple, smart) };
}

/** The one-sentence caption for the chart. */
export function takeaway(simple: PolicyResult, smart: PolicyResult, days: number): string {
  // Thrown-out stock was already paid for, so it's part of spend rather than added on top.
  const simpleCost = simple.spendCents;
  const smartCost = smart.spendCents;
  const saved = simpleCost - smartCost;
  const shippingSaved = simple.shippingCents - smart.shippingCents;
  const missed = simple.drinksMissed - smart.drinksMissed;
  const stockouts = missed > 0
    ? ` and ${missed} fewer drinks we couldn’t make`
    : missed < 0 ? `, though it missed ${-missed} more drinks` : smart.drinksMissed === 0 ? ", with no drinks missed either way" : "";
  if (saved <= 0) return `Over ${days} simulated days, smarter ordering cost ${formatDollars(-saved)} more than simple ordering${stockouts}.`;
  const biggest = shippingSaved >= saved / 2 ? `, mostly by avoiding ${formatDollars(shippingSaved)} in shipping fees` : `, mostly through bulk prices`;
  return `Over ${days} simulated days, smarter ordering spent ${formatDollars(saved)} less (${Math.round((saved / simpleCost) * 100)}%)${biggest}${stockouts}.`;
}

/** Honest footnote: bulk buying can mean more stock on the shelf. */
export function stockNote(simple: PolicyResult, smart: PolicyResult): string {
  const diff = smart.avgInventoryCents - simple.avgInventoryCents;
  if (Math.abs(diff) < 2500) return "Both keep about the same amount of stock on the shelf.";
  return diff > 0
    ? `To get bulk prices it keeps about ${formatDollars(diff)} more stock on the shelf on an average day.`
    : `It also keeps about ${formatDollars(-diff)} less stock on the shelf on an average day.`;
}
