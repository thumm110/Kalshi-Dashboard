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
  exposure_cents: number;
  open_position_count: number;
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

export type Risk = {
  worst_case_loss_cents: number;
  best_case_gain_cents: number;
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

export const api = {
  summary: () => fetchJson<Summary>("/api/summary"),
  positions: (category?: string) =>
    fetchJson<{ positions: Position[] }>(
      "/api/positions" + (category && category !== "All" ? `?category=${encodeURIComponent(category)}` : "")
    ),
  fills: (limit = 30) => fetchJson<{ fills: Fill[] }>(`/api/fills?limit=${limit}`),
  equityCurve: () => fetchJson<{ points: EquityPoint[] }>("/api/equity-curve"),
  pnlByCategory: () => fetchJson<{ categories: CategoryPnl[] }>("/api/pnl-by-category"),
  risk: () => fetchJson<Risk>("/api/risk"),
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
  botSignals: (tickers?: string[]) => {
    const qs = tickers && tickers.length > 0
      ? `?tickers=${encodeURIComponent(tickers.join(","))}`
      : "";
    return fetchJson<BotSignalsResponse>(`/api/bot-signals${qs}`);
  },
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
