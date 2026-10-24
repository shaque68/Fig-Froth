// Storefront orders, kept in memory so Behind the Counter can show them as they come in.
// In production this would be fed by Square's order webhooks and stored in a database.

export function createOrderBook({ limit = 500 } = {}) {
  let nextId = 1;
  const orders = [];
  const byKey = new Map();

  return {
    /** Records an order once per idempotency key, so a retried checkout isn't counted twice. */
    add({ idempotencyKey, source, pickupTime, items }) {
      if (idempotencyKey && byKey.has(idempotencyKey)) return byKey.get(idempotencyKey);
      const order = { id: nextId, number: `W-${String(nextId).padStart(4, "0")}`, createdAt: new Date().toISOString(), source, pickupTime, items };
      nextId += 1;
      orders.push(order);
      if (idempotencyKey) byKey.set(idempotencyKey, order);
      if (orders.length > limit) {
        const removed = orders.shift();
        for (const [key, value] of byKey) if (value === removed) byKey.delete(key);
      }
      return order;
    },
    since(afterId) {
      return orders.filter((order) => order.id > afterId);
    },
  };
}

/** The parts of a checkout request the shop needs: product, quantity, and choices (no buyer details). */
export function orderItems(items, productsById) {
  return items.map(({ productId, quantity, selections }) => ({
    productId,
    name: productsById.get(productId)?.name ?? productId,
    quantity,
    selections: selections ?? {},
  }));
}
