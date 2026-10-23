import { ClipboardList, Eye, FileText, ListChecks, UserCheck } from "lucide-react";
import { formatDay } from "../engine/orders";
import type { AgentRun } from "../engine/sim";

const STEPS = [
  { key: "observe", label: "Observe stock", icon: Eye },
  { key: "plan", label: "Plan orders", icon: ClipboardList },
  { key: "draft", label: "Draft POs", icon: FileText },
  { key: "approval", label: "Request approval", icon: UserCheck },
  { key: "log", label: "Log", icon: ListChecks },
] as const;

export function AgentTrace({ run }: { run: AgentRun | undefined }) {
  if (!run) {
    return <p className="ops-muted">The agent checks the shelf every night at closing. Run a day to see it work.</p>;
  }
  return (
    <>
      <p className="trace-when">Last run: closing time, {formatDay(run.day, "long")}</p>
      <ol className="agent-trace">
        {STEPS.map(({ key, label, icon: Icon }, index) => {
          const needsYou = key === "approval" && run.awaitingIds.length > 0;
          return (
            <li key={key} className={`trace-step ${needsYou ? "trace-needs-you" : ""}`}>
              <span className="trace-index" aria-hidden="true"><Icon size={18} /></span>
              <span className="trace-label"><span className="sr-only">Step {index + 1}: </span>{label}</span>
              <span className="trace-detail">{run[key]}</span>
            </li>
          );
        })}
      </ol>
    </>
  );
}
