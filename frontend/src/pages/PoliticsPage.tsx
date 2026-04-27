import { useEffect, useMemo, useState } from "react";
import { CategoryPnlPanel } from "../components/CategoryPnlPanel";
import { CongressControl } from "../components/CongressControl";
import { KpiCard, Panel } from "../components/KpiCard";
import { NewsFeed } from "../components/NewsFeed";
import { PartyPanel } from "../components/PartyPanel";
import { PoliticsMovers } from "../components/PoliticsMovers";
import { PositionsTable } from "../components/PositionsTable";
import {
  api,
  fmtCents,
  fmtUsd,
  type PoliticsGroup,
  type PoliticsNewsItem,
  type Position,
} from "../lib/api";

type Props = { positions: Position[] };

const MARKETS_POLL_MS = 20000;
const NEWS_POLL_MS = 60000;

export function PoliticsPage({ positions }: Props) {
  const [groups, setGroups] = useState<PoliticsGroup[]>([]);
  const [groupsError, setGroupsError] = useState<string | null>(null);
  const [news, setNews] = useState<PoliticsNewsItem[]>([]);
  const [newsSources, setNewsSources] = useState<
    { id: string; name: string; item_count: number; ok: boolean }[]
  >([]);
  const [newsError, setNewsError] = useState<string | null>(null);
  const [newsLoading, setNewsLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const data = await api.politicsMarkets();
        if (!alive) return;
        setGroups(data.groups);
        setGroupsError(null);
      } catch (err) {
        if (!alive) return;
        setGroupsError(err instanceof Error ? err.message : "markets failed");
      }
    }
    load();
    const id = window.setInterval(load, MARKETS_POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    async function load() {
      setNewsLoading(true);
      try {
        const data = await api.politicsNews(40);
        if (!alive) return;
        setNews(data.items);
        setNewsSources(data.sources);
        setNewsError(null);
      } catch (err) {
        if (!alive) return;
        setNewsError(err instanceof Error ? err.message : "news failed");
      } finally {
        if (alive) setNewsLoading(false);
      }
    }
    load();
    const id = window.setInterval(load, NEWS_POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  const politicsPositions = useMemo(
    () => positions.filter((p) => p.category === "Politics"),
    [positions]
  );
  const totalPnl = politicsPositions.reduce(
    (a, p) => a + p.unrealized_pnl_cents + p.realized_pnl_cents,
    0
  );
  const totalExposure = politicsPositions.reduce((a, p) => a + p.market_exposure_cents, 0);

  const byId = useMemo(() => {
    const m: Record<string, PoliticsGroup> = {};
    for (const g of groups) m[g.id] = g;
    return m;
  }, [groups]);

  const dem = byId["2028_dem_nominee"];
  const gop = byId["2028_gop_nominee"];
  const senate = byId["senate_2026"];
  const house = byId["house_2026"];
  const approval = byId["potus_approval"];
  const shutdown = byId["shutdown_2026"];

  const senateDemMkt = senate?.markets.find((m) => (m.title || "").toLowerCase().includes("democrat"));
  const houseDemMkt = house?.markets.find((m) => (m.title || "").toLowerCase().includes("democrat"));

  return (
    <main className="p-3 grid grid-cols-12 gap-3">
      <div className="col-span-12">
        <CategoryPnlPanel category="Politics" />
      </div>
      <div className="col-span-12 grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="Politics PnL"
          value={fmtUsd(totalPnl, true)}
          tone={totalPnl >= 0 ? "pos" : "neg"}
          sub={`${politicsPositions.length} position${politicsPositions.length === 1 ? "" : "s"}`}
        />
        <KpiCard
          label="Exposure"
          value={fmtUsd(totalExposure)}
          tone="info"
          sub={`${groups.filter((g) => g.markets.length).length}/${groups.length} groups live`}
        />
        <KpiCard
          label="Dems Win Senate '26"
          value={senateDemMkt?.mid_cents ? fmtCents(senateDemMkt.mid_cents) : "—"}
          tone="info"
          sub="implied probability"
        />
        <KpiCard
          label="Dems Win House '26"
          value={houseDemMkt?.mid_cents ? fmtCents(houseDemMkt.mid_cents) : "—"}
          tone="info"
          sub="implied probability"
        />
      </div>

      {groupsError && (
        <div className="col-span-12 text-term-red text-xs">markets error: {groupsError}</div>
      )}

      {/* User positions — moved up top */}
      <div className="col-span-12">
        <Panel
          title="Your Politics Positions"
          right={
            <span className="text-[10px] text-term-dim">
              {politicsPositions.length} row{politicsPositions.length === 1 ? "" : "s"}
            </span>
          }
        >
          {politicsPositions.length === 0 ? (
            <div className="text-term-dim text-xs p-3">no open politics positions</div>
          ) : (
            <PositionsTable positions={politicsPositions} />
          )}
        </Panel>
      </div>

      {/* Donkey vs Elephant */}
      <div className="col-span-12 lg:col-span-8 grid grid-cols-1 md:grid-cols-2 gap-3">
        <PartyPanel group={dem} party="D" />
        <PartyPanel group={gop} party="R" />
      </div>

      {/* News feed */}
      <div className="col-span-12 lg:col-span-4">
        <Panel
          title="Live Politics News"
          right={
            <span className="text-[10px] text-term-dim">{news.length} headlines</span>
          }
        >
          <NewsFeed items={news} sources={newsSources} loading={newsLoading} error={newsError} />
        </Panel>
      </div>

      {/* Congress + approval + shutdown */}
      <div className="col-span-12 lg:col-span-8 grid grid-cols-1 md:grid-cols-2 gap-3">
        <CongressControl group={senate} title="Senate Control after 2026" />
        <CongressControl group={house} title="House Control after 2026" />
        <Panel title={approval?.label || "Presidential Approval"}>
          {approval?.markets.length ? (
            <div className="space-y-1">
              {approval.markets.slice(0, 6).map((m) => (
                <div key={m.ticker} className="flex justify-between text-xs tabular-nums">
                  <span className="text-term-text truncate">{m.title || m.ticker}</span>
                  <span className="text-term-cyan">{m.mid_cents ? fmtCents(m.mid_cents) : "—"}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-term-dim text-xs">event not live</div>
          )}
        </Panel>
        <Panel title={shutdown?.label || "Government Shutdown"}>
          {shutdown?.markets.length ? (
            <div className="space-y-1">
              {shutdown.markets.slice(0, 6).map((m) => (
                <div key={m.ticker} className="flex justify-between text-xs tabular-nums">
                  <span className="text-term-text truncate">{m.title || m.ticker}</span>
                  <span className="text-term-amber">{m.mid_cents ? fmtCents(m.mid_cents) : "—"}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-term-dim text-xs">event not live</div>
          )}
        </Panel>
      </div>

      {/* Biggest movers */}
      <div className="col-span-12 lg:col-span-4">
        <Panel
          title="Biggest 24h Movers"
          right={<span className="text-[10px] text-term-dim">across featured</span>}
        >
          <PoliticsMovers groups={groups} />
        </Panel>
      </div>

      {/* Registry status — helps identify which event_tickers need fixing */}
      <div className="col-span-12">
        <Panel
          title="Featured Registry Status"
          right={
            <span className="text-[10px] text-term-dim">
              {groups.filter((g) => g.markets.length > 0).length}/{groups.length} live
            </span>
          }
        >
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-1 text-[11px]">
            {groups.map((g) => {
              const live = g.markets.length > 0;
              return (
                <div
                  key={g.id}
                  className={`flex items-center justify-between px-2 py-1 rounded ${
                    live ? "bg-term-line/30" : "bg-term-red/10"
                  }`}
                >
                  <span className="text-term-text truncate">{g.label}</span>
                  <span className="text-term-dim tabular-nums ml-2 shrink-0">
                    <code>{g.event_ticker}</code>{" "}
                    {live ? (
                      <span className="text-term-greenBright">✓ {g.markets.length}</span>
                    ) : (
                      <span className="text-term-red">✗</span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </Panel>
      </div>

    </main>
  );
}
