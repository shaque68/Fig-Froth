import { useCallback, useEffect, useMemo, useState } from "react";
import { CloudSun, Pause, Play, RotateCcw, SkipForward, Sun, Thermometer } from "lucide-react";
import { formatCents } from "../engine/money";
import { formatClock, formatDay } from "../engine/orders";
import { formatDaysLeft, needsAttention, statusLabel, summarizePantry } from "../engine/pantry";
import { createWorld, type World } from "../engine/sim";
import { runToDay, stepHour, stepNextOrder } from "../engine/shop";
import { OrdersFeed } from "./OrdersFeed";
import { Pantry, TinDetail, type Drain } from "./Pantry";
import "../ops.css";

const DEFAULT_SEED = 2026;
type Speed = "slow" | "fast" | "instant";
const SPEED_MS: Record<Exclude<Speed, "instant">, number> = { slow: 650, fast: 140 };
const SPEED_LABEL: Record<Speed, string> = { slow: "Slow", fast: "Fast", instant: "Instant" };

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

export default function OpsPage() {
  const [seed, setSeed] = useState(DEFAULT_SEED);
  const [seedDraft, setSeedDraft] = useState(String(DEFAULT_SEED));
  const [world, setWorld] = useState<World>(() => createWorld(DEFAULT_SEED));
  const [speed, setSpeed] = useState<Speed>("fast");
  const [run, setRun] = useState<{ untilDay: number } | null>(null);
  const [drain, setDrain] = useState<Drain | null>(null);
  const [openTin, setOpenTin] = useState<string | null>(null);
  const reducedMotion = usePrefersReducedMotion();

  const tins = useMemo(() => summarizePantry(world), [world]);
  const attention = useMemo(() => needsAttention(tins), [tins]);
  const matcha = tins.find((tin) => tin.ingredient.id === "ceremonial-matcha");
  const running = run !== null;

  const update = useCallback((step: (next: World) => void) => {
    setWorld((current) => {
      const next = structuredClone(current);
      step(next);
      return next;
    });
  }, []);

  // Timed runs advance one simulated hour per tick so the tins visibly drain through the day.
  useEffect(() => {
    if (!run) return;
    if (world.day >= run.untilDay) {
      setRun(null);
      return;
    }
    const timer = window.setTimeout(() => update((next) => { stepHour(next); }), SPEED_MS[speed === "instant" ? "fast" : speed]);
    return () => window.clearTimeout(timer);
  }, [run, world, speed, update]);

  function serveNext() {
    const next = structuredClone(world);
    const served = stepNextOrder(next);
    setWorld(next);
    setDrain({ key: Date.now(), usage: served.usage });
  }

  function runDays(days: number) {
    setDrain(null);
    const untilDay = world.day + days;
    if (speed === "instant") update((next) => runToDay(next, untilDay));
    else setRun({ untilDay });
  }

  function reset(nextSeed = seed) {
    setRun(null);
    setDrain(null);
    setOpenTin(null);
    setWorld(createWorld(nextSeed));
  }

  function applySeed(event: React.FormEvent) {
    event.preventDefault();
    const parsed = Number.parseInt(seedDraft, 10);
    const nextSeed = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SEED;
    setSeed(nextSeed);
    setSeedDraft(String(nextSeed));
    reset(nextSeed);
  }

  // Clear the drain highlight once the signature animation has played.
  useEffect(() => {
    if (!drain) return;
    const timer = window.setTimeout(() => setDrain(null), reducedMotion ? 1600 : 2200);
    return () => window.clearTimeout(timer);
  }, [drain, reducedMotion]);

  const selectedTin = openTin ? tins.find((tin) => tin.ingredient.id === openTin) : undefined;
  const today = world.today;

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
          <span>{world.queue.length === 0 ? "Closed for the day" : formatClock(world.minute)}</span>
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
        <form className="ops-reset" onSubmit={applySeed}>
          <label>Seed <input value={seedDraft} onChange={(event) => setSeedDraft(event.target.value)} inputMode="numeric" aria-label="Random seed" /></label>
          <button className="ops-button" type="submit"><RotateCcw size={16} /> Reset demo</button>
        </form>
      </div>

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
                      <span className="attention-status">{statusLabel(tin)}</span>
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

      {selectedTin && <TinDetail tin={selectedTin} world={world} onClose={() => setOpenTin(null)} />}
    </div>
  );
}
