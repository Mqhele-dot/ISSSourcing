import sqlite3
from contextlib import contextmanager
from pathlib import Path

DB_PATH = Path(__file__).resolve().parents[1] / "control_tower.db"

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, username TEXT UNIQUE, role TEXT NOT NULL, password TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, username TEXT NOT NULL, role TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS connector_runs(id INTEGER PRIMARY KEY AUTOINCREMENT, connector_name TEXT, status TEXT, retries INTEGER DEFAULT 0, error TEXT, started_at TEXT, ended_at TEXT);
CREATE TABLE IF NOT EXISTS dead_letter_queue(id INTEGER PRIMARY KEY AUTOINCREMENT, connector_name TEXT, payload TEXT, error TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS batches(id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT, created_at TEXT, status TEXT);
CREATE TABLE IF NOT EXISTS staging_records(id INTEGER PRIMARY KEY AUTOINCREMENT, batch_id INTEGER, entity_type TEXT, payload TEXT, source_system TEXT, source_timestamp TEXT);
CREATE TABLE IF NOT EXISTS canonical_records(id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT, entity_id TEXT, payload TEXT, source_of_record TEXT, lineage_batch_id INTEGER, updated_at TEXT);
CREATE TABLE IF NOT EXISTS inventory_movement(id INTEGER PRIMARY KEY AUTOINCREMENT, sku TEXT NOT NULL, location TEXT NOT NULL, delta INTEGER NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL, created_by TEXT);
CREATE TABLE IF NOT EXISTS exception_cases(id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT, severity TEXT, status TEXT, assignee TEXT, source TEXT, related_refs TEXT, sla_due_at TEXT, reason TEXT, linked_entity_id TEXT, created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS case_comments(id INTEGER PRIMARY KEY AUTOINCREMENT, case_id INTEGER, author TEXT, comment TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS audit_event(id INTEGER PRIMARY KEY AUTOINCREMENT, event_type TEXT, actor TEXT, entity_type TEXT, entity_id TEXT, payload TEXT, prev_hash TEXT, event_hash TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
"""


@contextmanager
def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def _ensure_column(conn: sqlite3.Connection, table: str, column: str, definition: str) -> None:
    columns = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}
    if column not in columns:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def init_db() -> None:
    with get_conn() as conn:
        conn.executescript(SCHEMA_SQL)
        _ensure_column(conn, "exception_cases", "source", "TEXT")
        _ensure_column(conn, "exception_cases", "related_refs", "TEXT")
