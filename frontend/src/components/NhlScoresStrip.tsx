import { useEffect, useState } from "react";
import { api, type NhlGame, type NhlScoresResponse } from "../lib/api";
import { PlayoffSeriesStats } from "./PlayoffSeriesStats";

const POLL_MS = 20000;

function stateLabel(g: NhlGame): string {
  const s = (g.state || "").toUpperCase();
  if (s === "FUT" || s === "PRE") {
    if (!g.start_utc) return "SCHED";
    const d = new Date(g.start_utc);
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  if (s === "FINAL" || s === "OFF") {
    const pt = g.period_type;
    if (pt === "OT" || pt === "SO") return `FINAL/${pt}`;
    return "FINAL";
  }
  if (s === "LIVE" || s === "CRIT") {
    const period = g.period ?? 0;
    const periodLabel = period === 4 ? "OT" : period === 5 ? "SO" : `P${period || "?"}`;
    if (g.clock?.in_intermission) return `INT ${periodLabel}`;
    const remaining = g.clock?.time_remaining || "";
    return `${periodLabel} ${remaining}`.trim();
  }
  return s || "—";
}

function stateTone(g: NhlGame): string {
  const s = (g.state || "").toUpperCase();
  if (s === "LIVE" || s === "CRIT") return "text-term-amber";
  if (s === "FINAL" || s === "OFF") return "text-term-dim";
  return "text-term-cyan";
}

export function NhlScoresStrip() {
  const [data, setData] = useState<NhlScoresResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await api.nhlScores();
        if (!alive) return;
        setData(res);
        setError(res.error);
      } catch (err) {
        if (!alive) return;
        setError(err instanceof Error ? err.message : "nhl scores failed");
      }
    }
    load();
    const id = window.setInterval(load, POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  const games = data?.games ?? [];

  if (error) {
    return <div className="text-term-red text-xs">nhl: {error}</div>;
  }
  if (!data) {
    return <div className="text-term-dim text-xs">loading NHL scores…</div>;
  }
  if (games.length === 0) {
    return <div className="text-term-dim text-xs">no NHL games today</div>;
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
      {games.map((g) => {
        const away = g.away;
        const home = g.home;
        const isLive = (g.state || "").toUpperCase() === "LIVE" || (g.state || "").toUpperCase() === "CRIT";
        const leaderIsHome = (home.score ?? 0) > (away.score ?? 0);
        const leaderIsAway = (away.score ?? 0) > (home.score ?? 0);
        return (
          <a
            key={g.id ?? `${away.abbrev}-${home.abbrev}`}
            href={g.game_center_url || "#"}
            target={g.game_center_url ? "_blank" : undefined}
            rel="noreferrer"
            className="block border border-term-line bg-term-panel/40 p-2 hover:border-term-cyan/60 transition-colors"
          >
            <div className="flex items-center justify-between mb-1">
              <span className={`text-[10px] tracking-wider ${stateTone(g)}`}>
                {stateLabel(g)}
                {isLive && <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-term-amber animate-pulse align-middle" />}
              </span>
              {(away.sog != null || home.sog != null) && (
                <span className="text-[9px] text-term-dim tabular-nums">
                  SOG {away.sog ?? 0}–{home.sog ?? 0}
                </span>
              )}
            </div>
            <div className="space-y-0.5">
              <div className="flex items-center justify-between text-xs tabular-nums">
                <span className={`truncate pr-2 ${leaderIsAway ? "text-term-text font-bold" : "text-term-dim"}`}>
                  {away.abbrev || "—"} {away.place || away.name || ""}
                  {away.season_record && (
                    <span className="text-[9px] text-term-dim ml-1">({away.season_record})</span>
                  )}
                </span>
                <span className={leaderIsAway ? "text-term-greenBright" : "text-term-text"}>
                  {away.score ?? "—"}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs tabular-nums">
                <span className={`truncate pr-2 ${leaderIsHome ? "text-term-text font-bold" : "text-term-dim"}`}>
                  {home.abbrev || "—"} {home.place || home.name || ""}
                  {home.season_record && (
                    <span className="text-[9px] text-term-dim ml-1">({home.season_record})</span>
                  )}
                </span>
                <span className={leaderIsHome ? "text-term-greenBright" : "text-term-text"}>
                  {home.score ?? "—"}
                </span>
              </div>
            </div>
            <PlayoffSeriesStats stats={g.series_stats} />
          </a>
        );
      })}
    </div>
  );
}
