// Fake data for the "Behind the Counter" demo. Drink names and prices mirror the
// storefront menu; every recipe, stock level, supplier, and price below is fictional.
import { initialProducts } from "../../catalog.ts";

export type Unit = "g" | "ml" | "each";
export type Shelf = "matcha" | "dairy" | "flavors" | "packaging";
export type Vessel = "tin" | "carton" | "jar" | "box";

export type Ingredient = {
  id: string;
  name: string;
  unit: Unit;
  /** Noun for "each" items, e.g. "cups". */
  countNoun?: string;
  shelf: Shelf;
  vessel: Vessel;
  /** Days a batch stays good after it arrives. `null` means it doesn't expire in the demo window. */
  freshnessDays: number | null;
  color: string;
  homeSupplierId: string;
};

export type RecipeLine = { ingredientId: string; amount: number };

export type Drink = {
  id: string;
  name: string;
  priceCents: number;
  /** Relative popularity used by the order generator. */
  popularity: number;
  /** Added to the chance a drink is ordered iced (strawberry and mango lean iced). */
  icedBias: number;
  milkMl: number;
  recipe: RecipeLine[];
};

export type PriceTier = { minPacks: number; packPriceCents: number };

export type SupplierOffer = {
  ingredientId: string;
  packSize: number;
  packLabel: string;
  tiers: PriceTier[];
};

export type Supplier = {
  id: string;
  name: string;
  approved: boolean;
  leadDays: number;
  shippingCents: number;
  freeShippingAtCents: number;
  /** How many days of stock a normal order covers: the supplier's delivery rhythm. */
  orderCycleDays: number;
  blurb: string;
  offers: SupplierOffer[];
};

export const SHELVES: Array<{ id: Shelf; name: string }> = [
  { id: "matcha", name: "The matcha shelf" },
  { id: "flavors", name: "Syrups & purées" },
  { id: "dairy", name: "The fridge" },
  { id: "packaging", name: "Cups & such" },
];

export const INGREDIENTS: Ingredient[] = [
  { id: "ceremonial-matcha", name: "Ceremonial matcha", unit: "g", shelf: "matcha", vessel: "tin", freshnessDays: 45, color: "#6f8f52", homeSupplierId: "mossy-hill" },
  { id: "culinary-matcha", name: "Culinary matcha", unit: "g", shelf: "matcha", vessel: "tin", freshnessDays: 60, color: "#93a26a", homeSupplierId: "mossy-hill" },
  { id: "whole-milk", name: "Whole milk", unit: "ml", shelf: "dairy", vessel: "carton", freshnessDays: 10, color: "#e2d5b6", homeSupplierId: "little-meadow" },
  { id: "oat-milk", name: "Oat milk", unit: "ml", shelf: "dairy", vessel: "carton", freshnessDays: 30, color: "#dcc9a3", homeSupplierId: "little-meadow" },
  { id: "foam-cream", name: "Cold foam cream", unit: "ml", shelf: "dairy", vessel: "carton", freshnessDays: 14, color: "#eadcc0", homeSupplierId: "little-meadow" },
  { id: "fig-syrup", name: "Fig syrup", unit: "ml", shelf: "flavors", vessel: "jar", freshnessDays: 30, color: "#8c5a6a", homeSupplierId: "orchard-lane" },
  { id: "strawberry-puree", name: "Strawberry purée", unit: "ml", shelf: "flavors", vessel: "jar", freshnessDays: 7, color: "#cf7f8b", homeSupplierId: "orchard-lane" },
  { id: "mango-puree", name: "Mango purée", unit: "ml", shelf: "flavors", vessel: "jar", freshnessDays: 7, color: "#e3ac4b", homeSupplierId: "orchard-lane" },
  { id: "banana-syrup", name: "Banana syrup", unit: "ml", shelf: "flavors", vessel: "jar", freshnessDays: 21, color: "#e4c870", homeSupplierId: "orchard-lane" },
  { id: "rose-syrup", name: "Rose-cardamom syrup", unit: "ml", shelf: "flavors", vessel: "jar", freshnessDays: 45, color: "#cf9a98", homeSupplierId: "orchard-lane" },
  { id: "cold-cups", name: "Iced cups", unit: "each", countNoun: "cups", shelf: "packaging", vessel: "box", freshnessDays: null, color: "#c9d8cf", homeSupplierId: "paper-crane" },
  { id: "hot-cups", name: "Hot cups", unit: "each", countNoun: "cups", shelf: "packaging", vessel: "box", freshnessDays: null, color: "#d8c3a2", homeSupplierId: "paper-crane" },
  { id: "lids", name: "Lids", unit: "each", countNoun: "lids", shelf: "packaging", vessel: "box", freshnessDays: null, color: "#b7beb0", homeSupplierId: "paper-crane" },
  { id: "straws", name: "Straws", unit: "each", countNoun: "straws", shelf: "packaging", vessel: "box", freshnessDays: null, color: "#9db39a", homeSupplierId: "paper-crane" },
];

