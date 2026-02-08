#!/usr/bin/env python3
from pathlib import Path
import tempfile

from app import db
from app.health import deep_health
from app.seed import seed_demo_data


def main() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        db.DB_PATH = Path(tmp) / "smoke.db"
        db.init_db()
        seed_demo_data()
        health = deep_health(db.get_conn)
        if health.get("status") not in {"ok", "degraded"}:
            raise SystemExit("deep_health unexpected")

        with db.get_conn() as conn:
            exc_cols = {r["name"] for r in conn.execute("PRAGMA table_info(exception_cases)").fetchall()}
            mov_cols = {r["name"] for r in conn.execute("PRAGMA table_info(inventory_movement)").fetchall()}
            assert "source" in exc_cols
            assert "related_refs" in exc_cols
            assert "movement_type" in mov_cols
            assert "source_ref" in mov_cols

            sample = conn.execute("SELECT source, related_refs FROM exception_cases LIMIT 1").fetchone()
            if sample:
                assert sample["source"] is not None
                assert sample["related_refs"] is not None

    print("smoke_no_deps ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
