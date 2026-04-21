"""SQLite storage for account snapshots (equity curve history)."""
import sqlite3
from contextlib import contextmanager
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    balance_cents INTEGER NOT NULL,
    total_unrealized_cents INTEGER NOT NULL,
    total_realized_cents INTEGER NOT NULL,
    total_exposure_cents INTEGER NOT NULL,
    position_count INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_snapshots_ts ON snapshots(ts);
"""


def init_db(db_path: str) -> None:
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(db_path) as conn:
        conn.executescript(SCHEMA)


@contextmanager
def get_conn(db_path: str):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def insert_snapshot(
    db_path: str,
    ts: int,
    balance_cents: int,
    total_unrealized_cents: int,
    total_realized_cents: int,
    total_exposure_cents: int,
    position_count: int,
) -> None:
    with get_conn(db_path) as conn:
        conn.execute(
            "INSERT INTO snapshots (ts, balance_cents, total_unrealized_cents, "
            "total_realized_cents, total_exposure_cents, position_count) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (ts, balance_cents, total_unrealized_cents, total_realized_cents,
             total_exposure_cents, position_count),
        )


def get_snapshots(db_path: str, since_ts: int | None = None, limit: int = 5000) -> list[dict]:
    with get_conn(db_path) as conn:
        if since_ts is not None:
            cur = conn.execute(
                "SELECT * FROM snapshots WHERE ts >= ? ORDER BY ts ASC LIMIT ?",
                (since_ts, limit),
            )
        else:
            cur = conn.execute(
                "SELECT * FROM snapshots ORDER BY ts ASC LIMIT ?",
                (limit,),
            )
        return [dict(row) for row in cur.fetchall()]
