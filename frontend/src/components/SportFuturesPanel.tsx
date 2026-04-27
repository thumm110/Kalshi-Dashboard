import { fmtCents, type SportsFuturesGroup } from "../lib/api";
import { Panel } from "./KpiCard";

type Props = {
  title: string;
  groups: SportsFuturesGroup[];
  maxMarketsPerGroup?: number;
};

export function SportFuturesPanel({ title, groups, maxMarketsPerGroup = 5 }: Props) {
  const live = groups.filter((g) => g.markets.length > 0);
  return (
    <Panel
      title={title}
      right={
        <span className="text-[10px] text-term-dim">
          {live.length}/{groups.length} live
        </span>
      }
    >
      {groups.length === 0 ? (
        <div className="text-term-dim text-xs">no events</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {groups.map((g) => (
            <div key={g.id} className="border border-term-line bg-term-panel/40 p-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-term-text font-semibold truncate">{g.label}</span>
                <span className="text-[9px] text-term-dim shrink-0 ml-2">
                  {g.markets.length ? `${g.markets.length} mkts` : "—"}
                </span>
              </div>
              {g.markets.length === 0 ? (
                <div className="text-[10px] text-term-dim mt-1">event not live</div>
              ) : (
                <div className="mt-1 space-y-0.5">
                  {g.markets.slice(0, maxMarketsPerGroup).map((m) => (
                    <div key={m.ticker} className="flex justify-between text-[11px] tabular-nums">
                      <span className="text-term-text truncate pr-2">{m.title || m.ticker}</span>
                      <span className="text-term-cyan shrink-0">
                        {m.mid_cents != null ? fmtCents(m.mid_cents) : "—"}
                      </span>
                    </div>
                  ))}
                  {g.markets.length > maxMarketsPerGroup && (
                    <div className="text-[9px] text-term-dim">
                      +{g.markets.length - maxMarketsPerGroup} more
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
