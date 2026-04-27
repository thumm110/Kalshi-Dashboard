import { useEffect, useMemo, useState } from "react";
import { BotEdgeTable } from "../components/BotEdgeTable";
import { CategoryPnlPanel } from "../components/CategoryPnlPanel";
import { KpiCard, Panel } from "../components/KpiCard";
import { PositionsTable } from "../components/PositionsTable";
import { ReleaseTimeline } from "../components/ReleaseTimeline";
import { api, fmtUsd, type BotSignal, type Position } from "../lib/api";
import { countdown, groupByEvent, MACRO_KIND_LABEL, type MacroKind } from "../lib/macro";

type Props = {
  positions: Position[];
};

export function EconomicsPage({ positions }: Props) {
  const [selectedEvent, setSelectedEvent] = useState<string | null>(null);
  const [botSignals, setBotSignals] = useState<BotSignal[]>([]);
  const [botError, setBotError] = useState<string | null>(null);
  const [botLoading, setBotLoading] = useState(false);

  const events = useMemo(() => groupByEvent(positions), [positions]);
  const positionTickers = useMemo(
    () => [...new Set(positions.map((p) => p.ticker))].sort(),
    [positions]
  );
  const positionKey = positionTickers.join(",");

  useEffect(() => {
    let alive = true;

    async function load() {
      if (positionTickers.length === 0) {
        setBotSignals([]);
        setBotLoading(false);
        return;
      }
      setBotLoading(true);
      try {
        const data = await api.botSignals(positionTickers);
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
  }, [positionKey]);

  const totalPnl = positions.reduce(
    (a, p) => a + p.unrealized_pnl_cents + p.realized_pnl_cents,
    0
  );
  const totalExposure = positions.reduce((a, p) => a + p.market_exposure_cents, 0);

  const nextEvent = events.find(
    (e) => e.expirationTs != null && e.expirationTs * 1000 > Date.now()
  );

  const byKind = useMemo(() => {
    const buckets: Record<string, { count: number; pnl: number }> = {};
    for (const e of events) {
      const key = MACRO_KIND_LABEL[e.kind as MacroKind];
      if (!buckets[key]) buckets[key] = { count: 0, pnl: 0 };
      buckets[key].count += e.positions.length;
      buckets[key].pnl += e.totalPnl;
    }
    return Object.entries(buckets).sort((a, b) => b[1].count - a[1].count);
  }, [events]);

  const filteredPositions = useMemo(() => {
    if (!selectedEvent) return positions;
    return positions.filter((p) => {
      const parts = p.ticker.split("-");
      return parts.slice(0, 2).join("-") === selectedEvent;
    });
  }, [positions, selectedEvent]);

  const selectedLabel = selectedEvent
    ? events.find((e) => e.eventTicker === selectedEvent)?.label
    : null;

  return (
    <main className="p-3 grid grid-cols-12 gap-3">
      <div className="col-span-12">
        <CategoryPnlPanel category="Economics" />
      </div>
      <div className="col-span-12 grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="Economics PnL"
          value={fmtUsd(totalPnl, true)}
          tone={totalPnl >= 0 ? "pos" : "neg"}
          sub={`${positions.length} position${positions.length === 1 ? "" : "s"}`}
        />
        <KpiCard
          label="Exposure"
          value={fmtUsd(totalExposure)}
          tone="info"
          sub={`${events.length} event${events.length === 1 ? "" : "s"}`}
        />
        <KpiCard
          label="Next Release"
          value={nextEvent ? countdown(nextEvent.expirationTs) : "—"}
          tone="info"
          sub={nextEvent ? nextEvent.label : "no upcoming"}
        />
        <KpiCard
          label="Selected"
          value={selectedLabel || "—"}
          tone={selectedEvent ? "info" : "neutral"}
          sub={selectedEvent ? "click event again to clear" : "click any release"}
        />
      </div>

      <div className="col-span-12 lg:col-span-8">
        <Panel
          title="Upcoming Releases"
          right={
            <span className="text-[10px] text-term-dim">
              <span className="inline-block w-2 h-2 rounded-full bg-term-greenBright mr-1 align-middle" /> +pnl
              <span className="inline-block w-2 h-2 rounded-full bg-term-red mx-1 ml-2 align-middle" /> -pnl
              <span className="inline-block w-2 h-2 rounded-full bg-gray-500 mx-1 ml-2 align-middle" /> flat
            </span>
          }
        >
          <ReleaseTimeline
            positions={positions}
            selectedEvent={selectedEvent}
            onSelectEvent={setSelectedEvent}
          />
        </Panel>
      </div>

      <div className="col-span-12 lg:col-span-4 self-start flex flex-col gap-3">
        <Panel title="By Macro Series">
          {byKind.length === 0 ? (
            <div className="text-term-dim text-xs">no economics positions</div>
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
        <Panel title="Legend">
          <div className="text-[10px] text-term-dim space-y-1">
            <div>
              <span className="text-term-greenBright">●</span> YES position (filled)
            </div>
            <div>
              <span className="text-term-red">▢</span> NO position (outline)
            </div>
            <div>marker size ∝ contracts held</div>
            <div>x-axis = current market implied probability (yes mid)</div>
          </div>
        </Panel>
      </div>

      <div className="col-span-12">
        <Panel
          title={`Bot Edge${selectedLabel ? " — " + selectedLabel : ""}`}
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
          title={`Economics Positions${selectedLabel ? " — " + selectedLabel : ""}`}
          right={<span className="text-[10px] text-term-dim">{filteredPositions.length} rows</span>}
        >
          <PositionsTable positions={filteredPositions} />
        </Panel>
      </div>
    </main>
  );
}
