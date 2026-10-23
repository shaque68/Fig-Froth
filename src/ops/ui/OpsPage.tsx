import { useCallback, useEffect, useMemo, useState } from "react";
import { BellRing, CloudSun, Pause, Play, RotateCcw, SkipForward, Sun, Thermometer, X } from "lucide-react";
import { formatCents, formatDollars } from "../engine/money";
import { formatClock, formatDay } from "../engine/orders";
import { formatDaysLeft, needsAttention, statusLabel, summarizePantry } from "../engine/pantry";
import { approvePo, rejectPo } from "../engine/purchasing";
import { SETTINGS } from "../engine/data";
import { createScenarioWorld, getScenario, SCENARIOS } from "../engine/scenarios";
import { runToDay, stepHour, stepNextOrder } from "../engine/shop";
import type { PurchaseOrder, World } from "../engine/sim";
import { AgentTrace } from "./AgentPanel";
import { AuditLog } from "./AuditLog";
import { ComparePanel } from "./ComparePanel";
import { OrdersFeed } from "./OrdersFeed";
import { Pantry, TinDetail, type Drain } from "./Pantry";
import { PoCard } from "./PoCard";
import "../ops.css";

const DEFAULT_SEED = 2026;
type Speed = "slow" | "fast" | "instant";
type Tab = "today" | "orders" | "log" | "compare";
const SPEED_MS: Record<Exclude<Speed, "instant">, number> = { slow: 650, fast: 140 };
const SPEED_LABEL: Record<Speed, string> = { slow: "Slow", fast: "Fast", instant: "Instant" };
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "today", label: "The shop today" },
  { id: "orders", label: "Purchase orders" },
  { id: "log", label: "Audit log" },
  { id: "compare", label: "Simple vs smarter" },
];

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

function WeatherIcon({ tempF }: { tempF: number }) {
  if (tempF >= 90) return <Thermometer size={18} aria-hidden="true" />;
  if (tempF >= 80) return <Sun size={18} aria-hidden="true" />;
  return <CloudSun size={18} aria-hidden="true" />;
}

const awaitingIds = (world: World) => world.purchaseOrders.filter((po) => po.status === "awaiting").map((po) => po.id);

function PoGroup({ title, pos, today, onApprove, onReject, empty }: { title: string; pos: PurchaseOrder[]; today: number; onApprove?: (id: string) => void; onReject?: (id: string) => void; empty?: string }) {
  if (pos.length === 0 && !empty) return null;
  return (
    <section className="po-group">
      <h3 className="po-group-title">{title} <span>{pos.length}</span></h3>
      {pos.length === 0 ? <p className="ops-muted">{empty}</p> : <div className="po-grid">{pos.map((po) => <PoCard key={po.id} po={po} today={today} onApprove={onApprove} onReject={onReject} />)}</div>}
    </section>
  );
}

