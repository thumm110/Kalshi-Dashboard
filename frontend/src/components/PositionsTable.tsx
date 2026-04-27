import { useState } from "react";
import type { Position } from "../lib/api";
import { fmtUsd } from "../lib/api";

type SortKey = "ticker" | "category" | "position" | "market_exposure_cents" | "unrealized_pnl_cents" | "realized_pnl_cents" | "edge_cents";

export function PositionsTable({ positions }: { positions: Position[] }) {
  const [sort, setSort] = useState<{ k: SortKey; dir: "asc" | "desc" }>({ k: "unrealized_pnl_cents", dir: "desc" });

  const sorted = [...positions].sort((a, b) => {
    const rawA = a[sort.k] as number | string | null | undefined;
    const rawB = b[sort.k] as number | string | null | undefined;
    const av = rawA ?? (typeof rawA === "string" ? "" : -Infinity);
    const bv = rawB ?? (typeof rawB === "string" ? "" : -Infinity);
    if (typeof av === "number" && typeof bv === "number") return sort.dir === "asc" ? av - bv : bv - av;
    return sort.dir === "asc"
      ? String(av).localeCompare(String(bv))
      : String(bv).localeCompare(String(av));
  });

  const h = (key: SortKey, label: string, cls = "") => (
    <th
      className={`cursor-pointer select-none text-left font-bold text-[10px] tracking-[0.15em] uppercase text-term-dim py-1 px-2 border-b border-term-line ${cls}`}
      onClick={() =>
        setSort((s) => (s.k === key ? { k: key, dir: s.dir === "asc" ? "desc" : "asc" } : { k: key, dir: "desc" }))
      }
    >
      {label}{sort.k === key ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
    </th>
  );

  return (
    <div className="overflow-x-auto max-h-[460px] overflow-y-auto">
      <table className="w-full text-[12px] tabular-nums">
        <thead className="sticky top-0 bg-term-panel">
          <tr>
            {h("ticker", "Ticker")}
            {h("category", "Cat")}
            {h("position", "Qty", "text-right")}
            {h("market_exposure_cents", "Exposure", "text-right")}
            {h("edge_cents", "Entry/Mid/Edge", "text-right")}
            {h("unrealized_pnl_cents", "Unrealized", "text-right")}
            {h("realized_pnl_cents", "Realized", "text-right")}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 && (
            <tr>
              <td colSpan={7} className="text-center text-term-dim py-6">No open positions</td>
            </tr>
          )}
          {sorted.map((p) => {
            const u = p.unrealized_pnl_cents;
            const r = p.realized_pnl_cents;
            const entry = p.entry_cents;
            const mid = p.side_mid_cents;
            const edge = p.edge_cents;
            const edgeTone = edge == null ? "text-term-dim" : edge > 0 ? "text-term-greenBright" : edge < 0 ? "text-term-red" : "text-term-text";
            return (
              <tr key={p.ticker} className="border-b border-term-line/40 hover:bg-term-line/40">
                <td className="py-1 px-2 text-term-text font-medium truncate max-w-[240px]">{p.ticker}</td>
                <td className="py-1 px-2 text-term-cyan">{p.category}</td>
                <td className={"py-1 px-2 text-right " + (p.position >= 0 ? "text-term-greenBright" : "text-term-red")}>
                  {p.position > 0 ? "+" : ""}{p.position}
                </td>
                <td className="py-1 px-2 text-right text-term-text">{fmtUsd(p.market_exposure_cents)}</td>
                <td className="py-1 px-2 text-right text-[11px]">
                  <span className="text-term-dim">{entry != null ? `${entry}¢` : "—"}</span>
                  <span className="text-term-dim"> / </span>
                  <span className="text-term-text">{mid != null ? `${mid}¢` : "—"}</span>
                  <span className="text-term-dim"> / </span>
                  <span className={edgeTone + " font-bold"}>{edge != null ? `${edge > 0 ? "+" : ""}${edge}¢` : "—"}</span>
                </td>
                <td className={"py-1 px-2 text-right " + (u >= 0 ? "text-term-greenBright" : "text-term-red")}>
                  {fmtUsd(u, true)}
                </td>
                <td className={"py-1 px-2 text-right " + (r >= 0 ? "text-term-greenBright" : "text-term-red")}>
                  {fmtUsd(r, true)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
