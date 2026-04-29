"""Dashboard-native opportunities feed for Kalshi HIGH/LOW weather markets."""
from __future__ import annotations

import asyncio
import logging
import re
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any

from .ensemble import fetch_ensemble, probability_for_threshold
from .kalshi_client import KalshiClient
from .weather_locations import SERIES_TO_WEATHER_LOCATION, WEATHER_LOCATIONS, WeatherLocation

log = logging.getLogger("kalshi-dashboard.weather-opportunities")

_CACHE_TTL_SECONDS = 180
_FETCH_CONCURRENCY = 4
_ENSEMBLE_CONCURRENCY = 2
_MIN_CLOSE_HOURS = 2
_MAX_CLOSE_HOURS = 48
_MAX_SPREAD = 0.15
_MIN_VOLUME = 0.0
_MIN_OPEN_INTEREST = 0.0
_CACHE: dict[str, Any] = {
    "expires_at": 0.0,
    "generated_at": 0,
    "rows": [],
    "errors": [],
}

_MONTH_ABBR: dict[str, int] = {
    "JAN": 1,
    "FEB": 2,
    "MAR": 3,
    "APR": 4,
    "MAY": 5,
    "JUN": 6,
    "JUL": 7,
    "AUG": 8,
    "SEP": 9,
    "OCT": 10,
    "NOV": 11,
    "DEC": 12,
}
_TICKER_DATE_RE = re.compile(r"-(\d{2})([A-Z]{3})(\d{2})-")
_TEMP_RANGE_PATTERN = re.compile(r"\b(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*°?")
_TEMP_THRESHOLD_PATTERN = re.compile(r"([<>])\s*(\d+(?:\.\d+)?)\s*°?")
_TEMP_WORD_PATTERN = re.compile(r"\b(over|above|under|below)\s+(\d+(?:\.\d+)?)\s*°?")


def _parse_iso8601(value: Any) -> datetime | None:
    if not value:
        return None
    text = str(value).strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _parse_price(value: Any) -> float | None:
    if value is None:
        return None
    try:
        price = float(str(value).strip())
    except (TypeError, ValueError):
        return None
    if price > 1.0:
        price = price / 100.0
    if price < 0.0 or price > 1.0:
        return None
    return price


def _parse_number(value: Any) -> float:
    if value is None:
        return 0.0
    try:
        return float(str(value).strip())
    except (TypeError, ValueError):
        return 0.0


def _market_kind_from_series(series_ticker: str) -> str | None:
    series = (series_ticker or "").upper()
    if "HIGH" in series:
        return "HIGH"
    if "LOW" in series or "MIN" in series:
        return "LOW"
    return None


def _normalize_city_code(city: str | None) -> str | None:
    if not city:
        return None
    normalized = city.strip().upper()
    if not normalized:
        return None
    for location in WEATHER_LOCATIONS:
        if location.code == normalized or location.name.upper() == normalized:
            return location.code
    return normalized


def _is_active_market(market: dict[str, Any]) -> bool:
    status = str(market.get("status") or "").strip().lower()
    return status in {"active", "open", ""}


def _closes_in_window(close_time: datetime | None, now_utc: datetime) -> bool:
    if close_time is None:
        return False
    return now_utc + timedelta(hours=_MIN_CLOSE_HOURS) <= close_time <= now_utc + timedelta(hours=_MAX_CLOSE_HOURS)


def _market_midpoint_probability(market: dict[str, Any]) -> float | None:
    yes_bid = _parse_price(market.get("yes_bid_dollars") if market.get("yes_bid_dollars") is not None else market.get("yes_bid"))
    yes_ask = _parse_price(market.get("yes_ask_dollars") if market.get("yes_ask_dollars") is not None else market.get("yes_ask"))
    if yes_bid is not None and yes_ask is not None:
        return (yes_bid + yes_ask) / 2.0
    last_price = _parse_price(market.get("last_price_dollars") if market.get("last_price_dollars") is not None else market.get("last_price"))
    return last_price


def _market_spread(market: dict[str, Any]) -> float | None:
    yes_bid = _parse_price(market.get("yes_bid_dollars") if market.get("yes_bid_dollars") is not None else market.get("yes_bid"))
    yes_ask = _parse_price(market.get("yes_ask_dollars") if market.get("yes_ask_dollars") is not None else market.get("yes_ask"))
    if yes_bid is None or yes_ask is None:
        return None
    return max(0.0, yes_ask - yes_bid)


