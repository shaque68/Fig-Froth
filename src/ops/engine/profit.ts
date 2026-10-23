// Profit per drink: what each drink costs to make at current supplier prices, and its margin.
import { DRINKS, SUPPLIERS, getIngredient, offerFor, type Drink, type RecipeLine } from "./data.ts";
import { adjustedPrice } from "./purchasing.ts";
import type { World } from "./sim.ts";

export const TARGET_MARGIN = 0.7;

export type CostLine = { ingredientId: string; amount: number; costCents: number; supplierId: string };
export type DrinkProfit = {
  drink: Drink;
  priceCents: number;
  costCents: number;
  marginCents: number;
  margin: number;
  lines: CostLine[];
};

export type WhatIf = { supplierId: string; percent: number } | null;

/** Cheapest approved base-tier price per unit (g, ml, or each), in fractional cents. */
export function unitCost(world: World, ingredientId: string, whatIf: WhatIf = null): { cents: number; supplierId: string } {
  const options = SUPPLIERS.filter((supplier) => supplier.approved && offerFor(supplier, ingredientId)).map((supplier) => {
    const offer = offerFor(supplier, ingredientId)!;
    const bump = whatIf && whatIf.supplierId === supplier.id ? 1 + whatIf.percent / 100 : 1;
    return { supplierId: supplier.id, cents: (adjustedPrice(world, supplier.id, offer.tiers[0].packPriceCents) * bump) / offer.packSize };
  });
  return options.sort((a, b) => a.cents - b.cents)[0] ?? { cents: 0, supplierId: "" };
}

/** Recipe for one iced drink with whole milk, including the cup, lid, and straw. */
export function standardRecipe(drink: Drink): RecipeLine[] {
  return [
    ...drink.recipe,
    { ingredientId: "whole-milk", amount: drink.milkMl },
    { ingredientId: "cold-cups", amount: 1 },
    { ingredientId: "lids", amount: 1 },
    { ingredientId: "straws", amount: 1 },
  ];
}

export function drinkProfits(world: World, whatIf: WhatIf = null): DrinkProfit[] {
  return DRINKS.map((drink) => {
    const lines = standardRecipe(drink).map((line) => {
      const unit = unitCost(world, line.ingredientId, whatIf);
      return { ingredientId: line.ingredientId, amount: line.amount, costCents: unit.cents * line.amount, supplierId: unit.supplierId };
    });
    const costCents = Math.round(lines.reduce((sum, line) => sum + line.costCents, 0));
    const marginCents = drink.priceCents - costCents;
    return { drink, priceCents: drink.priceCents, costCents, marginCents, margin: marginCents / drink.priceCents, lines: lines.map((line) => ({ ...line, costCents: Math.round(line.costCents) })) };
  });
}

/** Drinks that fall below the target margin under the what-if but were above it before. */
export function marginLosers(before: DrinkProfit[], after: DrinkProfit[]): DrinkProfit[] {
  return after.filter((profit, index) => profit.margin < TARGET_MARGIN && before[index].margin >= TARGET_MARGIN);
}

export function ingredientName(id: string): string {
  return getIngredient(id).name;
}