const priceOf = (productId: string) => {
  const product = initialProducts.find((candidate) => candidate.id === productId);
  if (!product) throw new Error(`Missing storefront product ${productId}`);
  return Math.round(product.price * 100);
};

const drink = (id: string, popularity: number, icedBias: number, milkMl: number, recipe: RecipeLine[]): Drink => {
  const product = initialProducts.find((candidate) => candidate.id === id);
  return { id, name: product?.name ?? id, priceCents: priceOf(id), popularity, icedBias, milkMl, recipe };
};

// Recipes are per 16 oz drink. Milk (whole or oat) and packaging are added per order line.
export const DRINKS: Drink[] = [
  drink("fig-matcha", 22, 0, 200, [{ ingredientId: "ceremonial-matcha", amount: 4 }, { ingredientId: "fig-syrup", amount: 25 }, { ingredientId: "foam-cream", amount: 40 }]),
  drink("strawberry-booza", 18, 0.2, 180, [{ ingredientId: "ceremonial-matcha", amount: 4 }, { ingredientId: "strawberry-puree", amount: 45 }, { ingredientId: "foam-cream", amount: 40 }]),
  drink("mango-sticky", 14, 0.2, 180, [{ ingredientId: "culinary-matcha", amount: 4 }, { ingredientId: "mango-puree", amount: 45 }, { ingredientId: "foam-cream", amount: 40 }]),
  drink("classic-matcha", 20, -0.15, 240, [{ ingredientId: "ceremonial-matcha", amount: 4 }]),
  drink("banana-pudding", 14, 0, 190, [{ ingredientId: "culinary-matcha", amount: 4 }, { ingredientId: "banana-syrup", amount: 30 }, { ingredientId: "foam-cream", amount: 40 }]),
  drink("sha3r-matcha", 12, 0, 200, [{ ingredientId: "culinary-matcha", amount: 4 }, { ingredientId: "rose-syrup", amount: 20 }, { ingredientId: "foam-cream", amount: 40 }]),
];

const offer = (ingredientId: string, packSize: number, packLabel: string, tiers: Array<[number, number]>): SupplierOffer => ({
  ingredientId, packSize, packLabel, tiers: tiers.map(([minPacks, packPriceCents]) => ({ minPacks, packPriceCents })),
});

export const SUPPLIERS: Supplier[] = [
  {
    id: "mossy-hill", name: "Mossy Hill Tea Co.", approved: true, leadDays: 5, shippingCents: 2500, freeShippingAtCents: 40000, orderCycleDays: 10,
    blurb: "Our matcha specialist. Best prices on matcha, but it ships from far away.",
    offers: [
      offer("ceremonial-matcha", 500, "500 g bag", [[1, 15000], [4, 13800], [8, 12900]]),
      offer("culinary-matcha", 1000, "1 kg bag", [[1, 9000], [3, 8200]]),
    ],
  },
  {
    id: "little-meadow", name: "Little Meadow Dairy", approved: true, leadDays: 1, shippingCents: 1200, freeShippingAtCents: 8000, orderCycleDays: 3,
    blurb: "Local dairy. Next-day delivery on milk and cream.",
    offers: [
      offer("whole-milk", 3785, "1 gallon jug", [[1, 520], [12, 470]]),
      offer("oat-milk", 5676, "case of 6 cartons", [[1, 2400], [4, 2250]]),
      offer("foam-cream", 1893, "half-gallon", [[1, 900], [8, 820]]),
    ],
  },
  {
    id: "orchard-lane", name: "Orchard Lane Provisions", approved: true, leadDays: 2, shippingCents: 1800, freeShippingAtCents: 15000, orderCycleDays: 5,
    blurb: "Syrups and purées, plus a few backup basics at a higher price.",
    offers: [
      offer("fig-syrup", 750, "750 ml bottle", [[1, 1400], [6, 1250]]),
      offer("strawberry-puree", 1000, "1 L pouch", [[1, 1200], [6, 1080]]),
      offer("mango-puree", 1000, "1 L pouch", [[1, 1300], [6, 1170]]),
      offer("banana-syrup", 750, "750 ml bottle", [[1, 1300], [6, 1160]]),
      offer("rose-syrup", 750, "750 ml bottle", [[1, 1600], [6, 1440]]),
      offer("culinary-matcha", 1000, "1 kg bag", [[1, 9800]]),
      offer("oat-milk", 5676, "case of 6 cartons", [[1, 2300], [4, 2150]]),
      offer("cold-cups", 50, "sleeve of 50", [[1, 1150]]),
      offer("lids", 100, "sleeve of 100", [[1, 1450]]),
    ],
  },
  {
    id: "paper-crane", name: "Paper Crane Packaging", approved: true, leadDays: 4, shippingCents: 2000, freeShippingAtCents: 12000, orderCycleDays: 10,
    blurb: "Cups, lids, and straws in bulk.",
    offers: [
      offer("cold-cups", 50, "sleeve of 50", [[1, 900], [10, 800], [20, 700]]),
      offer("hot-cups", 50, "sleeve of 50", [[1, 1000], [10, 880]]),
      offer("lids", 100, "sleeve of 100", [[1, 1200], [6, 1050]]),
      offer("straws", 250, "box of 250", [[1, 1500], [4, 1300]]),
    ],
  },
  {
    id: "bargain-leaf", name: "Bargain Leaf Imports", approved: false, leadDays: 7, shippingCents: 3000, freeShippingAtCents: 50000, orderCycleDays: 10,
    blurb: "Very cheap matcha from an unvetted seller. Not on our approved list.",
    offers: [
      offer("ceremonial-matcha", 500, "500 g bag", [[1, 10500]]),
    ],
  },
];

