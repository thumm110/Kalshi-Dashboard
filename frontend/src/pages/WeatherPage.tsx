import { useMemo, useState } from "react";
import { Panel, KpiCard } from "../components/KpiCard";
import { PositionsTable } from "../components/PositionsTable";
import { WeatherMap } from "../components/WeatherMap";
import { CityCharts } from "../components/CityCharts";
import { CITIES, cityForTicker, eventKindFromSeries, seriesFromTicker } from "../lib/cities";
import { fmtUsd, type Position } from "../lib/api";

type Props = {
  positions: Position[];
  pulseKey: number;
};

export function WeatherPage({ positions, pulseKey }: Props) {
  const [selectedCity, setSelectedCity] = useState<string | null>(null);

  const weatherPositions = useMemo(
    () => positions.filter((p) => cityForTicker(p.ticker) !== null),
    [positions]
  );

  const filteredPositions = useMemo(() => {
    if (!selectedCity) return weatherPositions;
    return weatherPositions.filter((p) => cityForTicker(p.ticker)?.code === selectedCity);
  }, [weatherPositions, selectedCity]);

  const totalPnl = weatherPositions.reduce((a, p) => a + p.unrealized_pnl_cents + p.realized_pnl_cents, 0);
  const totalExposure = weatherPositions.reduce((a, p) => a + p.market_exposure_cents, 0);
  const cityCount = new Set(weatherPositions.map((p) => cityForTicker(p.ticker)?.code).filter(Boolean)).size;

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
          label="Tracked Cities"
          value={String(CITIES.length)}
          sub="blue = no holding"
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
