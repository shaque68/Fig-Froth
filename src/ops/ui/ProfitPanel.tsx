import { useMemo, useState } from "react";
import { SUPPLIERS } from "../engine/data";
import { formatCents } from "../engine/money";
import { drinkProfits, marginLosers, TARGET_MARGIN } from "../engine/profit";
import type { World } from "../engine/sim";

const pct = (value: number) => `${Math.round(value * 100)}%`;
const list = (names: string[]) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

export function ProfitPanel({ world }: { world: World }) {
  const [supplierId, setSupplierId] = useState("ippodo");
  const [percent, setPercent] = useState(0);
  const base = useMemo(() => drinkProfits(world), [world]);
  const after = useMemo(() => drinkProfits(world, percent > 0 ? { supplierId, percent } : null), [world, supplierId, percent]);
  const losers = marginLosers(base, after);
  const supplier = SUPPLIERS.find((candidate) => candidate.id === supplierId)!;
  const below = after.filter((profit) => profit.margin < TARGET_MARGIN);
  const takeaway = percent === 0
    ? `At today’s supplier prices, ${below.length === 0 ? `every drink clears a ${pct(TARGET_MARGIN)} margin` : `${below.length} ${below.length === 1 ? "drink is" : "drinks are"} below a ${pct(TARGET_MARGIN)} margin`}; the slimmest is ${[...after].sort((a, b) => a.margin - b.margin)[0].drink.name} at ${pct([...after].sort((a, b) => a.margin - b.margin)[0].margin)}.`
    : losers.length > 0
      ? `If ${supplier.name} raised prices ${percent}%, ${list(losers.map((profit) => profit.drink.name))} would fall below a ${pct(TARGET_MARGIN)} margin.`
      : `Even if ${supplier.name} raised prices ${percent}%, no drink would newly fall below a ${pct(TARGET_MARGIN)} margin.`;
  return (
    <div className="profit">
      <p className="compare-takeaway">{takeaway}</p>
      <p className="ops-muted compare-sub">Cost per 16 oz iced drink with whole milk, using the cheapest approved supplier for each ingredient, plus the cup, lid, and straw.</p>
      <div className="whatif">
        <label>What if <select value={supplierId} onChange={(event) => setSupplierId(event.target.value)}>
          {SUPPLIERS.filter((candidate) => candidate.approved).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
        </select> raised prices by</label>
        <input type="range" min={0} max={60} step={5} value={percent} onChange={(event) => setPercent(Number(event.target.value))} aria-label="Price increase percent" />
        <output>{percent}%</output>
      </div>
      <table className="ops-table profit-table">
        <thead><tr><th scope="col">Drink</th><th scope="col" className="num">Price</th><th scope="col" className="num">Cost to make</th><th scope="col" className="num">Profit</th><th scope="col">Margin</th></tr></thead>
        <tbody>
          {after.map((profit, index) => {
            const isBelow = profit.margin < TARGET_MARGIN;
            const changed = profit.costCents !== base[index].costCents;
            return (
              <tr key={profit.drink.id} className={isBelow ? "is-below" : ""}>
                <th scope="row">{profit.drink.name}</th>
                <td className="num">{formatCents(profit.priceCents)}</td>
                <td className="num">{formatCents(profit.costCents)}{changed && <small> (was {formatCents(base[index].costCents)})</small>}</td>
                <td className="num">{formatCents(profit.marginCents)}</td>
                <td>
                  <span className="margin-cell">
                    <span className="margin-track"><span className="margin-bar" style={{ width: `${Math.max(0, profit.margin) * 100}%` }} /><span className="margin-target" style={{ left: `${TARGET_MARGIN * 100}%` }} /></span>
                    <span className="margin-value">{pct(profit.margin)}{isBelow && <strong> below target</strong>}</span>
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="ops-fineprint">The thin line on each bar marks the {pct(TARGET_MARGIN)} target margin. Toppings and labor aren’t included.</p>
    </div>
  );
}