def _extract_temperature_contract(market: dict[str, Any], market_kind: str) -> tuple[str, float] | None:
    texts = [
        str(market.get("title") or ""),
        str(market.get("subtitle") or market.get("sub_title") or ""),
        str(market.get("ticker") or ""),
    ]
    for text in texts:
        if _TEMP_RANGE_PATTERN.search(text):
            return None

    for text in texts:
        match = _TEMP_THRESHOLD_PATTERN.search(text)
        if match is not None:
            operator = match.group(1)
            threshold = float(match.group(2))
            if market_kind == "HIGH":
                return ("gt", threshold) if operator == ">" else ("lt", threshold)
            return ("lt", threshold) if operator == "<" else ("gt", threshold)

        word_match = _TEMP_WORD_PATTERN.search(text.lower())
        if word_match is not None:
            word = word_match.group(1)
            threshold = float(word_match.group(2))
            if word in {"over", "above"}:
                return "gt", threshold
            if word in {"under", "below"}:
                return "lt", threshold
    return None


def _ticker_forecast_date(ticker: str) -> date | None:
    match = _TICKER_DATE_RE.search(ticker or "")
    if match is None:
        return None
    year_2d, month_abbr, day_str = match.group(1), match.group(2), match.group(3)
    month = _MONTH_ABBR.get(month_abbr.upper())
    if month is None:
        return None
    try:
        return date(2000 + int(year_2d), month, int(day_str))
    except ValueError:
        return None


async def _load_series_markets(client: KalshiClient, series_ticker: str) -> tuple[list[dict[str, Any]], list[str]]:
    markets: list[dict[str, Any]] = []
    errors: list[str] = []
    cursor: str | None = None

    for _ in range(12):
        try:
            data = await client.list_events(
                limit=200,
                cursor=cursor,
                status="open",
                series_ticker=series_ticker,
                with_nested_markets=True,
            )
        except Exception as exc:
            errors.append(f"{series_ticker}: {exc}")
            break

        events = data.get("events") or []
        if not isinstance(events, list):
            break

        for event in events:
            if not isinstance(event, dict):
                continue
            event_ticker = event.get("event_ticker") or event.get("ticker")
            raw_markets = event.get("markets") or []
            if not isinstance(raw_markets, list):
                continue
            for market in raw_markets:
                if not isinstance(market, dict):
                    continue
                row = dict(market)
                row.setdefault("series_ticker", series_ticker)
                row.setdefault("event_ticker", event_ticker)
                markets.append(row)

        cursor = data.get("cursor") or None
        if not cursor or not events:
            break

    return markets, errors


async def _ensemble_for_market(
    *,
    location: WeatherLocation,
    forecast_date: date,
    market_kind: str,
    threshold_kind: str,
    threshold: float,
    semaphore: asyncio.Semaphore,
) -> dict[str, Any] | None:
    direction = "above" if threshold_kind == "gt" else "below"
    member_mode = "member_highs" if market_kind == "HIGH" else "member_lows"
    model_probs: dict[str, float | None] = {"gfs": None, "ecmwf": None}
    member_count = 0
    all_members: list[float] = []

    async def fetch_model(model_key: str) -> None:
        nonlocal member_count
        async with semaphore:
            try:
                result = await fetch_ensemble(
                    model_key=model_key,
                    location_key=location.code.lower(),
                    latitude=location.lat,
                    longitude=location.lng,
                    timezone_name=location.timezone,
                    forecast_date=forecast_date,
                )
            except Exception as exc:
                log.info("ensemble %s failed for %s %s: %s", model_key, location.code, forecast_date, exc)
                return
        members = [float(value) for value in result.get(member_mode, []) if value is not None]
        if not members:
            return
        model_probs[model_key] = probability_for_threshold(members, threshold, direction)
        member_count += len(members)
        all_members.extend(members)

    await asyncio.gather(fetch_model("gfs"), fetch_model("ecmwf"))

    available = [(name, prob) for name, prob in model_probs.items() if prob is not None]
    if not available:
        return None

    fair_yes = sum(float(prob) for _, prob in available) / len(available)
    grand_yes = fair_yes > 0.5
    agreement_count = sum(1 for _, prob in available if (float(prob) > 0.5) == grand_yes)
    confidence = abs(fair_yes - 0.5) * 2.0
    if all_members:
        hits = sum(1 for value in all_members if (value > threshold if direction == "above" else value < threshold))
        confidence = abs((hits / len(all_members)) - 0.5) * 2.0

    return {
        "probability": fair_yes,
        "confidence": confidence,
        "member_count": member_count,
        "agreement_count": agreement_count,
        "available_count": len(available),
        "gfs_prob": model_probs["gfs"],
        "aigefs_prob": None,
        "ecmwf_prob": model_probs["ecmwf"],
        "aifs_prob": None,
    }


