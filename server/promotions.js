// Promotions the owner publishes from Behind the Counter. The storefront shows them and checkout
// charges them. Kept in memory; in production they'd be stored with the menu.
import { z } from "zod";
import { MAX_BUNDLE_PERCENT, MAX_DISCOUNT_PERCENT } from "../src/pricing.ts";

const MAX_LIVE = 6;

const promotionSchema = z.object({
  id: z.string().regex(/^PR-\d{1,6}$/),
  kind: z.enum(["discount", "bundle"]),
  productIds: z.array(z.string().min(1).max(100)).min(1).max(2),
  percentOff: z.number().int().min(5).max(Math.max(MAX_DISCOUNT_PERCENT, MAX_BUNDLE_PERCENT)),
  headline: z.string().trim().min(1).max(140),
  detail: z.string().trim().max(200),
}).strict();

/** Checks a published list against the real menu: known, orderable drinks and sensible discounts. */
export function parsePromotions(body, productsById) {
  const parsed = z.object({ promotions: z.array(promotionSchema).max(MAX_LIVE) }).strict().safeParse(body);
  if (!parsed.success) return { error: "Those promotions aren't valid." };
  const ids = new Set();
  for (const promo of parsed.data.promotions) {
    if (ids.has(promo.id)) return { error: `${promo.id} is listed twice.` };
    ids.add(promo.id);
    const products = promo.productIds.map((id) => productsById.get(id));
    if (products.some((product) => !product || !product.available)) return { error: `${promo.id} includes a drink that isn't on the menu.` };
    if (promo.kind === "discount" && (promo.productIds.length !== 1 || promo.percentOff > MAX_DISCOUNT_PERCENT)) {
      return { error: `${promo.id}: a sale is one drink, at most ${MAX_DISCOUNT_PERCENT}% off.` };
    }
    if (promo.kind === "bundle" && (promo.productIds.length !== 2 || promo.productIds[0] === promo.productIds[1] || promo.percentOff > MAX_BUNDLE_PERCENT)) {
      return { error: `${promo.id}: a bundle is two different drinks, at most ${MAX_BUNDLE_PERCENT}% off.` };
    }
  }
  return { promotions: parsed.data.promotions };
}

export function createPromotionBoard() {
  let promotions = [];
  return {
    list: () => promotions,
    replace(next) { promotions = next; },
  };
}

/** GET /api/promotions for the storefront; PUT /api/admin/promotions for the owner. */
export function registerPromotions(app, { board, productsById, guard }) {
  app.get("/api/promotions", (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ promotions: board.list() });
  });

  app.put("/api/admin/promotions", guard, (req, res) => {
    const result = parsePromotions(req.body, productsById);
    if (result.error) return res.status(400).json({ error: result.error });
    board.replace(result.promotions);
    return res.json({ promotions: result.promotions });
  });
}
