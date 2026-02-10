from fastapi.testclient import TestClient

from app import db
from app.main import app
from app.seed import seed_demo_data


def _auth_headers(client: TestClient) -> dict[str, str]:
    login = client.post('/auth/login', json={'username': 'planner', 'password': 'demo'})
    token = login.json()['token']
    return {'Authorization': f'Bearer {token}'}


def _client_with_seed(tmp_path, monkeypatch) -> TestClient:
    monkeypatch.setattr(db, 'DB_PATH', tmp_path / 'logistics.db')
    db.init_db()
    seed_demo_data()
    return TestClient(app)


def test_shipments_list_filters_by_status(tmp_path, monkeypatch):
    client = _client_with_seed(tmp_path, monkeypatch)
    headers = _auth_headers(client)

    response = client.get('/logistics/shipments?status=in_transit', headers=headers)
    assert response.status_code == 200
    items = response.json()['items']
    assert len(items) >= 1
    assert all(item['status'] == 'in_transit' for item in items)


def test_shipment_status_update_success(tmp_path, monkeypatch):
    client = _client_with_seed(tmp_path, monkeypatch)
    headers = _auth_headers(client)

    response = client.post('/logistics/shipments/SHIP-2001/status', json={'status': 'delivered'}, headers=headers)
    assert response.status_code == 200
    body = response.json()
    assert body['ok'] is True
    assert body['status'] == 'delivered'

def test_shipment_deliver_returns_change_summary(tmp_path, monkeypatch):
    client = _client_with_seed(tmp_path, monkeypatch)
    headers = _auth_headers(client)
    response = client.post('/logistics/shipments/SHIP-2001/deliver', headers=headers)
    assert response.status_code == 200
    body = response.json()
    assert 'changed' in body
    assert 'shipments' in body['changed']
