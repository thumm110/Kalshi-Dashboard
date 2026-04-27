import { useEffect, useState } from "react";
import { Panel } from "./KpiCard";
import { api, type EnsembleCity, type EnsembleRunResult } from "../lib/api";

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const CUSTOM_KEY = "__custom__";
const MODEL_OPTIONS = [
  { key: "gfs", label: "GFS" },
  { key: "ecmwf", label: "ECMWF IFS" },
  { key: "both", label: "Both" },
] as const;

export function EnsembleRunPanel() {
  const [cities, setCities] = useState<EnsembleCity[]>([]);
  const [cityKey, setCityKey] = useState<string>("dal");
  const [lat, setLat] = useState<string>("");
  const [lon, setLon] = useState<string>("");
  const [timezone, setTimezone] = useState<string>("America/Chicago");
  const [date, setDate] = useState<string>(todayIso());
  const [model, setModel] = useState<"gfs" | "ecmwf" | "both">("both");
  const [mode, setMode] = useState<"high" | "low">("high");
  const [threshold, setThreshold] = useState<string>("");
  const [direction, setDirection] = useState<"above" | "below">("above");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<EnsembleRunResult[]>([]);
  const [expandedModels, setExpandedModels] = useState<Record<string, boolean>>({});

  useEffect(() => {
    api
      .ensembleCities()
      .then((data) => setCities(data.cities))
      .catch(() => {});
  }, []);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const thresholdNum = threshold.trim() ? Number(threshold) : null;
      if (threshold.trim() && Number.isNaN(thresholdNum)) {
        throw new Error("threshold must be a number");
      }
      const models = model === "both" ? (["gfs", "ecmwf"] as const) : ([model] as const);
      const isCustom = cityKey === CUSTOM_KEY;
      const baseParams = isCustom
        ? (() => {
            const latNum = Number(lat);
            const lonNum = Number(lon);
            if (Number.isNaN(latNum) || Number.isNaN(lonNum) || !timezone.trim()) {
              throw new Error("lat, lon, and timezone required for custom");
            }
            return {
              date,
              mode,
              lat: latNum,
              lon: lonNum,
              timezone: timezone.trim(),
              threshold: thresholdNum,
              direction,
            };
          })()
        : {
            date,
            mode,
            city: cityKey,
            threshold: thresholdNum,
            direction,
          };

      const data = await Promise.all(models.map((modelKey) => api.ensembleRun({ ...baseParams, model: modelKey })));
      setResults(data);
      setExpandedModels({});
    } catch (err) {
      setError(err instanceof Error ? err.message : "ensemble run failed");
    } finally {
      setLoading(false);
    }
  }

  const isCustom = cityKey === CUSTOM_KEY;

  return (
    <Panel
      title="Ensemble Model Run"
      right={<span className="text-[10px] text-term-dim">GFS + ECMWF IFS · Open-Meteo</span>}
    >
      <div className="flex flex-wrap items-end gap-3 text-xs">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-[0.15em] text-term-dim">City</span>
          <select
            value={cityKey}
            onChange={(e) => setCityKey(e.target.value)}
            className="bg-term-panel border border-term-line px-2 py-1 text-term-text"
          >
            {cities.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
            <option value={CUSTOM_KEY}>Custom…</option>
          </select>
        </label>

        {isCustom && (
          <>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-[0.15em] text-term-dim">Lat</span>
              <input
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                placeholder="29.42"
                className="bg-term-panel border border-term-line px-2 py-1 text-term-text w-24 tabular-nums"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-[0.15em] text-term-dim">Lon</span>
              <input
                value={lon}
                onChange={(e) => setLon(e.target.value)}
                placeholder="-98.49"
                className="bg-term-panel border border-term-line px-2 py-1 text-term-text w-24 tabular-nums"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-[0.15em] text-term-dim">Timezone</span>
              <input
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                placeholder="America/Chicago"
                className="bg-term-panel border border-term-line px-2 py-1 text-term-text w-40"
              />
            </label>
          </>
        )}

        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-[0.15em] text-term-dim">Date</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="bg-term-panel border border-term-line px-2 py-1 text-term-text tabular-nums"
          />
        </label>

        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-[0.15em] text-term-dim">Model</span>
          <div className="flex border border-term-line">
            {MODEL_OPTIONS.map((option) => (
              <button
                key={option.key}
                onClick={() => setModel(option.key)}
                className={`px-3 py-1 ${model === option.key ? "bg-term-cyan/20 text-term-cyan" : "text-term-dim"}`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-[0.15em] text-term-dim">Mode</span>
          <div className="flex border border-term-line">
            {(["high", "low"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-3 py-1 ${mode === m ? "bg-term-cyan/20 text-term-cyan" : "text-term-dim"}`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-[0.15em] text-term-dim">Threshold °F</span>
          <input
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            placeholder="optional"
            className="bg-term-panel border border-term-line px-2 py-1 text-term-text w-24 tabular-nums"
          />
        </label>

        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-[0.15em] text-term-dim">Direction</span>
          <div className="flex border border-term-line">
            {(["above", "below"] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDirection(d)}
                className={`px-3 py-1 ${direction === d ? "bg-term-cyan/20 text-term-cyan" : "text-term-dim"}`}
              >
                {d}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={run}
          disabled={loading}
          className="px-4 py-1.5 bg-term-greenBright/20 border border-term-greenBright/60 text-term-greenBright hover:bg-term-greenBright/30 disabled:opacity-50"
        >
          {loading ? "Running…" : "Run"}
        </button>
      </div>

      {error && <div className="mt-3 text-xs text-term-red">{error}</div>}

      {results.length > 0 && (
        <div className={`mt-4 grid gap-3 ${results.length > 1 ? "lg:grid-cols-2" : ""}`}>
          {results.map((result) => {
            const showMembers = !!expandedModels[result.model];
            return (
              <div key={result.model} className="border border-term-line/70 bg-term-panel/60 p-3 font-mono text-xs text-term-text tabular-nums">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-term-cyan">{result.model_description}</div>
                  <div className="text-[10px] text-term-dim">{result.api_model}</div>
                </div>
                <div className="mt-2 whitespace-pre">{`${result.location_label} — ${result.forecast_date} (${result.mode})
Members:    ${result.member_count}
Min/Max:    ${result.summary.min.toFixed(1)}°F / ${result.summary.max.toFixed(1)}°F
Mean/Med:   ${result.summary.mean.toFixed(2)}°F / ${result.summary.median.toFixed(2)}°F
Std Dev:    ${result.summary.stddev.toFixed(2)}°F`}</div>
                {result.probability !== null && result.threshold !== null && (
                  <div className="mt-2 text-term-cyan">
                    {`P(${result.direction} ${result.threshold.toFixed(1)}°F): ${(result.probability * 100).toFixed(1)}%`}
                  </div>
                )}
                <button
                  onClick={() =>
                    setExpandedModels((current) => ({
                      ...current,
                      [result.model]: !current[result.model],
                    }))
                  }
                  className="mt-2 text-term-dim hover:text-term-text"
                >
                  {showMembers ? `▾ Hide ${result.member_count} members` : `▸ Show ${result.member_count} members`}
                </button>
                {showMembers && (
                  <div className="mt-2 grid grid-cols-5 gap-x-4 gap-y-0.5 text-term-dim">
                    {[...result.members]
                      .sort((a, b) => a - b)
                      .map((v, i) => (
                        <span key={i}>{v.toFixed(1)}°F</span>
                      ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
