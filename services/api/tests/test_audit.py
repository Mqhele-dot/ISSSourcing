from app.db import init_db, get_conn
from app.services.audit import append_audit_event, verify_chain


def test_audit_hash_chain_detects_tampering(tmp_path, monkeypatch):
    from app import db
    monkeypatch.setattr(db, 'DB_PATH', tmp_path / 't.db')
    init_db()
    append_audit_event('x', 'u', 'e', '1', {'a': 1})
    append_audit_event('y', 'u', 'e', '2', {'a': 2})
    assert verify_chain() is True
    with get_conn() as conn:
        conn.execute("UPDATE audit_event SET payload='{}' WHERE id=2")
    assert verify_chain() is False
