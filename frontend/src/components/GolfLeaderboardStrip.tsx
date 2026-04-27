import { useEffect, useState } from "react";
import { api, type GolfLeaderboardResponse } from "../lib/api";

const POLL_MS = 60000;

export function GolfLeaderboardStrip() {
  const [data, setData] = useState<GolfLeaderboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await api.golfLeaderboard();
        if (!alive) return;
        setData(res);
        setError(res.error);
      } catch (err) {
        if (!alive) return;
        setError(err instanceof Error ? err.message : "golf failed");
      }
    }
    load();
    const id = window.setInterval(load, POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  if (error) return <div className="text-term-red text-xs">golf: {error}</div>;
  if (!data) return <div className="text-term-dim text-xs">loading golf…</div>;

  const leaders = data.leaders ?? [];
  if (leaders.length === 0) {
    return (
      <div className="text-term-dim text-xs">
        {data.tournament ? `next up: ${data.tournament}` : "no active tournament"}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2 text-[10px] text-term-dim">
        <span className="text-term-cyan tracking-wider">{data.short_name || data.tournament}</span>
        <span>{data.detail || data.status}</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5 max-h-64 overflow-y-auto">
        {leaders.map((p, i) => (
          <div key={`${p.name}-${i}`} className="flex justify-between text-[11px] tabular-nums">
            <span className="text-term-text truncate pr-2">
              <span className="text-term-dim mr-1 inline-block w-8">{p.pos || "—"}</span>
              {p.name}
            </span>
            <span className="flex items-center gap-2 shrink-0">
              <span className="text-term-cyan">{p.score ?? "—"}</span>
              <span className="text-[9px] text-term-dim w-12 text-right">{p.thru ?? ""}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
