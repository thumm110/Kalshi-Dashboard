"""Trader analytics: scorecard, track record by series, attention signals.

Leverages the existing settlements cache (see pnl_by_category.py) as the
historical trade record, and the live positions/fills/snapshots for
current-state signals.
"""
from __future__ import annotations

import math
import time
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Any

from .categorize import categorize
from .db import get_snapshots
from .kalshi_client import KalshiClient, dollars_to_cents, fp_to_float
from .pnl import (
    iso_ts,
    settlement_cost_cents,
    settlement_fee_cents,
    settlement_payout_cents,
    settlement_pnl_cents,
)
from .pnl_by_category import get_cached_or_refresh


def _series_prefix(ticker: str) -> str:
    return (ticker or "").split("-", 1)[0]


def _mid_cents(market: dict[str, Any]) -> int | None:
    yb = dollars_to_cents(market.get("yes_bid_dollars"))
    ya = dollars_to_cents(market.get("yes_ask_dollars"))
    if yb and ya:
        return (yb + ya) // 2
    lp = dollars_to_cents(market.get("last_price_dollars"))
    if lp:
        return lp
    return yb or ya or None


# ---------- Scorecard ----------

def _streak(sorted_pnls: list[int]) -> tuple[str, int]:
    """Given settlements sorted newest-first, return ('W'|'L', count)."""
    if not sorted_pnls:
        return ("-", 0)
    first = sorted_pnls[0]
    if first == 0:
        return ("-", 0)
    sign = "W" if first > 0 else "L"
    count = 0
    for p in sorted_pnls:
        if p == 0:
            break
        cur = "W" if p > 0 else "L"
        if cur != sign:
            break
        count += 1
    return (sign, count)


def _max_drawdown_cents(daily_pnls: list[tuple[int, int]]) -> tuple[int, float]:
    """Given [(day_ts, daily_pnl)] sorted ascending, return (max dd cents, max dd % of peak)."""
    cum = 0
    peak = 0
    max_dd = 0
    max_dd_pct = 0.0
    for _, p in daily_pnls:
        cum += p
        if cum > peak:
            peak = cum
        dd = peak - cum
        if dd > max_dd:
            max_dd = dd
            max_dd_pct = (dd / peak) if peak > 0 else 0.0
    return (max_dd, max_dd_pct)


def build_scorecard(settlements_all: list[dict[str, Any]]) -> dict[str, Any]:
    """Scorecard over all cached settlements + 30d window."""
    now_ts = int(time.time())
    cutoff_30d = now_ts - 30 * 86400

    def metrics(rows: list[dict[str, Any]]) -> dict[str, Any]:
        if not rows:
            return {
                "trade_count": 0,
                "wins": 0,
                "losses": 0,
                "pushes": 0,
                "win_rate": 0.0,
                "total_pnl_cents": 0,
                "avg_win_cents": 0,
                "avg_loss_cents": 0,
                "win_loss_ratio": 0.0,
                "expectancy_cents": 0.0,
                "best_trade_cents": 0,
                "worst_trade_cents": 0,
            }
        pnls = [settlement_pnl_cents(s) for s in rows]
        wins = [p for p in pnls if p > 0]
        losses = [p for p in pnls if p < 0]
        pushes = [p for p in pnls if p == 0]
        total = sum(pnls)
        avg_w = (sum(wins) / len(wins)) if wins else 0.0
        avg_l = (sum(losses) / len(losses)) if losses else 0.0
        trades = len(pnls)
        win_rate = len(wins) / trades if trades else 0.0
        exp = total / trades if trades else 0.0
        ratio = (avg_w / abs(avg_l)) if avg_l else 0.0
        return {
            "trade_count": trades,
            "wins": len(wins),
            "losses": len(losses),
            "pushes": len(pushes),
            "win_rate": round(win_rate, 4),
            "total_pnl_cents": int(round(total)),
            "avg_win_cents": int(round(avg_w)),
            "avg_loss_cents": int(round(avg_l)),
            "win_loss_ratio": round(ratio, 3),
            "expectancy_cents": round(exp, 2),
            "best_trade_cents": max(pnls) if pnls else 0,
            "worst_trade_cents": min(pnls) if pnls else 0,
        }

    sorted_newest_first = sorted(
        settlements_all,
        key=lambda s: iso_ts(s.get("settled_time")) or 0,
        reverse=True,
    )
    recent_30d = [s for s in sorted_newest_first if (iso_ts(s.get("settled_time")) or 0) >= cutoff_30d]

    by_day: dict[int, int] = defaultdict(int)
    for s in settlements_all:
        ts = iso_ts(s.get("settled_time"))
        if ts is None:
            continue
        dt = datetime.fromtimestamp(ts).astimezone()
        day_start = int(dt.replace(hour=0, minute=0, second=0, microsecond=0).timestamp())
        by_day[day_start] += settlement_pnl_cents(s)
    daily_series = sorted(by_day.items())

    streak_sign, streak_count = _streak([settlement_pnl_cents(s) for s in sorted_newest_first])
    max_dd_cents, max_dd_pct = _max_drawdown_cents(daily_series)

    daily_pnls = [p for _, p in daily_series]
    if len(daily_pnls) >= 2:
        mean = sum(daily_pnls) / len(daily_pnls)
        var = sum((p - mean) ** 2 for p in daily_pnls) / (len(daily_pnls) - 1)
        stdev = math.sqrt(var)
        sharpe_daily = (mean / stdev) if stdev > 0 else 0.0
        sharpe_ann = sharpe_daily * math.sqrt(252)
    else:
        mean = 0.0
        stdev = 0.0
        sharpe_ann = 0.0

    return {
        "ts": now_ts,
        "all_time": metrics(sorted_newest_first),
        "last_30d": metrics(recent_30d),
        "streak": {"sign": streak_sign, "count": streak_count},
        "max_drawdown_cents": int(max_dd_cents),
        "max_drawdown_pct": round(max_dd_pct, 4),
        "daily_pnl_mean_cents": round(mean, 2),
        "daily_pnl_stdev_cents": round(stdev, 2),
        "sharpe_annualized": round(sharpe_ann, 3),
        "active_days": len(daily_series),
    }


