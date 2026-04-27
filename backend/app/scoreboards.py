"""NBA and MLB live scoreboards via ESPN's site.api.

Same undocumented-but-stable scoreboard endpoint already used for playoff
series enrichment. Cached with a short TTL.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

import httpx

log = logging.getLogger("kalshi-dashboard.scoreboards")

_BASE = "https://site.api.espn.com/apis/site/v2/sports"
_CACHE_TTL = 15
_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_locks: dict[str, asyncio.Lock] = {}


def _lock_for(key: str) -> asyncio.Lock:
    lk = _locks.get(key)
    if lk is None:
        lk = asyncio.Lock()
        _locks[key] = lk
    return lk


def _team_row(c: dict[str, Any]) -> dict[str, Any]:
    team = c.get("team") or {}
    records = c.get("records") or []
    rec = None
    for r in records:
        if r.get("type") == "total" or r.get("name") in ("overall", "All Splits"):
            rec = r.get("summary")
            break
    if rec is None and records:
        rec = records[0].get("summary")
    try:
        score = int(c.get("score")) if c.get("score") not in (None, "") else None
    except (TypeError, ValueError):
        score = None
    return {
        "abbrev": team.get("abbreviation"),
        "name": team.get("shortDisplayName") or team.get("displayName"),
        "display_name": team.get("displayName"),
        "logo": team.get("logo"),
        "score": score,
        "record": rec,
        "home_away": c.get("homeAway"),
    }


def _normalize_nba(ev: dict[str, Any]) -> dict[str, Any]:
    comp = (ev.get("competitions") or [{}])[0]
    status = (ev.get("status") or {}).get("type") or {}
    competitors = comp.get("competitors") or []
    home = next((c for c in competitors if c.get("homeAway") == "home"), competitors[0] if competitors else {})
    away = next((c for c in competitors if c.get("homeAway") == "away"), competitors[-1] if competitors else {})
    series = (comp.get("series") or {}).get("summary")
    return {
        "id": ev.get("id"),
        "state": status.get("state"),  # pre, in, post
        "short_detail": status.get("shortDetail"),
        "detail": status.get("detail"),
        "completed": bool(status.get("completed")),
        "start_utc": ev.get("date"),
        "home": _team_row(home),
        "away": _team_row(away),
        "series_summary": series,
        "link": f"https://www.espn.com/nba/game?gameId={ev.get('id')}" if ev.get("id") else None,
    }


def _normalize_mlb(ev: dict[str, Any]) -> dict[str, Any]:
    comp = (ev.get("competitions") or [{}])[0]
    status = (ev.get("status") or {}).get("type") or {}
    competitors = comp.get("competitors") or []
    home = next((c for c in competitors if c.get("homeAway") == "home"), competitors[0] if competitors else {})
    away = next((c for c in competitors if c.get("homeAway") == "away"), competitors[-1] if competitors else {})
    situation = comp.get("situation") or {}
    on_base = {
        "first": bool(situation.get("onFirst")),
        "second": bool(situation.get("onSecond")),
        "third": bool(situation.get("onThird")),
    }
    return {
        "id": ev.get("id"),
        "state": status.get("state"),
        "short_detail": status.get("shortDetail"),
        "detail": status.get("detail"),
        "completed": bool(status.get("completed")),
        "start_utc": ev.get("date"),
        "home": _team_row(home),
        "away": _team_row(away),
        "inning": status.get("period"),
        "inning_state": status.get("detail"),  # "Top 5th" etc
        "outs": situation.get("outs"),
        "balls": situation.get("balls"),
        "strikes": situation.get("strikes"),
        "on_base": on_base,
        "link": f"https://www.espn.com/mlb/game?gameId={ev.get('id')}" if ev.get("id") else None,
    }


_STATE_ORDER = {"in": 0, "pre": 1, "post": 2}


async def _fetch(path: str, normalize, series_key: str | None = None) -> dict[str, Any]:
    from .espn import NBA_NORMALIZE, NHL_NORMALIZE, MLB_NORMALIZE, _norm, _pair_key, fetch_espn_enrichment
    key = path
    lock = _lock_for(key)
    async with lock:
        now = time.time()
        cached = _cache.get(key)
        if cached and now - cached[0] < _CACHE_TTL:
            return cached[1]
        try:
            async with httpx.AsyncClient(timeout=8.0, headers={"Accept": "application/json"}, follow_redirects=True) as http:
                r = await http.get(f"{_BASE}/{path}/scoreboard")
                r.raise_for_status()
                data = r.json()
        except Exception as exc:
            log.warning("espn scoreboard %s failed: %s", path, exc)
            payload = {"games": [], "error": str(exc)}
            _cache[key] = (now, payload)
            return payload
        games = [normalize(ev) for ev in (data.get("events") or [])]
        # Attach playoff series_stats by team-pair when available.
        if series_key:
            try:
                espn = await fetch_espn_enrichment()
                series_map = espn.get(series_key) or {}
                table = (
                    NBA_NORMALIZE if series_key == "nba_series"
                    else NHL_NORMALIZE if series_key == "nhl_series"
                    else MLB_NORMALIZE if series_key == "mlb_series"
                    else {}
                )
                for g in games:
                    a = _norm((g.get("home") or {}).get("abbrev") or "", table)
                    b = _norm((g.get("away") or {}).get("abbrev") or "", table)
                    if a and b:
                        g["series_stats"] = series_map.get(_pair_key(a, b))
                    else:
                        g["series_stats"] = None
            except Exception as exc:
                log.info("scoreboard series enrichment %s failed: %s", path, exc)
        games.sort(key=lambda g: (_STATE_ORDER.get(g.get("state") or "", 9), g.get("start_utc") or ""))
        payload = {"games": games, "error": None}
        _cache[key] = (now, payload)
        return payload


async def fetch_nba_scores() -> dict[str, Any]:
    return await _fetch("basketball/nba", _normalize_nba, series_key="nba_series")


async def fetch_mlb_scores() -> dict[str, Any]:
    return await _fetch("baseball/mlb", _normalize_mlb, series_key="mlb_series")


# --- Golf leaderboard (expanded vs. the 10-player summary in espn.py) ---


async def fetch_golf_leaderboard() -> dict[str, Any]:
    key = "golf/pga"
    lock = _lock_for(key)
    async with lock:
        now = time.time()
        cached = _cache.get(key)
        if cached and now - cached[0] < 60:  # slower-moving
            return cached[1]
        try:
            async with httpx.AsyncClient(timeout=8.0, headers={"Accept": "application/json"}, follow_redirects=True) as http:
                r = await http.get(f"{_BASE}/golf/pga/scoreboard")
                r.raise_for_status()
                data = r.json()
        except Exception as exc:
            log.warning("espn pga scoreboard failed: %s", exc)
            payload = {"tournament": None, "leaders": [], "error": str(exc)}
            _cache[key] = (now, payload)
            return payload
        events = data.get("events") or []
        if not events:
            payload = {"tournament": None, "leaders": [], "error": None}
            _cache[key] = (now, payload)
            return payload
        ev = events[0]
        comps = (ev.get("competitions") or [{}])[0]
        status = (ev.get("status") or {}).get("type") or {}
        players = []
        for c in comps.get("competitors") or []:
            ath = c.get("athlete") or {}
            st = c.get("status") or {}
            pos = (st.get("position") or {}).get("displayName") or ""
            players.append({
                "pos": pos,
                "name": ath.get("displayName") or ath.get("shortName"),
                "country": (ath.get("flag") or {}).get("alt"),
                "score": c.get("score"),
                "thru": st.get("thru"),
                "today": st.get("displayValue"),
            })
        players = [p for p in players if p["name"]][:25]
        payload = {
            "tournament": ev.get("name"),
            "short_name": ev.get("shortName"),
            "status": status.get("description"),
            "state": status.get("state"),
            "detail": status.get("detail"),
            "date": ev.get("date"),
            "leaders": players,
            "error": None,
        }
        _cache[key] = (now, payload)
        return payload
