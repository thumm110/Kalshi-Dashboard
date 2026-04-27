import { useEffect, useMemo, useState } from "react";
import { CategoryPnlPanel } from "../components/CategoryPnlPanel";
import { GolfTournamentPanel } from "../components/GolfTournamentPanel";
import { KpiCard, Panel } from "../components/KpiCard";
import { LiveGamesFeed } from "../components/LiveGamesFeed";
import { NhlScoresStrip } from "../components/NhlScoresStrip";
import { NbaScoresStrip } from "../components/NbaScoresStrip";
import { MlbScoresStrip } from "../components/MlbScoresStrip";
import { GolfLeaderboardStrip } from "../components/GolfLeaderboardStrip";
import { NewsFeed } from "../components/NewsFeed";
import { PositionsTable } from "../components/PositionsTable";
import { SportFuturesPanel } from "../components/SportFuturesPanel";
import type { SeriesTeamStat } from "../lib/api";
import {
  api,
  fmtCents,
  fmtUsd,
  type Position,
  type PoliticsNewsItem,
  type PoliticsNewsResponse,
  type SportsFuturesGroup,
  type SportsGame,
  type SportsMarketsResponse,
  type SportsMeta,
} from "../lib/api";

type Props = { positions: Position[] };

// Naive P(team A wins series) assuming each remaining game is 50/50.
// Bo{total_games} → first to ceil(total/2)+ wins. Memoized for the 16 states of a Bo7.
const _winProbCache = new Map<string, number>();
function naiveSeriesWinProb(aWins: number, bWins: number, totalGames: number): number {
  const target = Math.floor(totalGames / 2) + 1;
  if (aWins >= target) return 1;
  if (bWins >= target) return 0;
  const key = `${aWins}-${bWins}-${totalGames}`;
  const hit = _winProbCache.get(key);
  if (hit != null) return hit;
  const v = 0.5 * naiveSeriesWinProb(aWins + 1, bWins, totalGames)
          + 0.5 * naiveSeriesWinProb(aWins, bWins + 1, totalGames);
  _winProbCache.set(key, v);
  return v;
}

function winPips(wins: number, target: number): string {
  return "●".repeat(Math.min(wins, target)) + "○".repeat(Math.max(0, target - wins));
}

function teamForMarket(title: string | null, teams: SeriesTeamStat[] | undefined): SeriesTeamStat | null {
  if (!title || !teams) return null;
  const norm = title.toLowerCase();
  // Best match: name substring (e.g. "Anaheim Ducks" includes the team name).
  return teams.find((t) => t.name && norm.includes(t.name.toLowerCase()))
      || teams.find((t) => t.abbrev && norm.includes(t.abbrev.toLowerCase()))
      || null;
}

const POLL_MS = 20000;

type SportFocus = "all" | "nhl" | "nba" | "mlb" | "golf" | "ufc" | "soccer" | "motor";

const SPORT_FOCUS_OPTIONS: { id: SportFocus; label: string }[] = [
  { id: "all", label: "All" },
  { id: "nhl", label: "NHL" },
  { id: "nba", label: "NBA" },
  { id: "mlb", label: "MLB" },
  { id: "golf", label: "Golf" },
  { id: "ufc", label: "UFC" },
  { id: "soccer", label: "Soccer" },
  { id: "motor", label: "Motor" },
];

// Which live-games sport_ids belong to each focus.
const FOCUS_TO_LIVE_IDS: Record<SportFocus, string[]> = {
  all: [],
  nhl: ["nhl"],
  nba: ["nba"],
  mlb: ["mlb"],
  golf: ["golf"],
  ufc: ["ufc"],
  soccer: ["soccer", "mls"],
  motor: ["motorsport"],
};

type SportsNewsFilterId = "all" | "nhl" | "nba" | "mlb" | "golf" | "soccer" | "mma" | "general";
type SportsNewsFilter = {
  id: SportsNewsFilterId;
  label: string;
  sourceIds: readonly string[];
  pathHints?: readonly string[];
  textHints?: readonly string[];
};

