"""Read model signals from local predict-and-profit bot SQLite databases."""
from __future__ import annotations

import os
import sqlite3
from pathlib import Path
from typing import Any


def _connect_readonly(path: str) -> sqlite3.Connection | None:
    if not path or not Path(path).exists():
        return None
    uri = f"file:{Path(path).resolve()}?mode=ro"
    conn = sqlite3.connect(uri, uri=True, timeout=1.0)
    conn.row_factory = sqlite3.Row
    return conn


def _normalize_prob(value: Any) -> float | None:
    if value is None:
        return None
    try:
        prob = float(value)
    except (TypeError, ValueError):
        return None
    if prob > 1.0:
        prob = prob / 100.0
    if prob < 0.0 or prob > 1.0:
        return None
    return prob


def _normalize_decimal(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _rows_for_weather_db(path: str, tickers: list[str] | None) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    status = {"source": "weather", "path": os.path.expanduser(path), "available": False, "error": None}
    conn = _connect_readonly(path)
    if conn is None:
        status["error"] = "database not found"
        return [], status

    try:
        params: list[Any] = []
        where = ""
        if tickers:
            where = f"WHERE ticker IN ({','.join('?' for _ in tickers)})"
            params = tickers
        rows = conn.execute(
            f"""
            SELECT
                id,
                ticker,
                lower(side) AS side,
                ensemble_probability AS model_yes_probability,
                ensemble_confidence AS confidence,
                ensemble_member_count AS member_count,
                limit_price AS entry_price,
                edge_pct AS bot_edge,
                composite_score AS score,
                was_chosen,
                skip_reason,
                evaluated_at AS observed_at
            FROM trade_decisions
            {where}
            ORDER BY evaluated_at DESC, id DESC
            LIMIT 500
            """,
            params,
        ).fetchall()
        status["available"] = True
    except Exception as exc:
        status["error"] = str(exc)
        rows = []
    finally:
        conn.close()

    return [_signal_from_row("weather", row) for row in rows], status


def _rows_for_econ_db(path: str, tickers: list[str] | None) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    status = {"source": "econ", "path": os.path.expanduser(path), "available": False, "error": None}
    conn = _connect_readonly(path)
    if conn is None:
        status["error"] = "database not found"
        return [], status

    try:
        params: list[Any] = []
        where = ""
        if tickers:
            where = f"WHERE ticker IN ({','.join('?' for _ in tickers)})"
            params = tickers
        rows = conn.execute(
            f"""
            SELECT
                id,
                ticker,
                lower(side) AS side,
                model_prob AS model_yes_probability,
                NULL AS confidence,
                NULL AS member_count,
                market_price AS entry_price,
                edge AS bot_edge,
                score,
                was_chosen,
                skip_reason,
                created_at AS observed_at
            FROM trade_decisions
            {where}
            ORDER BY created_at DESC, id DESC
            LIMIT 500
            """,
            params,
        ).fetchall()
        status["available"] = True
    except Exception as exc:
        status["error"] = str(exc)
        rows = []
    finally:
        conn.close()

    return [_signal_from_row("econ", row) for row in rows], status


def _signal_from_row(source: str, row: sqlite3.Row) -> dict[str, Any]:
    model_yes = _normalize_prob(row["model_yes_probability"])
    side = (row["side"] or "").lower() or None
    return {
        "ticker": row["ticker"],
        "source": source,
        "source_id": row["id"],
        "side": side,
        "model_yes_probability": model_yes,
        "model_side_probability": (1.0 - model_yes)
        if model_yes is not None and side == "no"
        else model_yes,
        "confidence": _normalize_prob(row["confidence"]),
        "member_count": row["member_count"],
        "entry_price": _normalize_decimal(row["entry_price"]),
        "bot_edge": _normalize_decimal(row["bot_edge"]),
        "score": _normalize_decimal(row["score"]),
        "was_chosen": bool(row["was_chosen"]) if row["was_chosen"] is not None else False,
        "skip_reason": row["skip_reason"],
        "observed_at": row["observed_at"],
    }


def fetch_weather_scan_activity(
    weather_db_path: str,
    days: int = 14,
) -> dict[str, Any]:
    """Aggregate weather-bot scan_cycles into a (days × 24h) candidates_found grid."""
    status = {"available": False, "error": None, "path": os.path.expanduser(weather_db_path)}
    conn = _connect_readonly(weather_db_path)
    if conn is None:
        status["error"] = "database not found"
        return {
            "days": [],
            "hours": list(range(24)),
            "cells": [],
            "max_cell": 0,
            "total_candidates": 0,
            "total_cycles": 0,
            "status": status,
        }

    try:
        rows = conn.execute(
            f"""
            SELECT
                date(scanned_at, 'localtime') AS day,
                CAST(strftime('%H', scanned_at, 'localtime') AS INTEGER) AS hour,
                COALESCE(SUM(candidates_found), 0) AS candidates,
                COUNT(*) AS cycles
            FROM scan_cycles
            WHERE scanned_at IS NOT NULL
              AND scanned_at >= date('now', 'localtime', ?)
            GROUP BY day, hour
            ORDER BY day DESC, hour ASC
            """,
            (f"-{max(days - 1, 0)} days",),
        ).fetchall()
        status["available"] = True
    except Exception as exc:
        status["error"] = str(exc)
        rows = []
    finally:
        conn.close()

    by_day: dict[str, list[int]] = {}
    total_candidates = 0
    total_cycles = 0
    for r in rows:
        day = r["day"]
        if day is None:
            continue
        hour = r["hour"] if r["hour"] is not None else 0
        candidates = int(r["candidates"] or 0)
        cycles = int(r["cycles"] or 0)
        if day not in by_day:
            by_day[day] = [0] * 24
        if 0 <= hour < 24:
            by_day[day][hour] = candidates
        total_candidates += candidates
        total_cycles += cycles

    sorted_days = sorted(by_day.keys(), reverse=True)[:days]
    cells = [by_day[d] for d in sorted_days]
    max_cell = max((max(row) for row in cells), default=0)

    return {
        "days": sorted_days,
        "hours": list(range(24)),
        "cells": cells,
        "max_cell": max_cell,
        "total_candidates": total_candidates,
        "total_cycles": total_cycles,
        "status": status,
    }


def fetch_bot_signals(
    weather_db_path: str,
    econ_db_path: str,
    tickers: list[str] | None = None,
) -> dict[str, Any]:
    """Return the latest bot signal per ticker across known bot databases."""
    normalized_tickers = sorted({t.strip() for t in tickers or [] if t.strip()})
    ticker_filter = normalized_tickers or None

    weather_rows, weather_status = _rows_for_weather_db(weather_db_path, ticker_filter)
    econ_rows, econ_status = _rows_for_econ_db(econ_db_path, ticker_filter)

    latest: dict[str, dict[str, Any]] = {}
    for row in weather_rows + econ_rows:
        ticker = row.get("ticker")
        if not ticker:
            continue
        existing = latest.get(ticker)
        if existing is None or str(row.get("observed_at") or "") > str(existing.get("observed_at") or ""):
            latest[ticker] = row

    rows = sorted(latest.values(), key=lambda r: str(r.get("observed_at") or ""), reverse=True)
    return {
        "signals": rows,
        "sources": [weather_status, econ_status],
        "count": len(rows),
    }
