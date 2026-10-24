import { useCallback, useEffect, useMemo, useState } from "react";
import { BellRing, CloudSun, Pause, Play, RotateCcw, SkipForward, SlidersHorizontal, Sun, Thermometer, X } from "lucide-react";
import { formatCents, formatDollars } from "../engine/money";
import { formatClock, formatDay } from "../engine/orders";
import { formatDaysLeft, formatStockDays, needsAttention, statusLabel, summarizePantry } from "../engine/pantry";
import { startSpecial } from "../engine/freshness";
import { resolveInvoice } from "../engine/match";
import { approvePo, rejectPo } from "../engine/purchasing";
import { SETTINGS } from "../engine/data";
import { createScenarioWorld, getScenario, SCENARIOS } from "../engine/scenarios";
import { runToDay, stepHour, stepNextOrder } from "../engine/shop";
import type { PurchaseOrder, World } from "../engine/sim";
import { AgentTrace } from "./AgentPanel";
import { AuditLog } from "./AuditLog";
import { ComparePanel } from "./ComparePanel";
import { FreshnessPanel, SpecialCard } from "./FreshnessPanel";
import { InvoicePanel } from "./InvoicePanel";
import { ProfitPanel } from "./ProfitPanel";
import { OrdersFeed } from "./OrdersFeed";
import { Pantry, TinDetail, type Drain } from "./Pantry";
import { PoCard, type WriteRequest } from "./PoCard";
import { PresenterBar, TOUR } from "./Presenter";
import { MorningBrief, WritingDialog, writeText, type Written } from "./Writing";
import "../ops.css";

const DEFAULT_SEED = 2026;
type Speed = "slow" | "fast" | "instant";
type Tab = "today" | "orders" | "log" | "compare" | "freshness" | "profit" | "invoices";
const SPEED_MS: Record<Exclude<Speed, "instant">, number> = { slow: 650, fast: 140 };
const SPEED_LABEL: Record<Speed, string> = { slow: "Slow", fast: "Fast", instant: "Instant" };
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "today", label: "Today" },
  { id: "orders", label: "Purchase orders" },
  { id: "log", label: "Activity log" },
  { id: "compare", label: "Savings" },
  { id: "freshness", label: "Freshness" },
  { id: "profit", label: "Drink margins" },
  { id: "invoices", label: "Invoices" },
];

const LARGE_TEXT_KEY = "fig-froth-ops-large-text";
const CONTROLS_KEY = "fig-froth-ops-controls";
function readFlag(key: string, fallback: boolean) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value === "1";
  } catch {
    return fallback;
  }
}
function saveFlag(key: string, value: boolean) {
  try { localStorage.setItem(key, value ? "1" : "0"); } catch { /* per-viewer preference only */ }
}

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

/** The sentences of a log entry that mention what the scenario is about (or the first one). */
function relevantSentences(detail: string, pattern: RegExp): string {
  const sentences = detail.split(/(?<=\.)\s+/);
  const matching = sentences.filter((sentence) => pattern.test(sentence));
  return (matching.length > 0 ? matching : sentences).slice(0, 2).join(" ");
}

const awaitingIds = (world: World) => world.purchaseOrders.filter((po) => po.status === "awaiting").map((po) => po.id);

