// Helpers for grouping economics-category positions by macro release event.
// A Kalshi ticker like "KXCPIYOY-26APR-T3.6" decomposes as
//   series="KXCPIYOY", event="KXCPIYOY-26APR", strike="T3.6".

import type { Position } from "./api";

export type MacroKind = "CPI" | "FED" | "JOBS" | "GDP" | "UNEMP" | "OTHER";

export const MACRO_KIND_LABEL: Record<MacroKind, string> = {
  CPI: "CPI",
  FED: "Fed Funds",
  JOBS: "Jobs / NFP",
  GDP: "GDP",
  UNEMP: "Unemployment",
  OTHER: "Other Macro",
};

export function seriesFromTicker(ticker: string): string {
  return (ticker || "").split("-")[0];
}

export function eventTicker(ticker: string): string {
  // Event is the first two dash-segments, e.g. "KXCPIYOY-26APR".
  const parts = (ticker || "").split("-");
  return parts.slice(0, 2).join("-");
}

export function macroKindFromSeries(series: string): MacroKind {
  const s = (series || "").toUpperCase();
  if (s.includes("CPI")) return "CPI";
  if (s.includes("FED")) return "FED";
  if (s.includes("JOBS") || s.includes("NFP") || s.includes("PAYROLL")) return "JOBS";
  if (s.includes("GDP")) return "GDP";
  if (s.includes("UNEMP")) return "UNEMP";
  return "OTHER";
}

export type MacroEvent = {
  eventTicker: string;
  kind: MacroKind;
  label: string;          // human title, e.g. "CPI YoY · Apr 2026"
  expirationTs: number | null;  // unix seconds, earliest known across positions
  positions: Position[];
  totalPnl: number;        // cents
  totalExposure: number;   // cents
};

const MONTHS: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};

/** Parse "26APR" → "Apr 2026", or return null if we can't. */
function prettyEventMonth(eventTicker: string): string | null {
  const tail = eventTicker.split("-")[1] || "";
  const m = tail.match(/^(\d{2})([A-Z]{3})/);
  if (!m) return null;
  const yy = parseInt(m[1], 10);
  const mon = MONTHS[m[2]];
  if (!mon) return null;
  const year = 2000 + yy;
  const monthName = Object.keys(MONTHS).find((k) => MONTHS[k] === mon) || "";
  const nice = monthName.charAt(0) + monthName.slice(1).toLowerCase();
  return `${nice} ${year}`;
}

function kindLongLabel(kind: MacroKind): string {
  switch (kind) {
    case "CPI":   return "CPI YoY";
    case "FED":   return "Fed Funds";
    case "JOBS":  return "Nonfarm Payrolls";
    case "GDP":   return "GDP";
    case "UNEMP": return "Unemployment";
    default:      return "Macro";
  }
}

export function groupByEvent(positions: Position[]): MacroEvent[] {
  const by = new Map<string, MacroEvent>();
  for (const p of positions) {
    const ev = eventTicker(p.ticker);
    const kind = macroKindFromSeries(seriesFromTicker(p.ticker));
    const existing = by.get(ev);
    const expTs = p.expected_expiration_time
      ? Math.floor(new Date(p.expected_expiration_time).getTime() / 1000)
      : null;
    if (existing) {
      existing.positions.push(p);
      existing.totalPnl += p.unrealized_pnl_cents + p.realized_pnl_cents;
      existing.totalExposure += p.market_exposure_cents;
      if (expTs != null && (existing.expirationTs == null || expTs < existing.expirationTs)) {
        existing.expirationTs = expTs;
      }
    } else {
      const monthLabel = prettyEventMonth(ev);
      const label = monthLabel ? `${kindLongLabel(kind)} · ${monthLabel}` : kindLongLabel(kind);
      by.set(ev, {
        eventTicker: ev,
        kind,
        label,
        expirationTs: expTs,
        positions: [p],
        totalPnl: p.unrealized_pnl_cents + p.realized_pnl_cents,
        totalExposure: p.market_exposure_cents,
      });
    }
  }
  // Sort: soonest first, then unknowns last
  return Array.from(by.values()).sort((a, b) => {
    if (a.expirationTs == null && b.expirationTs == null) return 0;
    if (a.expirationTs == null) return 1;
    if (b.expirationTs == null) return -1;
    return a.expirationTs - b.expirationTs;
  });
}

export function countdown(tsSeconds: number | null, nowMs = Date.now()): string {
  if (tsSeconds == null) return "—";
  const delta = tsSeconds * 1000 - nowMs;
  const abs = Math.abs(delta);
  const days = Math.floor(abs / 86_400_000);
  const hours = Math.floor((abs % 86_400_000) / 3_600_000);
  const mins = Math.floor((abs % 3_600_000) / 60_000);
  const core = days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  return delta < 0 ? `${core} ago` : `in ${core}`;
}

/** Implied probability (0-1) from yes_bid/yes_ask mid, or null if not quotable. */
export function impliedProb(p: Position): number | null {
  const bid = p.yes_bid_cents ?? 0;
  const ask = p.yes_ask_cents ?? 0;
  if (bid && ask) return (bid + ask) / 200;
  if (bid) return bid / 100;
  if (ask) return ask / 100;
  return null;
}
