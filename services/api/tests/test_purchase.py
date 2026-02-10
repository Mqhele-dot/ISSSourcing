from fastapi.testclient import TestClient

from app import db
from app.main import app
from app.seed import seed_demo_data


def _auth_headers(client: TestClient) -> dict[str, str]:
    login = client.post('/auth/login', json={'username': 'planner', 'password': 'demo'})
    token = login.json()['token']
    return {'Authorization': f'Bearer {token}'}


def _client_with_seed(tmp_path, monkeypatch) -> TestClient:
    monkeypatch.setattr(db, 'DB_PATH', tmp_path / 'purchase.db')
    db.init_db()
    seed_demo_data()
    return TestClient(app)


def test_purchase_order_detail_has_lines(tmp_path, monkeypatch):
    client = _client_with_seed(tmp_path, monkeypatch)
    headers = _auth_headers(client)

    response = client.get('/purchase/orders/PO-1001', headers=headers)
    assert response.status_code == 200
    body = response.json()

    assert body['po_number'] == 'PO-1001'
    assert isinstance(body['lines'], list)
    assert len(body['lines']) >= 1


def test_purchase_order_status_update_success(tmp_path, monkeypatch):
    client = _client_with_seed(tmp_path, monkeypatch)
    headers = _auth_headers(client)

    response = client.post('/purchase/orders/PO-1001/status', json={'status': 'approved'}, headers=headers)
    assert response.status_code == 200
    assert response.json()['status'] == 'approved'


def test_purchase_order_status_update_invalid_transition_400(tmp_path, monkeypatch):
    client = _client_with_seed(tmp_path, monkeypatch)
    headers = _auth_headers(client)

    response = client.post('/purchase/orders/PO-1001/status', json={'status': 'received'}, headers=headers)
    assert response.status_code == 400

def test_purchase_receive_requires_approved_or_sent(tmp_path, monkeypatch):
    client = _client_with_seed(tmp_path, monkeypatch)
    headers = _auth_headers(client)
    response = client.post('/purchase/orders/PO-1001/receive', json={'lines':[{'sku':'SKU-1','qty':1}]}, headers=headers)
    assert response.status_code == 400


def test_purchase_receive_success_after_status_update(tmp_path, monkeypatch):
    client = _client_with_seed(tmp_path, monkeypatch)
    headers = _auth_headers(client)
    client.post('/purchase/orders/PO-1001/status', json={'status':'approved'}, headers=headers)
    response = client.post('/purchase/orders/PO-1001/receive', json={'lines':[{'sku':'SKU-1','qty':2}]}, headers=headers)
    assert response.status_code == 200
    assert 'changed' in response.json()
