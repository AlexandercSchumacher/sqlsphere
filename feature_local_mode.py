"""
LOCAL_MODE-only HTTP endpoints.

These endpoints replace the direct Supabase access the frontend used to do
in cloud mode. The frontend talks to FastAPI for everything (no
@supabase/supabase-js client needed in the browser bundle in LOCAL_MODE).

Tables exposed here are the user-scoped tables from the original Supabase
schema, but the user_id is always the demo user (DEMO_USER_ID), so the
"WHERE user_id = X" predicate is a constant.

Mounted from main.py via register_local_mode_routes(app).
"""

from __future__ import annotations

import logging
import uuid
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, FastAPI, HTTPException, Path
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text

from db import (
    DEMO_USER_EMAIL,
    DEMO_USER_ID,
    LOCAL_MODE,
    decrypt_credential,
    encrypt_credential,
    get_engine,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class ConnectionIn(BaseModel):
    """Subset of connection fields the frontend can write."""
    model_config = ConfigDict(extra="ignore")

    name: str
    type: str  # postgres, mysql, sqlserver, ...
    connection_method: str = "standard"  # standard, ssh, local
    host: Optional[str] = None
    port: Optional[int] = None
    database: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    use_ssl: Optional[bool] = False
    ssh_host: Optional[str] = None
    ssh_port: Optional[int] = None
    ssh_username: Optional[str] = None
    ssh_password: Optional[str] = None
    ssh_key_file: Optional[str] = None
    socket_path: Optional[str] = None
    named_pipe: Optional[str] = None
    named_instance: Optional[str] = None
    default_schema: Optional[str] = None
    is_default: Optional[bool] = False
    auth_method: Optional[str] = "standard"
    ssl_mode: Optional[str] = None
    encrypt: Optional[bool] = None
    trust_server_certificate: Optional[bool] = None
    connection_string_value: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


class ConnectionOut(BaseModel):
    """Connection record as returned to the frontend (passwords stripped)."""
    model_config = ConfigDict(extra="ignore")

    id: str
    name: str
    type: str
    connection_method: str
    host: Optional[str]
    port: Optional[int]
    database: Optional[str]
    username: Optional[str]
    use_ssl: Optional[bool]
    is_default: Optional[bool]
    status: Optional[str]
    auth_method: Optional[str]
    metadata: Optional[Dict[str, Any]]
    created_at: Optional[str]
    updated_at: Optional[str]


class QueryHistoryIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    connection_id: Optional[str] = None
    sql_text: str
    status: str = "success"
    execution_time_ms: Optional[int] = None
    row_count: Optional[int] = None
    error_message: Optional[str] = None
    title: Optional[str] = None


class QueryHistoryPatch(BaseModel):
    model_config = ConfigDict(extra="ignore")
    is_favorite: Optional[bool] = None
    title: Optional[str] = None


class UserSettingsIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    dark_mode: Optional[bool] = None
    language: Optional[str] = None


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------

router = APIRouter(tags=["local-mode"])


def _row_to_connection(row: Any) -> Dict[str, Any]:
    """Map a SQLAlchemy row to the ConnectionOut shape (sans secrets)."""
    return {
        "id": str(row.id),
        "name": row.name,
        "type": row.type,
        "connection_method": row.connection_method,
        "host": row.host,
        "port": row.port,
        "database": row.database,
        "username": row.username,
        "use_ssl": row.use_ssl,
        "is_default": row.is_default,
        "status": row.status,
        "auth_method": row.auth_method,
        "metadata": row.metadata if hasattr(row, "metadata") else None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


# ---------------------------------------------------------------------------
# Auth / current user
# ---------------------------------------------------------------------------

@router.get("/api/auth/me")
def whoami() -> Dict[str, Any]:
    """In LOCAL_MODE, the user is always the seeded demo user."""
    return {
        "id": str(DEMO_USER_ID),
        "email": DEMO_USER_EMAIL,
        "name": "Demo User",
        "is_demo": True,
    }


# ---------------------------------------------------------------------------
# Connections
# ---------------------------------------------------------------------------

@router.get("/api/connections")
def list_connections() -> List[Dict[str, Any]]:
    with get_engine().connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT id, name, type, connection_method, host, port, database,
                       username, use_ssl, is_default, status, auth_method,
                       metadata, created_at, updated_at
                FROM connections
                WHERE user_id = :uid
                ORDER BY is_default DESC, name ASC
                """
            ),
            {"uid": str(DEMO_USER_ID)},
        ).all()
    return [_row_to_connection(r) for r in rows]


@router.get("/api/connections/{connection_id}")
def get_connection_route(connection_id: str = Path(...)) -> Dict[str, Any]:
    with get_engine().connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT id, name, type, connection_method, host, port, database,
                       username, use_ssl, is_default, status, auth_method,
                       metadata, created_at, updated_at
                FROM connections
                WHERE id = :id AND user_id = :uid
                """
            ),
            {"id": connection_id, "uid": str(DEMO_USER_ID)},
        ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Connection not found")
    return _row_to_connection(row)


@router.post("/api/connections", status_code=201)
def create_connection(payload: ConnectionIn) -> Dict[str, Any]:
    new_id = str(uuid.uuid4())
    # encrypt is `text` in the schema (it's an mssql Encrypt mode string,
    # not a boolean flag despite the name). Coerce booleans to the legacy
    # 'yes'/'no' representation, otherwise pass strings through.
    enc_value: Optional[str] = None
    if payload.encrypt is True:
        enc_value = "yes"
    elif payload.encrypt is False:
        enc_value = "no"
    elif isinstance(payload.encrypt, str):
        enc_value = payload.encrypt

    with get_engine().begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO connections (
                    id, user_id, name, type, connection_method,
                    host, port, database, username, password,
                    use_ssl, ssh_host, ssh_port, ssh_username, ssh_password, ssh_key_file,
                    socket_path, named_pipe, named_instance, default_schema,
                    is_default, auth_method, ssl_mode, encrypt,
                    trust_server_certificate, connection_string_value,
                    metadata, status, created_at, updated_at
                ) VALUES (
                    :id, :uid, :name, :type, :method,
                    :host, :port, :db, :user, encrypt_credential(:pw),
                    :ssl, :sshh, :sshp, :sshu, encrypt_credential(:sshpw), encrypt_credential(:sshk),
                    :sock, :pipe, :inst, :defsch,
                    :isdef, :authm, :sslmode, :enc,
                    :tsc, :csv,
                    COALESCE(:meta::jsonb, '{}'::jsonb), 'created', NOW(), NOW()
                )
                """
            ),
            {
                "id": new_id,
                "uid": str(DEMO_USER_ID),
                "name": payload.name,
                "type": payload.type,
                "method": payload.connection_method,
                "host": payload.host,
                "port": payload.port,
                "db": payload.database,
                "user": payload.username,
                "pw": payload.password,
                "ssl": payload.use_ssl,
                "sshh": payload.ssh_host,
                "sshp": payload.ssh_port,
                "sshu": payload.ssh_username,
                "sshpw": payload.ssh_password,
                "sshk": payload.ssh_key_file,
                "sock": payload.socket_path,
                "pipe": payload.named_pipe,
                "inst": payload.named_instance,
                "defsch": payload.default_schema,
                "isdef": payload.is_default,
                "authm": payload.auth_method,
                "sslmode": payload.ssl_mode,
                "enc": enc_value,
                "tsc": payload.trust_server_certificate,
                "csv": payload.connection_string_value,
                "meta": _json_or_none(payload.metadata),
            },
        )
    return get_connection_route(new_id)


@router.patch("/api/connections/{connection_id}")
def update_connection(connection_id: str, payload: ConnectionIn) -> Dict[str, Any]:
    # Only update fields that are explicitly set (not None defaults).
    fields = payload.model_dump(exclude_unset=True)
    if not fields:
        return get_connection_route(connection_id)

    # Map known sensitive fields to encrypt_credential() in SQL.
    # `connection_string_value` is plaintext text in this schema (it
    # holds raw connection-string templates, not credentials).
    sensitive = {"password", "ssh_password", "ssh_key_file"}
    set_clauses: List[str] = []
    params: Dict[str, Any] = {"id": connection_id, "uid": str(DEMO_USER_ID)}

    for key, value in fields.items():
        if key in sensitive:
            set_clauses.append(f"{key} = encrypt_credential(:{key})")
            params[key] = value
        elif key == "metadata":
            set_clauses.append("metadata = COALESCE(:metadata, '{}'::jsonb)")
            params["metadata"] = _json_or_none(value)
        else:
            set_clauses.append(f"{key} = :{key}")
            params[key] = value

    set_clauses.append("updated_at = NOW()")
    sql = f"UPDATE connections SET {', '.join(set_clauses)} WHERE id = :id AND user_id = :uid"
    with get_engine().begin() as conn:
        conn.execute(text(sql), params)
    return get_connection_route(connection_id)


@router.delete("/api/connections/{connection_id}", status_code=204)
def delete_connection(connection_id: str):
    with get_engine().begin() as conn:
        conn.execute(
            text("DELETE FROM connections WHERE id = :id AND user_id = :uid"),
            {"id": connection_id, "uid": str(DEMO_USER_ID)},
        )


def load_connection_as_params(connection_id: str):
    """Read a stored connection from Postgres, decrypt credentials, return
    as a `DatabaseConnection` ready to hand off to the connection_manager.

    Shared between the `/api/connections/{id}/connect` endpoint and the
    schema-browser endpoints (`/tables`, `/views`, `/columns/{table}`)
    in main.py, which in LOCAL_MODE accept just a `connectionId` instead
    of the full credential set.
    """
    from models import DatabaseConnection

    with get_engine().connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT type, connection_method, host, port, database,
                       username, password, use_ssl,
                       ssh_host, ssh_port, ssh_username, ssh_password, ssh_key_file,
                       socket_path, named_pipe, named_instance, default_schema,
                       auth_method, ssl_mode, ssl_ca, ssl_cert, ssl_key,
                       encrypt, trust_server_certificate, connection_string_value
                FROM connections
                WHERE id = :id AND user_id = :uid
                """
            ),
            {"id": connection_id, "uid": str(DEMO_USER_ID)},
        ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Connection not found")

    pwd = decrypt_credential(row.password)
    ssh_pwd = decrypt_credential(row.ssh_password) if row.ssh_password else None
    ssh_key_file = decrypt_credential(row.ssh_key_file) if row.ssh_key_file else None
    cstr = row.connection_string_value

    db_type = "postgresql" if row.type == "postgres" else row.type
    auth_method = row.auth_method or "sql_auth"
    if auth_method == "standard":
        auth_method = "sql_auth"

    return DatabaseConnection(
        type=db_type,
        connection_method=row.connection_method or "standard",
        host=row.host,
        port=row.port,
        database=row.database,
        username=row.username,
        password=pwd or "",
        use_ssl=bool(row.use_ssl),
        ssh_host=row.ssh_host,
        ssh_port=row.ssh_port,
        ssh_username=row.ssh_username,
        ssh_password=ssh_pwd,
        ssh_key_file=ssh_key_file,
        socket_path=row.socket_path,
        named_pipe=row.named_pipe,
        named_instance=row.named_instance,
        default_schema=row.default_schema,
        auth_method=auth_method,
        ssl_mode=row.ssl_mode,
        encrypt=row.encrypt,
        trust_server_certificate=row.trust_server_certificate,
        connection_string_value=cstr,
    )


