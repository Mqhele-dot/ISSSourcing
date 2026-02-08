from datetime import date, datetime
from typing import Any


def detect_demo_exceptions(records: dict[str, list[dict[str, Any]]]) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []

    for shipment in records.get("shipment", []):
        drift = shipment.get("eta_drift_hours")
        if isinstance(drift, (int, float)) and drift >= 8:
            findings.append(
                {
                    "type": "shipment_delay",
                    "severity": "high",
                    "reason": f"Shipment drift is {drift}h",
                    "linked_entity_id": shipment.get("shipment_id", "unknown"),
                }
            )

    today = date.today().isoformat()
    for po in records.get("purchase_order", []):
        if str(po.get("status", "")).lower() == "open" and str(po.get("requested_date", "")) < today:
            findings.append(
                {
                    "type": "late_po",
                    "severity": "medium",
                    "reason": "Open PO requested date is in the past",
                    "linked_entity_id": po.get("po_number", "unknown"),
                }
            )

    for inv in records.get("inventory_position", []):
        available = inv.get("available")
        if isinstance(available, (int, float)) and available < 0:
            findings.append(
                {
                    "type": "negative_inventory",
                    "severity": "high",
                    "reason": "Inventory available quantity is negative",
                    "linked_entity_id": inv.get("sku", "unknown"),
                }
            )

    return findings


def detect_response(items: list[dict[str, Any]]) -> dict[str, Any]:
    if not items:
        return {"items": [], "message": "No open exceptions"}
    return {"items": items}
