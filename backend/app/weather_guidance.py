"""NWS observation fetcher for Kalshi weather analytics."""
from __future__ import annotations

import asyncio
import time
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

import httpx

from .weather_locations import WeatherLocation

NWS_BASE = "https://api.weather.gov"
NWS_HEADERS = {
    "Accept": "application/geo+json, application/json",
    "User-Agent": "kalshi-dashboard-local (personal analytics)",
}
CACHE_TTL_SECONDS = 120

_cache: dict[str, tuple[float, dict[str, Any]]] = {}


def c_to_f(value: Any) -> float | None:
    if value is None:
        return None
    return round((float(value) * 9 / 5) + 32, 1)


def kmh_to_mph(value: Any) -> float | None:
    if value is None:
        return None
    return round(float(value) * 0.621371, 1)


def _qv(props: dict[str, Any], key: str) -> Any:
    item = props.get(key) or {}
    if not isinstance(item, dict):
        return None
    return item.get("value")


def _climate_window(location: WeatherLocation) -> tuple[datetime, datetime, str]:
    """Return the active NWS climate-day window for this location.

    NWS CLI products use local standard time. During daylight saving time, the
    observed climate day is effectively 1:00 AM to 12:59 AM local daylight time.
    """
    tz = ZoneInfo(location.timezone)
    now = datetime.now(tz)
    shift_hours = 1 if now.dst() and now.dst() != timedelta(0) else 0
    boundary = now.replace(hour=shift_hours, minute=0, second=0, microsecond=0)
    if now < boundary:
        boundary = boundary - timedelta(days=1)
    end = boundary + timedelta(days=1)
    return boundary, end, boundary.date().isoformat()


