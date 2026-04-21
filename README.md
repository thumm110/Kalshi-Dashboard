# Tanner's Kalshi Diagnostics

Personal Kalshi trading dashboard. FastAPI backend + React (Vite + TS) frontend, Bloomberg-terminal aesthetic, live polling with heartbeat.

## Layout

```
backend/    FastAPI + Kalshi RSA-signed client + SQLite snapshotter
frontend/   Vite + React + Tailwind + Recharts dashboard UI
```

## Local run

### 1. Backend

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Place your Kalshi RSA private key PEM here (download from Kalshi account settings)
cp /path/to/your/key.pem ./kalshi_private_key.pem

cp .env.example .env
# edit .env: set KALSHI_API_KEY_ID and DASHBOARD_PASSWORD

uvicorn app.main:app --reload --port 8000
```

### 2. Frontend

```bash
cd frontend
npm install
cp .env.example .env.local        # VITE_API_BASE=http://localhost:8000
npm run dev                        # http://localhost:5173
```

Log in with `DASHBOARD_PASSWORD`. The equity curve starts building immediately as the backend snapshots every `SNAPSHOT_INTERVAL_SECONDS` (default 30s).

## Deploy

- **Frontend → Vercel**: import `frontend/`, set `VITE_API_BASE` to your backend URL.
- **Backend → Railway or Fly.io**: deploy `backend/`. Set env vars from `.env.example`. Upload the private key as a secret file at `KALSHI_PRIVATE_KEY_PATH` (e.g. a Fly.io volume or Railway secret file). Set `CORS_ORIGINS` to your Vercel domain.

## API

All endpoints require `X-Dashboard-Password` header.

- `POST /api/auth/check` — validate password
- `GET  /api/summary` — balance, PnL, exposure, position count
- `GET  /api/positions?category=Weather` — open positions, optionally filtered
- `GET  /api/fills?limit=30` — recent executions
- `GET  /api/equity-curve` — historical snapshots (built from polling)
- `GET  /api/pnl-by-category` — grouped PnL by inferred category
- `GET  /api/risk` — worst-case / best-case exposure
- `GET  /api/health` — unauthenticated health check

## Notes

- Categorization is a prefix-match heuristic in `backend/app/categorize.py` — refine `CATEGORY_RULES` as you discover new series.
- Kalshi signs `{timestamp_ms}{METHOD}{path}` with RSA-PSS + SHA256.
- Main page is designed first; category-specific sub-pages are the next milestone.
