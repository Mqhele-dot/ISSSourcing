import os
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .connectors.csv_dropfolder import CSVDropFolderConnector
from .connectors.erp_export import ERPExportConnector
from .db import get_conn, init_db
from .health import deep_health
from .security import create_session, require_role
from .seed import seed_demo_data
from .services.audit import append_audit_event, verify_chain
from .services.cases import create_case_comment
from .services.exceptions import (
    detect_demo_exceptions,
    compute_sla_due_at,
    detect_response,
    normalize_exception_detail,
    normalize_exception_row,
    normalize_related_refs,
)
from .services.jobs import run_with_retry, start_scheduler

app = FastAPI(title="SupplyChain Control Tower Local Backend")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_origin_regex=r"^https://.*\.app\.github\.dev$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["Authorization", "Content-Type", "Accept", "X-Requested-With"],
)


@app.exception_handler(HTTPException)
async def http_exception_handler(_request: Request, exc: HTTPException):
    detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
    return JSONResponse(status_code=exc.status_code, content={"detail": detail, "code": f"HTTP_{exc.status_code}", "hint": "Check request payload, auth token, and route."})


@app.exception_handler(Exception)
async def unhandled_exception_handler(_request: Request, exc: Exception):
    return JSONResponse(status_code=500, content={"detail": str(exc), "code": "INTERNAL_ERROR", "hint": "Review backend logs for traceback details."})


class LoginRequest(BaseModel):
    username: str
    password: str


class CommentRequest(BaseModel):
    comment: str


class ExceptionAssignRequest(BaseModel):
    assignee: str


class InventoryAdjustRequest(BaseModel):
    sku: str
    location: str
    delta: int
    reason: str
    movement_type: str = "adjust"
    source_ref: str = ""


class StatusUpdateRequest(BaseModel):
    status: str


class SnoozeRequest(BaseModel):
    hours: int = 4


class ReceiveLineRequest(BaseModel):
    sku: str
    qty: int


class ReceivePORequest(BaseModel):
    lines: list[ReceiveLineRequest] | None = None