# ---------- Track record by series ----------

def build_track_record(settlements_all: list[dict[str, Any]]) -> dict[str, Any]:
    now_ts = int(time.time())
    buckets: dict[str, dict[str, Any]] = defaultdict(lambda: {
        "series": "",
        "category": "",
        "trade_count": 0,
        "wins": 0,
        "losses": 0,
        "pushes": 0,
        "total_pnl_cents": 0,
        "total_cost_cents": 0,
        "total_payout_cents": 0,
        "total_fees_cents": 0,
        "last_settled_ts": 0,
    })

    for s in settlements_all:
        ticker = s.get("ticker", "")
        series = _series_prefix(ticker)
        b = buckets[series]
        b["series"] = series
        b["category"] = categorize(ticker)
        pnl = settlement_pnl_cents(s)
        b["trade_count"] += 1
        b["total_pnl_cents"] += pnl
        b["total_cost_cents"] += settlement_cost_cents(s)
        b["total_payout_cents"] += settlement_payout_cents(s)
        b["total_fees_cents"] += settlement_fee_cents(s)
        if pnl > 0:
            b["wins"] += 1
        elif pnl < 0:
            b["losses"] += 1
        else:
            b["pushes"] += 1
        ts = iso_ts(s.get("settled_time")) or 0
        if ts > b["last_settled_ts"]:
            b["last_settled_ts"] = ts

    rows = []
    for b in buckets.values():
        trades = b["trade_count"]
        wr = (b["wins"] / trades) if trades else 0.0
        exp = (b["total_pnl_cents"] / trades) if trades else 0.0
        roi = (b["total_pnl_cents"] / b["total_cost_cents"]) if b["total_cost_cents"] else 0.0
        rows.append({
            **b,
            "win_rate": round(wr, 4),
            "expectancy_cents": round(exp, 2),
            "roi": round(roi, 4),
        })
    rows.sort(key=lambda r: r["total_pnl_cents"], reverse=True)
    return {"ts": now_ts, "series": rows, "count": len(rows)}


# ---------- Attention strip ----------

def _iso_to_ts(value: Any) -> int | None:
    return iso_ts(value)


