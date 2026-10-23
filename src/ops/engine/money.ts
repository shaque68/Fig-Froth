// All money in the demo is stored as integer cents and only formatted for display.

const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const wholeDollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function formatCents(cents: number): string {
  return dollars.format(cents / 100);
}

/** Rounded to whole dollars, for headlines and chart labels. */
export function formatDollars(cents: number): string {
  return wholeDollars.format(Math.round(cents / 100));
}

/** Share of a whole-cent amount, rounded back to whole cents. */
export function prorateCents(totalCents: number, part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((totalCents * part) / whole);
}
