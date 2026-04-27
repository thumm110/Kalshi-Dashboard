import { useMemo, useState } from "react";
import type { TrackRecord as TrackRecordData, TrackRecordRow } from "../lib/api";
import { fmtUsd } from "../lib/api";
import { Panel } from "./KpiCard";

type SortKey = keyof Pick<
  TrackRecordRow,
  "series" | "category" | "trade_count" | "win_rate" | "total_pnl_cents" | "expectancy_cents" | "roi" | "last_settled_ts"
>;

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function fmtAgo(ts: number): string {
  if (!ts) return "—";
  const d = Math.floor((Date.now() / 1000 - ts) / 86400);
  if (d <= 0) return "today";
  if (d === 1) return "1d ago";
  if (d < 30) return `${d}d ago`;
  const m = Math.floor(d / 30);
  return `${m}mo ago`;
}

export function TrackRecord({ data }: { data: TrackRecordData | null }) {
  const [sort, setSort] = useState<{ k: SortKey; dir: "asc" | "desc" }>({ k: "total_pnl_cents", dir: "desc" });
  const [limit, setLimit] = useState(12);

  const sorted = useMemo(() => {
    const rows = data?.series ? [...data.series] : [];
    return rows.sort((a, b) => {
      const av = a[sort.k] as number | string;
      const bv = b[sort.k] as number | string;
      if (typeof av === "number" && typeof bv === "number") return sort.dir === "asc" ? av - bv : bv - av;
      return sort.dir === "asc" ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    });
  }, [data, sort]);

  const visible = sorted.slice(0, limit);

  const h = (k: SortKey, label: string, align: "l" | "r" = "l") => (
    <th
      onClick={() =>
        setSort((s) => (s.k === k ? { k, dir: s.dir === "asc" ? "desc" : "asc" } : { k, dir: "desc" }))
      }
      className={`cursor-pointer select-none text-[10px] tracking-[0.15em] uppercase text-term-dim py-1 px-2 border-b border-term-line ${align === "r" ? "text-right" : "text-left"}`}
    >
      {label}
      {sort.k === k ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
    </th>
  );

  const right = data ? (
    <span className="text-[10px] text-term-dim tabular-nums">{data.count} series</span>
  ) : null;

  return (
    <Panel title="Track Record — by Series" right={right}>
      <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
        <table className="w-full text-[12px] tabular-nums">
          <thead className="sticky top-0 bg-term-panel">
            <tr>
              {h("series", "Series")}
              {h("category", "Cat")}
              {h("trade_count", "Trades", "r")}
              {h("win_rate", "Win %", "r")}
              {h("total_pnl_cents", "PnL", "r")}
              {h("expectancy_cents", "Expectancy", "r")}
              {h("roi", "ROI", "r")}
              {h("last_settled_ts", "Last", "r")}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr><td colSpan={8} className="text-center text-term-dim py-6">No settled trades yet</td></tr>
            )}
            {visible.map((r) => {
              const p = r.total_pnl_cents;
              return (
                <tr key={r.series} className="border-b border-term-line/40 hover:bg-term-line/40">
                  <td className="py-1 px-2 text-term-text font-medium">{r.series}</td>
                  <td className="py-1 px-2 text-term-cyan">{r.category}</td>
                  <td className="py-1 px-2 text-right">{r.trade_count}<span className="text-term-dim text-[10px]"> ({r.wins}-{r.losses}{r.pushes ? `-${r.pushes}` : ""})</span></td>
                  <td className={`py-1 px-2 text-right ${r.win_rate >= 0.5 ? "text-term-greenBright" : "text-term-text"}`}>{pct(r.win_rate)}</td>
                  <td className={`py-1 px-2 text-right ${p > 0 ? "text-term-greenBright" : p < 0 ? "text-term-red" : ""}`}>{fmtUsd(p, true)}</td>
                  <td className={`py-1 px-2 text-right ${r.expectancy_cents > 0 ? "text-term-greenBright" : r.expectancy_cents < 0 ? "text-term-red" : ""}`}>{fmtUsd(Math.round(r.expectancy_cents), true)}</td>
                  <td className={`py-1 px-2 text-right ${r.roi > 0 ? "text-term-greenBright" : r.roi < 0 ? "text-term-red" : ""}`}>{pct(r.roi)}</td>
                  <td className="py-1 px-2 text-right text-term-dim">{fmtAgo(r.last_settled_ts)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {sorted.length > limit && (
        <div className="text-center pt-2">
          <button
            onClick={() => setLimit((n) => n + 20)}
            className="text-[10px] tracking-[0.15em] uppercase text-term-dim hover:text-term-text"
          >
            show {Math.min(20, sorted.length - limit)} more
          </button>
        </div>
      )}
    </Panel>
  );
}
