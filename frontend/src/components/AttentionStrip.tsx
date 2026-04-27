import type { AttentionChip } from "../lib/api";
import { fmtUsd } from "../lib/api";

function toneClasses(severity: string): string {
  switch (severity) {
    case "bad":
      return "border-term-red/60 text-term-red bg-term-red/10";
    case "warn":
      return "border-term-amber/60 text-term-amber bg-term-amber/10";
    case "good":
      return "border-term-greenBright/60 text-term-greenBright bg-term-greenBright/10";
    default:
      return "border-term-line text-term-dim bg-term-panel/60";
  }
}

function chipLabel(c: AttentionChip): string {
  switch (c.kind) {
    case "resolving":
      return `⏱ ${c.minutes_to_resolve}m · ${c.ticker}${c.exposure_cents ? ` · ${fmtUsd(c.exposure_cents)}` : ""}`;
    case "edge_negative":
      return `↘ edge ${c.edge_cents}¢ · ${c.ticker} (entry ${c.entry_cents}¢ → mid ${c.mid_cents}¢)`;
    case "drawdown":
      return `▼ ${c.ticker} ${c.pct !== undefined ? `${(c.pct * 100).toFixed(0)}%` : ""} · ${c.unrealized_cents !== undefined ? fmtUsd(c.unrealized_cents, true) : ""}`;
    case "recent_fills":
      return `◉ ${c.count} fills · ${c.total_contracts}ct · ${c.latest_ticker}`;
    case "category_swing":
      return `${c.pnl_cents && c.pnl_cents > 0 ? "▲" : "▼"} ${c.category} ${c.pnl_cents !== undefined ? fmtUsd(c.pnl_cents, true) : ""} today`;
    case "equity_move":
      return `${c.delta_cents && c.delta_cents > 0 ? "▲" : "▼"} session ${c.delta_cents !== undefined ? fmtUsd(c.delta_cents, true) : ""}`;
    default:
      return c.ticker || c.kind;
  }
}

export function AttentionStrip({ chips }: { chips: AttentionChip[] }) {
  if (!chips || chips.length === 0) return null;
  return (
    <div className="px-3 pt-2 flex flex-wrap gap-2 items-center">
      <span className="text-[9px] tracking-[0.2em] uppercase text-term-dim">Attention</span>
      {chips.map((c, i) => (
        <span
          key={`${c.kind}-${c.ticker ?? c.category ?? i}`}
          title={c.title ?? undefined}
          className={`border px-2 py-0.5 text-[11px] font-medium tabular-nums whitespace-nowrap ${toneClasses(c.severity)}`}
        >
          {chipLabel(c)}
        </span>
      ))}
    </div>
  );
}
