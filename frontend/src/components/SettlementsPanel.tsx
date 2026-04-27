import type { Settlement } from "../lib/api";
import { fmtUsd } from "../lib/api";

function timeLabel(value: string): string {
  if (!value) return "";
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function SettlementsPanel({
  settlements,
  totalPnl,
}: {
  settlements: Settlement[];
  totalPnl: number;
}) {
  if (settlements.length === 0) {
    return <div className="text-term-dim text-sm py-4 text-center">No settlements today</div>;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[11px] tabular-nums">
        <span className="text-term-dim">Today settled</span>
        <span className={totalPnl >= 0 ? "text-term-greenBright" : "text-term-red"}>
          {fmtUsd(totalPnl, true)}
        </span>
      </div>
      <ul className="divide-y divide-term-line/60 text-[12px] max-h-[360px] overflow-y-auto">
        {settlements.map((s) => {
          const tone = s.pnl_cents >= 0 ? "text-term-greenBright" : "text-term-red";
          return (
            <li key={`${s.ticker}-${s.settled_time}`} className="py-1.5">
              <div className="flex items-center gap-2">
                <span className={`w-12 text-[10px] font-bold tracking-widest ${tone}`}>
                  {(s.market_result || "").toUpperCase()}
                </span>
                <span className="flex-1 truncate text-term-text">{s.ticker}</span>
                <span className="text-term-cyan text-[10px]">{s.category}</span>
                <span className={`w-20 text-right tabular-nums ${tone}`}>{fmtUsd(s.pnl_cents, true)}</span>
              </div>
              <div className="mt-0.5 flex items-center justify-between gap-2 text-[10px] text-term-dim tabular-nums">
                <span className="truncate">
                  cost {fmtUsd(s.cost_cents)} / payout {fmtUsd(s.revenue_cents)}
                </span>
                <span>{timeLabel(s.settled_time)}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
