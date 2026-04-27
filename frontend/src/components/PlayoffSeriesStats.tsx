import { fmtCents, type SeriesStats, type SeriesTeamStat, type SportsMarket } from "../lib/api";

const _winProbCache = new Map<string, number>();
export function naiveSeriesWinProb(aWins: number, bWins: number, totalGames: number): number {
  const target = Math.floor(totalGames / 2) + 1;
  if (aWins >= target) return 1;
  if (bWins >= target) return 0;
  const key = `${aWins}-${bWins}-${totalGames}`;
  const hit = _winProbCache.get(key);
  if (hit != null) return hit;
  const v = 0.5 * naiveSeriesWinProb(aWins + 1, bWins, totalGames)
          + 0.5 * naiveSeriesWinProb(aWins, bWins + 1, totalGames);
  _winProbCache.set(key, v);
  return v;
}

function winPips(wins: number, target: number): string {
  return "●".repeat(Math.min(wins, target)) + "○".repeat(Math.max(0, target - wins));
}

export function teamForMarket(title: string | null, teams: SeriesTeamStat[] | undefined): SeriesTeamStat | null {
  if (!title || !teams) return null;
  const norm = title.toLowerCase();
  return teams.find((t) => t.name && norm.includes(t.name.toLowerCase()))
      || teams.find((t) => t.abbrev && norm.includes(t.abbrev.toLowerCase()))
      || null;
}

type Props = {
  stats: SeriesStats | null | undefined;
  /** Optional Kalshi markets for naive-edge column (only used in the playoff series tile). */
  markets?: SportsMarket[];
  /** Render the markets rows (used by playoff series tile, not by scoreboard tiles). */
  showMarkets?: boolean;
};

export function PlayoffSeriesStats({ stats, markets, showMarkets }: Props) {
  if (!stats) return null;
  const teams = stats.teams ?? [];
  const total = stats.total_games ?? null;
  const target = total ? Math.floor(total / 2) + 1 : null;
  const t0 = teams[0];
  const t1 = teams[1];
  const havePips = !!(target && t0 && t1 && t0.series_wins != null && t1.series_wins != null);
  const hasBlock = teams.length || stats.next_game || stats.last_game || havePips;
  if (!hasBlock && !(showMarkets && markets?.length)) return null;

  return (
    <>
      {showMarkets && markets && markets.length > 0 && (
        <div className="mt-1 space-y-0.5">
          {markets.map((m) => {
            const team = teamForMarket(m.title, teams);
            let edge: number | null = null;
            let naive: number | null = null;
            if (team && target && t0 && t1 && t0.series_wins != null && t1.series_wins != null && m.mid_cents != null) {
              const myWins = team.abbrev === t0.abbrev ? t0.series_wins : t1.series_wins;
              const oppWins = team.abbrev === t0.abbrev ? t1.series_wins : t0.series_wins;
              naive = naiveSeriesWinProb(myWins, oppWins, total!) * 100;
              edge = m.mid_cents - naive;
            }
            return (
              <div key={m.ticker} className="flex justify-between text-[11px] tabular-nums gap-2">
                <span className="text-term-text truncate pr-2">{m.title || m.ticker}</span>
                <span className="flex items-center gap-2 shrink-0">
                  {naive != null && (
                    <span className="text-term-dim text-[10px]">naive {naive.toFixed(0)}%</span>
                  )}
                  {edge != null && Math.abs(edge) >= 2 && (
                    <span className={edge < 0 ? "text-term-greenBright text-[10px]" : "text-term-red text-[10px]"}>
                      {edge < 0 ? "+" : "−"}{Math.abs(edge).toFixed(0)}¢
                    </span>
                  )}
                  <span className="text-term-cyan">
                    {m.mid_cents != null ? fmtCents(m.mid_cents) : "—"}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      )}
      {hasBlock && (
        <div className="mt-1.5 pt-1.5 border-t border-term-line/60 space-y-0.5 text-[10px] text-term-dim tabular-nums">
          {havePips && (
            <div className="flex items-center gap-2 text-[11px]">
              <span className="text-term-text">{t0!.abbrev}</span>
              <span className="text-term-amber tracking-widest">{winPips(t0!.series_wins!, target!)}</span>
              <span className="text-term-dim">{t0!.series_wins}–{t1!.series_wins}</span>
              <span className="text-term-amber tracking-widest">{winPips(t1!.series_wins!, target!)}</span>
              <span className="text-term-text">{t1!.abbrev}</span>
              <span className="ml-auto">Bo{total}</span>
            </div>
          )}
          {stats.last_game?.sides && stats.last_game.sides.length === 2 && (
            <div>
              <span className="text-term-text">Last:</span>{" "}
              {stats.last_game.sides.map((sd, i) => (
                <span key={sd.abbrev}>
                  <span className={sd.winner ? "text-term-greenBright" : "text-term-text"}>
                    {sd.abbrev} {sd.score ?? "—"}
                  </span>
                  {i === 0 ? " – " : ""}
                </span>
              ))}
              {stats.last_game.ot && <span className="text-term-amber"> ({stats.last_game.ot})</span>}
            </div>
          )}
          {stats.next_game?.short_detail && (
            <div>
              <span className="text-term-text">Next:</span> {stats.next_game.short_detail}
            </div>
          )}
        </div>
      )}
    </>
  );
}
