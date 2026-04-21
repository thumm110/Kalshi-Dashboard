import { useEffect, useMemo, useState } from "react";
import { Panel, KpiCard } from "../components/KpiCard";
import { PositionsTable } from "../components/PositionsTable";
import { WeatherMap } from "../components/WeatherMap";
import { CityCharts } from "../components/CityCharts";
import { WeatherGuidance } from "../components/WeatherGuidance";
import { BotEdgeTable } from "../components/BotEdgeTable";
import { CITIES, cityForTicker, eventKindFromSeries, seriesFromTicker } from "../lib/cities";
import { api, fmtUsd, type BotSignal, type Position, type WeatherGuidanceLocation } from "../lib/api";

type Props = {
  positions: Position[];
  pulseKey: number;
};

export function WeatherPage({ positions, pulseKey }: Props) {
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  const [guidance, setGuidance] = useState<WeatherGuidanceLocation[]>([]);
  const [guidanceError, setGuidanceError] = useState<string | null>(null);
  const [guidanceLoading, setGuidanceLoading] = useState(false);
  const [botSignals, setBotSignals] = useState<BotSignal[]>([]);
  const [botError, setBotError] = useState<string | null>(null);
  const [botLoading, setBotLoading] = useState(false);

  const weatherPositions = useMemo(
    () => positions.filter((p) => cityForTicker(p.ticker) !== null),
    [positions]
  );

  const guidanceTickers = useMemo(
    () => [...new Set(weatherPositions.map((p) => p.ticker))].sort(),
    [weatherPositions]
  );

  const guidanceKey = guidanceTickers.join(",");

  useEffect(() => {
    let alive = true;

    async function load() {
      setGuidanceLoading(true);
      try {
        const data = await api.weatherGuidance(guidanceTickers);
        if (!alive) return;
        setGuidance(data.locations);
        setGuidanceError(null);
      } catch (err) {
        if (!alive) return;
        setGuidanceError(err instanceof Error ? err.message : "weather guidance failed");
      } finally {
        if (alive) setGuidanceLoading(false);
      }
    }

    load();
    const id = window.setInterval(load, 120000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [guidanceKey]);

  useEffect(() => {
    let alive = true;

    async function load() {
      if (guidanceTickers.length === 0) {
        setBotSignals([]);
        setBotLoading(false);
        return;
      }
      setBotLoading(true);
      try {
        const data = await api.botSignals(guidanceTickers);
        if (!alive) return;
        setBotSignals(data.signals);
        setBotError(null);
      } catch (err) {
        if (!alive) return;
        setBotError(err instanceof Error ? err.message : "bot signals failed");
      } finally {
        if (alive) setBotLoading(false);
      }
    }

    load();
    const id = window.setInterval(load, 60000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [guidanceKey]);

  const filteredPositions = useMemo(() => {
    if (!selectedCity) return weatherPositions;
    return weatherPositions.filter((p) => cityForTicker(p.ticker)?.code === selectedCity);
  }, [weatherPositions, selectedCity]);

  const totalPnl = weatherPositions.reduce((a, p) => a + p.unrealized_pnl_cents + p.realized_pnl_cents, 0);
  const totalExposure = weatherPositions.reduce((a, p) => a + p.market_exposure_cents, 0);
  const cityCount = new Set(weatherPositions.map((p) => cityForTicker(p.ticker)?.code).filter(Boolean)).size;
  const liveCities = CITIES.filter((c) => c.stationId);
  const liveCityCount = liveCities.length;

  const byKind = useMemo(() => {
    const buckets: Record<string, { count: number; pnl: number }> = {};
    for (const p of weatherPositions) {
      const k = eventKindFromSeries(seriesFromTicker(p.ticker));
      if (!buckets[k]) buckets[k] = { count: 0, pnl: 0 };
      buckets[k].count += 1;
      buckets[k].pnl += p.unrealized_pnl_cents + p.realized_pnl_cents;
    }
    return Object.entries(buckets).sort((a, b) => b[1].count - a[1].count);
  }, [weatherPositions]);

  const selected = selectedCity ? CITIES.find((c) => c.code === selectedCity) : null;

  return (
    <main className="p-3 grid grid-cols-12 gap-3">
      <div className="col-span-12 grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="Weather PnL"
          value={fmtUsd(totalPnl, true)}
          tone={totalPnl >= 0 ? "pos" : "neg"}
          sub={`${weatherPositions.length} position${weatherPositions.length === 1 ? "" : "s"}`}
        />
        <KpiCard
          label="Exposure"
          value={fmtUsd(totalExposure)}
          tone="info"
          sub={`${cityCount} city${cityCount === 1 ? "" : "ies"}`}
        />
        <KpiCard
          label="Live Weather"
          value={String(liveCityCount)}
          sub="Apr 2026 temp cities"
        />
        <KpiCard
          label="Selected"
          value={selected ? selected.name : "—"}
          tone={selected ? "info" : "neutral"}
          sub={selected ? "click city again to clear" : "click any dot"}
        />
      </div>

      <div className="col-span-12 lg:col-span-9">
        <Panel
          title="US Weather Map"
          right={
            <span className="text-[10px] text-term-dim">
              <span className="inline-block w-2 h-2 rounded-full bg-term-greenBright mr-1 align-middle" /> +pnl
              <span className="inline-block w-2 h-2 rounded-full bg-term-red mx-1 ml-2 align-middle" /> -pnl
              <span className="inline-block w-2 h-2 rounded-full bg-term-cyan mx-1 ml-2 align-middle" /> idle
              <span className="inline-block w-2 h-2 rounded-full bg-gray-500 mx-1 ml-2 align-middle" /> stale
            </span>
          }
        >
          <WeatherMap
            positions={weatherPositions}
            pulseKey={pulseKey}
            selectedCity={selectedCity}
            onSelectCity={setSelectedCity}
          />
        </Panel>
      </div>

      <div className="col-span-12 lg:col-span-3 self-start flex flex-col gap-3">
        <Panel title="By Event Type">
          {byKind.length === 0 ? (
            <div className="text-term-dim text-xs">no weather positions</div>
          ) : (
            <div className="divide-y divide-term-line">
              {byKind.map(([kind, v]) => (
                <div key={kind} className="flex justify-between py-1.5 text-xs tabular-nums">
                  <span className="text-term-text">{kind}</span>
                  <span className="text-term-dim">{v.count}</span>
                  <span className={v.pnl >= 0 ? "text-term-greenBright" : "text-term-red"}>
                    {fmtUsd(v.pnl, true)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Panel>
        <Panel
          title={selected ? `${selected.name} — 24h Price` : "Held Markets — 24h Price"}
          right={<span className="text-[10px] text-term-dim">yes ¢</span>}
        >
          <CityCharts positions={filteredPositions} hours={24} period={60} />
        </Panel>
        <Panel title="Reporting Locations" right={<span className="text-[10px] text-term-dim">NWS CLI</span>}>
          <div className="max-h-[220px] overflow-y-auto divide-y divide-term-line/50">
            {liveCities.map((city) => (
              <div key={city.code} className="flex items-center justify-between gap-2 py-1 text-[11px] tabular-nums">
                <span className="text-term-text truncate">{city.name}</span>
                <a
                  href={city.climateReportUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-term-cyan hover:underline shrink-0"
                >
                  {city.stationId} / {city.climateStation}
                </a>
              </div>
            ))}
            <div className="flex items-center justify-between gap-2 py-1 text-[11px] tabular-nums">
              <span className="text-term-text truncate">Death Valley</span>
              <span className="text-term-dim shrink-0">CLI only</span>
            </div>
          </div>
        </Panel>
      </div>

      <div className="col-span-12">
        <Panel
          title={`NWS Forecast Model${selected ? " — " + selected.name : ""}`}
          right={
            <span className="text-[10px] text-term-dim">
              {guidanceLoading ? "refreshing" : `${guidance.length} source${guidance.length === 1 ? "" : "s"}`}
            </span>
          }
        >
          <WeatherGuidance
            positions={filteredPositions}
            locations={guidance}
            loading={guidanceLoading}
            error={guidanceError}
          />
          <div className="mt-2 text-[10px] text-term-dim">
            Model uses observed station high/low plus remaining NWS hourly forecast. Settlement remains the final Kalshi rules source linked by station.
          </div>
        </Panel>
      </div>

      <div className="col-span-12">
        <Panel
          title={`Bot Edge${selected ? " — " + selected.name : ""}`}
          right={
            <span className="text-[10px] text-term-dim">
              {botLoading ? "refreshing" : `${botSignals.length} signal${botSignals.length === 1 ? "" : "s"}`}
            </span>
          }
        >
          <BotEdgeTable
            positions={filteredPositions}
            signals={botSignals}
            loading={botLoading}
            error={botError}
          />
        </Panel>
      </div>

      <div className="col-span-12">
        <Panel
          title={`Weather Positions${selected ? " — " + selected.name : ""}`}
          right={<span className="text-[10px] text-term-dim">{filteredPositions.length} rows</span>}
        >
          <PositionsTable positions={filteredPositions} />
        </Panel>
      </div>
    </main>
  );
}
