import sqlite3

from app import db


def test_init_db_adds_exception_and_movement_columns_with_defaults(tmp_path, monkeypatch):
    path = tmp_path / 'migrate.db'
    monkeypatch.setattr(db, 'DB_PATH', path)

    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE exception_cases(id INTEGER PRIMARY KEY, type TEXT)")
    conn.execute("CREATE TABLE inventory_movement(id INTEGER PRIMARY KEY, sku TEXT, location TEXT, delta INTEGER, reason TEXT, created_at TEXT)")
    conn.execute("INSERT INTO exception_cases(id, type) VALUES(1, 'legacy')")
    conn.execute("INSERT INTO inventory_movement(id, sku, location, delta, reason, created_at) VALUES(1, 'SKU-1', 'WH-JHB', 1, 'legacy', 'now')")
    conn.commit()
    conn.close()

    db.init_db()

    with db.get_conn() as check:
        exc_cols = {r['name'] for r in check.execute("PRAGMA table_info(exception_cases)").fetchall()}
        mov_cols = {r['name'] for r in check.execute("PRAGMA table_info(inventory_movement)").fetchall()}
        assert 'source' in exc_cols
        assert 'related_refs' in exc_cols
        assert 'movement_type' in mov_cols
        assert 'source_ref' in mov_cols

        row = check.execute("SELECT source, related_refs FROM exception_cases WHERE id=1").fetchone()
        assert row['source'] == 'system'
        assert row['related_refs'] == '{}'

        mov = check.execute("SELECT movement_type, source_ref FROM inventory_movement WHERE id=1").fetchone()
        assert mov['movement_type'] == 'adjust'
        assert mov['source_ref'] == ''
