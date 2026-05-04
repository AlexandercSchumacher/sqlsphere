"""
Local-mode database access.

When LOCAL_MODE is enabled, the backend talks directly to a local Postgres
instance (started via docker-compose) instead of going through Supabase.
This module owns:

  - the SQLAlchemy engine and session factory
  - the LOCAL_MODE / DEMO_USER_ID constants used across the backend
  - small helpers for the CRUD endpoints that replace the
    Supabase-managed tables (connections, query_history, user_settings,
    chat_sessions, chat_messages)

Cloud-mode code paths in main.py and feature_scheduling.py keep using
their own Supabase client and are gated behind `if LOCAL_MODE:` checks.
"""

from __future__ import annotations

import os
import uuid
from contextlib import contextmanager
from typing import Iterator, Optional

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

# ---------------------------------------------------------------------------
# Feature flags
# ---------------------------------------------------------------------------

LOCAL_MODE: bool = os.getenv("LOCAL_MODE", "false").lower() in ("1", "true", "yes")

# Single hardcoded user that "owns" everything in LOCAL_MODE. Matches the
# auth.users seed in docker/postgres-init/02-sqlsphere-schema.sql.
DEMO_USER_ID: uuid.UUID = uuid.UUID("00000000-0000-0000-0000-000000000001")
DEMO_USER_EMAIL: str = "demo@sqlsphere.local"

# ---------------------------------------------------------------------------
# Engine / session
# ---------------------------------------------------------------------------

_DEFAULT_DATABASE_URL = "postgresql+psycopg2://postgres:demo@localhost:5432/sqlsphere"
DATABASE_URL: str = os.getenv("DATABASE_URL", _DEFAULT_DATABASE_URL)

# Normalise the dialect prefix so users can pass either `postgresql://` or
# `postgresql+psycopg2://` in DATABASE_URL.
if DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+psycopg2://", 1)

_engine: Optional[Engine] = None
_SessionLocal: Optional[sessionmaker[Session]] = None


def get_engine() -> Engine:
    """Lazy-construct the SQLAlchemy engine the first time it is needed."""
    global _engine, _SessionLocal
    if _engine is None:
        _engine = create_engine(
            DATABASE_URL,
            pool_pre_ping=True,
            pool_size=5,
            max_overflow=10,
            future=True,
        )
        _SessionLocal = sessionmaker(bind=_engine, autoflush=False, autocommit=False, future=True)
    return _engine


def get_session() -> Session:
    """Return a new SQLAlchemy session. Caller is responsible for close()."""
    if _SessionLocal is None:
        get_engine()
    assert _SessionLocal is not None
    return _SessionLocal()


@contextmanager
def session_scope() -> Iterator[Session]:
    """Context manager that commits on success and rolls back on exception."""
    s = get_session()
    try:
        yield s
        s.commit()
    except Exception:
        s.rollback()
        raise
    finally:
        s.close()


def healthcheck() -> bool:
    """Return True if the database is reachable. Used by /health endpoint."""
    try:
        with get_engine().connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Encrypt / decrypt helpers
# ---------------------------------------------------------------------------
#
# The schema ships SQL functions encrypt_credential(text) -> bytea and
# decrypt_credential(bytea) -> text. These wrappers make them trivially
# callable from Python.

def encrypt_credential(plaintext: Optional[str]) -> Optional[bytes]:
    """Encrypt a credential via the in-database encrypt_credential function."""
    if plaintext is None or plaintext == "":
        return None
    with get_engine().connect() as conn:
        row = conn.execute(
            text("SELECT encrypt_credential(:p) AS v"),
            {"p": plaintext},
        ).first()
        return bytes(row.v) if row and row.v is not None else None


def decrypt_credential(ciphertext: Optional[bytes]) -> Optional[str]:
    """Decrypt a credential via the in-database decrypt_credential function."""
    if ciphertext is None:
        return None
    with get_engine().connect() as conn:
        row = conn.execute(
            text("SELECT decrypt_credential(:c) AS v"),
            {"c": ciphertext},
        ).first()
        return row.v if row else None
