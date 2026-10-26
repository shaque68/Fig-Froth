// Seeded randomness. Every random stream is derived from the demo seed plus a label
// (for example the day number), so the same seed and scenario always replay identically
// and the customer order stream never depends on ordering decisions.

export type Rng = {
  next(): number;
  int(min: number, max: number): number;
  chance(probability: number): boolean;
  weighted<T>(items: readonly T[], weight: (item: T) => number): T;
};

/** FNV-1a hash of the parts, used to derive a stream seed. */
export function hashSeed(...parts: Array<string | number>): number {
  let hash = 0x811c9dc5;
  for (const char of parts.join("|")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32: small, fast, and good enough for a demo. */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (probability) => next() < probability,
    weighted(items, weight) {
      const total = items.reduce((sum, item) => sum + weight(item), 0);
      let roll = next() * total;
      for (const item of items) {
        roll -= weight(item);
        if (roll < 0) return item;
      }
      return items[items.length - 1];
    },
  };
}

export function streamFor(seed: number, ...label: Array<string | number>): Rng {
  return createRng(hashSeed(seed, ...label));
}
