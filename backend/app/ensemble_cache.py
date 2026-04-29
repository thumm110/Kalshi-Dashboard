"""Persistent SQLite cache for Open-Meteo ensemble responses.

Survives backend restarts so a fresh boot doesn't re-fetch all 22 cities ×
2 models from upstream. Schema is intentionally tiny; the cache is keyed by
(model_key, location_key, forecast_date) and stores the parsed result blob
plus the unix timestamp it was cached at. Freshness is decided by the caller.
"""
from __future__ import annotations

import json
import logging
import os
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any

log = logging.getLogger("kalshi-dashboard.ensemble-cache")

_DEFAULT_DB_PATH = "./ensemble_cache.db"
_DB_PATH = os.environ.get("ENSEMBLE_CACHE_DB_PATH", _DEFAULT_DB_PATH)
_LOCK = threading.Lock()
_CONN: sqlite3.Connection | None = None


def _connect() -> sqlite3.Connection | None:
    global _CONN
    if _CONN is not None:
        return _CONN
    try:
        Path(_DB_PATH).parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(_DB_PATH, check_same_thread=False, timeout=2.0)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS ensemble_cache (
                model_key      TEXT NOT NULL,
                location_key   TEXT NOT NULL,
                forecast_date  TEXT NOT NULL,
                cached_at      REAL NOT NULL,
                result_json    TEXT NOT NULL,
                PRIMARY KEY (model_key, location_key, forecast_date)
            )
            """
        )
        conn.commit()
        _CONN = conn
    except Exception as exc:
        log.warning("ensemble cache disabled (%s): %s", _DB_PATH, exc)
        _CONN = None
    return _CONN


def get(model_key: str, location_key: str, forecast_date: str) -> tuple[float, dict[str, Any]] | None:
    """Return (cached_at_unix, result) or None."""
    conn = _connect()
    if conn is None:
        return None
    try:
        with _LOCK:
            row = conn.execute(
                "SELECT cached_at, result_json FROM ensemble_cache "
                "WHERE model_key = ? AND location_key = ? AND forecast_date = ?",
                (model_key, location_key, forecast_date),
            ).fetchone()
    except Exception as exc:
        log.warning("ensemble cache read failed: %s", exc)
        return None
    if row is None:
        return None
    try:
        return float(row[0]), json.loads(row[1])
    except Exception:
        return None


def put(model_key: str, location_key: str, forecast_date: str, result: dict[str, Any]) -> None:
    conn = _connect()
    if conn is None:
        return
    try:
        with _LOCK:
            conn.execute(
                "INSERT INTO ensemble_cache (model_key, location_key, forecast_date, cached_at, result_json) "
                "VALUES (?, ?, ?, ?, ?) "
                "ON CONFLICT(model_key, location_key, forecast_date) DO UPDATE SET "
                "cached_at = excluded.cached_at, result_json = excluded.result_json",
                (model_key, location_key, forecast_date, time.time(), json.dumps(result)),
            )
            conn.commit()
    except Exception as exc:
        log.warning("ensemble cache write failed: %s", exc)


def cache_path() -> str:
    return _DB_PATH
