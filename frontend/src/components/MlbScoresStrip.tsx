import { useEffect, useState } from "react";
import { api, type MlbGame, type MlbScoresResponse } from "../lib/api";
import { PlayoffSeriesStats } from "./PlayoffSeriesStats";

const POLL_MS = 20000;

function stateLabel(g: MlbGame): string {
  const s = (g.state || "").toLowerCase();
  if (s === "pre") {
    if (g.start_utc) {
      const d = new Date(g.start_utc);
      return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    }
    return "SCHED";
  }
  if (s === "post") return g.short_detail || "FINAL";
  if (s === "in") return g.short_detail || "LIVE";
  return g.short_detail || "—";
}

function stateTone(g: MlbGame): string {
  const s = (g.state || "").toLowerCase();
  if (s === "in") return "text-term-amber";
  if (s === "post") return "text-term-dim";
  return "text-term-cyan";
}

function Diamond({ on }: { on: MlbGame["on_base"] }) {
  const base = "w-2 h-2 rotate-45 border border-term-dim";
  const lit = "bg-term-amber border-term-amber";
  return (
    <span className="inline-flex items-center gap-[2px]" title="runners on base">
      <span className={`${base} ${on.second ? lit : ""}`} />
      <span className="inline-flex flex-col gap-[2px]">
        <span className={`${base} ${on.third ? lit : ""}`} />
        <span className={`${base} ${on.first ? lit : ""}`} />
      </span>
    </span>
  );
}

export function MlbScoresStrip() {
  const [data, setData] = useState<MlbScoresResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await api.mlbScores();
        if (!alive) return;
        setData(res);
        setError(res.error);
      } catch (err) {
        if (!alive) return;
        setError(err instanceof Error ? err.message : "mlb scores failed");
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

  if (error) return <div className="text-term-red text-xs">mlb: {error}</div>;
  if (!data) return <div className="text-term-dim text-xs">loading MLB scores…</div>;
  if (games.length === 0) return <div className="text-term-dim text-xs">no MLB games today</div>;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
      {games.map((g) => {
        const away = g.away;
        const home = g.home;
        const isLive = (g.state || "").toLowerCase() === "in";
        const leaderIsHome = (home.score ?? 0) > (away.score ?? 0);
        const leaderIsAway = (away.score ?? 0) > (home.score ?? 0);
        return (
          <a
            key={g.id ?? `${away.abbrev}-${home.abbrev}`}
            href={g.link || "#"}
            target={g.link ? "_blank" : undefined}
            rel="noreferrer"
            className="block border border-term-line bg-term-panel/40 p-2 hover:border-term-cyan/60 transition-colors"
          >
            <div className="flex items-center justify-between mb-1">
              <span className={`text-[10px] tracking-wider ${stateTone(g)}`}>
                {stateLabel(g)}
                {isLive && <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-term-amber animate-pulse align-middle" />}
              </span>
              {isLive && (
                <span className="flex items-center gap-2 text-[9px] text-term-dim tabular-nums">
                  <Diamond on={g.on_base} />
                  <span>
                    {g.balls ?? 0}-{g.strikes ?? 0}, {g.outs ?? 0} out
                  </span>
                </span>
              )}
            </div>
            <div className="space-y-0.5">
              <div className="flex items-center justify-between text-xs tabular-nums">
                <span className={`truncate pr-2 ${leaderIsAway ? "text-term-text font-bold" : "text-term-dim"}`}>
                  {away.abbrev || "—"} {away.name || ""}
                  {away.record && <span className="ml-1 text-[9px] text-term-dim">({away.record})</span>}
                </span>
                <span className={leaderIsAway ? "text-term-greenBright" : "text-term-text"}>
                  {away.score ?? "—"}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs tabular-nums">
                <span className={`truncate pr-2 ${leaderIsHome ? "text-term-text font-bold" : "text-term-dim"}`}>
                  {home.abbrev || "—"} {home.name || ""}
                  {home.record && <span className="ml-1 text-[9px] text-term-dim">({home.record})</span>}
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
