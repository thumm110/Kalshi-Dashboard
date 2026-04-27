"""ESPN public scoreboard enrichment for sports games.

Fetches NBA + NHL playoff series state (e.g. "BOS leads 1-0") and the
current PGA tournament leaderboard. No API key needed. Cached 60s.

Kalshi and ESPN sometimes use different team abbreviations (Spurs:
ESPN "SA" vs Kalshi "SAS"). We normalize to a canonical 3-letter code
so pair lookups work regardless of source.
"""
from __future__ import annotations

import asyncio
import logging
import re
import time
from typing import Any

import httpx

log = logging.getLogger("kalshi-dashboard.espn")

_CACHE_TTL = 60
_cache: dict[str, tuple[float, Any]] = {}

NBA_NORMALIZE = {
    "SA": "SAS", "GS": "GSW", "NO": "NOP", "NY": "NYK",
    "WSH": "WAS", "UTAH": "UTA",
}
NHL_NORMALIZE = {
    "SJ": "SJS", "TB": "TBL", "LA": "LAK", "NJ": "NJD",
}
# MLB: ESPN/Kalshi mostly agree on 2-3 letter codes. Keep symmetric.
MLB_NORMALIZE: dict[str, str] = {}


def _norm(code: str, table: dict[str, str]) -> str:
    code = (code or "").upper()
    return table.get(code, code)


def _pair_key(a: str, b: str) -> tuple[str, str]:
    return tuple(sorted((a, b)))  # type: ignore[return-value]


async def _fetch_scoreboard(http: httpx.AsyncClient, path: str, dates: str | None = None) -> dict[str, Any]:
    url = f"https://site.api.espn.com/apis/site/v2/sports/{path}/scoreboard"
    params = {"dates": dates} if dates else None
    r = await http.get(url, timeout=6.0, params=params)
    r.raise_for_status()
    return r.json()


async def _fetch_recent_completed(
    http: httpx.AsyncClient, path: str, normalize: dict[str, str], days: int = 4
) -> dict[tuple[str, str], dict[str, Any]]:
    """Walk back N days; return latest completed game per team-pair."""
    import datetime as _dt
    today = _dt.datetime.utcnow().date()
    date_strs = [(today - _dt.timedelta(days=i)).strftime("%Y%m%d") for i in range(1, days + 1)]
    out: dict[tuple[str, str], dict[str, Any]] = {}
    try:
        results = await asyncio.gather(
            *[_fetch_scoreboard(http, path, dates=ds) for ds in date_strs],
            return_exceptions=True,
        )
    except Exception:
        return out
    # Walk newest-first; keep first hit per pair (most recent).
    for data in results:
        if isinstance(data, BaseException) or not isinstance(data, dict):
            continue
        for ev in data.get("events", []) or []:
            comp = (ev.get("competitions") or [{}])[0]
            status = (comp.get("status") or {}).get("type") or {}
            if (status.get("state") or "") != "post" or not status.get("completed"):
                continue
            sides: list[dict[str, Any]] = []
            for c in comp.get("competitors", []) or []:
                t = c.get("team") or {}
                ab = _norm(t.get("abbreviation") or "", normalize)
                if not ab:
                    continue
                try:
                    score = int(c.get("score")) if c.get("score") is not None else None
                except (TypeError, ValueError):
                    score = None
                sides.append({"abbrev": ab, "score": score, "winner": bool(c.get("winner"))})
            if len(sides) != 2:
                continue
            key = _pair_key(sides[0]["abbrev"], sides[1]["abbrev"])
            if key in out:
                continue
            period = (comp.get("status") or {}).get("period") or 0
            ot_label: str | None = None
            try:
                p = int(period)
                if p > 3:
                    ot_label = "SO" if p >= 5 else "OT"
            except (TypeError, ValueError):
                pass
            out[key] = {
                "short_name": ev.get("shortName"),
                "date": ev.get("date"),
                "ot": ot_label,
                "sides": sides,
            }
    return out


def _build_series_map(data: dict[str, Any], normalize: dict[str, str]) -> dict[tuple[str, str], dict[str, Any]]:
    out: dict[tuple[str, str], dict[str, Any]] = {}
    for ev in data.get("events", []) or []:
        comps = (ev.get("competitions") or [{}])[0]
        series = comps.get("series") or {}
        summary = series.get("summary")
        if not summary:
            continue
        teams: list[dict[str, Any]] = []
        series_wins_by_id: dict[str, int] = {
            str(c.get("id")): c.get("wins") or 0 for c in (series.get("competitors") or [])
        }
        for c in comps.get("competitors", []) or []:
            t = c.get("team") or {}
            ab = _norm(t.get("abbreviation") or "", normalize)
            if not ab:
                continue
            overall = next(
                (r for r in (c.get("records") or []) if (r.get("type") == "total" or r.get("name") == "overall")),
                None,
            )
            teams.append({
                "abbrev": ab,
                "name": t.get("displayName") or t.get("shortDisplayName"),
                "season_record": (overall or {}).get("summary"),
                "series_wins": series_wins_by_id.get(str(t.get("id"))),
            })
        if len(teams) != 2:
            continue
        status = (comps.get("status") or {}).get("type") or {}
        next_game: dict[str, Any] | None = None
        # If the next scheduled game in the scoreboard is in the future, expose it.
        if (status.get("state") or "") == "pre":
            next_game = {
                "short_detail": status.get("shortDetail"),  # "4/27 - 7:00 PM EDT"
                "date": ev.get("date"),
            }
        stats = {
            "summary": summary,
            "total_games": series.get("totalCompetitions"),
            "teams": teams,
            "next_game": next_game,
        }
        out[_pair_key(teams[0]["abbrev"], teams[1]["abbrev"])] = stats
    return out


