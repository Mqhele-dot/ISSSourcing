from .db import get_conn


def seed_demo_data() -> None:
    with get_conn() as conn:
        conn.execute("INSERT OR IGNORE INTO users(username, role, password) VALUES('planner','Planner','demo')")
        conn.execute("INSERT OR IGNORE INTO users(username, role, password) VALUES('ops','Ops','demo')")
        conn.execute("INSERT OR IGNORE INTO users(username, role, password) VALUES('admin','Admin','demo')")
        conn.execute("INSERT OR REPLACE INTO settings(key,value) VALUES('demo_mode','true')")
