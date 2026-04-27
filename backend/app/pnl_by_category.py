"""Per-category PnL rollups with disk-cached settlements.

Settlements are immutable once written, so we cache them to a JSON file and
only fetch new rows since the latest `settled_time` we've seen. Unrealized PnL
is always computed live from open positions.
"""
from __future__ import annotations

import asyncio
import json
import time
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from .categorize import categorize
from .kalshi_client import KalshiClient, dollars_to_cents, fp_to_float
from .pnl import (
    get_settlements_all,
    get_settlements_since,
    iso_ts,
    settlement_cost_cents,
    settlement_fee_cents,
    settlement_payout_cents,
    settlement_pnl_cents,
)

_CACHE_LOCK = asyncio.Lock()


def _cache_path(db_path: str) -> Path:
    return Path(db_path).parent / "settlements_cache.json"


def _load_cache(db_path: str) -> dict[str, Any]:
    p = _cache_path(db_path)
    if not p.exists():
        return {"settlements": [], "max_settled_ts": 0, "refreshed_ts": 0}
    try:
        return json.loads(p.read_text())
    except Exception:
        return {"settlements": [], "max_settled_ts": 0, "refreshed_ts": 0}


def _save_cache(db_path: str, data: dict[str, Any]) -> None:
    p = _cache_path(db_path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data))


