import type { Scorecard as ScorecardData, ScorecardMetrics } from "../lib/api";
import { fmtUsd } from "../lib/api";
import { Panel } from "./KpiCard";

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function toneFor(n: number): string {
  return n > 0 ? "text-term-greenBright" : n < 0 ? "text-term-red" : "text-term-text";
}

function Cell({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="border-r border-term-line last:border-r-0 px-3 py-2 min-w-[110px]">
      <div className="text-[9px] tracking-[0.18em] text-term-dim uppercase">{label}</div>
      <div className={`text-[15px] font-bold tabular-nums ${tone ?? "text-term-text"}`}>{value}</div>
      {sub && <div className="text-[10px] text-term-dim tabular-nums">{sub}</div>}
    </div>
  );
}

function Row({ label, m }: { label: string; m: ScorecardMetrics }) {
  return (
    <div className="flex flex-wrap border-b border-term-line last:border-b-0 items-stretch">
      <div className="px-3 py-2 min-w-[90px] text-[10px] tracking-[0.18em] text-term-dim uppercase flex items-center border-r border-term-line">
        {label}
      </div>
      <Cell label="Trades" value={String(m.trade_count)} sub={`${m.wins}W / ${m.losses}L${m.pushes ? ` / ${m.pushes}P` : ""}`} />
      <Cell label="Win Rate" value={pct(m.win_rate)} tone={m.win_rate >= 0.5 ? "text-term-greenBright" : "text-term-text"} />
      <Cell label="PnL" value={fmtUsd(m.total_pnl_cents, true)} tone={toneFor(m.total_pnl_cents)} />
      <Cell label="Expectancy" value={fmtUsd(Math.round(m.expectancy_cents), true)} tone={toneFor(m.expectancy_cents)} sub="per trade" />
      <Cell label="Avg Win" value={fmtUsd(m.avg_win_cents, true)} tone="text-term-greenBright" />
      <Cell label="Avg Loss" value={fmtUsd(m.avg_loss_cents, true)} tone="text-term-red" />
      <Cell label="W/L Ratio" value={m.win_loss_ratio ? m.win_loss_ratio.toFixed(2) : "—"} />
      <Cell label="Best" value={fmtUsd(m.best_trade_cents, true)} tone="text-term-greenBright" />
      <Cell label="Worst" value={fmtUsd(m.worst_trade_cents, true)} tone="text-term-red" />
    </div>
  );
}

export function Scorecard({ data }: { data: ScorecardData | null }) {
  if (!data) {
    return (
      <Panel title="Trader Scorecard">
        <div className="text-term-dim text-[12px]">loading…</div>
      </Panel>
    );
  }

  const streakColor =
    data.streak.sign === "W" ? "text-term-greenBright" : data.streak.sign === "L" ? "text-term-red" : "text-term-dim";
  const streakLabel =
    data.streak.count > 0 ? `${data.streak.sign}${data.streak.count}` : "—";

  const right = (
    <div className="flex gap-4 text-[10px] tabular-nums">
      <span className="text-term-dim">STREAK <span className={`font-bold ${streakColor}`}>{streakLabel}</span></span>
      <span className="text-term-dim">MAX DD <span className="font-bold text-term-red">{fmtUsd(-data.max_drawdown_cents, true)}</span>{data.max_drawdown_pct > 0 ? ` (${pct(data.max_drawdown_pct)})` : ""}</span>
      <span className="text-term-dim">SHARPE <span className="font-bold text-term-text">{data.sharpe_annualized.toFixed(2)}</span></span>
      <span className="text-term-dim">{data.active_days}d</span>
    </div>
  );

  return (
    <Panel title="Trader Scorecard" right={right}>
      <div className="overflow-x-auto">
        <Row label="30 Day" m={data.last_30d} />
        <Row label="All Time" m={data.all_time} />
      </div>
    </Panel>
  );
}
