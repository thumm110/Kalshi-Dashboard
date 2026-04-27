import { useEffect, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, fmtUsd, type CategoryDetail, type PnlRange } from "../lib/api";
import { KpiCard, Panel } from "./KpiCard";

type Props = {
  category: string;
  label?: string;
};

const RANGES: { id: PnlRange; label: string }[] = [
  { id: "all", label: "All-time" },
  { id: "ytd", label: "YTD" },
  { id: "30d", label: "30d" },
  { id: "7d", label: "7d" },
];

const REFRESH_MS = 30000;

export function CategoryPnlPanel({ category, label }: Props) {
  const [range, setRange] = useState<PnlRange>("all");
  const [detail, setDetail] = useState<CategoryDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let alive = true;
    async function load() {
      setLoading(true);
      try {
        const data = await api.pnlCategory(category, range);
        if (!alive) return;
        setDetail(data);
        setError(null);
      } catch (err) {
        if (!alive) return;
        setError(err instanceof Error ? err.message : "pnl load failed");
      } finally {
        if (alive) setLoading(false);
      }
    }
    load();
    const id = window.setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [category, range]);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await api.pnlRefresh(false);
      const data = await api.pnlCategory(category, range);
      setDetail(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "refresh failed");
    } finally {
      setRefreshing(false);
    }
  }

  const stats = detail?.stats;
  const series = detail?.series ?? [];
  const realized = stats?.realized_pnl_cents ?? 0;
  const unrealized = stats?.unrealized_pnl_cents ?? 0;
  const total = stats?.total_pnl_cents ?? 0;
  const trades = stats ? stats.wins + stats.losses + stats.pushes : 0;
  const winRatePct = stats ? Math.round(stats.win_rate * 1000) / 10 : 0;
  const displayLabel = label || category;

  const chartData = series.map((p) => ({
    t: p.ts * 1000,
    cum: p.cumulative_pnl_cents / 100,
    day: p.daily_pnl_cents / 100,
  }));
  const up = chartData.length > 0 ? chartData[chartData.length - 1].cum >= 0 : true;
  const color = up ? "#56d364" : "#f85149";

  const refreshedAt = detail?.cache_refreshed_ts
    ? new Date(detail.cache_refreshed_ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <Panel
      title={`${displayLabel} Account Stats`}
      right={
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {RANGES.map((r) => (
              <button
                key={r.id}
                onClick={() => setRange(r.id)}
                className={`text-[10px] px-1.5 py-0.5 border ${
                  range === r.id
                    ? "border-term-cyan text-term-cyan"
                    : "border-term-line text-term-dim hover:text-term-text"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="text-[10px] px-1.5 py-0.5 border border-term-line text-term-dim hover:text-term-text disabled:opacity-50"
            title={refreshedAt ? `cache refreshed ${refreshedAt}` : "refresh settlements from Kalshi"}
          >
            {refreshing ? "…" : "↻"}
          </button>
        </div>
      }
    >
      {error && <div className="text-term-red text-xs mb-2">{error}</div>}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiCard
          label={`${displayLabel} PnL`}
          value={stats ? fmtUsd(total, true) : loading ? "…" : "—"}
          tone={total >= 0 ? "pos" : "neg"}
          sub={refreshedAt ? `as of ${refreshedAt}` : ""}
        />
        <KpiCard
          label="Realized"
          value={stats ? fmtUsd(realized, true) : "—"}
          tone={realized >= 0 ? "pos" : "neg"}
          sub={stats ? `${stats.settlement_count} settled` : ""}
        />
        <KpiCard
          label="Unrealized"
          value={stats ? fmtUsd(unrealized, true) : "—"}
          tone={unrealized >= 0 ? "pos" : "neg"}
          sub={stats ? `${stats.open_position_count} open` : ""}
        />
        <KpiCard
          label="Win Rate"
          value={trades ? `${winRatePct}%` : "—"}
          tone={winRatePct >= 50 ? "pos" : trades ? "neg" : "neutral"}
          sub={stats ? `${stats.wins}W ${stats.losses}L${stats.pushes ? ` ${stats.pushes}P` : ""}` : ""}
        />
        <KpiCard
          label="Fees"
          value={stats ? fmtUsd(stats.total_fees_cents) : "—"}
          tone="info"
          sub={stats ? `on ${fmtUsd(stats.total_cost_cents)} cost` : ""}
        />
      </div>

      {detail?.series_breakdown && detail.series_breakdown.length > 0 && (
        <div className="mt-3 border border-term-line">
          <div className="px-2 py-1 border-b border-term-line text-[10px] tracking-[0.2em] text-term-dim uppercase flex items-center justify-between">
            <span>By Series — worst first</span>
            <span>{detail.series_breakdown.length} series</span>
          </div>
          <div className="max-h-56 overflow-y-auto">
            <table className="w-full text-[11px] tabular-nums">
              <thead className="text-term-dim">
                <tr className="border-b border-term-line/50">
                  <th className="text-left px-2 py-1 font-normal">Series</th>
                  <th className="text-right px-2 py-1 font-normal">PnL</th>
                  <th className="text-right px-2 py-1 font-normal">W/L/P</th>
                  <th className="text-right px-2 py-1 font-normal">Rate</th>
                  <th className="text-right px-2 py-1 font-normal">Cost</th>
                  <th className="text-right px-2 py-1 font-normal">Fees</th>
                </tr>
              </thead>
              <tbody>
                {detail.series_breakdown.map((row) => {
                  const trades = row.wins + row.losses + row.pushes;
                  const rate = trades ? Math.round((row.wins / trades) * 1000) / 10 : 0;
                  return (
                    <tr key={row.series} className="border-b border-term-line/30">
                      <td className="px-2 py-1 text-term-text">{row.series}</td>
                      <td className={`px-2 py-1 text-right ${row.pnl_cents >= 0 ? "text-term-greenBright" : "text-term-red"}`}>
                        {fmtUsd(row.pnl_cents, true)}
                      </td>
                      <td className="px-2 py-1 text-right text-term-dim">
                        {row.wins}/{row.losses}{row.pushes ? `/${row.pushes}` : ""}
                      </td>
                      <td className="px-2 py-1 text-right text-term-dim">{trades ? `${rate}%` : "—"}</td>
                      <td className="px-2 py-1 text-right text-term-dim">{fmtUsd(row.cost_cents)}</td>
                      <td className="px-2 py-1 text-right text-term-dim">{fmtUsd(row.fees_cents)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="mt-3">
        {chartData.length === 0 ? (
          <div className="h-48 flex items-center justify-center text-term-dim text-xs">
            {loading ? "loading…" : `no settled ${displayLabel.toLowerCase()} trades in this range`}
          </div>
        ) : (
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id={`catFill-${category}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity={0.4} />
                    <stop offset="100%" stopColor={color} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#1a2029" strokeDasharray="2 4" />
                <XAxis
                  dataKey="t"
                  type="number"
                  domain={["dataMin", "dataMax"]}
                  tickFormatter={(t) => new Date(t).toLocaleDateString([], { month: "short", day: "numeric" })}
                  stroke="#6b7785"
                  fontSize={10}
                />
                <YAxis
                  stroke="#6b7785"
                  fontSize={10}
                  tickFormatter={(v) => `$${v.toFixed(0)}`}
                />
                <Tooltip
                  contentStyle={{ background: "#0d1117", border: "1px solid #1a2029", fontSize: 12 }}
                  labelFormatter={(t: number) => new Date(t).toLocaleDateString()}
                  formatter={(v: number, name: string) => [fmtUsd(Math.round(v * 100), true), name === "cum" ? "cumulative" : "day"]}
                />
                <Area
                  type="monotone"
                  dataKey="cum"
                  stroke={color}
                  strokeWidth={2}
                  fill={`url(#catFill-${category})`}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </Panel>
  );
}
