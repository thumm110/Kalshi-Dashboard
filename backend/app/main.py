"""FastAPI app exposing dashboard endpoints."""
import asyncio
import logging
import time
from contextlib import asynccontextmanager
from typing import Any

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .analytics import build_attention, build_scorecard, build_track_record
from .bot_signals import fetch_bot_signals, fetch_weather_scan_activity
from .categorize import categorize
from .config import settings
from .db import get_snapshots, init_db
from .kalshi_client import KalshiClient, dollars_to_cents, fp_to_float
from .pnl import (
    get_settlements_all,
    get_settlements_since,
    iso_ts,
    local_day_start_ts,
    settlement_cost_cents,
    settlement_fee_cents,
    settlement_payout_cents,
    settlement_pnl_cents,
)
from .nhl import fetch_scores as fetch_nhl_scores
from .scoreboards import fetch_golf_leaderboard, fetch_mlb_scores, fetch_nba_scores
from .pnl_by_category import (
    build_category_detail,
    build_category_summary,
    get_cached_or_refresh,
    refresh_settlements_cache,
)
from .politics import fetch_politics_markets, fetch_politics_news
from .sports import fetch_sports_markets, fetch_sports_news
from .discover import discover_events
from .ensemble import (
    CITY_PRESETS,
    fetch_ensemble,
    get_ensemble_model,
    get_preset,
    list_city_keys,
    probability_for_threshold,
    summarize_members,
)
from .snapshot import snapshot_loop
from .weather_guidance import fetch_weather_guidance
from .weather_locations import SERIES_TO_WEATHER_LOCATION, WEATHER_LOCATIONS
from .weather_opportunities import fetch_weather_opportunities


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


