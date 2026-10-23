import { useMemo, useState } from "react";
import { runComparison, type PolicyResult } from "../engine/compare";
import { formatCents, formatDollars } from "../engine/money";
import { getScenario } from "../engine/scenarios";

// Validated with the dataviz palette checker against the panel surface (#fbfaf6).
const SEGMENTS = [
  { key: "used", label: "Supplies we used or still have", color: "#3d6b2f", value: (r: PolicyResult) => r.goodsCents - r.wasteCents },
  { key: "shipping", label: "Shipping fees", color: "#dcaa3c", value: (r: PolicyResult) => r.shippingCents },
  { key: "waste", label: "Thrown out (expired)", color: "#8b4f86", value: (r: PolicyResult) => r.wasteCents },
] as const;

function CostChart({ rows }: { rows: PolicyResult[] }) {
  const [hover, setHover] = useState<{ row: string; segment: string } | null>(null);
  const max = Math.max(...rows.map((row) => row.spendCents));
  return (
    <figure className="cost-chart">
      <ul className="chart-legend" aria-label="Legend">
        {SEGMENTS.map((segment) => <li key={segment.key}><span className="legend-swatch" style={{ background: segment.color }} />{segment.label}</li>)}
      </ul>
      <div className="chart-rows">
        {rows.map((row) => (
          <div key={row.policy} className="chart-row">
            <span className="chart-row-label">{row.label}</span>
            <div className="chart-track">
              <div className="chart-bar" style={{ width: `${(row.spendCents / max) * 100}%` }}>
                {SEGMENTS.map((segment) => {
                  const value = segment.value(row);
                  if (value <= 0) return null;
                  const active = hover?.row === row.policy && hover.segment === segment.key;
                  return (
                    <span
                      key={segment.key}
                      className={`chart-seg ${active ? "is-active" : ""}`}
                      style={{ flexGrow: value, background: segment.color }}
                      tabIndex={0}
                      aria-label={`${row.label}, ${segment.label}: ${formatCents(value)}`}
                      onMouseEnter={() => setHover({ row: row.policy, segment: segment.key })}
                      onMouseLeave={() => setHover(null)}
                      onFocus={() => setHover({ row: row.policy, segment: segment.key })}
                      onBlur={() => setHover(null)}
                    >
                      {active && <span className="chart-tip" role="tooltip"><strong>{formatCents(value)}</strong>{segment.label}<br />{row.label}</span>}
                    </span>
                  );
                })}
              </div>
              <span className="chart-total">{formatDollars(row.spendCents)}</span>
            </div>
          </div>
        ))}
      </div>
    </figure>
  );
}

export function ComparePanel({ seed, scenarioId }: { seed: number; scenarioId: string }) {
  const result = useMemo(() => runComparison(seed, scenarioId), [seed, scenarioId]);
  const { simple, smart } = result;
  const rows: Array<{ label: string; simple: string; smart: string; better: boolean | null }> = [
    { label: "Total spend", simple: formatCents(simple.spendCents), smart: formatCents(smart.spendCents), better: smart.spendCents < simple.spendCents },
    { label: "Shipping fees", simple: formatCents(simple.shippingCents), smart: formatCents(smart.shippingCents), better: smart.shippingCents < simple.shippingCents },
    { label: "Stock thrown out (expired)", simple: formatCents(simple.wasteCents), smart: formatCents(smart.wasteCents), better: smart.wasteCents < simple.wasteCents },
    { label: "Drinks we couldn’t make", simple: String(simple.drinksMissed), smart: String(smart.drinksMissed), better: smart.drinksMissed === simple.drinksMissed ? null : smart.drinksMissed < simple.drinksMissed },
    { label: "Cash tied up in stock (average day)", simple: formatDollars(simple.avgInventoryCents), smart: formatDollars(smart.avgInventoryCents), better: Math.abs(smart.avgInventoryCents - simple.avgInventoryCents) < 2500 ? null : smart.avgInventoryCents < simple.avgInventoryCents },
    { label: "Purchase orders placed", simple: String(simple.orders), smart: String(smart.orders), better: null },
  ];
  return (
    <div className="compare">
      <p className="compare-takeaway">{result.takeaway}</p>
      <p className="ops-muted compare-sub">Simulated over {result.days} days · seed {seed} · {getScenario(scenarioId).name}. Same customers, same weather; only the ordering rules change. Orders that need approval are approved the same day.</p>
      <CostChart rows={[simple, smart]} />
      <table className="ops-table compare-table">
        <caption className="sr-only">Simple vs smarter ordering, simulated over {result.days} days</caption>
        <thead><tr><th scope="col">Over {result.days} days</th><th scope="col" className="num">Simple ordering</th><th scope="col" className="num">Smarter ordering</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              <td className="num">{row.simple}</td>
              <td className={`num ${row.better === true ? "is-better" : row.better === false ? "is-worse" : ""}`}>{row.smart}{row.better === true && <span className="sr-only"> (better)</span>}{row.better === false && <span className="sr-only"> (worse)</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="ops-fineprint">{result.stockNote} Simple ordering buys each item on its own, at the base price, with full shipping, and has no weekly cash cap.</p>
    </div>
  );
}
