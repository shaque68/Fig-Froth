// Freshness: which batches expire soon, how much would go to waste, and "use it up" specials.
import { DRINKS, INGREDIENTS, SETTINGS, getIngredient, type Drink } from "./data.ts";
import { dailyUsage } from "./forecast.ts";
import { batchValueCents, formatQty, sortOldestFirst, type Batch } from "./inventory.ts";
import { formatCents } from "./money.ts";
import { dayConditions, expectedOrderCount, formatDay } from "./orders.ts";
import { addLog, type World } from "./sim.ts";

export type ExpiringBatch = {
  ingredientId: string;
  batch: Batch;
  /** Days of service left before it must be thrown out, counting from tomorrow. */
  daysOfUse: number;
  /** How much of it we expect to throw out at the current pace. */
  leftover: number;
  leftoverCents: number;
};

const AVERAGE_DRINKS_PER_ORDER = 1.34;
export const SPECIAL_BOOST = 0.8;

/** Every perishable batch, with how much of it we expect to use before it expires (oldest first). */
export function freshnessOutlook(world: World): ExpiringBatch[] {
  const result: ExpiringBatch[] = [];
  for (const ingredient of INGREDIENTS) {
    if (ingredient.freshnessDays === null) continue;
    const usage = dailyUsage(world.demandHistory[ingredient.id]);
    const batches = [...world.stock[ingredient.id]];
    sortOldestFirst(batches);
    // While the shop is open, the rest of today counts too.
    const restOfToday = Math.max(0, (SETTINGS.closeMinute - world.minute) / (SETTINGS.closeMinute - SETTINGS.openMinute));
    let ahead = 0;
    for (const batch of batches) {
      if (batch.expiresDay === null) continue;
      const daysOfUse = Math.max(0, batch.expiresDay - world.day + restOfToday);
      const usedBeforeExpiry = Math.max(0, usage * daysOfUse - ahead);
      const leftover = Math.max(0, Math.min(batch.qty, batch.qty - usedBeforeExpiry));
      result.push({ ingredientId: ingredient.id, batch, daysOfUse, leftover, leftoverCents: Math.round((batchValueCents(batch) * leftover) / Math.max(1, batch.qty)) });
      ahead += batch.qty;
    }
  }
  return result.sort((a, b) => (a.batch.expiresDay ?? 0) - (b.batch.expiresDay ?? 0));
}

export type SpecialSuggestion = {
  drinkId: string;
  ingredientId: string;
  batchId: string;
  expiresDay: number;
  leftover: number;
  savedQty: number;
  savedCents: number;
  text: string;
};

/** How many of a drink we sell per day, now and with a special running. */
function drinksPerDay(world: World, drink: Drink, boost: number): number {
  const totalWeight = DRINKS.reduce((sum, candidate) => sum + candidate.popularity * (1 + (world.specials[candidate.id] ?? 0)), 0);
  const weight = drink.popularity * (1 + (world.specials[drink.id] ?? 0));
  const boostedWeight = drink.popularity * (1 + boost);
  const orders = expectedOrderCount(dayConditions(world.seed, world.day + 1, { tempF: world.effects.tempByDay[world.day + 1] }));
  const share = boost > 0 ? boostedWeight / (totalWeight - weight + boostedWeight) : weight / totalWeight;
  return orders * AVERAGE_DRINKS_PER_ORDER * share;
}

/** The best drink to feature so the batch most at risk of expiring gets used up. */
export function suggestSpecial(world: World): SpecialSuggestion | null {
  const atRisk = freshnessOutlook(world)
    .filter((item) => item.leftoverCents >= 1500 && item.daysOfUse >= 1 && item.daysOfUse <= 7)
    .sort((a, b) => b.leftoverCents - a.leftoverCents)[0];
  if (!atRisk) return null;
  const options = DRINKS.filter((drink) => drink.recipe.some((line) => line.ingredientId === atRisk.ingredientId)).map((drink) => {
    const perDrink = drink.recipe.find((line) => line.ingredientId === atRisk.ingredientId)!.amount;
    const extraPerDay = (drinksPerDay(world, drink, SPECIAL_BOOST) - drinksPerDay(world, drink, 0)) * perDrink;
    return { drink, savedQty: Math.min(atRisk.leftover, extraPerDay * atRisk.daysOfUse) };
  }).sort((a, b) => b.savedQty - a.savedQty);
  const best = options[0];
  if (!best || best.savedQty <= 0 || world.specials[best.drink.id]) return null;
  const savedCents = Math.round((atRisk.leftoverCents * best.savedQty) / Math.max(1, atRisk.leftover));
  const name = getIngredient(atRisk.ingredientId).name.toLowerCase();
  return {
    drinkId: best.drink.id,
    ingredientId: atRisk.ingredientId,
    batchId: atRisk.batch.id,
    expiresDay: atRisk.batch.expiresDay!,
    leftover: atRisk.leftover,
    savedQty: Math.round(best.savedQty),
    savedCents,
    text: `About ${formatQty(atRisk.ingredientId, Math.round(atRisk.leftover))} of ${name} (${formatCents(atRisk.leftoverCents)}) will expire ${formatDay(atRisk.batch.expiresDay!)} at today’s pace. Featuring ${best.drink.name} as the matcha of the day should use up about ${formatQty(atRisk.ingredientId, Math.round(best.savedQty))} of it, saving about ${formatCents(savedCents)}.`,
  };
}

export function startSpecial(world: World, suggestion: SpecialSuggestion): void {
  world.specials[suggestion.drinkId] = SPECIAL_BOOST;
  world.specialFor = { drinkId: suggestion.drinkId, batchId: suggestion.batchId, untilDay: suggestion.expiresDay };
  const drink = DRINKS.find((candidate) => candidate.id === suggestion.drinkId)!;
  addLog(world, "you", `You started a “use it up” special: ${drink.name}`, `Matcha of the day through ${formatDay(suggestion.expiresDay)} to use up ${getIngredient(suggestion.ingredientId).name.toLowerCase()} before it expires. It starts with the next day’s customers.`);
}

/** Ends a special once the batch it was for is used up or gone. */
export function endFinishedSpecials(world: World): void {
  const special = world.specialFor;
  if (!special) return;
  const stillThere = Object.values(world.stock).some((batches) => batches.some((batch) => batch.id === special.batchId));
  if (stillThere && world.day < special.untilDay) return;
  delete world.specials[special.drinkId];
  world.specialFor = undefined;
  const drink = DRINKS.find((candidate) => candidate.id === special.drinkId)!;
  addLog(world, "agent", `Ended the ${drink.name} special`, stillThere ? "The batch it was for has reached its use-by date." : "The batch it was for is used up.");
}
