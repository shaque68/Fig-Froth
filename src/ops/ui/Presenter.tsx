import { useEffect } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

export type TourTab = "today" | "orders" | "log" | "compare";

export type TourActions = {
  serveNext: () => void;
  runWeek: () => void;
  runDay: () => void;
  loadScenario: (id: string) => void;
};

type Step = {
  title: string;
  say: string;
  tab: TourTab;
  /** Element to bring into view. */
  focus: string;
  actions?: (actions: TourActions) => Array<{ label: string; run: () => void }>;
};

// Follows the five-minute demo script.
export const TOUR: Step[] = [
  {
    title: "The shop",
    say: "Each tin is an ingredient. This is what’s on the shelf right now. The dashed line is the reorder point.",
    tab: "today",
    focus: "pantry-title",
  },
  {
    title: "Orders drive stock",
    say: "Every customer order takes its recipe off the shelf. Serve a few orders and watch the tins drain.",
    tab: "today",
    focus: "pantry-title",
    actions: ({ serveNext }) => [{ label: "Next order", run: serveNext }],
  },
  {
    title: "The agent",
    say: "Run one week. Every night the agent checks the shelf, plans, drafts orders, and asks before spending more than the limit. Approve one and watch it arrive.",
    tab: "today",
    focus: "agent-title",
    actions: ({ runWeek }) => [{ label: "Run one week", run: runWeek }],
  },
  {
    title: "Smarter ordering",
    say: "Open “Why this order?” on any order, then Savings: same month, same customers, two ways to order.",
    tab: "compare",
    focus: "compare-title",
  },
  {
    title: "A curveball",
    say: "Pick a scenario, run a day, and read what the agent did in the notice.",
    tab: "today",
    focus: "ops-controls",
    actions: ({ loadScenario, runDay }) => [
      { label: "Heat wave", run: () => loadScenario("heat-wave") },
      { label: "Late delivery", run: () => loadScenario("late-delivery") },
      { label: "Run one day", run: runDay },
    ],
  },
  {
    title: "Controls",
    say: "Every decision is in the activity log, and bigger orders wait for a person. It saves time and money, and a human stays in charge.",
    tab: "log",
    focus: "log-title",
  },
];

export function PresenterBar({ step, setStep, onClose, actions, largeText, setLargeText }: {
  step: number;
  setStep: (step: number) => void;
  onClose: () => void;
  actions: TourActions;
  largeText: boolean;
  setLargeText: (value: boolean) => void;
}) {
  const current = TOUR[step];

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
      if (event.key === "ArrowRight") { event.preventDefault(); setStep(Math.min(TOUR.length - 1, step + 1)); }
      if (event.key === "ArrowLeft") { event.preventDefault(); setStep(Math.max(0, step - 1)); }
      if (event.key === "Escape" && !document.querySelector(".ops-backdrop")) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, setStep, onClose]);

  return (
    <aside className="presenter-bar" aria-label="Presenter mode" aria-live="polite">
      <div className="presenter-progress" aria-hidden="true">{TOUR.map((_, index) => <span key={index} className={index <= step ? "is-done" : ""} />)}</div>
      <div className="presenter-body">
        <p className="ops-eyebrow">Step {step + 1} of {TOUR.length}</p>
        <h2>{current.title}</h2>
        <p className="presenter-say">{current.say}</p>
        {current.actions && <div className="presenter-actions">{current.actions(actions).map((action) => <button key={action.label} className="ops-button ops-button-primary" onClick={action.run}>{action.label}</button>)}</div>}
      </div>
      <div className="presenter-nav">
        <button className="ops-button" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}><ChevronLeft size={17} /> Back</button>
        <button className="ops-button ops-button-primary" onClick={() => (step === TOUR.length - 1 ? onClose() : setStep(step + 1))}>{step === TOUR.length - 1 ? "Finish" : <>Next <ChevronRight size={17} /></>}</button>
        <label className="presenter-large"><input type="checkbox" checked={largeText} onChange={(event) => setLargeText(event.target.checked)} /> Larger text</label>
        <button className="presenter-close" onClick={onClose} aria-label="End presenter mode"><X size={18} /></button>
        <span className="presenter-hint">Use ← → to move between steps</span>
      </div>
    </aside>
  );
}
