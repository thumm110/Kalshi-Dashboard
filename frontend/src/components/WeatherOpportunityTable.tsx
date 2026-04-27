import { useMemo, useState } from "react";
import type { WeatherOpportunity } from "../lib/api";

type Props = {
  rows: WeatherOpportunity[];
  loading?: boolean;
  error?: string | null;
  selectedCity?: string | null;
  generatedAt?: number | null;
};

type KindFilter = "ALL" | "HIGH" | "LOW";
type SideFilter = "ALL" | "YES" | "NO";
type SortKey = "EDGE" | "CONFIDENCE" | "SPREAD" | "CLOSE";

function fmtPct(value?: number | null, sign = false): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const pct = value * 100;
  const prefix = sign && pct > 0 ? "+" : "";
  return `${prefix}${pct.toFixed(1)}%`;
}

function fmtTime(value?: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtGeneratedAt(value?: number | null): string {
  if (!value) return "—";
  return new Date(value * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function edgeTone(edge: number): string {
  if (edge >= 0.2) return "text-term-greenBright";
  if (edge >= 0.12) return "text-term-cyan";
  return "text-term-dim";
}

function sideTone(side: "YES" | "NO"): string {
  return side === "YES" ? "text-term-greenBright" : "text-term-red";
}

function spreadTone(spread: number): string {
  if (spread <= 0.08) return "text-term-greenBright";
  if (spread <= 0.16) return "text-term-cyan";
  return "text-term-red";
}

export function WeatherOpportunityTable({
  rows,
  loading = false,
  error = null,
  selectedCity = null,
  generatedAt = null,
}: Props) {
  const [kindFilter, setKindFilter] = useState<KindFilter>("ALL");
  const [sideFilter, setSideFilter] = useState<SideFilter>("ALL");
  const [minEdge, setMinEdge] = useState(12);
  const [minAgreement, setMinAgreement] = useState(3);
  const [sortBy, setSortBy] = useState<SortKey>("EDGE");

  const filtered = useMemo(() => {
    const next = rows.filter((row) => {
      if (selectedCity && row.city_code !== selectedCity) return false;
      if (kindFilter !== "ALL" && row.market_kind !== kindFilter) return false;
      if (sideFilter !== "ALL" && row.recommended_side !== sideFilter) return false;
      if ((row.trade_edge ?? 0) * 100 < minEdge) return false;
      if ((row.agreement_count ?? 0) < minAgreement) return false;
      return true;
    });

    next.sort((a, b) => {
      if (sortBy === "CONFIDENCE") {
        return (b.confidence ?? 0) - (a.confidence ?? 0) || b.trade_edge - a.trade_edge;
      }
      if (sortBy === "SPREAD") {
        return b.disagreement_spread - a.disagreement_spread || b.trade_edge - a.trade_edge;
      }
      if (sortBy === "CLOSE") {
        return new Date(a.close_time).getTime() - new Date(b.close_time).getTime();
      }
      return b.trade_edge - a.trade_edge;
    });

    return next;
  }, [rows, selectedCity, kindFilter, sideFilter, minEdge, minAgreement, sortBy]);

  const summary = useMemo(() => {
    if (filtered.length === 0) {
      return {
        cities: 0,
        bestEdge: null as number | null,
        widestSpread: null as number | null,
        avgConfidence: null as number | null,
      };
    }
    const confidenceRows = filtered.filter((row) => row.confidence !== null && row.confidence !== undefined);
    return {
      cities: new Set(filtered.map((row) => row.city_code)).size,
      bestEdge: filtered[0]?.trade_edge ?? null,
      widestSpread: filtered.reduce((best, row) => Math.max(best, row.disagreement_spread), 0),
      avgConfidence:
        confidenceRows.length > 0
          ? confidenceRows.reduce((sum, row) => sum + (row.confidence ?? 0), 0) / confidenceRows.length
          : null,
    };
  }, [filtered]);

  return (
    <div>
      <div className="flex flex-wrap items-end gap-2 mb-3">
        <label className="flex flex-col gap-1 text-[10px] tracking-[0.15em] uppercase text-term-dim">
          Type
          <select
            className="bg-term-panel border border-term-line px-2 py-1 text-[12px] text-term-text"
            value={kindFilter}
            onChange={(event) => setKindFilter(event.target.value as KindFilter)}
          >
            <option value="ALL">All</option>
            <option value="HIGH">High</option>
            <option value="LOW">Low</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[10px] tracking-[0.15em] uppercase text-term-dim">
          Side
          <select
            className="bg-term-panel border border-term-line px-2 py-1 text-[12px] text-term-text"
            value={sideFilter}
            onChange={(event) => setSideFilter(event.target.value as SideFilter)}
          >
            <option value="ALL">All</option>
            <option value="YES">YES</option>
            <option value="NO">NO</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[10px] tracking-[0.15em] uppercase text-term-dim">
          Min Edge
          <input
            className="w-20 bg-term-panel border border-term-line px-2 py-1 text-[12px] text-term-text"
            type="number"
            min={0}
            step={1}
            value={minEdge}
            onChange={(event) => setMinEdge(Number(event.target.value) || 0)}
          />
        </label>
        <label className="flex flex-col gap-1 text-[10px] tracking-[0.15em] uppercase text-term-dim">
          Min Agree
          <input
            className="w-20 bg-term-panel border border-term-line px-2 py-1 text-[12px] text-term-text"
            type="number"
            min={0}
            max={4}
            step={1}
            value={minAgreement}
            onChange={(event) => setMinAgreement(Number(event.target.value) || 0)}
          />
        </label>
        <label className="flex flex-col gap-1 text-[10px] tracking-[0.15em] uppercase text-term-dim">
          Sort
          <select
            className="bg-term-panel border border-term-line px-2 py-1 text-[12px] text-term-text"
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value as SortKey)}
          >
            <option value="EDGE">Best Edge</option>
            <option value="CONFIDENCE">Confidence</option>
            <option value="SPREAD">Model Spread</option>
            <option value="CLOSE">Close Time</option>
          </select>
        </label>
        <div className="ml-auto flex flex-wrap gap-2 text-[10px] text-term-dim">
          <div className="border border-term-line px-2 py-1">rows {filtered.length}</div>
          <div className="border border-term-line px-2 py-1">cities {summary.cities}</div>
          <div className="border border-term-line px-2 py-1">best {fmtPct(summary.bestEdge, true)}</div>
          <div className="border border-term-line px-2 py-1">spread {fmtPct(summary.widestSpread)}</div>
          <div className="border border-term-line px-2 py-1">conf {fmtPct(summary.avgConfidence)}</div>
          <div className="border border-term-line px-2 py-1">updated {fmtGeneratedAt(generatedAt)}</div>
        </div>
      </div>

      <div className="overflow-x-auto max-h-[440px] overflow-y-auto">
        <table className="w-full text-[12px] tabular-nums">
          <thead className="sticky top-0 bg-term-panel">
            <tr>
              <th className="text-left font-bold text-[10px] tracking-[0.15em] uppercase text-term-dim py-1 px-2 border-b border-term-line">Market</th>
              <th className="text-left font-bold text-[10px] tracking-[0.15em] uppercase text-term-dim py-1 px-2 border-b border-term-line">City</th>
              <th className="text-left font-bold text-[10px] tracking-[0.15em] uppercase text-term-dim py-1 px-2 border-b border-term-line">Type</th>
              <th className="text-right font-bold text-[10px] tracking-[0.15em] uppercase text-term-dim py-1 px-2 border-b border-term-line">Kalshi YES</th>
              <th className="text-right font-bold text-[10px] tracking-[0.15em] uppercase text-term-dim py-1 px-2 border-b border-term-line">Fair YES</th>
              <th className="text-right font-bold text-[10px] tracking-[0.15em] uppercase text-term-dim py-1 px-2 border-b border-term-line">Best Edge</th>
              <th className="text-left font-bold text-[10px] tracking-[0.15em] uppercase text-term-dim py-1 px-2 border-b border-term-line">Side</th>
              <th className="text-right font-bold text-[10px] tracking-[0.15em] uppercase text-term-dim py-1 px-2 border-b border-term-line">Conf</th>
              <th className="text-right font-bold text-[10px] tracking-[0.15em] uppercase text-term-dim py-1 px-2 border-b border-term-line">Agree</th>
              <th className="text-right font-bold text-[10px] tracking-[0.15em] uppercase text-term-dim py-1 px-2 border-b border-term-line">GFS</th>
              <th className="text-right font-bold text-[10px] tracking-[0.15em] uppercase text-term-dim py-1 px-2 border-b border-term-line">AIGEFS</th>
              <th className="text-right font-bold text-[10px] tracking-[0.15em] uppercase text-term-dim py-1 px-2 border-b border-term-line">ECMWF</th>
              <th className="text-right font-bold text-[10px] tracking-[0.15em] uppercase text-term-dim py-1 px-2 border-b border-term-line">AIFS</th>
              <th className="text-right font-bold text-[10px] tracking-[0.15em] uppercase text-term-dim py-1 px-2 border-b border-term-line">Spread</th>
              <th className="text-left font-bold text-[10px] tracking-[0.15em] uppercase text-term-dim py-1 px-2 border-b border-term-line">Close</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={15} className="text-center text-term-dim py-6">
                  {loading ? "loading weather opportunities" : error || "no temperature opportunities"}
                </td>
              </tr>
            )}
            {filtered.map((row) => (
              <tr key={row.ticker} className="border-b border-term-line/40 hover:bg-term-line/40">
                <td className="py-1 px-2 text-term-text">
                  <div className="font-medium truncate max-w-[240px]">{row.ticker}</div>
                  <div className="text-[10px] text-term-dim truncate max-w-[260px]" title={row.title || row.strike_label}>
                    {row.title || row.strike_label}
                  </div>
                </td>
                <td className="py-1 px-2 text-term-text">
                  <div>{row.city_name}</div>
                  <div className="text-[10px] text-term-dim">{row.city_code}</div>
                </td>
                <td className="py-1 px-2 text-term-text">
                  <div>{row.market_kind}</div>
                  <div className="text-[10px] text-term-dim">{row.strike_label}</div>
                </td>
                <td className="py-1 px-2 text-right text-term-text">{fmtPct(row.kalshi_yes_mid)}</td>
                <td className="py-1 px-2 text-right text-term-text">{fmtPct(row.fair_yes)}</td>
                <td className={`py-1 px-2 text-right ${edgeTone(row.trade_edge)}`}>{fmtPct(row.trade_edge, true)}</td>
                <td className={`py-1 px-2 ${sideTone(row.recommended_side)}`}>{row.recommended_side}</td>
                <td className="py-1 px-2 text-right text-term-text">{fmtPct(row.confidence)}</td>
                <td className="py-1 px-2 text-right text-term-text">
                  {row.agreement_count ?? 0}/{row.available_model_count}
                </td>
                <td className="py-1 px-2 text-right text-term-text">{fmtPct(row.gfs_prob)}</td>
                <td className="py-1 px-2 text-right text-term-text">{fmtPct(row.aigefs_prob)}</td>
                <td className="py-1 px-2 text-right text-term-text">{fmtPct(row.ecmwf_prob)}</td>
                <td className="py-1 px-2 text-right text-term-text">{fmtPct(row.aifs_prob)}</td>
                <td className={`py-1 px-2 text-right ${spreadTone(row.disagreement_spread)}`}>{fmtPct(row.disagreement_spread)}</td>
                <td className="py-1 px-2 text-term-dim">{fmtTime(row.close_time)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-2 text-[10px] text-term-dim">
        Uses the weather bot’s temperature ensemble logic plus the same spread, volume, open-interest, and close-window filters. Model spread is max minus min across available model probabilities.
      </div>
    </div>
  );
}
