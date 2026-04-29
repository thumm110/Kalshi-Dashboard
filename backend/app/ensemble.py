"""Open-Meteo ensemble helpers for the weather page."""
from __future__ import annotations

import math
import re
import time
from datetime import date
from typing import Any

import asyncio
import random

import httpx

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

ENSEMBLE_API_URL = "https://ensemble-api.open-meteo.com/v1/ensemble"
MEMBER_PATTERN = re.compile(r"^temperature_2m_member(\d+)$")
ENSEMBLE_MODELS: dict[str, dict[str, Any]] = {
    "gfs": {
        "label": "GFS",
        "description": "31-member GFS",
        "api_models": ("gfs_seamless",),
    },
    "ecmwf": {
        "label": "ECMWF IFS",
        "description": "51-member ECMWF IFS",
        "api_models": ("ecmwf_ifs025", "ecmwf_ifs04"),
    },
}
_CACHE: dict[tuple[str, str, str], dict[str, Any]] = {}
_CACHE_TTL_SECONDS = 60 * 60
# Open-Meteo ensemble runs only refresh every ~6h upstream, so a 60-min TTL
# is still well within the freshness window and cuts our outbound volume 4x
# vs. the previous 15-min TTL. On 429s we'll also serve `_STALE_TTL_SECONDS`
# of stale data instead of failing the request.
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
    ensemble = get_ensemble_model(model_key)
    cache_key = (model_key, location_key, forecast_date.isoformat())
    forecast_iso = forecast_date.isoformat()
    now = time.time()

    # 1) In-memory cache (cheapest, sub-ms)
    entry = _CACHE.get(cache_key)
    if entry and (now - float(entry["cached_at"])) <= _CACHE_TTL_SECONDS:
        return entry["result"]

    # 2) Persistent SQLite cache (survives restarts)
    persisted = ensemble_cache.get(model_key, location_key, forecast_iso)
    if persisted is not None:
        cached_at, result = persisted
        if (now - cached_at) <= _CACHE_TTL_SECONDS:
            _CACHE[cache_key] = {"cached_at": cached_at, "result": result}
            return result
        # Hold onto the stale entry for 429-fallback below.
        if entry is None:
            entry = {"cached_at": cached_at, "result": result}

    # 3) Piggyback on the weather-bot's Open-Meteo cache, if present and fresh.
    bot_hit = bot_om_cache.lookup(
        model_key=model_key,
        location_code=location_key,
        forecast_date=forecast_iso,
        stale_ttl_seconds=_STALE_TTL_SECONDS,
    )
    if bot_hit is not None:
        bot_cached_at, bot_result = bot_hit
        # Splice in our model labels so the result still looks normal to callers.
        bot_result = {
            **bot_result,
            "model": model_key,
            "model_label": ensemble["label"],
            "model_description": ensemble["description"],
        }
        if (now - bot_cached_at) <= _CACHE_TTL_SECONDS:
            _CACHE[cache_key] = {"cached_at": bot_cached_at, "result": bot_result}
            ensemble_cache.put(model_key, location_key, forecast_iso, bot_result)
            return bot_result
        if entry is None:
            entry = {"cached_at": bot_cached_at, "result": bot_result}

    last_error: str | None = None
    # Small jitter so a burst of N parallel callers (with concurrency=5) doesn't
    # arrive at Open-Meteo as a synchronized spike.
    await asyncio.sleep(random.uniform(0.05, 0.35))
    async with httpx.AsyncClient(timeout=20.0) as client:
        for api_model in ensemble["api_models"]:
            params = {
                "latitude": latitude,
                "longitude": longitude,
                "hourly": "temperature_2m",
                "models": api_model,
                "temperature_unit": "fahrenheit",
                "forecast_days": 2,
                "timezone": timezone_name,
            }
            response = await client.get(ENSEMBLE_API_URL, params=params)
            if response.status_code in {400, 404}:
                last_error = f"Open-Meteo model '{api_model}' unavailable"
                continue
            if response.status_code == 429:
                # Rate-limited. Serve stale cache if we have any (up to STALE_TTL),
                # otherwise raise so the caller can record the failure and move on.
                if entry and (time.time() - float(entry["cached_at"])) <= _STALE_TTL_SECONDS:
                    return entry["result"]
                raise RuntimeError(
                    f"Open-Meteo rate-limited (429) for model '{api_model}' and no stale cache available"
                )
            response.raise_for_status()

            data = response.json()
            hourly = data.get("hourly", {})
            times: list[str] = hourly.get("time", [])
            date_prefix = forecast_date.isoformat()

            member_keys: list[tuple[int, str]] = []
            if "temperature_2m" in hourly:
                member_keys.append((0, "temperature_2m"))
            for key in hourly:
                match = MEMBER_PATTERN.match(key)
                if match:
                    member_keys.append((int(match.group(1)), key))
            member_keys.sort(key=lambda item: item[0])
            if not member_keys:
                last_error = f"No ensemble member columns were returned for model '{api_model}'."
                continue

            target_indices = [
                idx for idx, stamp in enumerate(times)
                if isinstance(stamp, str) and stamp.startswith(date_prefix)
            ]
            if not target_indices:
                raise RuntimeError(f"No hourly data was returned for {forecast_date.isoformat()}.")

            member_highs: list[float] = []
            member_lows: list[float] = []
            for _, key in member_keys:
                raw_values: list[Any] = hourly.get(key, [])
                day_values: list[float] = []
                for idx in target_indices:
                    if idx < len(raw_values) and raw_values[idx] is not None:
                        day_values.append(float(raw_values[idx]))
                if not day_values:
                    raise RuntimeError(f"Member {key} had no valid temperatures for {forecast_date.isoformat()}.")
                member_highs.append(max(day_values))
                member_lows.append(min(day_values))

            result = {
                "location_key": location_key,
                "forecast_date": forecast_date.isoformat(),
                "model": model_key,
                "model_label": ensemble["label"],
                "model_description": ensemble["description"],
                "api_model": api_model,
                "member_count": len(member_highs),
                "member_highs": member_highs,
                "member_lows": member_lows,
            }
            _CACHE[cache_key] = {"cached_at": time.time(), "result": result}
            ensemble_cache.put(model_key, location_key, forecast_iso, result)
            return result

    # All API attempts failed without a 429: serve stale (own or bot) if we have one.
    if entry and (time.time() - float(entry["cached_at"])) <= _STALE_TTL_SECONDS:
        return entry["result"]
    raise RuntimeError(last_error or f"No ensemble data returned for model '{model_key}'.")


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
