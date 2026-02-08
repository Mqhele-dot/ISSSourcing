import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .connectors.csv_dropfolder import CSVDropFolderConnector
from .connectors.erp_export import ERPExportConnector
from .db import get_conn, init_db
from .health import deep_health
from .rules.exceptions import detect_late_confirmation, detect_shipment_delay, detect_stockout_risk
from .security import create_session, require_role
from .seed import seed_demo_data
from .services.audit import append_audit_event, verify_chain
from .services.cases import create_case_comment
from .services.exceptions import detect_demo_exceptions, detect_response
from .services.jobs import run_with_retry, start_scheduler

app = FastAPI(title="SupplyChain Control Tower Local Backend")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_origin_regex=r"^https://.*\.app\.github\.dev$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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


class InventoryAdjustRequest(BaseModel):
    sku: str
    location: str
    delta: int
    reason: str


class StatusUpdateRequest(BaseModel):
    status: str


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


@app.post("/connectors/run/{connector_name}")
def run_connector(connector_name: str, user=Depends(auth_user)):
    folder = Path(__file__).resolve().parents[1] / "sample_drop"
    folder.mkdir(exist_ok=True)
    connector = CSVDropFolderConnector(folder) if connector_name == "csv" else ERPExportConnector(folder)
    result = run_with_retry(connector)
    append_audit_event("connector.run", user["username"], "connector", connector.name, {"processed": result.processed})
    return result


@app.get("/connectors/runs")
def connector_runs(limit: int = Query(default=100, ge=1, le=500), user=Depends(auth_user)):
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, connector_name, status, retries, error, started_at, ended_at FROM connector_runs ORDER BY id DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [dict(r) for r in rows]


@app.get("/kpis/home")
def home_kpis(user=Depends(auth_user)):
    with get_conn() as conn:
        open_cases = conn.execute("SELECT COUNT(*) as c FROM exception_cases WHERE status='open'").fetchone()["c"]
        stale = conn.execute("SELECT COUNT(*) as c FROM settings WHERE key LIKE 'freshness_%'").fetchone()["c"]
    return {"open_exceptions": open_cases, "fresh_sources": stale}


def _list_canonical_payloads(entity_type: str, limit: int = 100, status: str | None = None):
    query = "SELECT payload FROM canonical_records WHERE entity_type=? ORDER BY id DESC LIMIT ?"
    params: tuple = (entity_type, limit)
    with get_conn() as conn:
        rows = conn.execute(query, params).fetchall()
    payloads = [json.loads(row["payload"]) for row in rows]
    if status is not None:
        payloads = [p for p in payloads if str(p.get("status", "")).lower() == status.lower()]
    return payloads


def _latest_inventory_positions() -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT payload FROM canonical_records WHERE entity_type='inventory_position' ORDER BY id DESC LIMIT 500"
        ).fetchall()
    latest: dict[tuple[str, str], dict] = {}
    for row in rows:
        payload = json.loads(row["payload"])
        key = (payload.get("sku", ""), payload.get("location", ""))
        if key not in latest:
            latest[key] = payload
    return list(latest.values())


