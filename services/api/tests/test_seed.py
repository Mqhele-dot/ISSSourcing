from app import db
from app.seed import seed_demo_data


def test_seed_canonical_records_only_when_empty(tmp_path, monkeypatch):
    monkeypatch.setattr(db, 'DB_PATH', tmp_path / 'seed.db')
    db.init_db()

    seed_demo_data()
    with db.get_conn() as conn:
        first_count = conn.execute('SELECT COUNT(*) AS c FROM canonical_records').fetchone()['c']
        assert first_count > 0

    seed_demo_data()
    with db.get_conn() as conn:
        second_count = conn.execute('SELECT COUNT(*) AS c FROM canonical_records').fetchone()['c']

    assert second_count == first_count
