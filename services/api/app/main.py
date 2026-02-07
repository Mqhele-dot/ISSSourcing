from datetime import datetime, timedelta, timezone
from pathlib import Path
from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
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

app = FastAPI(title="SupplyChain Control Tower Local Backend")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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


@app.post("/exceptions/detect")
def detect_exceptions(user=Depends(auth_user)):
    hits = [
        detect_stockout_risk("SKU-1", 2.5),
        detect_late_confirmation("PO-9", False, 33),
        detect_shipment_delay("SHIP-2", 10),
    ]
    created = 0
    with get_conn() as conn:
        for hit in [h for h in hits if h]:
            conn.execute(
                "INSERT INTO exception_cases(type,severity,status,assignee,sla_due_at,reason,linked_entity_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
                (
                    hit.rule_type,
                    hit.severity,
                    "open",
                    "unassigned",
                    (datetime.now(timezone.utc) + timedelta(hours=24)).isoformat(),
                    hit.reason,
                    hit.linked_entity_id,
                    datetime.now(timezone.utc).isoformat(),
                    datetime.now(timezone.utc).isoformat(),
                ),
            )
            created += 1
            append_audit_event("case.create", user["username"], "exception_case", hit.linked_entity_id, {"type": hit.rule_type})
    return {"created": created}


@app.get("/exceptions")
def list_exceptions(status: str = "open", user=Depends(auth_user)):
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM exception_cases WHERE status=? ORDER BY id DESC", (status,)).fetchall()
    return [dict(r) for r in rows]


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
