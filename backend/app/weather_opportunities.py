"""Dashboard opportunities feed for Kalshi HIGH/LOW weather markets."""
from __future__ import annotations

import asyncio
import importlib
import logging
import sys
import time
from pathlib import Path
from typing import Any

from .config import settings
from .kalshi_client import KalshiClient
from .weather_locations import SERIES_TO_WEATHER_LOCATION, WEATHER_LOCATIONS

log = logging.getLogger("kalshi-dashboard.weather-opportunities")

_CACHE_TTL_SECONDS = 180
_FETCH_CONCURRENCY = 4
_CACHE: dict[str, Any] = {
    "expires_at": 0.0,
    "generated_at": 0,
    "rows": [],
    "errors": [],
}
_BOT_HELPERS: dict[str, Any] | None = None


def _weather_bot_root() -> Path:
    configured_path = settings.weather_bot_db_path.strip()
    if not configured_path:
        raise RuntimeError("optional weather bot path is not configured")
    return Path(configured_path).expanduser().resolve().parent


def _load_bot_helpers() -> dict[str, Any]:
    global _BOT_HELPERS
    if _BOT_HELPERS is not None:
        return _BOT_HELPERS

    root = _weather_bot_root()
    if not root.exists():
        raise RuntimeError(f"weather bot directory not found: {root}")

    root_str = str(root)
    if root_str not in sys.path:
        sys.path.insert(0, root_str)

    try:
        module = importlib.import_module("weather_trade_candidates")
    except ModuleNotFoundError as exc:
        raise RuntimeError("optional weather bot helper module is not available") from exc
    _BOT_HELPERS = {
        "EDGE_THRESHOLD": module.EDGE_THRESHOLD,
        "MAX_SPREAD": module.MAX_SPREAD,
        "MIN_OPEN_INTEREST": module.MIN_OPEN_INTEREST,
        "MIN_VOLUME": module.MIN_VOLUME,
        "closes_between_2_and_48_hours": module.closes_between_2_and_48_hours,
        "extract_temperature_contract": module.extract_temperature_contract,
        "is_active_market": module.is_active_market,
        "market_midpoint_probability": module.market_midpoint_probability,
        "market_spread": module.market_spread,
        "parse_iso8601": module.parse_iso8601,
        "parse_number": module.parse_number,
        "parse_price": module.parse_price,
        "try_ensemble_for_market": module._try_ensemble_for_market,
    }
    return _BOT_HELPERS


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


async def _refresh_weather_opportunities(client: KalshiClient) -> dict[str, Any]:
    try:
        helpers = _load_bot_helpers()
    except (RuntimeError, AttributeError) as exc:
        snapshot = {
            "generated_at": int(time.time()),
            "expires_at": time.time() + _CACHE_TTL_SECONDS,
            "rows": [],
            "errors": [f"weather opportunities unavailable: {exc}"],
        }
        _CACHE.update(snapshot)
        return snapshot

    now_utc = time.time()
    semaphore = asyncio.Semaphore(_FETCH_CONCURRENCY)

    series_to_scan = sorted(
        {
            series
            for location in WEATHER_LOCATIONS
            for series in location.series
            if _market_kind_from_series(series) is not None
        }
    )

    async def load_one(series_ticker: str) -> tuple[str, list[dict[str, Any]], list[str]]:
        async with semaphore:
            markets, errors = await _load_series_markets(client, series_ticker)
            return series_ticker, markets, errors

    series_results = await asyncio.gather(*(load_one(series) for series in series_to_scan))

    ensemble_cache: dict[Any, Any] = {}
    hgefs_cache: dict[Any, Any] = {}
    ecmwf_cache: dict[Any, Any] = {}
    aifs_cache: dict[Any, Any] = {}
    rows: list[dict[str, Any]] = []
    errors: list[str] = []
    now_dt = helpers["parse_iso8601"](time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime(now_utc)))
    if now_dt is None:
        raise RuntimeError("failed to compute current UTC time")

    for series_ticker, markets, series_errors in series_results:
        errors.extend(series_errors)
        location = SERIES_TO_WEATHER_LOCATION.get(series_ticker)
        market_kind = _market_kind_from_series(series_ticker)
        if location is None or market_kind is None:
            continue

        scan_kind = "high_temp" if market_kind == "HIGH" else "low_temp"
        for market in markets:
            if not helpers["is_active_market"](market):
                continue
            if not helpers["closes_between_2_and_48_hours"](market, now_dt):
                continue

            close_time = helpers["parse_iso8601"](market.get("close_time"))
            midpoint = helpers["market_midpoint_probability"](market)
            spread = helpers["market_spread"](market)
            volume = helpers["parse_number"](market.get("volume_fp"))
            open_interest = helpers["parse_number"](market.get("open_interest_fp"))
            contract = helpers["extract_temperature_contract"](market, scan_kind)
            if (
                close_time is None
                or midpoint is None
                or spread is None
                or volume is None
                or open_interest is None
                or contract is None
            ):
                continue
            if spread > helpers["MAX_SPREAD"] or volume < helpers["MIN_VOLUME"] or open_interest < helpers["MIN_OPEN_INTEREST"]:
                continue

            threshold_kind, threshold = contract
            try:
                ensemble = helpers["try_ensemble_for_market"](
                    market,
                    scan_kind,
                    location.name,
                    close_time,
                    threshold_kind,
                    threshold,
                    ensemble_cache,
                    hgefs_cache=hgefs_cache,
                    ecmwf_cache=ecmwf_cache,
                    aifs_cache=aifs_cache,
                )
            except Exception as exc:
                log.warning("weather opportunity ensemble failed for %s: %s", market.get("ticker"), exc)
                continue
            if ensemble is None:
                continue

            fair_yes = float(ensemble["probability"])
            yes_bid = helpers["parse_price"](market.get("yes_bid_dollars"))
            yes_ask = helpers["parse_price"](market.get("yes_ask_dollars"))
            no_bid = helpers["parse_price"](market.get("no_bid_dollars"))
            no_ask = helpers["parse_price"](market.get("no_ask_dollars"))
            no_mid = ((no_bid + no_ask) / 2.0) if no_bid is not None and no_ask is not None else None
            yes_edge = fair_yes - midpoint
            no_edge = ((1.0 - fair_yes) - no_mid) if no_mid is not None else float("-inf")
            if yes_edge >= no_edge:
                recommended_side = "YES"
                trade_edge = yes_edge
            else:
                recommended_side = "NO"
                trade_edge = no_edge
            if trade_edge < helpers["EDGE_THRESHOLD"]:
                continue

            model_probs = [
                ensemble.get("gfs_prob"),
                ensemble.get("aigefs_prob"),
                ensemble.get("ecmwf_prob"),
                ensemble.get("aifs_prob"),
            ]
            available_probs = [float(prob) for prob in model_probs if prob is not None]
            disagreement_spread = (
                max(available_probs) - min(available_probs) if len(available_probs) >= 2 else 0.0
            )

            rows.append(
                {
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
            )

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
    cached = _CACHE if _CACHE["expires_at"] > time.time() and (_CACHE["rows"] or _CACHE["errors"]) else None
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