const SPORTS_NEWS_FILTERS: readonly SportsNewsFilter[] = [
  { id: "all", label: "All", sourceIds: [] },
  { id: "nhl", label: "NHL", sourceIds: ["yahoo_nhl", "espn_nhl", "cbs_nhl", "sportsnet_nhl"], pathHints: ["/nhl/", "/hockey/"], textHints: ["nhl", "hockey", "stanley cup"] },
  { id: "nba", label: "NBA", sourceIds: ["yahoo_nba", "espn_nba"], pathHints: ["/nba/"], textHints: ["nba"] },
  { id: "mlb", label: "MLB", sourceIds: ["mlb_com", "yahoo_mlb"], pathHints: ["/mlb/", "mlb.com"], textHints: ["mlb", "baseball"] },
  { id: "golf", label: "Golf", sourceIds: ["yahoo_golf"], pathHints: ["/golf/"], textHints: ["golf", "pga", "lpga", "liv golf", "masters"] },
  { id: "soccer", label: "Soccer", sourceIds: [], pathHints: ["/soccer/"], textHints: ["soccer", "premier league", "champions league"] },
  { id: "mma", label: "MMA", sourceIds: [], pathHints: ["/mma/"], textHints: ["mma", "ufc"] },
  { id: "general", label: "General", sourceIds: ["cbs", "bbc_sport"] },
] as const;

const OTHER_SPORT_PATHS: Record<Exclude<SportsNewsFilterId, "all" | "general">, readonly string[]> = {
  nhl: ["/nba/", "/wnba/", "/mlb/", "/nfl/", "/college-football/", "/mens-college-basketball/", "/womens-college-basketball/", "/tennis/", "/soccer/", "/golf/", "/mma/", "/f1/", "/racing/"],
  nba: ["/nhl/", "/wnba/", "/mlb/", "/nfl/", "/college-football/", "/tennis/", "/soccer/", "/golf/", "/mma/", "/f1/", "/racing/"],
  mlb: ["/nhl/", "/nba/", "/wnba/", "/nfl/", "/college-football/", "/mens-college-basketball/", "/womens-college-basketball/", "/tennis/", "/soccer/", "/golf/", "/mma/", "/f1/", "/racing/"],
  golf: ["/nhl/", "/nba/", "/wnba/", "/mlb/", "/nfl/", "/college-football/", "/mens-college-basketball/", "/womens-college-basketball/", "/tennis/", "/soccer/", "/mma/", "/f1/", "/racing/"],
  soccer: ["/nhl/", "/nba/", "/wnba/", "/mlb/", "/nfl/", "/college-football/", "/mens-college-basketball/", "/womens-college-basketball/", "/tennis/", "/golf/", "/mma/", "/f1/", "/racing/"],
  mma: ["/nhl/", "/nba/", "/wnba/", "/mlb/", "/nfl/", "/college-football/", "/mens-college-basketball/", "/womens-college-basketball/", "/tennis/", "/soccer/", "/golf/", "/f1/", "/racing/"],
};

// Sources that only publish a single league — trust the source, skip path/text sniffing.
const LEAGUE_DEDICATED_SOURCES: Record<string, SportsNewsFilterId> = {
  yahoo_nhl: "nhl",
  espn_nhl: "nhl",
  cbs_nhl: "nhl",
  sportsnet_nhl: "nhl",
  yahoo_nba: "nba",
  espn_nba: "nba",
  mlb_com: "mlb",
  yahoo_mlb: "mlb",
  yahoo_golf: "golf",
};

function matchesSportsNewsFilter(item: PoliticsNewsItem, filter: SportsNewsFilter): boolean {
  if (filter.id === "all") return true;
  if (!filter.sourceIds.includes(item.source_id)) return false;
  if (filter.id === "general") return true;

  // If this source only covers this league, accept it without further filtering.
  if (LEAGUE_DEDICATED_SOURCES[item.source_id] === filter.id) return true;

  const link = item.link.toLowerCase();
  const otherPaths = OTHER_SPORT_PATHS[filter.id];
  if (otherPaths.some((path) => link.includes(path))) return false;

  const hasSportPath = filter.pathHints?.some((path) => link.includes(path)) ?? false;
  if (hasSportPath) return true;

  const searchable = `${item.title} ${item.summary ?? ""}`.toLowerCase();
  return filter.textHints?.some((hint) => searchable.includes(hint)) ?? false;
}

