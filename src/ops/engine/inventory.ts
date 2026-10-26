// Batches on the shelf. Stock is always used oldest batch first.
import { getIngredient, type Ingredient } from "./data.ts";

export type Batch = {
  id: string;
  qty: number;
  initialQty: number;
  /** What the whole batch cost when it arrived, in cents. */
  costCents: number;
  receivedDay: number;
  /** Day the batch must be thrown out (end of that day). `null` = doesn't expire in the demo. */
  expiresDay: number | null;
  source: string;
};

export function onHand(batches: Batch[]): number {
  return batches.reduce((sum, batch) => sum + batch.qty, 0);
}

export function batchValueCents(batch: Batch): number {
  return batch.initialQty > 0 ? Math.round((batch.costCents * batch.qty) / batch.initialQty) : 0;
}

export function stockValueCents(batches: Batch[]): number {
  return batches.reduce((sum, batch) => sum + batchValueCents(batch), 0);
}

export function sortOldestFirst(batches: Batch[]): void {
  batches.sort((a, b) => a.receivedDay - b.receivedDay || a.id.localeCompare(b.id));
}

/**
 * Takes `amount` from the oldest batches first and drops empty batches.
 * Returns how much was actually taken (less than asked if stock runs out).
 */
export function deductOldestFirst(batches: Batch[], amount: number): number {
  sortOldestFirst(batches);
  let remaining = amount;
  for (const batch of batches) {
    if (remaining <= 0) break;
    const taken = Math.min(batch.qty, remaining);
    batch.qty -= taken;
    remaining -= taken;
  }
  for (let index = batches.length - 1; index >= 0; index -= 1) {
    if (batches[index].qty <= 0) batches.splice(index, 1);
  }
  return amount - remaining;
}

/** Removes batches whose freshness window has ended and returns them. */
export function removeExpired(batches: Batch[], day: number): Batch[] {
  const expired = batches.filter((batch) => batch.expiresDay !== null && batch.expiresDay <= day);
  for (const batch of expired) batches.splice(batches.indexOf(batch), 1);
  return expired;
}

export function expiryFor(ingredient: Ingredient, receivedDay: number): number | null {
  return ingredient.freshnessDays === null ? null : receivedDay + ingredient.freshnessDays;
}

const kilo = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** "1.4 kg", "3.2 L", "450 cups". */
export function formatQty(ingredientId: string, qty: number): string {
  const ingredient = getIngredient(ingredientId);
  if (ingredient.unit === "each") return `${whole.format(qty)} ${ingredient.countNoun ?? ""}`.trim();
  const big = ingredient.unit === "g" ? "kg" : "L";
  return Math.abs(qty) >= 1000 ? `${kilo.format(qty / 1000)} ${big}` : `${whole.format(qty)} ${ingredient.unit}`;
}
