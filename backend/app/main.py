"""FastAPI app exposing dashboard endpoints."""
import asyncio
import logging
import time
from contextlib import asynccontextmanager
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .bot_signals import fetch_bot_signals
from .categorize import categorize
from .config import settings
from .db import get_snapshots, init_db
from .kalshi_client import KalshiClient, dollars_to_cents, fp_to_float
from .snapshot import snapshot_loop
from .weather_guidance import fetch_weather_guidance
from .weather_locations import SERIES_TO_WEATHER_LOCATION, WEATHER_LOCATIONS


def _position_value_cents(qty: float, market: dict) -> int:
    """Liquidation value of a position (what Kalshi shows as "market value").
    YES closes at yes_bid; NO closes at no_bid = 100 - yes_ask.
    Falls back to last_price, then to mid of bid/ask if one side is missing.
    """
    if qty == 0 or not market:
        return 0
    yes_bid = dollars_to_cents(market.get("yes_bid_dollars"))
    yes_ask = dollars_to_cents(market.get("yes_ask_dollars"))
    if qty > 0:
        close_price = yes_bid
        if not close_price:
            close_price = dollars_to_cents(market.get("last_price_dollars"))
        if not close_price and yes_ask:
            close_price = yes_ask
        return int(round(qty * close_price))
    # NO side
    no_bid = (100 - yes_ask) if yes_ask else 0
    if not no_bid:
        lp = dollars_to_cents(market.get("last_price_dollars"))
        if lp:
            no_bid = 100 - lp
        elif yes_bid:
            no_bid = 100 - yes_bid
    return int(round(abs(qty) * no_bid))

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("kalshi-dashboard")

state: dict[str, Any] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db(settings.db_path)
    client = KalshiClient(
        api_key_id=settings.kalshi_api_key_id,
        private_key_path=settings.kalshi_private_key_path,
        base_url=settings.kalshi_api_base,
    )
    state["client"] = client
    task = asyncio.create_task(
        snapshot_loop(client, settings.db_path, settings.snapshot_interval_seconds)
    )
    try:
        yield
    finally:
        task.cancel()
        await client.aclose()


app = FastAPI(title="Tanner's Kalshi Diagnostics", lifespan=lifespan)

_cors_origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
_allow_all_cors = "*" in _cors_origins

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if _allow_all_cors else _cors_origins,
    allow_credentials=not _allow_all_cors,
    allow_methods=["*"],
    allow_headers=["*"],
)


def require_auth(x_dashboard_password: str | None = Header(default=None)) -> None:
    if x_dashboard_password != settings.dashboard_password:
        raise HTTPException(status_code=401, detail="bad password")


def _client() -> KalshiClient:
    return state["client"]


# ------- Auth -------

@app.post("/api/auth/check")
async def auth_check(x_dashboard_password: str | None = Header(default=None)):
    if x_dashboard_password != settings.dashboard_password:
        raise HTTPException(status_code=401, detail="bad password")
    return {"ok": True}


# ------- Core data -------

@app.get("/api/summary", dependencies=[Depends(require_auth)])
async def summary():
    client = _client()
    balance = await client.get_balance()
    positions = await client.get_positions(limit=500)
    market_positions = positions.get("market_positions", []) or []

    open_positions = [p for p in market_positions if fp_to_float(p.get("position_fp")) != 0]
    realized = sum(dollars_to_cents(p.get("realized_pnl_dollars")) for p in market_positions)
    exposure = sum(dollars_to_cents(p.get("market_exposure_dollars")) for p in open_positions)

    # portfolio_value from /balance is the live market value of all open positions (cents).
    portfolio_value = int(balance.get("portfolio_value", 0) or 0)
    unrealized = portfolio_value - exposure

    return {
        "ts": int(time.time()),
        "balance_cents": int(balance.get("balance", 0)),
        "unrealized_cents": unrealized,
        "realized_cents": realized,
        "exposure_cents": exposure,
        "open_position_count": len(open_positions),
        "total_pnl_cents": unrealized + realized,
    }


