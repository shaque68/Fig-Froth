// Promotion pricing, shared by the storefront, the checkout server, and Behind the Counter so a
// customer, Square, and the owner's books all see the same price. Money is in integer cents.

export type PromotionKind = "discount" | "bundle";

/** What the storefront shows and the server charges. Published by the owner from Behind the Counter. */
export type StorePromotion = {
  id: string;
  kind: PromotionKind;
  /** One drink for a discount; two different drinks for a bundle. */
  productIds: string[];
  /** Discount: off that drink. Bundle: off the pair, on top of any discount. */
  percentOff: number;
  headline: string;
  detail: string;
};

export type PromotionRule = Pick<StorePromotion, "id" | "kind" | "productIds" | "percentOff">;

export const MAX_DISCOUNT_PERCENT = 40;
export const MAX_BUNDLE_PERCENT = 20;

export type CartLineInput = {
  productId: string;
  quantity: number;
  /** The drink's regular price. */
  unitCents: number;
  /** Paid add-ons such as oat milk. Never discounted. */
  extrasCents?: number;
};

export type PricedLine = CartLineInput & { saleUnitCents: number; promotionId?: string; lineCents: number };
export type BundleSaving = { promotionId: string; productIds: string[]; count: number; discountCents: number };
export type PricedCart = {
  lines: PricedLine[];
  bundles: BundleSaving[];
  /** Everything taken off the regular prices: sale prices plus bundles. */
  savingsCents: number;
  subtotalCents: number;
};

const percentOf = (cents: number, percent: number) => Math.round((cents * percent) / 100);

/** A drink's price after a live discount on it (the deepest one, if there are several). */
export function saleUnitCents(productId: string, unitCents: number, promotions: PromotionRule[]): { cents: number; promotionId?: string } {
  const discount = promotions
    .filter((promo) => promo.kind === "discount" && promo.productIds[0] === productId)
    .sort((a, b) => b.percentOff - a.percentOff)[0];
  return discount ? { cents: unitCents - percentOf(unitCents, discount.percentOff), promotionId: discount.id } : { cents: unitCents };
}

/**
 * Prices a cart. Sale prices apply to every unit of a discounted drink. Each bundle then takes
 * its percent off one of each of its two drinks (at their sale prices), as many times as the cart
 * holds both; a drink counts toward one bundle at most. Add-ons are never discounted.
 */
export function priceCart(lines: CartLineInput[], promotions: PromotionRule[]): PricedCart {
  const priced: PricedLine[] = lines.map((line) => {
    const sale = saleUnitCents(line.productId, line.unitCents, promotions);
    return { ...line, saleUnitCents: sale.cents, promotionId: sale.promotionId, lineCents: (sale.cents + (line.extrasCents ?? 0)) * line.quantity };
  });
  const remaining = new Map<string, number>();
  const salePrice = new Map<string, number>();
  for (const line of priced) {
    remaining.set(line.productId, (remaining.get(line.productId) ?? 0) + line.quantity);
    salePrice.set(line.productId, Math.min(salePrice.get(line.productId) ?? Number.POSITIVE_INFINITY, line.saleUnitCents));
  }
  const bundles: BundleSaving[] = [];
  for (const promo of promotions) {
    if (promo.kind !== "bundle" || promo.productIds.length !== 2) continue;
    const [first, second] = promo.productIds;
    if (first === second) continue;
    const count = Math.min(remaining.get(first) ?? 0, remaining.get(second) ?? 0);
    if (count <= 0) continue;
    remaining.set(first, remaining.get(first)! - count);
    remaining.set(second, remaining.get(second)! - count);
    const each = percentOf(salePrice.get(first)! + salePrice.get(second)!, promo.percentOff);
    bundles.push({ promotionId: promo.id, productIds: [first, second], count, discountCents: each * count });
  }
  const regularCents = lines.reduce((sum, line) => sum + (line.unitCents + (line.extrasCents ?? 0)) * line.quantity, 0);
  const bundleCents = bundles.reduce((sum, bundle) => sum + bundle.discountCents, 0);
  const subtotalCents = priced.reduce((sum, line) => sum + line.lineCents, 0) - bundleCents;
  return { lines: priced, bundles, savingsCents: regularCents - subtotalCents, subtotalCents };
}

/** Price of one of each bundle drink after the bundle discount (given their current sale prices). */
export function bundlePriceCents(firstCents: number, secondCents: number, percentOff: number): number {
  const pair = firstCents + secondCents;
  return pair - percentOf(pair, percentOff);
}