@app.post("/exceptions/detect")
def detect_exceptions(user=Depends(auth_user)):
    with get_conn() as conn:
        inv_rows = conn.execute("SELECT payload FROM canonical_records WHERE entity_type='inventory_position' ORDER BY id DESC LIMIT 200").fetchall()
        po_rows = conn.execute("SELECT payload FROM canonical_records WHERE entity_type='purchase_order' ORDER BY id DESC LIMIT 200").fetchall()
        ship_rows = conn.execute("SELECT payload FROM canonical_records WHERE entity_type='shipment' ORDER BY id DESC LIMIT 200").fetchall()

    records = {
        "inventory_position": [json.loads(r["payload"]) for r in inv_rows],
        "purchase_order": [json.loads(r["payload"]) for r in po_rows],
        "shipment": [json.loads(r["payload"]) for r in ship_rows],
    }
    items = detect_demo_exceptions(records)

    created = 0
    if items:
        with get_conn() as conn:
            for item in items:
                conn.execute(
                    "INSERT INTO exception_cases(type,severity,status,assignee,sla_due_at,reason,linked_entity_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
                    (
                        item["type"],
                        item["severity"],
                        "open",
                        "unassigned",
                        (datetime.now(timezone.utc) + timedelta(hours=24)).isoformat(),
                        item["reason"],
                        str(item["linked_entity_id"]),
                        datetime.now(timezone.utc).isoformat(),
                        datetime.now(timezone.utc).isoformat(),
                    ),
                )
                created += 1
                append_audit_event("case.create", user["username"], "exception_case", str(item["linked_entity_id"]), {"type": item["type"]})

    response = detect_response(items)
    response["created"] = created
    return response


@app.get("/exceptions")
def list_exceptions(status: str = "open", user=Depends(auth_user)):
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM exception_cases WHERE status=? ORDER BY id DESC", (status,)).fetchall()
    return [dict(r) for r in rows]


@app.get("/inventory")
def list_inventory(limit: int = Query(default=100, ge=1, le=500), user=Depends(auth_user)):
    items = _latest_inventory_positions()[:limit]
    return {"items": items}


