import csv
import json
from datetime import datetime, timezone
from pathlib import Path
from .base import Connector, ConnectorResult
from ..db import get_conn


class CSVDropFolderConnector(Connector):
    name = "csv_dropfolder"

    def __init__(self, folder: Path):
        self.folder = folder

    def run(self) -> ConnectorResult:
        processed = 0
        files = list(self.folder.glob("*.csv"))
        with get_conn() as conn:
            batch = conn.execute(
                "INSERT INTO batches(source, created_at, status) VALUES(?,?,?)",
                (self.name, datetime.now(timezone.utc).isoformat(), "running"),
            )
            batch_id = batch.lastrowid
            for file in files:
                with file.open() as f:
                    for row in csv.DictReader(f):
                        conn.execute(
                            "INSERT INTO staging_records(batch_id, entity_type, payload, source_system, source_timestamp) VALUES(?,?,?,?,?)",
                            (batch_id, row.get("entity_type", "unknown"), json.dumps(row), self.name, datetime.now(timezone.utc).isoformat()),
                        )
                        processed += 1
            conn.execute("UPDATE batches SET status=? WHERE id=?", ("done", batch_id))
        return ConnectorResult(status="success", processed=processed)