@app.get("/api/positions", dependencies=[Depends(require_auth)])
async def positions(category: str | None = Query(default=None)):
    client = _client()
    data = await client.get_positions(limit=500)
    market_positions = data.get("market_positions", []) or []

    open_positions = [p for p in market_positions if fp_to_float(p.get("position_fp")) != 0]
    tickers = [p.get("ticker", "") for p in open_positions]
    markets = await client.get_markets_batch(tickers) if tickers else {}

    rows = []
    for p in open_positions:
        qty = fp_to_float(p.get("position_fp"))
        ticker = p.get("ticker", "")
        cat = categorize(ticker)
        if category and category.lower() != "all" and cat.lower() != category.lower():
            continue
        exposure = dollars_to_cents(p.get("market_exposure_dollars"))
        mkt = markets.get(ticker, {}) or {}
        market_value = _position_value_cents(qty, mkt)
        rows.append({
            "ticker": ticker,
            "category": cat,
            "position": int(qty) if qty == int(qty) else qty,
            "market_exposure_cents": exposure,
            "realized_pnl_cents": dollars_to_cents(p.get("realized_pnl_dollars")),
            "unrealized_pnl_cents": market_value - exposure,
            "market_value_cents": market_value,
            "total_traded_cents": dollars_to_cents(p.get("total_traded_dollars")),
            "fees_paid_cents": dollars_to_cents(p.get("fees_paid_dollars")),
            "resting_orders_count": int(p.get("resting_orders_count", 0) or 0),
            "last_updated_ts": p.get("last_updated_ts"),
            "title": mkt.get("title"),
            "event_ticker": mkt.get("event_ticker"),
            "expected_expiration_time": mkt.get("expected_expiration_time"),
            "yes_bid_cents": dollars_to_cents(mkt.get("yes_bid_dollars")),
            "yes_ask_cents": dollars_to_cents(mkt.get("yes_ask_dollars")),
            "floor_strike": mkt.get("floor_strike"),
            "cap_strike": mkt.get("cap_strike"),
            "strike_type": mkt.get("strike_type"),
        })
    rows.sort(key=lambda r: abs(r["unrealized_pnl_cents"]), reverse=True)
    return {"positions": rows}


@app.get("/api/fills", dependencies=[Depends(require_auth)])
async def fills(limit: int = 50):
    client = _client()
    data = await client.get_fills(limit=limit)
    fills_ = data.get("fills", []) or []
    return {
        "fills": [
            {
                "ticker": f.get("ticker"),
                "category": categorize(f.get("ticker", "")),
                "side": f.get("side"),
                "action": f.get("action"),
                "count": fp_to_float(f.get("count_fp")),
                "yes_price_cents": dollars_to_cents(f.get("yes_price_dollars")),
                "no_price_cents": dollars_to_cents(f.get("no_price_dollars")),
                "is_taker": f.get("is_taker"),
                "created_time": f.get("created_time"),
                "trade_id": f.get("trade_id"),
            }
            for f in fills_
        ]
    }


@app.get("/api/equity-curve", dependencies=[Depends(require_auth)])
async def equity_curve(since: int | None = None):
    rows = get_snapshots(settings.db_path, since_ts=since)
    return {
        "points": [
            {
                "ts": r["ts"],
                "equity_cents": r["balance_cents"] + r["total_unrealized_cents"],
                "balance_cents": r["balance_cents"],
                "unrealized_cents": r["total_unrealized_cents"],
                "realized_cents": r["total_realized_cents"],
                "exposure_cents": r["total_exposure_cents"],
                "position_count": r["position_count"],
            }
            for r in rows
        ]
    }


@app.get("/api/pnl-by-category", dependencies=[Depends(require_auth)])
async def pnl_by_category():
    client = _client()
    data = await client.get_positions(limit=500)
    market_positions = data.get("market_positions", []) or []
    open_positions = [p for p in market_positions if fp_to_float(p.get("position_fp")) != 0]
    tickers = [p.get("ticker", "") for p in open_positions]
    markets = await client.get_markets_batch(tickers) if tickers else {}
    buckets: dict[str, dict[str, int]] = {}
    for p in open_positions:
        qty = fp_to_float(p.get("position_fp"))
        ticker = p.get("ticker", "")
        cat = categorize(ticker)
        b = buckets.setdefault(cat, {"unrealized": 0, "realized": 0, "exposure": 0, "count": 0})
        exposure = dollars_to_cents(p.get("market_exposure_dollars"))
        market_value = _position_value_cents(qty, markets.get(ticker, {}))
        b["unrealized"] += market_value - exposure
        b["realized"] += dollars_to_cents(p.get("realized_pnl_dollars"))
        b["exposure"] += exposure
        b["count"] += 1
    return {
        "categories": [
            {
                "category": k,
                "unrealized_cents": v["unrealized"],
                "realized_cents": v["realized"],
                "exposure_cents": v["exposure"],
                "position_count": v["count"],
                "total_pnl_cents": v["unrealized"] + v["realized"],
            }
            for k, v in sorted(buckets.items(), key=lambda kv: -(kv[1]["unrealized"] + kv[1]["realized"]))
        ]
    }