export default function OpsPage() {
  const [seed, setSeed] = useState(DEFAULT_SEED);
  const [seedDraft, setSeedDraft] = useState(String(DEFAULT_SEED));
  const [scenarioId, setScenarioId] = useState("normal");
  const [world, setWorld] = useState<World>(() => createScenarioWorld(DEFAULT_SEED, "normal"));
  const [speed, setSpeed] = useState<Speed>("fast");
  const [run, setRun] = useState<{ untilDay: number; known: string[] } | null>(null);
  const [drain, setDrain] = useState<Drain | null>(null);
  const [openTin, setOpenTin] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("today");
  const [notice, setNotice] = useState<string | null>(null);
  const reducedMotion = usePrefersReducedMotion();

  const tins = useMemo(() => summarizePantry(world), [world]);
  const attention = useMemo(() => needsAttention(tins), [tins]);
  const awaiting = world.purchaseOrders.filter((po) => po.status === "awaiting");
  const matcha = tins.find((tin) => tin.ingredient.id === "ceremonial-matcha");
  const lastRun = world.agentRuns.at(-1);
  const running = run !== null;

  const update = useCallback((step: (next: World) => void) => {
    setWorld((current) => {
      const next = structuredClone(current);
      step(next);
      return next;
    });
  }, []);

  // Timed runs advance one simulated hour per tick so the tins visibly drain through the day.
  // A run pauses as soon as the agent asks for approval: a person stays in charge.
  useEffect(() => {
    if (!run) return;
    const fresh = awaitingIds(world).filter((id) => !run.known.includes(id));
    if (fresh.length > 0) {
      setRun(null);
      setNotice(`Paused: ${fresh.join(" and ")} ${fresh.length === 1 ? "needs" : "need"} your approval.`);
      return;
    }
    if (world.day >= run.untilDay) {
      setRun(null);
      return;
    }
    const timer = window.setTimeout(() => update((next) => { stepHour(next); }), SPEED_MS[speed === "instant" ? "fast" : speed]);
    return () => window.clearTimeout(timer);
  }, [run, world, speed, update]);

  function serveNext() {
    const next = structuredClone(world);
    const known = awaitingIds(world);
    const served = stepNextOrder(next);
    setWorld(next);
    setDrain({ key: Date.now(), usage: served.usage });
    const fresh = awaitingIds(next).filter((id) => !known.includes(id));
    setNotice(fresh.length > 0 ? `The shop closed for the night. ${fresh.join(" and ")} ${fresh.length === 1 ? "needs" : "need"} your approval.` : null);
  }

  function runDays(days: number) {
    setDrain(null);
    setNotice(null);
    const untilDay = world.day + days;
    const known = awaitingIds(world);
    if (speed !== "instant") {
      setRun({ untilDay, known });
      return;
    }
    const next = structuredClone(world);
    runToDay(next, untilDay, (current) => awaitingIds(current).some((id) => !known.includes(id)));
    setWorld(next);
    const fresh = awaitingIds(next).filter((id) => !known.includes(id));
    if (fresh.length > 0) setNotice(`Paused: ${fresh.join(" and ")} ${fresh.length === 1 ? "needs" : "need"} your approval.`);
  }

  function reset(nextSeed = seed, nextScenario = scenarioId) {
    setRun(null);
    setDrain(null);
    setOpenTin(null);
    setNotice(null);
    setWorld(createScenarioWorld(nextSeed, nextScenario));
  }

  function applySeed(event: React.FormEvent) {
    event.preventDefault();
    const parsed = Number.parseInt(seedDraft, 10);
    const nextSeed = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SEED;
    setSeed(nextSeed);
    setSeedDraft(String(nextSeed));
    reset(nextSeed);
  }

  function chooseScenario(id: string) {
    setScenarioId(id);
    reset(seed, id);
  }

  const approve = (id: string) => { update((next) => { approvePo(next, id); }); setNotice(null); };
  const reject = (id: string) => { update((next) => { rejectPo(next, id); }); setNotice(null); };

  // Clear the drain highlight once the signature animation has played.
  useEffect(() => {
    if (!drain) return;
    const timer = window.setTimeout(() => setDrain(null), reducedMotion ? 1600 : 2200);
    return () => window.clearTimeout(timer);
  }, [drain, reducedMotion]);

  const selectedTin = openTin ? tins.find((tin) => tin.ingredient.id === openTin) : undefined;
  const today = world.today;
  const scenario = getScenario(scenarioId);
  const byNewest = [...world.purchaseOrders].reverse();
  const recentPos = byNewest.filter((po) => po.status !== "awaiting").slice(0, 3);

  return (
    <div className={`ops-page ${reducedMotion ? "reduce-motion" : ""}`}>
      <header className="ops-hero">
        <div>
          <p className="ops-eyebrow"><span className="ops-eyebrow-line" /> Behind the counter · a demo with made-up data</p>
          <h1>How the shelves <em>stay stocked.</em></h1>
          <p className="ops-lede">Every drink uses a little matcha, milk, and a cup. Watch orders drain the shelf, then see how a restock agent keeps it full without wasting money.</p>
        </div>
        <div className="ops-hero-stat" aria-live="polite">
          <span>Days of matcha left</span>
          <strong>{matcha ? formatDaysLeft(matcha.daysLeft) : "—"}</strong>
          <small>{matcha ? statusLabel(matcha) : ""}</small>
        </div>
      </header>

      <div className="ops-controls" role="region" aria-label="Demo controls">
        <div className="ops-clock">
          <strong>{formatDay(world.day, "long")}</strong>
          <span>{world.queue.length === 0 ? "Closed for the night" : formatClock(world.minute)}</span>
          <span className="ops-weather"><WeatherIcon tempF={world.conditions.tempF} /> {world.conditions.tempF}°F</span>
        </div>
        <div className="ops-buttons">
          <button className="ops-button ops-button-primary" onClick={serveNext} disabled={running}><SkipForward size={17} /> Next order</button>
          <button className="ops-button" onClick={() => runDays(1)} disabled={running}><Play size={17} /> Run one day</button>
          <button className="ops-button" onClick={() => runDays(7)} disabled={running}><Play size={17} /> Run one week</button>
          {running && <button className="ops-button" onClick={() => setRun(null)}><Pause size={17} /> Pause</button>}
          <div className="ops-speed" role="radiogroup" aria-label="Speed">
            {(Object.keys(SPEED_LABEL) as Speed[]).map((option) => (
              <button key={option} role="radio" aria-checked={speed === option} className={speed === option ? "is-selected" : ""} onClick={() => setSpeed(option)}>{SPEED_LABEL[option]}</button>
            ))}
          </div>
        </div>
        <div className="ops-setup">
          <label className="ops-scenario">Scenario
            <select value={scenarioId} onChange={(event) => chooseScenario(event.target.value)} disabled={running}>
              {SCENARIOS.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
            </select>
          </label>
          <form className="ops-reset" onSubmit={applySeed}>
            <label>Seed <input value={seedDraft} onChange={(event) => setSeedDraft(event.target.value)} inputMode="numeric" aria-label="Random seed" /></label>
            <button className="ops-button" type="submit"><RotateCcw size={16} /> Reset demo</button>
          </form>
        </div>
      </div>

      {scenarioId !== "normal" && <p className="scenario-banner" role="status"><strong>{scenario.name}.</strong> {scenario.banner}</p>}
      {notice && <div className="ops-notice" role="status"><BellRing size={18} /><span>{notice}</span><button onClick={() => setNotice(null)} aria-label="Dismiss"><X size={16} /></button></div>}

      <nav className="ops-tabs" aria-label="Demo sections">
        {TABS.map((option) => (
          <button key={option.id} className={tab === option.id ? "is-selected" : ""} aria-current={tab === option.id ? "page" : undefined} onClick={() => setTab(option.id)}>
            {option.label}
            {option.id === "orders" && awaiting.length > 0 && <span className="tab-badge">{awaiting.length}</span>}
          </button>
        ))}
      </nav>

      {tab === "today" && <>
        {awaiting.length > 0 && (
          <section className="ops-panel approvals-panel" aria-labelledby="approvals-title">
            <div className="ops-panel-head"><div><p className="ops-eyebrow">Over the {formatDollars(SETTINGS.approvalThresholdCents)} limit, so a person decides</p><h2 id="approvals-title">Waiting for <em>you.</em></h2></div></div>
            <div className="approvals-layout">
              <div className="po-grid">{awaiting.map((po) => <PoCard key={po.id} po={po} today={world.day} onApprove={approve} onReject={reject} defaultOpen />)}</div>
              <aside className="approval-help">
                <h3>What happens next</h3>
                <p><strong>Approve order:</strong> it’s sent to the supplier (simulated) and arrives after their delivery time. The tins refill when it does.</p>
                <p><strong>Reject:</strong> nothing is sent. The agent looks again tonight.</p>
                <p className="ops-muted">Orders at or under {formatDollars(SETTINGS.approvalThresholdCents)} go out on their own and are logged.</p>
              </aside>
            </div>
          </section>
        )}

        <div className="ops-today-strip" aria-live="polite">
          <span><strong>{today.orders}</strong> orders today</span>
          <span><strong>{today.drinksMade}</strong> drinks made</span>
          <span className={today.drinksMissed > 0 ? "strip-warn" : ""}><strong>{today.drinksMissed}</strong> couldn’t make</span>
          <span><strong>{formatCents(today.revenueCents)}</strong> in sales</span>
          <span className="ops-sim-tag">Simulated</span>
        </div>

        <div className="ops-layout">
          <section className="ops-panel ops-panel-pantry" aria-labelledby="pantry-title">
            <div className="ops-panel-head">
              <div><p className="ops-eyebrow">What’s on the shelf right now</p><h2 id="pantry-title">The <em>pantry.</em></h2></div>
              <p className="ops-panel-note">Tap a tin for its batches and reorder point.</p>
            </div>
            <Pantry tins={tins} world={world} drain={drain} onOpen={setOpenTin} />
          </section>

          <aside className="ops-side">
            <section className="ops-panel" aria-labelledby="attention-title">
              <h2 id="attention-title" className="ops-side-title">Needs attention</h2>
              {attention.length === 0 ? <p className="ops-muted">Everything is comfortably stocked.</p> : (
                <ul className="attention-list">
                  {attention.slice(0, 5).map((tin) => (
                    <li key={tin.ingredient.id} className={`attention-item status-${tin.status}`}>
                      <button onClick={() => setOpenTin(tin.ingredient.id)}>
                        <span className="attention-name">{tin.ingredient.name}</span>
                        <span className="attention-days">{formatDaysLeft(tin.daysLeft)}{Number.isFinite(tin.daysLeft) && tin.daysLeft >= 1 ? " left" : ""}</span>
                        <span className="attention-status">{statusLabel(tin)}{tin.openOrders[0] ? ` · ${tin.openOrders[0].id}` : ""}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="ops-panel" aria-labelledby="orders-title">
              <h2 id="orders-title" className="ops-side-title">Live orders</h2>
              <OrdersFeed recent={world.recent} latestKey={drain ? world.recent[0]?.order.id ?? null : null} />
            </section>
          </aside>
        </div>

        <section className="ops-panel agent-panel" aria-labelledby="agent-title">
          <div className="ops-panel-head">
            <div><p className="ops-eyebrow">Runs every night at closing</p><h2 id="agent-title">The restock <em>agent.</em></h2></div>
            {world.purchaseOrders.length > 0 && <button className="text-link" onClick={() => setTab("orders")}>See all {world.purchaseOrders.length} purchase orders →</button>}
          </div>
          <AgentTrace run={lastRun} />
          {recentPos.length > 0 && <>
            <h3 className="po-group-title">Most recent orders</h3>
            <div className="po-grid agent-latest">{recentPos.map((po) => <PoCard key={po.id} po={po} today={world.day} />)}</div>
          </>}
        </section>
      </>}

      {tab === "orders" && (
        <section className="ops-panel" aria-labelledby="po-title">
          <div className="ops-panel-head"><div><p className="ops-eyebrow">Drafted by the agent · nothing is really sent</p><h2 id="po-title">Purchase <em>orders.</em></h2></div></div>
          {world.purchaseOrders.length === 0 && <p className="ops-muted">No purchase orders yet. Run a day and the agent will draft its first ones at closing.</p>}
          <PoGroup title="Waiting for your approval" pos={awaiting} today={world.day} onApprove={approve} onReject={reject} />
          <PoGroup title="On the way" pos={byNewest.filter((po) => po.status === "sent" || po.status === "approved")} today={world.day} />
          <PoGroup title="Arrived" pos={byNewest.filter((po) => ["received", "invoiced", "matched", "flagged"].includes(po.status))} today={world.day} />
          <PoGroup title="Not sent" pos={byNewest.filter((po) => po.status === "rejected")} today={world.day} />
        </section>
      )}

      {tab === "log" && (
        <section className="ops-panel" aria-labelledby="log-title">
          <div className="ops-panel-head"><div><p className="ops-eyebrow">Every decision and action, with its reason</p><h2 id="log-title">Audit <em>log.</em></h2></div></div>
          <AuditLog log={world.log} />
        </section>
      )}

      {tab === "compare" && (
        <section className="ops-panel" aria-labelledby="compare-title">
          <div className="ops-panel-head"><div><p className="ops-eyebrow">Same month, two ways to order</p><h2 id="compare-title">Simple vs <em>smarter.</em></h2></div></div>
          <ComparePanel seed={seed} scenarioId={scenarioId} />
        </section>
      )}

      {selectedTin && <TinDetail tin={selectedTin} world={world} onClose={() => setOpenTin(null)} />}
    </div>
  );
}
