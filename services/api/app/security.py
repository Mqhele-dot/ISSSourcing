from datetime import datetime, timezone
from secrets import token_urlsafe
from fastapi import HTTPException
from .db import get_conn

ROLES = {"Planner", "Ops", "Admin"}


def create_session(username: str, role: str) -> str:
    token = token_urlsafe(24)
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO sessions(token, username, role, created_at) VALUES(?,?,?,?)",
            (token, username, role, datetime.now(timezone.utc).isoformat()),
        )
    return token


def require_role(token: str, allowed: set[str]) -> dict:
    with get_conn() as conn:
        row = conn.execute("SELECT username, role FROM sessions WHERE token=?", (token,)).fetchone()
    if not row:
        raise HTTPException(status_code=401, detail="Invalid session")
    if row["role"] not in allowed:
        raise HTTPException(status_code=403, detail="Forbidden")
    return {"username": row["username"], "role": row["role"]}
