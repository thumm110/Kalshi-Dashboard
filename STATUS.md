# Kalshi Dashboard — Status

Personal Kalshi trading dashboard. FastAPI + React + Tailwind, polling every 4s.

## Done

### Core (All-category view)
- Auth via shared password header
- KPI row (Total PnL, Unrealized, Cash, Exposure, Worst/Best Case)
- Equity curve (from snapshot DB, built over time)
- PnL by category
- Positions table (sortable, fractional-qty aware)
- Recent fills feed
- Position heatmap (size ∝ exposure, color ∝ PnL)
- Category filter bar

### Backend
- Kalshi v2 client with RSA-PSS request signing
- `/api/summary` `/api/positions` `/api/fills` `/api/equity-curve`
  `/api/pnl-by-category` `/api/risk` `/api/market-history` `/api/health`
- Snapshot loop persists equity history to SQLite
- Per-position liquidation pricing (yes_bid for YES, 100-yes_ask for NO) —
  matches Kalshi app's displayed "market value"

### Weather sub-page
- US map with city dots (react-simple-maps)
- Dots color by PnL, pulse on each poll, click to select
- Per-city 24h price sparklines (Kalshi candlesticks)
- By-event-type panel (HIGH / LOW / RAIN / SNOW / HUR / EMERGENCY)
- Positions table filtered to selected city
- ±5¢ dead-zone around breakeven to stop red↔gray strobing

### Economics sub-page
- Release timeline (vertical, sorted by expiration)
- Events grouped by `event_ticker` (e.g. "KXCPIYOY-26APR")
- Expandable strike-strip per event: 0–100¢ axis, YES=filled / NO=outline,
  size ∝ contracts, x = implied probability
- By-macro-series panel (CPI / Fed / Jobs / GDP / Unemployment)
- Countdown to next release, selected-event filter for positions table

## TODO

### Sub-pages to build (same theme-per-category approach)
- [ ] **Crypto** — price-chart centric; BTC/ETH spot overlay with position strikes
- [ ] **Sports** — game-card layout; live scores, time-to-tipoff, team logos
- [ ] **Politics** — candidate/outcome board; election maps for presidential,
      horse-race bars for primaries / senate races
- [ ] **Entertainment** — awards-show bracket layout (Oscars/Emmys nominees
      as a grid, your bet highlighted)
- [ ] **Other** — fallback generic grid

### Polish / features
- [ ] Remote access (Tailscale is set up; needs auth hardening before
      exposing beyond LAN)
- [ ] Mobile layout audit (grids collapse but haven't been tested on phone)
- [ ] "Scenario" strip on Economics: payout if CPI print lands at X
- [ ] Historical PnL attribution by category (over time, not just snapshot)
- [ ] Fill-based cost-basis calc (we trust Kalshi's `market_exposure_dollars`
      today — could reconstruct from fills for independent audit)
- [ ] Alerting: push/email when a position moves past a threshold
- [ ] Pagination: `/portfolio/positions?limit=500` is capped — if user
      holds >500 open, need to page

### Known issues / quirks
- `last_updated_ts` from Kalshi only updates on user trades (not market
  ticks) — we don't use it as a staleness signal anymore
- `resting_orders_count` is surfaced in the API but not shown in UI yet

## Deployment
- Intended: Vercel (frontend) + Railway/Fly (backend)
- Currently: local only via `./start.sh` (uvicorn + vite on 8000/5173)

## Files of note
- `backend/app/main.py` — all HTTP endpoints
- `backend/app/kalshi_client.py` — signed v2 client
- `backend/app/snapshot.py` — equity-curve persistence loop
- `frontend/src/App.tsx` — poll loop, category routing
- `frontend/src/pages/WeatherPage.tsx` / `EconomicsPage.tsx` — themed pages
- `frontend/src/lib/cities.ts` — weather series → city map
- `frontend/src/lib/macro.ts` — economics series → event grouping
