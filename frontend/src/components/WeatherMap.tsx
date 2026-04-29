import { type MouseEvent, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ComposableMap, Geographies, Geography, Marker } from "react-simple-maps";
import { CITIES, type WeatherCity } from "../lib/cities";
import type { Position, WeatherGuidanceLocation } from "../lib/api";
import { fmtUsd } from "../lib/api";
import { eventKindFromSeries, seriesFromTicker } from "../lib/cities";
import { WindyCityPopup, WindyPreconnect, WindyPreload } from "./WindyCityPopup";

const US_TOPO = "https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json";

type CityState = {
  city: WeatherCity;
  positions: Position[];
  totalPnl: number;          // cents
  exposure: number;          // cents
  stale: boolean;
  tone: "pos" | "neg" | "flat" | "idle";
  markerKind: MarkerKind;
};

type MarkerKind = "none" | "high" | "low" | "rain" | "snow" | "hurricane" | "emergency" | "other";

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
    const exposure = pos.reduce((a, p) => a + p.market_exposure_cents, 0);
    let tone: CityState["tone"] = "idle";
    if (pos.length > 0) {
      // Tiny dead-zone: just enough to hide rounding flutter at exact breakeven.
      if (totalPnl > 5) tone = "pos";
      else if (totalPnl < -5) tone = "neg";
      else tone = "flat";
    }
    return { city, positions: pos, totalPnl, exposure, stale: false, tone, markerKind: markerKindForPositions(pos) };
  });
}

const TONE_COLOR: Record<CityState["tone"], string> = {
  pos:  "#56d364", // green
  neg:  "#f85149", // red
  flat: "#6b7280", // gray for stale
  idle: "#39c5cf", // blue baseline
};

const NAUTICAL_STAR_POINTS =
  "0,-8 1.8,-2.4 5.7,-5.7 2.4,-1.8 8,0 2.4,1.8 5.7,5.7 1.8,2.4 0,8 -1.8,2.4 -5.7,5.7 -2.4,1.8 -8,0 -2.4,-1.8 -5.7,-5.7 -1.8,-2.4";
const CHS_STAR_COLOR = "#f97316";

const KIND_COLOR: Record<MarkerKind, string> = {
  none: "#39c5cf",
  high: "#f97316",
  low: "#7dd3fc",
  rain: "#38bdf8",
  snow: "#bfdbfe",
  hurricane: "#a78bfa",
  emergency: "#f59e0b",
  other: "#e5e7eb",
};

const LEGEND_ITEMS: Array<{ kind: MarkerKind; label: string }> = [
  { kind: "high", label: "High temp" },
  { kind: "low", label: "Low temp" },
  { kind: "rain", label: "Rain" },
  { kind: "hurricane", label: "Hurricane" },
  { kind: "emergency", label: "Emergency" },
];

function markerKindForPositions(positions: Position[]): MarkerKind {
  const kinds = new Set(positions.map((p) => eventKindFromSeries(seriesFromTicker(p.ticker))));
  if (kinds.has("HUR")) return "hurricane";
  if (kinds.has("EMERGENCY")) return "emergency";
  if (kinds.has("HIGH") || kinds.has("TEMP")) return "high";
  if (kinds.has("SNOW")) return "snow";
  if (kinds.has("LOW")) return "low";
  if (kinds.has("RAIN")) return "rain";
  return positions.length > 0 ? "other" : "none";
}

