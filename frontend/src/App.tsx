import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AttentionStrip } from "./components/AttentionStrip";
import { Banner } from "./components/Banner";
import { CategoryBar } from "./components/CategoryBar";
import { CategoryBreakdown } from "./components/CategoryBreakdown";
import { EquityCurve } from "./components/EquityCurve";
import { FillsFeed } from "./components/FillsFeed";
import { Heatmap } from "./components/Heatmap";
import { KpiCard, Panel } from "./components/KpiCard";
import { Login } from "./components/Login";
import { PositionsTable } from "./components/PositionsTable";
import { Scorecard } from "./components/Scorecard";
import { SettlementsPanel } from "./components/SettlementsPanel";
import { TrackRecord } from "./components/TrackRecord";
import { WeatherPage } from "./pages/WeatherPage";
import { EconomicsPage } from "./pages/EconomicsPage";
import { PoliticsPage } from "./pages/PoliticsPage";
import { SportsPage } from "./pages/SportsPage";
import {
  api,
  fmtUsd,
  hasCreds,
  type AttentionResponse,
  type CategoryPnl,
  type EquityPoint,
  type Fill,
  type Position,
  type Risk,
  type Scorecard as ScorecardData,
  type Settlement,
  type Summary,
  type TrackRecord as TrackRecordData,
} from "./lib/api";

const POLL_MS = 4000;
const ANALYTICS_POLL_MS = 15000;
const CATEGORIES = ["All", "Weather", "Crypto", "Sports", "Politics", "Economics", "Entertainment", "Other"];

