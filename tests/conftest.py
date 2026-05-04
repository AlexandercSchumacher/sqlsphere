from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient

from main import app


@pytest.fixture(scope="session")
def api_client() -> TestClient:
    with TestClient(app) as client:
        yield client


@pytest.fixture(scope="session")
def auth_headers() -> dict[str, str]:
    token = os.getenv("FASTAPI_AUTH_TOKEN", "").strip()
    if not token:
        return {}
    return {"Authorization": f"Bearer {token}"}
