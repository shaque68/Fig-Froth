import { Sparkles } from "lucide-react";
import { drinkById, getIngredient } from "../engine/data";
import { freshnessOutlook, type SpecialSuggestion } from "../engine/freshness";
import { formatQty } from "../engine/inventory";
import { formatCents } from "../engine/money";
import { formatDay } from "../engine/orders";
import type { World } from "../engine/sim";

const HORIZON = 21;

export function SpecialCard({ suggestion, world, onStart }: { suggestion: SpecialSuggestion | null | undefined; world: World; onStart: () => void }) {
  if (world.specialFor) {
    const drink = world.specialFor.drinkId;
    return (
      <div className="special-card is-running">
        <Sparkles size={20} aria-hidden="true" />
        <div><strong>Special running:</strong> {drinkName(drink)} is the matcha of the day through {formatDay(world.specialFor.untilDay)}.</div>
      </div>
    );
  }
  if (!suggestion) return null;
  return (
    <div className="special-card">
      <Sparkles size={20} aria-hidden="true" />
      <div>
        <p className="ops-eyebrow">The agent suggests a “use it up” special</p>
        <p>{suggestion.text}</p>
        <button className="ops-button ops-button-primary" onClick={onStart}>Run the {drinkName(suggestion.drinkId)} special</button>
      </div>
    </div>
  );
}

const drinkName = (id: string) => drinkById.get(id)?.name ?? id;

export function FreshnessPanel({ world, onStart }: { world: World; onStart: () => void }) {
  const outlook = freshnessOutlook(world).filter((item) => item.batch.expiresDay !== null && item.batch.expiresDay - world.day <= HORIZON);
  const atRisk = outlook.filter((item) => item.leftover >= 1);
  const worst = [...atRisk].sort((a, b) => b.leftoverCents - a.leftoverCents)[0];
  const takeaway = atRisk.length === 0
    ? `Every perishable batch on the shelf should be used up before it expires.`
    : `${atRisk.length === 1 ? "1 batch is" : `${atRisk.length} batches are`} likely to expire before we use ${atRisk.length === 1 ? "it" : "them"}; the biggest is about ${formatQty(worst.ingredientId, Math.round(worst.leftover))} of ${getIngredient(worst.ingredientId).name.toLowerCase()} (${formatCents(worst.leftoverCents)}) on ${formatDay(worst.batch.expiresDay!)}.`;
  return (
    <div className="freshness">
      <p className="compare-takeaway">{takeaway}</p>
      <p className="ops-muted compare-sub">Perishable batches expiring in the next {HORIZON} days, soonest first. Simulated, at today’s pace of use (oldest batch used first).</p>
      <SpecialCard suggestion={world.specialSuggestion} world={world} onStart={onStart} />
      {outlook.length === 0 ? <p className="ops-muted">Nothing expires in the next {HORIZON} days.</p> : (
        <figure className="fresh-chart">
          <div className="fresh-axis" aria-hidden="true">
            <span>Today</span><span>+1 week</span><span>+2 weeks</span><span>+3 weeks</span>
          </div>
          <ul className="fresh-rows">
            {outlook.map((item) => {
              const daysOut = Math.max(0, item.batch.expiresDay! - world.day);
              const risky = item.leftover >= 1;
              return (
                <li key={item.batch.id} className={`fresh-row ${risky ? "is-risky" : ""}`}>
                  <span className="fresh-name">{getIngredient(item.ingredientId).name}<small>{formatQty(item.ingredientId, item.batch.qty)} on the shelf</small></span>
                  <span className="fresh-track">
                    <span className="fresh-bar" style={{ width: `${Math.max(2, (Math.max(0.5, daysOut) / HORIZON) * 100)}%` }} />
                  </span>
                  <span className="fresh-label">
                    {daysOut === 0 ? "Expires tonight" : `Use by ${formatDay(item.batch.expiresDay!)}`}
                    <small>{risky ? `At risk: about ${formatQty(item.ingredientId, Math.round(item.leftover))} (${formatCents(item.leftoverCents)})` : "Will be used in time"}</small>
                  </span>
                </li>
              );
            })}
          </ul>
        </figure>
      )}
    </div>
  );
}