function WeatherMarkerIcon({
  kind,
  fill,
  stroke,
  selected,
  small = false,
}: {
  kind: MarkerKind;
  fill: string;
  stroke: string;
  selected: boolean;
  small?: boolean;
}) {
  const scale = small ? 0.68 : selected ? 1.18 : 1;
  const common = {
    fill,
    stroke,
    strokeWidth: selected ? 1.2 : 0.9,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    vectorEffect: "non-scaling-stroke" as const,
  };

  if (kind === "high") {
    return (
      <g transform={`scale(${scale})`}>
        <path
          d="M0,-9 C4,-5 5,-2 4,1 C3,5 0,8 -4,6 C-8,4 -7,-1 -4,-4 C-3,-1 -1,-2 -2,-6 C-1,-5 0,-9 0,-9 Z"
          {...common}
        />
        <path d="M0,4 C1,2 1,0 -1,-2 C-1,1 -3,2 -2,4 C-1,6 1,6 0,4 Z" fill="#ffd166" opacity={0.9} />
      </g>
    );
  }

  if (kind === "low" || kind === "snow") {
    return (
      <g transform={`scale(${scale})`} stroke={stroke} strokeWidth={selected ? 1.4 : 1.1} strokeLinecap="round" vectorEffect="non-scaling-stroke">
        <circle r={2.2} fill={fill} stroke="none" />
        <path d="M0,-8 V8 M-7,-4 L7,4 M7,-4 L-7,4" />
        <path d="M-2,-6 L0,-8 L2,-6 M-2,6 L0,8 L2,6 M-7,-1 L-7,-4 L-4,-5 M7,1 L7,4 L4,5 M7,-1 L7,-4 L4,-5 M-7,1 L-7,4 L-4,5" />
      </g>
    );
  }

  if (kind === "rain") {
    return (
      <g transform={`scale(${scale})`}>
        <path d="M0,-9 C4,-4 6,-1 6,3 C6,7 3,9 0,9 C-3,9 -6,7 -6,3 C-6,-1 -4,-4 0,-9 Z" {...common} />
        <path d="M-2,4 C-1,6 1,6 3,4" fill="none" stroke="#dbeafe" strokeWidth={0.9} strokeLinecap="round" />
      </g>
    );
  }

  if (kind === "hurricane") {
    return (
      <g transform={`scale(${scale})`} fill="none" strokeLinecap="round" vectorEffect="non-scaling-stroke">
        <circle r={7.6} fill={fill} opacity={0.22} stroke={stroke} strokeWidth={0.8} />
        <path d="M-7,-1 C-4,-7 5,-8 7,-2 C5,-4 1,-4 -1,-2 C-4,1 -1,5 3,3" stroke={fill} strokeWidth={2.5} />
        <path d="M7,1 C4,7 -5,8 -7,2 C-5,4 -1,4 1,2 C4,-1 1,-5 -3,-3" stroke={fill} strokeWidth={2.5} />
        <circle r={1.8} fill="#05080b" stroke={stroke} strokeWidth={0.8} />
      </g>
    );
  }

  if (kind === "emergency") {
    return (
      <g transform={`scale(${scale})`}>
        <path d="M0,-8 L8,7 H-8 Z" {...common} />
        <path d="M0,-3 V2" stroke="#05080b" strokeWidth={1.4} strokeLinecap="round" />
        <circle cx={0} cy={4.5} r={0.8} fill="#05080b" />
      </g>
    );
  }

  return <circle r={selected ? 5.5 : 4} fill={fill} stroke={stroke} strokeWidth={selected ? 1.2 : 0.8} opacity={kind === "none" ? 0.6 : 1} />;
}

function LegendIcon({ kind }: { kind: MarkerKind }) {
  const fill = KIND_COLOR[kind];
  return (
    <svg viewBox="-12 -12 24 24" className="h-5 w-5 shrink-0 overflow-visible" aria-hidden="true">
      <WeatherMarkerIcon kind={kind} fill={fill} stroke="#e5e7eb" selected={false} small />
    </svg>
  );
}

function ChsLegendIcon() {
  return (
    <svg viewBox="-12 -12 24 24" className="h-5 w-5 shrink-0 overflow-visible" aria-hidden="true">
      <polygon points={NAUTICAL_STAR_POINTS} fill={CHS_STAR_COLOR} stroke="#e5e7eb" strokeWidth={0.8} />
    </svg>
  );
}

function PnlDot({ className }: { className: string }) {
  return <span className={`inline-block h-2.5 w-2.5 rounded-full align-middle ${className}`} />;
}