async def _refresh_weather_opportunities(client: KalshiClient) -> dict[str, Any]:
    now_dt = datetime.now(timezone.utc)
    fetch_semaphore = asyncio.Semaphore(_FETCH_CONCURRENCY)
    ensemble_semaphore = asyncio.Semaphore(_ENSEMBLE_CONCURRENCY)

    series_to_scan = sorted(
        {
            series
            for location in WEATHER_LOCATIONS
            for series in location.series
            if _market_kind_from_series(series) is not None
        }
    )

    async def load_one(series_ticker: str) -> tuple[str, list[dict[str, Any]], list[str]]:
        async with fetch_semaphore:
            markets, errors = await _load_series_markets(client, series_ticker)
            return series_ticker, markets, errors

    series_results = await asyncio.gather(*(load_one(series) for series in series_to_scan))

    rows: list[dict[str, Any]] = []
    errors: list[str] = []

    async def build_row(
        series_ticker: str,
        market: dict[str, Any],
        location: WeatherLocation,
        market_kind: str,
    ) -> dict[str, Any] | None:
        if not _is_active_market(market):
            return None

        close_time = _parse_iso8601(market.get("close_time"))
        if not _closes_in_window(close_time, now_dt):
            return None

        midpoint = _market_midpoint_probability(market)
        spread = _market_spread(market)
        contract = _extract_temperature_contract(market, market_kind)
        volume = _parse_number(market.get("volume") or market.get("volume_fp") or market.get("volume_24h"))
        open_interest = _parse_number(market.get("open_interest") or market.get("open_interest_fp"))
        if midpoint is None or spread is None or contract is None or close_time is None:
            return None
        if spread > _MAX_SPREAD or volume < _MIN_VOLUME or open_interest < _MIN_OPEN_INTEREST:
            return None

        threshold_kind, threshold = contract
        forecast_date = _ticker_forecast_date(str(market.get("ticker") or "")) or close_time.date()
        ensemble = await _ensemble_for_market(
            location=location,
            forecast_date=forecast_date,
            market_kind=market_kind,
            threshold_kind=threshold_kind,
            threshold=threshold,
            semaphore=ensemble_semaphore,
        )
        if ensemble is None:
            return None

        fair_yes = float(ensemble["probability"])
        yes_bid = _parse_price(market.get("yes_bid_dollars") or market.get("yes_bid"))
        yes_ask = _parse_price(market.get("yes_ask_dollars") or market.get("yes_ask"))
        no_bid = _parse_price(market.get("no_bid_dollars") or market.get("no_bid"))
        no_ask = _parse_price(market.get("no_ask_dollars") or market.get("no_ask"))
        no_mid = ((no_bid + no_ask) / 2.0) if no_bid is not None and no_ask is not None else None
        yes_edge = fair_yes - midpoint
        no_edge = ((1.0 - fair_yes) - no_mid) if no_mid is not None else float("-inf")
        if yes_edge >= no_edge:
            recommended_side = "YES"
            trade_edge = yes_edge
        else:
            recommended_side = "NO"
            trade_edge = no_edge

        model_probs = [
            ensemble.get("gfs_prob"),
            ensemble.get("aigefs_prob"),
            ensemble.get("ecmwf_prob"),
            ensemble.get("aifs_prob"),
        ]
        available_probs = [float(prob) for prob in model_probs if prob is not None]
        disagreement_spread = max(available_probs) - min(available_probs) if len(available_probs) >= 2 else 0.0

        return {
            "ticker": str(market.get("ticker") or ""),
            "title": market.get("title"),
            "series_ticker": series_ticker,
            "event_ticker": market.get("event_ticker"),
            "city_code": location.code,
            "city_name": location.name,
            "market_kind": market_kind,
            "strike_label": f"{'>' if threshold_kind == 'gt' else '<'}{threshold:g}°",
            "threshold": threshold,
            "threshold_kind": threshold_kind,
            "close_time": close_time.isoformat(),
            "kalshi_yes_bid": yes_bid,
            "kalshi_yes_ask": yes_ask,
            "kalshi_yes_mid": midpoint,
            "kalshi_no_bid": no_bid,
            "kalshi_no_ask": no_ask,
            "kalshi_no_mid": no_mid,
            "fair_yes": fair_yes,
            "yes_edge": yes_edge,
            "trade_edge": trade_edge,
            "recommended_side": recommended_side,
            "confidence": ensemble.get("confidence"),
            "member_count": ensemble.get("member_count"),
            "agreement_count": ensemble.get("agreement_count"),
            "available_model_count": ensemble.get("available_count") or len(available_probs),
            "gfs_prob": ensemble.get("gfs_prob"),
            "aigefs_prob": ensemble.get("aigefs_prob"),
            "ecmwf_prob": ensemble.get("ecmwf_prob"),
            "aifs_prob": ensemble.get("aifs_prob"),
            "disagreement_spread": disagreement_spread,
            "spread": spread,
            "volume": volume,
            "open_interest": open_interest,
        }

    row_tasks: list[asyncio.Task[dict[str, Any] | None]] = []
    for series_ticker, markets, series_errors in series_results:
        errors.extend(series_errors)
        location = SERIES_TO_WEATHER_LOCATION.get(series_ticker)
        market_kind = _market_kind_from_series(series_ticker)
        if location is None or market_kind is None:
            continue
        for market in markets:
            row_tasks.append(asyncio.create_task(build_row(series_ticker, market, location, market_kind)))

    if row_tasks:
        for result in await asyncio.gather(*row_tasks):
            if result is not None:
                rows.append(result)

    rows.sort(key=lambda row: float(row["trade_edge"]), reverse=True)
    snapshot = {
        "generated_at": int(time.time()),
        "expires_at": time.time() + _CACHE_TTL_SECONDS,
        "rows": rows,
        "errors": errors[:25],
    }
    _CACHE.update(snapshot)
    return snapshot


