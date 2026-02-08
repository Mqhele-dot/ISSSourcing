import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from .db import init_db, get_conn
from .security import create_session, require_role
from .seed import seed_demo_data
from .services.audit import append_audit_event, verify_chain
from .services.jobs import run_with_retry, start_scheduler
from .connectors.csv_dropfolder import CSVDropFolderConnector
from .connectors.erp_export import ERPExportConnector
from .rules.exceptions import detect_late_confirmation, detect_shipment_delay, detect_stockout_risk
from .health import deep_health
from .services.cases import create_case_comment
from .services.exceptions import detect_demo_exceptions, detect_response

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
    return _list_canonical_payloads("inventory_position", limit=limit)


@app.get("/purchase/orders")
def list_purchase_orders(status: str | None = Query(default=None), limit: int = Query(default=100, ge=1, le=500), user=Depends(auth_user)):
    return _list_canonical_payloads("purchase_order", limit=limit, status=status)


@app.get("/logistics/shipments")
def list_shipments(status: str | None = Query(default=None), limit: int = Query(default=100, ge=1, le=500), user=Depends(auth_user)):
    return _list_canonical_payloads("shipment", limit=limit, status=status)


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
