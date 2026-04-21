const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

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