function PoGroup({ title, pos, today, onApprove, onReject, onWrite, empty }: { title: string; pos: PurchaseOrder[]; today: number; onApprove?: (id: string) => void; onReject?: (id: string) => void; onWrite?: WriteRequest; empty?: string }) {
  if (pos.length === 0 && !empty) return null;
  return (
    <section className="po-group">
      <h3 className="po-group-title">{title} <span>{pos.length}</span></h3>
      {pos.length === 0 ? <p className="ops-muted">{empty}</p> : <div className="po-grid">{pos.map((po) => <PoCard key={po.id} po={po} today={today} onApprove={onApprove} onReject={onReject} onWrite={onWrite} />)}</div>}
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
  const [claudeMode, setClaudeMode] = useState(false);
  const [writing, setWriting] = useState<{ kind: "explain" | "supplier-message"; poId: string; written: Written | null } | null>(null);
  const [presenting, setPresenting] = useState(false);
  const [tourStep, setTourStep] = useState(0);
  const [largeText, setLargeTextState] = useState(() => readFlag(LARGE_TEXT_KEY, false));
  const [controlsOpen, setControlsOpenState] = useState(() => readFlag(CONTROLS_KEY, true));
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
  const runSpecial = () => update((next) => { if (next.specialSuggestion) { startSpecial(next, next.specialSuggestion); next.specialSuggestion = null; } });
  const resolve = (id: string, decision: "accept" | "dispute") => update((next) => { resolveInvoice(next, id, decision); });

  function setLargeText(value: boolean) {
    setLargeTextState(value);
    saveFlag(LARGE_TEXT_KEY, value);
  }

  function setControlsOpen(value: boolean) {
    setControlsOpenState(value);
    saveFlag(CONTROLS_KEY, value);
  }

  function startPresenting() {
    setScenarioId("normal");
    reset(seed, "normal");
    setTourStep(0);
    setPresenting(true);
  }

  // Presenter mode is kept off-screen: press P (outside a text field) to start or end it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key.toLowerCase() !== "p" || event.metaKey || event.ctrlKey || event.altKey) return;
      if (target && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
      if (presenting) setPresenting(false);
      else startPresenting();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Each tour step opens its tab and brings its part of the page into view.
  useEffect(() => {
    if (!presenting) return;
    const step = TOUR[tourStep];
    setTab(step.tab);
    const timer = window.setTimeout(() => {
      document.getElementById(step.focus)?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
    }, 60);
    return () => window.clearTimeout(timer);
  }, [presenting, tourStep, reducedMotion]);

  async function toggleClaude() {
    if (claudeMode) {
      setClaudeMode(false);
      return;
    }
    try {
      const status = await (await fetch("/api/ops/claude/status")).json() as { available: boolean };
      if (status.available) {
        setClaudeMode(true);
        setNotice("Claude mode is on: Claude writes the brief, explanations, and supplier drafts. Every number still comes from the ordering rules.");
      } else {
        setNotice("Claude mode needs ANTHROPIC_API_KEY in the local server’s .env. Using the standard text for now.");
      }
    } catch {
      setNotice("Couldn’t reach the local server, so Claude mode is unavailable. Using the standard text for now.");
    }
  }

  const write: WriteRequest = (kind, poId) => {
    setWriting({ kind, poId, written: null });
    const snapshotWorld = world;
    void writeText(kind, snapshotWorld, claudeMode, poId).then((written) => setWriting((current) => (current && current.poId === poId && current.kind === kind ? { ...current, written } : current)));
  };

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
  const flaggedCount = world.purchaseOrders.filter((po) => po.status === "flagged").length;
  const responses = scenario.response ? world.log.filter((entry) => entry.actor !== "system" && scenario.response!.test(`${entry.title} ${entry.detail ?? ""}`)).slice(-3).reverse() : [];

  return (
    <div className={`ops-page ${reducedMotion ? "reduce-motion" : ""} ${largeText ? "ops-large" : ""} ${presenting ? "is-presenting" : ""}`}>
      <header className="ops-hero">
        <div>
          <p className="ops-eyebrow"><span className="ops-eyebrow-line" /> Operations · Paterson shop</p>
          <h1>Behind the <em>counter.</em></h1>
          <p className="ops-lede">Stock, purchase orders, and suppliers in one place. The restock agent checks the shelves every night at closing and asks before any big order goes out.</p>
        </div>
        <div className="ops-hero-side">
          <div className="ops-hero-stat" aria-live="polite">
            <span>Matcha in stock</span>
            <strong>{matcha ? formatDaysLeft(matcha.daysLeft) : "—"}</strong>
            <small>{matcha ? `at today’s pace · ${statusLabel(matcha)}` : ""}</small>
          </div>
        </div>
      </header>

      <div className="ops-controls" id="ops-controls" role="region" aria-label="Controls">
        <div className="ops-controls-bar">
          <div className="ops-clock">
            <strong>{formatDay(world.day, "long")}</strong>
            <span>{world.queue.length === 0 ? "Closed for the night" : formatClock(world.minute)}</span>
            <span className="ops-weather"><WeatherIcon tempF={world.conditions.tempF} /> {world.conditions.tempF}°F</span>
          </div>
          <div className="ops-controls-bar-actions">
            {running && !controlsOpen && <button className="ops-button" onClick={() => setRun(null)}><Pause size={17} /> Pause</button>}
            <button className="ops-button ops-controls-toggle" aria-expanded={controlsOpen} aria-controls="ops-controls-panel" onClick={() => setControlsOpen(!controlsOpen)}>
              <SlidersHorizontal size={16} /> {controlsOpen ? "Hide controls" : "Controls"}
            </button>
          </div>
        </div>
        {controlsOpen && <div className="ops-controls-panel" id="ops-controls-panel">
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
          <button className={`ops-switch ${claudeMode ? "is-on" : ""}`} role="switch" aria-checked={claudeMode} onClick={toggleClaude} title="Optional: Claude writes the explanations. Numbers always come from the ordering rules.">
            <span className="switch-track" aria-hidden="true"><span className="switch-thumb" /></span> Claude mode {claudeMode ? "on" : "off"}
          </button>
          <form className="ops-reset" onSubmit={applySeed}>
            <label>Seed <input value={seedDraft} onChange={(event) => setSeedDraft(event.target.value)} inputMode="numeric" aria-label="Random seed" /></label>
            <button className="ops-button" type="submit"><RotateCcw size={16} /> Reset</button>
          </form>
        </div>
        </div>}
      </div>

      {scenarioId !== "normal" && (
        <div className="scenario-banner" role="status">
          <p className="ops-eyebrow">{scenario.source}</p>
          <p className="scenario-text">{scenario.banner}</p>
          {responses.length > 0 ? (
            <div className="scenario-response">
              <p className="ops-eyebrow">What the agent did</p>
              <ul>{responses.map((entry) => <li key={entry.id}><strong>{formatDay(entry.day)}:</strong> {entry.title}. <span>{relevantSentences(entry.detail ?? "", scenario.response!)}</span></li>)}</ul>
            </div>
          ) : <p className="ops-muted">The agent will respond when it checks the shelves tonight.</p>}
        </div>
      )}
      {notice && <div className="ops-notice" role="status"><BellRing size={18} /><span>{notice}</span><button onClick={() => setNotice(null)} aria-label="Dismiss"><X size={16} /></button></div>}

      <nav className="ops-tabs" aria-label="Sections">
        {TABS.map((option) => (
          <button key={option.id} className={tab === option.id ? "is-selected" : ""} aria-current={tab === option.id ? "page" : undefined} onClick={() => setTab(option.id)}>
            {option.label}
            {option.id === "orders" && awaiting.length > 0 && <span className="tab-badge">{awaiting.length}</span>}
            {option.id === "invoices" && flaggedCount > 0 && <span className="tab-badge">{flaggedCount}</span>}
            {option.id === "freshness" && world.specialSuggestion && <span className="tab-badge">1</span>}
          </button>
        ))}
      </nav>

      {tab === "today" && <>
        {awaiting.length > 0 && (
          <section className="ops-panel approvals-panel" aria-labelledby="approvals-title">
            <div className="ops-panel-head"><div><p className="ops-eyebrow">{awaiting.every((po) => po.isBackup) ? "Backup orders always need a person" : `Over the ${formatDollars(SETTINGS.approvalThresholdCents)} limit, so a person decides`}</p><h2 id="approvals-title">Waiting for <em>you.</em></h2></div></div>
            <div className="approvals-layout">
              <div className="po-grid">{awaiting.map((po) => <PoCard key={po.id} po={po} today={world.day} onApprove={approve} onReject={reject} onWrite={write} defaultOpen />)}</div>
              <aside className="approval-help">
                <h3>What happens next</h3>
                <p><strong>Approve order:</strong> it’s sent to the supplier and arrives after their delivery time. The shelf refills when it does.</p>
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
            <MorningBrief world={world} claudeMode={claudeMode} />
            {(world.specialSuggestion || world.specialFor) && <SpecialCard suggestion={world.specialSuggestion} world={world} onStart={runSpecial} />}
            <section className="ops-panel" aria-labelledby="attention-title">
              <h2 id="attention-title" className="ops-side-title">Needs attention</h2>
              {attention.length === 0 ? <p className="ops-muted">Everything is comfortably stocked.</p> : (
                <ul className="attention-list">
                  {attention.slice(0, 5).map((tin) => (
                    <li key={tin.ingredient.id} className={`attention-item status-${tin.status}`}>
                      <button onClick={() => setOpenTin(tin.ingredient.id)}>
                        <span className="attention-name">{tin.ingredient.name}</span>
                        <span className="attention-days">{formatStockDays(tin.daysLeft)}</span>
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
            <div className="po-grid agent-latest">{recentPos.map((po) => <PoCard key={po.id} po={po} today={world.day} onWrite={write} />)}</div>
          </>}
        </section>
      </>}

      {tab === "orders" && (
        <section className="ops-panel" aria-labelledby="po-title">
          <div className="ops-panel-head"><div><p className="ops-eyebrow">Drafted by the restock agent</p><h2 id="po-title">Purchase <em>orders.</em></h2></div></div>
          {world.purchaseOrders.length === 0 && <p className="ops-muted">No purchase orders yet. Run a day and the agent will draft its first ones at closing.</p>}
          <PoGroup title="Waiting for your approval" pos={awaiting} today={world.day} onApprove={approve} onReject={reject} onWrite={write} />
          <PoGroup title="On the way" pos={byNewest.filter((po) => po.status === "sent" || po.status === "approved")} today={world.day} onWrite={write} />
          <PoGroup title="Arrived" pos={byNewest.filter((po) => ["received", "invoiced", "matched", "flagged", "disputed"].includes(po.status))} today={world.day} onWrite={write} />
          <PoGroup title="Not sent" pos={byNewest.filter((po) => po.status === "rejected")} today={world.day} onWrite={write} />
        </section>
      )}

      {tab === "log" && (
        <section className="ops-panel" aria-labelledby="log-title">
          <div className="ops-panel-head"><div><p className="ops-eyebrow">Every decision and action, with its reason</p><h2 id="log-title">Activity <em>log.</em></h2></div></div>
          <AuditLog log={world.log} />
        </section>
      )}

      {tab === "compare" && (
        <section className="ops-panel" aria-labelledby="compare-title">
          <div className="ops-panel-head"><div><p className="ops-eyebrow">Smarter ordering vs. one order per item</p><h2 id="compare-title">Ordering <em>savings.</em></h2></div></div>
          <ComparePanel seed={seed} scenarioId={scenarioId} />
        </section>
      )}

      {tab === "freshness" && (
        <section className="ops-panel" aria-labelledby="fresh-title">
          <div className="ops-panel-head"><div><p className="ops-eyebrow">Use it before it goes to waste</p><h2 id="fresh-title">Freshness <em>timeline.</em></h2></div></div>
          <FreshnessPanel world={world} onStart={runSpecial} />
        </section>
      )}

      {tab === "profit" && (
        <section className="ops-panel" aria-labelledby="profit-title">
          <div className="ops-panel-head"><div><p className="ops-eyebrow">What each drink costs to make</p><h2 id="profit-title">Drink <em>margins.</em></h2></div></div>
          <ProfitPanel world={world} />
        </section>
      )}

      {tab === "invoices" && (
        <section className="ops-panel" aria-labelledby="invoice-title">
          <div className="ops-panel-head"><div><p className="ops-eyebrow">Ordered, arrived, and billed should match</p><h2 id="invoice-title">Invoice <em>check.</em></h2></div></div>
          <InvoicePanel world={world} onResolve={resolve} />
        </section>
      )}

      {presenting && (
        <PresenterBar
          step={tourStep}
          setStep={setTourStep}
          onClose={() => setPresenting(false)}
          actions={{ serveNext, runWeek: () => runDays(7), runDay: () => runDays(1), loadScenario: (id) => { chooseScenario(id); setTab("today"); } }}
          largeText={largeText}
          setLargeText={setLargeText}
        />
      )}

      {writing && <WritingDialog title={`${writing.kind === "explain" ? "Why" : "Message to the supplier for"} ${writing.poId}${writing.kind === "explain" ? "?" : ""}`} written={writing.written} busy={!writing.written} kind={writing.kind} onClose={() => setWriting(null)} />}

      {selectedTin && <TinDetail tin={selectedTin} world={world} onClose={() => setOpenTin(null)} />}
    </div>
  );
}
