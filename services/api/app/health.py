from collections.abc import Callable
from contextlib import AbstractContextManager
from typing import Any


def deep_health(get_conn_fn: Callable[[], AbstractContextManager[Any]]) -> dict[str, str]:
    try:
        with get_conn_fn() as conn:
            conn.execute('SELECT 1').fetchone()
    except Exception:
        return {'status': 'degraded', 'db': 'error'}
    return {'status': 'ok', 'db': 'ok'}