def auth_user(authorization: str | None = Header(default=None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing token")
    token = authorization.replace("Bearer ", "")
    return require_role(token, {"Planner", "Ops", "Admin"})


@app.on_event("startup")
def startup():
    init_db()
    seed_demo_data()
    start_scheduler()


@app.get("/health")
def health():
    return {"status": "ok", "service": "api"}


@app.get("/health/deep")
def health_deep():
    return deep_health(get_conn)


@app.post("/auth/login")
def login(payload: LoginRequest):
    with get_conn() as conn:
        user = conn.execute("SELECT username, role, password FROM users WHERE username=?", (payload.username,)).fetchone()
    if not user or user["password"] != payload.password:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = create_session(user["username"], user["role"])
    return {"token": token, "role": user["role"], "username": user["username"]}


@app.get("/settings/demo-mode")
def get_demo_mode(user=Depends(auth_user)):
    with get_conn() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key='demo_mode'").fetchone()
    return {"enabled": (row and row["value"] == "true")}


@app.post("/settings/demo-mode/{enabled}")
def set_demo_mode(enabled: str, user=Depends(auth_user)):
    if user["role"] != "Admin":
        raise HTTPException(status_code=403, detail="Admin only")
    with get_conn() as conn:
        conn.execute("INSERT OR REPLACE INTO settings(key,value) VALUES('demo_mode',?)", (enabled,))
    append_audit_event("setting.update", user["username"], "settings", "demo_mode", {"enabled": enabled})
    return {"ok": True}




@app.post("/demo/reset")
def demo_reset():
    if os.getenv("SCT_ENV", "dev").lower() == "prod":
        raise HTTPException(status_code=403, detail="/demo/reset disabled outside dev")
    with get_conn() as conn:
        conn.execute("DELETE FROM staging_records")
        conn.execute("DELETE FROM canonical_records")
        conn.execute("DELETE FROM inventory_movement")
        conn.execute("DELETE FROM exception_cases")
        conn.execute("DELETE FROM case_comments")
        conn.execute("DELETE FROM connector_runs")
        conn.execute("DELETE FROM dead_letter_queue")
        conn.execute("DELETE FROM batches")
        conn.execute("DELETE FROM audit_event")
    seed_demo_data()
    append_audit_event("demo.reset", "system", "settings", "demo_mode", {"enabled": "true"})
    return {"ok": True, "message": "Demo data reloaded"}

@app.post("/connectors/run/{connector_name}")
def run_connector(connector_name: str, detect_after: bool = Query(default=True), user=Depends(auth_user)):
    folder = Path(__file__).resolve().parents[1] / "sample_drop"
    folder.mkdir(exist_ok=True)
    connector = CSVDropFolderConnector(folder) if connector_name == "csv" else ERPExportConnector(folder)
    result = run_with_retry(connector)
    append_audit_event("connector.run", user["username"], "connector", connector.name, {"processed": result.processed, "batch_id": result.batch_id})

    detect_out = {"created": 0}
    if detect_after:
        detect_out = detect_exceptions(user)

    return {
        "status": result.status,
        "processed": result.processed,
        "errors": result.errors,
        "batch_id": result.batch_id,
        "message": result.message,
        "detect": {"created": detect_out.get("created", 0)},
    }


@app.get("/connectors/runs")
def connector_runs(limit: int = Query(default=100, ge=1, le=500), user=Depends(auth_user)):
    with get_conn() as conn:
        rows = conn.execute("SELECT id, connector_name, status, retries, error, input_ref, output_summary, batch_id, started_at, ended_at FROM connector_runs ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
    return [dict(r) for r in rows]


@app.get("/kpis/home")
def home_kpis(user=Depends(auth_user)):
    with get_conn() as conn:
        open_cases = conn.execute("SELECT COUNT(*) as c FROM exception_cases WHERE status='open'").fetchone()["c"]
        stale = conn.execute("SELECT COUNT(*) as c FROM settings WHERE key LIKE 'freshness_%'").fetchone()["c"]
    return {"open_exceptions": open_cases, "fresh_sources": stale}


def _list_canonical_payloads(entity_type: str, limit: int = 100, status: str | None = None):
    with get_conn() as conn:
        rows = conn.execute("SELECT payload FROM canonical_records WHERE entity_type=? ORDER BY id DESC LIMIT ?", (entity_type, limit)).fetchall()
    payloads = [json.loads(row["payload"]) for row in rows]
    if status is not None:
        payloads = [p for p in payloads if str(p.get("status", "")).lower() == status.lower()]
    return payloads


def _latest_inventory_positions() -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute("SELECT payload FROM canonical_records WHERE entity_type='inventory_position' ORDER BY id DESC LIMIT 500").fetchall()
    latest: dict[tuple[str, str], dict] = {}
    for row in rows:
        payload = json.loads(row["payload"])
        key = (payload.get("sku", ""), payload.get("location", ""))
        if key not in latest:
            latest[key] = payload
    return list(latest.values())


def _standard_related_refs(sku: list[str] | None = None, po: list[str] | None = None, shipment: list[str] | None = None) -> dict[str, list[str]]:
    return {"sku": sku or [], "po": po or [], "shipment": shipment or []}


def _exception_source_and_refs(item: dict[str, Any]) -> tuple[str, dict[str, list[str]]]:
    linked = str(item.get("linked_entity_id", "unknown"))
    exc_type = str(item.get("type", ""))
    if "shipment" in exc_type or "delay" in exc_type:
        return "logistics", _standard_related_refs(shipment=[linked])
    if "po" in exc_type:
        return "purchase", _standard_related_refs(po=[linked])
    return "inventory", _standard_related_refs(sku=[linked])


def _validate_exception_transition(current: str, target: str) -> None:
    allowed = {
        "open": {"investigating"},
        "investigating": {"resolved"},
        "resolved": {"closed", "open"},
        "closed": {"open"},
    }
    if target not in allowed.get(current, set()):
        raise HTTPException(status_code=400, detail=f"Invalid exception transition: {current} -> {target}")


def _get_exception_detail_or_404(exception_id: int) -> dict[str, Any]:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM exception_cases WHERE id=?", (exception_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Exception not found")
        comments = conn.execute("SELECT id, author, comment, created_at FROM case_comments WHERE case_id=? ORDER BY id DESC", (exception_id,)).fetchall()
    return normalize_exception_detail(dict(row), [dict(c) for c in comments])


@app.post("/exceptions/detect")
def detect_exceptions(user=Depends(auth_user)):
    try:
        with get_conn() as conn:
            inv_rows = conn.execute("SELECT payload FROM canonical_records WHERE entity_type='inventory_position' ORDER BY id DESC LIMIT 200").fetchall()
            po_rows = conn.execute("SELECT payload FROM canonical_records WHERE entity_type='purchase_order' ORDER BY id DESC LIMIT 200").fetchall()
            ship_rows = conn.execute("SELECT payload FROM canonical_records WHERE entity_type='shipment' ORDER BY id DESC LIMIT 200").fetchall()

        records = {
            "inventory_position": [json.loads(r["payload"]) for r in inv_rows],
            "purchase_order": [json.loads(r["payload"]) for r in po_rows],
            "shipment": [json.loads(r["payload"]) for r in ship_rows],
        }
        findings = detect_demo_exceptions(records)

        created = 0
        normalized_items: list[dict[str, Any]] = []
        with get_conn() as conn:
            for item in findings:
                linked = str(item.get("linked_entity_id", "unknown"))
                existing = conn.execute(
                    "SELECT id FROM exception_cases WHERE type=? AND linked_entity_id=? AND status IN ('open','investigating') LIMIT 1",
                    (item.get("type", "unknown"), linked),
                ).fetchone()
                if existing:
                    existing_row = conn.execute("SELECT * FROM exception_cases WHERE id=?", (existing["id"],)).fetchone()
                    normalized_items.append(normalize_exception_row(dict(existing_row)))
                    continue

                source, refs = _exception_source_and_refs(item)
                now = datetime.now(timezone.utc).isoformat()
                case_id = conn.execute(
                    "INSERT INTO exception_cases(type,severity,status,assignee,source,related_refs,sla_due_at,reason,linked_entity_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                    (
                        item.get("type", "unknown"),
                        item.get("severity", "medium"),
                        "open",
                        "unassigned",
                        source,
                        json.dumps(refs),
                        compute_sla_due_at(item.get("type", "unknown")),
                        item.get("reason", ""),
                        linked,
                        now,
                        now,
                    ),
                ).lastrowid
                created += 1
                new_row = conn.execute("SELECT * FROM exception_cases WHERE id=?", (case_id,)).fetchone()
                normalized_items.append(normalize_exception_row(dict(new_row)))
                append_audit_event("case.create", user["username"], "exception_case", linked, {"type": item.get("type", "unknown")})

        response = detect_response(normalized_items)
        response["items"] = normalized_items
        response["created"] = created
        return response
    except Exception:
        return {"items": [], "message": "Detection failed gracefully", "created": 0}


@app.get("/exceptions")
def list_exceptions(status: str | None = Query(default="open"), user=Depends(auth_user)):
    with get_conn() as conn:
        if status:
            rows = conn.execute("SELECT * FROM exception_cases WHERE status=? ORDER BY id DESC", (status,)).fetchall()
        else:
            rows = conn.execute("SELECT * FROM exception_cases ORDER BY id DESC").fetchall()
    return [normalize_exception_row(dict(r)) for r in rows]


@app.get("/exceptions/{exception_id}")
def get_exception(exception_id: int, user=Depends(auth_user)):
    return _get_exception_detail_or_404(exception_id)


@app.post("/exceptions/{exception_id}/assign")
def assign_exception(exception_id: int, payload: ExceptionAssignRequest, user=Depends(auth_user)):
    now = datetime.now(timezone.utc).isoformat()
    with get_conn() as conn:
        updated = conn.execute("UPDATE exception_cases SET assignee=?, updated_at=? WHERE id=?", (payload.assignee, now, exception_id)).rowcount
    if updated == 0:
        raise HTTPException(status_code=404, detail="Exception not found")
    append_audit_event("case.assign", user["username"], "exception_case", str(exception_id), {"assignee": payload.assignee})
    return _get_exception_detail_or_404(exception_id)


@app.post("/exceptions/{exception_id}/status")
def update_exception_status(exception_id: int, payload: StatusUpdateRequest, user=Depends(auth_user)):
    next_status = payload.status.lower()
    now = datetime.now(timezone.utc).isoformat()
    with get_conn() as conn:
        row = conn.execute("SELECT status FROM exception_cases WHERE id=?", (exception_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Exception not found")
        current = str(row["status"] or "open").lower()
        _validate_exception_transition(current, next_status)
        conn.execute("UPDATE exception_cases SET status=?, updated_at=? WHERE id=?", (next_status, now, exception_id))
    append_audit_event("case.status", user["username"], "exception_case", str(exception_id), {"status": next_status})
    return _get_exception_detail_or_404(exception_id)


@app.post("/exceptions/{exception_id}/comment")
def add_exception_comment(exception_id: int, payload: CommentRequest, user=Depends(auth_user)):
    create_case_comment(exception_id, payload.comment, user["username"])
    append_audit_event("case.comment", user["username"], "exception_case", str(exception_id), {"comment": payload.comment})
    return _get_exception_detail_or_404(exception_id)


@app.post("/exceptions/{exception_id}/snooze")
def snooze_exception(exception_id: int, payload: SnoozeRequest, user=Depends(auth_user)):
    hours = max(1, min(payload.hours, 168))
    due = (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat()
    with get_conn() as conn:
        updated = conn.execute("UPDATE exception_cases SET sla_due_at=?, updated_at=? WHERE id=?", (due, datetime.now(timezone.utc).isoformat(), exception_id)).rowcount
    if updated == 0:
        raise HTTPException(status_code=404, detail="Exception not found")
    append_audit_event("case.snooze", user["username"], "exception_case", str(exception_id), {"hours": hours})
    return _get_exception_detail_or_404(exception_id)


@app.get("/inventory")
def list_inventory(limit: int = Query(default=100, ge=1, le=500), user=Depends(auth_user)):
    return {"items": _latest_inventory_positions()[:limit]}


@app.get("/inventory/{sku}/movements")
def inventory_movements(sku: str, limit: int = Query(default=100, ge=1, le=500), user=Depends(auth_user)):
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, sku, location, movement_type, delta, source_ref, created_at, created_by as actor, reason FROM inventory_movement WHERE sku=? ORDER BY id DESC LIMIT ?",
            (sku, limit),
        ).fetchall()
    return {"items": [dict(r) for r in rows]}


@app.get("/inventory/{sku}")
def inventory_detail(sku: str, user=Depends(auth_user)):
    positions = [row for row in _latest_inventory_positions() if row.get("sku") == sku]
    with get_conn() as conn:
        movement_rows = conn.execute(
            "SELECT id, sku, location, delta, reason, movement_type, source_ref, created_at, created_by FROM inventory_movement WHERE sku=? ORDER BY id DESC LIMIT 50",
            (sku,),
        ).fetchall()
    return {"sku": sku, "positions": positions, "movements": [dict(r) for r in movement_rows]}


@app.post("/inventory/adjust")
def inventory_adjust(payload: InventoryAdjustRequest, user=Depends(auth_user)):
    if payload.delta == 0:
        raise HTTPException(status_code=400, detail="delta must not be zero")
    now = datetime.now(timezone.utc).isoformat()
    with get_conn() as conn:
        row = conn.execute(
            "SELECT id, payload FROM canonical_records WHERE entity_type='inventory_position' AND json_extract(payload, '$.sku')=? AND json_extract(payload, '$.location')=? ORDER BY id DESC LIMIT 1",
            (payload.sku, payload.location),
        ).fetchone()
        current = json.loads(row["payload"]) if row else {"sku": payload.sku, "location": payload.location, "on_hand": 0, "available": 0, "updated_at": now}
        current["on_hand"] = int(current.get("on_hand", 0)) + payload.delta
        current["available"] = int(current.get("available", 0)) + payload.delta
        current["updated_at"] = now

        conn.execute(
            "INSERT INTO canonical_records(entity_type, entity_id, payload, source_of_record, lineage_batch_id, updated_at) VALUES(?,?,?,?,?,?)",
            ("inventory_position", f"{payload.sku}:{payload.location}", json.dumps(current), "manual_adjustment", 0, now),
        )
        movement_id = conn.execute(
            "INSERT INTO inventory_movement(sku, location, delta, reason, movement_type, source_ref, created_at, created_by) VALUES(?,?,?,?,?,?,?,?)",
            (payload.sku, payload.location, payload.delta, payload.reason, payload.movement_type, payload.source_ref, now, user["username"]),
        ).lastrowid
        movement_row = conn.execute(
            "SELECT id, sku, location, delta, reason, movement_type, source_ref, created_at, created_by FROM inventory_movement WHERE id=?",
            (movement_id,),
        ).fetchone()

        if current["available"] < 0:
            conn.execute(
                "INSERT INTO exception_cases(type,severity,status,assignee,source,related_refs,sla_due_at,reason,linked_entity_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                (
                    "inventory_shortage",
                    "critical",
                    "open",
                    "unassigned",
                    "inventory",
                    json.dumps(_standard_related_refs(sku=[payload.sku])),
                    compute_sla_due_at(item.get("type", "unknown")),
                    "Inventory available quantity is negative",
                    payload.sku,
                    now,
                    now,
                ),
            )

    changed = {"inventory": [current], "shipments": [], "exceptions": []}
    if current["available"] < 0:
        with get_conn() as conn:
            created = conn.execute("SELECT * FROM exception_cases ORDER BY id DESC LIMIT 1").fetchone()
        if created:
            changed["exceptions"].append(normalize_exception_row(dict(created)))
    return {"ok": True, "position": current, "movement": dict(movement_row), "changed": changed}


@app.get("/purchase/orders")
def list_purchase_orders(status: str | None = Query(default=None), limit: int = Query(default=100, ge=1, le=500), user=Depends(auth_user)):
    items = _list_canonical_payloads("purchase_order", limit=limit, status=status)
    return {
        "items": [
            {
                "po_number": item.get("po_number"),
                "supplier": item.get("supplier"),
                "status": item.get("status"),
                "requested_date": item.get("requested_date"),
                "lines": len(item.get("lines")) if isinstance(item.get("lines"), list) else int(item.get("lines") or 0),
            }
            for item in items
        ]
    }


@app.get("/purchase/orders/{po_number}")
def purchase_order_detail(po_number: str, user=Depends(auth_user)):
    with get_conn() as conn:
        row = conn.execute("SELECT payload FROM canonical_records WHERE entity_type='purchase_order' AND json_extract(payload, '$.po_number')=? ORDER BY id DESC LIMIT 1", (po_number,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    order = json.loads(row["payload"])
    with get_conn() as conn:
        shipments = conn.execute(
            "SELECT payload FROM canonical_records WHERE entity_type='shipment' AND json_extract(payload, '$.po_number')=? ORDER BY id DESC LIMIT 20",
            (po_number,),
        ).fetchall()
    order["shipments"] = [json.loads(s["payload"]) for s in shipments]
    return order


@app.post("/purchase/orders/{po_number}/status")
def update_purchase_order_status(po_number: str, payload: StatusUpdateRequest, user=Depends(auth_user)):
    allowed = {"open": {"approved"}, "approved": {"sent"}, "sent": {"received"}, "received": set()}
    with get_conn() as conn:
        row = conn.execute("SELECT payload FROM canonical_records WHERE entity_type='purchase_order' AND json_extract(payload, '$.po_number')=? ORDER BY id DESC LIMIT 1", (po_number,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Purchase order not found")
        order = json.loads(row["payload"])
        current = str(order.get("status", "")).lower()
        target = payload.status.lower()
        if target not in allowed.get(current, set()):
            raise HTTPException(status_code=400, detail=f"Invalid status transition: {current} -> {target}")
        order["status"] = target
        now = datetime.now(timezone.utc).isoformat()
        conn.execute("INSERT INTO canonical_records(entity_type, entity_id, payload, source_of_record, lineage_batch_id, updated_at) VALUES(?,?,?,?,?,?)", ("purchase_order", po_number, json.dumps(order), "manual_status_update", 0, now))
    return {"ok": True, "po_number": po_number, "status": target}


@app.post("/purchase/orders/{po_number}/receive")
def receive_purchase_order(po_number: str, payload: ReceivePORequest | None = None, user=Depends(auth_user)):
    now = datetime.now(timezone.utc).isoformat()
    with get_conn() as conn:
        po_row = conn.execute("SELECT payload FROM canonical_records WHERE entity_type='purchase_order' AND json_extract(payload, '$.po_number')=? ORDER BY id DESC LIMIT 1", (po_number,)).fetchone()
        if not po_row:
            raise HTTPException(status_code=404, detail="Purchase order not found")
        po = json.loads(po_row["payload"])
        current_status = str(po.get("status", "")).lower()
        if current_status not in {"approved", "sent"}:
            raise HTTPException(status_code=400, detail="PO must be approved or sent before receive")
        po["status"] = "received"
        conn.execute("INSERT INTO canonical_records(entity_type, entity_id, payload, source_of_record, lineage_batch_id, updated_at) VALUES(?,?,?,?,?,?)", ("purchase_order", po_number, json.dumps(po), "receive_po", 0, now))

        inventory_updates: list[dict[str, Any]] = []
        created_exceptions: list[dict[str, Any]] = []
        requested_qty = {line.sku: line.qty for line in (payload.lines or [])} if payload and payload.lines else {}

        for line in po.get("lines", []):
            sku = line.get("sku")
            expected_qty = int(line.get("qty", 0) or 0)
            qty = int(requested_qty.get(sku, expected_qty))
            if not sku or qty == 0:
                continue
            location = "WH-JHB"
            inv_row = conn.execute(
                "SELECT payload FROM canonical_records WHERE entity_type='inventory_position' AND json_extract(payload, '$.sku')=? AND json_extract(payload, '$.location')=? ORDER BY id DESC LIMIT 1",
                (sku, location),
            ).fetchone()
            inv = json.loads(inv_row["payload"]) if inv_row else {"sku": sku, "location": location, "on_hand": 0, "available": 0, "updated_at": now}
            inv["on_hand"] = int(inv.get("on_hand", 0)) + qty
            inv["available"] = int(inv.get("available", 0)) + qty
            inv["updated_at"] = now
            conn.execute("INSERT INTO canonical_records(entity_type, entity_id, payload, source_of_record, lineage_batch_id, updated_at) VALUES(?,?,?,?,?,?)", ("inventory_position", f"{sku}:{location}", json.dumps(inv), "receive_po", 0, now))
            conn.execute(
                "INSERT INTO inventory_movement(sku, location, delta, reason, movement_type, source_ref, created_at, created_by) VALUES(?,?,?,?,?,?,?,?)",
                (sku, location, qty, f"PO {po_number} received", "receive_po", po_number, now, user["username"]),
            )
            inventory_updates.append(inv)

            if qty != expected_qty:
                exc_id = conn.execute(
                    "INSERT INTO exception_cases(type,severity,status,assignee,source,related_refs,sla_due_at,reason,linked_entity_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                    (
                        "po_mismatch",
                        "high",
                        "open",
                        "unassigned",
                        "purchase",
                        json.dumps(_standard_related_refs(sku=[sku], po=[po_number])),
                        compute_sla_due_at("po_mismatch"),
                        f"Received qty {qty} differs from expected {expected_qty} for {sku}",
                        po_number,
                        now,
                        now,
                    ),
                ).lastrowid
                created_row = conn.execute("SELECT * FROM exception_cases WHERE id=?", (exc_id,)).fetchone()
                created_exceptions.append(normalize_exception_row(dict(created_row)))
        shipment_rows = conn.execute(
            "SELECT payload FROM canonical_records WHERE entity_type='shipment' AND json_extract(payload, '$.po_number')=? ORDER BY id DESC LIMIT 20",
            (po_number,),
        ).fetchall()
        updated_shipments: list[dict[str, Any]] = []
        for row in shipment_rows:
            shipment = json.loads(row["payload"])
            shipment["status"] = "delivered"
            events = shipment.get("events") or []
            events.append({"status": "delivered", "at": now})
            shipment["events"] = events
            conn.execute("INSERT INTO canonical_records(entity_type, entity_id, payload, source_of_record, lineage_batch_id, updated_at) VALUES(?,?,?,?,?,?)", ("shipment", shipment.get("shipment_id", "unknown"), json.dumps(shipment), "receive_po", 0, now))
            updated_shipments.append(shipment)

    append_audit_event("po.receive", user["username"], "purchase_order", po_number, {"inventory_updates": len(inventory_updates), "shipments_updated": len(updated_shipments)})
    return {"message": f"PO {po_number} received", "changed": {"inventory": inventory_updates, "shipments": updated_shipments, "exceptions": created_exceptions}}


@app.get("/logistics/shipments")
def list_shipments(status: str | None = Query(default=None), po_number: str | None = Query(default=None), limit: int = Query(default=100, ge=1, le=500), user=Depends(auth_user)):
    items = _list_canonical_payloads("shipment", limit=limit, status=status)
    if po_number:
        items = [item for item in items if item.get("po_number") == po_number]
    return {"items": items}


@app.get("/logistics/shipments/{shipment_id}")
def shipment_detail(shipment_id: str, user=Depends(auth_user)):
    with get_conn() as conn:
        row = conn.execute("SELECT payload FROM canonical_records WHERE entity_type='shipment' AND json_extract(payload, '$.shipment_id')=? ORDER BY id DESC LIMIT 1", (shipment_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Shipment not found")
    shipment = json.loads(row["payload"])
    shipment.setdefault("events", [{"status": shipment.get("status", "unknown"), "at": shipment.get("eta")}])
    return shipment


@app.post("/logistics/shipments/{shipment_id}/status")
def update_shipment_status(shipment_id: str, payload: StatusUpdateRequest, user=Depends(auth_user)):
    with get_conn() as conn:
        row = conn.execute("SELECT payload FROM canonical_records WHERE entity_type='shipment' AND json_extract(payload, '$.shipment_id')=? ORDER BY id DESC LIMIT 1", (shipment_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Shipment not found")
        shipment = json.loads(row["payload"])
        shipment["status"] = payload.status.lower()
        events = shipment.get("events") or []
        events.append({"status": shipment["status"], "at": datetime.now(timezone.utc).isoformat()})
        shipment["events"] = events
        now = datetime.now(timezone.utc).isoformat()
        conn.execute("INSERT INTO canonical_records(entity_type, entity_id, payload, source_of_record, lineage_batch_id, updated_at) VALUES(?,?,?,?,?,?)", ("shipment", shipment_id, json.dumps(shipment), "manual_status_update", 0, now))
    return {"ok": True, "shipment_id": shipment_id, "status": shipment["status"]}


@app.post("/logistics/shipments/{shipment_id}/deliver")
def deliver_shipment(shipment_id: str, user=Depends(auth_user)):
    now = datetime.now(timezone.utc).isoformat()
    created_exceptions: list[dict[str, Any]] = []
    with get_conn() as conn:
        row = conn.execute("SELECT payload FROM canonical_records WHERE entity_type='shipment' AND json_extract(payload, '$.shipment_id')=? ORDER BY id DESC LIMIT 1", (shipment_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Shipment not found")
        shipment = json.loads(row["payload"])
        shipment["status"] = "delivered"
        events = shipment.get("events") or []
        events.append({"status": "delivered", "at": now})
        shipment["events"] = events
        conn.execute("INSERT INTO canonical_records(entity_type, entity_id, payload, source_of_record, lineage_batch_id, updated_at) VALUES(?,?,?,?,?,?)", ("shipment", shipment_id, json.dumps(shipment), "manual_deliver", 0, now))

        eta = shipment.get("eta")
        if eta and isinstance(eta, str) and eta < now:
            exc_id = conn.execute(
                "INSERT INTO exception_cases(type,severity,status,assignee,source,related_refs,sla_due_at,reason,linked_entity_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                (
                    "late_shipment",
                    "high",
                    "open",
                    "unassigned",
                    "logistics",
                    json.dumps(_standard_related_refs(shipment=[shipment_id], po=[shipment.get('po_number')] if shipment.get('po_number') else [])),
                    compute_sla_due_at("late_shipment"),
                    "Shipment delivered after expected date",
                    shipment_id,
                    now,
                    now,
                ),
            ).lastrowid
            created_row = conn.execute("SELECT * FROM exception_cases WHERE id=?", (exc_id,)).fetchone()
            created_exceptions.append(normalize_exception_row(dict(created_row)))

    append_audit_event("shipment.deliver", user["username"], "shipment", shipment_id, {"exceptions_created": len(created_exceptions)})
    return {"message": f"Shipment {shipment_id} delivered", "changed": {"inventory": [], "shipments": [shipment], "exceptions": created_exceptions}}


@app.post("/cases/{case_id}/comment")
def add_comment(case_id: int, payload: CommentRequest, user=Depends(auth_user)):
    create_case_comment(case_id, payload.comment, user["username"])
    return {"ok": True}


@app.get("/audit/events")
def audit_events(limit: int = Query(default=100, ge=1, le=500), user=Depends(auth_user)):
    with get_conn() as conn:
        rows = conn.execute("SELECT id, event_type, actor, entity_type, entity_id, payload, prev_hash, event_hash, created_at FROM audit_event ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
    return [dict(r) for r in rows]


@app.get("/audit/verify")
def audit_verify(user=Depends(auth_user)):
    return {"valid": verify_chain()}