@app.get("/inventory/{sku}")
def inventory_detail(sku: str, user=Depends(auth_user)):
    positions = [row for row in _latest_inventory_positions() if row.get("sku") == sku]
    with get_conn() as conn:
        movement_rows = conn.execute(
            "SELECT id, sku, location, delta, reason, created_at, created_by FROM inventory_movement WHERE sku=? ORDER BY id DESC LIMIT 50",
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
        if row:
            current = json.loads(row["payload"])
        else:
            current = {"sku": payload.sku, "location": payload.location, "on_hand": 0, "available": 0, "updated_at": now}

        current["on_hand"] = int(current.get("on_hand", 0)) + payload.delta
        current["available"] = int(current.get("available", 0)) + payload.delta
        current["updated_at"] = now

        conn.execute(
            "INSERT INTO canonical_records(entity_type, entity_id, payload, source_of_record, lineage_batch_id, updated_at) VALUES(?,?,?,?,?,?)",
            ("inventory_position", f"{payload.sku}:{payload.location}", json.dumps(current), "manual_adjustment", 0, now),
        )
        movement_id = conn.execute(
            "INSERT INTO inventory_movement(sku, location, delta, reason, created_at, created_by) VALUES(?,?,?,?,?,?)",
            (payload.sku, payload.location, payload.delta, payload.reason, now, user["username"]),
        ).lastrowid
        movement_row = conn.execute(
            "SELECT id, sku, location, delta, reason, created_at, created_by FROM inventory_movement WHERE id=?",
            (movement_id,),
        ).fetchone()

    return {"ok": True, "position": current, "movement": dict(movement_row)}


@app.get("/purchase/orders")
def list_purchase_orders(status: str | None = Query(default=None), limit: int = Query(default=100, ge=1, le=500), user=Depends(auth_user)):
    items = _list_canonical_payloads("purchase_order", limit=limit, status=status)
    summarized = []
    for item in items:
        lines = item.get("lines")
        line_count = len(lines) if isinstance(lines, list) else int(lines or 0)
        summarized.append(
            {
                "po_number": item.get("po_number"),
                "supplier": item.get("supplier"),
                "status": item.get("status"),
                "requested_date": item.get("requested_date"),
                "lines": line_count,
            }
        )
    return {"items": summarized}


@app.get("/purchase/orders/{po_number}")
def purchase_order_detail(po_number: str, user=Depends(auth_user)):
    with get_conn() as conn:
        row = conn.execute(
            "SELECT payload FROM canonical_records WHERE entity_type='purchase_order' AND json_extract(payload, '$.po_number')=? ORDER BY id DESC LIMIT 1",
            (po_number,),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    return json.loads(row["payload"])


@app.post("/purchase/orders/{po_number}/status")
def update_purchase_order_status(po_number: str, payload: StatusUpdateRequest, user=Depends(auth_user)):
    allowed = {"open": {"approved"}, "approved": {"sent"}, "sent": {"received"}, "received": set()}
    with get_conn() as conn:
        row = conn.execute(
            "SELECT payload FROM canonical_records WHERE entity_type='purchase_order' AND json_extract(payload, '$.po_number')=? ORDER BY id DESC LIMIT 1",
            (po_number,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Purchase order not found")
        order = json.loads(row["payload"])

        current = str(order.get("status", "")).lower()
        target = payload.status.lower()
        if target not in allowed.get(current, set()):
            raise HTTPException(status_code=400, detail=f"Invalid status transition: {current} -> {target}")

        order["status"] = target
        now = datetime.now(timezone.utc).isoformat()
        conn.execute(
            "INSERT INTO canonical_records(entity_type, entity_id, payload, source_of_record, lineage_batch_id, updated_at) VALUES(?,?,?,?,?,?)",
            ("purchase_order", po_number, json.dumps(order), "manual_status_update", 0, now),
        )
    return {"ok": True, "po_number": po_number, "status": target}


@app.get("/logistics/shipments")
def list_shipments(
    status: str | None = Query(default=None),
    po_number: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    user=Depends(auth_user),
):
    items = _list_canonical_payloads("shipment", limit=limit, status=status)
    if po_number:
        items = [item for item in items if item.get("po_number") == po_number]
    return {"items": items}


@app.get("/logistics/shipments/{shipment_id}")
def shipment_detail(shipment_id: str, user=Depends(auth_user)):
    with get_conn() as conn:
        row = conn.execute(
            "SELECT payload FROM canonical_records WHERE entity_type='shipment' AND json_extract(payload, '$.shipment_id')=? ORDER BY id DESC LIMIT 1",
            (shipment_id,),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Shipment not found")
    shipment = json.loads(row["payload"])
    shipment.setdefault("events", [{"status": shipment.get("status", "unknown"), "at": shipment.get("eta")}])
    return shipment


@app.post("/logistics/shipments/{shipment_id}/status")
def update_shipment_status(shipment_id: str, payload: StatusUpdateRequest, user=Depends(auth_user)):
    with get_conn() as conn:
        row = conn.execute(
            "SELECT payload FROM canonical_records WHERE entity_type='shipment' AND json_extract(payload, '$.shipment_id')=? ORDER BY id DESC LIMIT 1",
            (shipment_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Shipment not found")
        shipment = json.loads(row["payload"])
        shipment["status"] = payload.status.lower()
        events = shipment.get("events") or []
        events.append({"status": shipment["status"], "at": datetime.now(timezone.utc).isoformat()})
        shipment["events"] = events
        now = datetime.now(timezone.utc).isoformat()
        conn.execute(
            "INSERT INTO canonical_records(entity_type, entity_id, payload, source_of_record, lineage_batch_id, updated_at) VALUES(?,?,?,?,?,?)",
            ("shipment", shipment_id, json.dumps(shipment), "manual_status_update", 0, now),
        )
    return {"ok": True, "shipment_id": shipment_id, "status": shipment["status"]}


@app.post("/cases/{case_id}/comment")
def add_comment(case_id: int, payload: CommentRequest, user=Depends(auth_user)):
    create_case_comment(case_id, payload.comment, user["username"])
    return {"ok": True}


@app.get("/audit/events")
def audit_events(limit: int = Query(default=100, ge=1, le=500), user=Depends(auth_user)):
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, event_type, actor, entity_type, entity_id, payload, prev_hash, event_hash, created_at FROM audit_event ORDER BY id DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [dict(r) for r in rows]


@app.get("/audit/verify")
def audit_verify(user=Depends(auth_user)):
    return {"valid": verify_chain()}
