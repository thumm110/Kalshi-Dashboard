"""Event discovery: paginate Kalshi /events and filter by keyword.

Useful for finding real event_tickers when a category registry (politics,
weather, etc.) has stale or guessed entries. Cached for 5 minutes because
this can hit many pages on first call.
"""
from __future__ import annotations

import logging
import time
from typing import Any

from .kalshi_client import KalshiClient

log = logging.getLogger("kalshi-dashboard.discover")

_CACHE_TTL = 300  # 5 min
_cache: dict[str, tuple[float, list[dict[str, Any]]]] = {}
_MAX_PAGES = 10  # safety cap


async def _fetch_all_active_events(client: KalshiClient) -> list[dict[str, Any]]:
    now = time.time()
    cached = _cache.get("active")
    if cached and now - cached[0] < _CACHE_TTL:
        return cached[1]

    events: list[dict[str, Any]] = []
    cursor: str | None = None
    for _ in range(_MAX_PAGES):
        data = await client.list_events(limit=200, cursor=cursor, status="open")
        batch = data.get("events") or []
        events.extend(batch)
        cursor = data.get("cursor") or None
        if not cursor or not batch:
            break
    _cache["active"] = (now, events)
    return events


def _match(event: dict[str, Any], q: str) -> bool:
    if not q:
        return True
    needle = q.lower()
    for field in ("event_ticker", "title", "sub_title", "category", "series_ticker"):
        val = event.get(field)
        if val and needle in str(val).lower():
            return True
    return False


async def discover_events(
    client: KalshiClient, q: str = "", limit: int = 50,
    series_ticker: str | None = None,
) -> dict[str, Any]:
    """Discover events either by keyword across all open events (paginated,
    capped) or directly by series_ticker (follows cursor until exhausted —
    the only reliable way to find game-level markets).
    """
    if series_ticker:
        events: list[dict[str, Any]] = []
        cursor: str | None = None
        for _ in range(25):
            data = await client.list_events(
                limit=200, cursor=cursor, status="open", series_ticker=series_ticker
            )
            batch = data.get("events") or []
            events.extend(batch)
            cursor = data.get("cursor") or None
            if not cursor or not batch:
                break
        matched = events
        total = len(events)
    else:
        events = await _fetch_all_active_events(client)
        matched = [e for e in events if _match(e, q)]
        total = len(events)
    matched.sort(key=lambda e: (e.get("category") or "", e.get("event_ticker") or ""))
    rows = [
        {
            "event_ticker": e.get("event_ticker"),
            "series_ticker": e.get("series_ticker"),
            "title": e.get("title"),
            "sub_title": e.get("sub_title"),
            "category": e.get("category"),
            "mutually_exclusive": e.get("mutually_exclusive"),
        }
        for e in matched[:limit]
    ]
    return {
        "query": q,
        "series_ticker": series_ticker,
        "total_active": total,
        "match_count": len(matched),
        "events": rows,
    }
