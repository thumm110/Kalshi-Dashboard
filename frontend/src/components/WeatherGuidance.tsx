import { cityForTicker, eventKindFromSeries, seriesFromTicker } from "../lib/cities";
import type { Position, WeatherGuidanceLocation } from "../lib/api";

function fmtTemp(value?: number | null): string {
  return value === null || value === undefined ? "—" : `${Math.round(value)}°`;
}

function fmtPct(value?: number | null): string {
  return value === null || value === undefined ? "—" : `${Math.round(value * 100)}%`;
}

function fmtTime(value?: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function strikeLabel(position: Position): string {
  const floor = position.floor_strike;
  const cap = position.cap_strike;
  if (floor !== null && floor !== undefined && cap !== null && cap !== undefined) return `${floor}–${cap}°`;
  if (floor !== null && floor !== undefined) return `>= ${floor}°`;
  if (cap !== null && cap !== undefined) return `<= ${cap}°`;
  return "—";
}

function projectedValue(position: Position, location?: WeatherGuidanceLocation): number | null {
  if (!location) return null;
  const kind = eventKindFromSeries(seriesFromTicker(position.ticker));
  if (kind === "LOW") {
    return location.projected_low_f ?? location.forecast_low_f ?? location.low_so_far_f ?? null;
  }
  if (kind === "HIGH") {
    return location.projected_high_f ?? location.forecast_high_f ?? location.high_so_far_f ?? null;
  }
  return location.forecast_temp_f ?? location.latest_temp_f ?? null;
}

function logistic(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function modelProbability(position: Position, location?: WeatherGuidanceLocation): number | null {
  const projected = projectedValue(position, location);
  if (projected === null || projected === undefined || !location) return null;

  const kind = eventKindFromSeries(seriesFromTicker(position.ticker));
  const floor = position.floor_strike;
  const cap = position.cap_strike;
  const hours = location.forecast_period_count ?? 0;
  const sigma = Math.max(2.5, Math.min(7, 2.5 + hours * 0.15));

  if (kind === "HIGH" && floor !== null && floor !== undefined && location.high_so_far_f !== null && location.high_so_far_f !== undefined && location.high_so_far_f >= floor) {
    return 0.99;
  }
  if (kind === "LOW" && cap !== null && cap !== undefined && location.low_so_far_f !== null && location.low_so_far_f !== undefined && location.low_so_far_f <= cap) {
    return 0.99;
  }

  if (floor !== null && floor !== undefined && cap !== null && cap !== undefined) {
    const aboveFloor = logistic((projected - floor) / sigma);
    const belowCap = logistic((cap - projected) / sigma);
    return Math.max(0.01, Math.min(0.99, aboveFloor * belowCap));
  }
  if (floor !== null && floor !== undefined) {
    return Math.max(0.01, Math.min(0.99, logistic((projected - floor) / sigma)));
  }
  if (cap !== null && cap !== undefined) {
    return Math.max(0.01, Math.min(0.99, logistic((cap - projected) / sigma)));
  }
  return null;
}

function signal(position: Position, location?: WeatherGuidanceLocation): { text: string; tone: string } {
  if (!location || location.error) return { text: "no live signal", tone: "text-term-dim" };

  const kind = eventKindFromSeries(seriesFromTicker(position.ticker));
  const observed = kind === "LOW" ? location.low_so_far_f : kind === "HIGH" ? location.high_so_far_f : location.latest_temp_f;
  const projected = projectedValue(position, location);
  if (observed === null || observed === undefined) return { text: "waiting", tone: "text-term-dim" };

  const floor = position.floor_strike;
  const cap = position.cap_strike;
  const guidanceValue = projected ?? observed;
  if (floor !== null && floor !== undefined && cap !== null && cap !== undefined) {
    if (observed >= floor && observed <= cap) return { text: "inside range", tone: "text-term-greenBright" };
    if (guidanceValue < floor) return { text: `needs +${Math.ceil(floor - guidanceValue)}°`, tone: "text-term-cyan" };
    return { text: `${Math.ceil(guidanceValue - cap)}° over cap`, tone: "text-term-red" };
  }

  if (floor !== null && floor !== undefined) {
    if (observed >= floor) return { text: "threshold met", tone: "text-term-greenBright" };
    return { text: `needs +${Math.ceil(floor - guidanceValue)}°`, tone: "text-term-cyan" };
  }

  if (cap !== null && cap !== undefined) {
    if (observed <= cap) return { text: "threshold met", tone: "text-term-greenBright" };
    return { text: `${Math.ceil(guidanceValue - cap)}° above`, tone: "text-term-red" };
  }

  return { text: `${fmtTemp(observed)} observed`, tone: "text-term-text" };
}

type Props = {
  positions: Position[];
  locations: WeatherGuidanceLocation[];
  loading?: boolean;
  error?: string | null;
};

export function WeatherGuidance({ positions, locations, loading = false, error = null }: Props) {
  const byCode = new Map(locations.map((location) => [location.code, location]));
  const rows = positions
    .map((position) => {
      const city = cityForTicker(position.ticker);
      return city ? { position, city, location: byCode.get(city.code) } : null;
    })
    .filter(Boolean) as { position: Position; city: NonNullable<ReturnType<typeof cityForTicker>>; location?: WeatherGuidanceLocation }[];

  return (
    <div className="overflow-x-auto max-h-[300px] overflow-y-auto">
      <table className="w-full text-[12px] tabular-nums">
        <thead className="sticky top-0 bg-term-panel">
          <tr>
            <th className="text-left font-bold text-[10px] tracking-[0.15em] uppercase text-term-dim py-1 px-2 border-b border-term-line">Market</th>
            <th className="text-left font-bold text-[10px] tracking-[0.15em] uppercase text-term-dim py-1 px-2 border-b border-term-line">Station</th>
            <th className="text-right font-bold text-[10px] tracking-[0.15em] uppercase text-term-dim py-1 px-2 border-b border-term-line">Now</th>
            <th className="text-right font-bold text-[10px] tracking-[0.15em] uppercase text-term-dim py-1 px-2 border-b border-term-line">High</th>
            <th className="text-right font-bold text-[10px] tracking-[0.15em] uppercase text-term-dim py-1 px-2 border-b border-term-line">Low</th>
            <th className="text-right font-bold text-[10px] tracking-[0.15em] uppercase text-term-dim py-1 px-2 border-b border-term-line">Proj</th>
            <th className="text-right font-bold text-[10px] tracking-[0.15em] uppercase text-term-dim py-1 px-2 border-b border-term-line">Model</th>
            <th className="text-right font-bold text-[10px] tracking-[0.15em] uppercase text-term-dim py-1 px-2 border-b border-term-line">Strike</th>
            <th className="text-left font-bold text-[10px] tracking-[0.15em] uppercase text-term-dim py-1 px-2 border-b border-term-line">Signal</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={9} className="text-center text-term-dim py-6">
                {loading ? "loading weather guidance" : error || "no mapped weather positions"}
              </td>
            </tr>
          )}
          {rows.map(({ position, city, location }) => {
            const s = signal(position, location);
            const station = location?.station_id || city.stationId || location?.climate_station || city.climateStation || "—";
            const projected = projectedValue(position, location);
            const probability = modelProbability(position, location);
            return (
              <tr key={position.ticker} className="border-b border-term-line/40 hover:bg-term-line/40">
                <td className="py-1 px-2 text-term-text">
                  <div className="font-medium truncate max-w-[260px]">{position.ticker}</div>
                  <div className="text-[10px] text-term-dim">{city.name} · {eventKindFromSeries(seriesFromTicker(position.ticker))}</div>
                </td>
                <td className="py-1 px-2 text-term-cyan">
                  <a href={location?.climate_report_url || city.climateReportUrl} target="_blank" rel="noreferrer" className="hover:underline">
                    {station}
                  </a>
                  <div className="text-[10px] text-term-dim">{fmtTime(location?.latest_observation_time)}</div>
                </td>
                <td className="py-1 px-2 text-right text-term-text">{fmtTemp(location?.latest_temp_f)}</td>
                <td className="py-1 px-2 text-right text-term-greenBright">{fmtTemp(location?.high_so_far_f)}</td>
                <td className="py-1 px-2 text-right text-term-red">{fmtTemp(location?.low_so_far_f)}</td>
                <td className="py-1 px-2 text-right text-term-cyan">{fmtTemp(projected)}</td>
                <td className="py-1 px-2 text-right text-term-text">{fmtPct(probability)}</td>
                <td className="py-1 px-2 text-right text-term-text">{strikeLabel(position)}</td>
                <td className={`py-1 px-2 ${s.tone}`}>
                  {s.text}
                  {(location?.error || location?.forecast_error) && (
                    <div className="text-[10px] text-term-dim truncate max-w-[220px]">
                      {location.error || location.forecast_error}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
