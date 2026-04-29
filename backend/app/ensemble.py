"""Open-Meteo ensemble helpers for the weather page.

The dashboard is a *read-only consumer* of the predict-and-profit weather
bot's Open-Meteo cache. We never call Open-Meteo directly from here — the
bot is the sole fetcher, so the IP-level rate limit is owned by one
process. On cache miss the dashboard surfaces a clean error and the UI
shows "pending" rather than stampeding the upstream API.
"""
from __future__ import annotations

import math
import time
from datetime import date
from typing import Any

from . import bot_om_cache, ensemble_cache

CITY_PRESETS: dict[str, dict[str, Any]] = {
    "nyc": {"label": "New York City", "lat": 40.7128, "lon": -74.0060, "timezone": "America/New_York"},
    "dc": {"label": "Washington, DC", "lat": 38.9072, "lon": -77.0369, "timezone": "America/New_York"},
    "chi": {"label": "Chicago", "lat": 41.8781, "lon": -87.6298, "timezone": "America/Chicago"},
    "mia": {"label": "Miami", "lat": 25.7617, "lon": -80.1918, "timezone": "America/New_York"},
    "okc": {"label": "Oklahoma City", "lat": 35.4676, "lon": -97.5164, "timezone": "America/Chicago"},
    "austin": {"label": "Austin", "lat": 30.2672, "lon": -97.7431, "timezone": "America/Chicago"},
    "den": {"label": "Denver", "lat": 39.8561, "lon": -104.6737, "timezone": "America/Denver"},
    "lax": {"label": "Los Angeles", "lat": 33.9425, "lon": -118.4081, "timezone": "America/Los_Angeles"},
    "dal": {"label": "Dallas", "lat": 32.8471, "lon": -96.8518, "timezone": "America/Chicago"},
    "sea": {"label": "Seattle", "lat": 47.4502, "lon": -122.3088, "timezone": "America/Los_Angeles"},
    "bos": {"label": "Boston", "lat": 42.3656, "lon": -71.0096, "timezone": "America/New_York"},
    "msp": {"label": "Minneapolis", "lat": 44.8848, "lon": -93.2223, "timezone": "America/Chicago"},
    "atl": {"label": "Atlanta", "lat": 33.6407, "lon": -84.4277, "timezone": "America/New_York"},
    "nol": {"label": "New Orleans", "lat": 29.9934, "lon": -90.2580, "timezone": "America/Chicago"},
    "hou": {"label": "Houston", "lat": 29.9902, "lon": -95.3368, "timezone": "America/Chicago"},
    "phx": {"label": "Phoenix", "lat": 33.4342, "lon": -112.0116, "timezone": "America/Phoenix"},
    "las": {"label": "Las Vegas", "lat": 36.0840, "lon": -115.1537, "timezone": "America/Los_Angeles"},
    "phl": {"label": "Philadelphia", "lat": 39.8744, "lon": -75.2424, "timezone": "America/New_York"},
    "sfo": {"label": "San Francisco", "lat": 37.6213, "lon": -122.3790, "timezone": "America/Los_Angeles"},
    "sat": {"label": "San Antonio", "lat": 29.5337, "lon": -98.4698, "timezone": "America/Chicago"},
}

ENSEMBLE_MODELS: dict[str, dict[str, Any]] = {
    "gfs": {
        "label": "GFS",
        "description": "31-member GFS",
    },
    "ecmwf": {
        "label": "ECMWF IFS",
        "description": "51-member ECMWF IFS",
    },
}
_CACHE: dict[tuple[str, str, str], dict[str, Any]] = {}
# Mirror the bot's per-provider TTL (~3h GFS/IFS) so "fresh" means roughly
# the same thing on both sides. Stale window covers cases where the bot is
# itself rate-limited and the cache hasn't refreshed.
_CACHE_TTL_SECONDS = 3 * 60 * 60
_STALE_TTL_SECONDS = 6 * 60 * 60


def list_city_keys() -> list[str]:
    return sorted(CITY_PRESETS)


def get_preset(city_key: str) -> dict[str, Any]:
    preset = CITY_PRESETS.get(city_key.lower())
    if preset is None:
        valid = ", ".join(list_city_keys())
        raise ValueError(f"Unknown city '{city_key}'. Valid presets: {valid}")
    return preset


def list_ensemble_keys() -> list[str]:
    return sorted(ENSEMBLE_MODELS)