@router.post("/api/connections/{connection_id}/connect")
def connect_to_stored_connection(connection_id: str) -> Dict[str, Any]:
    """Open a backend session for a stored connection.

    Replaces the cloud-mode flow where the frontend invoked the
    `database-proxy` edge function with `endpoint=/connect, connectionId=...`.
    """
    from connection_manager import create_session

    params = load_connection_as_params(connection_id)
    try:
        session_id = create_session(params)
    except Exception as exc:
        logger.exception("Failed to open session for connection %s", connection_id)
        raise HTTPException(status_code=400, detail=f"Connection failed: {exc}") from exc

    return {"session_id": session_id, "connection_id": connection_id}


# ---------------------------------------------------------------------------
# Query history
# ---------------------------------------------------------------------------

@router.get("/api/query-history")
def list_query_history(limit: int = 100) -> List[Dict[str, Any]]:
    with get_engine().connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT id, connection_id, sql_text, status, execution_time_ms,
                       row_count, error_message, is_favorite, title,
                       created_at, updated_at
                FROM query_history
                WHERE user_id = :uid
                ORDER BY created_at DESC
                LIMIT :lim
                """
            ),
            {"uid": str(DEMO_USER_ID), "lim": limit},
        ).all()
    return [
        {
            "id": str(r.id),
            "connection_id": str(r.connection_id) if r.connection_id else None,
            "sql_text": r.sql_text,
            "status": r.status,
            "execution_time_ms": r.execution_time_ms,
            "row_count": r.row_count,
            "error_message": r.error_message,
            "is_favorite": r.is_favorite,
            "title": r.title,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "updated_at": r.updated_at.isoformat() if r.updated_at else None,
        }
        for r in rows
    ]


@router.post("/api/query-history", status_code=201)
def create_query_history(payload: QueryHistoryIn) -> Dict[str, Any]:
    new_id = str(uuid.uuid4())
    with get_engine().begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO query_history (
                    id, user_id, connection_id, sql_text, status,
                    execution_time_ms, row_count, error_message, title,
                    is_favorite, created_at, updated_at
                ) VALUES (
                    :id, :uid, :cid, :sql, :status,
                    :et, :rc, :err, :title,
                    false, NOW(), NOW()
                )
                """
            ),
            {
                "id": new_id,
                "uid": str(DEMO_USER_ID),
                "cid": payload.connection_id,
                "sql": payload.sql_text,
                "status": payload.status,
                "et": payload.execution_time_ms,
                "rc": payload.row_count,
                "err": payload.error_message,
                "title": payload.title,
            },
        )
    return {"id": new_id}