export function SportsPage({ positions }: Props) {
  const [data, setData] = useState<SportsMarketsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sportFilter, setSportFilter] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState<"today" | "tomorrow" | "week" | "all">("today");
  const [news, setNews] = useState<PoliticsNewsResponse | null>(null);
  const [newsError, setNewsError] = useState<string | null>(null);
  const [newsFilter, setNewsFilter] = useState<SportsNewsFilterId>("all");
  const [sportFocus, setSportFocus] = useState<SportFocus>("all");

  // Auto-sync news + live-games sport filter to the top-level focus.
  useEffect(() => {
    const newsMap: Record<SportFocus, SportsNewsFilterId> = {
      all: "all", nhl: "nhl", nba: "nba", mlb: "mlb", golf: "golf",
      ufc: "mma", soccer: "soccer", motor: "general",
    };
    setNewsFilter(newsMap[sportFocus]);
    setSportFilter("all"); // pre-filter the games list ourselves; reset the in-panel pill
  }, [sportFocus]);

  const showFor = (...focuses: SportFocus[]) =>
    sportFocus === "all" || focuses.includes(sportFocus);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const resp = await api.sportsMarkets();
        if (!alive) return;
        setData(resp);
        setError(null);
      } catch (err) {
        if (!alive) return;
        setError(err instanceof Error ? err.message : "sports failed");
      }
    }
    load();
    const id = window.setInterval(load, POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    async function loadNews() {
      try {
        const resp = await api.sportsNews(100);
        if (!alive) return;
        setNews(resp);
        setNewsError(null);
      } catch (err) {
        if (!alive) return;
        setNewsError(err instanceof Error ? err.message : "news failed");
      }
    }
    loadNews();
    const id = window.setInterval(loadNews, 120000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  const sportsPositions = useMemo(
    () => positions.filter((p) => p.category === "Sports"),
    [positions]
  );
  const totalPnl = sportsPositions.reduce(
    (a, p) => a + p.unrealized_pnl_cents + p.realized_pnl_cents,
    0
  );
  const totalExposure = sportsPositions.reduce((a, p) => a + p.market_exposure_cents, 0);

  const live: SportsGame[] = data?.live_games ?? [];
  const futures: SportsFuturesGroup[] = data?.futures ?? [];
  const sports: SportsMeta[] = data?.sports ?? [];
  const selectedNewsFilter = SPORTS_NEWS_FILTERS.find((f) => f.id === newsFilter) ?? SPORTS_NEWS_FILTERS[0];
  const newsItems = news?.items ?? [];
  const newsSources = news?.sources ?? [];
  const filteredNewsItems = useMemo(() => {
    return newsItems.filter((item) => matchesSportsNewsFilter(item, selectedNewsFilter));
  }, [newsItems, selectedNewsFilter]);
  const filteredNewsSources = useMemo(() => {
    if (selectedNewsFilter.id === "all") return newsSources;
    const sourceIds = new Set(selectedNewsFilter.sourceIds);
    return newsSources.filter((source) => sourceIds.has(source.id));
  }, [newsSources, selectedNewsFilter]);
  const newsFilterOptions = useMemo(
    () =>
      SPORTS_NEWS_FILTERS.map((filter) => {
        const count =
          filter.id === "all"
            ? newsItems.length
            : newsItems.filter((item) => matchesSportsNewsFilter(item, filter)).length;
        return { ...filter, count };
      }),
    [newsItems]
  );

  const futuresBySport = useMemo(() => {
    const m: Record<string, SportsFuturesGroup[]> = {};
    for (const f of futures) {
      if (!m[f.sport_id]) m[f.sport_id] = [];
      m[f.sport_id].push(f);
    }
    return m;
  }, [futures]);

  const movers = useMemo(() => {
    type Row = {
      ticker: string;
      sport: string;
      label: string;
      change: number;
      mid: number | null;
    };
    const rows: Row[] = [];
    for (const g of live) {
      for (const m of g.markets) {
        if (m.change_24h_cents != null && Math.abs(m.change_24h_cents) >= 2) {
          rows.push({
            ticker: m.ticker,
            sport: g.sport_label,
            label: `${g.title ?? g.event_ticker}: ${m.title ?? ""}`,
            change: m.change_24h_cents,
            mid: m.mid_cents,
          });
        }
      }
    }
    for (const f of futures) {
      for (const m of f.markets) {
        if (m.change_24h_cents != null && Math.abs(m.change_24h_cents) >= 2) {
          rows.push({
            ticker: m.ticker,
            sport: f.sport_id.toUpperCase(),
            label: `${f.label}: ${m.title ?? ""}`,
            change: m.change_24h_cents,
            mid: m.mid_cents,
          });
        }
      }
    }
    rows.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
    return rows.slice(0, 10);
  }, [live, futures]);

  const liveGamesCount = live.length;
  const mlbFutures = futuresBySport["mlb"] ?? [];
  const ufcFutures = futuresBySport["ufc"] ?? [];
  const golfFutures = futuresBySport["golf"] ?? [];
  const mlsFutures = futuresBySport["mls"] ?? [];
  const nbaFutures = futuresBySport["nba"] ?? [];
  const soccerFutures = futuresBySport["soccer"] ?? [];
  const motorFutures = futuresBySport["motorsport"] ?? [];
  const nhlFutures = futuresBySport["nhl"] ?? [];

  const filterOptions = [
    { id: "all", label: `All (${liveGamesCount})` },
    ...sports.map((s) => ({ id: s.id, label: `${s.label} (${s.game_count})` })),
  ];

  const MONTHS: Record<string, number> = {
    JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
    JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
  };

  const gameDayStart = (g: SportsGame): number | null => {
    const m = g.event_ticker.match(/-(\d{2})([A-Z]{3})(\d{2})/);
    if (m) {
      const yy = parseInt(m[1], 10);
      const mon = MONTHS[m[2]];
      const dd = parseInt(m[3], 10);
      if (mon != null && !isNaN(yy) && !isNaN(dd)) {
        return new Date(2000 + yy, mon, dd).getTime();
      }
    }
    if (g.expected_expiration_time) {
      const t = new Date(g.expected_expiration_time).getTime() - 12 * 3600_000;
      if (!isNaN(t)) {
        const d = new Date(t);
        return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      }
    }
    return null;
  };

  const liveForFocus = useMemo(() => {
    const ids = FOCUS_TO_LIVE_IDS[sportFocus];
    if (ids.length === 0) return live;
    return live.filter((g) => ids.includes(g.sport_id ?? ""));
  }, [live, sportFocus]);

  const dateBuckets = useMemo(() => {
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startTomorrow = startToday + 86400_000;
    const startDayAfter = startToday + 2 * 86400_000;
    const startWeekEnd = startToday + 7 * 86400_000;
    let today = 0, tomorrow = 0, week = 0;
    for (const g of liveForFocus) {
      const t = gameDayStart(g);
      if (t == null) continue;
      if (t >= startToday && t < startTomorrow) today++;
      if (t >= startTomorrow && t < startDayAfter) tomorrow++;
      if (t >= startToday && t < startWeekEnd) week++;
    }
    return { today, tomorrow, week, all: liveForFocus.length, startToday, startTomorrow, startDayAfter, startWeekEnd };
  }, [liveForFocus]);

  const filteredByDate = useMemo(() => {
    if (dateFilter === "all") return liveForFocus;
    return liveForFocus.filter((g) => {
      const t = gameDayStart(g);
      if (t == null) return false;
      if (dateFilter === "today") return t >= dateBuckets.startToday && t < dateBuckets.startTomorrow;
      if (dateFilter === "tomorrow") return t >= dateBuckets.startTomorrow && t < dateBuckets.startDayAfter;
      if (dateFilter === "week") return t >= dateBuckets.startToday && t < dateBuckets.startWeekEnd;
      return true;
    });
  }, [liveForFocus, dateFilter, dateBuckets]);

  const dateOptions: { id: typeof dateFilter; label: string }[] = [
    { id: "today", label: `Today (${dateBuckets.today})` },
    { id: "tomorrow", label: `Tmrw (${dateBuckets.tomorrow})` },
    { id: "week", label: `Week (${dateBuckets.week})` },
    { id: "all", label: `All (${dateBuckets.all})` },
  ];

  return (
    <main className="p-3 grid grid-cols-12 gap-3">
      {/* Sticky sport focus — controls which scoreboards/futures/news/games show */}
      <div className="col-span-12 sticky top-0 z-20 -mx-3 px-3 py-2 bg-term-bg/95 backdrop-blur border-b border-term-line">
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
          <span className="text-[10px] text-term-dim mr-1 shrink-0">Sport:</span>
          {SPORT_FOCUS_OPTIONS.map((o) => (
            <button
              key={o.id}
              onClick={() => setSportFocus(o.id)}
              className={`text-[11px] px-2.5 py-1 rounded shrink-0 ${
                sportFocus === o.id
                  ? "bg-term-cyan/20 text-term-cyan border border-term-cyan/40"
                  : "text-term-dim hover:text-term-text border border-term-line/60"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <div className="col-span-12">
        <CategoryPnlPanel category="Sports" />
      </div>
      {/* KPIs */}
      <div className="col-span-12 grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="Sports PnL"
          value={fmtUsd(totalPnl, true)}
          tone={totalPnl >= 0 ? "pos" : "neg"}
          sub={`${sportsPositions.length} position${sportsPositions.length === 1 ? "" : "s"}`}
        />
        <KpiCard
          label="Exposure"
          value={fmtUsd(totalExposure)}
          tone="info"
        />
        <KpiCard
          label="Live Games"
          value={String(liveGamesCount)}
          tone="info"
          sub={`${sports.filter((s) => s.game_count > 0).length}/${sports.length} sports`}
        />
        <KpiCard
          label="Futures Live"
          value={`${futures.filter((f) => f.markets.length).length}/${futures.length}`}
          tone="info"
          sub="season-long events"
        />
      </div>

      {error && (
        <div className="col-span-12 text-term-red text-xs">sports error: {error}</div>
      )}

      {/* Positions + news side by side */}
      <div className="col-span-12 lg:col-span-7">
        <Panel
          title="Your Sports Positions"
          right={
            <span className="text-[10px] text-term-dim">
              {sportsPositions.length} row{sportsPositions.length === 1 ? "" : "s"}
            </span>
          }
        >
          {sportsPositions.length === 0 ? (
            <div className="text-term-dim text-xs p-3">no open sports positions</div>
          ) : (
            <PositionsTable positions={sportsPositions} />
          )}
        </Panel>
      </div>
      <div className="col-span-12 lg:col-span-5">
        <Panel
          title="Sports News"
          right={
            <span className="text-[10px] text-term-dim">
              {filteredNewsItems.length}/{newsItems.length} headlines
            </span>
          }
        >
          <div className="flex flex-wrap gap-1 mb-2">
            {newsFilterOptions.map((option) => (
              <button
                key={option.id}
                onClick={() => setNewsFilter(option.id)}
                className={`text-[10px] px-2 py-0.5 rounded border ${
                  newsFilter === option.id
                    ? "bg-term-cyan/20 text-term-cyan border-term-cyan/40"
                    : "text-term-dim hover:text-term-text border-term-line/60"
                }`}
              >
                {option.label} ({option.count})
              </button>
            ))}
          </div>
          <NewsFeed
            items={filteredNewsItems}
            sources={filteredNewsSources}
            loading={!news}
            error={newsError}
          />
        </Panel>
      </div>

      {/* Playoff series */}
      {data?.playoff_series && data.playoff_series.length > 0 && (() => {
        const focusLabels: Record<SportFocus, string[]> = {
          all: [], nhl: ["NHL"], nba: ["NBA"], mlb: ["MLB"], golf: ["PGA", "Golf"],
          ufc: ["UFC"], soccer: ["MLS", "Soccer", "UCL"], motor: [],
        };
        const labels = focusLabels[sportFocus];
        const series = labels.length === 0
          ? data.playoff_series
          : data.playoff_series.filter((s) => labels.some((l) => (s.sport_label || "").toUpperCase().includes(l.toUpperCase())));
        if (series.length === 0) return null;
        return (
        <div className="col-span-12">
          <Panel
            title="Playoff Series — Who Wins"
            right={
              <span className="text-[10px] text-term-dim">
                {series.length} series live
              </span>
            }
          >
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
              {series.map((s) => (
                <div key={s.event_ticker} className="border border-term-line bg-term-panel/40 p-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-bold tracking-wider text-term-cyan">
                      {s.sport_label} {s.sub_title?.match(/R\d+/)?.[0] || ""}
                    </span>
                    {s.series_summary && (
                      <span className="text-[10px] text-term-amber truncate ml-2">
                        {s.series_summary}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-term-text truncate" title={s.title || ""}>
                    {s.title || s.event_ticker}
                  </div>
                  {(() => {
                    const stats = s.series_stats;
                    const teams = stats?.teams ?? [];
                    const total = stats?.total_games ?? null;
                    const target = total ? Math.floor(total / 2) + 1 : null;
                    const t0 = teams[0], t1 = teams[1];
                    const havePips = !!(target && t0 && t1 && t0.series_wins != null && t1.series_wins != null);
                    return (
                      <>
                        <div className="mt-1 space-y-0.5">
                          {s.markets.map((m) => {
                            const team = teamForMarket(m.title, teams);
                            let edge: number | null = null;
                            let naive: number | null = null;
                            if (team && target && t0 && t1 && t0.series_wins != null && t1.series_wins != null && m.mid_cents != null) {
                              const myWins = team.abbrev === t0.abbrev ? t0.series_wins : t1.series_wins;
                              const oppWins = team.abbrev === t0.abbrev ? t1.series_wins : t0.series_wins;
                              naive = naiveSeriesWinProb(myWins, oppWins, total!) * 100;
                              edge = m.mid_cents - naive;
                            }
                            return (
                              <div key={m.ticker} className="flex justify-between text-[11px] tabular-nums gap-2">
                                <span className="text-term-text truncate pr-2">{m.title || m.ticker}</span>
                                <span className="flex items-center gap-2 shrink-0">
                                  {naive != null && (
                                    <span className="text-term-dim text-[10px]">naive {naive.toFixed(0)}%</span>
                                  )}
                                  {edge != null && Math.abs(edge) >= 2 && (
                                    <span className={edge < 0 ? "text-term-greenBright text-[10px]" : "text-term-red text-[10px]"}>
                                      {edge < 0 ? "+" : "−"}{Math.abs(edge).toFixed(0)}¢
                                    </span>
                                  )}
                                  <span className="text-term-cyan">
                                    {m.mid_cents != null ? fmtCents(m.mid_cents) : "—"}
                                  </span>
                                </span>
                              </div>
                            );
                          })}
                        </div>
                        {(teams.length || stats?.next_game || stats?.last_game) && (
                          <div className="mt-1.5 pt-1.5 border-t border-term-line/60 space-y-0.5 text-[10px] text-term-dim tabular-nums">
                            {havePips && (
                              <div className="flex items-center gap-2 text-[11px]">
                                <span className="text-term-text">{t0!.abbrev}</span>
                                <span className="text-term-amber tracking-widest">{winPips(t0!.series_wins!, target!)}</span>
                                <span className="text-term-dim">{t0!.series_wins}–{t1!.series_wins}</span>
                                <span className="text-term-amber tracking-widest">{winPips(t1!.series_wins!, target!)}</span>
                                <span className="text-term-text">{t1!.abbrev}</span>
                                <span className="ml-auto">Bo{total}</span>
                              </div>
                            )}
                            {teams.length > 0 && (
                              <div className="flex flex-wrap gap-x-3">
                                {teams.map((t) => (
                                  <span key={t.abbrev}>
                                    <span className="text-term-text">{t.abbrev}</span> {t.season_record || "—"}
                                  </span>
                                ))}
                              </div>
                            )}
                            {stats?.last_game?.sides && stats.last_game.sides.length === 2 && (
                              <div>
                                <span className="text-term-text">Last:</span>{" "}
                                {stats.last_game.sides.map((sd, i) => (
                                  <span key={sd.abbrev}>
                                    <span className={sd.winner ? "text-term-greenBright" : "text-term-text"}>
                                      {sd.abbrev} {sd.score ?? "—"}
                                    </span>
                                    {i === 0 ? " – " : ""}
                                  </span>
                                ))}
                                {stats.last_game.ot && <span className="text-term-amber"> ({stats.last_game.ot})</span>}
                              </div>
                            )}
                            {stats?.next_game?.short_detail && (
                              <div>
                                <span className="text-term-text">Next:</span> {stats.next_game.short_detail}
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              ))}
            </div>
          </Panel>
        </div>
        );
      })()}

      {/* NHL live scoreboard from NHL.com */}
      {showFor("nhl") && (
      <div className="col-span-12">
        <Panel
          title="NHL Scoreboard"
          right={<span className="text-[10px] text-term-dim">api-web.nhle.com · 20s poll</span>}
        >
          <NhlScoresStrip />
        </Panel>
      </div>
      )}

      {/* NBA live scoreboard */}
      {showFor("nba") && (
      <div className="col-span-12">
        <Panel
          title="NBA Scoreboard"
          right={<span className="text-[10px] text-term-dim">site.api.espn.com · 20s poll</span>}
        >
          <NbaScoresStrip />
        </Panel>
      </div>
      )}

      {/* MLB live scoreboard */}
      {showFor("mlb") && (
      <div className="col-span-12">
        <Panel
          title="MLB Scoreboard"
          right={<span className="text-[10px] text-term-dim">site.api.espn.com · 20s poll · bases/count when live</span>}
        >
          <MlbScoresStrip />
        </Panel>
      </div>
      )}

      {/* Today's live games */}
      <div className="col-span-12">
        <Panel
          title="Live Games & Fights"
          right={
            <div className="flex flex-col items-end gap-1">
              <div className="flex items-center gap-1">
                {dateOptions.map((o) => (
                  <button
                    key={o.id}
                    onClick={() => setDateFilter(o.id)}
                    className={`text-[10px] px-2 py-0.5 rounded ${
                      dateFilter === o.id
                        ? "bg-term-amber/20 text-term-amber border border-term-amber/40"
                        : "text-term-dim hover:text-term-text border border-transparent"
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1 flex-wrap justify-end">
                {filterOptions.map((o) => (
                  <button
                    key={o.id}
                    onClick={() => setSportFilter(o.id)}
                    className={`text-[10px] px-2 py-0.5 rounded ${
                      sportFilter === o.id
                        ? "bg-term-cyan/20 text-term-cyan border border-term-cyan/40"
                        : "text-term-dim hover:text-term-text border border-transparent"
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          }
        >
          <LiveGamesFeed games={filteredByDate} sportFilter={sportFilter === "all" ? undefined : sportFilter} />
        </Panel>
      </div>

      {/* Golf leaderboard + futures (moved up per request) */}
      {showFor("golf") && (
      <>
      <div className="col-span-12 lg:col-span-6">
        <Panel
          title="Golf — PGA Leaderboard"
          right={<span className="text-[10px] text-term-dim">site.api.espn.com · 60s poll</span>}
        >
          <GolfLeaderboardStrip />
        </Panel>
      </div>
      <div className="col-span-12 lg:col-span-6">
        <SportFuturesPanel title="Golf — Season-Long Futures" groups={golfFutures} />
      </div>
      </>
      )}

      {/* Active golf tournaments — each with full prop set */}
      {showFor("golf") && data?.golf_tournaments && data.golf_tournaments.length > 0 && (
        <>
          {data.golf_tournaments.map((t) => (
            <div key={t.tournament_code} className="col-span-12">
              <GolfTournamentPanel tournament={t} />
            </div>
          ))}
        </>
      )}

      {/* Movers */}
      <div className="col-span-12">
        <Panel
          title="Biggest 24h Movers"
          right={<span className="text-[10px] text-term-dim">across sports</span>}
        >
          {movers.length === 0 ? (
            <div className="text-term-dim text-xs">no significant moves</div>
          ) : (
            <div className="space-y-1">
              {movers.map((m) => (
                <div key={m.ticker} className="flex justify-between text-[11px] tabular-nums">
                  <span className="truncate pr-2">
                    <span className="text-term-dim mr-1">[{m.sport}]</span>
                    <span className="text-term-text">{m.label}</span>
                  </span>
                  <span
                    className={`shrink-0 ${
                      m.change >= 0 ? "text-term-greenBright" : "text-term-red"
                    }`}
                  >
                    {m.change > 0 ? "+" : ""}
                    {m.change}¢
                  </span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {/* NHL — Stanley Cup, conferences, awards */}
      {showFor("nhl") && (
      <div className="col-span-12">
        <SportFuturesPanel title="NHL — Stanley Cup, Conferences & Awards" groups={nhlFutures} />
      </div>
      )}

      {/* MLB (deepest section) */}
      {showFor("mlb") && (
      <div className="col-span-12">
        <SportFuturesPanel title="MLB — Awards & Stat Milestones" groups={mlbFutures} />
      </div>
      )}

      {/* UFC titles */}
      {showFor("ufc") && (
      <div className="col-span-12">
        <SportFuturesPanel title="UFC — Title Holders (Year End)" groups={ufcFutures} maxMarketsPerGroup={3} />
      </div>
      )}

      {showFor("soccer") && (
      <div className="col-span-12">
        <SportFuturesPanel title="MLS" groups={mlsFutures} />
      </div>
      )}

      {/* NBA + Soccer UCL */}
      {showFor("nba") && (
      <div className="col-span-12 lg:col-span-6">
        <SportFuturesPanel title="NBA / Basketball" groups={nbaFutures} />
      </div>
      )}
      {showFor("soccer") && (
      <div className="col-span-12 lg:col-span-6">
        <SportFuturesPanel title="Soccer — Champions League" groups={soccerFutures} />
      </div>
      )}

      {/* Motorsports */}
      {showFor("motor") && (
      <div className="col-span-12">
        <SportFuturesPanel title="Motorsports — F1 / NASCAR / MotoGP" groups={motorFutures} />
      </div>
      )}

      {/* Not-offered note */}
      {sportFocus === "all" && data?.not_offered && data.not_offered.length > 0 && (
        <div className="col-span-12">
          <Panel title="Not Currently Offered on Kalshi">
            <div className="text-[11px] text-term-dim space-y-0.5">
              {data.not_offered.map((item) => (
                <div key={item}>• {item}</div>
              ))}
            </div>
          </Panel>
        </div>
      )}

      {/* Registry status */}
      {sportFocus === "all" && (
      <div className="col-span-12">
        <Panel
          title="Sports Registry Status"
          right={
            <span className="text-[10px] text-term-dim">
              {futures.filter((f) => f.markets.length > 0).length}/{futures.length} futures live
            </span>
          }
        >
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-1 text-[11px]">
            {futures.map((f) => {
              const isLive = f.markets.length > 0;
              return (
                <div
                  key={f.id}
                  className={`flex items-center justify-between px-2 py-1 rounded ${
                    isLive ? "bg-term-line/30" : "bg-term-red/10"
                  }`}
                >
                  <span className="text-term-text truncate">
                    <span className="text-term-dim uppercase mr-1">[{f.sport_id}]</span>
                    {f.label}
                  </span>
                  <span className="text-term-dim tabular-nums ml-2 shrink-0">
                    <code>{f.event_ticker}</code>{" "}
                    {isLive ? (
                      <span className="text-term-greenBright">✓ {f.markets.length}</span>
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
      )}
    </main>
  );
}