async def _fetch_league_bundle(
    http: httpx.AsyncClient, path: str, normalize: dict[str, str]
) -> tuple[dict[tuple[str, str], dict[str, Any]], dict[str, str]]:
    """Returns (series_map, team_records) for a single league."""
    try:
        data, last = await asyncio.gather(
            _fetch_scoreboard(http, path),
            _fetch_recent_completed(http, path, normalize),
        )
    except Exception as exc:
        log.info("espn %s fetch failed: %s", path, exc)
        return {}, {}
    series = _build_series_map(data, normalize)
    for key, lg in last.items():
        if key in series:
            series[key]["last_game"] = lg
    records = _build_team_records(data, normalize)
    return series, records


async def _fetch_pga_leaderboard(http: httpx.AsyncClient) -> dict[str, Any]:
    try:
        data = await _fetch_scoreboard(http, "golf/pga")
    except Exception as exc:
        log.info("espn pga leaderboard fetch failed: %s", exc)
        return {}
    events = data.get("events") or []
    if not events:
        return {}
    ev = events[0]
    comps = (ev.get("competitions") or [{}])[0]
    status = (ev.get("status") or {}).get("type") or {}
    players = []
    for c in comps.get("competitors", []) or []:
        ath = c.get("athlete") or {}
        st = c.get("status") or {}
        pos = (st.get("position") or {}).get("displayName") or ""
        players.append({
            "pos": pos,
            "name": ath.get("displayName") or ath.get("shortName"),
            "score": c.get("score"),
            "thru": st.get("thru"),
        })
    players = [p for p in players if p["name"]][:10]
    return {
        "tournament": ev.get("name"),
        "short_name": ev.get("shortName"),
        "status": status.get("description"),
        "state": status.get("state"),
        "date": ev.get("date"),
        "leaders": players,
    }


def _build_team_records(data: dict[str, Any], normalize: dict[str, str]) -> dict[str, str]:
    """Returns {abbrev: season_record_str} from a scoreboard payload."""
    out: dict[str, str] = {}
    for ev in data.get("events", []) or []:
        comp = (ev.get("competitions") or [{}])[0]
        for c in comp.get("competitors", []) or []:
            t = c.get("team") or {}
            ab = _norm(t.get("abbreviation") or "", normalize)
            if not ab:
                continue
            overall = next(
                (r for r in (c.get("records") or []) if (r.get("type") == "total" or r.get("name") == "overall")),
                None,
            )
            rec = (overall or {}).get("summary")
            if rec and ab not in out:
                out[ab] = rec
    return out


async def fetch_espn_enrichment() -> dict[str, Any]:
    """Returns {nba_series, nhl_series, pga, *_team_records} with 60s cache."""
    now = time.time()
    cached = _cache.get("all")
    if cached and now - cached[0] < _CACHE_TTL:
        return cached[1]
    async with httpx.AsyncClient() as http:
        nba_bundle, nhl_bundle, mlb_bundle, pga = await asyncio.gather(
            _fetch_league_bundle(http, "basketball/nba", NBA_NORMALIZE),
            _fetch_league_bundle(http, "hockey/nhl", NHL_NORMALIZE),
            _fetch_league_bundle(http, "baseball/mlb", MLB_NORMALIZE),
            _fetch_pga_leaderboard(http),
        )
    nba, nba_records = nba_bundle
    nhl, nhl_records = nhl_bundle
    mlb, mlb_records = mlb_bundle
    payload = {
        "nba_series": nba,
        "nhl_series": nhl,
        "mlb_series": mlb,
        "nba_team_records": nba_records,
        "nhl_team_records": nhl_records,
        "mlb_team_records": mlb_records,
        "pga": pga,
    }
    _cache["all"] = (now, payload)
    return payload


# --- Kalshi ticker team extraction ---

_SUBTITLE_RE = re.compile(r"^([A-Z]{2,4})\s+(?:at|vs)\s+([A-Z]{2,4})")


def teams_from_sub_title(sub_title: str | None, sport_id: str) -> tuple[str, str] | None:
    """Extract (team_a, team_b) from 'PHI at BOS (Apr 21)' style subtitle.

    Returns normalized codes using the sport-appropriate table.
    """
    if not sub_title:
        return None
    m = _SUBTITLE_RE.match(sub_title.strip())
    if not m:
        return None
    a, b = m.group(1), m.group(2)
    table = (
        NBA_NORMALIZE if sport_id == "nba"
        else NHL_NORMALIZE if sport_id == "nhl"
        else MLB_NORMALIZE if sport_id == "mlb"
        else {}
    )
    return _norm(a, table), _norm(b, table)


def stats_for_game(sub_title: str | None, sport_id: str, espn: dict[str, Any]) -> dict[str, Any] | None:
    pair = teams_from_sub_title(sub_title, sport_id)
    if not pair:
        return None
    key = _pair_key(*pair)
    if sport_id == "nba":
        return (espn.get("nba_series") or {}).get(key)
    if sport_id == "nhl":
        return (espn.get("nhl_series") or {}).get(key)
    if sport_id == "mlb":
        return (espn.get("mlb_series") or {}).get(key)
    return None


def series_for_game(sub_title: str | None, sport_id: str, espn: dict[str, Any]) -> str | None:
    stats = stats_for_game(sub_title, sport_id, espn)
    return (stats or {}).get("summary") if stats else None
