# main.py
from fastapi import FastAPI, Query, HTTPException, Body, Depends, Header, UploadFile, File, Form, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional, List, Dict, Any
from feature_visualization import (
    get_table_relationships,
    get_view_dependencies, 
    get_column_info,
    get_all_tables,
    get_all_views,
    get_all_procedures,
    get_all_triggers,
    get_all_sequences,
    get_all_materialized_views,
    generate_visualization_data,
    get_column_dependencies,
    get_procedure_table_dependencies
)
from models import (
    DatabaseConnection, QueryRequest, VisualizationPreviewRequest,
    ScheduleCreate, ScheduleUpdate, AlertCreate, AlertUpdate,
    DashboardWidgetGenerate, DashboardWidgetRefresh,
    ScheduleGenerateSQLRequest, SchedulePreviewRequest,
    AlertGenerateSQLRequest, AlertPreviewRequest,
)
from feature_scheduling import (
    start_scheduler, stop_scheduler,
    run_scheduled_query, check_data_alert,
    _add_schedule_job, _add_alert_job, remove_job,
    _compute_next_run, _get_supabase as get_service_supabase,
    _execute_query_on_connection,
    build_report_chart_preview,
    generate_report_summary_text,
)
from connection_manager import (
    create_session,
    get_connection,
    get_session_info,
    get_connection_params,
    store_query_result,
    get_query_results,
    refresh_session,
    connect_with_params,
)
from feature_chat_json_based import execute_query_json_based as execute_query
from local_agent_manager import agent_manager, AgentStatus
from db import (
    LOCAL_MODE,
    DEMO_USER_ID,
    DEMO_USER_EMAIL,
    get_engine,
    healthcheck as db_healthcheck,
    encrypt_credential,
    decrypt_credential,
)
from sqlalchemy import text as sa_text
from feature_import import (
    safe_extract_value,
    detect_file_type,
    parse_file,
    detect_delimiter,
    detect_encoding,
    detect_header_row,
    get_table_columns,
    create_simple_mapping,
    validate_data_types,
    validate_required_columns,
    import_data,
    create_table_from_columns,
    MAX_FILE_SIZE
)
import pyodbc
import os
import re
import json
from decimal import Decimal
from datetime import date, datetime
import time
import asyncio
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Database Visualization API", version="1.0.0")

# Mount static files directory
static_path = os.path.join(os.path.dirname(__file__), "static")
app.mount("/static", StaticFiles(directory=static_path), name="static")

# CORS middleware for frontend access.
#
# In LOCAL_MODE we deliberately accept a broad set of origins via regex
# because the demo frontend may be hit at sqlsphere.com (apex), at any
# *.pages.dev preview URL (Cloudflare's per-deployment domains), or at
# any localhost port (npm run dev). The backend has no real auth in
# LOCAL_MODE, so the CORS policy is about making the demo work, not
# about isolating tenants.
allowed_origins_env = os.getenv("ALLOWED_ORIGINS", "")
allowed_origins = [o.strip() for o in allowed_origins_env.split(",") if o.strip()]

cors_kwargs: Dict[str, Any] = {
    "allow_credentials": True,
    "allow_methods": ["*"],
    "allow_headers": ["*"],
}

# Use the env-configured list when present, otherwise fall back to "*".
if allowed_origins:
    cors_kwargs["allow_origins"] = allowed_origins
else:
    cors_kwargs["allow_origins"] = ["*"]

# In LOCAL_MODE additionally accept any *.pages.dev, sqlsphere.com,
# any subdomain of sqlsphere.com, and any localhost port via regex.
if LOCAL_MODE:
    cors_kwargs["allow_origin_regex"] = (
        r"^https?://("
        r"localhost(:\d+)?|"
        r"127\.0\.0\.1(:\d+)?|"
        r"([a-z0-9-]+\.)*pages\.dev|"
        r"([a-z0-9-]+\.)*sqlsphere\.com"
        r")$"
    )

app.add_middleware(CORSMiddleware, **cors_kwargs)


# Private Network Access (PNA): Chrome and Edge are gradually rolling
# out a policy that blocks public-origin pages from calling private
# IPs (including localhost) unless the target server explicitly opts
# in. Echo the header on every response in LOCAL_MODE so the demo
# does not silently break the moment a browser flips PNA enforcement
# on.
if LOCAL_MODE:
    @app.middleware("http")
    async def _allow_private_network(request: Request, call_next):
        response = await call_next(request)
        response.headers["Access-Control-Allow-Private-Network"] = "true"
        return response

# Authentication
FASTAPI_AUTH_TOKEN = os.getenv("FASTAPI_AUTH_TOKEN", "")

def verify_token(authorization: Optional[str] = Header(None)):
    """Verify API token from Authorization header."""
    if LOCAL_MODE:
        # LOCAL_MODE: single-user demo, no auth required.
        return True

    if not FASTAPI_AUTH_TOKEN:
        # If no token is set, skip authentication (for development)
        return True

    if not authorization:
        raise HTTPException(status_code=401, detail="Missing Authorization header")

    # Support both "Bearer <token>" and just "<token>" formats
    token = authorization.replace("Bearer ", "").strip()

    if token != FASTAPI_AUTH_TOKEN:
        raise HTTPException(status_code=403, detail="Invalid authentication token")

    return True


def _disable_in_local_mode():
    """Dependency: raise 503 when running in LOCAL_MODE.

    Used on cloud-only endpoints (schedules, alerts, dashboard widgets,
    notifications) that depend on Supabase + Stripe + Resend and are out
    of scope for the self-hosted demo. The frontend hides the matching
    UI in LOCAL_MODE, so this is purely a safety net.
    """
    if LOCAL_MODE:
        raise HTTPException(
            status_code=503,
            detail="This feature is not available in LOCAL_MODE. Run the cloud version of SQLSphere to use schedules, alerts, dashboards, and notifications.",
        )
    return True

def _quote_identifier(identifier: str, engine: str) -> str:
    """Safely quote SQL identifiers for different engines."""
    if identifier is None or identifier == "":
        raise HTTPException(status_code=400, detail="Identifier cannot be empty")

    if engine == "sqlserver":
        escaped = identifier.replace("]", "]]")
        return f"[{escaped}]"
    if engine == "postgresql":
        escaped = identifier.replace('"', '""')
        return f'"{escaped}"'
    # default mysql/mariadb/postgresql (compat)
    escaped = identifier.replace("`", "``")
    return f"`{escaped}`"

def _build_table_reference(engine: str, database: str, schema: str | None, table: str) -> str:
    """Build fully qualified table reference for SQL queries."""
    table_id = _quote_identifier(table, engine)

    if engine == "mysql":
        # MySQL treats database as schema; prefer provided schema else database/catalog
        schema_part = schema or database
        if schema_part:
            return f"{_quote_identifier(schema_part, engine)}.{table_id}"
        return table_id

    if schema:
        return f"{_quote_identifier(schema, engine)}.{table_id}"

    return table_id

def _normalize_value(value):
    """Normalize DB values for JSON serialization."""
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return value

def _normalize_db_type(raw_type: str) -> str:
    """Normalize DB type labels from storage into model-compatible values."""
    normalized = str(raw_type or "postgresql").strip().lower().replace(" ", "")
    if normalized in {"postgres", "postgresql"}:
        return "postgresql"
    if normalized in {"mssql", "sqlserver"}:
        return "sqlserver"
    if normalized in {"mysql", "mariadb"}:
        return "mysql"
    if normalized in {"oracle"}:
        return "oracle"
    return normalized

def _build_db_connection_model(connection_row: Dict[str, Any]) -> DatabaseConnection:
    """Build a DatabaseConnection model from a stored `connections` row."""
    params: Dict[str, Any] = {
        "type": _normalize_db_type(connection_row.get("type", "postgresql")),
        "connection_method": connection_row.get("connection_method", "standard"),
        "host": connection_row.get("host"),
        "port": connection_row.get("port"),
        "database": connection_row.get("database") or "",
        "username": connection_row.get("username") or "",
        "password": connection_row.get("password") or "",
        "use_ssl": connection_row.get("use_ssl", False),
        "ssh_host": connection_row.get("ssh_host"),
        "ssh_port": connection_row.get("ssh_port"),
        "ssh_username": connection_row.get("ssh_username"),
        "ssh_password": connection_row.get("ssh_password"),
        "ssh_key_file": connection_row.get("ssh_key_file"),
        "default_schema": connection_row.get("default_schema"),
        "connection_code": connection_row.get("connection_code"),
        "auth_method": connection_row.get("auth_method"),
        "ssl_mode": connection_row.get("ssl_mode"),
        "ssl_ca": connection_row.get("ssl_ca"),
        "ssl_ca_path": connection_row.get("ssl_ca_path"),
        "ssl_cert": connection_row.get("ssl_cert"),
        "ssl_cert_path": connection_row.get("ssl_cert_path"),
        "ssl_key": connection_row.get("ssl_key"),
        "ssl_key_path": connection_row.get("ssl_key_path"),
        "socket_path": connection_row.get("socket_path"),
        "named_pipe": connection_row.get("named_pipe"),
        "named_instance": connection_row.get("named_instance"),
        "azure_tenant_id": connection_row.get("azure_tenant_id"),
        "azure_client_id": connection_row.get("azure_client_id"),
        "azure_client_secret": connection_row.get("azure_client_secret"),
        "aws_region": connection_row.get("aws_region"),
        "aws_access_key_id": connection_row.get("aws_access_key_id"),
        "aws_secret_access_key": connection_row.get("aws_secret_access_key"),
        "aws_use_instance_profile": connection_row.get("aws_use_instance_profile", False),
        "encrypt": connection_row.get("encrypt"),
        "trust_server_certificate": connection_row.get("trust_server_certificate", False),
        "connection_string_value": connection_row.get("connection_string_value"),
    }
    clean_params = {k: v for k, v in params.items() if v is not None}
    return DatabaseConnection(**clean_params)

def _qualify_object_name(schema: Optional[str], name: Optional[str]) -> Optional[str]:
    schema_value = str(schema or "").strip()
    name_value = str(name or "").strip()
    if not name_value:
        return None
    return f"{schema_value}.{name_value}" if schema_value else name_value

def _build_widget_schema_context(
    prompt: str,
    tables: List[Dict[str, Any]],
    views: List[Dict[str, Any]],
    columns: List[Dict[str, Any]],
    max_chars: int = 24000,
) -> Dict[str, Any]:
    """Build compact schema context text and allowed-object sets for validation."""
    table_to_columns: Dict[str, List[str]] = {}
    all_objects: set[str] = set()
    all_columns: set[str] = set()

    for obj in tables + views:
        full_name = _qualify_object_name(obj.get("schema"), obj.get("name"))
        if full_name:
            all_objects.add(full_name)

    for col in columns:
        full_name = _qualify_object_name(col.get("schema"), col.get("table"))
        col_name = str(col.get("column") or "").strip()
        if not full_name:
            continue
        all_objects.add(full_name)
        if col_name:
            all_columns.add(col_name.lower())
            bucket = table_to_columns.setdefault(full_name, [])
            if col_name not in bucket:
                bucket.append(col_name)

    prompt_tokens = {
        tok.lower()
        for tok in re.findall(r"[A-Za-z0-9_]+", prompt or "")
        if len(tok) >= 3
    }

    def _score(object_name: str) -> int:
        lowered = object_name.lower()
        return sum(1 for tok in prompt_tokens if tok in lowered)

    ordered_objects = sorted(all_objects, key=lambda obj: (-_score(obj), obj.lower()))

    lines = [
        "Schema context from the connected database (use only these tables/views/columns):",
    ]
    current_chars = len(lines[0])
    included = 0

    for obj in ordered_objects:
        cols = table_to_columns.get(obj, [])
        preview_cols = cols[:40]
        col_text = ", ".join(preview_cols) if preview_cols else "(column metadata unavailable)"
        if len(cols) > 40:
            col_text += ", ..."
        line = f"- {obj}: {col_text}"
        if current_chars + len(line) + 1 > max_chars:
            break
        lines.append(line)
        current_chars += len(line) + 1
        included += 1

    omitted = len(ordered_objects) - included
    if omitted > 0:
        lines.append(f"... {omitted} additional tables/views omitted from prompt due context limit.")

    allowed_full = {obj.lower() for obj in ordered_objects}
    allowed_short = {obj.split(".")[-1].lower() for obj in ordered_objects}

    return {
        "context_text": "\n".join(lines),
        "allowed_full": allowed_full,
        "allowed_short": allowed_short,
        "allowed_columns": all_columns,
    }

def _validate_read_only_sql(sql_text: str, feature_label: str) -> Optional[str]:
    """Ensure SQL is single-statement, read-only SQL."""
    sql = (sql_text or "").strip()
    if not sql:
        return f"SQL is empty for {feature_label}."

    # Allow one trailing semicolon but reject multiple statements.
    while sql.endswith(";"):
        sql = sql[:-1].rstrip()
    if ";" in sql:
        return "Multiple SQL statements are not allowed."

    if not re.match(r"(?is)^(select|with)\b", sql):
        return f"Only SELECT/CTE SQL is allowed for {feature_label}."

    forbidden = re.compile(
        r"(?is)\b(insert|update|delete|drop|alter|create|truncate|merge|grant|revoke|execute|exec|call)\b"
    )
    if forbidden.search(sql):
        return f"Only read-only SQL is allowed for {feature_label}."

    # SQL Server's SELECT INTO creates a physical table.
    if re.search(r"(?is)\bselect\b[\s\S]*\binto\b", sql):
        return f"SELECT INTO is not allowed for {feature_label}."

    return None


def _validate_widget_sql_safety(sql_text: str) -> Optional[str]:
    return _validate_read_only_sql(sql_text, "dashboard widgets")


def _validate_schedule_sql_safety(sql_text: str) -> Optional[str]:
    return _validate_read_only_sql(sql_text, "scheduled reports")


def _validate_alert_sql_safety(sql_text: str) -> Optional[str]:
    return _validate_read_only_sql(sql_text, "data alerts")

def _extract_table_refs_from_sql(sql_text: str) -> List[str]:
    """Extract table/view references from FROM/JOIN clauses for quick validation."""
    refs: List[str] = []
    pattern = re.compile(r"(?is)\b(?:from|join)\s+([^\s,()]+)")

    for match in pattern.finditer(sql_text or ""):
        token = match.group(1).strip().rstrip(",")
        if not token or token.startswith("("):
            continue
        parts = []
        for part in token.split("."):
            p = part.strip()
            if p.startswith("[") and p.endswith("]"):
                p = p[1:-1]
            if p.startswith("`") and p.endswith("`"):
                p = p[1:-1]
            if p.startswith('"') and p.endswith('"'):
                p = p[1:-1]
            if p:
                parts.append(p.lower())
        if not parts:
            continue
        ref = ".".join(parts[-2:]) if len(parts) >= 2 else parts[0]
        if ref and ref not in refs:
            refs.append(ref)

    return refs

def _build_validation_sql(sql_text: str, engine: str) -> Optional[str]:
    """
    Build a lightweight validation query around the generated SQL.
    Returns None if wrapping is intentionally skipped.
    """
    sql = (sql_text or "").strip()
    while sql.endswith(";"):
        sql = sql[:-1].rstrip()

    if engine == "sqlserver":
        # CTEs are not valid inside a subquery wrapper in SQL Server.
        if re.match(r"(?is)^with\b", sql):
            return None
        return f"SELECT TOP 1 * FROM ({sql}) AS __widget_validation"

    if engine == "oracle":
        return f"SELECT * FROM ({sql}) __widget_validation WHERE ROWNUM <= 1"

    # postgresql / mysql
    return f"SELECT * FROM ({sql}) AS __widget_validation LIMIT 1"


def _get_connection_row_with_secret(sb, connection_id: str) -> Dict[str, Any]:
    conn_row = sb.table("connections").select("*").eq("id", connection_id).single().execute()
    if not conn_row.data:
        raise HTTPException(status_code=404, detail="Connection not found")

    row = conn_row.data
    password = row.get("password", "")
    if password:
        try:
            dec = sb.rpc("decrypt_credential", {"encrypted": password}).execute()
            if dec.data:
                row["password"] = dec.data
        except Exception:
            pass
    return row


def _resolve_schedule_sql(query_mode: str, sql_text: Optional[str], generated_sql: Optional[str]) -> str:
    mode = (query_mode or "manual").strip().lower()
    manual_sql = (sql_text or "").strip()
    llm_sql = (generated_sql or "").strip()
    final_sql = manual_sql or llm_sql

    if mode not in {"manual", "nl"}:
        raise HTTPException(status_code=400, detail="queryMode must be 'manual' or 'nl'")
    if not final_sql:
        raise HTTPException(status_code=400, detail="A SQL query is required")

    safety_error = _validate_schedule_sql_safety(final_sql)
    if safety_error:
        raise HTTPException(status_code=400, detail=safety_error)
    return final_sql


def _resolve_alert_sql(query_mode: str, sql_text: Optional[str], generated_sql: Optional[str]) -> str:
    mode = (query_mode or "manual").strip().lower()
    manual_sql = (sql_text or "").strip()
    llm_sql = (generated_sql or "").strip()
    final_sql = manual_sql or llm_sql

    if mode not in {"manual", "nl"}:
        raise HTTPException(status_code=400, detail="queryMode must be 'manual' or 'nl'")
    if not final_sql:
        raise HTTPException(status_code=400, detail="A SQL query is required")

    safety_error = _validate_alert_sql_safety(final_sql)
    if safety_error:
        raise HTTPException(status_code=400, detail=safety_error)
    return final_sql

