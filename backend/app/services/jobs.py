from datetime import datetime, timezone
from apscheduler.schedulers.background import BackgroundScheduler
from ..db import get_conn

scheduler = BackgroundScheduler()


def run_with_retry(connector, retries: int = 2):
    attempts = 0
    while attempts <= retries:
        attempts += 1
        start = datetime.now(timezone.utc).isoformat()
        try:
            result = connector.run()
            with get_conn() as conn:
                conn.execute(
                    "INSERT INTO connector_runs(connector_name,status,retries,error,started_at,ended_at) VALUES(?,?,?,?,?,?)",
                    (connector.name, result.status, attempts - 1, None, start, datetime.now(timezone.utc).isoformat()),
                )
                conn.execute("INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)", (f"freshness_{connector.name}", datetime.now(timezone.utc).isoformat()))
            return result
        except Exception as exc:
            if attempts > retries:
                with get_conn() as conn:
                    conn.execute(
                        "INSERT INTO connector_runs(connector_name,status,retries,error,started_at,ended_at) VALUES(?,?,?,?,?,?)",
                        (connector.name, "failed", attempts - 1, str(exc), start, datetime.now(timezone.utc).isoformat()),
                    )
                    conn.execute(
                        "INSERT INTO dead_letter_queue(connector_name,payload,error,created_at) VALUES(?,?,?,?)",
                        (connector.name, "{}", str(exc), datetime.now(timezone.utc).isoformat()),
                    )
                raise


def schedule_connector(connector, cadence: str):
    interval_minutes = {"5m": 5, "hour": 60, "day": 1440}[cadence]
    scheduler.add_job(lambda: run_with_retry(connector), "interval", minutes=interval_minutes, id=connector.name, replace_existing=True)


def start_scheduler():
    if not scheduler.running:
        scheduler.start()