def _iso_utc(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _parse_dt(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    text = value.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _forecast_temp_f(period: dict[str, Any]) -> float | None:
    temp = period.get("temperature")
    if temp is None:
        return None
    try:
        value = float(temp)
    except (TypeError, ValueError):
        return None
    unit = str(period.get("temperatureUnit") or "F").upper()
    if unit == "C":
        value = (value * 9 / 5) + 32
    return round(value, 1)


async def _fetch_hourly_forecast(
    client: httpx.AsyncClient,
    location: WeatherLocation,
    start: datetime,
    end: datetime,
) -> dict[str, Any]:
    base = {
        "forecast_source": "api.weather.gov hourly forecast",
        "forecast_updated_time": None,
        "forecast_period_count": 0,
        "forecast_temp_f": None,
        "forecast_high_f": None,
        "forecast_low_f": None,
        "forecast_error": None,
    }
    try:
        point = await client.get(f"{NWS_BASE}/points/{location.lat:.4f},{location.lng:.4f}")
        point.raise_for_status()
        forecast_url = ((point.json().get("properties") or {}).get("forecastHourly"))
        if not forecast_url:
            return {**base, "forecast_error": "No hourly forecast URL returned by NWS point lookup."}

        forecast = await client.get(forecast_url)
        forecast.raise_for_status()
        props = forecast.json().get("properties") or {}
        periods = props.get("periods") or []
        now = datetime.now(timezone.utc)
        temps: list[float] = []
        next_temp: float | None = None
        for period in periods:
            period_start = _parse_dt(period.get("startTime"))
            period_end = _parse_dt(period.get("endTime"))
            temp_f = _forecast_temp_f(period)
            if period_start is None or period_end is None or temp_f is None:
                continue
            overlaps_contract = period_start < end and period_end > max(start, now)
            if not overlaps_contract:
                continue
            if next_temp is None:
                next_temp = temp_f
            temps.append(temp_f)

        return {
            **base,
            "forecast_updated_time": props.get("updated") or props.get("generatedAt"),
            "forecast_period_count": len(temps),
            "forecast_temp_f": next_temp,
            "forecast_high_f": round(max(temps), 1) if temps else None,
            "forecast_low_f": round(min(temps), 1) if temps else None,
        }
    except Exception as exc:
        return {**base, "forecast_error": str(exc)}


async def _fetch_location(client: httpx.AsyncClient, location: WeatherLocation) -> dict[str, Any]:
    start, end, contract_day = _climate_window(location)
    base = {
        "code": location.code,
        "name": location.name,
        "timezone": location.timezone,
        "lat": location.lat,
        "lng": location.lng,
        "station_id": location.observation_station,
        "climate_station": location.climate_station,
        "climate_report_url": location.climate_report_url,
        "series": list(location.series),
        "contract_day": contract_day,
        "contract_day_start": start.isoformat(),
        "contract_day_end": end.isoformat(),
        "source": "api.weather.gov station observations",
    }

    cache_key = f"{location.observation_station}:{_iso_utc(start)}:{_iso_utc(end)}"
    cached = _cache.get(cache_key)
    if cached and time.time() - cached[0] < CACHE_TTL_SECONDS:
        return cached[1]

    forecast_payload = await _fetch_hourly_forecast(client, location, start, end)
    if not location.observation_station:
        payload = {
            **base,
            **forecast_payload,
            "projected_high_f": forecast_payload.get("forecast_high_f"),
            "projected_low_f": forecast_payload.get("forecast_low_f"),
            "confidence": "climate-report-only",
            "error": "No live NWS observation station is configured for this Kalshi location.",
        }
        _cache[cache_key] = (time.time(), payload)
        return payload

    try:
        res = await client.get(
            f"{NWS_BASE}/stations/{location.observation_station}/observations",
            params={"start": _iso_utc(start), "end": _iso_utc(end), "limit": 500},
        )
        res.raise_for_status()
        data = res.json()
        features = data.get("features") or []

        observations: list[dict[str, Any]] = []
        for feature in features:
            props = feature.get("properties") or {}
            timestamp = props.get("timestamp")
            temp_f = c_to_f(_qv(props, "temperature"))
            if timestamp and temp_f is not None:
                observations.append({"timestamp": timestamp, "temp_f": temp_f, "props": props})
        observations.sort(key=lambda row: row["timestamp"])

        latest = observations[-1] if observations else None
        latest_props = latest["props"] if latest else {}
        temps = [row["temp_f"] for row in observations]
        high_candidates = temps + (
            [forecast_payload["forecast_high_f"]]
            if forecast_payload.get("forecast_high_f") is not None
            else []
        )
        low_candidates = temps + (
            [forecast_payload["forecast_low_f"]]
            if forecast_payload.get("forecast_low_f") is not None
            else []
        )

        payload = {
            **base,
            **forecast_payload,
            "confidence": "official-observation-station",
            "station_name": latest_props.get("stationName"),
            "latest_observation_time": latest["timestamp"] if latest else None,
            "latest_temp_f": latest["temp_f"] if latest else None,
            "high_so_far_f": round(max(temps), 1) if temps else None,
            "low_so_far_f": round(min(temps), 1) if temps else None,
            "projected_high_f": round(max(high_candidates), 1) if high_candidates else None,
            "projected_low_f": round(min(low_candidates), 1) if low_candidates else None,
            "observation_count": len(observations),
            "condition": latest_props.get("textDescription") or None,
            "humidity_pct": round(float(_qv(latest_props, "relativeHumidity")), 1)
            if _qv(latest_props, "relativeHumidity") is not None
            else None,
            "wind_mph": kmh_to_mph(_qv(latest_props, "windSpeed")),
            "error": None,
        }
    except Exception as exc:
        payload = {
            **base,
            **forecast_payload,
            "projected_high_f": forecast_payload.get("forecast_high_f"),
            "projected_low_f": forecast_payload.get("forecast_low_f"),
            "confidence": "unavailable",
            "error": str(exc),
        }

    _cache[cache_key] = (time.time(), payload)
    return payload


async def fetch_weather_guidance(locations: list[WeatherLocation]) -> list[dict[str, Any]]:
    async with httpx.AsyncClient(timeout=12.0, headers=NWS_HEADERS) as client:
        return await asyncio.gather(*(_fetch_location(client, loc) for loc in locations))
