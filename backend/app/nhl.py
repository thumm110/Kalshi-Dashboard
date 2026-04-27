"""NHL live scoreboard via api-web.nhle.com.

Undocumented but stable — this is the same endpoint NHL.com itself uses.
We cache with a short TTL so a busy page doesn't hammer it.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

import httpx

log = logging.getLogger("kalshi-dashboard.nhl")

_BASE = "https://api-web.nhle.com/v1"
_CACHE_TTL = 15  # seconds
_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_lock = asyncio.Lock()


def _team_row(t: dict[str, Any]) -> dict[str, Any]:
    name = t.get("name") or {}
    place = t.get("placeName") or {}
    return {
        "abbrev": t.get("abbrev"),
        "name": name.get("default") if isinstance(name, dict) else name,
        "place": place.get("default") if isinstance(place, dict) else place,
        "score": t.get("score"),
        "sog": t.get("sog"),
        "logo": t.get("logo"),
    }


def _clock_row(c: dict[str, Any] | None) -> dict[str, Any] | None:
    if not c:
        return None
    return {
        "time_remaining": c.get("timeRemaining"),
        "running": bool(c.get("running")),
        "in_intermission": bool(c.get("inIntermission")),
    }


def _normalize_game(g: dict[str, Any]) -> dict[str, Any]:
    home = g.get("homeTeam") or {}
    away = g.get("awayTeam") or {}
    period_desc = g.get("periodDescriptor") or {}
    gc_link = g.get("gameCenterLink")
    return {
        "id": g.get("id"),
        "state": g.get("gameState"),  # FUT, PRE, LIVE, CRIT, FINAL, OFF
        "start_utc": g.get("startTimeUTC"),
        "venue": (g.get("venue") or {}).get("default") if isinstance(g.get("venue"), dict) else g.get("venue"),
        "period": g.get("period") or period_desc.get("number"),
        "period_type": period_desc.get("periodType"),  # REG, OT, SO
        "clock": _clock_row(g.get("clock")),
        "home": _team_row(home),
        "away": _team_row(away),
        "game_center_url": f"https://www.nhl.com{gc_link}" if gc_link else None,
    }


async def fetch_scores() -> dict[str, Any]:
    """Live NHL scoreboard for the current slate. Cached 15s."""
    from .espn import fetch_espn_enrichment  # local import to avoid cycle
    async with _lock:
        cached = _cache.get("score_now")
        now = time.time()
        if cached and now - cached[0] < _CACHE_TTL:
            return cached[1]

        try:
            async with httpx.AsyncClient(timeout=10.0, headers={"Accept": "application/json"}, follow_redirects=True) as client:
                r = await client.get(f"{_BASE}/score/now")
                r.raise_for_status()
                data = r.json()
        except Exception as exc:
            log.warning("nhl score fetch failed: %s", exc)
            payload = {"current_date": None, "games": [], "error": str(exc)}
            _cache["score_now"] = (now, payload)
            return payload

        games = [_normalize_game(g) for g in (data.get("games") or [])]
        # Sort: LIVE/CRIT first, then FUT by start time, then FINAL last.
        state_order = {"LIVE": 0, "CRIT": 0, "PRE": 1, "FUT": 2, "OFF": 3, "FINAL": 4}
        games.sort(key=lambda g: (state_order.get(g.get("state") or "", 9), g.get("start_utc") or ""))

        # Enrich with ESPN season records and playoff-series stats when available.
        try:
            from .espn import NHL_NORMALIZE, _norm, _pair_key
            espn = await fetch_espn_enrichment()
            records = espn.get("nhl_team_records") or {}
            series_map = espn.get("nhl_series") or {}
            for g in games:
                for side in ("home", "away"):
                    ab = (g.get(side) or {}).get("abbrev")
                    if ab and ab in records:
                        g[side]["season_record"] = records[ab]
                home_ab = _norm((g.get("home") or {}).get("abbrev") or "", NHL_NORMALIZE)
                away_ab = _norm((g.get("away") or {}).get("abbrev") or "", NHL_NORMALIZE)
                g["series_stats"] = series_map.get(_pair_key(home_ab, away_ab)) if home_ab and away_ab else None
        except Exception as exc:
            log.info("nhl record enrichment failed: %s", exc)

        payload = {
            "current_date": data.get("currentDate"),
            "games": games,
            "error": None,
        }
        _cache["score_now"] = (now, payload)
        return payload