@router.patch("/api/query-history/{entry_id}")
def update_query_history(entry_id: str, payload: QueryHistoryPatch) -> Dict[str, Any]:
    fields = payload.model_dump(exclude_unset=True)
    if not fields:
        return {"updated": 0}
    set_clauses = ", ".join(f"{k} = :{k}" for k in fields.keys())
    params = {**fields, "id": entry_id, "uid": str(DEMO_USER_ID)}
    with get_engine().begin() as conn:
        result = conn.execute(
            text(f"UPDATE query_history SET {set_clauses}, updated_at = NOW() WHERE id = :id AND user_id = :uid"),
            params,
        )
    return {"updated": result.rowcount}


@router.delete("/api/query-history/{entry_id}", status_code=204)
def delete_query_history(entry_id: str):
    with get_engine().begin() as conn:
        conn.execute(
            text("DELETE FROM query_history WHERE id = :id AND user_id = :uid"),
            {"id": entry_id, "uid": str(DEMO_USER_ID)},
        )


# ---------------------------------------------------------------------------
# User settings (theme, language)
# ---------------------------------------------------------------------------

@router.get("/api/user-settings")
def get_user_settings() -> Dict[str, Any]:
    with get_engine().connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT dark_mode, language
                FROM user_settings
                WHERE user_id = :uid
                """
            ),
            {"uid": str(DEMO_USER_ID)},
        ).first()
    if row is None:
        return {"dark_mode": True, "language": "en"}
    return {"dark_mode": row.dark_mode, "language": row.language}


@router.put("/api/user-settings")
def upsert_user_settings(payload: UserSettingsIn) -> Dict[str, Any]:
    with get_engine().begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO user_settings (user_id, dark_mode, language, created_at, updated_at)
                VALUES (:uid, :dm, :lang, NOW(), NOW())
                ON CONFLICT (user_id) DO UPDATE
                SET dark_mode = COALESCE(EXCLUDED.dark_mode, user_settings.dark_mode),
                    language  = COALESCE(EXCLUDED.language,  user_settings.language),
                    updated_at = NOW()
                """
            ),
            {
                "uid": str(DEMO_USER_ID),
                "dm": payload.dark_mode,
                "lang": payload.language,
            },
        )
    return get_user_settings()