def _apply_filters(
    rows: list[dict[str, Any]],
    *,
    city: str | None,
    market_kind: str | None,
    min_edge: float,
    min_confidence: float,
    min_agreement: int,
    limit: int,
    sort: str,
) -> list[dict[str, Any]]:
    city_code = _normalize_city_code(city)
    normalized_kind = (market_kind or "").strip().upper() or None
    if normalized_kind not in {None, "HIGH", "LOW"}:
        normalized_kind = None

    filtered: list[dict[str, Any]] = []
    for row in rows:
        if city_code and row.get("city_code") != city_code:
            continue
        if normalized_kind and row.get("market_kind") != normalized_kind:
            continue
        if float(row.get("trade_edge") or 0.0) < max(min_edge, 0.0):
            continue
        confidence = row.get("confidence")
        if min_confidence > 0 and (confidence is None or float(confidence) < min_confidence):
            continue
        agreement_count = int(row.get("agreement_count") or 0)
        if min_agreement > 0 and agreement_count < min_agreement:
            continue
        filtered.append(row)

    sort_key = (sort or "edge").strip().lower()
    if sort_key == "confidence":
        filtered.sort(
            key=lambda row: (float(row.get("confidence") or 0.0), float(row.get("trade_edge") or 0.0)),
            reverse=True,
        )
    elif sort_key == "disagreement":
        filtered.sort(
            key=lambda row: (float(row.get("disagreement_spread") or 0.0), float(row.get("trade_edge") or 0.0)),
            reverse=True,
        )
    elif sort_key == "close":
        filtered.sort(key=lambda row: str(row.get("close_time") or ""))
    else:
        filtered.sort(key=lambda row: float(row.get("trade_edge") or 0.0), reverse=True)

    return filtered[:limit]


async def fetch_weather_opportunities(
    client: KalshiClient,
    *,
    city: str | None = None,
    market_kind: str | None = None,
    min_edge: float = 0.12,
    min_confidence: float = 0.0,
    min_agreement: int = 0,
    limit: int = 250,
    sort: str = "edge",
) -> dict[str, Any]:
    cached = _CACHE if _CACHE["expires_at"] > time.time() else None
    snapshot = cached or await _refresh_weather_opportunities(client)
    rows = _apply_filters(
        snapshot["rows"],
        city=city,
        market_kind=market_kind,
        min_edge=min_edge,
        min_confidence=min_confidence,
        min_agreement=min_agreement,
        limit=limit,
        sort=sort,
    )
    return {
        "generated_at": snapshot["generated_at"],
        "rows": rows,
        "count": len(rows),
        "total_count": len(snapshot["rows"]),
        "cache_ttl_seconds": _CACHE_TTL_SECONDS,
        "errors": snapshot.get("errors", []),
    }
