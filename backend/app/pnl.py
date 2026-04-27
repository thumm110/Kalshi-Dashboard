"""Shared PnL helpers for positions and settlements."""
from __future__ import annotations

import time
from datetime import datetime
from typing import Any

from .kalshi_client import KalshiClient, dollars_to_cents, fp_to_float


def local_day_start_ts(now_ts: int | None = None) -> int:
    """Unix timestamp for midnight in the server's local timezone."""
    dt = datetime.fromtimestamp(now_ts or int(time.time())).astimezone()
    return int(dt.replace(hour=0, minute=0, second=0, microsecond=0).timestamp())


def _cents_value(v: Any) -> int:
    if v is None or v == "":
        return 0
    return int(round(float(v)))


def _settlement_cost_cents(s: dict[str, Any], dollars_key: str, legacy_cents_key: str) -> int:
    if s.get(dollars_key) not in (None, ""):
        return dollars_to_cents(s.get(dollars_key))
    return _cents_value(s.get(legacy_cents_key))


def settlement_pnl_cents(s: dict[str, Any]) -> int:
    """Realized PnL from a settlement row.

    Settlement value is cents per YES contract; NO settles at 100 - value.
    A losing YES settlement with $6.80 cost and $0 payout is -680c.
    """
    return settlement_payout_cents(s) - settlement_cost_cents(s) - settlement_fee_cents(s)


async def get_settlements_since(client: KalshiClient, min_ts: int, limit: int = 1000) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    cursor: str | None = None
    while True:
        data = await client.get_settlements(limit=limit, cursor=cursor, min_ts=min_ts)
        rows.extend(data.get("settlements", []) or [])
        cursor = data.get("cursor")
        if not cursor:
            return rows


async def get_settlements_all(client: KalshiClient, limit: int = 1000) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    cursor: str | None = None
    while True:
        data = await client.get_settlements(limit=limit, cursor=cursor)
        rows.extend(data.get("settlements", []) or [])
        cursor = data.get("cursor")
        if not cursor:
            return rows


def iso_ts(value: Any) -> int | None:
    if not value:
        return None
    raw = str(value)
    if "." in raw:
        head, tail = raw.split(".", 1)
        frac = tail.rstrip("Z")
        suffix = "Z" if tail.endswith("Z") else ""
        raw = f"{head}.{frac[:6].ljust(6, '0')}{suffix}"
    try:
        return int(datetime.fromisoformat(raw.replace("Z", "+00:00")).timestamp())
    except ValueError:
        return None


def settlement_cost_cents(s: dict[str, Any]) -> int:
    return (
        _settlement_cost_cents(s, "yes_total_cost_dollars", "yes_total_cost")
        + _settlement_cost_cents(s, "no_total_cost_dollars", "no_total_cost")
    )


def settlement_fee_cents(s: dict[str, Any]) -> int:
    return dollars_to_cents(s.get("fee_cost"))


def settlement_payout_cents(s: dict[str, Any]) -> int:
    value = _cents_value(s.get("value"))
    yes_count = fp_to_float(s.get("yes_count_fp"))
    no_count = fp_to_float(s.get("no_count_fp"))
    payout = yes_count * value + no_count * (100 - value)
    return int(round(payout))
