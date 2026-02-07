from datetime import datetime, timezone

from ..db import get_conn
from .audit import append_audit_event


def create_case_comment(case_id: int, comment: str, username: str) -> None:
    with get_conn() as conn:
        conn.execute(
            'INSERT INTO case_comments(case_id, author, comment, created_at) VALUES(?,?,?,?)',
            (case_id, username, comment, datetime.now(timezone.utc).isoformat()),
        )
    append_audit_event('case.comment', username, 'exception_case', str(case_id), {'comment': comment})
