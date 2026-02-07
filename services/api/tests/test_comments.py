from datetime import datetime, timezone

from app import db
from app.services.cases import create_case_comment


def test_add_comment_stores_row_and_audit(tmp_path, monkeypatch):
    monkeypatch.setattr(db, 'DB_PATH', tmp_path / 'comments.db')
    db.init_db()

    with db.get_conn() as conn:
        conn.execute(
            "INSERT INTO exception_cases(type,severity,status,assignee,sla_due_at,reason,linked_entity_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
            (
                'stockout_risk',
                'high',
                'open',
                'unassigned',
                datetime.now(timezone.utc).isoformat(),
                'risk',
                'SKU-1',
                datetime.now(timezone.utc).isoformat(),
                datetime.now(timezone.utc).isoformat(),
            ),
        )

    create_case_comment(1, 'checking with supplier', 'planner')

    with db.get_conn() as conn:
        comment = conn.execute('SELECT case_id, author, comment FROM case_comments WHERE case_id=1').fetchone()
        assert comment is not None
        assert comment['author'] == 'planner'
        assert comment['comment'] == 'checking with supplier'

        audit = conn.execute("SELECT event_type, entity_id, payload FROM audit_event WHERE event_type='case.comment' ORDER BY id DESC LIMIT 1").fetchone()
        assert audit is not None
        assert audit['entity_id'] == '1'
        assert 'checking with supplier' in audit['payload']
