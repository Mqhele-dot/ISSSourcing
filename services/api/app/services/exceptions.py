from datetime import date, datetime, timedelta, timezone
from typing import Any
import json

DEFAULT_EXCEPTION = {
    "id": None,
    "type": "unknown",
    "severity": "medium",
    "status": "open",
    "source": "system",
    "related_refs": {"sku": [], "po": [], "shipment": []},
    "reason": None,
    "assignee": None,
    "created_at": None,
    "updated_at": None,
    "sla_due_at": None,
}


def safe_json_loads(text: str | None, default: dict[str, Any] | None = None) -> dict[str, Any]:
    fallback = default if default is not None else {}
    if not text:
        return fallback
    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, dict) else fallback
    except json.JSONDecodeError:
        return fallback


def normalize_related_refs(value: str | dict[str, Any] | None) -> dict[str, list[str]]:
    refs = safe_json_loads(value, {"sku": [], "po": [], "shipment": []}) if isinstance(value, str) or value is None else value
    out = {"sku": [], "po": [], "shipment": []}
    for key in out:
        raw = refs.get(key, []) if isinstance(refs, dict) else []
        if isinstance(raw, list):
            out[key] = [str(v) for v in raw if v]
    return out


def normalize_exception_row(row: dict[str, Any]) -> dict[str, Any]:
    base = dict(DEFAULT_EXCEPTION)
    base.update(
        {
            "id": row.get("id"),
            "type": row.get("type") or "unknown",
            "severity": row.get("severity") or "medium",
            "status": row.get("status") or "open",
            "source": row.get("source") or "system",
            "related_refs": normalize_related_refs(row.get("related_refs")),
            "reason": row.get("reason"),
            "assignee": row.get("assignee"),
            "created_at": row.get("created_at"),
            "updated_at": row.get("updated_at"),
            "sla_due_at": row.get("sla_due_at"),
        }
    )
    return base


def normalize_exception_detail(row: dict[str, Any], comments: list[dict[str, Any]]) -> dict[str, Any]:
    detail = normalize_exception_row(row)
    detail["comments"] = [
        {
            "id": c.get("id"),
            "author": c.get("author") or "unknown",
            "comment": c.get("comment") or "",
            "created_at": c.get("created_at"),
        }
        for c in comments
    ]
    return detail


def compute_sla_due_at(exc_type: str, now: datetime | None = None) -> str:
    current = now or datetime.now(timezone.utc)
    hours = {
        "inventory_shortage": 4,
        "late_shipment": 8,
        "po_mismatch": 12,
    }.get(exc_type, 24)
    return (current + timedelta(hours=hours)).isoformat()


def detect_demo_exceptions(records: dict[str, list[dict[str, Any]]]) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []

    for shipment in records.get("shipment", []):
        drift = shipment.get("eta_drift_hours")
        if isinstance(drift, (int, float)) and drift >= 8:
            findings.append(
                {
                    "type": "late_shipment",
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
                    "type": "po_mismatch",
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
                    "type": "inventory_shortage",
                    "severity": "critical",
                    "reason": "Inventory available quantity is negative",
                    "linked_entity_id": inv.get("sku", "unknown"),
                }
            )

    return findings


def detect_response(items: list[dict[str, Any]]) -> dict[str, Any]:
    if not items:
        return {"items": [], "message": "No open exceptions"}
    return {"items": items, "message": "Exceptions detected"}