def _settlement_row(s: dict[str, Any]) -> dict[str, Any]:
    cost = settlement_cost_cents(s)
    payout = settlement_payout_cents(s)
    fee = settlement_fee_cents(s)
    pnl = settlement_pnl_cents(s)
    return {
        "ticker": s.get("ticker"),
        "event_ticker": s.get("event_ticker"),
        "category": categorize(s.get("ticker", "")),
        "market_result": s.get("market_result"),
        "yes_count": fp_to_float(s.get("yes_count_fp")),
        "no_count": fp_to_float(s.get("no_count_fp")),
        "cost_cents": cost,
        "revenue_cents": payout,
        "fee_cents": fee,
        "pnl_cents": pnl,
        "settlement_value_cents": int(s.get("value") or 0),
        "settled_time": s.get("settled_time"),
    }


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
    position_realized = sum(dollars_to_cents(p.get("realized_pnl_dollars")) for p in market_positions)
    exposure = sum(dollars_to_cents(p.get("market_exposure_dollars")) for p in open_positions)

    settlement_since_ts = local_day_start_ts()
    all_settlements = await get_settlements_all(client)
    today_settlements = [
        s for s in all_settlements
        if (iso_ts(s.get("settled_time")) or 0) >= settlement_since_ts
    ]
    today_position_realized = sum(
        dollars_to_cents(p.get("realized_pnl_dollars"))
        for p in market_positions
        if (iso_ts(p.get("last_updated_ts")) or 0) >= settlement_since_ts
    )
    settlement_pnl = sum(settlement_pnl_cents(s) for s in today_settlements)
    all_time_settlement_pnl = sum(settlement_pnl_cents(s) for s in all_settlements)
    realized = today_position_realized + settlement_pnl

    # portfolio_value from /balance is the live market value of all open positions (cents).
    portfolio_value = int(balance.get("portfolio_value", 0) or 0)
    unrealized = portfolio_value - exposure
    today_pnl = unrealized + realized
    all_time_pnl = unrealized + position_realized + all_time_settlement_pnl

    return {
        "ts": int(time.time()),
        "balance_cents": int(balance.get("balance", 0)),
        "unrealized_cents": unrealized,
        "realized_cents": realized,
        "position_realized_cents": position_realized,
        "today_position_realized_cents": today_position_realized,
        "settlement_pnl_cents": settlement_pnl,
        "all_time_settlement_pnl_cents": all_time_settlement_pnl,
        "settlement_count": len(today_settlements),
        "all_time_settlement_count": len(all_settlements),
        "settlement_since_ts": settlement_since_ts,
        "exposure_cents": exposure,
        "open_position_count": len(open_positions),
        "today_pnl_cents": today_pnl,
        "all_time_pnl_cents": all_time_pnl,
        "total_pnl_cents": today_pnl,
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

        yes_bid = dollars_to_cents(mkt.get("yes_bid_dollars"))
        yes_ask = dollars_to_cents(mkt.get("yes_ask_dollars"))
        yes_mid = (yes_bid + yes_ask) // 2 if (yes_bid and yes_ask) else (yes_bid or yes_ask or 0)
        # side-relative mid and entry (cents per contract)
        if qty >= 0:
            side_mid = yes_mid or None
        else:
            side_mid = (100 - yes_mid) if yes_mid else None
        entry_cents = int(round(exposure / abs(qty))) if qty else 0
        edge_cents = (side_mid - entry_cents) if side_mid is not None else None

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
            "yes_bid_cents": yes_bid,
            "yes_ask_cents": yes_ask,
            "yes_mid_cents": yes_mid or None,
            "side_mid_cents": side_mid,
            "entry_cents": entry_cents or None,
            "edge_cents": edge_cents,
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


@app.get("/api/settlements", dependencies=[Depends(require_auth)])
async def settlements(period: str = Query(default="today"), limit: int = Query(default=50, ge=1, le=500)):
    client = _client()
    if period.lower() == "all":
        rows = await get_settlements_all(client)
    else:
        rows = await get_settlements_since(client, local_day_start_ts())
    normalized = [_settlement_row(s) for s in rows]
    normalized.sort(key=lambda r: r.get("settled_time") or "", reverse=True)
    total_pnl = sum(r["pnl_cents"] for r in normalized)
    return {
        "ts": int(time.time()),
        "period": "all" if period.lower() == "all" else "today",
        "count": len(normalized),
        "total_pnl_cents": total_pnl,
        "settlements": normalized[:limit],
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

    settlement_since_ts = local_day_start_ts()
    settlements = await get_settlements_since(client, settlement_since_ts)
    for s in settlements:
        ticker = s.get("ticker", "")
        cat = categorize(ticker)
        b = buckets.setdefault(cat, {"unrealized": 0, "realized": 0, "exposure": 0, "count": 0})
        b["realized"] += settlement_pnl_cents(s)

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


@app.get("/api/pnl/summary", dependencies=[Depends(require_auth)])
async def pnl_summary(range: str = Query(default="all")):
    return await build_category_summary(_client(), settings.db_path, range_key=range)


@app.get("/api/pnl/category/{name}", dependencies=[Depends(require_auth)])
async def pnl_category(name: str, range: str = Query(default="all")):
    return await build_category_detail(_client(), settings.db_path, category=name, range_key=range)


@app.post("/api/pnl/refresh", dependencies=[Depends(require_auth)])
async def pnl_refresh(full: bool = Query(default=False)):
    cache = await refresh_settlements_cache(_client(), settings.db_path, full=full)
    return {
        "refreshed_ts": cache.get("refreshed_ts"),
        "settlement_count": len(cache.get("settlements", [])),
        "max_settled_ts": cache.get("max_settled_ts"),
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


@app.get("/api/scorecard", dependencies=[Depends(require_auth)])
async def scorecard():
    cache = await get_cached_or_refresh(_client(), settings.db_path)
    return build_scorecard(cache.get("settlements", []) or [])


@app.get("/api/track-record", dependencies=[Depends(require_auth)])
async def track_record():
    cache = await get_cached_or_refresh(_client(), settings.db_path)
    return build_track_record(cache.get("settlements", []) or [])


@app.get("/api/attention", dependencies=[Depends(require_auth)])
async def attention():
    cache = await get_cached_or_refresh(_client(), settings.db_path)
    return await build_attention(_client(), settings.db_path, cache.get("settlements", []) or [])


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



@app.get("/api/weather/opportunities", dependencies=[Depends(require_auth)])
async def weather_opportunities(
    city: str | None = Query(default=None),
    market_kind: str | None = Query(default=None),
    min_edge: float = Query(default=0.12, ge=0.0, le=1.0),
    min_confidence: float = Query(default=0.0, ge=0.0, le=1.0),
    min_agreement: int = Query(default=0, ge=0, le=4),
    limit: int = Query(default=250, ge=1, le=500),
    sort: str = Query(default="edge"),
):
    data = await fetch_weather_opportunities(
        _client(),
        city=city,
        market_kind=market_kind,
        min_edge=min_edge,
        min_confidence=min_confidence,
        min_agreement=min_agreement,
        limit=limit,
        sort=sort,
    )
    return {"ts": int(time.time()), **data}


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


@app.get("/api/weather/scan-activity", dependencies=[Depends(require_auth)])
async def weather_scan_activity(days: int = Query(default=14, ge=1, le=60)):
    data = fetch_weather_scan_activity(
        weather_db_path=settings.weather_bot_db_path,
        days=days,
    )
    return {"ts": int(time.time()), **data}


@app.get("/api/bot-signals", dependencies=[Depends(require_auth)])
async def bot_signals(tickers: str | None = Query(default=None)):
    requested = [ticker.strip() for ticker in tickers.split(",")] if tickers else None
    data = fetch_bot_signals(
        weather_db_path=settings.weather_bot_db_path,
        econ_db_path=settings.econ_bot_db_path,
        tickers=requested,
    )
    return {"ts": int(time.time()), **data}


@app.get("/api/politics/markets", dependencies=[Depends(require_auth)])
async def politics_markets():
    data = await fetch_politics_markets(_client())
    return {"ts": int(time.time()), **data}


@app.get("/api/politics/news", dependencies=[Depends(require_auth)])
async def politics_news(limit: int = Query(default=40, ge=1, le=100)):
    data = await fetch_politics_news(limit=limit)
    return {"ts": int(time.time()), **data}


@app.get("/api/sports/markets", dependencies=[Depends(require_auth)])
async def sports_markets():
    data = await fetch_sports_markets(_client())
    return {"ts": int(time.time()), **data}


@app.get("/api/nhl/scores", dependencies=[Depends(require_auth)])
async def nhl_scores():
    data = await fetch_nhl_scores()
    return {"ts": int(time.time()), **data}


@app.get("/api/nba/scores", dependencies=[Depends(require_auth)])
async def nba_scores():
    data = await fetch_nba_scores()
    return {"ts": int(time.time()), **data}


@app.get("/api/mlb/scores", dependencies=[Depends(require_auth)])
async def mlb_scores():
    data = await fetch_mlb_scores()
    return {"ts": int(time.time()), **data}


@app.get("/api/golf/leaderboard", dependencies=[Depends(require_auth)])
async def golf_leaderboard():
    data = await fetch_golf_leaderboard()
    return {"ts": int(time.time()), **data}


@app.get("/api/sports/news", dependencies=[Depends(require_auth)])
async def sports_news(limit: int = Query(default=40, ge=1, le=100)):
    data = await fetch_sports_news(limit=limit)
    return {"ts": int(time.time()), **data}


@app.get("/api/discover/events", dependencies=[Depends(require_auth)])
async def discover(
    q: str = "",
    limit: int = Query(default=50, ge=1, le=500),
    series_ticker: str | None = None,
):
    data = await discover_events(_client(), q=q, limit=limit, series_ticker=series_ticker)
    return {"ts": int(time.time()), **data}


@app.get("/api/ensemble/cities", dependencies=[Depends(require_auth)])
async def ensemble_cities():
    cities = [
        {
            "key": key,
            "label": CITY_PRESETS[key]["label"],
            "timezone": CITY_PRESETS[key]["timezone"],
        }
        for key in list_city_keys()
    ]
    return {"ts": int(time.time()), "cities": cities}


@app.get("/api/ensemble/run", dependencies=[Depends(require_auth)])
async def ensemble_run(
    date: str = Query(..., description="Forecast date YYYY-MM-DD"),
    city: str | None = Query(default=None),
    lat: float | None = Query(default=None),
    lon: float | None = Query(default=None),
    timezone: str | None = Query(default=None),
    model: str = Query(default="gfs"),
    mode: str = Query(default="high"),
    threshold: float | None = Query(default=None),
    direction: str = Query(default="above"),
):
    from datetime import date as _date

    try:
        forecast_date = _date.fromisoformat(date)
    except ValueError:
        raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD")
    if mode not in {"high", "low"}:
        raise HTTPException(status_code=400, detail="mode must be 'high' or 'low'")
    if direction not in {"above", "below"}:
        raise HTTPException(status_code=400, detail="direction must be 'above' or 'below'")
    normalized_model = model.strip().lower()
    try:
        ensemble_model = get_ensemble_model(normalized_model)
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))

    if city:
        try:
            preset = get_preset(city)
        except ValueError as err:
            raise HTTPException(status_code=400, detail=str(err))
        location_key = city.lower()
        latitude = float(preset["lat"])
        longitude = float(preset["lon"])
        timezone_name = str(preset["timezone"])
        location_label = str(preset["label"])
    else:
        if lat is None or lon is None or not timezone:
            raise HTTPException(status_code=400, detail="Provide either city or lat+lon+timezone")
        location_key = f"custom:{lat:.4f},{lon:.4f}"
        latitude = float(lat)
        longitude = float(lon)
        timezone_name = timezone
        location_label = "Custom coordinates"

    try:
        result = await fetch_ensemble(
            model_key=normalized_model,
            location_key=location_key,
            latitude=latitude,
            longitude=longitude,
            timezone_name=timezone_name,
            forecast_date=forecast_date,
        )
    except httpx.HTTPError as err:
        raise HTTPException(status_code=502, detail=f"Open-Meteo error: {err}")
    except RuntimeError as err:
        raise HTTPException(status_code=502, detail=str(err))

    members = result["member_highs"] if mode == "high" else result["member_lows"]
    summary = summarize_members(members)
    probability = None
    if threshold is not None:
        probability = probability_for_threshold(members, threshold, direction)

    return {
        "ts": int(time.time()),
        "location_label": location_label,
        "latitude": latitude,
        "longitude": longitude,
        "timezone": timezone_name,
        "forecast_date": result["forecast_date"],
        "model": normalized_model,
        "model_label": ensemble_model["label"],
        "model_description": ensemble_model["description"],
        "api_model": result["api_model"],
        "mode": mode,
        "member_count": result["member_count"],
        "members": members,
        "summary": summary,
        "threshold": threshold,
        "direction": direction if threshold is not None else None,
        "probability": probability,
    }


@app.get("/api/health")
async def health():
    return {"ok": True, "ts": int(time.time())}
