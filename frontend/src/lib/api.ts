function apiBase(): string {
  const configured = import.meta.env.VITE_API_BASE || "";
  const host = typeof window === "undefined" ? "" : window.location.hostname;
  const pageIsLocal = host === "localhost" || host === "127.0.0.1";
  const configuredIsLocal = configured.includes("localhost") || configured.includes("127.0.0.1");

  if (configured && (!configuredIsLocal || pageIsLocal)) return configured;
  return "";
}

export const API_BASE = apiBase();

function pwd(): string {
  return sessionStorage.getItem("dashpw") || "";
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(API_BASE + path, {
    headers: { "X-Dashboard-Password": pwd() },
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

export async function login(password: string): Promise<boolean> {
  const res = await fetch(API_BASE + "/api/auth/check", {
    method: "POST",
    headers: { "X-Dashboard-Password": password },
  });
  if (res.ok) {
    sessionStorage.setItem("dashpw", password);
    return true;
  }
  return false;
}

export function hasCreds(): boolean {
  return !!pwd();
}

export type Summary = {
  ts: number;
  balance_cents: number;
  unrealized_cents: number;
  realized_cents: number;
  position_realized_cents?: number;
  today_position_realized_cents?: number;
  settlement_pnl_cents?: number;
  all_time_settlement_pnl_cents?: number;
  settlement_count?: number;
  all_time_settlement_count?: number;
  settlement_since_ts?: number;
  exposure_cents: number;
  open_position_count: number;
  today_pnl_cents?: number;
  all_time_pnl_cents?: number;
  total_pnl_cents: number;
};

export type Position = {
  ticker: string;
  category: string;
  position: number;
  market_exposure_cents: number;
  realized_pnl_cents: number;
  unrealized_pnl_cents: number;
  market_value_cents?: number;
  total_traded_cents: number;
  fees_paid_cents: number;
  resting_orders_count: number;
  last_updated_ts?: string;
  title?: string | null;
  event_ticker?: string | null;
  expected_expiration_time?: string | null;
  yes_bid_cents?: number;
  yes_ask_cents?: number;
  yes_mid_cents?: number | null;
  side_mid_cents?: number | null;
  entry_cents?: number | null;
  edge_cents?: number | null;
  floor_strike?: number | null;
  cap_strike?: number | null;
  strike_type?: string | null;
};

export type Fill = {
  ticker: string;
  category: string;
  side: string;
  action: string;
  count: number;
  yes_price_cents: number;
  no_price_cents: number;
  is_taker: boolean;
  created_time: string;
  trade_id: string;
};

export type Settlement = {
  ticker: string;
  event_ticker: string | null;
  category: string;
  market_result: string | null;
  yes_count: number;
  no_count: number;
  cost_cents: number;
  revenue_cents: number;
  fee_cents: number;
  pnl_cents: number;
  settlement_value_cents: number;
  settled_time: string;
};

export type SettlementsResponse = {
  ts: number;
  period: "today" | "all";
  count: number;
  total_pnl_cents: number;
  settlements: Settlement[];
};

export type EquityPoint = {
  ts: number;
  equity_cents: number;
  balance_cents: number;
  unrealized_cents: number;
  realized_cents: number;
  exposure_cents: number;
  position_count: number;
};

export type CategoryPnl = {
  category: string;
  unrealized_cents: number;
  realized_cents: number;
  exposure_cents: number;
  position_count: number;
  total_pnl_cents: number;
};

export type CategoryStats = {
  category: string;
  realized_pnl_cents: number;
  unrealized_pnl_cents: number;
  total_pnl_cents: number;
  exposure_cents: number;
  open_position_count: number;
  settlement_count: number;
  wins: number;
  losses: number;
  pushes: number;
  win_rate: number;
  total_cost_cents: number;
  total_payout_cents: number;
  total_fees_cents: number;
};

export type CategoryPnlSeriesPoint = {
  ts: number;
  daily_pnl_cents: number;
  cumulative_pnl_cents: number;
};

export type CategorySeriesBreakdownRow = {
  series: string;
  pnl_cents: number;
  cost_cents: number;
  fees_cents: number;
  wins: number;
  losses: number;
  pushes: number;
  count: number;
};

export type CategoryDetail = {
  ts: number;
  category: string;
  range: string;
  cache_refreshed_ts: number | null;
  stats: CategoryStats;
  series: CategoryPnlSeriesPoint[];
  series_breakdown?: CategorySeriesBreakdownRow[];
};

export type CategorySummary = {
  ts: number;
  range: string;
  cache_refreshed_ts: number | null;
  cache_settlement_count: number;
  categories: CategoryStats[];
};

export type PnlRange = "all" | "ytd" | "30d" | "7d";

export type Risk = {
  worst_case_loss_cents: number;
  best_case_gain_cents: number;
};

export type ScorecardMetrics = {
  trade_count: number;
  wins: number;
  losses: number;
  pushes: number;
  win_rate: number;
  total_pnl_cents: number;
  avg_win_cents: number;
  avg_loss_cents: number;
  win_loss_ratio: number;
  expectancy_cents: number;
  best_trade_cents: number;
  worst_trade_cents: number;
};

export type Scorecard = {
  ts: number;
  all_time: ScorecardMetrics;
  last_30d: ScorecardMetrics;
  streak: { sign: "W" | "L" | "-"; count: number };
  max_drawdown_cents: number;
  max_drawdown_pct: number;
  daily_pnl_mean_cents: number;
  daily_pnl_stdev_cents: number;
  sharpe_annualized: number;
  active_days: number;
};

export type TrackRecordRow = {
  series: string;
  category: string;
  trade_count: number;
  wins: number;
  losses: number;
  pushes: number;
  total_pnl_cents: number;
  total_cost_cents: number;
  total_payout_cents: number;
  total_fees_cents: number;
  last_settled_ts: number;
  win_rate: number;
  expectancy_cents: number;
  roi: number;
};

export type TrackRecord = {
  ts: number;
  series: TrackRecordRow[];
  count: number;
};

export type AttentionChip = {
  kind:
    | "resolving"
    | "edge_negative"
    | "drawdown"
    | "recent_fills"
    | "category_swing"
    | "equity_move"
    | string;
  severity: "bad" | "warn" | "good" | "info";
  ticker?: string;
  title?: string | null;
  minutes_to_resolve?: number;
  exposure_cents?: number;
  qty?: number;
  edge_cents?: number;
  entry_cents?: number;
  mid_cents?: number;
  unrealized_cents?: number;
  pct?: number;
  count?: number;
  total_contracts?: number;
  latest_ticker?: string;
  latest_time?: string;
  category?: string;
  pnl_cents?: number;
  delta_cents?: number;
  since?: number;
};

export type AttentionResponse = {
  ts: number;
  chips: AttentionChip[];
  count: number;
};

export type WeatherGuidanceLocation = {
  code: string;
  name: string;
  timezone: string;
  lat: number;
  lng: number;
  station_id: string | null;
  station_name?: string | null;
  climate_station: string;
  climate_report_url: string;
  series: string[];
  contract_day: string;
  contract_day_start: string;
  contract_day_end: string;
  source: string;
  confidence: string;
  latest_observation_time?: string | null;
  latest_temp_f?: number | null;
  high_so_far_f?: number | null;
  low_so_far_f?: number | null;
  observation_count?: number;
  condition?: string | null;
  humidity_pct?: number | null;
  wind_mph?: number | null;
  forecast_updated_time?: string | null;
  forecast_period_count?: number;
  forecast_temp_f?: number | null;
  forecast_high_f?: number | null;
  forecast_low_f?: number | null;
  projected_high_f?: number | null;
  projected_low_f?: number | null;
  forecast_error?: string | null;
  error?: string | null;
};


export type WeatherGuidanceResponse = {
  ts: number;
  locations: WeatherGuidanceLocation[];
  source_note: string;
};

export type WeatherOpportunity = {
  ticker: string;
  title?: string | null;
  series_ticker: string;
  event_ticker?: string | null;
  city_code: string;
  city_name: string;
  market_kind: "HIGH" | "LOW";
  strike_label: string;
  threshold: number;
  threshold_kind: "gt" | "lt";
  close_time: string;
  kalshi_yes_bid?: number | null;
  kalshi_yes_ask?: number | null;
  kalshi_yes_mid: number;
  kalshi_no_bid?: number | null;
  kalshi_no_ask?: number | null;
  kalshi_no_mid?: number | null;
  fair_yes: number;
  yes_edge: number;
  trade_edge: number;
  recommended_side: "YES" | "NO";
  confidence?: number | null;
  member_count?: number | null;
  agreement_count?: number | null;
  available_model_count: number;
  gfs_prob?: number | null;
  aigefs_prob?: number | null;
  ecmwf_prob?: number | null;
  aifs_prob?: number | null;
  disagreement_spread: number;
  spread: number;
  volume: number;
  open_interest: number;
};

export type WeatherOpportunitiesParams = {
  city?: string;
  market_kind?: "HIGH" | "LOW";
  min_edge?: number;
  min_confidence?: number;
  min_agreement?: number;
  limit?: number;
  sort?: "edge" | "confidence" | "disagreement" | "close";
};

export type WeatherOpportunitiesResponse = {
  ts: number;
  generated_at: number;
  count: number;
  total_count: number;
  cache_ttl_seconds: number;
  errors: string[];
  rows: WeatherOpportunity[];
};

export type BotSignal = {
  ticker: string;
  source: "weather" | "econ" | string;
  source_id: number;
  side?: string | null;
  model_yes_probability?: number | null;
  model_side_probability?: number | null;
  confidence?: number | null;
  member_count?: number | null;
  entry_price?: number | null;
  bot_edge?: number | null;
  score?: number | null;
  was_chosen: boolean;
  skip_reason?: string | null;
  observed_at?: string | null;
};

export type BotSignalsResponse = {
  ts: number;
  signals: BotSignal[];
  sources: { source: string; path: string; available: boolean; error?: string | null }[];
  count: number;
};

export type PoliticsMarket = {
  ticker: string;
  title: string | null;
  event_title: string | null;
  yes_bid_cents: number;
  yes_ask_cents: number;
  last_price_cents: number;
  mid_cents: number | null;
  volume_24h: number;
  open_interest: number;
  change_24h_cents: number | null;
  expiration_time: string | null;
  status: string | null;
};

export type PoliticsGroup = {
  id: string;
  label: string;
  kind: "nominee" | "party" | "chamber" | "approval" | "binary" | string;
  party: "D" | "R" | null;
  event_ticker: string;
  event_title: string | null;
  markets: PoliticsMarket[];
  error: string | null;
};

export type PoliticsMarketsResponse = {
  ts: number;
  groups: PoliticsGroup[];
};

export type PoliticsNewsItem = {
  source_id: string;
  source_name: string;
  title: string;
  link: string;
  published_ts: number | null;
  summary: string | null;
};

export type PoliticsNewsResponse = {
  ts: number;
  items: PoliticsNewsItem[];
  sources: { id: string; name: string; item_count: number; ok: boolean; error: string | null }[];
};

export type SportsMarket = {
  ticker: string;
  title: string | null;
  yes_bid_cents: number;
  yes_ask_cents: number;
  last_price_cents: number;
  mid_cents: number | null;
  volume_24h: number;
  open_interest: number;
  change_24h_cents: number | null;
  status: string | null;
  expiration_time: string | null;
};

export type SportsGame = {
  sport_id: string;
  sport_label: string;
  event_ticker: string;
  title: string | null;
  sub_title: string | null;
  expected_expiration_time: string | null;
  markets: SportsMarket[];
  series_summary?: string | null;
  extra_markets?: Record<string, SportsMarket[]>;
  team_records?: Record<string, string>;
  series_stats?: SeriesStats | null;
};

export type PgaLeaderboardPlayer = {
  pos: string | null;
  name: string | null;
  score: string | null;
  thru: string | null;
};

export type PgaLeaderboard = {
  tournament?: string | null;
  short_name?: string | null;
  status?: string | null;
  state?: string | null;
  date?: string | null;
  leaders?: PgaLeaderboardPlayer[];
};

export type SportsFuturesGroup = {
  id: string;
  sport_id: string;
  label: string;
  kind: string;
  event_ticker: string;
  event_title: string | null;
  markets: SportsMarket[];
  error: string | null;
};

export type SportsMeta = {
  id: string;
  label: string;
  series_ticker: string;
  game_count: number;
};

export type GolfTournamentSection = {
  label: string;
  sort: number;
  event_ticker: string;
  markets: SportsMarket[];
};

export type GolfTournament = {
  tournament_code: string;
  event_title: string | null;
  sections: GolfTournamentSection[];
};

export type SeriesTeamStat = {
  abbrev: string;
  name?: string | null;
  season_record?: string | null;
  series_wins?: number | null;
};

export type SeriesLastGameSide = { abbrev: string; score: number | null; winner: boolean };

export type SeriesLastGame = {
  short_name?: string | null;
  date?: string | null;
  ot?: string | null;
  sides?: SeriesLastGameSide[];
};

export type SeriesStats = {
  summary?: string | null;
  total_games?: number | null;
  teams?: SeriesTeamStat[];
  next_game?: { short_detail?: string | null; date?: string | null } | null;
  last_game?: SeriesLastGame | null;
};

export type PlayoffSeries = {
  sport_id: string;
  sport_label: string;
  event_ticker: string;
  title: string | null;
  sub_title: string | null;
  markets: SportsMarket[];
  series_summary?: string | null;
  series_stats?: SeriesStats | null;
};

export type SportsMarketsResponse = {
  ts: number;
  live_games: SportsGame[];
  futures: SportsFuturesGroup[];
  sports: SportsMeta[];
  sport_labels: Record<string, string>;
  not_offered: string[];
  pga_leaderboard?: PgaLeaderboard;
  playoff_series?: PlayoffSeries[];
  golf_tournaments?: GolfTournament[];
};

export type NhlTeam = {
  abbrev: string | null;
  name: string | null;
  place: string | null;
  score: number | null;
  sog: number | null;
  logo: string | null;
  season_record?: string | null;
};

export type NhlClock = {
  time_remaining: string | null;
  running: boolean;
  in_intermission: boolean;
};

export type NhlGame = {
  id: number | null;
  state: string | null;
  start_utc: string | null;
  venue: string | null;
  period: number | null;
  period_type: string | null;
  clock: NhlClock | null;
  home: NhlTeam;
  away: NhlTeam;
  game_center_url: string | null;
  series_stats?: SeriesStats | null;
};

export type NhlScoresResponse = {
  ts: number;
  current_date: string | null;
  games: NhlGame[];
  error: string | null;
};

export type EspnTeam = {
  abbrev: string | null;
  name: string | null;
  display_name: string | null;
  logo: string | null;
  score: number | null;
  record: string | null;
  home_away: string | null;
};

export type NbaGame = {
  id: string | null;
  state: string | null;
  short_detail: string | null;
  detail: string | null;
  completed: boolean;
  start_utc: string | null;
  home: EspnTeam;
  away: EspnTeam;
  series_summary: string | null;
  link: string | null;
  series_stats?: SeriesStats | null;
};

export type NbaScoresResponse = {
  ts: number;
  games: NbaGame[];
  error: string | null;
};

export type MlbGame = {
  id: string | null;
  state: string | null;
  short_detail: string | null;
  detail: string | null;
  completed: boolean;
  start_utc: string | null;
  home: EspnTeam;
  away: EspnTeam;
  inning: number | null;
  inning_state: string | null;
  outs: number | null;
  balls: number | null;
  strikes: number | null;
  on_base: { first: boolean; second: boolean; third: boolean };
  link: string | null;
  series_stats?: SeriesStats | null;
};

export type MlbScoresResponse = {
  ts: number;
  games: MlbGame[];
  error: string | null;
};

export type GolfLeader = {
  pos: string | null;
  name: string | null;
  country: string | null;
  score: string | null;
  thru: string | null;
  today: string | null;
};

export type GolfLeaderboardResponse = {
  ts: number;
  tournament: string | null;
  short_name: string | null;
  status: string | null;
  state: string | null;
  detail: string | null;
  date: string | null;
  leaders: GolfLeader[];
  error: string | null;
};

export const api = {
  summary: () => fetchJson<Summary>("/api/summary"),
  positions: (category?: string) =>
    fetchJson<{ positions: Position[] }>(
      "/api/positions" + (category && category !== "All" ? `?category=${encodeURIComponent(category)}` : "")
  ),
  fills: (limit = 30) => fetchJson<{ fills: Fill[] }>(`/api/fills?limit=${limit}`),
  settlements: (period: "today" | "all" = "today", limit = 30) =>
    fetchJson<SettlementsResponse>(`/api/settlements?period=${period}&limit=${limit}`),
  equityCurve: () => fetchJson<{ points: EquityPoint[] }>("/api/equity-curve"),
  pnlByCategory: () => fetchJson<{ categories: CategoryPnl[] }>("/api/pnl-by-category"),
  pnlSummary: (range: PnlRange = "all") =>
    fetchJson<CategorySummary>(`/api/pnl/summary?range=${range}`),
  pnlCategory: (name: string, range: PnlRange = "all") =>
    fetchJson<CategoryDetail>(`/api/pnl/category/${encodeURIComponent(name)}?range=${range}`),
  pnlRefresh: async (full = false) => {
    const res = await fetch(API_BASE + `/api/pnl/refresh?full=${full}`, {
      method: "POST",
      headers: { "X-Dashboard-Password": pwd() },
    });
    if (!res.ok) throw new Error(`pnl refresh -> ${res.status}`);
    return res.json() as Promise<{ refreshed_ts: number; settlement_count: number; max_settled_ts: number }>;
  },
  risk: () => fetchJson<Risk>("/api/risk"),
  scorecard: () => fetchJson<Scorecard>("/api/scorecard"),
  trackRecord: () => fetchJson<TrackRecord>("/api/track-record"),
  attention: () => fetchJson<AttentionResponse>("/api/attention"),
  marketHistory: (ticker: string, hours = 24, period = 60) =>
    fetchJson<{ ticker: string; points: { ts: number; yes_price_cents: number }[] }>(
      `/api/market-history?ticker=${encodeURIComponent(ticker)}&hours=${hours}&period=${period}`
    ),

  weatherGuidance: (tickers?: string[]) => {
    const qs = tickers && tickers.length > 0
      ? `?tickers=${encodeURIComponent(tickers.join(","))}`
      : "";
    return fetchJson<WeatherGuidanceResponse>(`/api/weather-guidance${qs}`);
  },
  weatherOpportunities: (params: WeatherOpportunitiesParams = {}) => {
    const qs = new URLSearchParams();
    if (params.city) qs.set("city", params.city);
    if (params.market_kind) qs.set("market_kind", params.market_kind);
    if (params.min_edge !== undefined) qs.set("min_edge", String(params.min_edge));
    if (params.min_confidence !== undefined) qs.set("min_confidence", String(params.min_confidence));
    if (params.min_agreement !== undefined) qs.set("min_agreement", String(params.min_agreement));
    if (params.limit !== undefined) qs.set("limit", String(params.limit));
    if (params.sort) qs.set("sort", params.sort);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return fetchJson<WeatherOpportunitiesResponse>(`/api/weather/opportunities${suffix}`);
  },
  botSignals: (tickers?: string[]) => {
    const qs = tickers && tickers.length > 0
      ? `?tickers=${encodeURIComponent(tickers.join(","))}`
      : "";
    return fetchJson<BotSignalsResponse>(`/api/bot-signals${qs}`);
  },
  politicsMarkets: () => fetchJson<PoliticsMarketsResponse>("/api/politics/markets"),
  politicsNews: (limit = 40) => fetchJson<PoliticsNewsResponse>(`/api/politics/news?limit=${limit}`),
  sportsMarkets: () => fetchJson<SportsMarketsResponse>("/api/sports/markets"),
  sportsNews: (limit = 40) => fetchJson<PoliticsNewsResponse>(`/api/sports/news?limit=${limit}`),
  nhlScores: () => fetchJson<NhlScoresResponse>("/api/nhl/scores"),
  nbaScores: () => fetchJson<NbaScoresResponse>("/api/nba/scores"),
  mlbScores: () => fetchJson<MlbScoresResponse>("/api/mlb/scores"),
  golfLeaderboard: () => fetchJson<GolfLeaderboardResponse>("/api/golf/leaderboard"),
  ensembleCities: () => fetchJson<EnsembleCitiesResponse>("/api/ensemble/cities"),
  ensembleRun: (params: EnsembleRunParams) => {
    const qs = new URLSearchParams();
    qs.set("date", params.date);
    if (params.model) qs.set("model", params.model);
    qs.set("mode", params.mode);
    if (params.city) qs.set("city", params.city);
    if (params.lat !== undefined) qs.set("lat", String(params.lat));
    if (params.lon !== undefined) qs.set("lon", String(params.lon));
    if (params.timezone) qs.set("timezone", params.timezone);
    if (params.threshold !== undefined && params.threshold !== null) {
      qs.set("threshold", String(params.threshold));
      qs.set("direction", params.direction);
    }
    return fetchJson<EnsembleRunResult>(`/api/ensemble/run?${qs.toString()}`);
  },
};

export type EnsembleCity = { key: string; label: string; timezone: string };
export type EnsembleCitiesResponse = { ts: number; cities: EnsembleCity[] };

export type EnsembleRunParams = {
  date: string;
  model?: "gfs" | "ecmwf";
  mode: "high" | "low";
  city?: string;
  lat?: number;
  lon?: number;
  timezone?: string;
  threshold?: number | null;
  direction: "above" | "below";
};

export type EnsembleRunResult = {
  ts: number;
  location_label: string;
  latitude: number;
  longitude: number;
  timezone: string;
  forecast_date: string;
  model: "gfs" | "ecmwf";
  model_label: string;
  model_description: string;
  api_model: string;
  mode: "high" | "low";
  member_count: number;
  members: number[];
  summary: { min: number; max: number; mean: number; median: number; stddev: number };
  threshold: number | null;
  direction: "above" | "below" | null;
  probability: number | null;
};

export function fmtUsd(cents: number, sign = false): string {
  const n = cents / 100;
  const abs = Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const s = n < 0 ? `-$${abs}` : sign && n > 0 ? `+$${abs}` : `$${abs}`;
  return s;
}

export function fmtCents(cents: number): string {
  return `${cents}¢`;
}
