from fastapi.testclient import TestClient

from app import db
from app.main import app
from app.seed import seed_demo_data


def _client(tmp_path, monkeypatch):
    monkeypatch.setattr(db, 'DB_PATH', tmp_path / 'transitions.db')
    db.init_db()
    seed_demo_data()
    return TestClient(app)


def _headers(client: TestClient):
    token = client.post('/auth/login', json={'username': 'planner', 'password': 'demo'}).json()['token']
    return {'Authorization': f'Bearer {token}'}


def test_invalid_exception_transition_rejected(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)
    headers = _headers(client)
    client.post('/exceptions/detect', headers=headers)
    exc_id = client.get('/exceptions?status=open', headers=headers).json()[0]['id']
    resp = client.post(f'/exceptions/{exc_id}/status', json={'status': 'closed'}, headers=headers)
    assert resp.status_code == 400


def test_related_refs_are_standardized_lists(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)
    headers = _headers(client)
    body = client.post('/exceptions/detect', headers=headers).json()
    if body['items']:
        refs = body['items'][0]['related_refs']
        assert set(refs.keys()) == {'sku', 'po', 'shipment'}
        assert isinstance(refs['sku'], list)
