from contextlib import contextmanager

from app import db
from app.health import deep_health


def test_health_deep_ok(tmp_path, monkeypatch):
    monkeypatch.setattr(db, 'DB_PATH', tmp_path / 'ok.db')
    db.init_db()

    assert deep_health(db.get_conn) == {'status': 'ok', 'db': 'ok'}


def test_health_deep_degraded():
    @contextmanager
    def broken_conn():
        raise RuntimeError('db unavailable')
        yield

    assert deep_health(broken_conn) == {'status': 'degraded', 'db': 'error'}