function useIsMobile(breakpoint = 640): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() =>
    typeof window === "undefined" ? false : window.innerWidth < breakpoint
  );
  useEffect(() => {
    function onResize() {
      setIsMobile(window.innerWidth < breakpoint);
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [breakpoint]);
  return isMobile;
}

function WeatherMapLegend({ fullscreen }: { fullscreen: boolean }) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);

  if (isMobile && !fullscreen) {
    return (
      <div className="absolute bottom-2 left-2 z-10">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded border border-term-line bg-[#080d12]/92 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-term-text shadow-lg backdrop-blur"
        >
          {open ? "Hide Key" : "Map Key"}
        </button>
        {open && (
          <div className="mt-1 max-w-[calc(100vw-32px)] rounded border border-term-line bg-[#080d12]/95 p-2 text-[10px] text-term-dim shadow-xl backdrop-blur">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              {LEGEND_ITEMS.map((item) => (
                <span key={item.kind} className="inline-flex items-center gap-1.5 whitespace-nowrap">
                  <LegendIcon kind={item.kind} />
                  {item.label}
                </span>
              ))}
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <ChsLegendIcon />
                CHS home
              </span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-term-line/70 pt-1.5">
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <PnlDot className="bg-term-greenBright" />profit
              </span>
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <PnlDot className="bg-term-red" />loss
              </span>
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <PnlDot className="bg-gray-500" />flat
              </span>
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <PnlDot className="bg-term-cyan" />no pos
              </span>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={`absolute bottom-2 left-2 z-10 rounded border border-term-line bg-[#080d12]/92 text-[10px] text-term-dim shadow-xl shadow-black/30 backdrop-blur ${
        fullscreen ? "max-w-[680px] p-3" : "max-w-[min(560px,calc(100%-16px))] p-2"
      }`}
    >
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <div className="font-semibold uppercase tracking-[0.12em] text-term-text">Map Key</div>
        <div className="hidden tabular-nums text-term-dim sm:block">hover for live station details</div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {LEGEND_ITEMS.map((item) => (
          <span key={item.kind} className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <LegendIcon kind={item.kind} />
            {item.label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <ChsLegendIcon />
          CHS home
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-term-line/70 pt-1.5">
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <PnlDot className="bg-term-greenBright shadow-[0_0_10px_rgba(86,211,100,0.65)]" />
          profit flash
        </span>
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <PnlDot className="bg-term-red shadow-[0_0_10px_rgba(248,81,73,0.65)]" />
          loss flash
        </span>
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <PnlDot className="bg-gray-500" />
          flat
        </span>
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <PnlDot className="bg-term-cyan" />
          no position
        </span>
      </div>
    </div>
  );
}

type Props = {
  positions: Position[];
  locations: WeatherGuidanceLocation[];
  pulseKey: number;
  selectedCity: string | null;
  onSelectCity: (code: string | null) => void;
};

type HoverState = {
  code: string;
  x: number;
  y: number;
};

function fmtTemp(value?: number | null): string {
  return value == null ? "-" : `${Math.round(value)}°F`;
}

function fmtNumber(value?: number | null, suffix = ""): string {
  return value == null ? "-" : `${value}${suffix}`;
}

function fmtTime(value?: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function InfoRow({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3">
      <span className="text-term-dim">{label}</span>
      <span className={`truncate text-right tabular-nums ${tone || "text-term-text"}`}>{value}</span>
    </div>
  );
}

function CityTooltipBody({
  state,
  location,
  fullscreen,
}: {
  state: CityState;
  location?: WeatherGuidanceLocation;
  fullscreen: boolean;
}) {
  const pnlTone = state.totalPnl >= 0 ? "text-term-greenBright" : "text-term-red";
  const pos = state.positions.slice(0, fullscreen ? 8 : 4);
  const hiddenPositions = state.positions.length - pos.length;

  return (
    <>
      <div className="mb-2 flex items-start justify-between gap-3 border-b border-term-line/70 pb-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-term-text">{state.city.name}</div>
          <div className="text-[10px] text-term-dim">
            {state.city.code} · {state.city.lat.toFixed(4)}, {state.city.lng.toFixed(4)}
          </div>
        </div>
        <div className={`shrink-0 text-right font-semibold tabular-nums ${pnlTone}`}>
          {state.positions.length ? fmtUsd(state.totalPnl, true) : "idle"}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        <InfoRow label="Current" value={fmtTemp(location?.latest_temp_f)} />
        <InfoRow label="Condition" value={location?.condition || "-"} />
        <InfoRow label="High / low" value={`${fmtTemp(location?.high_so_far_f)} / ${fmtTemp(location?.low_so_far_f)}`} />
        <InfoRow label="Projected" value={`${fmtTemp(location?.projected_high_f)} / ${fmtTemp(location?.projected_low_f)}`} />
        <InfoRow label="Forecast" value={`${fmtTemp(location?.forecast_high_f)} / ${fmtTemp(location?.forecast_low_f)}`} />
        <InfoRow label="Humidity" value={fmtNumber(location?.humidity_pct, "%")} />
        <InfoRow label="Wind" value={location?.wind_mph == null ? "-" : `${location.wind_mph} mph`} />
        <InfoRow label="Observed" value={fmtTime(location?.latest_observation_time)} />
        <InfoRow label="Station" value={location?.station_id || state.city.stationId || "CLI only"} />
        <InfoRow label="Timezone" value={location?.timezone || state.city.timezone || "-"} />
        <InfoRow label="Positions" value={String(state.positions.length)} />
        <InfoRow label="Exposure" value={fmtUsd(state.exposure)} />
      </div>

      {location?.station_name && (
        <div className="mt-2 truncate border-t border-term-line/70 pt-2 text-[10px] text-term-dim">
          {location.station_name}
        </div>
      )}

      {pos.length > 0 && (
        <div className="mt-2 border-t border-term-line/70 pt-2">
          <div className="mb-1 text-[10px] uppercase tracking-[0.12em] text-term-dim">Held Markets</div>
          <div className="space-y-1">
            {pos.map((p) => {
              const pnl = p.unrealized_pnl_cents + p.realized_pnl_cents;
              return (
                <div key={p.ticker} className="grid grid-cols-[auto_1fr_auto] items-center gap-2 tabular-nums">
                  <span className="text-term-cyan">{eventKindFromSeries(seriesFromTicker(p.ticker))}</span>
                  <span className="truncate text-term-text">{p.ticker}</span>
                  <span className={pnl >= 0 ? "text-term-greenBright" : "text-term-red"}>{fmtUsd(pnl, true)}</span>
                </div>
              );
            })}
            {hiddenPositions > 0 && <div className="text-term-dim">+{hiddenPositions} more</div>}
          </div>
        </div>
      )}

      {location?.error && <div className="mt-2 border-t border-term-line/70 pt-2 text-[10px] text-term-amber">{location.error}</div>}
    </>
  );
}

function CityTooltip({
  state,
  location,
  x,
  y,
  fullscreen,
  containerWidth,
  containerHeight,
}: {
  state: CityState;
  location?: WeatherGuidanceLocation;
  x: number;
  y: number;
  fullscreen: boolean;
  containerWidth: number;
  containerHeight: number;
}) {
  // Flip relative to container size, not absolute pixels.
  const flipX = containerWidth > 0 && x > containerWidth * 0.55;
  const flipY = containerHeight > 0 && y > containerHeight * 0.55;
  return (
    <div
      className="pointer-events-none absolute z-20 w-[min(360px,calc(100%-24px))] rounded border border-term-line bg-[#080d12]/95 p-3 text-[11px] shadow-2xl shadow-black/50 backdrop-blur"
      style={{
        left: x,
        top: y,
        transform: `translate(${flipX ? "-100%" : "12px"}, ${flipY ? "-100%" : "12px"})`,
      }}
    >
      <CityTooltipBody state={state} location={location} fullscreen={fullscreen} />
    </div>
  );
}

function CitySheet({
  state,
  location,
  fullscreen,
  onClose,
}: {
  state: CityState;
  location?: WeatherGuidanceLocation;
  fullscreen: boolean;
  onClose: () => void;
}) {
  return (
    <div className="absolute inset-x-2 bottom-2 z-30 max-h-[70%] overflow-y-auto rounded border border-term-line bg-[#080d12]/97 p-3 text-[12px] shadow-2xl shadow-black/60 backdrop-blur">
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-2 top-2 rounded border border-term-line bg-term-panel/90 px-2 py-0.5 text-[11px] text-term-dim hover:text-term-text"
      >
        ×
      </button>
      <CityTooltipBody state={state} location={location} fullscreen={fullscreen} />
    </div>
  );
}

function MapCanvas({
  states,
  locationsByCode,
  pulseKey,
  selectedCity,
  onSelectCity,
  fullscreen,
  onOpenFullscreen,
  onCloseFullscreen,
}: {
  states: CityState[];
  locationsByCode: Map<string, WeatherGuidanceLocation>;
  pulseKey: number;
  selectedCity: string | null;
  onSelectCity: (code: string | null) => void;
  fullscreen: boolean;
  onOpenFullscreen?: () => void;
  onCloseFullscreen?: () => void;
}) {
  const [hover, setHover] = useState<HoverState | null>(null);
  const [containerSize, setContainerSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [windyCity, setWindyCity] = useState<WeatherCity | null>(null);
  const [preloadCity, setPreloadCity] = useState<WeatherCity | null>(null);
  const isMobile = useIsMobile();
  const hoveredState = hover ? states.find((state) => state.city.code === hover.code) : null;
  const selectedState = selectedCity ? states.find((state) => state.city.code === selectedCity) : null;
  // On mobile, the bottom sheet is driven by the persistent selectedCity (tap to open),
  // not by the transient hover state.
  const sheetState = isMobile ? selectedState : null;

  function moveHover(code: string, event: MouseEvent<SVGGElement>) {
    if (isMobile) return; // suppress floating tooltip on touch devices
    const svg = event.currentTarget.ownerSVGElement;
    const rect = svg?.getBoundingClientRect();
    if (!rect) return;
    setContainerSize({ w: rect.width, h: rect.height });
    setHover({
      code,
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
    const city = states.find((state) => state.city.code === code)?.city;
    if (city) setPreloadCity(city);
  }

  return (
    <div className={`relative w-full ${fullscreen ? "h-full min-h-0" : ""}`} style={fullscreen ? undefined : { aspectRatio: "16 / 9" }}>
      <button
        type="button"
        onClick={fullscreen ? onCloseFullscreen : onOpenFullscreen}
        className="absolute right-2 top-2 z-10 rounded border border-term-line bg-term-panel/90 px-2 py-1 text-[10px] text-term-text shadow-lg hover:border-term-cyan hover:text-term-cyan"
        title={fullscreen ? "Close fullscreen map" : "Expand map fullscreen"}
      >
        {fullscreen ? "CLOSE" : "FULLSCREEN"}
      </button>
      <ComposableMap
        projection="geoAlbersUsa"
        projectionConfig={{ scale: fullscreen ? 1200 : 1000 }}
        style={{ width: "100%", height: "100%", backgroundColor: "#0b1226" }}
      >
        <Geographies geography={US_TOPO}>
          {({ geographies }) =>
            geographies.map((geo) => (
              <Geography
                key={geo.rsmKey}
                geography={geo}
                style={{
                  default: { fill: "#0f1419", stroke: "#4a5a73", strokeWidth: 0.7, outline: "none" },
                  hover:   { fill: "#151c24", stroke: "#6b7d96", strokeWidth: 0.7, outline: "none" },
                  pressed: { fill: "#151c24", stroke: "#6b7d96", strokeWidth: 0.7, outline: "none" },
                }}
              />
            ))
          }
        </Geographies>

        {states.map((state) => {
          const { city, positions: pos, stale, tone, markerKind } = state;
          const pnlColor = TONE_COLOR[tone];
          const iconColor = markerKind === "none" ? TONE_COLOR.idle : KIND_COLOR[markerKind];
          const isHeld = pos.length > 0 && !stale;
          const isSelected = selectedCity === city.code;
          const isCharleston = city.code === "CHS";
          const strokeColor = isSelected ? "#e5e7eb" : isHeld ? pnlColor : "#0b0f13";
          return (
            <Marker
              key={city.code}
              coordinates={[city.lng, city.lat]}
              onClick={() => {
                if (windyCity?.code === city.code) {
                  setWindyCity(null);
                  onSelectCity(null);
                } else {
                  setWindyCity(city);
                  onSelectCity(city.code);
                }
              }}
              onMouseEnter={(event) => moveHover(city.code, event)}
              onMouseMove={(event) => moveHover(city.code, event)}
              onMouseLeave={() => setHover(null)}
              style={{
                default: { cursor: "pointer" },
                hover:   { cursor: "pointer" },
                pressed: { cursor: "pointer" },
              }}
            >
              {isHeld && (
                <circle
                  r={isCharleston ? 11 : 10}
                  fill="none"
                  stroke={pnlColor}
                  strokeWidth={1.8}
                  opacity={0.8}
                  style={{ animation: "cityBreathe 3.4s ease-in-out infinite", transformOrigin: "center", transformBox: "fill-box" }}
                />
              )}
              {isCharleston ? (
                <>
                  <polygon
                    points={NAUTICAL_STAR_POINTS}
                    fill={CHS_STAR_COLOR}
                    stroke={strokeColor}
                    strokeWidth={isSelected ? 1.1 : 0.7}
                    opacity={1}
                    transform={isSelected ? "scale(1.25)" : "scale(1)"}
                  />
                  {isHeld && (
                    <g transform="translate(9, -7)">
                      <WeatherMarkerIcon
                        kind={markerKind}
                        fill={iconColor}
                        stroke={pnlColor}
                        selected={false}
                        small
                      />
                    </g>
                  )}
                </>
              ) : (
                <WeatherMarkerIcon
                  kind={markerKind}
                  fill={iconColor}
                  stroke={strokeColor}
                  selected={isSelected}
                />
              )}
              <text
                x={0}
                y={isCharleston ? -11 : -8}
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

      {!isMobile && hover && hoveredState && (
        <CityTooltip
          state={hoveredState}
          location={locationsByCode.get(hoveredState.city.code)}
          x={hover.x}
          y={hover.y}
          fullscreen={fullscreen}
          containerWidth={containerSize.w}
          containerHeight={containerSize.h}
        />
      )}

      {isMobile && sheetState && (
        <CitySheet
          state={sheetState}
          location={locationsByCode.get(sheetState.city.code)}
          fullscreen={fullscreen}
          onClose={() => onSelectCity(null)}
        />
      )}

      <WindyPreconnect />
      <WindyPreload city={preloadCity && (!windyCity || windyCity.code !== preloadCity.code) ? preloadCity : null} />
      {windyCity && (() => {
        const popupState = states.find((s) => s.city.code === windyCity.code);
        if (!popupState) return null;
        return (
          <WindyCityPopup
            city={windyCity}
            leftPane={
              <CityTooltipBody
                state={popupState}
                location={locationsByCode.get(windyCity.code)}
                fullscreen
              />
            }
            onClose={() => {
              setWindyCity(null);
              onSelectCity(null);
            }}
          />
        );
      })()}

      <WeatherMapLegend fullscreen={fullscreen} />

      <style>{`
        @keyframes cityBreathe {
          0%, 100% { r: 6;  opacity: 0.35; stroke-width: 1.2; }
          50%      { r: 14; opacity: 0.85; stroke-width: 2.0; }
        }
      `}</style>
    </div>
  );
}

export function WeatherMap({ positions, locations, pulseKey, selectedCity, onSelectCity }: Props) {
  const [fullscreen, setFullscreen] = useState(false);
  const states = useMemo(() => computeCityStates(positions), [positions]);
  const locationsByCode = useMemo(() => new Map(locations.map((location) => [location.code, location])), [locations]);

  useEffect(() => {
    if (!fullscreen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setFullscreen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [fullscreen]);

  return (
    <>
      <MapCanvas
        states={states}
        locationsByCode={locationsByCode}
        pulseKey={pulseKey}
        selectedCity={selectedCity}
        onSelectCity={onSelectCity}
        fullscreen={false}
        onOpenFullscreen={() => setFullscreen(true)}
      />

      {fullscreen &&
        createPortal(
          <div className="fixed inset-0 z-[1000] flex flex-col bg-[#05080b] p-3">
            <div className="mb-2 flex items-center justify-between gap-3 border-b border-term-line pb-2">
              <div>
                <div className="text-sm font-semibold text-term-text">US Weather Map</div>
                <div className="text-[10px] text-term-dim">Hover cities for station, position, and live weather detail. Escape closes fullscreen.</div>
              </div>
            </div>
            <div className="min-h-0 flex-1">
              <MapCanvas
                states={states}
                locationsByCode={locationsByCode}
                pulseKey={pulseKey}
                selectedCity={selectedCity}
                onSelectCity={onSelectCity}
                fullscreen
                onCloseFullscreen={() => setFullscreen(false)}
              />
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
