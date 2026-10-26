import { CupSoda, Coffee } from "lucide-react";
import { drinkById, getIngredient } from "../engine/data";
import { formatClock, formatDay } from "../engine/orders";
import type { ServedOrder } from "../engine/sim";

export function OrdersFeed({ recent, latestKey }: { recent: ServedOrder[]; latestKey: string | null }) {
  return (
    <div className="orders-feed">
      {recent.length === 0 ? <p className="ops-muted feed-empty">No orders yet today. Press <strong>Next order</strong> to serve the first customer.</p> : (
        <ol className="feed-list" aria-label="Most recent orders first">
          {recent.slice(0, 14).map((served) => (
            <li key={served.order.id} className={`feed-item ${served.missed > 0 ? "feed-missed" : ""} ${served.order.id === latestKey ? "feed-latest" : ""} ${served.order.id.startsWith("W-") ? "feed-web" : ""}`}>
              <div className="feed-meta">
                <span>{formatClock(served.order.minute)}</span>
                <span className="feed-id">#{served.order.id}{served.order.note ? ` · ${served.order.note}` : ""}</span>
              </div>
              <ul className="feed-drinks">
                {served.order.lines.length > 4
                  ? <li>{served.order.lines.length} drinks · {formatDay(served.order.day)}</li>
                  : served.order.lines.map((line, index) => (
                    <li key={index}>
                      {line.iced ? <CupSoda size={15} aria-label="Iced" /> : <Coffee size={15} aria-label="Hot" />}
                      <span>{drinkById.get(line.drinkId)?.name}</span>
                      {line.milk === "oat" && <span className="feed-tag">oat</span>}
                    </li>
                  ))}
              </ul>
              {served.missed > 0 && (
                <p className="feed-miss">Couldn’t make {served.missed} {served.missed === 1 ? "drink" : "drinks"}: out of {served.missing.map((id) => getIngredient(id).name.toLowerCase()).join(" and ")}.</p>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