def _connect_from_params(connection: DatabaseConnection):
    """Helper function to create database connection from parameters."""
    
    # For local agent connections, we don't create a direct DB connection
    # The connection is handled by the local agent via WebSocket
    if connection.connection_method == "local":
        # Just verify that the agent exists and is connected
        if not connection.connection_code:
            raise HTTPException(status_code=400, detail="Connection code is required for local agent connections")
        agent = agent_manager.get_agent(connection.connection_code)
        if not agent:
            raise HTTPException(status_code=404, detail="Agent not found. Please ensure the agent is running and connected.")
        if agent.status != AgentStatus.CONNECTED:
            raise HTTPException(status_code=400, detail=f"Agent is not connected (status: {agent.status.value})")
        # Return a dummy connection object - actual queries will go through the agent
        return None
    
    try:
        conn, engine = connect_with_params(connection)
        return conn, engine
    except Exception as e:
        logger.error(f"[Connection] Database connection failed: {type(e).__name__}: {str(e)}")
        logger.error(f"[Connection] Error details: {repr(e)}")
        import traceback
        logger.error(f"[Connection] Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=400, detail=f"Database connection failed: {str(e)}")

def get_db_connection(database="mysql"):
    """Get database connection based on type (LEGACY - for backwards compatibility)."""
    if database == "sqlserver":
        return pyodbc.connect(
            "DRIVER={ODBC Driver 17 for SQL Server};"
            "SERVER=10.131.17.126,1433;"
            "DATABASE=AdventureWorks2022;"
            "UID=appuser;"
            "PWD=MySecurePass123!;"
        ), "sqlserver"
    else:  # mysql
        return pyodbc.connect(
            "DRIVER=/opt/homebrew/opt/mariadb-connector-odbc/lib/mariadb/libmaodbc.dylib;"
            "SERVER=127.0.0.1;"
            "PORT=3306;"
            "DATABASE=employees;"
            "USER=newuser;"
            "PASSWORD=Abcdefg123&;"
            "OPTION=3;"
        ), "mysql"

@app.get("/")
def root():
    return {
        "message": "Database Visualization API",
        "version": "2.0.0",
        "description": "Send connection parameters in POST body for all endpoints",
        "endpoints": {
            "/connect": "POST - Test connection and create session (required for chat)",
            "/chat": "POST - Send query to AI chat (requires session_id)",
            "/visualization/data": "POST - Get visualization JSON (send connection params in body)",
            "/tables": "POST - List all tables (send connection params in body)",
            "/views": "POST - List all views (send connection params in body)",
            "/columns/{table_name}": "POST - Get columns (send connection params in body)",
            "/session/{session_id}": "GET - Get session info",
        },
        "example_body": {
            "type": "mysql",
            "host": "127.0.0.1",
            "port": 3306,
            "database": "employees",
            "username": "your_user",
            "password": "your_password"
        }
    }

@app.post("/connect")
async def test_connection_and_create_session(connection: DatabaseConnection = Body(...), _: bool = Depends(verify_token)):
    """
    Test database connection and create a session.
    Returns session_id to use in subsequent requests.
    """
    try:
        # For local agent connections, verify agent is connected instead of testing DB connection
        if connection.connection_method == "local":
            if not connection.connection_code:
                raise HTTPException(status_code=400, detail="Connection code is required for local agent connections")

            # Wait up to 15 seconds for the agent to (re)connect
            # Agent reconnects every 5s, so 15s allows 2-3 reconnect cycles
            max_wait_for_agent = 15
            wait_start = time.time()
            agent = None

            while time.time() - wait_start < max_wait_for_agent:
                agent = agent_manager.get_agent(connection.connection_code)
                if agent and agent.status == AgentStatus.CONNECTED:
                    break
                await asyncio.sleep(0.5)

            if not agent:
                raise HTTPException(status_code=404,
                    detail="Agent not found. Please ensure the local agent is running with your saved connection code.")
            if agent.status != AgentStatus.CONNECTED:
                raise HTTPException(status_code=400,
                    detail="Agent is not connected. Please ensure the local agent is running.")
            
            # Test connection by submitting a simple query job
            job = agent_manager.create_job(connection.connection_code, "SELECT 1 as test")
            sent = await agent_manager.send_job_to_agent(connection.connection_code, job)
            if not sent:
                raise HTTPException(status_code=400, detail="Failed to send test query to agent")
            
            # Wait for result (with timeout)
            # For local agents, we give more time as the query needs to be executed locally
            max_wait = 10  # 10 seconds timeout for test query (SELECT 1 should be fast)
            start_time = time.time()
            last_status = None
            while time.time() - start_time < max_wait:
                result = agent_manager.get_job(job.job_id)
                if result:
                    last_status = result.status
                    if result.status == "completed":
                        if result.error:
                            raise HTTPException(status_code=400, detail=f"Agent test query failed: {result.error}")
                        break
                    elif result.status == "failed":
                        raise HTTPException(status_code=400, detail=f"Agent test query failed: {result.error}")
                # Check more frequently
                await asyncio.sleep(0.3)
            else:
                # Timeout - check if agent is still connected
                result = agent_manager.get_job(job.job_id)
                if agent.status == AgentStatus.CONNECTED:
                    # Agent is connected, job might still be processing
                    # For a simple SELECT 1, if it takes >10s, something is wrong
                    # But we'll allow it if agent is clearly connected
                    if result and result.status in ["pending", "executing"]:
                        logger.warning(f"Test query still running after {max_wait}s, but agent is connected - considering connection successful")
                        # Continue to create session - connection is valid
                    else:
                        raise HTTPException(status_code=408, detail=f"Timeout waiting for agent response (last status: {last_status})")
                else:
                    raise HTTPException(status_code=400, detail=f"Agent disconnected during test (status: {agent.status.value})")
            
            # Connection successful - create session
            session_id = create_session(connection)
            
            return {
                "success": True,
                "message": "Connection successful (via local agent)",
                "session_id": session_id,
                "database_type": connection.type or agent.db_type,
                "database_name": connection.database or agent.db_name
            }
        
        # For standard/SSH connections, test direct DB connection
        test_conn, engine = _connect_from_params(connection)
        cursor = test_conn.cursor()
        test_sql = "SELECT 1 FROM DUAL" if engine == "oracle" else "SELECT 1"
        cursor.execute(test_sql)
        cursor.fetchone()
        test_conn.close()
        
        # Connection successful - create session
        session_id = create_session(connection)
        
        return {
            "success": True,
            "message": "Connection successful",
            "session_id": session_id,
            "database_type": connection.type,
            "database_name": connection.database
        }
        
    except HTTPException:
        raise
    except pyodbc.Error as e:
        raise HTTPException(status_code=400, detail=f"Database connection failed: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error: {str(e)}")

@app.get("/session/{session_id}")
def get_session(session_id: str):
    """Get session information."""
    info = get_session_info(session_id)
    if not info:
        raise HTTPException(status_code=404, detail="Session not found or expired")
    return info

@app.post("/session/{session_id}/refresh")
def refresh_session_endpoint(session_id: str, _: bool = Depends(verify_token)):
    """Refresh (extend) a session's expiry time."""
    if refresh_session(session_id):
        info = get_session_info(session_id)
        return {"success": True, "expires_at": info['expires_at'] if info else None}
    raise HTTPException(status_code=404, detail="Session not found or expired")

@app.post("/chat")
def chat_query(request: QueryRequest = Body(...), fastapi_request: Request = None, _: bool = Depends(verify_token)):
    """
    Process AI chat query.
    
    Request body:
    {
        "session_id": "abc-123-...",
        "query": "gebe mir die Mitarbeiterin mit dem höchsten Gehalt",
        "conversation_history": [...]  // optional
        "active_model": "claude" | "chatgpt"  // optional, overrides ACTIVE_MODEL env var
    }
    
    Returns:
    {
        "success": true,
        "sql": "SELECT ...",
        "results": [{...}],
        "columns": ["first_name", "last_name", "salary"],
        "execution_time_ms": 12.34,
        "row_count": 1,
        "explanation": "Die Mitarbeiterin mit dem höchsten Gehalt ist Weijing Chenoweth mit 152.710 €."
    }
    """
    try:
        # Note: is_disconnected can be unreliable, so we only check it at the endpoint level
        # and let the actual cancellation happen through the AbortController in the frontend
        result = execute_query(
            session_id=request.session_id,
            user_query=request.query,
            conversation_history=request.conversation_history or [],
            language=request.language or "en",
            active_model=request.active_model,  # Pass model selection
            current_editor_code=getattr(request, 'current_editor_code', None),
            code_context_metadata=getattr(request, 'code_context_metadata', None),
            fastapi_request=fastapi_request  # Pass request for potential future cancellation checks
        )
        
        return result
    
    except HTTPException:
        raise
    except RuntimeError as e:
        # Handle request cancellation
        if "cancelled" in str(e).lower():
            raise HTTPException(status_code=499, detail="Request cancelled by client")
        raise HTTPException(status_code=500, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/visualization/preview")
def get_visualization_preview(request: VisualizationPreviewRequest = Body(...)):
    """
    Generate lightweight preview data for charts.

    Returns aggregated chart data and sample rows for the selected table/column.
    """
    conn = None
    try:
        # For local agent connections, visualization preview is not yet supported
        if request.connection.connection_method == "local":
            raise HTTPException(status_code=400, detail="Visualization preview is not yet supported for local agent connections")
        
        conn, engine = _connect_from_params(request.connection)
        cursor = conn.cursor()

        schema = request.schema_name or request.connection.default_schema
        table_ref = _build_table_reference(engine, request.connection.database, schema, request.table_name)
        x_identifier = _quote_identifier(request.x_column, engine)
        y_identifier = _quote_identifier(request.y_column, engine) if request.y_column else None
        limit = request.limit
        aggregation = request.aggregation.lower()

        if aggregation == "count" and not request.y_column:
            if engine == "sqlserver":
                agg_sql = (
                    f"SELECT TOP {limit} {x_identifier} AS label, COUNT(*) AS value "
                    f"FROM {table_ref} GROUP BY {x_identifier} ORDER BY value DESC"
                )
            else:
                agg_sql = (
                    f"SELECT {x_identifier} AS label, COUNT(*) AS value "
                    f"FROM {table_ref} GROUP BY {x_identifier} ORDER BY value DESC LIMIT {limit}"
                )
        elif aggregation in {"sum", "avg"} and y_identifier:
            func = aggregation.upper()
            if engine == "sqlserver":
                agg_sql = (
                    f"SELECT TOP {limit} {x_identifier} AS label, {func}({y_identifier}) AS value "
                    f"FROM {table_ref} GROUP BY {x_identifier} ORDER BY value DESC"
                )
            else:
                agg_sql = (
                    f"SELECT {x_identifier} AS label, {func}({y_identifier}) AS value "
                    f"FROM {table_ref} GROUP BY {x_identifier} ORDER BY value DESC LIMIT {limit}"
                )
        else:
            # No aggregation requested or missing y-column for sum/avg: return sample values
            if engine == "sqlserver":
                agg_sql = f"SELECT TOP {limit} {x_identifier} AS label FROM {table_ref}"
            else:
                agg_sql = f"SELECT {x_identifier} AS label FROM {table_ref} LIMIT {limit}"

        cursor.execute(agg_sql)
        chart_rows = cursor.fetchall()

        chart_data = []
        for row in chart_rows:
            label = safe_extract_value(row[0]) if row and len(row) > 0 else None
            value = safe_extract_value(row[1]) if row and len(row) > 1 else None
            chart_data.append({
                "label": "NULL" if label is None else str(label),
                "value": _normalize_value(value) if value is not None else (1 if aggregation == "none" else 0)
            })

        # Fetch sample rows for preview table
        sample_limit = min(limit, 20)
        if engine == "sqlserver":
            sample_sql = f"SELECT TOP {sample_limit} * FROM {table_ref}"
        else:
            sample_sql = f"SELECT * FROM {table_ref} LIMIT {sample_limit}"

        cursor.execute(sample_sql)
        sample_rows = cursor.fetchall()
        sample_columns = [desc[0] for desc in cursor.description] if cursor.description else []
        sample_data = [
            {sample_columns[idx]: _normalize_value(row[idx]) for idx in range(len(sample_columns))}
            for row in sample_rows
        ]

        return {
            "success": True,
            "chart": {
                "aggregation": aggregation,
                "x_column": request.x_column,
                "y_column": request.y_column,
                "data": chart_data
            },
            "sample": {
                "columns": sample_columns,
                "rows": sample_data
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn:
            conn.close()

# ─────────────────────────────────────────────────────────────────────────────
# Local-agent visualization helpers
# ─────────────────────────────────────────────────────────────────────────────

def _build_col_query_for_agent(db_type: str, schema_filter: str = None, table_filter: str = None) -> str:
    """Build a column-info SELECT for the given DB type, optionally filtered."""
    if db_type == "sqlserver":
        q = ("SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT "
             "FROM INFORMATION_SCHEMA.COLUMNS WHERE 1=1")
        if schema_filter:
            q += f" AND TABLE_SCHEMA = '{schema_filter}'"
        if table_filter:
            q += f" AND TABLE_NAME = '{table_filter}'"
        q += " ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION"
    elif db_type == "postgresql":
        q = ("SELECT table_schema, table_name, column_name, data_type, is_nullable, column_default "
             "FROM information_schema.columns "
             "WHERE table_schema NOT IN ('pg_catalog','information_schema')")
        if schema_filter:
            q += f" AND table_schema = '{schema_filter}'"
        if table_filter:
            q += f" AND table_name = '{table_filter}'"
        q += " ORDER BY table_schema, table_name, ordinal_position"
    else:  # mysql
        schema_cond = f"TABLE_SCHEMA = '{schema_filter}'" if schema_filter else "TABLE_SCHEMA = DATABASE()"
        q = (f"SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT "
             f"FROM INFORMATION_SCHEMA.COLUMNS WHERE {schema_cond}")
        if table_filter:
            q += f" AND TABLE_NAME = '{table_filter}'"
        q += " ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION"
    return q


def _parse_col_rows_for_agent(rows: list, db_type: str, default_schema: str,
                               pk_map: dict, fk_col_ids: set) -> list:
    """Convert raw agent query rows into column dicts for generate_visualization_data."""
    columns = []
    for row in rows:
        if db_type == "postgresql":
            s  = row.get('table_schema')  or row.get('TABLE_SCHEMA')  or default_schema
            t  = row.get('table_name')    or row.get('TABLE_NAME')    or ''
            c  = row.get('column_name')   or row.get('COLUMN_NAME')   or ''
            dt = row.get('data_type')     or row.get('DATA_TYPE')     or ''
            nu = row.get('is_nullable')   or row.get('IS_NULLABLE')   or 'YES'
            df = row.get('column_default') or row.get('COLUMN_DEFAULT')
        else:
            s  = row.get('TABLE_SCHEMA')  or row.get('table_schema')  or default_schema
            t  = row.get('TABLE_NAME')    or row.get('table_name')    or ''
            c  = row.get('COLUMN_NAME')   or row.get('column_name')   or ''
            dt = row.get('DATA_TYPE')     or row.get('data_type')     or ''
            nu = row.get('IS_NULLABLE')   or row.get('is_nullable')   or 'YES'
            df = row.get('COLUMN_DEFAULT') or row.get('column_default')
        if not (t and c):
            continue
        col_id = f"{s}.{t}.{c}"
        columns.append({
            'schema': s, 'table': t, 'column': c,
            'data_type': dt,
            'nullable': nu,
            'default': str(df) if df is not None else None,
            'is_primary_key': c in pk_map.get((s, t), set()),
            'is_foreign_key': col_id in fk_col_ids,
            'is_referenced_pk': False,
        })
    return columns


async def _get_visualization_data_via_local_agent(
    connection,
    level: str,
    filter_obj,
    column,
    show_all_columns: bool,
    show_only_connected_tables: bool,
    enabled_object_types,
) -> dict:
    """Collect all visualization metadata via local agent and return the same
    JSON structure that get_visualization_data produces for direct connections."""
    from feature_visualization import generate_visualization_data

    if not connection.connection_code:
        raise HTTPException(status_code=400, detail="Connection code required for local agent")
    agent = agent_manager.get_agent(connection.connection_code)
    if not agent or agent.status != AgentStatus.CONNECTED:
        raise HTTPException(status_code=400, detail="Local agent is not connected")

    db_type = agent.db_type or "mysql"
    default_schema = getattr(agent, 'db_name', None) or (
        "public" if db_type == "postgresql" else
        "dbo"    if db_type == "sqlserver"  else ""
    )

    async def qry(sql: str) -> list:
        """Run SQL via the agent and return list-of-dicts."""
        job  = agent_manager.create_job(connection.connection_code, sql)
        sent = await agent_manager.send_job_to_agent(connection.connection_code, job)
        if not sent:
            return []
        for _ in range(150):   # 15 s timeout
            res = agent_manager.get_job(job.job_id)
            if res and res.status == "completed":
                if res.error or not res.result or not res.result.get("success"):
                    return []
                return res.result.get("results", [])
            if res and res.status == "failed":
                return []
            await asyncio.sleep(0.1)
        return []

    def v(row: dict, *keys) -> str:
        """Case-insensitive key lookup returning str, '' if missing."""
        for k in keys:
            for variant in (k, k.upper(), k.lower()):
                val = row.get(variant)
                if val is not None:
                    return str(val)
        return ""

    # ── FK Relationships ──────────────────────────────────────────────────────
    relationships = []
    if db_type == "sqlserver":
        fk_rows = await qry("""
            SELECT OBJECT_SCHEMA_NAME(fk.parent_object_id)       AS source_schema,
                   OBJECT_NAME(fk.parent_object_id)              AS source_table,
                   OBJECT_SCHEMA_NAME(fk.referenced_object_id)   AS target_schema,
                   OBJECT_NAME(fk.referenced_object_id)          AS target_table,
                   fk.name                                        AS constraint_name,
                   COL_NAME(fkc.parent_object_id, fkc.parent_column_id)       AS source_column,
                   COL_NAME(fkc.referenced_object_id, fkc.referenced_column_id) AS target_column
            FROM sys.foreign_keys fk
            INNER JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
        """)
    elif db_type == "postgresql":
        fk_rows = await qry("""
            SELECT nsp.nspname AS source_schema, src.relname AS source_table,
                   rns.nspname AS target_schema, ref.relname AS target_table,
                   con.conname AS constraint_name,
                   sa.attname  AS source_column,  ra.attname AS target_column
            FROM pg_constraint con
            JOIN pg_class src     ON src.oid = con.conrelid
            JOIN pg_namespace nsp ON nsp.oid = src.relnamespace
            JOIN pg_class ref     ON ref.oid = con.confrelid
            JOIN pg_namespace rns ON rns.oid = ref.relnamespace
            JOIN LATERAL unnest(con.conkey)  WITH ORDINALITY sc(col,ord) ON true
            JOIN LATERAL unnest(con.confkey) WITH ORDINALITY rc(col,ord) ON sc.ord = rc.ord
            JOIN pg_attribute sa ON sa.attrelid = con.conrelid  AND sa.attnum = sc.col
            JOIN pg_attribute ra ON ra.attrelid = con.confrelid AND ra.attnum = rc.col
            WHERE con.contype = 'f'
              AND nsp.nspname NOT IN ('pg_catalog','information_schema')
        """)
    else:  # mysql
        fk_rows = await qry("""
            SELECT kcu.TABLE_SCHEMA            AS source_schema,
                   kcu.TABLE_NAME              AS source_table,
                   kcu.REFERENCED_TABLE_SCHEMA AS target_schema,
                   kcu.REFERENCED_TABLE_NAME   AS target_table,
                   kcu.CONSTRAINT_NAME         AS constraint_name,
                   kcu.COLUMN_NAME             AS source_column,
                   kcu.REFERENCED_COLUMN_NAME  AS target_column
            FROM information_schema.KEY_COLUMN_USAGE kcu
            WHERE kcu.REFERENCED_TABLE_NAME IS NOT NULL
              AND kcu.TABLE_SCHEMA = DATABASE()
        """)
    for row in fk_rows:
        ss = v(row, 'source_schema') or default_schema
        st = v(row, 'source_table')
        ts = v(row, 'target_schema') or default_schema
        tt = v(row, 'target_table')
        if st and tt:
            relationships.append({
                'source_schema': ss, 'source_table': st,
                'target_schema': ts, 'target_table': tt,
                'constraint_name': v(row, 'constraint_name'),
                'source_column':   v(row, 'source_column'),
                'target_column':   v(row, 'target_column'),
            })

    # ── All Tables ────────────────────────────────────────────────────────────
    all_tables = []
    if db_type == "sqlserver":
        rows = await qry("SELECT TABLE_SCHEMA, TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE='BASE TABLE' ORDER BY TABLE_SCHEMA, TABLE_NAME")
        for r in rows:
            s, n = v(r,'TABLE_SCHEMA') or default_schema, v(r,'TABLE_NAME')
            if n: all_tables.append({'schema': s, 'name': n, 'full_name': f"{s}.{n}"})
    elif db_type == "postgresql":
        rows = await qry("SELECT table_schema, table_name FROM information_schema.tables WHERE table_type='BASE TABLE' AND table_schema NOT IN ('pg_catalog','information_schema') ORDER BY table_schema, table_name")
        for r in rows:
            s, n = v(r,'table_schema') or default_schema, v(r,'table_name')
            if n: all_tables.append({'schema': s, 'name': n, 'full_name': f"{s}.{n}"})
    else:
        rows = await qry("SELECT TABLE_SCHEMA, TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_SCHEMA, TABLE_NAME")
        for r in rows:
            s, n = v(r,'TABLE_SCHEMA') or default_schema, v(r,'TABLE_NAME')
            if n: all_tables.append({'schema': s, 'name': n, 'full_name': f"{s}.{n}"})

    # ── All Views ─────────────────────────────────────────────────────────────
    views = []
    if db_type == "sqlserver":
        rows = await qry("SELECT TABLE_SCHEMA, TABLE_NAME FROM INFORMATION_SCHEMA.VIEWS ORDER BY TABLE_SCHEMA, TABLE_NAME")
        for r in rows:
            s, n = v(r,'TABLE_SCHEMA') or default_schema, v(r,'TABLE_NAME')
            if n: views.append({'schema': s, 'name': n, 'full_name': f"{s}.{n}"})
    elif db_type == "postgresql":
        rows = await qry("SELECT table_schema, table_name FROM information_schema.views WHERE table_schema NOT IN ('pg_catalog','information_schema') ORDER BY table_schema, table_name")
        for r in rows:
            s, n = v(r,'table_schema') or default_schema, v(r,'table_name')
            if n: views.append({'schema': s, 'name': n, 'full_name': f"{s}.{n}"})
    else:
        rows = await qry("SELECT TABLE_SCHEMA, TABLE_NAME FROM INFORMATION_SCHEMA.VIEWS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME")
        for r in rows:
            s, n = v(r,'TABLE_SCHEMA') or default_schema, v(r,'TABLE_NAME')
            if n: views.append({'schema': s, 'name': n, 'full_name': f"{s}.{n}"})

    # ── Procedures / Triggers / Sequences / Materialized Views ────────────────
    procedures = []
    triggers   = []
    sequences  = []
    materialized_views = []

    if db_type == "sqlserver":
        rows = await qry("SELECT ROUTINE_SCHEMA, ROUTINE_NAME, ROUTINE_TYPE FROM INFORMATION_SCHEMA.ROUTINES WHERE ROUTINE_TYPE IN ('PROCEDURE','FUNCTION') ORDER BY ROUTINE_SCHEMA, ROUTINE_NAME")
        for r in rows:
            s, n, rt = v(r,'ROUTINE_SCHEMA') or default_schema, v(r,'ROUTINE_NAME'), v(r,'ROUTINE_TYPE').upper()
            if n: procedures.append({'schema': s, 'name': n, 'full_name': f"{s}.{n}", 'type': 'function' if rt == 'FUNCTION' else 'procedure'})
        rows = await qry("SELECT OBJECT_SCHEMA_NAME(parent_id) AS trig_schema, OBJECT_NAME(parent_id) AS table_name, name AS trig_name FROM sys.triggers WHERE is_ms_shipped=0")
        for r in rows:
            s, n, t = v(r,'trig_schema') or default_schema, v(r,'trig_name'), v(r,'table_name')
            if n: triggers.append({'schema': s, 'name': n, 'table_name': t, 'full_name': f"{s}.{n}"})

    elif db_type == "postgresql":
        rows = await qry("SELECT n.nspname AS routine_schema, p.proname AS routine_name, p.prokind FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid WHERE p.prokind IN ('p','f') AND n.nspname NOT IN ('pg_catalog','information_schema') ORDER BY n.nspname, p.proname")
        for r in rows:
            s, n, pk = v(r,'routine_schema') or default_schema, v(r,'routine_name'), v(r,'prokind')
            if n: procedures.append({'schema': s, 'name': n, 'full_name': f"{s}.{n}", 'type': 'function' if pk == 'f' else 'procedure'})
        rows = await qry("SELECT n.nspname AS trig_schema, t.tgname AS trig_name, c.relname AS table_name FROM pg_trigger t JOIN pg_class c ON t.tgrelid=c.oid JOIN pg_namespace n ON c.relnamespace=n.oid WHERE NOT t.tgisinternal AND n.nspname NOT IN ('pg_catalog','information_schema')")
        for r in rows:
            s, n, t = v(r,'trig_schema') or default_schema, v(r,'trig_name'), v(r,'table_name')
            if n: triggers.append({'schema': s, 'name': n, 'table_name': t, 'full_name': f"{s}.{n}"})
        rows = await qry("SELECT n.nspname AS seq_schema, c.relname AS seq_name FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid WHERE c.relkind='S' AND n.nspname NOT IN ('pg_catalog','information_schema')")
        for r in rows:
            s, n = v(r,'seq_schema') or default_schema, v(r,'seq_name')
            if n: sequences.append({'schema': s, 'name': n, 'full_name': f"{s}.{n}"})
        rows = await qry("SELECT n.nspname AS mv_schema, c.relname AS mv_name FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid WHERE c.relkind='m' AND n.nspname NOT IN ('pg_catalog','information_schema')")
        for r in rows:
            s, n = v(r,'mv_schema') or default_schema, v(r,'mv_name')
            if n: materialized_views.append({'schema': s, 'name': n, 'full_name': f"{s}.{n}"})

    else:  # mysql
        rows = await qry("SELECT ROUTINE_SCHEMA, ROUTINE_NAME, ROUTINE_TYPE FROM INFORMATION_SCHEMA.ROUTINES WHERE ROUTINE_SCHEMA=DATABASE() AND ROUTINE_TYPE IN ('PROCEDURE','FUNCTION') ORDER BY ROUTINE_NAME")
        for r in rows:
            s, n, rt = v(r,'ROUTINE_SCHEMA') or default_schema, v(r,'ROUTINE_NAME'), v(r,'ROUTINE_TYPE').upper()
            if n: procedures.append({'schema': s, 'name': n, 'full_name': f"{s}.{n}", 'type': 'function' if rt == 'FUNCTION' else 'procedure'})
        rows = await qry("SELECT TRIGGER_SCHEMA, TRIGGER_NAME, EVENT_OBJECT_TABLE AS table_name FROM INFORMATION_SCHEMA.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE()")
        for r in rows:
            s, n, t = v(r,'TRIGGER_SCHEMA') or default_schema, v(r,'TRIGGER_NAME'), v(r,'table_name','EVENT_OBJECT_TABLE')
            if n: triggers.append({'schema': s, 'name': n, 'table_name': t, 'full_name': f"{s}.{n}"})

    # ── Primary Keys (one bulk query) ─────────────────────────────────────────
    pk_map: dict = {}   # (schema, table) → set of pk column names
    if db_type == "sqlserver":
        rows = await qry("SELECT tc.TABLE_SCHEMA, tc.TABLE_NAME, kcu.COLUMN_NAME FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu ON tc.CONSTRAINT_NAME=kcu.CONSTRAINT_NAME AND tc.TABLE_SCHEMA=kcu.TABLE_SCHEMA WHERE tc.CONSTRAINT_TYPE='PRIMARY KEY'")
        for r in rows:
            s, t, c = v(r,'TABLE_SCHEMA') or default_schema, v(r,'TABLE_NAME'), v(r,'COLUMN_NAME')
            if t and c: pk_map.setdefault((s, t), set()).add(c)
    elif db_type == "postgresql":
        rows = await qry("SELECT nsp.nspname AS tbl_schema, cls.relname AS tbl_name, att.attname AS col_name FROM pg_constraint con JOIN pg_class cls ON cls.oid=con.conrelid JOIN pg_namespace nsp ON nsp.oid=cls.relnamespace JOIN unnest(con.conkey) AS col(attnum) ON true JOIN pg_attribute att ON att.attrelid=con.conrelid AND att.attnum=col.attnum WHERE con.contype='p' AND nsp.nspname NOT IN ('pg_catalog','information_schema')")
        for r in rows:
            s, t, c = v(r,'tbl_schema') or default_schema, v(r,'tbl_name'), v(r,'col_name')
            if t and c: pk_map.setdefault((s, t), set()).add(c)
    else:
        rows = await qry("SELECT kcu.TABLE_SCHEMA, kcu.TABLE_NAME, kcu.COLUMN_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu JOIN INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc ON kcu.CONSTRAINT_NAME=tc.CONSTRAINT_NAME AND kcu.TABLE_SCHEMA=tc.TABLE_SCHEMA AND kcu.TABLE_NAME=tc.TABLE_NAME WHERE tc.CONSTRAINT_TYPE='PRIMARY KEY' AND kcu.TABLE_SCHEMA=DATABASE()")
        for r in rows:
            s, t, c = v(r,'TABLE_SCHEMA') or default_schema, v(r,'TABLE_NAME'), v(r,'COLUMN_NAME')
            if t and c: pk_map.setdefault((s, t), set()).add(c)

    # ── FK column IDs for marking ─────────────────────────────────────────────
    fk_col_ids: set = set()
    for rel in relationships:
        fk_col_ids.add(f"{rel['source_schema']}.{rel['source_table']}.{rel['source_column']}")

    # ── Column Info ───────────────────────────────────────────────────────────
    columns: list = []
    if level in ('schema', 'table'):
        if filter_obj and '.' not in filter_obj:
            # Schema filter: all columns for that schema
            col_sql = _build_col_query_for_agent(db_type, schema_filter=filter_obj)
            columns = _parse_col_rows_for_agent(await qry(col_sql), db_type, default_schema, pk_map, fk_col_ids)
        elif show_all_columns and not filter_obj:
            # All columns (no filter)
            col_sql = _build_col_query_for_agent(db_type)
            columns = _parse_col_rows_for_agent(await qry(col_sql), db_type, default_schema, pk_map, fk_col_ids)
        else:
            # Per-table: selected table + all FK-related tables
            tables_to_fetch: set = set()
            if filter_obj and '.' in filter_obj:
                tables_to_fetch.add(filter_obj)
            for rel in relationships:
                tables_to_fetch.add(f"{rel['source_schema']}.{rel['source_table']}")
                tables_to_fetch.add(f"{rel['target_schema']}.{rel['target_table']}")
            for tbl_id in tables_to_fetch:
                parts = tbl_id.split('.')
                if len(parts) != 2:
                    continue
                s2, t2 = parts
                col_sql = _build_col_query_for_agent(db_type, schema_filter=s2, table_filter=t2)
                columns.extend(_parse_col_rows_for_agent(await qry(col_sql), db_type, default_schema, pk_map, fk_col_ids))
    elif level == 'column' and filter_obj:
        s2 = filter_obj.split('.')[0] if '.' in filter_obj else default_schema
        t2 = filter_obj.split('.')[-1] if '.' in filter_obj else filter_obj
        col_sql = _build_col_query_for_agent(db_type, schema_filter=s2, table_filter=t2)
        columns = _parse_col_rows_for_agent(await qry(col_sql), db_type, default_schema, pk_map, fk_col_ids)

    # ── View Dependencies ─────────────────────────────────────────────────────
    view_deps: list = []
    if db_type == "postgresql":
        rows = await qry("SELECT view_schema, view_name, table_schema, table_name FROM information_schema.view_table_usage WHERE view_schema NOT IN ('pg_catalog','information_schema')")
        for r in rows:
            view_deps.append({'schema': v(r,'view_schema') or default_schema, 'source': v(r,'view_name'), 'target': f"{v(r,'table_schema')}.{v(r,'table_name')}", 'type': 'view_dependency'})
    elif db_type == "sqlserver":
        rows = await qry("SELECT DISTINCT OBJECT_SCHEMA_NAME(referencing_id) AS vs, OBJECT_NAME(referencing_id) AS vn, OBJECT_SCHEMA_NAME(referenced_id) AS ts, OBJECT_NAME(referenced_id) AS tn FROM sys.sql_expression_dependencies WHERE referencing_id IN (SELECT object_id FROM sys.views) AND referenced_id IN (SELECT object_id FROM sys.tables)")
        for r in rows:
            view_deps.append({'schema': v(r,'vs') or default_schema, 'source': v(r,'vn'), 'target': f"{v(r,'ts')}.{v(r,'tn')}", 'type': 'view_dependency'})
    # MySQL view deps require SHOW CREATE VIEW parsing → skipped for local agent

    # ── Generate visualization data ───────────────────────────────────────────
    data = generate_visualization_data(
        relationships=relationships,
        view_deps=view_deps,
        columns=columns,
        level=level,
        filter_obj=filter_obj,
        views=views,
        column_dependencies=None,
        selected_column=column,
        all_tables=all_tables,
        show_all_columns=show_all_columns,
        conn=None,        # no direct DB connection; PKs pre-computed above
        engine=None,
        enabled_object_types=enabled_object_types,
        procedures=procedures,
        triggers=triggers,
        sequences=sequences,
        materialized_views=materialized_views,
        procedure_deps=[],  # would need complex async parsing; omitted for local agent
        show_only_connected_tables=show_only_connected_tables,
    )
    data['database'] = getattr(agent, 'db_name', '') or ''
    return data


# ─────────────────────────────────────────────────────────────────────────────

@app.post("/visualization/data")
async def get_visualization_data(
    connection: DatabaseConnection = Body(...),
    level: str = Query("table", description="Visualization level: database, schema, table, column"),
    filter_obj: str = Query(None, description="Filter by specific object (e.g., table name)"),
    column: str = Query(None, description="Column name for column-level dependencies"),
    schema: str = Query(None, description="Schema name for column-level dependencies"),
    show_all_columns: bool = Query(False, description="Show all columns, not just those with relationships"),
    show_only_connected_tables: bool = Query(False, description="Show only tables that have connections to other tables"),
    object_types: str = Query(None, description="Comma-separated list of object types to show (tables,views,procedures,functions,triggers,sequences,materialized_views)"),
    _: bool = Depends(verify_token)
):
    """
    Get visualization data as JSON for frontend rendering.
    Send connection parameters in request body.
    
    Levels:
    - database: Show all schemas
    - schema: Show all tables and views
    - table: Show table relationships with foreign keys
    - column: Show column-level dependencies
    """
    try:
        if connection.connection_method == "local":
            enabled_object_types = set(object_types.split(',')) if object_types else None
            return await _get_visualization_data_via_local_agent(
                connection, level, filter_obj, column,
                show_all_columns, show_only_connected_tables, enabled_object_types
            )
        
        conn, engine = _connect_from_params(connection)
        
        relationships = get_table_relationships(conn, engine)
        view_deps = get_view_dependencies(conn, engine)
        views = get_all_views(conn, engine)
        all_tables = get_all_tables(conn, engine)
        procedures = get_all_procedures(conn, engine)
        triggers = get_all_triggers(conn, engine)
        sequences = get_all_sequences(conn, engine)
        materialized_views = get_all_materialized_views(conn, engine)
        columns = []
        column_dependencies = None
        
        # Get column information for all tables if we're showing table/schema level
        if level in ['schema', 'table']:
            if filter_obj:
                if '.' not in filter_obj:
                    # Filter by schema – fetch all columns for every table in this schema
                    columns = get_column_info(conn, engine, schema=filter_obj)
                else:
                    # Filter by specific table – always include the selected table plus all
                    # tables that participate in FK relationships (needed to render edges).
                    tables_in_rels = set()
                    tables_in_rels.add(filter_obj)  # ensure selected table is always fetched
                    for rel in relationships:
                        tables_in_rels.add(f"{rel['source_schema']}.{rel['source_table']}")
                        tables_in_rels.add(f"{rel['target_schema']}.{rel['target_table']}")
                    columns = []
                    for table_id in tables_in_rels:
                        schema_name = table_id.split('.')[0]
                        table_name = table_id.split('.')[-1]
                        table_cols = get_column_info(conn, engine, schema=schema_name, table=table_name)
                        columns.extend(table_cols)
            else:
                # No filter
                if show_all_columns:
                    # User wants all columns → fetch everything at once
                    columns = get_column_info(conn, engine)
                else:
                    # Default: only load columns for tables that participate in FK
                    # relationships to keep the response fast for large schemas.
                    tables_in_rels = set()
                    for rel in relationships:
                        tables_in_rels.add(f"{rel['source_schema']}.{rel['source_table']}")
                        tables_in_rels.add(f"{rel['target_schema']}.{rel['target_table']}")
                    columns = []
                    for table_id in tables_in_rels:
                        schema_name = table_id.split('.')[0]
                        table_name = table_id.split('.')[-1]
                        table_cols = get_column_info(conn, engine, schema=schema_name, table=table_name)
                        columns.extend(table_cols)
        elif level == 'column':
            if filter_obj:
                table_name = filter_obj.split('.')[-1] if '.' in filter_obj else filter_obj
                schema_name = filter_obj.split('.')[0] if '.' in filter_obj else schema
                columns = get_column_info(conn, engine, schema=schema_name, table=table_name)
                
                # If column is specified, get detailed dependencies
                if column:
                    column_dependencies = get_column_dependencies(conn, engine, schema_name, table_name, column)

                    # Fetch columns from related tables (FK targets/sources for this column)
                    related_tables = set()
                    for rel in relationships:
                        src = f"{rel['source_schema']}.{rel['source_table']}"
                        tgt = f"{rel['target_schema']}.{rel['target_table']}"
                        if src == filter_obj and rel['source_column'] == column:
                            related_tables.add(tgt)
                        elif tgt == filter_obj and rel['target_column'] == column:
                            related_tables.add(src)

                    if column_dependencies:
                        for dep in column_dependencies.get('upstream', []) + column_dependencies.get('downstream', []):
                            if dep['type'] == 'foreign_key':
                                related_tables.add(f"{dep['source_schema']}.{dep['source_table']}")
                                related_tables.add(f"{dep['target_schema']}.{dep['target_table']}")

                    related_tables.discard(filter_obj)
                    for rt in related_tables:
                        rt_schema = rt.split('.')[0]
                        rt_table = rt.split('.')[-1]
                        columns.extend(get_column_info(conn, engine, schema=rt_schema, table=rt_table))
        
        # Parse object_types filter
        enabled_object_types = None
        if object_types:
            enabled_object_types = set(object_types.split(','))
        
        # Get procedure table dependencies (which tables they read from/write to)
        procedure_deps = get_procedure_table_dependencies(conn, engine, procedures) if procedures else []
        
        # Generate visualization data using the new function
        data = generate_visualization_data(
            relationships, view_deps, columns, level, filter_obj, views, 
            column_dependencies, column, all_tables, show_all_columns, conn, engine, 
            enabled_object_types, procedures, triggers, sequences, materialized_views, 
            procedure_deps, show_only_connected_tables
        )
        
        conn.close()
        
        # Add database name to response
        data['database'] = connection.database
        
        return data
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


async def _get_schema_via_local_agent(connection: DatabaseConnection) -> dict:
    """Fetch schema (tables, views, etc.) via local agent. Used by POST /tables and GET /local/schema."""
    if not connection.connection_code:
        raise HTTPException(status_code=400, detail="Connection code is required for local agent connections")
    agent = agent_manager.get_agent(connection.connection_code)
    if not agent or agent.status != AgentStatus.CONNECTED:
        raise HTTPException(status_code=400, detail="Agent is not connected. Please ensure the local agent is running and connected.")
    db_type = agent.db_type or "mysql"

    async def execute_query_via_agent(sql: str) -> List[Dict]:
        """Execute a query via agent and return results."""
        job = agent_manager.create_job(connection.connection_code, sql)
        sent = await agent_manager.send_job_to_agent(connection.connection_code, job)
        if not sent:
            return []
        max_wait = 10
        start_time = time.time()
        while time.time() - start_time < max_wait:
            result = agent_manager.get_job(job.job_id)
            if result and result.status == "completed":
                if result.error or not result.result or not result.result.get("success"):
                    return []
                return result.result.get("results", [])
            elif result and result.status == "failed":
                return []
            await asyncio.sleep(0.1)
        return []

    # Build queries based on database type
    tables = []
    views = []
    procedures = []
    functions = []
    triggers = []
    sequences = []
    materialized_views = []

    if db_type == "sqlserver":
        # Tables
        tables_query = """
                SELECT TABLE_SCHEMA, TABLE_NAME
                FROM INFORMATION_SCHEMA.TABLES
                WHERE TABLE_TYPE = 'BASE TABLE'
                ORDER BY TABLE_SCHEMA, TABLE_NAME
                """
        tables_rows = await execute_query_via_agent(tables_query)
        for row in tables_rows:
            schema = row.get("TABLE_SCHEMA") or row.get("table_schema") or "dbo"
            name = row.get("TABLE_NAME") or row.get("table_name")
            if name:
                tables.append({"schema": schema, "name": name})

        # Views
        views_query = """
                SELECT TABLE_SCHEMA, TABLE_NAME
                FROM INFORMATION_SCHEMA.VIEWS
                ORDER BY TABLE_SCHEMA, TABLE_NAME
                """
        views_rows = await execute_query_via_agent(views_query)
        for row in views_rows:
            schema = row.get("TABLE_SCHEMA") or row.get("table_schema") or "dbo"
            name = row.get("TABLE_NAME") or row.get("table_name")
            if name:
                views.append({"schema": schema, "name": name})

        # Procedures
        procedures_query = """
                SELECT ROUTINE_SCHEMA, ROUTINE_NAME, ROUTINE_TYPE
                FROM INFORMATION_SCHEMA.ROUTINES
                WHERE ROUTINE_TYPE IN ('PROCEDURE', 'FUNCTION')
                ORDER BY ROUTINE_SCHEMA, ROUTINE_NAME
                """
        procedures_rows = await execute_query_via_agent(procedures_query)
        for row in procedures_rows:
            schema = row.get("ROUTINE_SCHEMA") or row.get("routine_schema") or "dbo"
            name = row.get("ROUTINE_NAME") or row.get("routine_name")
            routine_type = row.get("ROUTINE_TYPE") or row.get("routine_type") or "PROCEDURE"
            if name:
                if routine_type.upper() == "FUNCTION":
                    functions.append({"schema": schema, "name": name, "type": routine_type})
                else:
                    procedures.append({"schema": schema, "name": name, "type": routine_type})

        # Triggers
        triggers_query = """
                SELECT 
                    OBJECT_SCHEMA_NAME(parent_id) AS trigger_schema,
                    OBJECT_NAME(parent_id) AS table_name,
                    name AS trigger_name
                FROM sys.triggers
                WHERE is_ms_shipped = 0
                ORDER BY trigger_schema, table_name, trigger_name
                """
        triggers_rows = await execute_query_via_agent(triggers_query)
        for row in triggers_rows:
            schema = row.get("trigger_schema") or row.get("TRIGGER_SCHEMA") or "dbo"
            name = row.get("trigger_name") or row.get("TRIGGER_NAME")
            if name:
                triggers.append({"schema": schema, "name": name})

    elif db_type == "postgresql":
        # Tables
        tables_query = """
                SELECT table_schema, table_name
                FROM information_schema.tables
                WHERE table_type = 'BASE TABLE'
                  AND table_schema NOT IN ('pg_catalog', 'information_schema')
                ORDER BY table_schema, table_name
                """
        tables_rows = await execute_query_via_agent(tables_query)
        for row in tables_rows:
            schema = row.get("table_schema") or row.get("TABLE_SCHEMA") or "public"
            name = row.get("table_name") or row.get("TABLE_NAME")
            if name:
                tables.append({"schema": schema, "name": name})

        # Views
        views_query = """
                SELECT table_schema, table_name
                FROM information_schema.views
                WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
                ORDER BY table_schema, table_name
                """
        views_rows = await execute_query_via_agent(views_query)
        for row in views_rows:
            schema = row.get("table_schema") or row.get("TABLE_SCHEMA") or "public"
            name = row.get("table_name") or row.get("TABLE_NAME")
            if name:
                views.append({"schema": schema, "name": name})

        # Procedures and Functions
        procedures_query = """
                SELECT n.nspname AS routine_schema, p.proname AS routine_name, p.prokind
                FROM pg_proc p
                JOIN pg_namespace n ON p.pronamespace = n.oid
                WHERE p.prokind IN ('p', 'f')
                  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
                ORDER BY n.nspname, p.proname
                """
        procedures_rows = await execute_query_via_agent(procedures_query)
        for row in procedures_rows:
            schema = row.get("routine_schema") or row.get("ROUTINE_SCHEMA") or "public"
            name = row.get("routine_name") or row.get("ROUTINE_NAME")
            prokind = row.get("prokind") or row.get("PROKIND") or "p"
            routine_type = "FUNCTION" if prokind == "f" else "PROCEDURE"
            if name:
                if routine_type == "FUNCTION":
                    functions.append({"schema": schema, "name": name, "type": routine_type})
                else:
                    procedures.append({"schema": schema, "name": name, "type": routine_type})

        # Triggers
        triggers_query = """
                SELECT 
                    n.nspname AS trigger_schema,
                    t.tgname AS trigger_name,
                    c.relname AS table_name
                FROM pg_trigger t
                JOIN pg_class c ON t.tgrelid = c.oid
                JOIN pg_namespace n ON c.relnamespace = n.oid
                WHERE NOT t.tgisinternal
                  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
                ORDER BY n.nspname, c.relname, t.tgname
                """
        triggers_rows = await execute_query_via_agent(triggers_query)
        for row in triggers_rows:
            schema = row.get("trigger_schema") or row.get("TRIGGER_SCHEMA") or "public"
            name = row.get("trigger_name") or row.get("TRIGGER_NAME")
            if name:
                triggers.append({"schema": schema, "name": name})

        # Sequences
        sequences_query = """
                SELECT 
                    n.nspname AS sequence_schema,
                    c.relname AS sequence_name
                FROM pg_class c
                JOIN pg_namespace n ON c.relnamespace = n.oid
                WHERE c.relkind = 'S'
                  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
                ORDER BY n.nspname, c.relname
                """
        sequences_rows = await execute_query_via_agent(sequences_query)
        for row in sequences_rows:
            schema = row.get("sequence_schema") or row.get("SEQUENCE_SCHEMA") or "public"
            name = row.get("sequence_name") or row.get("SEQUENCE_NAME")
            if name:
                sequences.append({"schema": schema, "name": name})

        # Materialized Views
        materialized_views_query = """
                SELECT 
                    n.nspname AS matview_schema,
                    c.relname AS matview_name
                FROM pg_class c
                JOIN pg_namespace n ON c.relnamespace = n.oid
                WHERE c.relkind = 'm'
                  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
                ORDER BY n.nspname, c.relname
                """
        materialized_views_rows = await execute_query_via_agent(materialized_views_query)
        for row in materialized_views_rows:
            schema = row.get("matview_schema") or row.get("MATVIEW_SCHEMA") or "public"
            name = row.get("matview_name") or row.get("MATVIEW_NAME")
            if name:
                materialized_views.append({"schema": schema, "name": name})

    else:  # mysql
        # Tables
        tables_query = """
                SELECT TABLE_SCHEMA, TABLE_NAME
                FROM INFORMATION_SCHEMA.TABLES
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
                ORDER BY TABLE_SCHEMA, TABLE_NAME
                """
        tables_rows = await execute_query_via_agent(tables_query)
        for row in tables_rows:
            schema = row.get("TABLE_SCHEMA") or row.get("table_schema") or agent.db_name or "public"
            name = row.get("TABLE_NAME") or row.get("table_name")
            if name:
                tables.append({"schema": schema, "name": name})

        # Views
        views_query = """
                SELECT TABLE_SCHEMA, TABLE_NAME
                FROM INFORMATION_SCHEMA.VIEWS
                WHERE TABLE_SCHEMA = DATABASE()
                ORDER BY TABLE_NAME
                """
        views_rows = await execute_query_via_agent(views_query)
        for row in views_rows:
            schema = row.get("TABLE_SCHEMA") or row.get("table_schema") or agent.db_name or "public"
            name = row.get("TABLE_NAME") or row.get("table_name")
            if name:
                views.append({"schema": schema, "name": name})

        # Procedures
        procedures_query = """
                SELECT ROUTINE_SCHEMA, ROUTINE_NAME, ROUTINE_TYPE
                FROM INFORMATION_SCHEMA.ROUTINES
                WHERE ROUTINE_SCHEMA = DATABASE() 
                  AND ROUTINE_TYPE IN ('PROCEDURE', 'FUNCTION')
                ORDER BY ROUTINE_NAME
                """
        procedures_rows = await execute_query_via_agent(procedures_query)
        for row in procedures_rows:
            schema = row.get("ROUTINE_SCHEMA") or row.get("routine_schema") or agent.db_name or "public"
            name = row.get("ROUTINE_NAME") or row.get("routine_name")
            routine_type = row.get("ROUTINE_TYPE") or row.get("routine_type") or "PROCEDURE"
            if name:
                if routine_type.upper() == "FUNCTION":
                    functions.append({"schema": schema, "name": name, "type": routine_type})
                else:
                    procedures.append({"schema": schema, "name": name, "type": routine_type})

        # Triggers
        triggers_query = """
                SELECT TRIGGER_SCHEMA, TRIGGER_NAME, EVENT_OBJECT_TABLE
                FROM INFORMATION_SCHEMA.TRIGGERS
                WHERE TRIGGER_SCHEMA = DATABASE()
                ORDER BY TRIGGER_NAME
                """
        triggers_rows = await execute_query_via_agent(triggers_query)
        for row in triggers_rows:
            schema = row.get("TRIGGER_SCHEMA") or row.get("trigger_schema") or agent.db_name or "public"
            name = row.get("TRIGGER_NAME") or row.get("trigger_name")
            if name:
                triggers.append({"schema": schema, "name": name})
            
    return {
        "tables": tables,
        "views": views,
        "procedures": procedures,
        "functions": functions,
        "triggers": triggers,
        "sequences": sequences,
        "materialized_views": materialized_views,
        "count": len(tables) + len(views) + len(procedures) + len(functions) + len(triggers) + len(sequences) + len(materialized_views)
    }


@app.get("/local/schema")
async def local_schema(session_id: str = Query(...), _: bool = Depends(verify_token)):
    """Get schema (tables, views, etc.) for a session. Used by Electron app for local agent connections."""
    conn_params = get_connection_params(session_id)
    if not conn_params:
        raise HTTPException(status_code=404, detail="Session not found or expired")
    if conn_params.connection_method != "local" or not conn_params.connection_code:
        raise HTTPException(status_code=400, detail="Not a local agent session")
    return await _get_schema_via_local_agent(conn_params)


async def _resolve_connection_or_id(request: Request) -> DatabaseConnection:
    """Accept either a full DatabaseConnection or just `connectionId`
    (LOCAL_MODE) and resolve to a DatabaseConnection ready to use.
    """
    body = await request.json()
    if LOCAL_MODE and body.get("connectionId") and not body.get("type"):
        from feature_local_mode import load_connection_as_params
        return load_connection_as_params(body["connectionId"])
    return DatabaseConnection(**body)


@app.post("/tables")
async def get_tables_list(request: Request, _: bool = Depends(verify_token)):
    """Get list of all tables, views, and procedures.

    Body accepts either full DatabaseConnection params (cloud / cross-DB
    case) or just `{"connectionId": "..."}` (LOCAL_MODE shortcut, where
    the backend reads the row from its own Postgres and decrypts).
    """
    try:
        connection = await _resolve_connection_or_id(request)
        if connection.connection_method == "local":
            return await _get_schema_via_local_agent(connection)

        conn, engine = _connect_from_params(connection)
        tables = get_all_tables(conn, engine)
        views = get_all_views(conn, engine)
        all_procedures = get_all_procedures(conn, engine)
        triggers = get_all_triggers(conn, engine)
        sequences = get_all_sequences(conn, engine)
        materialized_views = get_all_materialized_views(conn, engine)
        conn.close()
        
        # Separate procedures and functions
        procedures = []
        functions = []
        for proc in all_procedures:
            proc_type = proc.get('type', '').lower()
            if proc_type == 'function':
                functions.append(proc)
            else:
                procedures.append(proc)
        
        return {
            "tables": tables,
            "views": views,
            "procedures": procedures,
            "functions": functions,
            "triggers": triggers,
            "sequences": sequences,
            "materialized_views": materialized_views,
            "count": len(tables) + len(views) + len(procedures) + len(functions) + len(triggers) + len(sequences) + len(materialized_views)
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/views")
async def get_views_list(request: Request, _: bool = Depends(verify_token)):
    """Get list of all views. Body accepts full DatabaseConnection or LOCAL_MODE `{connectionId}`."""
    try:
        connection = await _resolve_connection_or_id(request)
        # For local agent connections, use agent to get views
        if connection.connection_method == "local":
            if not connection.connection_code:
                raise HTTPException(status_code=400, detail="Connection code is required for local agent connections")
            
            from local_agent_manager import agent_manager, AgentStatus
            import time
            
            # Check if agent is connected
            agent = agent_manager.get_agent(connection.connection_code)
            if not agent or agent.status != AgentStatus.CONNECTED:
                raise HTTPException(status_code=400, detail="Agent is not connected. Please ensure the local agent is running and connected.")
            
            # Get database type from agent
            db_type = agent.db_type or "mysql"
            
            # Helper function to execute query via agent
            async def execute_query_via_agent(sql: str) -> List[Dict]:
                """Execute a query via agent and return results."""
                job = agent_manager.create_job(connection.connection_code, sql)
                sent = await agent_manager.send_job_to_agent(connection.connection_code, job)

                if not sent:
                    return []

                # Wait for result
                max_wait = 10
                start_time = time.time()
                while time.time() - start_time < max_wait:
                    result = agent_manager.get_job(job.job_id)
                    if result and result.status == "completed":
                        if result.error or not result.result or not result.result.get("success"):
                            return []
                        return result.result.get("results", [])
                    elif result and result.status == "failed":
                        return []
                    await asyncio.sleep(0.1)
                return []
            
            views = []
            
            if db_type == "sqlserver":
                views_query = """
                SELECT TABLE_SCHEMA, TABLE_NAME
                FROM INFORMATION_SCHEMA.VIEWS
                ORDER BY TABLE_SCHEMA, TABLE_NAME
                """
                views_rows = await execute_query_via_agent(views_query)
                for row in views_rows:
                    schema = row.get("TABLE_SCHEMA") or row.get("table_schema") or "dbo"
                    name = row.get("TABLE_NAME") or row.get("table_name")
                    if name:
                        views.append({"schema": schema, "name": name})
            
            elif db_type == "postgresql":
                views_query = """
                SELECT table_schema, table_name
                FROM information_schema.views
                WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
                ORDER BY table_schema, table_name
                """
                views_rows = await execute_query_via_agent(views_query)
                for row in views_rows:
                    schema = row.get("table_schema") or row.get("TABLE_SCHEMA") or "public"
                    name = row.get("table_name") or row.get("TABLE_NAME")
                    if name:
                        views.append({"schema": schema, "name": name})
            
            else:  # mysql
                views_query = """
                SELECT TABLE_SCHEMA, TABLE_NAME
                FROM INFORMATION_SCHEMA.VIEWS
                WHERE TABLE_SCHEMA = DATABASE()
                ORDER BY TABLE_NAME
                """
                views_rows = await execute_query_via_agent(views_query)
                for row in views_rows:
                    schema = row.get("TABLE_SCHEMA") or row.get("table_schema") or agent.db_name or "public"
                    name = row.get("TABLE_NAME") or row.get("table_name")
                    if name:
                        views.append({"schema": schema, "name": name})
            
            return {"views": views, "count": len(views)}
        
        conn, engine = _connect_from_params(connection)
        views = get_all_views(conn, engine)
        conn.close()
        return {"views": views, "count": len(views)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/object-definition")
def get_object_definition(
    connection: DatabaseConnection = Body(...),
    object_name: str = Body(...),
    object_type: str = Body(...),
    schema: Optional[str] = Body(None),
    _: bool = Depends(verify_token)
):
    """Get definition/code for a database object (view, procedure, function, trigger)."""
    try:
        # For local agent connections, object definition is not yet supported
        if connection.connection_method == "local":
            raise HTTPException(status_code=400, detail="Object definition is not yet supported for local agent connections")
        
        conn, engine = _connect_from_params(connection)
        cursor = conn.cursor()
        
        # Build object reference with schema if provided
        if schema:
            if engine == "sqlserver":
                object_ref = f"{schema}.{object_name}"
            elif engine == "postgresql":
                object_ref = f'"{schema}"."{object_name}"'
            else:  # mysql
                object_ref = f"`{schema}`.`{object_name}`"
        else:
            if engine == "sqlserver":
                object_ref = f"dbo.{object_name}"
            elif engine == "postgresql":
                object_ref = f'"{object_name}"'
            else:  # mysql
                object_ref = f"`{object_name}`"
        
        query = ""
        if object_type == "view":
            if engine == "postgresql":
                query = f"SELECT pg_get_viewdef('{object_ref}'::regclass, true) AS definition"
            elif engine == "mysql":
                query = f"SHOW CREATE VIEW {object_ref}"
            elif engine == "sqlserver":
                query = f"SELECT OBJECT_DEFINITION(OBJECT_ID('{object_ref}')) AS definition"
            else:
                query = f"SELECT view_definition AS definition FROM information_schema.views WHERE table_name = '{object_name}'"
        elif object_type == "procedure":
            if engine == "postgresql":
                schema_filter = schema and f" AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = '{schema}')" or ""
                query = f"SELECT pg_get_functiondef(oid) AS definition FROM pg_proc WHERE proname = '{object_name}'{schema_filter} LIMIT 1"
            elif engine == "mysql":
                query = f"SHOW CREATE PROCEDURE {object_ref}"
            elif engine == "sqlserver":
                query = f"SELECT OBJECT_DEFINITION(OBJECT_ID('{object_ref}')) AS definition"
            else:
                schema_filter = schema and f" AND routine_schema = '{schema}'" or ""
                query = f"SELECT routine_definition AS definition FROM information_schema.routines WHERE routine_name = '{object_name}' AND routine_type = 'PROCEDURE'{schema_filter}"
        elif object_type == "function":
            if engine == "postgresql":
                schema_filter = schema and f" AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = '{schema}')" or ""
                query = f"SELECT pg_get_functiondef(oid) AS definition FROM pg_proc WHERE proname = '{object_name}'{schema_filter} LIMIT 1"
            elif engine == "mysql":
                query = f"SHOW CREATE FUNCTION {object_ref}"
            elif engine == "sqlserver":
                query = f"SELECT OBJECT_DEFINITION(OBJECT_ID('{object_ref}')) AS definition"
            else:
                schema_filter = schema and f" AND routine_schema = '{schema}'" or ""
                query = f"SELECT routine_definition AS definition FROM information_schema.routines WHERE routine_name = '{object_name}' AND routine_type = 'FUNCTION'{schema_filter}"
        elif object_type == "trigger":
            if engine == "postgresql":
                schema_filter = schema and f" AND tgrelid IN (SELECT oid FROM pg_class WHERE relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = '{schema}'))" or ""
                query = f"SELECT pg_get_triggerdef(oid) AS definition FROM pg_trigger WHERE tgname = '{object_name}'{schema_filter} LIMIT 1"
            elif engine == "mysql":
                query = f"SHOW CREATE TRIGGER {object_ref}"
            elif engine == "sqlserver":
                query = f"SELECT OBJECT_DEFINITION(OBJECT_ID('{object_ref}')) AS definition"
            else:
                schema_filter = schema and f" AND trigger_schema = '{schema}'" or ""
                query = f"SELECT action_statement AS definition FROM information_schema.triggers WHERE trigger_name = '{object_name}'{schema_filter}"
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported object type: {object_type}")
        
        cursor.execute(query)
        result = cursor.fetchone()
        cursor.close()
        conn.close()
        
        if not result:
            raise HTTPException(status_code=404, detail=f"Object {object_name} not found")
        
        # Extract definition from result (handle different column names)
        definition = None
        if isinstance(result, dict):
            definition = result.get('definition') or result.get('Definition') or result.get('Create View') or result.get('Create Procedure') or result.get('Create Function') or result.get('Create Trigger')
        elif isinstance(result, (list, tuple)):
            definition = result[0] if result else None
        
        if not definition:
            definition = str(result)
        
        # Format the definition SQL code for better readability
        # Only format if it looks like SQL code (contains SQL keywords)
        if definition and isinstance(definition, str):
            sql_keywords = ['SELECT', 'CREATE', 'ALTER', 'DROP', 'INSERT', 'UPDATE', 'DELETE', 'PROCEDURE', 'FUNCTION', 'VIEW', 'TRIGGER', 'BEGIN', 'END', 'DECLARE', 'RETURNS']
            if any(keyword in definition.upper() for keyword in sql_keywords):
                try:
                    from feature_chat_json_based import _format_sql_code
                    definition = _format_sql_code(definition)
                except Exception as e:
                    # If formatting fails, use original definition
                    pass
        
        return {
            "success": True,
            "definition": definition,
            "object_name": object_name,
            "object_type": object_type,
            "schema": schema
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/columns/{table_name}")
async def get_table_columns_endpoint(
    table_name: str,
    request: Request,
    _: bool = Depends(verify_token),
):
    """Get all columns for a specific table.

    Body accepts full DatabaseConnection or LOCAL_MODE `{connectionId}`.
    """
    try:
        connection = await _resolve_connection_or_id(request)
        # For local agent connections, use agent to get columns
        if connection.connection_method == "local":
            if not connection.connection_code:
                raise HTTPException(status_code=400, detail="Connection code is required for local agent connections")
            
            from local_agent_manager import agent_manager, AgentStatus
            import time
            
            # Check if agent is connected
            agent = agent_manager.get_agent(connection.connection_code)
            if not agent or agent.status != AgentStatus.CONNECTED:
                raise HTTPException(status_code=400, detail="Agent is not connected. Please ensure the local agent is running and connected.")
            
            # Get database type from agent
            db_type = agent.db_type or "mysql"
            
            # Helper function to execute query via agent
            async def execute_query_via_agent(sql: str) -> List[Dict]:
                """Execute a query via agent and return results."""
                job = agent_manager.create_job(connection.connection_code, sql)
                sent = await agent_manager.send_job_to_agent(connection.connection_code, job)

                if not sent:
                    return []

                # Wait for result
                max_wait = 10
                start_time = time.time()
                while time.time() - start_time < max_wait:
                    result = agent_manager.get_job(job.job_id)
                    if result and result.status == "completed":
                        if result.error or not result.result or not result.result.get("success"):
                            return []
                        return result.result.get("results", [])
                    elif result and result.status == "failed":
                        return []
                    await asyncio.sleep(0.1)
                return []
            
            # Build query based on database type
            # Escape table_name to prevent SQL injection
            table_name_escaped = table_name.replace("'", "''")
            
            if db_type == "sqlserver":
                query = f"""
                SELECT 
                    TABLE_SCHEMA,
                    TABLE_NAME,
                    COLUMN_NAME,
                    DATA_TYPE,
                    IS_NULLABLE,
                    COLUMN_DEFAULT
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_NAME = '{table_name_escaped}'
                ORDER BY ORDINAL_POSITION
                """
            elif db_type == "postgresql":
                query = f"""
                SELECT 
                    table_schema,
                    table_name,
                    column_name,
                    data_type,
                    is_nullable,
                    column_default
                FROM information_schema.columns
                WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
                  AND table_name = '{table_name_escaped}'
                ORDER BY ordinal_position
                """
            else:  # mysql
                query = f"""
                SELECT 
                    TABLE_SCHEMA,
                    TABLE_NAME,
                    COLUMN_NAME,
                    DATA_TYPE,
                    IS_NULLABLE,
                    COLUMN_DEFAULT
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE()
                  AND TABLE_NAME = '{table_name_escaped}'
                ORDER BY ORDINAL_POSITION
                """
            
            rows = await execute_query_via_agent(query)
            columns = []
            for row in rows:
                # Extract values with fallback for different case variations
                schema = row.get("TABLE_SCHEMA") or row.get("table_schema") or (agent.db_name if db_type == "mysql" else ("public" if db_type == "postgresql" else "dbo"))
                col_name = row.get("COLUMN_NAME") or row.get("column_name")
                data_type = row.get("DATA_TYPE") or row.get("data_type")
                nullable = row.get("IS_NULLABLE") or row.get("is_nullable")
                default = row.get("COLUMN_DEFAULT") or row.get("column_default")
                
                if col_name:
                    columns.append({
                        'schema': schema,
                        'table': table_name,
                        'column': col_name,
                        'data_type': data_type,
                        'nullable': nullable,
                        'default': default,
                        'is_primary_key': False  # Could be enhanced later
                    })
            
            return {"table": table_name, "columns": columns, "count": len(columns)}
        
        conn, engine = _connect_from_params(connection)
        columns = get_column_info(conn, engine, table=table_name)
        conn.close()
        return {"table": table_name, "columns": columns, "count": len(columns)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/visualization/column-dependencies")
def get_column_dependencies_endpoint(
    connection: DatabaseConnection = Body(...),
    schema: str = Query(..., description="Schema name"),
    table: str = Query(..., description="Table name"),
    column: str = Query(..., description="Column name"),
    _: bool = Depends(verify_token)
):
    """
    Get all dependencies for a specific column:
    - Upstream: What influences this column (FKs, procedures, triggers, views)
    - Downstream: What is influenced by this column (FKs, procedures, triggers, views)
    """
    try:
        conn, engine = _connect_from_params(connection)
        dependencies = get_column_dependencies(conn, engine, schema, table, column)
        conn.close()
        return {
            "success": True,
            "schema": schema,
            "table": table,
            "column": column,
            "dependencies": dependencies
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/upload/preview")
async def preview_file(
    request: Request,
    _: bool = Depends(verify_token)
):
    """Preview file content and get column mapping suggestions."""
    try:
        # Get content type to determine if it's JSON or FormData
        content_type = request.headers.get("content-type", "")
        
        file_content: bytes
        file_name: str
        connection: Optional[str] = None
        
        if "application/json" in content_type:
            # JSON request (from Edge Function)
            body = await request.json()
            
            connection = body.get("connection")
            file_base64 = body.get("file_base64")
            filename = body.get("filename")
            
            if file_base64 and filename:
                import base64
                try:
                    file_content = base64.b64decode(file_base64)
                    file_name = filename
                except Exception as decode_error:
                    raise HTTPException(status_code=400, detail=f"Invalid base64 encoding: {str(decode_error)}")
            else:
                raise HTTPException(status_code=400, detail="Either file or file_base64 must be provided")
        else:
            # FormData request (direct upload)
            form = await request.form()
            file = form.get("file")
            connection = form.get("connection")
            
            if file and hasattr(file, "file"):
                file_content = await file.read()
                file_name = file.filename
            else:
                raise HTTPException(status_code=400, detail="Either file or file_base64 must be provided")
        
        # Validate file size
        if len(file_content) > MAX_FILE_SIZE:
            raise HTTPException(status_code=400, detail=f"File too large. Max size: {MAX_FILE_SIZE / 1024 / 1024} MB")
        
        # Parse connection (can be JSON string or dict)
        try:
            if isinstance(connection, str):
                conn_params = DatabaseConnection(**json.loads(connection))
            else:
                conn_params = DatabaseConnection(**connection)
        except Exception as conn_error:
            raise HTTPException(status_code=400, detail=f"Invalid connection parameters: {str(conn_error)}")
        
        # Detect file type
        try:
            file_type = detect_file_type(file_name)
        except Exception as type_error:
            raise HTTPException(status_code=400, detail=f"Failed to detect file type: {str(type_error)}")
        
        # Get parsing parameters from request (if provided)
        parsing_params = {}
        if "application/json" in content_type:
            # body was already parsed above
            parsing_params = {
                'encoding': body.get('encoding'),
                'delimiter': body.get('delimiter'),
                'header_row': body.get('header_row'),  # None = auto-detect, -1 = no headers, 0+ = row index
                'skip_rows': body.get('skip_rows')
            }
        else:
            # FormData was already parsed above
            parsing_params = {
                'encoding': form.get('encoding'),
                'delimiter': form.get('delimiter'),
                'header_row': int(form.get('header_row')) if form.get('header_row') else None,
                'skip_rows': int(form.get('skip_rows')) if form.get('skip_rows') else None
            }
        
        # Parse file with parameters (auto-detect if not provided)
        # Limit to 10000 rows for preview
        try:
            df = parse_file(
                file_content, 
                file_type,
                encoding=parsing_params.get('encoding'),
                delimiter=parsing_params.get('delimiter'),
                header_row=parsing_params.get('header_row'),
                skip_rows=parsing_params.get('skip_rows'),
                limit_rows=10000  # Limit for preview only
            )
        except Exception as parse_error:
            raise HTTPException(status_code=400, detail=f"Failed to parse file: {str(parse_error)}")
        
        # Get first 10 rows for preview display
        preview_df = df.head(10)
        
        # Get first 1000 rows for type detection (more accurate type inference)
        type_detection_df = df.head(1000)
        
        # Convert to dict for JSON response
        # Replace NaN, Infinity, and -Infinity with None to make it JSON-compliant
        import numpy as np
        import pandas as pd
        
        # Replace infinity values with None
        preview_df_clean = preview_df.replace([np.inf, -np.inf], None)
        # Replace NaN values with None
        preview_df_clean = preview_df_clean.where(pd.notnull(preview_df_clean), None)
        
        # Additional cleanup: ensure all values are JSON-serializable
        def clean_value(val):
            if val is None:
                return None
            # Check for pandas NaN
            if pd.isna(val):
                return None
            # Check for numpy infinity or NaN
            if isinstance(val, (float, np.floating)):
                if np.isinf(val) or np.isnan(val):
                    return None
            # Check for Decimal (convert to float)
            if isinstance(val, Decimal):
                return float(val)
            # Check for date/datetime (convert to string)
            if isinstance(val, (date, datetime)):
                return val.isoformat()
            return val
        
        # Convert preview to dict and clean values (for display - only 10 rows)
        preview_data_raw = preview_df_clean.to_dict(orient='records')
        preview_data = [
            {k: clean_value(v) for k, v in record.items()}
            for record in preview_data_raw
        ]
        
        # Convert type detection data to dict (for type inference - up to 1000 rows)
        type_detection_df_clean = type_detection_df.replace([np.inf, -np.inf], None)
        type_detection_df_clean = type_detection_df_clean.where(pd.notnull(type_detection_df_clean), None)
        type_detection_data_raw = type_detection_df_clean.to_dict(orient='records')
        type_detection_data = [
            {k: clean_value(v) for k, v in record.items()}
            for record in type_detection_data_raw
        ]
        
        # Get column names
        csv_columns = list(df.columns)
        
        # Auto-detect parsing settings for response (so frontend can show what was detected)
        detected_settings = {}
        if file_type == 'csv':
            detected_enc = parsing_params.get('encoding') or detect_encoding(file_content)
            detected_delim = parsing_params.get('delimiter') or detect_delimiter(file_content, detected_enc)
            detected_header = parsing_params.get('header_row') if parsing_params.get('header_row') is not None else detect_header_row(file_content, file_type, detected_delim, detected_enc)
            detected_settings = {
                'encoding': detected_enc,
                'delimiter': detected_delim,
                'header_row': detected_header
            }
        elif file_type == 'sql':
            # For SQL files, encoding can be specified but delimiter and header_row don't apply
            detected_enc = parsing_params.get('encoding') or 'utf-8'
            detected_settings = {
                'encoding': detected_enc
            }
        elif file_type in ['xlsx', 'xls']:
            # For Excel files, only detect header row (encoding and delimiter don't apply)
            detected_header = parsing_params.get('header_row') if parsing_params.get('header_row') is not None else detect_header_row(file_content, file_type)
            detected_settings = {
                'header_row': detected_header
            }
        
        return {
            "filename": file_name,
            "file_type": file_type,
            "total_rows": len(df),
            "columns": csv_columns,
            "preview": preview_data,  # First 10 rows for display
            "sample_data": preview_data,
            "type_detection_data": type_detection_data,  # First 1000 rows for type detection
            "detected_settings": detected_settings  # Show what was auto-detected
        }
    
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error previewing file: {str(e)}")

@app.post("/upload/import")
async def import_file(
    request: Request,
    _: bool = Depends(verify_token)
):
    """Import CSV/Excel file into database table."""
    try:
        # Get content type to determine if it's JSON or FormData
        content_type = request.headers.get("content-type", "")
        
        # Handle both FormData (file) and JSON (file_base64)
        file_content: bytes
        file_name: str
        connection: Optional[str] = None
        table_name: Optional[str] = None
        schema_name: Optional[str] = None
        mapping: Optional[str] = None
        
        if "application/json" in content_type:
            # JSON request (from Edge Function)
            body = await request.json()
            
            connection = body.get("connection")
            table_name = body.get("table_name")
            schema_name = body.get("schema")
            mapping = body.get("mapping")
            file_base64 = body.get("file_base64")
            storage_path = body.get("storage_path")  # Path to file in Supabase Storage
            filename = body.get("filename")
            file_columns = body.get("file_columns")  # File columns with user-modified types
            duplicate_handling = body.get("duplicate_handling", "error")  # How to handle duplicates: 'error', 'skip', or 'update'
            
            if file_base64 and filename:
                import base64
                file_content = base64.b64decode(file_base64)
                file_name = filename
            else:
                raise HTTPException(status_code=400, detail="Either file or file_base64 must be provided")
        else:
            # FormData request (direct upload)
            form = await request.form()
            file = form.get("file")
            connection = form.get("connection")
            table_name = form.get("table_name")
            schema_name = form.get("schema")
            mapping = form.get("mapping")
            file_columns = form.get("file_columns")  # Get file_columns from form
            duplicate_handling = form.get("duplicate_handling", "error")  # How to handle duplicates
            
            if file and hasattr(file, "file"):
                file_content = await file.read()
                file_name = file.filename
            else:
                raise HTTPException(status_code=400, detail="Either file or file_base64 must be provided")
        
        # Validate file size
        if len(file_content) > MAX_FILE_SIZE:
            raise HTTPException(status_code=400, detail=f"File too large. Max size: {MAX_FILE_SIZE / 1024 / 1024} MB")
        
        if not connection or not table_name or not mapping:
            raise HTTPException(status_code=400, detail="connection, table_name, and mapping are required")
        
        # Parse connection (can be JSON string or dict)
        try:
            if isinstance(connection, str):
                conn_params = DatabaseConnection(**json.loads(connection))
            else:
                conn_params = DatabaseConnection(**connection)
        except Exception as conn_error:
            raise HTTPException(status_code=400, detail=f"Invalid connection parameters: {str(conn_error)}")
        
        # For local agent connections, file import is not yet supported
        if conn_params.connection_method == "local":
            raise HTTPException(status_code=400, detail="File import is not yet supported for local agent connections")
        
        # Create database connection
        conn, engine = _connect_from_params(conn_params)
        
        try:
            # Detect file type
            file_type = detect_file_type(file_name)
            
            # Get parsing parameters from request (if provided)
            parsing_params = {}
            if "application/json" in content_type:
                # body was already parsed above
                parsing_params = {
                    'encoding': body.get('encoding'),
                    'delimiter': body.get('delimiter'),
                    'header_row': body.get('header_row'),
                    'skip_rows': body.get('skip_rows')
                }
            else:
                # FormData was already parsed above
                parsing_params = {
                    'encoding': form.get('encoding'),
                    'delimiter': form.get('delimiter'),
                    'header_row': int(form.get('header_row')) if form.get('header_row') else None,
                    'skip_rows': int(form.get('skip_rows')) if form.get('skip_rows') else None
                }
            
        # Parse file with parameters (auto-detect if not provided)
            # No limit for import - read all rows
            df = parse_file(
                file_content, 
                file_type,
                encoding=parsing_params.get('encoding'),
                delimiter=parsing_params.get('delimiter'),
                header_row=parsing_params.get('header_row'),
                skip_rows=parsing_params.get('skip_rows'),
                limit_rows=None  # No limit for import - read all rows
            )
            
            # Parse file_columns (with user-modified types) and convert data types
            if file_columns:
                try:
                    from feature_import import convert_column_type
                    file_cols = json.loads(file_columns) if isinstance(file_columns, str) else file_columns

                    # Convert DataFrame columns based on user-specified types
                    for col_info in file_cols:
                        col_name = col_info.get('name')
                        col_type = col_info.get('type', 'TEXT')
                        if col_name in df.columns:
                            try:
                                df[col_name] = convert_column_type(df[col_name], col_type)
                            except Exception as conv_error:
                                logger.warning(
                                    "Could not convert column '%s' to type %s: %s – keeping original dtype",
                                    col_name, col_type, conv_error
                                )
                except Exception as file_cols_error:
                    logger.warning("Could not parse file_columns for type conversion: %s", file_cols_error)
            
            # Parse mapping
            column_mapping = json.loads(mapping) if isinstance(mapping, str) else mapping
            
            # Get table columns for validation
            try:
                db_columns = get_table_columns(conn, engine, table_name, schema_name)
            except Exception as col_error:
                raise HTTPException(status_code=500, detail=f"Failed to get table columns: {str(col_error)}")
            
            # Validate mapping
            db_column_names = [col['name'] for col in db_columns]
            for db_col in column_mapping.values():
                if db_col not in db_column_names:
                    raise HTTPException(status_code=400, detail=f"Column '{db_col}' not found in table")
            
            # Check for NOT NULL columns without defaults that aren't mapped
            # We'll automatically fill them with default values instead of failing
            is_valid, missing_required = validate_required_columns(column_mapping, db_columns)
            if not is_valid:
                missing_str = ', '.join(missing_required)
                # Don't raise an error - we'll handle it in import_data
            
            # Validate data types (warnings only)
            try:
                warnings = validate_data_types(df, column_mapping, db_columns)
            except Exception as validation_error:
                warnings = []
            
            # Import data
            try:
                # Ensure duplicate_handling is a valid string
                if duplicate_handling not in ['error', 'skip', 'update']:
                    duplicate_handling = 'error'
                result = import_data(conn, engine, table_name, schema_name, df, column_mapping, db_columns, duplicate_handling=str(duplicate_handling))
            except Exception as import_error:
                raise HTTPException(status_code=500, detail=f"Failed to import data: {str(import_error)}")
            
            # Combine warnings from data type validation and default value usage
            all_warnings = warnings.copy()
            if result.get("default_value_warnings"):
                all_warnings.extend(result["default_value_warnings"])
            
            return {
                "success": result["rows_imported"] > 0,  # Only true if at least one row imported
                "rows_imported": result["rows_imported"],
                "rows_failed": result["rows_failed"],
                "total_rows": result["total_rows"],
                "warnings": all_warnings,
                "errors": result["errors"],
                "error_summary": result.get("error_summary")  # Include error summary for display
            }
        
        finally:
            conn.close()
    
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error importing file: {str(e)}")

@app.post("/upload/mapping")
async def get_mapping_suggestions(
    connection: Optional[str] = Body(None),  # JSON string or dict
    table_name: Optional[str] = Body(None),
    schema_name: Optional[str] = Body(None, alias="schema"),  # Use alias to avoid shadowing
    csv_columns: Optional[str] = Body(None),  # JSON array
    _: bool = Depends(verify_token)
):
    """Get suggested column mapping between CSV and database table."""
    try:
        if not connection or not table_name or not csv_columns:
            raise HTTPException(status_code=400, detail="connection, table_name, and csv_columns are required")
        
        # Parse connection (can be JSON string or dict)
        try:
            if isinstance(connection, str):
                conn_params = DatabaseConnection(**json.loads(connection))
            else:
                conn_params = DatabaseConnection(**connection)
        except Exception as conn_error:
            raise HTTPException(status_code=400, detail=f"Invalid connection parameters: {str(conn_error)}")
        
        # For local agent connections, mapping suggestion is not yet supported
        if conn_params.connection_method == "local":
            raise HTTPException(status_code=400, detail="Mapping suggestion is not yet supported for local agent connections")
        
        # Create database connection
        try:
            conn, engine = _connect_from_params(conn_params)
        except Exception as conn_error:
            raise HTTPException(status_code=500, detail=f"Failed to connect to database: {str(conn_error)}")
        
        try:
            # Get table columns
            db_columns = get_table_columns(conn, engine, table_name, schema_name)
            
            # Parse CSV columns
            try:
                csv_cols = json.loads(csv_columns) if isinstance(csv_columns, str) else csv_columns
            except Exception as parse_error:
                raise HTTPException(status_code=400, detail=f"Invalid CSV columns format: {str(parse_error)}")
            
            # Create simple mapping
            mapping = create_simple_mapping(csv_cols, db_columns)
            
            return {
                "mapping": mapping,
                "db_columns": [col['name'] for col in db_columns],
                "db_columns_with_types": [
                    {
                        "name": col['name'],
                        "type": col['type'],
                        "nullable": col.get('nullable', True)
                    }
                    for col in db_columns
                ],
                "csv_columns": csv_cols
            }
        
        finally:
            conn.close()
    
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        error_trace = traceback.format_exc()
        raise HTTPException(status_code=500, detail=f"Error getting mapping: {str(e)}")

@app.post("/query")
async def execute_query_endpoint(
    request: Request,
    _: bool = Depends(verify_token)
):
    """Execute a raw SQL query and return results. Supports session_id for storing results."""
    try:
        body = await request.json()
        conn = None
        use_session = False
        
        # Get connection, query, and optional session_id from body
        connection = body.get("connection")
        query = body.get("query")
        session_id = body.get("session_id")
        
        if not query:
            raise HTTPException(status_code=400, detail="query is required")
        
        # Check if this is a local agent connection
        is_local_agent = False
        local_agent_conn = None
        connection_code = None
        
        # If session_id is provided, use session connection; otherwise use connection from body
        if session_id:
            try:
                conn, engine = get_connection(session_id)
                # Check if this is a local agent connection
                if hasattr(conn, 'is_local_agent') and conn.is_local_agent:
                    is_local_agent = True
                    local_agent_conn = conn
                    connection_code = conn.connection_code
                    logger.info(f"Using local agent connection from session {session_id}, connection_code: {connection_code}")
                use_session = True
            except ValueError:
                # Session not found, fall back to connection from body
                if not connection:
                    raise HTTPException(status_code=400, detail="session_id invalid and connection not provided")
                conn_params = DatabaseConnection(**json.loads(connection)) if isinstance(connection, str) else DatabaseConnection(**connection)
                # For local agent connections, query execution goes through agent
                if conn_params.connection_method == "local":
                    is_local_agent = True
                    connection_code = conn_params.connection_code
                    logger.info(f"Using local agent connection from body, connection_code: {connection_code}")
                else:
                    conn, engine = _connect_from_params(conn_params)
                use_session = False
        else:
            if not connection:
                raise HTTPException(status_code=400, detail="connection or session_id is required")
            # Parse connection (can be JSON string or dict)
            if isinstance(connection, str):
                conn_params = DatabaseConnection(**json.loads(connection))
            else:
                conn_params = DatabaseConnection(**connection)
            # For local agent connections, query execution goes through agent
            if conn_params.connection_method == "local":
                is_local_agent = True
                connection_code = conn_params.connection_code
            else:
                conn, engine = _connect_from_params(conn_params)
            use_session = False
        
        # Handle local agent connections
        if is_local_agent:
            if not connection_code:
                raise HTTPException(status_code=400, detail="Connection code is required for local agent connections")
            
            from local_agent_manager import agent_manager

            # Check if agent is connected
            agent = agent_manager.get_agent(connection_code)
            if not agent or agent.status != AgentStatus.CONNECTED:
                logger.error(f"Agent not connected for connection_code: {connection_code}")
                raise HTTPException(status_code=400, detail="Agent is not connected. Please ensure the local agent is running and connected.")
            
            # Create job and send directly to agent (like chat endpoint does)
            job = agent_manager.create_job(connection_code, query)
            logger.info(f"Created job {job.job_id} for query: {query[:100]}...")
            
            # Send job directly to agent via await (already in async context on main loop)
            sent = await agent_manager.send_job_to_agent(connection_code, job)
            
            if not sent:
                logger.error(f"Failed to send job {job.job_id} to agent {connection_code}")
                raise HTTPException(status_code=500, detail="Failed to send query to agent. Please ensure the agent is connected.")
            
            logger.info(f"Job {job.job_id} sent to agent, waiting for result...")
            # Small delay to allow WebSocket handler to process the job
            await asyncio.sleep(0.2)
            # Wait for result
            start_time = time.time()
            max_wait = 60
            last_status = None
            poll_count = 0
            logger.info(f"Waiting for job {job.job_id} to complete...")
            while time.time() - start_time < max_wait:
                # Check if agent is still connected
                agent = agent_manager.get_agent(connection_code)
                if not agent or agent.status != AgentStatus.CONNECTED:
                    logger.error(f"Agent {connection_code} disconnected while waiting for job {job.job_id}")
                    raise HTTPException(status_code=500, detail="Agent connection lost during query execution. Please try again.")
                
                result = agent_manager.get_job(job.job_id)
                poll_count += 1
                if result:
                    last_status = result.status
                    # Log every 10 polls or when status changes
                    if poll_count % 10 == 0 or result.status in ["completed", "failed"]:
                        logger.info(f"Job {job.job_id} poll #{poll_count}: status={result.status}, has_result={result.result is not None}, has_error={result.error is not None}, result_type={type(result.result).__name__ if result.result else 'None'}")
                    
                    if result.status == "completed":
                        execution_time = (time.time() - start_time) * 1000
                        logger.info(f"Job {job.job_id} completed! Processing result...")
                        
                        if result.error:
                            logger.error(f"Job {job.job_id} completed with error: {result.error}")
                            raise HTTPException(status_code=500, detail=f"Query execution failed: {result.error}")
                        
                        if result.result:
                            # Handle both dict and other result types
                            if isinstance(result.result, dict):
                                if not result.result.get("success"):
                                    error_detail = f"Query execution failed: {result.result.get('error', 'Unknown error')}"
                                    logger.error(f"Job {job.job_id} completed but result indicates failure: {result.result}")
                                    raise HTTPException(status_code=500, detail=error_detail)
                                agent_result = result.result
                                logger.info(f"Job {job.job_id} result: success=True, columns={len(agent_result.get('columns', []))}, rows={len(agent_result.get('results', []))}")
                            else:
                                # Unexpected result type
                                logger.error(f"Job {job.job_id} completed with unexpected result type: {type(result.result)}, value: {result.result}")
                                raise HTTPException(status_code=500, detail="Query execution failed: Invalid result format from agent")
                            
                            rows_data = agent_result.get("results", [])
                            columns = agent_result.get("columns", [])
                            row_count = agent_result.get("row_count", len(rows_data))
                            
                            response = {
                                "success": True,
                                "sql": query,
                                "results": rows_data,
                                "columns": columns,
                                "row_count": row_count,
                                "execution_time_ms": round(execution_time, 2)
                            }
                            
                            logger.info(f"Job {job.job_id} returning response with {len(rows_data)} rows")
                            
                            # Store result if session_id is provided
                            if session_id and use_session:
                                try:
                                    store_query_result(session_id, {
                                        "sql": query,
                                        "data": rows_data,
                                        "columns": columns,
                                        "timestamp": datetime.now().isoformat(),
                                        "row_count": row_count,
                                        "execution_time_ms": round(execution_time, 2),
                                        "truncated": False
                                    })
                                except Exception:
                                    pass
                            
                            return response
                        else:
                            # Provide more detailed error information
                            error_detail = "Query execution failed: No result received from agent"
                            logger.error(f"Job {job.job_id} completed but result is None. Error: {result.error}")
                            raise HTTPException(status_code=500, detail=error_detail)
                    elif result.status == "failed":
                        execution_time = (time.time() - start_time) * 1000
                        logger.error(f"Job {job.job_id} failed: {result.error}")
                        raise HTTPException(status_code=500, detail=f"Query execution failed: {result.error or 'Unknown error'}")
                else:
                    # Job not found - log this for debugging
                    elapsed = time.time() - start_time
                    if elapsed > 5 and int(elapsed) % 10 == 0:  # Log every 10 seconds
                        logger.warning(f"Job {job.job_id} not found in agent_manager after {elapsed:.1f}s (poll #{poll_count})")
                await asyncio.sleep(0.1)  # Reduced sleep time for faster response
            
            # Final check before timeout
            final_result = agent_manager.get_job(job.job_id)
            if final_result:
                logger.error(f"Job {job.job_id} TIMEOUT - final status: {final_result.status}, has_result: {final_result.result is not None}, has_error: {final_result.error is not None}, result_type: {type(final_result.result).__name__ if final_result.result else 'None'}")
                if final_result.result:
                    logger.error(f"Job {job.job_id} result content: {str(final_result.result)[:500]}")
            else:
                logger.error(f"Job {job.job_id} not found in agent_manager at timeout (after {poll_count} polls)")
            raise HTTPException(status_code=500, detail=f"Timeout waiting for agent response (last status: {last_status or 'unknown'}, polls: {poll_count})")
        
        try:
            cursor = conn.cursor()
            start_time = time.time()
            cursor.execute(query)
            execution_time = (time.time() - start_time) * 1000

            # Check if this is a SELECT query (has results)
            if cursor.description:
                # Fetch results for SELECT queries
                columns = [desc[0] for desc in cursor.description]
                rows = cursor.fetchall()
                
                # Convert rows to dictionaries
                results = []
                for row in rows:
                    row_dict = {}
                    for i, col in enumerate(columns):
                        row_dict[col] = _normalize_value(row[i])
                    results.append(row_dict)
                
                response = {
                    "success": True,
                    "sql": query,
                    "results": results,
                    "columns": columns,
                    "row_count": len(results),
                    "execution_time_ms": round(execution_time, 2)
                }
                
                # Store result if session_id is provided
                if session_id and use_session:
                    try:
                        store_query_result(session_id, {
                            "sql": query,
                            "data": results,
                            "columns": columns,
                            "timestamp": datetime.now().isoformat(),
                            "row_count": len(results),
                            "execution_time_ms": round(execution_time, 2)
                        })
                    except Exception:
                        pass  # Don't fail if storing result fails
                
                return response
            else:
                # Commit the transaction for DDL/DML statements (DROP, DELETE, UPDATE, etc.)
                if hasattr(conn, 'commit'):
                    conn.commit()

                # DDL/DML statement (DROP, DELETE, UPDATE, INSERT, etc.) - no results
                # Get rowcount if available
                rowcount = getattr(cursor, 'rowcount', None)
                
                response = {
                    "success": True,
                    "sql": query,
                    "results": [],
                    "columns": [],
                    "row_count": 0,
                    "message": "Query executed successfully",
                    "rowcount": rowcount,
                    "execution_time_ms": round(execution_time, 2)
                }
                
                # Store result if session_id is provided (even for DDL/DML)
                if session_id and use_session:
                    try:
                        store_query_result(session_id, {
                            "sql": query,
                            "data": [],
                            "columns": [],
                            "timestamp": datetime.now().isoformat(),
                            "row_count": 0,
                            "message": "Query executed successfully",
                            "rowcount": rowcount,
                            "execution_time_ms": round(execution_time, 2)
                        })
                    except Exception:
                        pass  # Don't fail if storing result fails
                
                return response
        
        finally:
            try:
                if 'cursor' in locals():
                    cursor.close()
            except Exception:
                pass
            try:
                if conn is not None:
                    conn.close()
            except Exception:
                pass
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error executing query: {str(e)}")


@app.get("/session/{session_id}/query-results")
def get_session_query_results(session_id: str, limit: int = Query(50, ge=1, le=100)):
    """Get query results for a session."""
    try:
        results = get_query_results(session_id, limit)
        return {
            "success": True,
            "results": results,
            "count": len(results)
        }
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.post("/upload/create-table")
async def create_table(
    connection: Optional[str] = Body(None),  # JSON string or dict
    table_name: Optional[str] = Body(None),
    schema_name: Optional[str] = Body(None, alias="schema"),  # Use alias to avoid shadowing
    columns: Optional[List[Dict[str, Any]]] = Body(None),  # [{"name": "col1", "type": "TEXT", ...}, ...]
    _: bool = Depends(verify_token)
):
    """Create a new table with specified columns."""
    try:
        if not connection or not table_name or not columns:
            raise HTTPException(status_code=400, detail="connection, table_name, and columns are required")
        
        # Parse connection (can be JSON string or dict)
        if isinstance(connection, str):
            conn_params = DatabaseConnection(**json.loads(connection))
        else:
            conn_params = DatabaseConnection(**connection)
        
        # For local agent connections, table creation is not yet supported
        if conn_params.connection_method == "local":
            raise HTTPException(status_code=400, detail="Table creation is not yet supported for local agent connections")
        
        # Create database connection
        conn, engine = _connect_from_params(conn_params)
        
        try:
            # Create table
            create_table_from_columns(conn, engine, table_name, schema_name, columns)
            
            return {
                "success": True,
                "message": f"Table '{table_name}' created successfully"
            }
        
        finally:
            conn.close()
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error creating table: {str(e)}")

# ============================================================================
# Local Agent Endpoints (for local database connections)
# ============================================================================

@app.on_event("startup")
async def startup_event():
    """Start cleanup task on startup and capture the main event loop."""
    agent_manager.set_main_loop(asyncio.get_running_loop())
    agent_manager.start_cleanup_task()

@app.websocket("/ws/agent/{connection_code}")
async def websocket_agent(websocket: WebSocket, connection_code: str):
    """WebSocket endpoint for local agent connections."""
    await websocket.accept()
    
    # Check if connection code exists or create new agent
    agent = agent_manager.get_agent(connection_code)
    if not agent:
        # New connection - register agent
        agent = agent_manager.register_agent(connection_code, websocket)
    else:
        # Reconnection - update websocket
        agent.websocket = websocket
        agent.status = AgentStatus.CONNECTED
        agent.last_heartbeat = datetime.now()
    
    logger.info(f"Agent connected via WebSocket: {connection_code}")
    
    try:
        # Send pending jobs immediately
        pending_jobs = agent_manager.get_pending_jobs(connection_code)
        for job in pending_jobs:
            try:
                await agent_manager.send_job_to_agent(connection_code, job)
            except Exception as e:
                logger.error(f"Failed to send pending job {job.job_id} to agent: {e}")
        
        # Listen for messages from agent
        while True:
            try:
                # Process pending jobs before waiting for next message
                pending_jobs = agent_manager.get_pending_jobs(connection_code)
                for job in pending_jobs:
                    try:
                        await agent_manager.send_job_to_agent(connection_code, job)
                    except Exception as e:
                        logger.error(f"Failed to send pending job {job.job_id} to agent: {e}")
                
                # Use shorter timeout to allow processing pending jobs more frequently
                # If no message received, we'll process pending jobs again in the next iteration
                try:
                    data = await asyncio.wait_for(websocket.receive_json(), timeout=0.5)
                    msg_type = data.get("type")
                    logger.info(f"Received message from agent {connection_code}: type={msg_type}")
                except asyncio.TimeoutError:
                    # Timeout - check if agent is still alive and continue loop
                    # This allows us to process new jobs even when agent is idle
                    if agent.last_heartbeat:
                        time_since_heartbeat = (datetime.now() - agent.last_heartbeat).total_seconds()
                        if time_since_heartbeat > 120:  # 2 minutes without heartbeat
                            logger.warning(f"Agent {connection_code} timeout - no heartbeat for {time_since_heartbeat}s")
                            break
                    continue
                
                if msg_type == "heartbeat":
                    # Update heartbeat
                    agent_manager.update_heartbeat(connection_code)
                    # Send acknowledgment
                    try:
                        await websocket.send_json({"type": "heartbeat_ack"})
                    except Exception as e:
                        err = str(e).lower()
                        if "closed" in err or "disconnect" in err or "close message" in err or "not connected" in err or "accept" in err:
                            logger.debug(f"Connection closed during heartbeat_ack: {e}")
                            break
                        logger.error(f"Failed to send heartbeat_ack: {e}")
                
                elif msg_type == "job_result":
                    # Agent completed a job
                    job_id = data.get("job_id")
                    result = data.get("result")
                    error = data.get("error")
                    
                    logger.info(f"Received job_result for job {job_id}: result={result is not None}, error={error}, result_type={type(result).__name__ if result else 'None'}")
                    if job_id:
                        # Verify job exists before completing
                        job = agent_manager.get_job(job_id)
                        if job:
                            old_status = job.status
                            agent_manager.complete_job(job_id, result=result, error=error)
                            # Verify status was updated
                            updated_job = agent_manager.get_job(job_id)
                            logger.info(f"Job {job_id} marked as completed: {old_status} -> {updated_job.status if updated_job else 'NOT_FOUND'}")
                        else:
                            logger.warning(f"Job {job_id} not found when trying to complete")
                    else:
                        logger.error("Received job_result without job_id")
                    try:
                        await websocket.send_json({"type": "job_ack", "job_id": job_id})
                    except Exception as e:
                        err = str(e).lower()
                        if "closed" in err or "disconnect" in err or "close message" in err or "not connected" in err or "accept" in err:
                            break
                        logger.error(f"Failed to send job_ack: {e}")
                
                elif msg_type == "agent_info":
                    # Agent sends database info
                    db_type = data.get("db_type")
                    db_name = data.get("db_name")
                    user_id = data.get("user_id")
                    
                    agent.db_type = db_type
                    agent.db_name = db_name
                    agent.user_id = user_id
                    agent_manager.agents[connection_code] = agent
                    
                    try:
                        await websocket.send_json({"type": "info_ack"})
                    except Exception as e:
                        err = str(e).lower()
                        if "closed" in err or "disconnect" in err or "close message" in err or "not connected" in err or "accept" in err:
                            break
                        logger.error(f"Failed to send info_ack: {e}")
                
                elif msg_type == "request_jobs":
                    # Agent requests pending jobs
                    pending_jobs = agent_manager.get_pending_jobs(connection_code)
                    for job in pending_jobs:
                        try:
                            await agent_manager.send_job_to_agent(connection_code, job)
                        except Exception as e:
                            logger.error(f"Failed to send requested job {job.job_id}: {e}")
                
            except WebSocketDisconnect:
                break
            except Exception as e:
                err = str(e).lower()
                if "not connected" in err or "accept" in err or "closed" in err:
                    logger.debug(f"Agent connection closed during processing: {e}")
                else:
                    logger.error(f"Error processing agent message: {e}")
                # Do not try to send error reply - connection may be closed
                break
    
    except WebSocketDisconnect:
        logger.info(f"Agent disconnected: {connection_code}")
        agent_manager.disconnect_agent(connection_code)
    except Exception as e:
        logger.error(f"WebSocket error for agent {connection_code}: {e}")
        agent_manager.disconnect_agent(connection_code)

@app.post("/api/local-agent/generate-code")
async def generate_connection_code(_: bool = Depends(verify_token)):
    """Generate a new connection code for a local agent."""
    code = agent_manager.generate_connection_code()
    backend_host = os.getenv("BACKEND_HOST", "localhost:8000")
    # Use wss:// for production (HTTPS), ws:// for development
    ws_protocol = "wss://" if os.getenv("ENVIRONMENT") == "production" else "ws://"
    return {
        "connection_code": code,
        "websocket_url": f"{ws_protocol}{backend_host}/ws/agent/{code}"
    }

@app.get("/api/local-agent/status/{connection_code}")
async def get_agent_status(connection_code: str, _: bool = Depends(verify_token)):
    """Get status of an agent by connection code."""
    agent = agent_manager.get_agent(connection_code)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    
    return {
        "connection_code": agent.connection_code,
        "status": agent.status.value,
        "last_heartbeat": agent.last_heartbeat.isoformat() if agent.last_heartbeat else None,
        "db_type": agent.db_type,
        "db_name": agent.db_name,
        "user_id": agent.user_id,
        "created_at": agent.created_at.isoformat()
    }

@app.post("/api/local-agent/job")
async def create_local_job(
    connection_code: str = Body(..., embed=True),
    sql: str = Body(..., embed=True),
    _: bool = Depends(verify_token)
):
    """Create a new SQL job for a local agent."""
    # Check if agent exists
    agent = agent_manager.get_agent(connection_code)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found or not connected")
    
    if agent.status != AgentStatus.CONNECTED:
        raise HTTPException(status_code=400, detail=f"Agent is not connected (status: {agent.status.value})")
    
    # Create job
    job = agent_manager.create_job(connection_code, sql)
    
    # Try to send job immediately
    sent = await agent_manager.send_job_to_agent(connection_code, job)
    
    return {
        "job_id": job.job_id,
        "status": job.status,
        "sent": sent
    }

@app.get("/api/local-agent/job/{job_id}")
async def get_job_status(job_id: str, _: bool = Depends(verify_token)):
    """Get status of a job."""
    job = agent_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    return {
        "job_id": job.job_id,
        "connection_code": job.connection_code,
        "sql": job.sql,
        "status": job.status,
        "result": job.result,
        "error": job.error,
        "created_at": job.created_at.isoformat(),
        "completed_at": job.completed_at.isoformat() if job.completed_at else None
    }

# ── Agent download proxy ──────────────────────────────────────────────────────
# Routes traffic through the backend so Supabase Storage URLs are never
# exposed to the browser. The user only ever sees the Railway domain.

_AGENT_FILES: dict[str, str] = {
    "windows": "SQLSphere-Agent-Windows-Setup.exe",
    "mac":     "SQLSphere-Agent-Mac.dmg",
    "linux":   "SQLSphere-Agent-Linux",
}

@app.get("/api/download/{platform}")
async def download_agent(platform: str):
    """Stream the agent binary directly. Supabase is never visible to the client.

    The response comes from this domain (Railway / custom domain), so the
    browser's download prompt shows sqlsphere.com (or whatever domain points here),
    not Supabase.
    """
    if LOCAL_MODE:
        raise HTTPException(
            status_code=503,
            detail="Agent download is not available in LOCAL_MODE demo. The Local Agent UI is shown for architecture reference only.",
        )

    filename = _AGENT_FILES.get(platform.lower())
    if not filename:
        raise HTTPException(status_code=404, detail=f"Unknown platform '{platform}'. Use: windows, mac, linux")

    supabase_url = os.getenv("SUPABASE_URL", "")
    if not supabase_url:
        raise HTTPException(status_code=500, detail="SUPABASE_URL not configured")
    storage_url  = f"{supabase_url}/storage/v1/object/public/agent-downloads/{filename}"

    import httpx
    from fastapi.responses import StreamingResponse

    client = httpx.AsyncClient(timeout=120.0, follow_redirects=True)
    req = client.stream("GET", storage_url)

    async def _stream_and_close():
        async with req as response:
            if response.status_code != 200:
                raise HTTPException(status_code=502, detail="Binary not yet available in storage")
            async for chunk in response.aiter_bytes(chunk_size=512 * 1024):
                yield chunk
        await client.aclose()

    return StreamingResponse(
        _stream_and_close(),
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── LOCAL_MODE routes ────────────────────────────────────────────────────────

if LOCAL_MODE:
    from feature_local_mode import register_local_mode_routes
    register_local_mode_routes(app)


# ── Scheduler lifecycle ──────────────────────────────────────────────────────

@app.on_event("startup")
async def startup_event():
    if LOCAL_MODE:
        logger.info("LOCAL_MODE active: skipping APScheduler (schedules / alerts disabled).")
        return
    await start_scheduler()

@app.on_event("shutdown")
async def shutdown_event():
    if LOCAL_MODE:
        return
    await stop_scheduler()

# ── Scheduled Queries Routes ────────────────────────────────────────────────

@app.post("/api/schedules/generate-sql", dependencies=[Depends(verify_token), Depends(_disable_in_local_mode)])
async def generate_schedule_sql(body: ScheduleGenerateSQLRequest):
    sb = get_service_supabase()
    conn_row = _get_connection_row_with_secret(sb, body.connection_id)
    if (conn_row.get("connection_method") or "").lower() == "local":
        raise HTTPException(status_code=400, detail="Natural-language schedule generation is not yet supported for local agent connections")

    plan = await generate_dashboard_widget(
        DashboardWidgetGenerate(
            user_id=body.user_id,
            connectionId=body.connection_id,
            prompt=body.prompt,
        )
    )

    generated_sql = (plan.get("sql") or "").strip()
    if not generated_sql:
        raise HTTPException(status_code=500, detail="Failed to generate SQL")

    return {
        "sqlText": generated_sql,
        "generatedSql": generated_sql,
        "chartType": plan.get("chart_type") or "auto",
        "title": plan.get("title") or body.prompt,
        "displayReason": plan.get("display_reason") or "",
    }


@app.post("/api/schedules/preview", dependencies=[Depends(verify_token), Depends(_disable_in_local_mode)])
async def preview_schedule(body: SchedulePreviewRequest):
    sb = get_service_supabase()
    conn_row = _get_connection_row_with_secret(sb, body.connection_id)
    if (conn_row.get("connection_method") or "").lower() == "local":
        raise HTTPException(status_code=400, detail="Schedule preview is not yet supported for local agent connections")

    sql_text = (body.sql_text or "").strip()
    safety_error = _validate_schedule_sql_safety(sql_text)
    if safety_error:
        raise HTTPException(status_code=400, detail=safety_error)

    try:
        result = _execute_query_on_connection(conn_row, sql_text, max_rows=body.row_limit)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Query failed: {str(e)}")

    chart_preview = build_report_chart_preview(
        columns=result.get("columns", []) or [],
        rows=result.get("rows", []) or [],
        requested_type=body.chart_type,
    )

    summary_text = generate_report_summary_text(
        schedule_name=body.name or "Report",
        sql_text=sql_text,
        result=result,
        report_description=body.report_description,
    )

    return {
        "success": True,
        "columns": result.get("columns", []) or [],
        "rows": result.get("rows", []) or [],
        "row_count": int(result.get("row_count") or 0),
        "truncated": bool(result.get("truncated")),
        "chart": chart_preview or None,
        "chart_hint": (chart_preview or {}).get("chart_type"),
        "summary_text": summary_text,
    }

@app.post("/api/schedules", dependencies=[Depends(verify_token), Depends(_disable_in_local_mode)])
async def create_schedule(body: ScheduleCreate):
    try:
        sb = get_service_supabase()
        data = body.model_dump(by_alias=False, exclude_none=True)

        conn_row = _get_connection_row_with_secret(sb, data["connection_id"])
        if (conn_row.get("connection_method") or "").lower() == "local":
            raise HTTPException(status_code=400, detail="Scheduled reports are not yet supported for local agent connections")

        data["query_mode"] = str(data.get("query_mode") or "manual").lower()
        sql_final = _resolve_schedule_sql(
            query_mode=data.get("query_mode"),
            sql_text=data.get("sql_text"),
            generated_sql=data.get("generated_sql"),
        )
        data["sql_final"] = sql_final
        data["sql_text"] = sql_final

        data["next_run_at"] = _compute_next_run(data).isoformat()
        result = sb.table("scheduled_queries").insert(data).execute()
        if result.data:
            _add_schedule_job(result.data[0])
        return result.data[0] if result.data else {}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/schedules", dependencies=[Depends(verify_token), Depends(_disable_in_local_mode)])
async def list_schedules(user_id: str = Query(...)):
    try:
        sb = get_service_supabase()
        result = sb.table("scheduled_queries").select("*").eq("user_id", user_id).order("created_at", desc=True).execute()
        return result.data or []
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.put("/api/schedules/{schedule_id}", dependencies=[Depends(verify_token), Depends(_disable_in_local_mode)])
async def update_schedule(schedule_id: str, body: ScheduleUpdate):
    sb = get_service_supabase()
    updates = body.model_dump(by_alias=False, exclude_none=True)
    # Fetch current to compute next_run if schedule params changed
    current = sb.table("scheduled_queries").select("*").eq("id", schedule_id).single().execute()
    if not current.data:
        raise HTTPException(status_code=404, detail="Schedule not found")
    merged = {**current.data, **updates}

    target_connection_id = merged.get("connection_id")
    if target_connection_id:
        conn_row = _get_connection_row_with_secret(sb, target_connection_id)
        target_is_active = updates.get("is_active", merged.get("is_active", True))
        if (conn_row.get("connection_method") or "").lower() == "local" and target_is_active:
            raise HTTPException(status_code=400, detail="Scheduled reports are not yet supported for local agent connections")

    if any(k in updates for k in ("query_mode", "sql_text", "generated_sql")) or not merged.get("sql_final"):
        merged["query_mode"] = str(merged.get("query_mode") or "manual").lower()
        resolved_sql = _resolve_schedule_sql(
            query_mode=merged.get("query_mode"),
            sql_text=merged.get("sql_text"),
            generated_sql=merged.get("generated_sql"),
        )
        updates["query_mode"] = merged["query_mode"]
        updates["sql_final"] = resolved_sql
        updates["sql_text"] = resolved_sql

    if any(k in updates for k in ("schedule_type", "schedule_time", "schedule_day_of_week", "schedule_day_of_month")):
        updates["next_run_at"] = _compute_next_run(merged).isoformat()
    result = sb.table("scheduled_queries").update(updates).eq("id", schedule_id).execute()
    if result.data:
        if result.data[0].get("is_active"):
            _add_schedule_job(result.data[0])
        else:
            remove_job(f"schedule_{schedule_id}")
    return result.data[0] if result.data else {}

@app.delete("/api/schedules/{schedule_id}", dependencies=[Depends(verify_token), Depends(_disable_in_local_mode)])
async def delete_schedule(schedule_id: str):
    sb = get_service_supabase()
    remove_job(f"schedule_{schedule_id}")
    sb.table("scheduled_queries").delete().eq("id", schedule_id).execute()
    return {"ok": True}

@app.post("/api/schedules/{schedule_id}/run-now", dependencies=[Depends(verify_token), Depends(_disable_in_local_mode)])
async def run_schedule_now(schedule_id: str):
    await run_scheduled_query(schedule_id)
    return {"ok": True}

@app.get("/api/schedules/{schedule_id}/runs", dependencies=[Depends(verify_token), Depends(_disable_in_local_mode)])
async def list_schedule_runs(schedule_id: str, limit: int = Query(default=20)):
    sb = get_service_supabase()
    result = sb.table("scheduled_query_runs").select("*").eq("schedule_id", schedule_id).order("started_at", desc=True).limit(limit).execute()
    return result.data or []

# ── Data Alerts Routes ──────────────────────────────────────────────────────

@app.post("/api/alerts/generate-sql", dependencies=[Depends(verify_token), Depends(_disable_in_local_mode)])
async def generate_alert_sql(body: AlertGenerateSQLRequest):
    sb = get_service_supabase()
    conn_row = _get_connection_row_with_secret(sb, body.connection_id)
    if (conn_row.get("connection_method") or "").lower() == "local":
        raise HTTPException(status_code=400, detail="Natural-language alert generation is not yet supported for local agent connections")

    plan = await generate_dashboard_widget(
        DashboardWidgetGenerate(
            user_id=body.user_id,
            connectionId=body.connection_id,
            prompt=body.prompt,
        )
    )

    generated_sql = (plan.get("sql") or "").strip()
    if not generated_sql:
        raise HTTPException(status_code=500, detail="Failed to generate SQL")

    return {
        "sqlText": generated_sql,
        "generatedSql": generated_sql,
        "title": plan.get("title") or body.prompt,
        "displayReason": plan.get("display_reason") or "",
    }


@app.post("/api/alerts/preview", dependencies=[Depends(verify_token), Depends(_disable_in_local_mode)])
async def preview_alert(body: AlertPreviewRequest):
    sb = get_service_supabase()
    conn_row = _get_connection_row_with_secret(sb, body.connection_id)
    if (conn_row.get("connection_method") or "").lower() == "local":
        raise HTTPException(status_code=400, detail="Alert preview is not yet supported for local agent connections")

    sql_text = (body.sql_text or "").strip()
    safety_error = _validate_alert_sql_safety(sql_text)
    if safety_error:
        raise HTTPException(status_code=400, detail=safety_error)

    try:
        result = _execute_query_on_connection(conn_row, sql_text, max_rows=body.row_limit)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Query failed: {str(e)}")

    return {
        "success": True,
        "columns": result.get("columns", []) or [],
        "rows": result.get("rows", []) or [],
        "row_count": int(result.get("row_count") or 0),
        "truncated": bool(result.get("truncated")),
    }

@app.post("/api/alerts", dependencies=[Depends(verify_token), Depends(_disable_in_local_mode)])
async def create_alert(body: AlertCreate):
    try:
        sb = get_service_supabase()
        data = body.model_dump(by_alias=False, exclude_none=True)

        conn_row = _get_connection_row_with_secret(sb, data["connection_id"])
        if (conn_row.get("connection_method") or "").lower() == "local":
            raise HTTPException(status_code=400, detail="Data alerts are not yet supported for local agent connections")

        data["query_mode"] = str(data.get("query_mode") or "manual").lower()
        sql_final = _resolve_alert_sql(
            query_mode=data.get("query_mode"),
            sql_text=data.get("sql_text"),
            generated_sql=data.get("generated_sql"),
        )
        data["sql_final"] = sql_final
        data["sql_text"] = sql_final

        result = sb.table("data_alerts").insert(data).execute()
        if result.data:
            _add_alert_job(result.data[0])
        return result.data[0] if result.data else {}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/alerts", dependencies=[Depends(verify_token), Depends(_disable_in_local_mode)])
async def list_alerts(user_id: str = Query(...)):
    try:
        sb = get_service_supabase()
        result = sb.table("data_alerts").select("*").eq("user_id", user_id).order("created_at", desc=True).execute()
        return result.data or []
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.put("/api/alerts/{alert_id}", dependencies=[Depends(verify_token), Depends(_disable_in_local_mode)])
async def update_alert(alert_id: str, body: AlertUpdate):
    sb = get_service_supabase()
    updates = body.model_dump(by_alias=False, exclude_none=True)
    current = sb.table("data_alerts").select("*").eq("id", alert_id).single().execute()
    if not current.data:
        raise HTTPException(status_code=404, detail="Alert not found")

    merged = {**current.data, **updates}
    target_connection_id = merged.get("connection_id")
    if target_connection_id:
        conn_row = _get_connection_row_with_secret(sb, target_connection_id)
        target_is_active = updates.get("is_active", merged.get("is_active", True))
        if (conn_row.get("connection_method") or "").lower() == "local" and target_is_active:
            raise HTTPException(status_code=400, detail="Data alerts are not yet supported for local agent connections")

    if any(k in updates for k in ("query_mode", "sql_text", "generated_sql")) or not merged.get("sql_final"):
        merged["query_mode"] = str(merged.get("query_mode") or "manual").lower()
        resolved_sql = _resolve_alert_sql(
            query_mode=merged.get("query_mode"),
            sql_text=merged.get("sql_text"),
            generated_sql=merged.get("generated_sql"),
        )
        updates["query_mode"] = merged["query_mode"]
        updates["sql_final"] = resolved_sql
        updates["sql_text"] = resolved_sql

    result = sb.table("data_alerts").update(updates).eq("id", alert_id).execute()
    if result.data:
        if result.data[0].get("is_active"):
            _add_alert_job(result.data[0])
        else:
            remove_job(f"alert_{alert_id}")
    return result.data[0] if result.data else {}

@app.delete("/api/alerts/{alert_id}", dependencies=[Depends(verify_token), Depends(_disable_in_local_mode)])
async def delete_alert(alert_id: str):
    sb = get_service_supabase()
    remove_job(f"alert_{alert_id}")
    sb.table("data_alerts").delete().eq("id", alert_id).execute()
    return {"ok": True}

# ── Notifications Routes ────────────────────────────────────────────────────

@app.get("/api/notifications", dependencies=[Depends(verify_token), Depends(_disable_in_local_mode)])
async def list_notifications(user_id: str = Query(...), limit: int = Query(default=50)):
    try:
        sb = get_service_supabase()
        result = sb.table("alert_notifications").select("*").eq("user_id", user_id).order("created_at", desc=True).limit(limit).execute()
        return result.data or []
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/notifications/{notification_id}/read", dependencies=[Depends(verify_token), Depends(_disable_in_local_mode)])
async def mark_notification_read(notification_id: str):
    sb = get_service_supabase()
    sb.table("alert_notifications").update({"is_read": True}).eq("id", notification_id).execute()
    return {"ok": True}

@app.post("/api/notifications/read-all", dependencies=[Depends(verify_token), Depends(_disable_in_local_mode)])
async def mark_all_notifications_read(user_id: str = Query(...)):
    sb = get_service_supabase()
    sb.table("alert_notifications").update({"is_read": True}).eq("user_id", user_id).eq("is_read", False).execute()
    return {"ok": True}

# ── Dashboard Widget Routes ─────────────────────────────────────────────────

@app.post("/api/dashboard/generate-widget", dependencies=[Depends(verify_token), Depends(_disable_in_local_mode)])
async def generate_dashboard_widget(body: DashboardWidgetGenerate):
    """Use LLM to generate SQL + widget-analysis from a natural language prompt."""
    sb = get_service_supabase()

    # Get connection info for schema context
    conn_row = sb.table("connections").select("*").eq("id", body.connection_id).single().execute()
    if not conn_row.data:
        raise HTTPException(status_code=404, detail="Connection not found")

    # Decrypt password if needed (required for schema introspection / SQL validation)
    password = conn_row.data.get("password", "")
    if password:
        try:
            dec = sb.rpc("decrypt_credential", {"encrypted": password}).execute()
            if dec.data:
                conn_row.data["password"] = dec.data
        except Exception:
            pass

    db_type = _normalize_db_type(conn_row.data.get("type", "postgresql"))
    is_local_connection = (conn_row.data.get("connection_method") or "").lower() == "local"

    schema_context = "Schema context unavailable."
    allowed_full: set[str] = set()
    allowed_short: set[str] = set()
    allowed_columns: set[str] = set()

    # Load actual schema metadata from the selected connection to ground LLM output.
    try:
        db_conn_model = _build_db_connection_model(conn_row.data)

        if db_conn_model.connection_method == "local":
            local_schema = await _get_schema_via_local_agent(db_conn_model)
            schema_payload = _build_widget_schema_context(
                prompt=body.prompt,
                tables=local_schema.get("tables", []) or [],
                views=local_schema.get("views", []) or [],
                columns=[],
            )
        else:
            schema_conn = None
            try:
                schema_conn, engine = connect_with_params(db_conn_model)
                schema_payload = _build_widget_schema_context(
                    prompt=body.prompt,
                    tables=get_all_tables(schema_conn, engine),
                    views=get_all_views(schema_conn, engine),
                    columns=get_column_info(schema_conn, engine),
                )
            finally:
                if schema_conn:
                    try:
                        schema_conn.close()
                    except Exception:
                        pass

        schema_context = schema_payload["context_text"]
        allowed_full = set(schema_payload["allowed_full"])
        allowed_short = set(schema_payload["allowed_short"])
        allowed_columns = set(schema_payload.get("allowed_columns") or set())
    except Exception as schema_error:
        logger.warning(f"Widget schema context fetch failed for connection {body.connection_id}: {schema_error}")
        raise HTTPException(
            status_code=400,
            detail=f"Failed to load database schema for widget generation: {str(schema_error)}"
        )

    # Generate SQL via LLM and validate against the selected DB schema
    try:
        import openai
        from feature_scheduling import _execute_query_on_connection

        system_msg = f"""
You are a SQL expert for {db_type}.
Generate a dashboard widget plan using ONLY the provided schema context.
Never invent table names or column names.
Respond with exactly one JSON object and no extra text.
Required JSON keys:
- title: string
- chart_type: one of bar|line|area|pie|table
- sql: string (single read-only SELECT/CTE query only)
- required_columns: string[]
- suggested_filters: string[]
- metric_definition: string
- display_reason: string
""".strip()

        user_msg_base = f"""
User request:
{body.prompt}

{schema_context}

Rules:
- Use only tables/views and columns from the schema context above.
- If multiple tables fit, pick the most likely one for the request.
- Keep SQL concise and production-safe.
- IMPORTANT: Use the EXACT column and table names as shown in the schema context, preserving their original casing.
- For PostgreSQL: always double-quote identifiers that contain uppercase letters (e.g. "StockCode", "InvoiceNo"). Unquoted identifiers are folded to lowercase by PostgreSQL and will fail if the actual name has uppercase letters.
- For SQL Server: use square brackets for identifiers with special characters (e.g. [StockCode]).
""".strip()

        def _parse_plan_response(raw_text: str) -> Dict[str, Any]:
            text = (raw_text or "").strip()
            if text.startswith("```"):
                text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
                text = re.sub(r"\s*```$", "", text)

            json_start = text.find("{")
            json_end = text.rfind("}")
            if json_start == -1 or json_end == -1 or json_end <= json_start:
                raise ValueError("LLM response did not contain a JSON object")

            parsed = json.loads(text[json_start:json_end + 1])

            def _to_str_list(value: Any) -> List[str]:
                if isinstance(value, list):
                    return [str(item).strip() for item in value if str(item).strip()]
                if isinstance(value, str) and value.strip():
                    return [value.strip()]
                return []

            chart_type = str(parsed.get("chart_type") or "bar").lower().strip()
            if chart_type not in {"bar", "line", "area", "pie", "table"}:
                chart_type = "bar"

            sql = str(parsed.get("sql") or "").strip()
            if not sql:
                raise ValueError("Generated widget JSON did not include sql")

            return {
                "sql": sql,
                "chart_type": chart_type,
                "title": str(parsed.get("title") or body.prompt).strip() or body.prompt,
                "required_columns": _to_str_list(parsed.get("required_columns")),
                "suggested_filters": _to_str_list(parsed.get("suggested_filters")),
                "metric_definition": str(parsed.get("metric_definition") or "").strip(),
                "display_reason": str(parsed.get("display_reason") or "").strip(),
            }

        def _validate_plan_sql(sql_text: str) -> Optional[str]:
            safety_error = _validate_widget_sql_safety(sql_text)
            if safety_error:
                return safety_error

            refs = _extract_table_refs_from_sql(sql_text)
            if allowed_full:
                unknown_refs = [
                    ref for ref in refs
                    if ref not in allowed_full and ref.split(".")[-1] not in allowed_short
                ]
                if unknown_refs:
                    sample = ", ".join(unknown_refs[:6])
                    return f"Unknown tables/views in SQL: {sample}"

            # For non-local connections: run lightweight DB-side validation to catch bad columns/tables.
            if not is_local_connection:
                validation_sql = _build_validation_sql(sql_text, db_type)
                try:
                    _execute_query_on_connection(conn_row.data, validation_sql or sql_text)
                except Exception as query_error:
                    return str(query_error)

            return None

        client = openai.OpenAI(api_key=os.getenv("OPENAI_API_KEY", ""))
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            max_tokens=1024,
            temperature=0.2,
            messages=[
                {"role": "system", "content": system_msg},
                {"role": "user", "content": user_msg_base},
            ],
        )

        plan = _parse_plan_response(response.choices[0].message.content or "")
        if allowed_columns:
            plan["required_columns"] = [
                col for col in plan.get("required_columns", [])
                if str(col).split(".")[-1].strip().strip('`[]"').lower() in allowed_columns
            ]
        validation_error = _validate_plan_sql(plan["sql"])

        if validation_error:
            retry_prompt = f"""
The previous SQL was invalid for the selected database.
Validation error:
{validation_error}

Original user request:
{body.prompt}

Please regenerate valid SQL using ONLY the schema context.
IMPORTANT: If the error mentions a column does not exist, it is likely a case-sensitivity issue. For PostgreSQL, always double-quote identifiers that contain uppercase letters (e.g. "StockCode" not stockcode).
Return JSON only.
""".strip()
            retry = client.chat.completions.create(
                model="gpt-4o-mini",
                max_tokens=1024,
                temperature=0.1,
                messages=[
                    {"role": "system", "content": system_msg},
                    {"role": "user", "content": user_msg_base},
                    {"role": "user", "content": retry_prompt},
                ],
            )
            plan = _parse_plan_response(retry.choices[0].message.content or "")
            if allowed_columns:
                plan["required_columns"] = [
                    col for col in plan.get("required_columns", [])
                    if str(col).split(".")[-1].strip().strip('`[]"').lower() in allowed_columns
                ]
            validation_error = _validate_plan_sql(plan["sql"])
            if validation_error:
                raise ValueError(f"Generated SQL does not match selected database schema: {validation_error}")

        return plan

    except Exception as e:
        logger.error(f"Widget generation failed: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to generate widget: {str(e)}")

@app.post("/api/dashboard/refresh-widget", dependencies=[Depends(verify_token), Depends(_disable_in_local_mode)])
async def refresh_dashboard_widget(body: DashboardWidgetRefresh):
    """Execute widget SQL and return fresh data."""
    sb = get_service_supabase()

    conn_row = sb.table("connections").select("*").eq("id", body.connection_id).single().execute()
    if not conn_row.data:
        raise HTTPException(status_code=404, detail="Connection not found")

    # Decrypt password
    password = conn_row.data.get("password", "")
    if password:
        try:
            dec = sb.rpc("decrypt_credential", {"encrypted": password}).execute()
            if dec.data:
                conn_row.data["password"] = dec.data
        except Exception:
            pass

    try:
        from feature_scheduling import _execute_query_on_connection
        result = _execute_query_on_connection(conn_row.data, body.sql_text)
        return result
    except Exception as e:
        logger.error(f"Widget refresh failed for connection {body.connection_id}: {e}")
        raise HTTPException(status_code=400, detail=f"Query failed: {str(e)}")


# Starten:
# uvicorn main:app --reload --host 0.0.0.0 --port 8000
