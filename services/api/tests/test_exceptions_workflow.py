from datetime import datetime, timezone

from fastapi.testclient import TestClient

from app import db
from app.main import app
from app.seed import seed_demo_data


def _client_with_seed(tmp_path, monkeypatch) -> TestClient:
    monkeypatch.setattr(db, 'DB_PATH', tmp_path / 'exceptions_workflow.db')
    db.init_db()
    seed_demo_data()
    return TestClient(app)


def _headers(client: TestClient) -> dict[str, str]:
    login = client.post('/auth/login', json={'username': 'planner', 'password': 'demo'})
    return {'Authorization': f"Bearer {login.json()['token']}"}


def test_exceptions_detect_with_no_issues_returns_empty_message(tmp_path, monkeypatch):
    client = _client_with_seed(tmp_path, monkeypatch)
    headers = _headers(client)

    with db.get_conn() as conn:
        conn.execute("DELETE FROM canonical_records WHERE entity_type='shipment'")
        conn.execute(
            "INSERT INTO canonical_records(entity_type,entity_id,payload,source_of_record,lineage_batch_id,updated_at) VALUES(?,?,?,?,?,?)",
            ('shipment', 'SHIP-OK', '{"shipment_id":"SHIP-OK","status":"in_transit","eta_drift_hours":1}', 'test', 0, datetime.now(timezone.utc).isoformat()),
        )

    response = client.post('/exceptions/detect', headers=headers)
    assert response.status_code == 200
    assert response.json()['items'] == []


def test_exceptions_detect_seeded_issue_creates_exception(tmp_path, monkeypatch):
    client = _client_with_seed(tmp_path, monkeypatch)
    headers = _headers(client)

    response = client.post('/exceptions/detect', headers=headers)
    assert response.status_code == 200
    assert response.json()['created'] >= 1


def test_exceptions_detect_idempotent_no_duplicates(tmp_path, monkeypatch):
    client = _client_with_seed(tmp_path, monkeypatch)
    headers = _headers(client)

    first = client.post('/exceptions/detect', headers=headers)
    second = client.post('/exceptions/detect', headers=headers)

    assert first.status_code == 200
    assert second.status_code == 200
    assert second.json()['created'] == 0


def test_exception_lifecycle_assign_status_comment(tmp_path, monkeypatch):
    client = _client_with_seed(tmp_path, monkeypatch)
    headers = _headers(client)

    client.post('/exceptions/detect', headers=headers)
    list_response = client.get('/exceptions?status=open', headers=headers)
    exception_id = list_response.json()[0]['id']

    assign_response = client.post(f'/exceptions/{exception_id}/assign', json={'assignee': 'ops'}, headers=headers)
    assert assign_response.status_code == 200

    status_response = client.post(f'/exceptions/{exception_id}/status', json={'status': 'investigating'}, headers=headers)
    assert status_response.status_code == 200

    comment_response = client.post(f'/exceptions/{exception_id}/comment', json={'comment': 'Investigating root cause'}, headers=headers)
    assert comment_response.status_code == 200

    detail_response = client.get(f'/exceptions/{exception_id}', headers=headers)
    assert detail_response.status_code == 200
    body = detail_response.json()
    assert body['assignee'] == 'ops'
    assert body['status'] == 'investigating'
    assert any('Investigating root cause' in c['comment'] for c in body['comments'])
