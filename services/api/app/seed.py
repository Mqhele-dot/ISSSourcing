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
                {"po_number": "PO-1001", "supplier": "Acme Supplies", "status": "open", "requested_date": (now + timedelta(days=4)).date().isoformat(), "lines": [{"sku": "SKU-1", "qty": 10, "uom": "EA"}, {"sku": "SKU-3", "qty": 4, "uom": "EA"}]},
                {"po_number": "PO-1002", "supplier": "Global Parts Co", "status": "open", "requested_date": (now + timedelta(days=6)).date().isoformat(), "lines": [{"sku": "SKU-2", "qty": 6, "uom": "EA"}]},
                {"po_number": "PO-1003", "supplier": "Nova Industrial", "status": "received", "requested_date": (now - timedelta(days=1)).date().isoformat(), "lines": [{"sku": "SKU-4", "qty": 3, "uom": "EA"}]},
            ]
            shipment_rows = [
                {"shipment_id": "SHIP-2001", "po_number": "PO-1001", "carrier": "DHL", "status": "in_transit", "eta": (now + timedelta(hours=18)).isoformat(), "origin": "Shenzhen", "dest": "Johannesburg", "eta_drift_hours": 10, "events": [{"status": "picked_up", "at": (now - timedelta(hours=6)).isoformat()}]},
                {"shipment_id": "SHIP-2002", "po_number": "PO-1002", "carrier": "Maersk", "status": "in_transit", "eta": (now + timedelta(hours=36)).isoformat(), "origin": "Rotterdam", "dest": "Cape Town", "eta_drift_hours": 3, "events": [{"status": "loaded", "at": (now - timedelta(hours=8)).isoformat()}]},
                {"shipment_id": "SHIP-2003", "po_number": "PO-1003", "carrier": "FedEx", "status": "delivered", "eta": (now - timedelta(hours=8)).isoformat(), "origin": "Nairobi", "dest": "Durban", "eta_drift_hours": 0, "events": [{"status": "delivered", "at": (now - timedelta(hours=8)).isoformat()}]},
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
