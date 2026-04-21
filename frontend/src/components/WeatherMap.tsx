import { ComposableMap, Geographies, Geography, Marker } from "react-simple-maps";
import { CITIES, type WeatherCity } from "../lib/cities";
import type { Position } from "../lib/api";
import { fmtUsd } from "../lib/api";
import { eventKindFromSeries, seriesFromTicker } from "../lib/cities";

const US_TOPO = "https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json";

type CityState = {
  city: WeatherCity;
  positions: Position[];
  totalPnl: number;          // cents
  stale: boolean;
  tone: "pos" | "neg" | "flat" | "idle";
};

function computeCityStates(positions: Position[]): CityState[] {
  const byCity = new Map<string, Position[]>();
  for (const p of positions) {
    const s = seriesFromTicker(p.ticker);
    const c = CITIES.find((c) => c.series.includes(s));
    if (!c) continue;
    const arr = byCity.get(c.code) || [];
    arr.push(p);
    byCity.set(c.code, arr);
  }
  return CITIES.map((city) => {
    const pos = byCity.get(city.code) || [];
    const totalPnl = pos.reduce((a, p) => a + p.unrealized_pnl_cents + p.realized_pnl_cents, 0);
    let tone: CityState["tone"] = "idle";
    if (pos.length > 0) {
      // Tiny dead-zone: just enough to hide rounding flutter at exact breakeven.
      if (totalPnl > 5) tone = "pos";
      else if (totalPnl < -5) tone = "neg";
      else tone = "flat";
    }
    return { city, positions: pos, totalPnl, stale: false, tone };
  });
}

const TONE_COLOR: Record<CityState["tone"], string> = {
  pos:  "#56d364", // green
  neg:  "#f85149", // red
  flat: "#6b7280", // gray for stale
  idle: "#39c5cf", // blue baseline
};

type Props = {
  positions: Position[];
  pulseKey: number;
  selectedCity: string | null;
  onSelectCity: (code: string | null) => void;
};

export function WeatherMap({ positions, pulseKey, selectedCity, onSelectCity }: Props) {
  const states = computeCityStates(positions);

  return (
    <div className="relative w-full" style={{ aspectRatio: "16 / 9" }}>
      <ComposableMap
        projection="geoAlbersUsa"
        projectionConfig={{ scale: 1000 }}
        style={{ width: "100%", height: "100%" }}
      >
        <Geographies geography={US_TOPO}>
          {({ geographies }) =>
            geographies.map((geo) => (
              <Geography
                key={geo.rsmKey}
                geography={geo}
                style={{
                  default: { fill: "#0f1419", stroke: "#1f2937", strokeWidth: 0.5, outline: "none" },
                  hover:   { fill: "#151c24", stroke: "#374151", strokeWidth: 0.5, outline: "none" },
                  pressed: { fill: "#151c24", stroke: "#374151", strokeWidth: 0.5, outline: "none" },
                }}
              />
            ))
          }
        </Geographies>

        {states.map(({ city, positions: pos, totalPnl, stale, tone }) => {
          const color = TONE_COLOR[tone];
          const isHeld = pos.length > 0 && !stale;
          const isSelected = selectedCity === city.code;
          return (
            <Marker
              key={city.code}
              coordinates={[city.lng, city.lat]}
              onClick={() => onSelectCity(isSelected ? null : city.code)}
              style={{
                default: { cursor: "pointer" },
                hover:   { cursor: "pointer" },
                pressed: { cursor: "pointer" },
              }}
            >
              {isHeld && (
                <circle
                  key={`pulse-${city.code}-${pulseKey}`}
                  r={5}
                  fill={color}
                  opacity={0.5}
                  style={{ animation: "cityPulse 1.2s ease-out" }}
                />
              )}
              <circle
                r={isSelected ? 5.5 : 4}
                fill={color}
                stroke={isSelected ? "#e5e7eb" : "#0b0f13"}
                strokeWidth={isSelected ? 1.2 : 0.8}
                opacity={pos.length === 0 ? 0.6 : 1}
              >
                <title>
                  {city.name}
                  {pos.length > 0
                    ? ` — ${fmtUsd(totalPnl, true)} across ${pos.length} position${pos.length > 1 ? "s" : ""}${stale ? " (stale)" : ""}`
                    : " — no position"}
                  {pos.length > 0 ? "\n" + pos.map((p) => `  ${eventKindFromSeries(seriesFromTicker(p.ticker))} ${p.ticker}: ${fmtUsd(p.unrealized_pnl_cents, true)}`).join("\n") : ""}
                </title>
              </circle>
              <text
                x={0}
                y={-8}
                textAnchor="middle"
                style={{
                  fontFamily: "JetBrains Mono, monospace",
                  fontSize: 8,
                  fill: isSelected || pos.length > 0 ? "#e5e7eb" : "#6b7280",
                  pointerEvents: "none",
                }}
              >
                {city.code}
              </text>
            </Marker>
          );
        })}
      </ComposableMap>

      <style>{`
        @keyframes cityPulse {
          0%   { r: 4;  opacity: 0.7; }
          100% { r: 18; opacity: 0;   }
        }
      `}</style>
    </div>
  );
}
