import type { WeatherGuidanceLocation } from "../lib/api";

function fmtTemp(value?: number | null): string {
  return value === null || value === undefined ? "—" : `${Math.round(value)}°`;
}

function fmtTime(value?: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

type Props = {
  locations: WeatherGuidanceLocation[];
  loading?: boolean;
  error?: string | null;
  selectedCity?: string | null;
  onSelectCity?: (code: string | null) => void;
};

export function AllCitiesWeather({ locations, loading = false, error = null, selectedCity = null, onSelectCity }: Props) {
  if (error && locations.length === 0) {
    return <div className="text-term-red text-xs">weather: {error}</div>;
  }
  if (loading && locations.length === 0) {
    return <div className="text-term-dim text-xs">loading weather…</div>;
  }
  if (locations.length === 0) {
    return <div className="text-term-dim text-xs">no weather locations</div>;
  }

  const sorted = [...locations].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
      {sorted.map((loc) => {
        const now = loc.latest_temp_f;
        const high = loc.high_so_far_f;
        const low = loc.low_so_far_f;
        const projHigh = loc.projected_high_f ?? loc.forecast_high_f;
        const projLow = loc.projected_low_f ?? loc.forecast_low_f;
        const isSelected = selectedCity === loc.code;
        const hasError = !!loc.error;
        return (
          <button
            key={loc.code}
            type="button"
            onClick={() => onSelectCity?.(isSelected ? null : loc.code)}
            className={`text-left block border p-2 transition-colors bg-term-panel/40 ${
              isSelected ? "border-term-cyan" : "border-term-line hover:border-term-cyan/60"
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-term-text font-medium tracking-wider">{loc.name}</span>
              <span className="text-[9px] text-term-dim">{loc.station_id || loc.climate_station}</span>
            </div>
            <div className="flex items-baseline justify-between mb-1 tabular-nums">
              <span className="text-xl text-term-text font-bold">{fmtTemp(now)}</span>
              {loc.condition && (
                <span className="text-[9px] text-term-dim truncate ml-2 max-w-[60%]" title={loc.condition}>
                  {loc.condition}
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-x-2 text-[10px] tabular-nums">
              <div className="flex justify-between">
                <span className="text-term-dim">H</span>
                <span className="text-term-greenBright">{fmtTemp(high)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-term-dim">L</span>
                <span className="text-term-red">{fmtTemp(low)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-term-dim">Proj H</span>
                <span className="text-term-cyan">{fmtTemp(projHigh)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-term-dim">Proj L</span>
                <span className="text-term-cyan">{fmtTemp(projLow)}</span>
              </div>
            </div>
            <div className="mt-1 text-[9px] text-term-dim flex justify-between">
              <span>obs {fmtTime(loc.latest_observation_time)}</span>
              {loc.wind_mph !== null && loc.wind_mph !== undefined && <span>{Math.round(loc.wind_mph)} mph</span>}
            </div>
            {hasError && (
              <div className="mt-1 text-[9px] text-term-red truncate" title={loc.error || ""}>
                {loc.error}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