@app.get("/api/risk", dependencies=[Depends(require_auth)])
async def risk():
    """Worst-case: if every position resolves against us, how much do we lose?
    For a YES position of N contracts bought at avg_price p cents, max loss = N*p.
    We approximate from market_exposure (cost basis at risk) and unrealized PnL.
    """
    client = _client()
    data = await client.get_positions(limit=500)
    market_positions = data.get("market_positions", []) or []
    worst_case_loss = 0
    best_case_gain = 0
    for p in market_positions:
        qty = fp_to_float(p.get("position_fp"))
        if qty == 0:
            continue
        exposure = dollars_to_cents(p.get("market_exposure_dollars"))
        worst_case_loss += exposure  # lose the capital at risk
        # best case: each contract resolves to $1 = 100c
        best_case_gain += int(round(abs(qty) * 100)) - exposure
    return {
        "worst_case_loss_cents": worst_case_loss,
        "best_case_gain_cents": best_case_gain,
    }


@app.get("/api/market-history", dependencies=[Depends(require_auth)])
async def market_history(
    ticker: str = Query(...),
    hours: int = Query(default=24, ge=1, le=168),
    period: int = Query(default=60),
):
    """Candlestick history for a single market. `period` is minutes (1, 60, or 1440)."""
    client = _client()
    series = ticker.split("-")[0]
    end_ts = int(time.time())
    start_ts = end_ts - hours * 3600
    try:
        data = await client.get_candlesticks(series, ticker, start_ts, end_ts, period)
    except Exception as exc:
        log.warning("candlesticks failed for %s: %s", ticker, exc)
        return {"ticker": ticker, "points": []}
    raw = data.get("candlesticks", []) or []
    if raw:
        log.info("candlestick sample for %s: %s", ticker, raw[0])
    else:
        log.info("no candlesticks returned for %s (series=%s %d..%d p=%d)",
                 ticker, series, start_ts, end_ts, period)
    points = []
    for c in raw:
        # Kalshi candlestick shape: price/yes_bid/yes_ask each have open/high/low/close/mean (cents).
        def pick(key: str):
            v = c.get(key) or {}
            for k in ("close", "mean", "open"):
                if v.get(k) is not None:
                    return v[k]
            return None
        val = pick("price")
        if val is None:
            bid = pick("yes_bid")
            ask = pick("yes_ask")
            if bid is not None and ask is not None:
                val = (bid + ask) // 2
            elif bid is not None:
                val = bid
            elif ask is not None:
                val = ask
        if val is None:
            continue
        points.append({"ts": int(c.get("end_period_ts") or 0), "yes_price_cents": int(val)})
    return {"ticker": ticker, "points": points}


@app.get("/api/weather-guidance", dependencies=[Depends(require_auth)])
async def weather_guidance(tickers: str | None = Query(default=None)):
    """Live NWS observations for Kalshi-supported weather locations.

    If `tickers` is supplied, returns only locations matching those market
    tickers. Otherwise returns every configured Kalshi daily-temperature city.
    """
    requested: dict[str, Any] = {}
    if tickers:
        for ticker in tickers.split(","):
            series = ticker.strip().split("-")[0]
            location = SERIES_TO_WEATHER_LOCATION.get(series)
            if location:
                requested[location.code] = location
    else:
        requested = {location.code: location for location in WEATHER_LOCATIONS}

    locations = sorted(requested.values(), key=lambda loc: loc.code)
    rows = await fetch_weather_guidance(locations) if locations else []
    return {
        "ts": int(time.time()),
        "locations": rows,
        "source_note": (
            "Intraday guidance uses NWS station observations. Kalshi weather markets "
            "settle from the applicable final NWS climate report/rules source."
        ),
    }


@app.get("/api/bot-signals", dependencies=[Depends(require_auth)])
async def bot_signals(tickers: str | None = Query(default=None)):
    requested = [ticker.strip() for ticker in tickers.split(",")] if tickers else None
    data = fetch_bot_signals(
        weather_db_path=settings.weather_bot_db_path,
        econ_db_path=settings.econ_bot_db_path,
        tickers=requested,
    )
    return {"ts": int(time.time()), **data}


@app.get("/api/health")
async def health():
    return {"ok": True, "ts": int(time.time())}