# ---------------------------------------------------------------------------
# User usage / subscription stub (always "unlimited" in LOCAL_MODE)
# ---------------------------------------------------------------------------

@router.get("/api/user-usage")
def user_usage() -> Dict[str, Any]:
    return {
        "tier": "demo",
        "unlimited": True,
        "messages_today": 0,
        "imports_total": 0,
        "visualizations_total": 0,
    }


@router.get("/api/subscription")
def subscription_status() -> Dict[str, Any]:
    return {
        "tier": "demo",
        "active": True,
        "is_demo": True,
        "limits": None,
    }


# ---------------------------------------------------------------------------
# Chat sessions / messages
# ---------------------------------------------------------------------------

@router.get("/api/chat-sessions")
def list_chat_sessions() -> List[Dict[str, Any]]:
    with get_engine().connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT id, name, connection_id, database_type, is_active,
                       created_at, updated_at
                FROM chat_sessions
                WHERE user_id = :uid AND COALESCE(deleted_at, NULL) IS NULL
                ORDER BY updated_at DESC
                """
            ),
            {"uid": str(DEMO_USER_ID)},
        ).all()
    return [
        {
            "id": str(r.id),
            "name": r.name,
            "connection_id": str(r.connection_id) if r.connection_id else None,
            "database_type": r.database_type,
            "is_active": r.is_active,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "updated_at": r.updated_at.isoformat() if r.updated_at else None,
        }
        for r in rows
    ]


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@router.get("/api/health")
def health() -> Dict[str, Any]:
    from db import healthcheck
    return {
        "status": "ok" if healthcheck() else "degraded",
        "local_mode": LOCAL_MODE,
        "demo_user_id": str(DEMO_USER_ID),
    }


# ---------------------------------------------------------------------------
# Mounting helper
# ---------------------------------------------------------------------------

def register_local_mode_routes(app: FastAPI) -> None:
    """Mount the LOCAL_MODE-only routes onto the main FastAPI app.

    Called from main.py only when LOCAL_MODE is true. In cloud mode these
    routes are not registered (the original Supabase-backed paths via
    the database-proxy edge function take their place).
    """
    if not LOCAL_MODE:
        logger.info("LOCAL_MODE is off; not registering local-mode routes.")
        return
    app.include_router(router)
    logger.info("LOCAL_MODE routes mounted (%d routes).", len(router.routes))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _json_or_none(value: Optional[Dict[str, Any]]) -> Optional[str]:
    """Serialize dict to JSON for psycopg2 JSONB binding."""
    import json as _json
    if value is None:
        return None
    return _json.dumps(value)
