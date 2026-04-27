import { fmtCents, type PoliticsGroup } from "../lib/api";

type Props = { groups: PoliticsGroup[] };

export function PoliticsMovers({ groups }: Props) {
  const rows = groups
    .flatMap((g) =>
      g.markets.map((m) => ({
        group: g.label,
        party: g.party,
        title: m.title || m.ticker,
        mid: m.mid_cents ?? 0,
        change: m.change_24h_cents ?? 0,
        ticker: m.ticker,
      }))
    )
    .filter((r) => r.change !== 0)
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
    .slice(0, 12);

  if (rows.length === 0) {
    return <div className="text-term-dim text-xs p-3">no 24h movers</div>;
  }

  return (
    <div className="divide-y divide-term-line/50">
      {rows.map((r) => (
        <div key={r.ticker} className="flex items-center justify-between py-1.5 text-xs gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-term-text truncate">{r.title}</div>
            <div className="text-[10px] text-term-dim truncate">{r.group}</div>
          </div>
          <div className="tabular-nums text-right shrink-0">
            <div className="text-term-text">{fmtCents(r.mid)}</div>
            <div className={r.change > 0 ? "text-term-greenBright text-[10px]" : "text-term-red text-[10px]"}>
              {r.change > 0 ? "+" : ""}{r.change}¢
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
