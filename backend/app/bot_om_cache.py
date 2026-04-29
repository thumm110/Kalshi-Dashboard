"""Read-only piggyback on the predict-and-profit weather bot's Open-Meteo
cache so the dashboard doesn't re-fetch what the bot just fetched.

The bot maintains a JSON file (default
`~/Desktop/predict-and-profit-v2/weather-bot/.open_meteo_cache.json`,
overridable via the BOT_OM_CACHE_PATH env var) keyed by
(provider, city_key, forecast_date, cycle). Values already contain
`member_highs` / `member_lows`, which is exactly what the dashboard needs.

This module is best-effort: any IO or parse failure returns None so we
fall through to the dashboard's own cache and Open-Meteo.
"""
from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path
from typing import Any

log = logging.getLogger("kalshi-dashboard.bot-om-cache")

_DEFAULT_PATH = Path.home() / "Desktop/predict-and-profit-v2/weather-bot/.open_meteo_cache.json"
_PATH = Path(os.environ.get("BOT_OM_CACHE_PATH", str(_DEFAULT_PATH)))

# Dashboard model_key -> ordered list of bot provider strings to try
_PROVIDER_FOR_MODEL: dict[str, tuple[str, ...]] = {
    "gfs": ("gfs_ensemble",),
    "ecmwf": ("ecmwf_ifs", "aifs"),
}

# Dashboard 3-letter codes -> bot lowercase city keys (only the differing ones)
_CITY_OVERRIDES: dict[str, str] = {
    "AUS": "austin",
    "DCA": "dc",
    "MSY": "nol",
}

_FILE_MTIME: float = 0.0
_CACHED_PARSED: dict[tuple[str, str, str], tuple[float, dict[str, Any]]] = {}


def _bot_city_key(dashboard_code: str) -> str:
    code = (dashboard_code or "").upper()
    return _CITY_OVERRIDES.get(code, code.lower())


def _decode_value(value: Any) -> Any:
    if isinstance(value, dict):
        if "__date__" in value and len(value) == 1:
            return value["__date__"]  # keep as ISO string; dashboard only reads list fields
        return {k: _decode_value(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_decode_value(v) for v in value]
    return value


def _load_file() -> dict[tuple[str, str, str], tuple[float, dict[str, Any]]] | None:
    """Return a flat dict keyed by (provider, city_key, forecast_date) ->
    (best_expires_at, decoded_value), picking the entry with the latest cycle.
    Memoized via mtime so we don't re-parse on every call.
    """
    global _FILE_MTIME, _CACHED_PARSED
    try:
        stat = _PATH.stat()
    except FileNotFoundError:
        return None
    except Exception as exc:
        log.debug("bot om-cache stat failed: %s", exc)
        return None

    if stat.st_mtime == _FILE_MTIME and _CACHED_PARSED:
        return _CACHED_PARSED

    try:
        raw = json.loads(_PATH.read_text())
    except Exception as exc:
        log.debug("bot om-cache read/parse failed: %s", exc)
        return None

    entries = raw.get("entries") if isinstance(raw, dict) else None
    if not isinstance(entries, list):
        return None

    flat: dict[tuple[str, str, str], tuple[float, dict[str, Any]]] = {}
    for item in entries:
        if not isinstance(item, dict):
            continue
        provider = item.get("provider")
        city_key = item.get("city_key")
        forecast_date = item.get("forecast_date")
        expires_at = item.get("expires_at")
        value = item.get("value")
        if not isinstance(provider, str) or not isinstance(city_key, str) or not isinstance(forecast_date, str):
            continue
        if not isinstance(expires_at, (int, float)) or not isinstance(value, dict):
            continue
        decoded = _decode_value(value)
        if not isinstance(decoded, dict):
            continue
        if not decoded.get("member_highs") or not decoded.get("member_lows"):
            continue
        key = (provider, city_key, forecast_date)
        prior = flat.get(key)
        if prior is None or float(expires_at) > prior[0]:
            flat[key] = (float(expires_at), decoded)

    _FILE_MTIME = stat.st_mtime
    _CACHED_PARSED = flat
    return flat


def lookup(
    *,
    model_key: str,
    location_code: str,
    forecast_date: str,
    stale_ttl_seconds: float,
) -> tuple[float, dict[str, Any]] | None:
    """Return (effective_cached_at, dashboard-shaped result) from the bot's
    cache, or None if no usable entry exists.

    `effective_cached_at` is approximated from the entry's expires_at minus the
    bot's per-provider TTL (~3h GFS/IFS, ~6h AIFS) so the dashboard can apply
    its own freshness rules consistently.
    """
    flat = _load_file()
    if not flat:
        return None
    providers = _PROVIDER_FOR_MODEL.get(model_key.lower())
    if not providers:
        return None
    city_key = _bot_city_key(location_code)
    now = time.time()

    for provider in providers:
        entry = flat.get((provider, city_key, forecast_date))
        if entry is None:
            continue
        expires_at, decoded = entry
        ttl_seconds = 6 * 3600 if provider == "aifs" else 3 * 3600
        cached_at = expires_at - ttl_seconds
        # Accept fresh OR within the dashboard caller's stale window.
        if expires_at < now and (now - cached_at) > stale_ttl_seconds:
            continue
        members_highs = [float(x) for x in decoded.get("member_highs", []) if x is not None]
        members_lows = [float(x) for x in decoded.get("member_lows", []) if x is not None]
        if not members_highs or not members_lows:
            continue
        result = {
            "location_key": city_key,
            "forecast_date": forecast_date,
            "model": model_key,
            "model_label": f"bot:{provider}",
            "model_description": f"Reused from weather-bot om_cache ({provider})",
            "api_model": provider,
            "member_count": min(len(members_highs), len(members_lows)),
            "member_highs": members_highs,
            "member_lows": members_lows,
            "_source": "bot_cache",
        }
        return cached_at, result
    return None


def cache_path() -> str:
    return str(_PATH)