export function App() {
  const [authed, setAuthed] = useState(hasCreds());
  const [category, setCategory] = useState("All");

  const [summary, setSummary] = useState<Summary | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [fills, setFills] = useState<Fill[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [settlementTotal, setSettlementTotal] = useState(0);
  const [equity, setEquity] = useState<EquityPoint[]>([]);
  const [catPnl, setCatPnl] = useState<CategoryPnl[]>([]);
  const [risk, setRisk] = useState<Risk | null>(null);
  const [scorecard, setScorecard] = useState<ScorecardData | null>(null);
  const [trackRecord, setTrackRecord] = useState<TrackRecordData | null>(null);
  const [attention, setAttention] = useState<AttentionResponse | null>(null);

  const [pulseKey, setPulseKey] = useState(0);
  const [lastPoll, setLastPoll] = useState<number | null>(null);
  const [connected, setConnected] = useState(true);
  const mounted = useRef(true);

  const poll = useCallback(async () => {
    try {
      const [s, p, f, st, e, c, r] = await Promise.all([
        api.summary(),
        api.positions(category),
        api.fills(30),
        api.settlements("today", 30),
        api.equityCurve(),
        api.pnlByCategory(),
        api.risk(),
      ]);
      if (!mounted.current) return;
      setSummary(s);
      setPositions(p.positions);
      setFills(f.fills);
      setSettlements(st.settlements);
      setSettlementTotal(st.total_pnl_cents);
      setEquity(e.points);
      setCatPnl(c.categories);
      setRisk(r);
      setConnected(true);
      setLastPoll(Date.now());
      setPulseKey((k) => k + 1);
    } catch (err) {
      if (!mounted.current) return;
      setConnected(false);
      console.warn("poll failed", err);
    }
  }, [category]);

  const pollAnalytics = useCallback(async () => {
    try {
      const [sc, tr, at] = await Promise.all([api.scorecard(), api.trackRecord(), api.attention()]);
      if (!mounted.current) return;
      setScorecard(sc);
      setTrackRecord(tr);
      setAttention(at);
    } catch (err) {
      if (!mounted.current) return;
      console.warn("analytics poll failed", err);
    }
  }, []);

  useEffect(() => {
    if (!authed) return;
    mounted.current = true;
    poll();
    pollAnalytics();
    const id = setInterval(poll, POLL_MS);
    const aid = setInterval(pollAnalytics, ANALYTICS_POLL_MS);
    return () => {
      mounted.current = false;
      clearInterval(id);
      clearInterval(aid);
    };
  }, [authed, poll, pollAnalytics]);

  const displayedPositions = useMemo(
    () => (category === "All" ? positions : positions.filter((p) => p.category === category)),
    [positions, category]
  );

  if (!authed) return <Login onOk={() => setAuthed(true)} />;

  const dayPnl = summary ? summary.today_pnl_cents ?? summary.total_pnl_cents : 0;
  const allTimePnl = summary ? summary.all_time_pnl_cents ?? summary.total_pnl_cents : 0;
  const unrealized = summary ? summary.unrealized_cents : 0;
  const realizedSub = summary
    ? summary.settlement_pnl_cents
      ? `realized ${fmtUsd(summary.realized_cents, true)} incl settled ${fmtUsd(summary.settlement_pnl_cents, true)}`
      : `realized ${fmtUsd(summary.realized_cents, true)}`
    : "";

  return (
    <div className="min-h-screen">
      <Banner pulseKey={pulseKey} lastPollTs={lastPoll} connected={connected} />
      <CategoryBar value={category} onChange={setCategory} categories={CATEGORIES} />

      {category === "Weather" && <WeatherPage positions={positions} pulseKey={pulseKey} />}
      {category === "Economics" && <EconomicsPage positions={positions} />}
      {category === "Politics" && <PoliticsPage positions={positions} />}
      {category === "Sports" && <SportsPage positions={positions} />}
      {category !== "Weather" && category !== "Economics" && category !== "Politics" && category !== "Sports" && (
      <>
      {attention && attention.chips.length > 0 && <AttentionStrip chips={attention.chips} />}
      <main className="p-3 grid grid-cols-12 gap-3">
        {/* Scorecard at top */}
        <div className="col-span-12">
          <Scorecard data={scorecard} />
        </div>

        {/* KPI row */}
        <div className="col-span-12 grid grid-cols-2 md:grid-cols-7 gap-3">
          <KpiCard
            label="Today PnL"
            value={summary ? fmtUsd(dayPnl, true) : "—"}
            tone={dayPnl >= 0 ? "pos" : "neg"}
            sub={realizedSub}
          />
          <KpiCard
            label="All-Time PnL"
            value={summary ? fmtUsd(allTimePnl, true) : "—"}
            tone={allTimePnl >= 0 ? "pos" : "neg"}
            sub={summary ? `settled ${fmtUsd(summary.all_time_settlement_pnl_cents ?? 0, true)}` : ""}
          />
          <KpiCard
            label="Unrealized"
            value={summary ? fmtUsd(unrealized, true) : "—"}
            tone={unrealized >= 0 ? "pos" : "neg"}
          />
          <KpiCard
            label="Cash"
            value={summary ? fmtUsd(summary.balance_cents) : "—"}
            tone="info"
          />
          <KpiCard
            label="Exposure"
            value={summary ? fmtUsd(summary.exposure_cents) : "—"}
            sub={summary ? `${summary.open_position_count} positions` : ""}
          />
          <KpiCard
            label="Worst Case"
            value={risk ? fmtUsd(-risk.worst_case_loss_cents, true) : "—"}
            tone="neg"
            sub="if all resolve against"
          />
          <KpiCard
            label="Best Case"
            value={risk ? fmtUsd(risk.best_case_gain_cents, true) : "—"}
            tone="pos"
            sub="if all resolve favor"
          />
        </div>

        {/* Equity curve + Category breakdown */}
        <div className="col-span-12 lg:col-span-8">
          <Panel
            title="Equity Curve"
            right={<span className="text-[10px] text-term-dim">{equity.length} pts</span>}
          >
            <EquityCurve points={equity} />
          </Panel>
        </div>
        <div className="col-span-12 lg:col-span-4">
          <Panel title="PnL by Category">
            <CategoryBreakdown categories={catPnl} />
          </Panel>
        </div>

        {/* Positions + Fills */}
        <div className="col-span-12 lg:col-span-8">
          <Panel
            title={`Open Positions${category !== "All" ? " — " + category : ""}`}
            right={<span className="text-[10px] text-term-dim">{displayedPositions.length} rows</span>}
          >
            <PositionsTable positions={displayedPositions} />
          </Panel>
        </div>
        <div className="col-span-12 lg:col-span-4 space-y-3">
          <Panel title="Recent Fills">
            <FillsFeed fills={fills} />
          </Panel>
          <Panel title="Settlements">
            <SettlementsPanel settlements={settlements} totalPnl={settlementTotal} />
          </Panel>
        </div>

        {/* Heatmap full width */}
        <div className="col-span-12">
          <Panel title="Position Heatmap — sized by exposure, color by PnL">
            <Heatmap positions={displayedPositions} />
          </Panel>
        </div>

        {/* Track Record (settled history by series) */}
        <div className="col-span-12">
          <TrackRecord data={trackRecord} />
        </div>
      </main>
      </>
      )}

      <footer className="px-3 py-2 text-[10px] text-term-dim border-t border-term-line flex justify-between">
        <span>POLL {POLL_MS / 1000}s · snapshots build equity curve over time</span>
        <span>kalshi-diagnostics v0.1</span>
      </footer>
    </div>
  );
}
