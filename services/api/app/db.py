import sqlite3
from contextlib import contextmanager
from pathlib import Path

DB_PATH = Path(__file__).resolve().parents[1] / "control_tower.db"

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, username TEXT UNIQUE, role TEXT NOT NULL, password TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, username TEXT NOT NULL, role TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS connector_runs(id INTEGER PRIMARY KEY AUTOINCREMENT, connector_name TEXT, status TEXT, retries INTEGER DEFAULT 0, error TEXT, input_ref TEXT, output_summary TEXT, batch_id INTEGER, started_at TEXT, ended_at TEXT);
CREATE TABLE IF NOT EXISTS dead_letter_queue(id INTEGER PRIMARY KEY AUTOINCREMENT, connector_name TEXT, payload TEXT, error TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS batches(id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT, created_at TEXT, status TEXT);
CREATE TABLE IF NOT EXISTS staging_records(id INTEGER PRIMARY KEY AUTOINCREMENT, batch_id INTEGER, entity_type TEXT, payload TEXT, source_system TEXT, source_timestamp TEXT);
CREATE TABLE IF NOT EXISTS canonical_records(id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT, entity_id TEXT, payload TEXT, source_of_record TEXT, lineage_batch_id INTEGER, updated_at TEXT);
CREATE TABLE IF NOT EXISTS inventory_movement(id INTEGER PRIMARY KEY AUTOINCREMENT, sku TEXT NOT NULL, location TEXT NOT NULL, delta INTEGER NOT NULL, reason TEXT NOT NULL, movement_type TEXT DEFAULT 'adjust', source_ref TEXT DEFAULT '', created_at TEXT NOT NULL, created_by TEXT);
CREATE TABLE IF NOT EXISTS exception_cases(id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT, severity TEXT, status TEXT, assignee TEXT, source TEXT DEFAULT 'system', related_refs TEXT DEFAULT '{}', sla_due_at TEXT, reason TEXT, linked_entity_id TEXT, created_at TEXT, updated_at TEXT);
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


def column_exists(conn: sqlite3.Connection, table: str, col: str) -> bool:
    columns = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}
    return col in columns


def ensure_columns(conn: sqlite3.Connection, table: str, columns: dict[str, str]) -> None:
    for column, definition in columns.items():
        if not column_exists(conn, table, column):
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def init_db() -> None:
    with get_conn() as conn:
        conn.executescript(SCHEMA_SQL)
        ensure_columns(
            conn,
            "exception_cases",
            {
                "source": "TEXT DEFAULT 'system'",
                "related_refs": "TEXT DEFAULT '{}'",
            },
        )
        ensure_columns(
            conn,
            "inventory_movement",
            {
                "movement_type": "TEXT DEFAULT 'adjust'",
                "source_ref": "TEXT DEFAULT ''",
            },
        )
        conn.execute("UPDATE exception_cases SET source='system' WHERE source IS NULL OR source='' ")
        conn.execute("UPDATE exception_cases SET related_refs='{}' WHERE related_refs IS NULL OR related_refs='' ")
        conn.execute("UPDATE inventory_movement SET movement_type='adjust' WHERE movement_type IS NULL OR movement_type='' ")
        conn.execute("UPDATE inventory_movement SET source_ref='' WHERE source_ref IS NULL")

        ensure_columns(
            conn,
            "connector_runs",
            {
                "input_ref": "TEXT DEFAULT ''",
                "output_summary": "TEXT DEFAULT '{}'",
                "batch_id": "INTEGER",
            },
        )
        conn.execute("UPDATE connector_runs SET output_summary='{}' WHERE output_summary IS NULL OR output_summary='' ")
        conn.execute("UPDATE connector_runs SET input_ref='' WHERE input_ref IS NULL ")