def get_ensemble_model(model_key: str) -> dict[str, Any]:
    model = ENSEMBLE_MODELS.get(model_key.lower())
    if model is None:
        valid = ", ".join(list_ensemble_keys())
        raise ValueError(f"Unknown ensemble model '{model_key}'. Valid models: {valid}")
    return model


async def fetch_ensemble(
    *,
    model_key: str,
    location_key: str,
    latitude: float,
    longitude: float,
    timezone_name: str,
    forecast_date: date,
) -> dict[str, Any]:
    """Return ensemble data sourced from the bot's Open-Meteo cache.

    Lookup order: in-memory → SQLite → bot cache file. Falls back to the
    freshest stale entry within `_STALE_TTL_SECONDS` if nothing fresh is
    available. Raises `RuntimeError` only when no cached value exists at
    all — callers translate that into a "pending" UI state.

    `latitude`, `longitude`, `timezone_name` are accepted for API
    compatibility but unused; the bot already fetched these coordinates.
    """
    ensemble = get_ensemble_model(model_key)
    cache_key = (model_key, location_key, forecast_date.isoformat())
    forecast_iso = forecast_date.isoformat()
    now = time.time()
    stale_candidate: dict[str, Any] | None = None

    entry = _CACHE.get(cache_key)
    if entry and (now - float(entry["cached_at"])) <= _CACHE_TTL_SECONDS:
        return _annotate(entry["result"], cached_at=float(entry["cached_at"]), source="memory", now=now)
    if entry is not None:
        stale_candidate = entry

    persisted = ensemble_cache.get(model_key, location_key, forecast_iso)
    if persisted is not None:
        cached_at, result = persisted
        if (now - cached_at) <= _CACHE_TTL_SECONDS:
            _CACHE[cache_key] = {"cached_at": cached_at, "result": result}
            return _annotate(result, cached_at=cached_at, source="dashboard_sqlite", now=now)
        if stale_candidate is None:
            stale_candidate = {"cached_at": cached_at, "result": result}

    bot_hit = bot_om_cache.lookup(
        model_key=model_key,
        location_code=location_key,
        forecast_date=forecast_iso,
        stale_ttl_seconds=_STALE_TTL_SECONDS,
    )
    if bot_hit is not None:
        bot_cached_at, bot_result = bot_hit
        bot_result = {
            **bot_result,
            "model": model_key,
            "model_label": ensemble["label"],
            "model_description": ensemble["description"],
        }
        if (now - bot_cached_at) <= _CACHE_TTL_SECONDS:
            _CACHE[cache_key] = {"cached_at": bot_cached_at, "result": bot_result}
            ensemble_cache.put(model_key, location_key, forecast_iso, bot_result)
            return _annotate(bot_result, cached_at=bot_cached_at, source="bot", now=now)
        if stale_candidate is None:
            stale_candidate = {"cached_at": bot_cached_at, "result": bot_result}

    if stale_candidate and (now - float(stale_candidate["cached_at"])) <= _STALE_TTL_SECONDS:
        return _annotate(
            stale_candidate["result"],
            cached_at=float(stale_candidate["cached_at"]),
            source="stale",
            now=now,
        )

    raise RuntimeError(
        f"Forecast not yet cached by weather-bot for {location_key}/{model_key}/{forecast_iso}. "
        f"Bot will populate on its next scan."
    )


def _annotate(result: dict[str, Any], *, cached_at: float, source: str, now: float) -> dict[str, Any]:
    return {
        **result,
        "cache_source": source,
        "cache_age_seconds": max(0, int(now - cached_at)),
    }


def probability_for_threshold(member_values: list[float], threshold: float, direction: str) -> float:
    if not member_values:
        return 0.5
    normalized = direction.strip().lower()
    if normalized not in {"above", "below"}:
        raise ValueError("direction must be 'above' or 'below'")
    if normalized == "above":
        hits = sum(1 for value in member_values if value > threshold)
    else:
        hits = sum(1 for value in member_values if value < threshold)
    return hits / len(member_values)


def summarize_members(member_values: list[float]) -> dict[str, float]:
    if not member_values:
        raise ValueError("member_values cannot be empty")
    ordered = sorted(member_values)
    count = len(ordered)
    mean = sum(ordered) / count
    variance = sum((value - mean) ** 2 for value in ordered) / count
    median = ordered[count // 2] if count % 2 else (ordered[(count // 2) - 1] + ordered[count // 2]) / 2.0
    return {
        "min": ordered[0],
        "max": ordered[-1],
        "mean": mean,
        "median": median,
        "stddev": math.sqrt(variance),
    }
