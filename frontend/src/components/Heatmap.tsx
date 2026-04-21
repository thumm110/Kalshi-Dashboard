import type { Position } from "../lib/api";
import { fmtUsd } from "../lib/api";

export function Heatmap({ positions }: { positions: Position[] }) {
  if (positions.length === 0) {
    return <div className="text-term-dim text-sm py-4 text-center">No positions to map</div>;
  }
  const maxExposure = Math.max(...positions.map((p) => p.market_exposure_cents), 1);

  const cell = (p: Position) => {
    const size = Math.max(8, Math.round((p.market_exposure_cents / maxExposure) * 100));
    const u = p.unrealized_pnl_cents;
    const intensity = Math.min(1, Math.abs(u) / 5000);
    const bg = u >= 0
      ? `rgba(86, 211, 100, ${0.15 + intensity * 0.55})`
      : `rgba(248, 81, 73, ${0.15 + intensity * 0.55})`;
    return (
      <div
        key={p.ticker}
        title={`${p.ticker}\nExposure: ${fmtUsd(p.market_exposure_cents)}\nUnrealized: ${fmtUsd(u, true)}`}
        className="border border-term-line p-1.5 flex flex-col justify-between overflow-hidden"
        style={{ background: bg, gridColumn: `span ${Math.max(1, Math.round(size / 20))}` }}
      >
        <div className="text-[10px] truncate text-term-text font-medium">{p.ticker}</div>
        <div className={"text-[11px] font-bold tabular-nums " + (u >= 0 ? "text-term-greenBright" : "text-term-red")}>
          {fmtUsd(u, true)}
        </div>
      </div>
    );
  };

  return (
    <div className="grid grid-cols-6 gap-1 max-h-[240px] overflow-y-auto">
      {positions.map(cell)}
    </div>
  );
}
