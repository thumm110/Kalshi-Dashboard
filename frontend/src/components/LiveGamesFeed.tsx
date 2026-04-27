import { fmtCents, type SportsGame } from "../lib/api";
import { PlayoffSeriesStats } from "./PlayoffSeriesStats";

type Props = {
  games: SportsGame[];
  sportFilter?: string;
};

function sportTone(sport: string): string {
  switch (sport) {
    case "nba": return "text-term-amber";
    case "nhl": return "text-term-cyan";
    case "mlb": return "text-term-greenBright";
    case "mls": return "text-term-text";
    case "ufc": return "text-term-red";
    default: return "text-term-dim";
  }
}

function startTimeLabel(iso: string | null): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleString(undefined, {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function changeClass(c: number | null | undefined): string {
  if (c == null || c === 0) return "text-term-dim";
  return c > 0 ? "text-term-greenBright" : "text-term-red";
}

export function LiveGamesFeed({ games, sportFilter }: Props) {
  const filtered = sportFilter ? games.filter((g) => g.sport_id === sportFilter) : games;
  if (filtered.length === 0) {
    return <div className="text-term-dim text-xs p-2">no live games</div>;
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
      {filtered.map((g) => (
        <div key={g.event_ticker} className="border border-term-line bg-term-panel/40 p-2">
          <div className="flex items-center justify-between mb-1">
            <span className={`text-[10px] font-bold tracking-wider ${sportTone(g.sport_id)}`}>
              {g.sport_label}
            </span>
            <span className="text-[10px] text-term-dim tabular-nums">
              {startTimeLabel(g.expected_expiration_time)}
            </span>
          </div>
          <div className="text-[11px] text-term-text truncate" title={g.title || ""}>
            {g.title || g.event_ticker}
          </div>
          {g.sub_title && (
            <div className="text-[10px] text-term-dim truncate">{g.sub_title}</div>
          )}
          {g.team_records && Object.keys(g.team_records).length > 0 && (
            <div className="text-[10px] text-term-dim tabular-nums flex flex-wrap gap-x-2">
              {Object.entries(g.team_records).map(([abbrev, rec]) => (
                <span key={abbrev}>
                  <span className="text-term-text">{abbrev}</span> {rec}
                </span>
              ))}
            </div>
          )}
          {g.series_summary && (
            <div className="text-[10px] text-term-amber truncate" title={g.series_summary}>
              {g.series_summary}
            </div>
          )}
          <div className="mt-1.5 space-y-0.5">
            {g.markets.slice(0, 4).map((m) => (
              <div key={m.ticker} className="flex justify-between text-[11px] tabular-nums">
                <span className="text-term-text truncate pr-2">{m.title || m.ticker}</span>
                <span className="flex items-center gap-2 shrink-0">
                  <span className="text-term-cyan">
                    {m.mid_cents != null ? fmtCents(m.mid_cents) : "—"}
                  </span>
                  {m.change_24h_cents != null && m.change_24h_cents !== 0 && (
                    <span className={`text-[9px] ${changeClass(m.change_24h_cents)}`}>
                      {m.change_24h_cents > 0 ? "+" : ""}
                      {m.change_24h_cents}
                    </span>
                  )}
                </span>
              </div>
            ))}
            {g.markets.length > 4 && (
              <div className="text-[9px] text-term-dim">+{g.markets.length - 4} more</div>
            )}
          </div>
          <PlayoffSeriesStats stats={g.series_stats} />
          {g.extra_markets && Object.entries(g.extra_markets).filter(([, v]) => v && v.length).map(([kind, rows]) => (
            <div key={kind} className="mt-1.5 pt-1 border-t border-term-line/40">
              <div className="text-[9px] text-term-dim uppercase tracking-wider mb-0.5">
                {kind} · {rows.length}
              </div>
              <div className="space-y-0.5">
                {rows.slice(0, 3).map((m) => (
                  <div key={m.ticker} className="flex justify-between text-[11px] tabular-nums">
                    <span className="text-term-text truncate pr-2">{m.title || m.ticker}</span>
                    <span className="text-term-cyan shrink-0">
                      {m.mid_cents != null ? fmtCents(m.mid_cents) : "—"}
                    </span>
                  </div>
                ))}
                {rows.length > 3 && (
                  <div className="text-[9px] text-term-dim">+{rows.length - 3} more</div>
                )}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