async def build_attention(
    client: KalshiClient,
    db_path: str,
    settlements_all: list[dict[str, Any]],
) -> dict[str, Any]:
    now_ts = int(time.time())
    chips: list[dict[str, Any]] = []

    # Positions with markets
    pos_data = await client.get_positions(limit=500)
    market_positions = pos_data.get("market_positions", []) or []
    open_positions = [p for p in market_positions if fp_to_float(p.get("position_fp")) != 0]
    tickers = [p.get("ticker", "") for p in open_positions]
    markets = await client.get_markets_batch(tickers) if tickers else {}

    # Chip: resolving soon (<60min) with size
    for p in open_positions:
        ticker = p.get("ticker", "")
        mkt = markets.get(ticker, {}) or {}
        exp_time = mkt.get("expected_expiration_time")
        exp_ts = _iso_to_ts(exp_time)
        if exp_ts and 0 < (exp_ts - now_ts) <= 3600:
            qty = fp_to_float(p.get("position_fp"))
            exposure = dollars_to_cents(p.get("market_exposure_dollars"))
            if exposure >= 100:  # skip dust
                chips.append({
                    "kind": "resolving",
                    "severity": "warn",
                    "ticker": ticker,
                    "title": mkt.get("title"),
                    "minutes_to_resolve": int((exp_ts - now_ts) // 60),
                    "exposure_cents": exposure,
                    "qty": int(qty) if qty == int(qty) else qty,
                })

    # Chip: edge flipped negative (mid < entry for YES, mid > entry for NO)
    for p in open_positions:
        qty = fp_to_float(p.get("position_fp"))
        if qty == 0:
            continue
        ticker = p.get("ticker", "")
        mkt = markets.get(ticker, {}) or {}
        mid = _mid_cents(mkt)
        if mid is None:
            continue
        exposure = dollars_to_cents(p.get("market_exposure_dollars"))
        if exposure < 100:
            continue
        entry = int(round(exposure / abs(qty)))
        if qty > 0:
            edge = mid - entry
        else:
            no_mid = 100 - mid
            edge = no_mid - entry
        # Flag only meaningfully negative edges (> 5c underwater)
        if edge <= -5:
            chips.append({
                "kind": "edge_negative",
                "severity": "bad",
                "ticker": ticker,
                "title": mkt.get("title"),
                "edge_cents": edge,
                "entry_cents": entry,
                "mid_cents": mid if qty > 0 else (100 - mid),
                "exposure_cents": exposure,
            })

    # Chip: position mid moved >5c since last snapshot
    # Compare yes_bid/yes_ask now to last snapshot approximation (we don't store
    # per-ticker mids historically). Use last-updated ticker marker: rely on
    # unrealized PnL sign change or large move. Simpler: flag positions whose
    # unrealized is negative and |unrealized/exposure| > 0.25 as drawdown chips.
    for p in open_positions:
        qty = fp_to_float(p.get("position_fp"))
        if qty == 0:
            continue
        ticker = p.get("ticker", "")
        mkt = markets.get(ticker, {}) or {}
        exposure = dollars_to_cents(p.get("market_exposure_dollars"))
        if exposure < 500:
            continue
        from .main import _position_value_cents  # local import avoids cycle at startup
        mv = _position_value_cents(qty, mkt)
        unrealized = mv - exposure
        if exposure > 0 and (unrealized / exposure) <= -0.30:
            chips.append({
                "kind": "drawdown",
                "severity": "bad",
                "ticker": ticker,
                "title": mkt.get("title"),
                "unrealized_cents": unrealized,
                "exposure_cents": exposure,
                "pct": round(unrealized / exposure, 3),
            })

    # Chip: recent fills in last 10 minutes
    try:
        fill_data = await client.get_fills(limit=25)
        fills = fill_data.get("fills", []) or []
        recent_fills = []
        cutoff = now_ts - 600
        for f in fills:
            ts = _iso_to_ts(f.get("created_time"))
            if ts and ts >= cutoff:
                recent_fills.append(f)
        if recent_fills:
            total_count = sum(fp_to_float(f.get("count_fp")) for f in recent_fills)
            chips.append({
                "kind": "recent_fills",
                "severity": "info",
                "count": len(recent_fills),
                "total_contracts": int(total_count) if total_count == int(total_count) else total_count,
                "latest_ticker": recent_fills[0].get("ticker"),
                "latest_time": recent_fills[0].get("created_time"),
            })
    except Exception:
        pass

    # Chip: today's settlements — swing largest category
    day_start = int(datetime.now().astimezone().replace(hour=0, minute=0, second=0, microsecond=0).timestamp())
    today_settlements = [
        s for s in settlements_all
        if (iso_ts(s.get("settled_time")) or 0) >= day_start
    ]
    if today_settlements:
        by_cat: dict[str, int] = defaultdict(int)
        for s in today_settlements:
            by_cat[categorize(s.get("ticker", ""))] += settlement_pnl_cents(s)
        # biggest swing either direction
        best = max(by_cat.items(), key=lambda kv: abs(kv[1])) if by_cat else None
        if best and abs(best[1]) >= 500:
            chips.append({
                "kind": "category_swing",
                "severity": "good" if best[1] > 0 else "bad",
                "category": best[0],
                "pnl_cents": best[1],
                "count": sum(1 for s in today_settlements if categorize(s.get("ticker", "")) == best[0]),
            })

    # Chip: big equity move since session start (first snapshot today)
    try:
        snapshots = get_snapshots(db_path, since_ts=day_start)
        if len(snapshots) >= 2:
            first = snapshots[0]
            last = snapshots[-1]
            first_eq = first["balance_cents"] + first["total_unrealized_cents"]
            last_eq = last["balance_cents"] + last["total_unrealized_cents"]
            delta = last_eq - first_eq
            if abs(delta) >= 2000:
                chips.append({
                    "kind": "equity_move",
                    "severity": "good" if delta > 0 else "bad",
                    "delta_cents": delta,
                    "since": first["ts"],
                })
    except Exception:
        pass

    # Sort chips: bad > warn > good > info, then by magnitude
    severity_rank = {"bad": 0, "warn": 1, "good": 2, "info": 3}
    chips.sort(key=lambda c: severity_rank.get(c.get("severity", "info"), 9))

    return {"ts": now_ts, "chips": chips, "count": len(chips)}
