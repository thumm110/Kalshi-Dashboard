import { useEffect, useState } from "react";
import { Panel } from "./KpiCard";
import { api, type WeatherScanActivityResponse } from "../lib/api";

const HOUR_LABELS = Array.from({ length: 24 }, (_, h) => h);

function cellColor(value: number, max: number): string {
  if (max <= 0 || value <= 0) return "#0d1117";
  const t = Math.pow(Math.min(1, value / max), 0.55);
  // 3-stop: dark panel -> term-cyan -> purple
  const stops: [number, [number, number, number]][] = [
    [0.0, [13, 17, 23]],     // #0d1117
    [0.5, [57, 197, 207]],   // #39c5cf (term-cyan)
    [1.0, [168, 85, 247]],   // #a855f7 (purple)
  ];
  let lo = stops[0];
  let hi = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (t >= stops[i][0] && t <= stops[i + 1][0]) {
      lo = stops[i];
      hi = stops[i + 1];
      break;
    }
  }
  const span = hi[0] - lo[0] || 1;
  const k = (t - lo[0]) / span;
  const r = Math.round(lo[1][0] + (hi[1][0] - lo[1][0]) * k);
  const g = Math.round(lo[1][1] + (hi[1][1] - lo[1][1]) * k);
  const b = Math.round(lo[1][2] + (hi[1][2] - lo[1][2]) * k);
  return `rgb(${r},${g},${b})`;
}

function shortDay(iso: string): string {
  // "2026-04-28" -> "04/28"
  const [, m, d] = iso.split("-");
  return `${m}/${d}`;
}

export function WeatherScanHeatmap() {
  const [data, setData] = useState<WeatherScanActivityResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    async function load() {
      setLoading(true);
      try {
        const res = await api.weatherScanActivity(14);
        if (!alive) return;
        setData(res);
        setError(null);
      } catch (err) {
        if (!alive) return;
        setError(err instanceof Error ? err.message : "scan activity failed");
      } finally {
        if (alive) setLoading(false);
      }
    }
    load();
    const id = window.setInterval(load, 120000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  const right = (
    <span className="text-[10px] text-term-dim">
      {loading
        ? "refreshing"
        : data
        ? `${data.total_candidates.toLocaleString()} candidates · ${data.total_cycles.toLocaleString()} cycles · ${data.days.length}d`
        : ""}
    </span>
  );

  return (
    <Panel title="Weather Bot — Scan Activity (Candidates Found by Hour)" right={right}>
      {error && <div className="text-term-red text-xs mb-2">{error}</div>}
      {data && data.status && !data.status.available && (
        <div className="text-term-amber text-xs mb-2">
          Weather bot DB unavailable: {data.status.error || "not found"}
        </div>
      )}
      {data && data.cells.length === 0 ? (
        <div className="text-term-dim text-xs">No scan cycles in the last {data.days.length || 14} days.</div>
      ) : data ? (
        <div className="overflow-x-auto">
          <div className="inline-block min-w-full">
            <div
              className="grid text-[10px] tabular-nums"
              style={{ gridTemplateColumns: `48px repeat(24, minmax(18px, 1fr))` }}
            >
              <div />
              {HOUR_LABELS.map((h) => (
                <div key={`hh-${h}`} className="text-term-dim text-center pb-1">
                  {h % 3 === 0 ? h.toString().padStart(2, "0") : ""}
                </div>
              ))}

              {data.cells.map((row, rIdx) => {
                const day = data.days[rIdx];
                const rowTotal = row.reduce((a, b) => a + b, 0);
                return (
                  <div key={day} className="contents">
                    <div className="text-term-dim pr-2 text-right self-center">
                      {shortDay(day)}
                    </div>
                    {row.map((value, h) => (
                      <div
                        key={`${day}-${h}`}
                        title={`${day} ${h.toString().padStart(2, "0")}:00 — ${value} candidate${value === 1 ? "" : "s"}${rowTotal ? ` (day total ${rowTotal})` : ""}`}
                        className="h-4 border border-term-bg"
                        style={{ backgroundColor: cellColor(value, data.max_cell) }}
                      />
                    ))}
                  </div>
                );
              })}
            </div>

            <div className="mt-2 flex items-center gap-2 text-[10px] text-term-dim">
              <span>0</span>
              <div className="h-2 w-32 rounded" style={{
                background: `linear-gradient(to right, ${cellColor(0, data.max_cell || 1)}, ${cellColor((data.max_cell || 1) / 2, data.max_cell || 1)}, ${cellColor(data.max_cell || 1, data.max_cell || 1)})`,
              }} />
              <span>{data.max_cell.toLocaleString()}</span>
              <span className="ml-auto">hour of day · local time</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="text-term-dim text-xs">loading…</div>
      )}
    </Panel>
  );
}
