"""Periodic snapshotter: pulls balance + positions, writes to SQLite."""
import asyncio
import logging
import time

from .db import insert_snapshot
from .kalshi_client import KalshiClient, dollars_to_cents, fp_to_float

log = logging.getLogger(__name__)


async def take_snapshot(client: KalshiClient, db_path: str) -> dict:
    balance = await client.get_balance()
    positions = await client.get_positions(limit=500)

    balance_cents = int(balance.get("balance", 0))
    portfolio_value = int(balance.get("portfolio_value", 0) or 0)
    market_positions = positions.get("market_positions", []) or []

    total_realized = 0
    total_exposure = 0
    count = 0
    for p in market_positions:
        if fp_to_float(p.get("position_fp")) == 0:
            continue
        count += 1
        total_realized += dollars_to_cents(p.get("realized_pnl_dollars"))
        total_exposure += dollars_to_cents(p.get("market_exposure_dollars"))
    total_unrealized = portfolio_value - total_exposure

    ts = int(time.time())
    insert_snapshot(
        db_path, ts, balance_cents, total_unrealized, total_realized, total_exposure, count
    )
    return {
        "ts": ts,
        "balance_cents": balance_cents,
        "total_unrealized_cents": total_unrealized,
        "total_realized_cents": total_realized,
        "total_exposure_cents": total_exposure,
        "position_count": count,
    }


async def snapshot_loop(client: KalshiClient, db_path: str, interval: int):
    while True:
        try:
            await take_snapshot(client, db_path)
        except Exception as e:
            log.warning("snapshot failed: %s", e)
        await asyncio.sleep(interval)
