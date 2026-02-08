import json
from datetime import datetime, timedelta, timezone

from .db import get_conn


def seed_demo_data() -> None:
    with get_conn() as conn:
        conn.execute("INSERT OR IGNORE INTO users(username, role, password) VALUES('planner','Planner','demo')")
        conn.execute("INSERT OR IGNORE INTO users(username, role, password) VALUES('ops','Ops','demo')")
        conn.execute("INSERT OR IGNORE INTO users(username, role, password) VALUES('admin','Admin','demo')")
        conn.execute("INSERT OR REPLACE INTO settings(key,value) VALUES('demo_mode','true')")

        canonical_count = conn.execute("SELECT COUNT(*) AS c FROM canonical_records").fetchone()["c"]
        if canonical_count == 0:
            now = datetime.now(timezone.utc)

            inventory_rows = [
                {"sku": "SKU-1", "location": "WH-JHB", "on_hand": 120, "available": 94, "updated_at": now.isoformat()},
                {"sku": "SKU-2", "location": "WH-CPT", "on_hand": 60, "available": 51, "updated_at": (now - timedelta(hours=1)).isoformat()},
                {"sku": "SKU-3", "location": "WH-DUR", "on_hand": 32, "available": 24, "updated_at": (now - timedelta(hours=2)).isoformat()},
            ]
            po_rows = [
                {"po_number": "PO-1001", "supplier": "Acme Supplies", "status": "open", "requested_date": (now + timedelta(days=4)).date().isoformat(), "lines": 4},
                {"po_number": "PO-1002", "supplier": "Global Parts Co", "status": "open", "requested_date": (now + timedelta(days=6)).date().isoformat(), "lines": 2},
                {"po_number": "PO-1003", "supplier": "Nova Industrial", "status": "closed", "requested_date": (now - timedelta(days=1)).date().isoformat(), "lines": 5},
            ]
            shipment_rows = [
                {"shipment_id": "SHIP-2001", "carrier": "DHL", "status": "in_transit", "eta": (now + timedelta(hours=18)).isoformat(), "eta_drift_hours": 10},
                {"shipment_id": "SHIP-2002", "carrier": "Maersk", "status": "in_transit", "eta": (now + timedelta(hours=36)).isoformat(), "eta_drift_hours": 3},
                {"shipment_id": "SHIP-2003", "carrier": "FedEx", "status": "delivered", "eta": (now - timedelta(hours=8)).isoformat(), "eta_drift_hours": 0},
            ]

            for idx, payload in enumerate(inventory_rows, start=1):
                conn.execute(
                    "INSERT INTO canonical_records(entity_type, entity_id, payload, source_of_record, lineage_batch_id, updated_at) VALUES(?,?,?,?,?,?)",
                    ("inventory_position", f"INV-{idx}", json.dumps(payload), "seed", 0, payload["updated_at"]),
                )
            for idx, payload in enumerate(po_rows, start=1):
                conn.execute(
                    "INSERT INTO canonical_records(entity_type, entity_id, payload, source_of_record, lineage_batch_id, updated_at) VALUES(?,?,?,?,?,?)",
                    ("purchase_order", f"PO-{idx}", json.dumps(payload), "seed", 0, now.isoformat()),
                )
            for idx, payload in enumerate(shipment_rows, start=1):
                conn.execute(
                    "INSERT INTO canonical_records(entity_type, entity_id, payload, source_of_record, lineage_batch_id, updated_at) VALUES(?,?,?,?,?,?)",
                    ("shipment", f"SHIP-{idx}", json.dumps(payload), "seed", 0, now.isoformat()),
                )
