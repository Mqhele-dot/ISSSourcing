from fastapi.testclient import TestClient

from app import db
from app.main import app


def _auth_headers(client: TestClient) -> dict[str, str]:
    login = client.post('/auth/login', json={'username': 'planner', 'password': 'demo'})
    token = login.json()['token']
    return {'Authorization': f'Bearer {token}'}


def _client_with_seed(tmp_path, monkeypatch) -> TestClient:
    monkeypatch.setattr(db, 'DB_PATH', tmp_path / 'inventory.db')
    db.init_db()
    from app.seed import seed_demo_data

    seed_demo_data()
    return TestClient(app)


def test_inventory_detail_returns_positions_and_movements(tmp_path, monkeypatch):
    client = _client_with_seed(tmp_path, monkeypatch)
    headers = _auth_headers(client)

    adjust = client.post('/inventory/adjust', json={'sku': 'SKU-1', 'location': 'WH-JHB', 'delta': 2, 'reason': 'test'}, headers=headers)
    assert adjust.status_code == 200

    response = client.get('/inventory/SKU-1', headers=headers)
    assert response.status_code == 200
    body = response.json()

    assert body['sku'] == 'SKU-1'
    assert len(body['positions']) >= 1
    assert len(body['movements']) >= 1


def test_inventory_adjust_creates_movement_and_updates_position(tmp_path, monkeypatch):
    client = _client_with_seed(tmp_path, monkeypatch)
    headers = _auth_headers(client)

    response = client.post('/inventory/adjust', json={'sku': 'SKU-1', 'location': 'WH-JHB', 'delta': 3, 'reason': 'Cycle count'}, headers=headers)
    assert response.status_code == 200
    body = response.json()

    assert body['ok'] is True
    assert body['movement']['delta'] == 3
    assert body['position']['sku'] == 'SKU-1'
    assert body['position']['location'] == 'WH-JHB'


def test_inventory_adjust_rejects_zero_delta_400(tmp_path, monkeypatch):
    client = _client_with_seed(tmp_path, monkeypatch)
    headers = _auth_headers(client)

    response = client.post('/inventory/adjust', json={'sku': 'SKU-1', 'location': 'WH-JHB', 'delta': 0, 'reason': 'bad'}, headers=headers)
    assert response.status_code == 400