def _dedupe(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: dict[tuple, dict[str, Any]] = {}
    for r in rows:
        key = (r.get("ticker"), r.get("settled_time"))
        seen[key] = r
    return list(seen.values())


async def refresh_settlements_cache(
    client: KalshiClient, db_path: str, full: bool = False
) -> dict[str, Any]:
    """Refresh the on-disk settlements cache.

    full=True forces a complete re-pull; otherwise we only fetch rows newer
    than the highest settled_time we already have.
    """
    async with _CACHE_LOCK:
        cache = _load_cache(db_path)
        if full or not cache["settlements"]:
            rows = await get_settlements_all(client)
        else:
            # Re-fetch from one second before the latest known settled_time to
            # catch any rows Kalshi inserted with equal timestamps.
            min_ts = max(0, int(cache["max_settled_ts"]) - 1)
            new_rows = await get_settlements_since(client, min_ts)
            rows = _dedupe(list(cache["settlements"]) + new_rows)

        max_ts = 0
        for r in rows:
            ts = iso_ts(r.get("settled_time")) or 0
            if ts > max_ts:
                max_ts = ts

        cache = {
            "settlements": rows,
            "max_settled_ts": max_ts,
            "refreshed_ts": int(time.time()),
        }
        _save_cache(db_path, cache)
        return cache


def _position_value_cents(qty: float, market: dict[str, Any]) -> int:
    if qty == 0 or not market:
        return 0
    yes_bid = dollars_to_cents(market.get("yes_bid_dollars"))
    yes_ask = dollars_to_cents(market.get("yes_ask_dollars"))
    if qty > 0:
        close_price = yes_bid or dollars_to_cents(market.get("last_price_dollars")) or yes_ask
        return int(round(qty * close_price))
    no_bid = (100 - yes_ask) if yes_ask else 0
    if not no_bid:
        lp = dollars_to_cents(market.get("last_price_dollars"))
        if lp:
            no_bid = 100 - lp
        elif yes_bid:
            no_bid = 100 - yes_bid
    return int(round(abs(qty) * no_bid))


@dataclass
class CategoryStats:
    category: str
    realized_pnl_cents: int
    unrealized_pnl_cents: int
    exposure_cents: int
    open_position_count: int
    settlement_count: int
    wins: int
    losses: int
    pushes: int
    total_cost_cents: int
    total_payout_cents: int
    total_fees_cents: int

    def as_dict(self) -> dict[str, Any]:
        trades = self.wins + self.losses + self.pushes
        win_rate = (self.wins / trades) if trades else 0.0
        return {
            "category": self.category,
            "realized_pnl_cents": self.realized_pnl_cents,
            "unrealized_pnl_cents": self.unrealized_pnl_cents,
            "total_pnl_cents": self.realized_pnl_cents + self.unrealized_pnl_cents,
            "exposure_cents": self.exposure_cents,
            "open_position_count": self.open_position_count,
            "settlement_count": self.settlement_count,
            "wins": self.wins,
            "losses": self.losses,
            "pushes": self.pushes,
            "win_rate": round(win_rate, 4),
            "total_cost_cents": self.total_cost_cents,
            "total_payout_cents": self.total_payout_cents,
            "total_fees_cents": self.total_fees_cents,
        }


def _range_start_ts(range_key: str) -> int:
    now = datetime.now().astimezone()
    rk = (range_key or "all").lower()
    if rk == "7d":
        return int((now - timedelta(days=7)).timestamp())
    if rk == "30d":
        return int((now - timedelta(days=30)).timestamp())
    if rk == "ytd":
        jan1 = now.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
        return int(jan1.timestamp())
    return 0


def _filter_by_range(settlements: list[dict[str, Any]], range_key: str) -> list[dict[str, Any]]:
    min_ts = _range_start_ts(range_key)
    if min_ts <= 0:
        return list(settlements)
    return [s for s in settlements if (iso_ts(s.get("settled_time")) or 0) >= min_ts]


def _bucket_settlements_by_category(settlements: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    out: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for s in settlements:
        cat = categorize(s.get("ticker", ""))
        out[cat].append(s)
    return out


def _stats_from_rows(
    category: str,
    settlements: list[dict[str, Any]],
    open_positions: list[tuple[float, dict[str, Any], dict[str, Any]]],
) -> CategoryStats:
    realized = 0
    cost = 0
    payout = 0
    fees = 0
    wins = losses = pushes = 0
    for s in settlements:
        pnl = settlement_pnl_cents(s)
        realized += pnl
        cost += settlement_cost_cents(s)
        payout += settlement_payout_cents(s)
        fees += settlement_fee_cents(s)
        if pnl > 0:
            wins += 1
        elif pnl < 0:
            losses += 1
        else:
            pushes += 1

    unrealized = 0
    exposure = 0
    for qty, pos, mkt in open_positions:
        expo = dollars_to_cents(pos.get("market_exposure_dollars"))
        mv = _position_value_cents(qty, mkt)
        unrealized += mv - expo
        exposure += expo

    return CategoryStats(
        category=category,
        realized_pnl_cents=realized,
        unrealized_pnl_cents=unrealized,
        exposure_cents=exposure,
        open_position_count=len(open_positions),
        settlement_count=len(settlements),
        wins=wins,
        losses=losses,
        pushes=pushes,
        total_cost_cents=cost,
        total_payout_cents=payout,
        total_fees_cents=fees,
    )


def _series_prefix(ticker: str) -> str:
    return (ticker or "").split("-", 1)[0]


def _series_breakdown(settlements: list[dict[str, Any]]) -> list[dict[str, Any]]:
    buckets: dict[str, dict[str, Any]] = defaultdict(lambda: {
        "pnl_cents": 0, "cost_cents": 0, "fees_cents": 0,
        "wins": 0, "losses": 0, "pushes": 0, "count": 0,
    })
    for s in settlements:
        series = _series_prefix(s.get("ticker", ""))
        b = buckets[series]
        pnl = settlement_pnl_cents(s)
        b["pnl_cents"] += pnl
        b["cost_cents"] += settlement_cost_cents(s)
        b["fees_cents"] += settlement_fee_cents(s)
        b["count"] += 1
        if pnl > 0:
            b["wins"] += 1
        elif pnl < 0:
            b["losses"] += 1
        else:
            b["pushes"] += 1
    rows = [{"series": k, **v} for k, v in buckets.items()]
    rows.sort(key=lambda r: r["pnl_cents"])
    return rows


def _daily_cumulative_series(settlements: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Returns a list of {ts, daily_pnl_cents, cumulative_pnl_cents} sorted by day."""
    by_day: dict[int, int] = defaultdict(int)
    for s in settlements:
        ts = iso_ts(s.get("settled_time"))
        if ts is None:
            continue
        dt = datetime.fromtimestamp(ts).astimezone()
        day_start = dt.replace(hour=0, minute=0, second=0, microsecond=0)
        by_day[int(day_start.timestamp())] += settlement_pnl_cents(s)

    out = []
    cum = 0
    for day_ts in sorted(by_day):
        cum += by_day[day_ts]
        out.append({
            "ts": day_ts,
            "daily_pnl_cents": by_day[day_ts],
            "cumulative_pnl_cents": cum,
        })
    return out


async def get_cached_or_refresh(
    client: KalshiClient, db_path: str, max_age_seconds: int = 300
) -> dict[str, Any]:
    cache = _load_cache(db_path)
    age = int(time.time()) - int(cache.get("refreshed_ts", 0))
    if not cache["settlements"] or age > max_age_seconds:
        cache = await refresh_settlements_cache(client, db_path)
    return cache


async def build_category_summary(
    client: KalshiClient, db_path: str, range_key: str = "all"
) -> dict[str, Any]:
    cache = await get_cached_or_refresh(client, db_path)
    settlements = _filter_by_range(cache["settlements"], range_key)
    buckets = _bucket_settlements_by_category(settlements)

    pos_data = await client.get_positions(limit=500)
    market_positions = pos_data.get("market_positions", []) or []
    open_positions = [p for p in market_positions if fp_to_float(p.get("position_fp")) != 0]
    tickers = [p.get("ticker", "") for p in open_positions]
    markets = await client.get_markets_batch(tickers) if tickers else {}

    opens_by_cat: dict[str, list[tuple[float, dict[str, Any], dict[str, Any]]]] = defaultdict(list)
    for p in open_positions:
        qty = fp_to_float(p.get("position_fp"))
        ticker = p.get("ticker", "")
        cat = categorize(ticker)
        opens_by_cat[cat].append((qty, p, markets.get(ticker, {}) or {}))

    categories = sorted(set(list(buckets.keys()) + list(opens_by_cat.keys())))
    rows = [
        _stats_from_rows(cat, buckets.get(cat, []), opens_by_cat.get(cat, [])).as_dict()
        for cat in categories
    ]
    rows.sort(key=lambda r: -r["total_pnl_cents"])

    return {
        "ts": int(time.time()),
        "range": range_key,
        "cache_refreshed_ts": cache.get("refreshed_ts"),
        "cache_settlement_count": len(cache["settlements"]),
        "categories": rows,
    }


async def build_category_detail(
    client: KalshiClient, db_path: str, category: str, range_key: str = "all"
) -> dict[str, Any]:
    cache = await get_cached_or_refresh(client, db_path)
    cat_norm = category.strip()
    all_for_cat = [
        s for s in cache["settlements"]
        if categorize(s.get("ticker", "")).lower() == cat_norm.lower()
    ]
    ranged = _filter_by_range(all_for_cat, range_key)

    pos_data = await client.get_positions(limit=500)
    market_positions = pos_data.get("market_positions", []) or []
    open_positions = [p for p in market_positions if fp_to_float(p.get("position_fp")) != 0]
    tickers = [p.get("ticker", "") for p in open_positions if categorize(p.get("ticker", "")).lower() == cat_norm.lower()]
    markets = await client.get_markets_batch(tickers) if tickers else {}
    opens = [
        (fp_to_float(p.get("position_fp")), p, markets.get(p.get("ticker", ""), {}) or {})
        for p in open_positions
        if categorize(p.get("ticker", "")).lower() == cat_norm.lower()
    ]

    stats = _stats_from_rows(cat_norm, ranged, opens).as_dict()
    series = _daily_cumulative_series(ranged)
    breakdown = _series_breakdown(ranged)

    return {
        "ts": int(time.time()),
        "category": cat_norm,
        "range": range_key,
        "cache_refreshed_ts": cache.get("refreshed_ts"),
        "stats": stats,
        "series": series,
        "series_breakdown": breakdown,
    }
