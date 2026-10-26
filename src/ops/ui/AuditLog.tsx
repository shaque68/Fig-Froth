import { useState } from "react";
import { formatClock, formatDay } from "../engine/orders";
import type { LogActor, LogEntry } from "../engine/sim";

const ACTOR_LABEL: Record<LogActor, string> = { agent: "Agent", you: "You", system: "Shop" };
const FILTERS: Array<{ id: "all" | LogActor; label: string }> = [
  { id: "all", label: "Everything" },
  { id: "agent", label: "Agent decisions" },
  { id: "you", label: "Your actions" },
  { id: "system", label: "Deliveries & waste" },
];

export function AuditLog({ log }: { log: LogEntry[] }) {
  const [filter, setFilter] = useState<"all" | LogActor>("all");
  const shown = log.filter((entry) => filter === "all" || entry.actor === filter).slice().reverse();
  return (
    <div className="audit-log">
      <div className="ops-chips" role="radiogroup" aria-label="Filter the audit log">
        {FILTERS.map((option) => (
          <button key={option.id} role="radio" aria-checked={filter === option.id} className={filter === option.id ? "is-selected" : ""} onClick={() => setFilter(option.id)}>
            {option.label} <span>{option.id === "all" ? log.length : log.filter((entry) => entry.actor === option.id).length}</span>
          </button>
        ))}
      </div>
      {shown.length === 0 ? <p className="ops-muted">Nothing logged yet. Run a day to see the agent’s decisions.</p> : (
        <ol className="audit-list">
          {shown.slice(0, 300).map((entry) => (
            <li key={entry.id} className={`audit-entry audit-${entry.actor}`}>
              <span className="audit-when">{formatDay(entry.day)}<br />{formatClock(entry.minute)}</span>
              <span className={`audit-actor actor-${entry.actor}`}>{ACTOR_LABEL[entry.actor]}</span>
              <span className="audit-what"><strong>{entry.title}</strong>{entry.detail && <span>{entry.detail}</span>}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
