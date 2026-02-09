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
        self.input_ref = str(folder)

    def _canonical_upsert(self, conn, entity_type: str, payload: dict, updated_at: str):
        entity_id_map = {
            "inventory_position": f"{payload.get('sku', 'unknown')}:{payload.get('location', 'unknown')}",
            "purchase_order": str(payload.get("po_number", "unknown")),
            "shipment": str(payload.get("shipment_id", "unknown")),
        }
        entity_id = entity_id_map.get(entity_type, str(payload.get("id", "unknown")))
        conn.execute(
            "INSERT INTO canonical_records(entity_type, entity_id, payload, source_of_record, lineage_batch_id, updated_at) VALUES(?,?,?,?,?,?)",
            (entity_type, entity_id, json.dumps(payload), self.name, 0, updated_at),
        )

    def run(self) -> ConnectorResult:
        processed = 0
        files = sorted(self.folder.glob("*.csv"))
        now = datetime.now(timezone.utc).isoformat()
        with get_conn() as conn:
            batch = conn.execute(
                "INSERT INTO batches(source, created_at, status) VALUES(?,?,?)",
                (self.name, now, "running"),
            )
            batch_id = batch.lastrowid
            for file in files:
                with file.open() as f:
                    for row in csv.DictReader(f):
                        entity_type = row.get("entity_type", "unknown")
                        conn.execute(
                            "INSERT INTO staging_records(batch_id, entity_type, payload, source_system, source_timestamp) VALUES(?,?,?,?,?)",
                            (batch_id, entity_type, json.dumps(row), self.name, now),
                        )
                        if entity_type in {"inventory_position", "purchase_order", "shipment"}:
                            payload = dict(row)
                            if entity_type == "inventory_position":
                                payload["on_hand"] = int(payload.get("on_hand", 0) or 0)
                                payload["available"] = int(payload.get("available", 0) or 0)
                                payload.setdefault("updated_at", now)
                            self._canonical_upsert(conn, entity_type, payload, now)
                        processed += 1
            conn.execute("UPDATE batches SET status=? WHERE id=?", ("done", batch_id))
        return ConnectorResult(status="success", processed=processed, message=f"processed {processed} rows", batch_id=batch_id)
