import type { Fill } from "../lib/api";

export function FillsFeed({ fills }: { fills: Fill[] }) {
  if (fills.length === 0) {
    return <div className="text-term-dim text-sm py-4 text-center">No recent fills</div>;
  }
  return (
    <ul className="divide-y divide-term-line/60 text-[12px] max-h-[360px] overflow-y-auto">
      {fills.map((f) => {
        const buy = f.action?.toLowerCase() === "buy";
        const price = f.side === "yes" ? f.yes_price_cents : f.no_price_cents;
        return (
          <li key={f.trade_id} className="py-1.5 flex items-center gap-2">
            <span className={`w-10 text-[10px] font-bold tracking-widest ${buy ? "text-term-greenBright" : "text-term-red"}`}>
              {(f.action || "").toUpperCase()}
            </span>
            <span className={`w-8 text-[10px] font-bold ${f.side === "yes" ? "text-term-greenBright" : "text-term-amber"}`}>
              {(f.side || "").toUpperCase()}
            </span>
            <span className="flex-1 truncate text-term-text">{f.ticker}</span>
            <span className="text-term-cyan text-[10px]">{f.category}</span>
            <span className="w-12 text-right tabular-nums text-term-text">×{f.count}</span>
            <span className="w-10 text-right tabular-nums text-term-text">{price}¢</span>
            <span className="w-20 text-right text-[10px] text-term-dim">
              {new Date(f.created_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