export const SETTINGS = {
  startDate: "2026-06-01", // a Monday
  openMinute: 7 * 60,
  closeMinute: 19 * 60,
  historyDays: 7,
  usageWindowDays: 7,
  safetyDays: 2,
  /** Items within this many days of their reorder point can ship early with the same order. */
  lookaheadDays: 4,
  /** Free-shipping top-ups only use items we'd need within this many days. */
  topUpHorizonDays: 14,
  oatShare: 0.35,
  approvalThresholdCents: 30000,
  weeklyCashCapCents: 260000,
};

/** Starting shelf, written as batches: amount on hand and how many days ago it arrived. */
export const STARTING_STOCK: Record<string, Array<{ qty: number; ageDays: number }>> = {
  "ceremonial-matcha": [{ qty: 900, ageDays: 20 }, { qty: 1500, ageDays: 6 }],
  "culinary-matcha": [{ qty: 1700, ageDays: 12 }],
  "whole-milk": [{ qty: 7570, ageDays: 3 }, { qty: 15140, ageDays: 1 }],
  "oat-milk": [{ qty: 11352, ageDays: 9 }, { qty: 11352, ageDays: 2 }],
  "foam-cream": [{ qty: 5679, ageDays: 6 }, { qty: 5679, ageDays: 2 }],
  "fig-syrup": [{ qty: 3000, ageDays: 10 }],
  "strawberry-puree": [{ qty: 1000, ageDays: 4 }, { qty: 2000, ageDays: 1 }],
  "mango-puree": [{ qty: 2000, ageDays: 2 }],
  "banana-syrup": [{ qty: 2250, ageDays: 8 }],
  "rose-syrup": [{ qty: 2250, ageDays: 15 }],
  "cold-cups": [{ qty: 450, ageDays: 20 }],
  "hot-cups": [{ qty: 700, ageDays: 20 }],
  "lids": [{ qty: 1000, ageDays: 20 }],
  "straws": [{ qty: 500, ageDays: 20 }],
};

export const ingredientById = new Map(INGREDIENTS.map((item) => [item.id, item]));
export const drinkById = new Map(DRINKS.map((item) => [item.id, item]));
export const supplierById = new Map(SUPPLIERS.map((item) => [item.id, item]));

export function getIngredient(id: string): Ingredient {
  const item = ingredientById.get(id);
  if (!item) throw new Error(`Unknown ingredient ${id}`);
  return item;
}

export function getSupplier(id: string): Supplier {
  const supplier = supplierById.get(id);
  if (!supplier) throw new Error(`Unknown supplier ${id}`);
  return supplier;
}

export function offerFor(supplier: Supplier, ingredientId: string): SupplierOffer | undefined {
  return supplier.offers.find((candidate) => candidate.ingredientId === ingredientId);
}
