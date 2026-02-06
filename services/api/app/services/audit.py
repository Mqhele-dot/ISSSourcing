import hashlib
import json
from datetime import datetime, timezone
from ..db import get_conn


def _hash_event(prev_hash: str, payload: str) -> str:
    return hashlib.sha256(f"{prev_hash}:{payload}".encode()).hexdigest()


def append_audit_event(event_type: str, actor: str, entity_type: str, entity_id: str, payload: dict) -> str:
    payload_str = json.dumps(payload, sort_keys=True)
    with get_conn() as conn:
        prev = conn.execute("SELECT event_hash FROM audit_event ORDER BY id DESC LIMIT 1").fetchone()
        prev_hash = prev["event_hash"] if prev else "GENESIS"
        event_hash = _hash_event(prev_hash, payload_str)
        conn.execute(
            """INSERT INTO audit_event(event_type, actor, entity_type, entity_id, payload, prev_hash, event_hash, created_at)
               VALUES(?,?,?,?,?,?,?,?)""",
            (event_type, actor, entity_type, entity_id, payload_str, prev_hash, event_hash, datetime.now(timezone.utc).isoformat()),
        )
    return event_hash


def verify_chain() -> bool:
    with get_conn() as conn:
        rows = conn.execute("SELECT prev_hash, event_hash, payload FROM audit_event ORDER BY id").fetchall()
    prev = "GENESIS"
    for row in rows:
        if row["prev_hash"] != prev:
            return False
        calc = _hash_event(prev, row["payload"])
        if calc != row["event_hash"]:
            return False
        prev = row["event_hash"]
    return True
