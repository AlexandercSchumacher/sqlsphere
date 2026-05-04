# feature_chat_json_based.py
# JSON-based chat implementation - LLM returns structured JSON response
# Format: {"mode": "db"|"chat", "explanation": "...", "sql": "...", "preview_sql": "..."}

import hashlib
import json
import logging
import os
import re
import time
import threading
from typing import Any, Dict, List, Optional
from datetime import date, datetime
from decimal import Decimal


def _format_sql_code(sql: str) -> str:
    """
    Format SQL code according to best practices:
    - Each SQL keyword on a new line
    - Proper indentation
    - Commas at end of line for multiple columns
    """
    if not sql or not sql.strip():
        return sql
    
    # Remove extra whitespace
    sql = sql.strip()
    
    # If SQL is already multi-line and properly formatted, return as is
    if '\n' in sql:
        lines = sql.split('\n')
        # Check if keywords are already on separate lines
        has_keywords_on_lines = any(
            line.strip().upper().startswith(('SELECT', 'FROM', 'WHERE', 'JOIN', 'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN', 'ORDER BY', 'GROUP BY', 'HAVING', 'LIMIT', 'OFFSET', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'ALTER', 'DROP'))
            for line in lines
        )
        if has_keywords_on_lines:
            # Already formatted, just clean up
            return '\n'.join(line.rstrip() for line in lines if line.strip())
    
    # SQL keywords that should be on new lines (ordered by length to match longer first)
    keywords = [
        'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL OUTER JOIN', 'FULL JOIN',
        'ORDER BY', 'GROUP BY', 'INSERT INTO', 'DELETE FROM',
        'SELECT', 'FROM', 'WHERE', 'JOIN', 'ON', 'HAVING', 'LIMIT', 'OFFSET',
        'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'ALTER', 'DROP', 'TRUNCATE',
        'UNION ALL', 'UNION', 'EXCEPT', 'INTERSECT',
        'AND', 'OR'
    ]
    
    # Split by semicolons first (handle multiple statements)
    statements = sql.split(';')
    formatted_statements = []
    
    for stmt in statements:
        if not stmt.strip():
            continue
        
        stmt = stmt.strip()
        
        # Replace keywords with newline + keyword (case-insensitive, word boundaries)
        formatted = stmt
        for keyword in sorted(keywords, key=len, reverse=True):
            # Use word boundaries to avoid matching keywords inside identifiers
            pattern = r'\b' + re.escape(keyword) + r'\b'
            # Replace with newline + keyword, preserving original case
            matches = list(re.finditer(pattern, formatted, flags=re.IGNORECASE))
            for match in reversed(matches):  # Replace from end to start to preserve positions
                start, end = match.span()
                # Check if not already at start of line
                if start > 0 and formatted[start-1] != '\n':
                    formatted = formatted[:start] + '\n' + match.group() + formatted[end:]
        
        # Clean up: split into lines and process
        lines = [line.strip() for line in formatted.split('\n') if line.strip()]
        
        if not lines:
            continue
        
        result_lines = []
        indent_level = 0
        indent_size = 2
        
        for i, line in enumerate(lines):
            line_upper = line.upper().strip()
            
            # Decrease indent before certain keywords
            if line_upper.startswith(('FROM', 'WHERE', 'ORDER BY', 'GROUP BY', 'HAVING', 'LIMIT', 'OFFSET')):
                indent_level = 0
            elif line_upper.startswith(('AND', 'OR')):
                indent_level = 1
            elif line_upper.startswith(('JOIN', 'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN')):
                indent_level = 0
            
            # Add line with proper indentation
            result_lines.append(' ' * (indent_level * indent_size) + line.strip())
            
            # Increase indent after certain keywords
            if line_upper.startswith('SELECT'):
                indent_level = 1
            elif line_upper.startswith(('FROM', 'WHERE')):
                indent_level = 1
            elif line_upper.startswith(('JOIN', 'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN')):
                indent_level = 1
            elif line_upper.startswith(('ORDER BY', 'GROUP BY')):
                indent_level = 0
        
        formatted_stmt = '\n'.join(result_lines)
        
        # Add semicolon if original had one
        if stmt.endswith(';') or (len(statements) > 1 and stmt != statements[-1]):
            formatted_stmt += ';'
        
        formatted_statements.append(formatted_stmt)
    
    return '\n'.join(formatted_statements)

from openai import OpenAI
try:
    from anthropic import Anthropic
    ANTHROPIC_AVAILABLE = True
except ImportError:
    ANTHROPIC_AVAILABLE = False

# Configuration
ACTIVE_MODEL = os.getenv("ACTIVE_MODEL", "claude").lower()  # Default to chatgpt
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")

# Initialize clients
openai_client = None
anthropic_client = None

# Initialize both clients if API keys are available (for dynamic model selection)
if OPENAI_API_KEY:
    try:
        openai_client = OpenAI(api_key=OPENAI_API_KEY)
    except Exception:
        pass

if ANTHROPIC_API_KEY and ANTHROPIC_AVAILABLE:
    try:
        anthropic_client = Anthropic(api_key=ANTHROPIC_API_KEY)
    except Exception:
        pass

ROW_LIMIT = 50  # Limit results for LLM context
FRONTEND_ROW_LIMIT = 100  # Limit results for frontend display


def get_db_structure(conn, engine, session_id: Optional[str] = None):
    """Get database structure for prompt context."""
    logger = logging.getLogger(__name__)
    cached_structure = None

    if session_id:
        try:
            from connection_manager import get_cached_db_structure
            cached_structure = get_cached_db_structure(session_id)
        except Exception:
            cached_structure = None

    def _store_schema_cache(db_structure: Dict[str, List[str]]) -> None:
        if not session_id or not db_structure:
            return
        try:
            from connection_manager import set_cached_db_structure
            set_cached_db_structure(session_id, db_structure)
        except Exception:
            pass

    def _fallback_to_cache() -> Dict[str, List[str]]:
        if cached_structure:
            logger.warning("Using cached DB structure for session %s because fresh fetch failed or was empty.", session_id)
            return cached_structure
        return {}

    def _parse_local_structure_rows(rows: List[Dict[str, Any]]) -> Dict[str, List[str]]:
        db_structure: Dict[str, List[str]] = {}
        for row in rows or []:
            if engine == "postgresql":
                schema = row.get("table_schema") or row.get("TABLE_SCHEMA")
                table = row.get("table_name") or row.get("TABLE_NAME")
                column = row.get("column_name") or row.get("COLUMN_NAME")
                dtype = row.get("data_type") or row.get("DATA_TYPE")
                table_type = row.get("table_type") or row.get("TABLE_TYPE", "BASE TABLE")
            else:
                schema = row.get("TABLE_SCHEMA") or row.get("table_schema")
                table = row.get("TABLE_NAME") or row.get("table_name")
                column = row.get("COLUMN_NAME") or row.get("column_name")
                dtype = row.get("DATA_TYPE") or row.get("data_type")
                table_type = row.get("TABLE_TYPE") or row.get("table_type", "BASE TABLE")

            if schema and table and column:
                is_view = "VIEW" in str(table_type).upper()
                key = f"{schema}.{table} [VIEW]" if is_view else f"{schema}.{table}"
                db_structure.setdefault(key, []).append(f"{column} ({dtype})")
        return db_structure

    # Check if this is a local agent connection
    if hasattr(conn, 'is_local_agent') and conn.is_local_agent:
        from local_agent_manager import agent_manager

        def _run_agent_schema_query(sql: str, timeout_seconds: int = 10) -> tuple[Optional[List[Dict[str, Any]]], Optional[str]]:
            job = agent_manager.create_job(conn.connection_code, sql)
            sent = agent_manager.send_job_threadsafe(conn.connection_code, job)
            if not sent:
                return None, "Failed to send schema job to local agent"

            start_time = time.time()
            while time.time() - start_time < timeout_seconds:
                result = agent_manager.get_job(job.job_id)
                if result and result.status == "completed":
                    if result.error:
                        return None, str(result.error)
                    payload = result.result or {}
                    if payload.get("success"):
                        return payload.get("results", []), None
                    return None, str(payload.get("error") or "Schema query returned unsuccessful result")
                if result and result.status == "failed":
                    return None, str(result.error or "Schema query failed")
                time.sleep(0.25)
            return None, "Schema query timeout"

        if engine == "sqlserver":
            schema_queries = ["""
                SELECT c.TABLE_SCHEMA, c.TABLE_NAME, c.COLUMN_NAME, c.DATA_TYPE, t.TABLE_TYPE
                FROM INFORMATION_SCHEMA.COLUMNS c
                JOIN INFORMATION_SCHEMA.TABLES t ON c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME
                ORDER BY c.TABLE_SCHEMA, c.TABLE_NAME, c.ORDINAL_POSITION;
            """]
        elif engine == "postgresql":
            schema_queries = ["""
                SELECT c.table_schema, c.table_name, c.column_name, c.data_type, t.table_type
                FROM information_schema.columns c
                JOIN information_schema.tables t ON c.table_schema = t.table_schema AND c.table_name = t.table_name
                WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema')
                UNION ALL
                SELECT m.schemaname AS table_schema,
                       m.matviewname AS table_name,
                       a.attname AS column_name,
                       format_type(a.atttypid, a.atttypmod) AS data_type,
                       'MATERIALIZED VIEW' AS table_type
                FROM pg_matviews m
                JOIN pg_namespace n ON n.nspname = m.schemaname
                JOIN pg_class c ON c.relname = m.matviewname AND c.relnamespace = n.oid
                JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
                ORDER BY table_schema, table_name, column_name;
            """]
        else:  # mysql
            # Query 1 prefers the active default schema.
            # Query 2 falls back to all non-system schemas when DATABASE() is NULL or not set.
            schema_queries = [
                """
                SELECT c.TABLE_SCHEMA, c.TABLE_NAME, c.COLUMN_NAME, c.DATA_TYPE, t.TABLE_TYPE
                FROM INFORMATION_SCHEMA.COLUMNS c
                JOIN INFORMATION_SCHEMA.TABLES t ON c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME
                WHERE c.TABLE_SCHEMA = DATABASE()
                ORDER BY c.TABLE_SCHEMA, c.TABLE_NAME, c.ORDINAL_POSITION;
                """,
                """
                SELECT c.TABLE_SCHEMA, c.TABLE_NAME, c.COLUMN_NAME, c.DATA_TYPE, t.TABLE_TYPE
                FROM INFORMATION_SCHEMA.COLUMNS c
                JOIN INFORMATION_SCHEMA.TABLES t ON c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME
                WHERE c.TABLE_SCHEMA NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
                ORDER BY c.TABLE_SCHEMA, c.TABLE_NAME, c.ORDINAL_POSITION;
                """
            ]

        try:
            for query_index, schema_query in enumerate(schema_queries):
                rows, query_error = _run_agent_schema_query(schema_query)
                if query_error:
                    logger.warning(
                        "Local schema fetch failed for session %s (engine=%s, query #%s): %s",
                        session_id,
                        engine,
                        query_index + 1,
                        query_error
                    )
                    continue

                db_structure = _parse_local_structure_rows(rows or [])
                if db_structure:
                    _store_schema_cache(db_structure)
                    return db_structure
        except Exception as e:
            logger.error("Error getting schema via local agent: %s", e)

        return _fallback_to_cache()

    # Standard connection - execute query directly
    cursor = conn.cursor()
    try:
        if engine == "sqlserver":
            query = """
            SELECT c.TABLE_SCHEMA, c.TABLE_NAME, c.COLUMN_NAME, c.DATA_TYPE, t.TABLE_TYPE
            FROM INFORMATION_SCHEMA.COLUMNS c
            JOIN INFORMATION_SCHEMA.TABLES t ON c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME
            ORDER BY c.TABLE_SCHEMA, c.TABLE_NAME, c.ORDINAL_POSITION;
            """
            cursor.execute(query)
            rows = cursor.fetchall()
        elif engine == "postgresql":
            query = """
            SELECT c.table_schema, c.table_name, c.column_name, c.data_type, t.table_type
            FROM information_schema.columns c
            JOIN information_schema.tables t ON c.table_schema = t.table_schema AND c.table_name = t.table_name
            WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema')
            UNION ALL
            SELECT a.attrelid::regclass::text AS table_schema,
                   m.matrelid::regclass::text AS table_name,
                   a.attname AS column_name,
                   format_type(a.atttypid, a.atttypmod) AS data_type,
                   'MATERIALIZED VIEW' AS table_type
            FROM pg_matviews m
            JOIN pg_class c ON c.relname = m.matviewname
            JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
            ORDER BY table_schema, table_name, column_name;
            """
            cursor.execute(query)
            rows = cursor.fetchall()
        else:  # mysql
            primary_query = """
            SELECT c.TABLE_SCHEMA, c.TABLE_NAME, c.COLUMN_NAME, c.DATA_TYPE, t.TABLE_TYPE
            FROM INFORMATION_SCHEMA.COLUMNS c
            JOIN INFORMATION_SCHEMA.TABLES t ON c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME
            WHERE c.TABLE_SCHEMA = DATABASE()
            ORDER BY c.TABLE_SCHEMA, c.TABLE_NAME, c.ORDINAL_POSITION;
            """
            fallback_query = """
            SELECT c.TABLE_SCHEMA, c.TABLE_NAME, c.COLUMN_NAME, c.DATA_TYPE, t.TABLE_TYPE
            FROM INFORMATION_SCHEMA.COLUMNS c
            JOIN INFORMATION_SCHEMA.TABLES t ON c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME
            WHERE c.TABLE_SCHEMA NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
            ORDER BY c.TABLE_SCHEMA, c.TABLE_NAME, c.ORDINAL_POSITION;
            """
            cursor.execute(primary_query)
            rows = cursor.fetchall()
            if not rows:
                cursor.execute(fallback_query)
                rows = cursor.fetchall()

        db_structure = {}
        for row in rows:
            if isinstance(row, dict):
                schema = row.get("TABLE_SCHEMA") or row.get("table_schema")
                table = row.get("TABLE_NAME") or row.get("table_name")
                column = row.get("COLUMN_NAME") or row.get("column_name")
                dtype = row.get("DATA_TYPE") or row.get("data_type")
                table_type = row.get("TABLE_TYPE") or row.get("table_type", "BASE TABLE")
            else:
                schema, table, column, dtype, table_type = row

            if schema and table and column:
                is_view = "VIEW" in str(table_type).upper()
                key = f"{schema}.{table} [VIEW]" if is_view else f"{schema}.{table}"
                db_structure.setdefault(key, []).append(f"{column} ({dtype})")

        if db_structure:
            _store_schema_cache(db_structure)
            return db_structure
    except Exception as e:
        logger.error("Error getting schema via direct connection: %s", e)
    finally:
        try:
            cursor.close()
        except Exception:
            pass

    return _fallback_to_cache()


def _calculate_schema_hash(db_structure: dict) -> str:
    """Calculate a hash of the database structure for change detection."""
    # Convert structure to a deterministic string representation
    structure_str = json.dumps(db_structure, sort_keys=True)
    # Calculate SHA256 hash
    return hashlib.sha256(structure_str.encode('utf-8')).hexdigest()


def _filter_error_messages(conversation_history: Optional[List[Dict[str, str]]]) -> List[Dict[str, str]]:
    """Filter out error messages from conversation history that shouldn't be sent to LLM."""
    if not conversation_history:
        return []
    
    filtered = []
    for msg in conversation_history:
        content = msg.get("content", "")
        if content and not (
            content.startswith("Error:") or 
            "Edge Function returned a non-2xx" in content or
            "non-2xx status code" in content
        ):
            filtered.append(msg)
    return filtered


def _get_call_success_message(language: str) -> str:
    """Get localized success message for CALL statement execution."""
    lang = language.lower() if language else "en"
    call_messages = {
        "en": "✅ The procedure was successfully executed.",
        "de": "✅ Die Prozedur wurde erfolgreich ausgeführt."
    }
    return call_messages.get(lang, call_messages["en"])


def _analyze_error_with_llm(
    error_msg: str,
    sql_code: str,
    session_id: str,
    user_query: str,
    db_structure: dict,
    engine: str,
    language: str,
    current_editor_code=None,
    code_context_metadata=None,
    active_model=None,
    fastapi_request=None
) -> Dict[str, Any]:
    """Call LLM to analyze and explain a SQL execution error to the user."""
    from connection_manager import is_schema_sent

    schema_sent = is_schema_sent(session_id)
    static_system_prompt = _build_static_system_prompt(engine, language)
    dynamic_sections = _build_dynamic_prompt_sections(
        db_structure=db_structure,
        engine=engine,
        sql_results={"success": False, "sql": sql_code, "error": error_msg},
        language=language,
        include_structure=not schema_sent,
        current_editor_code=current_editor_code,
        code_context_metadata=code_context_metadata
    )

    messages = [{"role": "system", "content": static_system_prompt}]
    if dynamic_sections:
        messages.append({"role": "system", "content": dynamic_sections})
    messages.append({"role": "user", "content": user_query})

    try:
        response = _call_llm(messages, cache_control="ephemeral", session_id=session_id, active_model=active_model, fastapi_request=fastapi_request)
        try:
            parsed = _parse_llm_response(response)
            explanation = parsed.get("explanation", f"Error: {error_msg}")
        except ValueError:
            explanation = f"Error: {error_msg}"
    except Exception:
        explanation = f"Error: {error_msg}"

    return {
        "success": False,
        "mode": "error",
        "sql": sql_code,
        "error": error_msg,
        "explanation": explanation
    }


def _execute_call_statement(
    conn,
    sql_code: str,
    session_id: str,
    user_query: str,
    db_structure: dict,
    engine: str,
    conversation_history: Optional[List[Dict[str, str]]],
    language: str,
    current_editor_code: Optional[str],
    code_context_metadata: Optional[Dict[str, Any]],
    active_model: Optional[str] = None,
    fastapi_request=None
) -> Dict[str, Any]:
    """Execute a CALL statement and return result or error."""
    from connection_manager import is_schema_sent
    
    cursor = conn.cursor()
    try:
        start_time = time.time()
        cursor.execute(sql_code)
        execution_time = (time.time() - start_time) * 1000
        
        # Commit if needed
        try:
            if hasattr(conn, 'commit'):
                conn.commit()
        except:
            pass
        
        call_explanation = _get_call_success_message(language)
        
        return {
            "success": True,
            "mode": "dml",
            "sql": sql_code,
            "explanation": call_explanation,
            "results": [],
            "columns": [],
            "row_count": 0,
            "execution_time_ms": round(execution_time, 2)
        }
    except Exception as e:
        try:
            conn.rollback()
        except:
            pass
        
        error_msg = str(e)
        return _analyze_error_with_llm(
            error_msg=error_msg,
            sql_code=sql_code,
            session_id=session_id,
            user_query=user_query,
            db_structure=db_structure,
            engine=engine,
            language=language,
            current_editor_code=current_editor_code,
            code_context_metadata=code_context_metadata,
            active_model=active_model,
            fastapi_request=fastapi_request
        )
    finally:
        cursor.close()


def _normalize_value(val: Any) -> Any:
    """Normalize database values for JSON serialization."""
    if val is None:
        return None
    if isinstance(val, (date, datetime)):
        return val.isoformat()
    if isinstance(val, Decimal):
        return float(val)
    if isinstance(val, bytes):
        return val.decode('utf-8', errors='ignore')
    return val


def _format_db_structure(db_structure: dict, engine: str = None) -> str:
    """Format database structure for LLM prompt (compact)."""
    lines = []
    
    if engine:
        lines.append(f"DB Structure ({engine.upper()}): Only use listed columns!")
    
    for table_key, columns in list(db_structure.items())[:100]:  # Limit to first 100 tables
        lines.append(f"{table_key}: {', '.join(columns[:30])}")  # Compact format: one line per table
    if len(db_structure) > 100:
        lines.append(f"... +{len(db_structure) - 100} more tables")
    
    # Compact JOIN warning
    if engine == "postgresql":
        lines.append("JOINs: Check data types, use :: for type conversion (e.g. user_id::integer)")
    else:
        lines.append("JOINs: Check data types, use CAST for type conversion")
    
    return "\n".join(lines)


def _parse_llm_response(response: str) -> dict:
    """
    Parse LLM response as JSON.
    Expected format:
    {
        "mode": "db" | "chat",
        "explanation": "Natural language explanation",
        "sql": "SQL statement or null",
        "preview_sql": "Preview SELECT statement or null"
    }
    """
    if not response:
        raise ValueError("Empty LLM response")
    
    # Try to extract JSON from response (in case LLM adds extra text)
    response_clean = response.strip()
    
    # Try to find JSON object in response
    json_start = response_clean.find('{')
    json_end = response_clean.rfind('}')
    
    if json_start == -1 or json_end == -1 or json_end <= json_start:
        raise ValueError(f"LLM response does not contain valid JSON: {response[:200]}")
    
    json_str = response_clean[json_start:json_end + 1]
    
    try:
        data = json.loads(json_str)
    except json.JSONDecodeError as e:
        raise ValueError(f"LLM response is not valid JSON: {response[:200]}... Error: {str(e)}")
    
    # Minimal validation
    if "mode" not in data:
        raise ValueError(f"LLM response missing required field 'mode': {response[:200]}")
    
    if "explanation" not in data:
        raise ValueError(f"LLM response missing required field 'explanation': {response[:200]}")
    
    if "sql" not in data:
        raise ValueError(f"LLM response missing required field 'sql': {response[:200]}")
    
    # Validate mode
    if data["mode"] not in ["db", "chat"]:
        raise ValueError(f"LLM response has invalid 'mode' (must be 'db' or 'chat'): {data.get('mode')}")
    
    # If mode is "db", sql should not be null/empty
    if data["mode"] == "db" and (not data.get("sql") or data["sql"].strip() == "" or data["sql"].lower() == "null"):
        raise ValueError(f"LLM response has mode='db' but sql is empty or null")
    
    # Normalize null values
    if data.get("sql") in [None, "null", ""]:
        data["sql"] = None
    else:
        data["sql"] = data["sql"].strip()
    
    if data.get("preview_sql") in [None, "null", ""]:
        data["preview_sql"] = None
    else:
        data["preview_sql"] = data["preview_sql"].strip()

    # Extract and validate chart_hint
    VALID_HINTS = {"bar", "line", "pie", "area"}
    chart_hint = data.get("chart_hint")
    if chart_hint not in VALID_HINTS:
        chart_hint = None
    data["chart_hint"] = chart_hint

    return data


def _build_static_system_prompt(
    engine: str,
    language: str = "en"
) -> str:
    """Build static system prompt that can be cached (without dynamic content like DB structure, editor code, results)."""
    # Language instruction
    lang_names = {
        "en": "English", "de": "German", "es": "Spanish", "it": "Italian",
        "fr": "French", "pt": "Portuguese", "nl": "Dutch", "ja": "Japanese",
        "zh": "Chinese", "ru": "Russian", "pl": "Polish", "ko": "Korean"
    }
    lang_name = lang_names.get(language.lower(), "English")
    language_instruction = f"Respond in {lang_name}."
    
    # Dialect hints (compact)
    if engine == "postgresql":
        dialect_hints = "PostgreSQL: \"identifiers\", LIMIT, current_database(), ::type. Metadata: pg_proc/pg_namespace. PROCEDURE/FUNCTION: If type changes, first DROP then CREATE. Upsert: INSERT ... ON CONFLICT. Bulk import: COPY (requires confirmation). Materialized Views: marked [VIEW] in schema — cannot INSERT/UPDATE/DELETE."
    elif engine == "mysql":
        dialect_hints = "MySQL: `identifiers`, LIMIT, DATABASE(). Metadata: INFORMATION_SCHEMA.ROUTINES WHERE ROUTINE_SCHEMA = DATABASE(). Upsert: INSERT ... ON DUPLICATE KEY UPDATE (preferred over REPLACE INTO, which deletes+inserts). Procedures: CALL. Both REPLACE and CALL require confirmation."
    elif engine == "sqlserver":
        dialect_hints = "SQL Server: [identifiers], TOP, sys.objects. Metadata: sys.objects WHERE type IN ('P','FN','IF','TF'). Procedures: EXEC/EXECUTE (not CALL). Upsert: MERGE (requires confirmation). Bulk import: BULK INSERT (requires confirmation)."
    
    # Modification note: DML/DDL always requires preview and user confirmation
    modification_note = """DML/DDL Rules (ALWAYS APPLY):
1. mode="db", sql=THE ACTUAL DML/DDL statement (INSERT/UPDATE/DELETE/CREATE/ALTER/DROP/TRUNCATE)
2. preview_sql REQUIRED (except CALL): UPDATE/DELETE→SELECT affected rows; INSERT→SELECT data to insert; CREATE VIEW→SELECT view definition; CREATE PROC/FUNC→null
3. IMPORTANT: For ALL DML/DDL operations you MUST return the actual DML/DDL in "sql" immediately — DO NOT do a two-step chat flow, DO NOT ask the user to confirm via text, DO NOT return the preview SELECT as "sql". The system automatically shows a confirmation modal to the user before any execution happens. Your job is to provide: sql=DML/DDL, preview_sql=preview SELECT, explanation=what the operation does and what will be affected.
4. CALL statements execute directly without confirmation (they don't modify schema, just execute procedures)
5. On errors: Analyze, explain, provide options, DO NOT execute automatically
6. explanation: Describe what the operation does and what will be affected. Do NOT ask for confirmation — the system handles that automatically via a modal.
7. VIEWS ARE READ-ONLY: Tables marked with [VIEW] in the schema are views — NEVER use DELETE, INSERT, or UPDATE on them. They will throw a database error. Always identify the underlying base tables (not marked [VIEW]) and target those for DML. Example: if you see "schema.current_dept_emp [VIEW]", delete from "schema.dept_emp" (the base table) instead."""
    
    # Engine-specific syntax warnings (compact)
    if engine == "postgresql":
        engine_syntax_warnings = "PostgreSQL: SERIAL/IDENTITY (not AUTO_INCREMENT), \"identifiers\" (not `), ::type, LIMIT (not TOP)"
    elif engine == "mysql":
        engine_syntax_warnings = "MySQL: AUTO_INCREMENT, `identifiers`, LIMIT (not TOP, not ::type)"
    elif engine == "sqlserver":
        engine_syntax_warnings = "SQL Server: IDENTITY(1,1) (not AUTO_INCREMENT), [identifiers] (not `), TOP (not LIMIT), CAST()"
    
    static_prompt = f"""You are a SQL assistant for {engine.upper()}. Users do not execute SQL commands - you are the only interface to the database.

Engine Syntax ({engine.upper()}): {engine_syntax_warnings}

Principles:
1. Full access: Tables, Views, Procedures, Functions, Constraints, information_schema, all data
2. Proactive: For DB queries → generate SQL, fetch data yourself. Think comprehensively: Foreign Keys, Views, Procedures, Functions
3. No invented data: Only output data actually retrieved from DB
4. Respond directly: NO meta-explanations like "I'm responding in chat mode" or "the user asked" or "you requested" - just answer directly. NEVER reference the question in your response.
5. IMPORTANT: For EVERY database query (even if you already know the answer) you MUST use mode="db" with SQL. Only for pure conversations (greetings, general questions without DB context) use mode="chat"

Rules:
- Columns: ONLY use from DB structure, NEVER invent. Check structure before use.
- Parameters: NO placeholders (?, $1, :param). Complete SQL statements with values or subqueries.
- JOINs: Pay attention to data types, use CAST/::.
- Default: LIMIT 100 for SELECT (unless otherwise specified).

{dialect_hints}
{modification_note}
{language_instruction}

Output Format (JSON):
{{"mode": "db"|"chat", "explanation": "...", "sql": "..."|null, "preview_sql": "..."|null, "chart_hint": "bar"|"line"|"pie"|"area"|null}}
- mode="db": ALWAYS use when data must be retrieved from the database (SELECT, aggregations, filters, etc.). sql MUST be filled. explanation: Explain the result to the user
- mode="chat": ONLY for pure conversations without DB context (greetings, general questions, no database queries). For database queries NEVER use mode="chat"!
- "explanation" is ALWAYS your direct response to the user, NEVER a meta-description of your actions. Do NOT say "the user asked" or "you requested" - just explain directly what the data shows or what the operation does.
- chart_hint rules: null by default; "bar" for grouped counts/comparisons; "line" for time-series or trend data; "pie" for ≤10 distinct categories with a single measure; "area" for cumulative/stacked series
- Pay attention to SQL code best practices: SQL statements on new lines, no comments, indentation, etc. as applied in best practices
- Valid JSON, no text outside

Examples:
{{"mode": "db", "explanation": "Join via user_id::integer = id", "sql": "SELECT d.*,\n       u.*\nFROM datasources d\nJOIN users u ON d.user_id::integer = u.id\nLIMIT 100;", "preview_sql": null, "chart_hint": null}}
{{"mode": "db", "explanation": "Simple query with conditions", "sql": "SELECT *\nFROM users\nWHERE name = 'John'\n  AND email = '';", "preview_sql": null, "chart_hint": null}}
{{"mode": "db", "explanation": "Orders per month", "sql": "SELECT month, COUNT(*) AS orders\nFROM orders\nGROUP BY month\nORDER BY month;", "preview_sql": null, "chart_hint": "bar"}}
{{"mode": "chat", "explanation": "Hello! I'm your SQL assistant. How can I help you with your database today?", "sql": null, "preview_sql": null, "chart_hint": null}}

Additional Guidelines:
- When working with dates and times, always use appropriate functions for the database engine. For {engine.upper()}, use DATE_FORMAT, STR_TO_DATE, or similar functions as appropriate.
- When dealing with NULL values, use COALESCE, ISNULL, or NULLIF functions appropriately for {engine.upper()}.
- For string operations, use CONCAT, SUBSTRING, REPLACE, and other string functions specific to {engine.upper()}.
- When aggregating data, use GROUP BY with all non-aggregated columns. Use HAVING for filtering aggregated results.
- For subqueries, prefer CTEs (Common Table Expressions) where supported, or use derived tables when CTEs are not available.
- Always consider performance: use indexes effectively, avoid unnecessary JOINs, and limit result sets appropriately.
- When working with JSON data (if supported), use appropriate JSON functions for {engine.upper()}.
- For transactions, understand the isolation levels and locking behavior of {engine.upper()}.
- When handling errors, provide clear, actionable error messages that help users understand what went wrong.
- For complex queries, break them down into logical sections with proper formatting and comments in your explanation.
- Always validate that column names and table names exist in the database structure before using them in queries.
- When using window functions (if supported), ensure proper partitioning and ordering clauses.
- For recursive queries or hierarchical data, use appropriate recursive CTEs or hierarchical query patterns for {engine.upper()}.
- When working with large datasets, consider pagination strategies and use LIMIT/OFFSET or equivalent mechanisms.
- Always ensure data type compatibility when performing JOINs, comparisons, or arithmetic operations.
- For time-series data, use appropriate date/time grouping functions and window functions where applicable.
- When optimizing queries, consider the query execution plan and suggest index usage where beneficial.
- For data migration or bulk operations, provide clear explanations of the impact and suggest testing strategies.
- Always maintain referential integrity when suggesting data modifications.
- When working with views, understand that views are virtual tables and may have performance implications.
- For stored procedures and functions, ensure proper parameter handling and error management.
- When dealing with character sets and collations, be aware of potential issues with string comparisons and sorting.
- Always provide context-aware explanations that help users understand not just what the query does, but why it might be useful for their specific use case."""
    
    return static_prompt


def _build_dynamic_prompt_sections(
    db_structure: dict,
    engine: str,
    sql_results: Optional[Dict[str, Any]] = None,
    language: str = "en",
    include_structure: bool = True,
    current_editor_code: Optional[str] = None,
    code_context_metadata: Optional[Dict[str, Any]] = None
) -> str:
    """Build dynamic prompt sections (DB structure, editor code, results) that should NOT be cached."""
    lang_names = {
        "en": "English", "de": "German", "es": "Spanish", "it": "Italian",
        "fr": "French", "pt": "Portuguese", "nl": "Dutch", "ja": "Japanese",
        "zh": "Chinese", "ru": "Russian", "pl": "Polish", "ko": "Korean"
    }
    lang_name = lang_names.get(language.lower(), "English")
    
    sections = []
    
    # Structure section
    if include_structure:
        try:
            structure_text = _format_db_structure(db_structure, engine)
            if structure_text:
                sections.append(f"\nDB Structure:\n{structure_text}\n")
        except Exception:
            pass
    else:
        sections.append("\nDB structure already in conversation.\n")
    
    # Editor code context section
    if current_editor_code:
        if code_context_metadata and code_context_metadata.get("total_lines", 0) > code_context_metadata.get("context_lines", 0):
            total_lines = code_context_metadata.get("total_lines", 0)
            context_lines = code_context_metadata.get("context_lines", 0)
            cursor_line = code_context_metadata.get("cursor_line")
            sections.append(f"\nEditor Code ({context_lines}/{total_lines} lines, Cursor: {cursor_line + 1 if cursor_line is not None else '?'}):\n```sql\n{current_editor_code}\n```\n")
        else:
            sections.append(f"\nEditor Code:\n```sql\n{current_editor_code}\n```\n")
    
    # Results section
    if sql_results:
        if sql_results.get("success"):
            rows = sql_results.get("results", [])
            row_count = sql_results.get("row_count", 0)
            columns = sql_results.get("columns", [])
            
            results_text = f"Row count: {row_count}\n"
            results_text += f"Columns: {', '.join(columns)}\n\n"
            
            if rows:
                results_text += f"First {min(len(rows), ROW_LIMIT)} results:\n"
                for i, row in enumerate(rows[:ROW_LIMIT], 1):
                    results_text += f"{i}. {row}\n"
                if row_count > ROW_LIMIT:
                    results_text += f"\n... and {row_count - ROW_LIMIT} more"
            else:
                results_text += "No results found."
            
            sections.append(f"""SQL Results:
{sql_results.get('sql', 'N/A')}
{results_text}
Explain the results DIRECTLY to the user in {lang_name}. Do NOT reference the question or say "the user asked" or "you requested". Just explain what the data shows. Full data in Query Results Panel.""")
        else:
            error_msg = sql_results.get("error", "Unknown error")
            sql_code = sql_results.get('sql', 'N/A')
            
            sections.append(f"""SQL Error:
{sql_code}
Error: {error_msg}
Analyze and explain in {lang_name}: Problem, cause, options. No raw error codes. Explain DIRECTLY - do NOT reference the question or say "the user asked".""")
    
    return "".join(sections)


def _build_comprehensive_prompt(
    user_query: str,
    db_structure: dict,
    engine: str,
    conversation_history: Optional[List[Dict[str, str]]] = None,
    sql_results: Optional[Dict[str, Any]] = None,
    language: str = "en",
    include_structure: bool = True,
    current_editor_code: Optional[str] = None,
    code_context_metadata: Optional[Dict[str, Any]] = None
) -> str:
    """Build comprehensive prompt with JSON output format (legacy function, kept for compatibility).
    
    This function now uses the separated static/dynamic prompt builders for better caching support.
    """
    static_prompt = _build_static_system_prompt(engine, language)
    dynamic_sections = _build_dynamic_prompt_sections(
        db_structure, engine, sql_results, language, include_structure,
        current_editor_code, code_context_metadata
    )
    return static_prompt + dynamic_sections


def _call_llm(messages: List[Dict[str, str]], cache_control: Optional[str] = None, session_id: Optional[str] = None, active_model: Optional[str] = None, fastapi_request=None) -> str:
    """Call LLM with messages and optional prompt caching.
    
    Args:
        messages: List of message dicts with 'role' and 'content'
        cache_control: Optional cache control parameter for prompt caching
                      - For OpenAI: Uses prompt_cache_retention and prompt_cache_key
                      - For Anthropic: "ephemeral" with cache_control on messages
        session_id: Optional session ID for schema hash comparison
    """
    import logging
    logger = logging.getLogger(__name__)
    
    # Use active_model parameter if provided, otherwise fall back to ACTIVE_MODEL env var
    model_to_use = (active_model or ACTIVE_MODEL).lower()
    
    if model_to_use == "chatgpt":
        if not openai_client:
            raise RuntimeError("OPENAI_API_KEY is not set.")
        
        # Build request with prompt caching support
        request_params = {
            "model": "gpt-5.2", #gpt-4o-mini 
            "temperature": 0.3,
            "messages": messages,
            "prompt_cache_retention": "24h"  # Extended caching for up to 24 hours
        }
        
        # OpenAI Prompt Caching: Use prompt_cache_key to improve cache hit rates
        # The key should be consistent for requests with the same static prefix
        # We use schema_hash to identify when schema is unchanged and can be cached
        prompt_cache_key = None
        schema_hash_for_cache = None
        
        # Check if we have a schema_hash in messages (indicates schema caching is possible)
        if session_id:
            try:
                from connection_manager import get_schema_hash
                cached_schema_hash = get_schema_hash(session_id)
                
                # Find schema message with hash
                for msg in messages:
                    if msg.get("role") == "system" and msg.get("schema_hash"):
                        msg_schema_hash = msg.get("schema_hash")
                        # If schema hash matches cached hash, schema is unchanged and can be cached
                        if cached_schema_hash and msg_schema_hash == cached_schema_hash:
                            schema_hash_for_cache = msg_schema_hash
                            # Use schema hash as part of cache key for better cache hit rates
                            prompt_cache_key = f"schema_{msg_schema_hash[:16]}"
                            break
            except Exception:
                pass
        
        # If no schema-specific key, use a static key for the static prompt
        # This ensures the static system prompt (first message) is cached consistently
        if not prompt_cache_key:
            prompt_cache_key = "static_prompt"
        
        request_params["prompt_cache_key"] = prompt_cache_key
        
        # Remove schema_hash from messages before sending (it's only for internal logic)
        cleaned_messages = []
        for msg in messages:
            cleaned_msg = msg.copy()
            if "schema_hash" in cleaned_msg:
                del cleaned_msg["schema_hash"]
            cleaned_messages.append(cleaned_msg)
        request_params["messages"] = cleaned_messages
        
        try:
            # Use the new Responses API (recommended by OpenAI)
            # Convert messages to input format for Responses API
            # According to docs: input can be a string or a list of message objects
            # For conversation history, we use the messages list directly as input
            responses_params = {
                "model": request_params["model"],
                "input": cleaned_messages,  # Responses API accepts messages list as input
                "temperature": request_params.get("temperature", 0.3),
            }
            
            # Add cache parameters if available (may not be supported in Responses API yet)
            # Try with cache first, fall back without if it fails
            # Run API call in a thread to allow cancellation checking
            response = None
            api_error = None
            
            def make_api_call():
                nonlocal response, api_error
                try:
                    if "prompt_cache_retention" in request_params:
                        responses_params["prompt_cache_retention"] = request_params["prompt_cache_retention"]
                    if "prompt_cache_key" in request_params:
                        responses_params["prompt_cache_key"] = request_params["prompt_cache_key"]
                    
                    response = openai_client.responses.create(**responses_params)
                except (TypeError, AttributeError) as cache_error:
                    # If cache parameters are not supported, try without them
                    if "prompt_cache" in str(cache_error).lower() or "unexpected keyword" in str(cache_error).lower():
                        responses_params_no_cache = {
                            "model": request_params["model"],
                            "input": cleaned_messages,
                            "temperature": request_params.get("temperature", 0.3),
                        }
                        response = openai_client.responses.create(**responses_params_no_cache)
                    else:
                        api_error = cache_error
                except Exception as e:
                    api_error = e
            
            api_thread = threading.Thread(target=make_api_call, daemon=True)
            api_thread.start()
            
            # Wait for completion - cancellation is handled by AbortController in frontend
            while api_thread.is_alive():
                api_thread.join(timeout=0.5)
            
            if api_error:
                raise api_error
            
            if response is None:
                raise RuntimeError("OpenAI API call did not return a response")
        
        except (AttributeError, TypeError) as e:
            # If Responses API is not available, fall back to Chat Completions API
            # Use same cancellation checking approach
            response = None
            api_error = None
            
            def make_chat_completions_call():
                nonlocal response, api_error
                try:
                    response = openai_client.chat.completions.create(**request_params)
                except Exception as fallback_error:
                    error_msg = str(fallback_error)
                    
                    # Check if error is related to cache parameters
                    if "prompt_cache" in error_msg.lower() or "unexpected keyword" in error_msg.lower():
                        # Fallback: try without cache parameters
                        request_params_fallback = {
                            "model": request_params["model"],
                            "temperature": request_params["temperature"],
                            "messages": cleaned_messages
                        }
                        try:
                            response = openai_client.chat.completions.create(**request_params_fallback)
                        except Exception as e:
                            api_error = e
                    else:
                        api_error = fallback_error
            
            api_thread = threading.Thread(target=make_chat_completions_call, daemon=True)
            api_thread.start()
            
            # Wait for completion - cancellation is handled by AbortController in frontend
            while api_thread.is_alive():
                api_thread.join(timeout=0.5)
            
            if api_error:
                raise api_error
            
            if response is None:
                raise RuntimeError("OpenAI API call did not return a response")
        except RuntimeError as e:
            # Re-raise cancellation errors
            if "cancelled" in str(e).lower():
                raise
            # For other errors, fall back to Chat Completions
            response = None
            api_error = None
            
            def make_chat_completions_call():
                nonlocal response, api_error
                try:
                    response = openai_client.chat.completions.create(**request_params)
                except Exception as fallback_error:
                    error_msg = str(fallback_error)
                    
                    if "prompt_cache" in error_msg.lower() or "unexpected keyword" in error_msg.lower():
                        request_params_fallback = {
                            "model": request_params["model"],
                            "temperature": request_params["temperature"],
                            "messages": cleaned_messages
                        }
                        try:
                            response = openai_client.chat.completions.create(**request_params_fallback)
                        except Exception as e:
                            api_error = e
                    else:
                        api_error = fallback_error
            
            api_thread = threading.Thread(target=make_chat_completions_call, daemon=True)
            api_thread.start()
            
            while api_thread.is_alive():
                api_thread.join(timeout=0.5)
                if fastapi_request and hasattr(fastapi_request, 'is_disconnected') and fastapi_request.is_disconnected():
                    raise RuntimeError("Request cancelled by client")
            
            if api_error:
                raise api_error
            
            if response is None:
                raise RuntimeError("OpenAI API call did not return a response")
        
        # Extract and log cache usage information
        # Check usage.prompt_tokens_details.cached_tokens to verify caching
        # According to OpenAI docs: cached_tokens shows how many tokens were from cache
        # Caching is available for prompts with 1024+ tokens
        if hasattr(response, 'usage'):
            usage = response.usage
            if usage:
                # Get prompt tokens details
                prompt_tokens_details = getattr(usage, 'prompt_tokens_details', None)
                prompt_tokens = getattr(usage, 'prompt_tokens', None)
                completion_tokens = getattr(usage, 'completion_tokens', None)
                total_tokens = getattr(usage, 'total_tokens', None)
                
                if prompt_tokens_details:
                    cached_tokens = getattr(prompt_tokens_details, 'cached_tokens', None)
                    
                    if cached_tokens is not None and prompt_tokens is not None:
                        cache_percentage = (cached_tokens / prompt_tokens * 100) if prompt_tokens > 0 else 0
                        
                        # Log cache information
                        if cached_tokens > 0:
                            logger.info(
                                f"OpenAI cache HIT: {cached_tokens}/{prompt_tokens} prompt tokens cached "
                                f"({cache_percentage:.1f}%) | Total: {total_tokens} tokens "
                                f"(Prompt: {prompt_tokens}, Completion: {completion_tokens})"
                            )
                        elif prompt_tokens >= 1024:
                            logger.info(
                                f"OpenAI cache MISS: {prompt_tokens} prompt tokens (>=1024, eligible but no cache) | "
                                f"Total: {total_tokens} tokens (Prompt: {prompt_tokens}, Completion: {completion_tokens})"
                            )
                        else:
                            logger.info(
                                f"OpenAI cache: {prompt_tokens} prompt tokens (<1024, not eligible for caching) | "
                                f"Total: {total_tokens} tokens (Prompt: {prompt_tokens}, Completion: {completion_tokens})"
                            )
                elif prompt_tokens is not None:
                    # Usage available but no prompt_tokens_details (older API version?)
                    logger.info(
                        f"OpenAI usage: {total_tokens} total tokens "
                        f"(Prompt: {prompt_tokens}, Completion: {completion_tokens}) - "
                        f"Cache details not available"
                    )
        
        # Extract response content safely
        # Debug: Log response structure to understand what we're getting
        response_type = type(response).__name__
        response_attrs = [attr for attr in dir(response) if not attr.startswith('_')]
        
        # Try to extract content from different possible formats
        extracted_content = None
        
        # First, try Chat Completions API format (most common)
        if hasattr(response, 'choices'):
            if not response.choices:
                raise RuntimeError("OpenAI API returned no choices in response")
            
            message_content = response.choices[0].message.content
            if message_content:
                extracted_content = str(message_content).strip()
        
        # Then try Responses API formats:
        # - response.output_text (string)
        # - response.output (list of output items)
        # - response.output[0].text (if output is a list)
        if not extracted_content and hasattr(response, 'output_text'):
            content = response.output_text
            if content is not None:
                extracted_content = str(content).strip()
        
        if not extracted_content and hasattr(response, 'output'):
            # Responses API might return output as a list
            output = response.output
            if output:
                if isinstance(output, list) and len(output) > 0:
                    # Check if first item has text attribute
                    first_item = output[0]
                    if hasattr(first_item, 'text'):
                        extracted_content = str(first_item.text).strip()
                    elif isinstance(first_item, str):
                        extracted_content = str(first_item).strip()
                    elif hasattr(first_item, 'content'):
                        extracted_content = str(first_item.content).strip()
                elif isinstance(output, str):
                    extracted_content = output.strip()
        
        # Try other common attributes
        if not extracted_content:
            for attr in ['text', 'content', 'message', 'data', 'result']:
                if hasattr(response, attr):
                    attr_value = getattr(response, attr)
                    if attr_value:
                        if isinstance(attr_value, str):
                            extracted_content = attr_value.strip()
                        elif isinstance(attr_value, list) and len(attr_value) > 0:
                            first_item = attr_value[0]
                            if hasattr(first_item, 'text'):
                                extracted_content = str(first_item.text).strip()
                            elif isinstance(first_item, str):
                                extracted_content = str(first_item).strip()
                        break
        
        # If we successfully extracted content, return it
        if extracted_content:
            # Log the extracted content length for debugging
            if len(extracted_content) > 0:
                logger.info(f"Successfully extracted OpenAI response content ({len(extracted_content)} chars)")
            else:
                logger.warning(f"OpenAI response content is empty after extraction")
            return extracted_content
        
        # If we get here, we couldn't extract content - log for debugging
        logger.error(
            f"Could not extract content from OpenAI response. "
            f"Response type: {response_type}, "
            f"Attributes: {response_attrs}, "
            f"Has output_text: {hasattr(response, 'output_text')}, "
            f"Has output: {hasattr(response, 'output')}, "
            f"Has choices: {hasattr(response, 'choices')}"
        )
        # Try to get string representation as last resort
        try:
            response_str = str(response)
            if response_str and len(response_str) > 10:
                logger.error(f"Response string representation (first 500 chars): {response_str[:500]}")
        except Exception:
            pass
        
        # Try additional attributes that might contain the response
        for attr in ['text', 'content', 'message', 'data', 'result']:
            if hasattr(response, attr):
                attr_value = getattr(response, attr)
                if attr_value:
                    logger.error(f"Found attribute '{attr}' with value (first 200 chars): {str(attr_value)[:200]}")
        
        raise RuntimeError(f"Unexpected response format from OpenAI API: {response_type}. Could not extract content.")
    
    elif model_to_use == "claude":
        if not anthropic_client:
            raise RuntimeError("ANTHROPIC_API_KEY is not set or anthropic library not installed.")
        
        # Claude format: system messages as array with cache_control support
        # According to Claude docs: cache_control should be on the LAST block of static content
        # All blocks before the cache_control block are automatically cached
        # Static content (first system message) should be cached
        # Dynamic content (DB structure, editor code, results) should NOT be cached
        system_messages = []
        claude_messages = []
        
        # Find system messages that should be cached
        # - First system message: static prompt (always cacheable)
        # - Schema message: cacheable if schema hasn't changed (has schema_hash and matches cached hash)
        last_cacheable_system_index = None
        schema_cacheable_index = None
        cached_schema_hash = None
        
        # Get cached schema hash for comparison if session_id is available
        if session_id:
            try:
                from connection_manager import get_schema_hash
                cached_schema_hash = get_schema_hash(session_id)
            except:
                cached_schema_hash = None
        
        for i, msg in enumerate(messages):
            if msg["role"] == "system":
                # First system message is static and should be cached
                if i == 0:
                    last_cacheable_system_index = i
                # Schema message: cacheable if it has schema_hash and schema hasn't changed
                elif msg.get("schema_hash") and cached_schema_hash and msg.get("schema_hash") == cached_schema_hash:
                    schema_cacheable_index = i
        
        # Process system messages
        for i, msg in enumerate(messages):
            if msg["role"] == "system":
                system_msg = {
                    "type": "text",
                    "text": msg["content"]
                }
                
                # Set cache_control on cacheable system messages
                # - First system message (static prompt): always cacheable
                # - Schema message: cacheable if schema hasn't changed
                # Using 1-hour cache TTL for better cache hit rates
                if i == last_cacheable_system_index:
                    # Static prompt - always cache
                    system_msg["cache_control"] = {"type": "ephemeral", "ttl": "1h"}
                elif i == schema_cacheable_index:
                    # Schema message - cache if schema unchanged
                    system_msg["cache_control"] = {"type": "ephemeral", "ttl": "1h"}
                
                # Remove schema_hash from message (it's only for internal logic)
                if "schema_hash" in msg:
                    del msg["schema_hash"]
                
                system_messages.append(system_msg)
            else:
                # Process conversation messages (user/assistant)
                # Convert to Claude format with support for cache_control
                if isinstance(msg.get("content"), str):
                    # Simple text message
                    claude_msg = {
                        "role": msg["role"],
                        "content": [{
                            "type": "text",
                            "text": msg["content"]
                        }]
                    }
                elif isinstance(msg.get("content"), list):
                    # Message with multiple content blocks
                    content_blocks = []
                    for block in msg["content"]:
                        if isinstance(block, str):
                            content_blocks.append({
                                "type": "text",
                                "text": block
                            })
                        elif isinstance(block, dict):
                            content_blocks.append(block)
                        else:
                            # Fallback: convert to text
                            content_blocks.append({
                                "type": "text",
                                "text": str(block)
                            })
                    claude_msg = {
                        "role": msg["role"],
                        "content": content_blocks
                    }
                else:
                    # Fallback: convert to text
                    claude_msg = {
                        "role": msg["role"],
                        "content": [{
                            "type": "text",
                            "text": str(msg.get("content", ""))
                        }]
                    }
                
                claude_messages.append(claude_msg)
        
        # Set cache_control on the last message block of conversation history to cache it
        # This allows the entire conversation history to be cached
        # The current user query (last message) should NOT be cached, only the history before it
        if len(claude_messages) > 1:
            # Find the last message before the current user query
            # The current user query is the last message, so we want to cache the one before it
            last_history_msg_index = len(claude_messages) - 2  # Second to last (history)
            current_query_index = len(claude_messages) - 1     # Last (current query, don't cache)
            
            if last_history_msg_index >= 0:
                last_history_msg = claude_messages[last_history_msg_index]
                
                # Cache the last content block of the last history message
                # This caches all conversation history up to and including this message
                if last_history_msg.get("content"):
                    if isinstance(last_history_msg["content"], list) and len(last_history_msg["content"]) > 0:
                        # Get the last content block
                        last_block = last_history_msg["content"][-1]
                        if isinstance(last_block, dict) and last_block.get("type") == "text":
                            # Add cache_control to the last block
                            # Using 1-hour cache TTL for better cache hit rates
                            last_block["cache_control"] = {"type": "ephemeral", "ttl": "1h"}
                    elif isinstance(last_history_msg["content"], str):
                        # Convert to block format and add cache_control
                        # Using 1-hour cache TTL for better cache hit rates
                        last_history_msg["content"] = [{
                            "type": "text",
                            "text": last_history_msg["content"],
                            "cache_control": {"type": "ephemeral", "ttl": "1h"}
                        }]
        
        request_params = {
            "model": "claude-sonnet-4-5",
            "max_tokens": 8192,
            "temperature": 0.3,
            "messages": claude_messages
        }
        
        # Only add system parameter if we have system messages
        if system_messages:
            request_params["system"] = system_messages
        
        response = anthropic_client.messages.create(**request_params)
        
        # Log cache usage from response if available
        if hasattr(response, 'usage'):
            usage = response.usage
            cache_read = getattr(usage, 'cache_read_input_tokens', None)
            cache_creation = getattr(usage, 'cache_creation_input_tokens', None)
            input_tokens = getattr(usage, 'input_tokens', None)
            output_tokens = getattr(usage, 'output_tokens', None)
            
            # Calculate cost estimate (Claude Sonnet 4.5 pricing)
            # Base input: $3/MTok, Cache write: $3.75/MTok, Cache read: $0.30/MTok, Output: $15/MTok
            cost_base_input = (input_tokens or 0) * 3 / 1_000_000
            cost_cache_write = (cache_creation or 0) * 3.75 / 1_000_000
            cost_cache_read = (cache_read or 0) * 0.30 / 1_000_000
            cost_output = (output_tokens or 0) * 15 / 1_000_000
            total_cost = cost_base_input + cost_cache_write + cost_cache_read + cost_output
            
        
        # Extract text from response
        return response.content[0].text.strip()
    
    else:
        raise ValueError(f"Unsupported model: {model_to_use}. Supported: 'claude' or 'chatgpt'")


def _strip_sql_comments(sql: str) -> str:
    """Remove leading block (/* */) and line (--) comments from a SQL statement."""
    import re
    # Remove /* ... */ block comments (non-greedy)
    sql = re.sub(r'/\*.*?\*/', '', sql, flags=re.DOTALL)
    # Remove -- line comments
    sql = re.sub(r'--[^\n]*', '', sql)
    return sql.strip()


def _is_dml_ddl(sql: str) -> bool:
    """Check if SQL contains DML/DDL statements. Engine-aware:
    - All:        INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, TRUNCATE, GRANT, REVOKE, MERGE
    - MySQL:      REPLACE (REPLACE INTO = destructive upsert), LOAD DATA
    - SQL Server: EXEC, EXECUTE, BULK INSERT
    - PostgreSQL: COPY
    Checks all semicolon-separated statements and strips leading SQL comments
    (/* */ and --) so that '/* note */ DELETE FROM t' is correctly detected."""
    if not sql:
        return False
    dml_ddl_keywords = (
        # Standard DML/DDL (all engines)
        "INSERT", "UPDATE", "DELETE", "CREATE", "ALTER", "DROP", "TRUNCATE",
        "GRANT", "REVOKE", "MERGE",
        # MySQL-specific
        "REPLACE", "LOAD DATA",
        # SQL Server-specific
        "EXEC", "EXECUTE", "BULK INSERT",
        # PostgreSQL-specific
        "COPY",
        # Stored-procedure calls (all engines)
        "CALL",
    )
    for statement in sql.split(";"):
        stmt = _strip_sql_comments(statement).upper()
        if not stmt:
            continue
        if any(stmt.startswith(kw) for kw in dml_ddl_keywords):
            return True
    return False


def execute_query_json_based(
    session_id: str,
    user_query: str,
    conversation_history: List[Dict[str, str]] = None,
    language: str = "en",
    active_model: Optional[str] = None,
    current_editor_code: Optional[str] = None,
    code_context_metadata: Optional[Dict[str, Any]] = None,
    fastapi_request=None
) -> Dict[str, Any]:
    """
    JSON-based query execution.
    
    Flow:
    1. Build comprehensive prompt with JSON output format
    2. Call LLM - it returns JSON
    3. Parse JSON response
    4. If mode="db": Execute SQL
    5. If results: Call LLM again with results to get final explanation
    6. Return response
    """
    from connection_manager import get_connection, is_schema_sent, mark_schema_sent, mark_schema_updated, get_schema_hash, set_schema_hash
    
    # Get connection and DB structure
    conn, engine = get_connection(session_id)
    if not conn:
        return {
            "success": False,
            "mode": "error",
            "error": f"Session {session_id} not found."
        }
    
    db_structure = get_db_structure(conn, engine, session_id=session_id)
    conversation_history = conversation_history or []
    
    # Check for repeated error-fixing attempts to prevent infinite loops
    # Count consecutive error messages in conversation history
    MAX_ERROR_RETRIES = 3  # Maximum number of consecutive error-fixing attempts
    error_count = 0
    for msg in reversed(conversation_history[-10:]):  # Check last 10 messages
        content = msg.get("content", "")
        role = msg.get("role", "")
        # Count assistant messages that contain error information or indicate failed attempts
        if role == "assistant" and (
            "error" in content.lower() or 
            "fehler" in content.lower() or
            "failed" in content.lower() or
            "nicht möglich" in content.lower() or
            "could not" in content.lower()
        ):
            error_count += 1
        elif role == "user":
            # Reset counter when user sends a new query (not a retry)
            break
    
    # If we've had too many consecutive errors, stop trying to fix automatically
    if error_count >= MAX_ERROR_RETRIES:
        return {
            "success": False,
            "mode": "error",
            "sql": None,
            "error": "Too many consecutive errors",
            "explanation": f"Ich habe bereits {error_count} Versuche unternommen, den Fehler zu beheben, aber es funktioniert nicht. Bitte überprüfe den Code manuell und korrigiere die Fehler. Die automatische Fehlerbehebung wurde gestoppt, um eine Endlosschleife zu vermeiden." if language == "de" else f"I've already attempted {error_count} times to fix the error, but it's not working. Please manually review and correct the code. Automatic error fixing has been stopped to prevent an infinite loop."
        }
    
    # Calculate current schema hash
    current_schema_hash = _calculate_schema_hash(db_structure)
    cached_schema_hash = get_schema_hash(session_id)
    
    # Check if schema has changed
    schema_changed = cached_schema_hash is None or current_schema_hash != cached_schema_hash
    
    # If schema changed, mark it as updated and store new hash
    import logging
    logger = logging.getLogger(__name__)
    
    if schema_changed:
        mark_schema_updated(session_id)
        set_schema_hash(session_id, current_schema_hash)
        schema_already_sent = False  # Force resend of schema
    else:
        # Schema unchanged - can use cache
        schema_already_sent = is_schema_sent(session_id)
    
    # Build static (cacheable) and dynamic (non-cacheable) prompt sections
    # Note: Cancellation is handled by the AbortController in the frontend via Supabase Edge Functions
    # We don't check is_disconnected here to avoid false positives
    static_system_prompt = _build_static_system_prompt(engine, language)
    dynamic_sections = _build_dynamic_prompt_sections(
        db_structure=db_structure,
        engine=engine,
        sql_results=None,  # No results in initial call
        language=language,
        include_structure=not schema_already_sent,
        current_editor_code=current_editor_code,
        code_context_metadata=code_context_metadata
    )
    
    # Prepare messages with separated static and dynamic parts for caching
    # Static system prompt (cacheable)
    messages = [{"role": "system", "content": static_system_prompt}]
    
    # Add dynamic sections as additional system message (non-cacheable)
    if dynamic_sections:
        messages.append({"role": "system", "content": dynamic_sections})
    
    # Add schema message only if not already sent or if schema changed
    if not schema_already_sent:
        structure_text = _format_db_structure(db_structure, engine)
        schema_content = f"""DB Structure ({engine.upper()}) - applies to all queries, only updated on schema changes:

{structure_text}

Only use listed columns!"""
        
        # Mark schema message for caching if schema hasn't changed
        # Store schema_hash in message for cache control logic in _call_llm
        schema_message = {
            "role": "system",
            "content": schema_content,
            "schema_hash": current_schema_hash  # Store hash for cache control logic
        }
        messages.append(schema_message)
        # Mark schema as sent in session
        mark_schema_sent(session_id)
    
    messages.extend(_filter_error_messages(conversation_history))
    messages.append({"role": "user", "content": user_query})
    
    # Call LLM with prompt caching enabled for static system prompt
    try:
        # Enable prompt caching for the static system prompt (first message)
        # Cache control: "ephemeral" means cache until invalidated or expires
        # Pass session_id for schema hash comparison and active_model for LLM selection
        llm_response = _call_llm(messages, cache_control="ephemeral", session_id=session_id, active_model=active_model, fastapi_request=fastapi_request)
        
        # Debug: Log the raw response to understand what we're getting
        if not llm_response or len(llm_response.strip()) == 0:
            logger.error(f"LLM returned empty response. Response type: {type(llm_response)}, Value: {repr(llm_response)}")
        else:
            logger.info(f"LLM returned response ({len(llm_response)} chars). First 200 chars: {llm_response[:200]}")
    except Exception as e:
        import traceback
        error_trace = traceback.format_exc()
        return {
            "success": False,
            "mode": "error",
            "error": f"Error calling LLM: {str(e)}",
            "debug_error": error_trace
        }
    
    # Parse JSON response
    try:
        parsed = _parse_llm_response(llm_response)
    except ValueError as e:
        # Retry with stricter prompt if JSON parsing fails
        error_msg = str(e)
        
        # Special handling for mode='db' with empty SQL
        if "mode='db' but sql is empty" in error_msg or "mode='db' but sql is null" in error_msg:
            strict_retry_prompt = f"""Your previous response had an error:

Error: {error_msg}

The previous response was: "{llm_response[:200]}..."

IMPORTANT: You set "mode": "db" but did not provide an SQL statement.

Rules:
1. If "mode": "db", "sql" MUST contain a valid SQL statement (not null, not empty)
2. If you cannot or do not want to execute an SQL query, set "mode": "chat" and "sql": null
3. For procedures: Use "CALL procedure_name();" as SQL statement

NOW AGAIN CORRECTLY:
Return ONLY the JSON object, without additional text. Format:

{{
  "mode": "db" or "chat",
  "explanation": "Your explanation",
  "sql": "SQL statement (MUST be filled if mode='db') or null",
  "preview_sql": "Preview SELECT statement or null"
}}

Generate the correct JSON response NOW!
"""
        else:
            strict_retry_prompt = f"""Your previous response was not valid JSON in the required format.

Error: {error_msg}

The previous response was: "{llm_response[:200]}..."

NOW AGAIN CORRECTLY:
Return ONLY the JSON object, without additional text. Format:

{{
  "mode": "db" or "chat",
  "explanation": "Your explanation",
  "sql": "SQL statement or null",
  "preview_sql": "Preview SELECT statement or null"
}}

IMPORTANT: If "mode": "db", "sql" MUST be filled (not null, not empty)!

Generate the correct JSON response NOW!
"""
        
        retry_messages = [
            {"role": "system", "content": strict_retry_prompt},
            {"role": "user", "content": user_query}
        ]
        
        try:
            # Retry prompts should not be cached (they're error-specific)
            llm_response = _call_llm(retry_messages, cache_control=None, active_model=active_model, fastapi_request=fastapi_request)
            parsed = _parse_llm_response(llm_response)
        except Exception as retry_error:
            return {
                "success": False,
                "mode": "error",
                "error": f"LLM could not generate valid JSON: {str(retry_error)}",
                "debug_error": f"Original error: {str(e)}, Retry error: {str(retry_error)}"
            }
    
    mode = parsed.get("mode")
    sql_code = parsed.get("sql")
    preview_sql = parsed.get("preview_sql")
    explanation = parsed.get("explanation") or ""
    
    # Format SQL code according to best practices
    if sql_code:
        sql_code = _format_sql_code(sql_code)
    
    # If mode is "chat" or no SQL, return explanation only
    if mode == "chat" or not sql_code:
        return {
            "success": True,
            "mode": "talk",
            "sql": None,
            "explanation": explanation,
            "results": [],
            "columns": [],
            "row_count": 0,
            "execution_time_ms": 0.0
        }
    
    # DML/DDL operations are always allowed, but require preview and user confirmation
    # The AI should have already generated preview_sql and asked for confirmation
    # CALL statements execute directly (they don't modify schema)
    is_call = sql_code.strip().upper().startswith("CALL")
    
    # CALL statements are executed directly without confirmation (they don't modify schema, just execute procedures)
    if is_call:
        return _execute_call_statement(
            conn=conn,
            sql_code=sql_code,
            session_id=session_id,
            user_query=user_query,
            db_structure=db_structure,
            engine=engine,
            conversation_history=conversation_history,
            language=language,
            current_editor_code=current_editor_code,
            code_context_metadata=code_context_metadata,
            active_model=active_model,
            fastapi_request=fastapi_request
        )

    # DDL/DML requires frontend confirmation before execution
    is_dml_ddl_op = _is_dml_ddl(sql_code) and not is_call
    if is_dml_ddl_op:
        return {
            "requires_confirmation": True,
            "mode": "db",
            "sql": sql_code,
            "preview_sql": preview_sql,
            "explanation": explanation,
            "results": [],
            "columns": [],
            "row_count": 0,
            "execution_time_ms": 0.0,
            "success": True
        }

    # Auto-add LIMIT to SELECT statements without LIMIT to prevent memory issues
    # This ensures we don't fetch millions of rows into memory
    sql_upper_clean = sql_code.strip().upper()
    is_select = sql_upper_clean.startswith('SELECT')
    has_limit = 'LIMIT' in sql_upper_clean or (engine == 'sqlserver' and 'TOP' in sql_upper_clean)
    
    # Track if we auto-added LIMIT (to get accurate row count)
    auto_limited = False
    total_row_count = None
    
    # Check if this is a local agent connection
    is_local_agent = hasattr(conn, 'is_local_agent') and conn.is_local_agent
    
    if is_local_agent:
        # Execute SQL via local agent
        from local_agent_manager import agent_manager
        import asyncio
        
        if is_select and not has_limit and not is_call:
            auto_limited = True
            # First, get the total row count using COUNT(*) before limiting
            try:
                original_sql = sql_code.strip().rstrip(';')
                count_sql = f"SELECT COUNT(*) FROM ({original_sql}) AS count_query"
                
                # Execute COUNT via agent
                count_job = agent_manager.create_job(conn.connection_code, count_sql)
                sent = agent_manager.send_job_threadsafe(conn.connection_code, count_job)
                if sent:
                    max_wait = 10
                    start_time_count = time.time()
                    while time.time() - start_time_count < max_wait:
                        result = agent_manager.get_job(count_job.job_id)
                        if result and result.status == "completed":
                            if result.result and result.result.get("success"):
                                count_rows = result.result.get("results", [])
                                if count_rows and len(count_rows) > 0:
                                    count_val = list(count_rows[0].values())[0] if isinstance(count_rows[0], dict) else count_rows[0][0]
                                    total_row_count = int(count_val)
                            break
                        elif result and result.status == "failed":
                            break
                        time.sleep(0.3)
                
                # Add LIMIT to prevent memory issues
                safe_limit = FRONTEND_ROW_LIMIT + 50
                if engine == 'sqlserver':
                    sql_code = re.sub(r'(\bSELECT\b)', rf'\1 TOP {safe_limit}', sql_code, count=1, flags=re.IGNORECASE)
                else:
                    sql_code = sql_code.rstrip(';').rstrip() + f' LIMIT {safe_limit};'
            except Exception:
                pass
        
        # Execute main query via agent
        job = agent_manager.create_job(conn.connection_code, sql_code)
        sent = agent_manager.send_job_threadsafe(conn.connection_code, job)
        if not sent:
            return {
                "success": False,
                "mode": "error",
                "error": "Failed to send query to agent. Please ensure the agent is connected."
            }
        
        start_time = time.time()
        max_wait = 60  # 60 seconds timeout for query execution
        while time.time() - start_time < max_wait:
            result = agent_manager.get_job(job.job_id)
            if result and (result.status == "completed" or result.status == "failed"):
                execution_time = (time.time() - start_time) * 1000
                if result.status == "failed" or result.error:
                    return _analyze_error_with_llm(
                        error_msg=result.error or "Query execution failed",
                        sql_code=sql_code,
                        session_id=session_id,
                        user_query=user_query,
                        db_structure=db_structure,
                        engine=engine,
                        language=language,
                        current_editor_code=current_editor_code,
                        code_context_metadata=code_context_metadata,
                        active_model=active_model,
                        fastapi_request=fastapi_request
                    )
                
                if result.result and result.result.get("success"):
                    agent_result = result.result
                    rows_data = agent_result.get("results", [])
                    columns = agent_result.get("columns", [])
                    row_count = agent_result.get("row_count", len(rows_data))
                    
                    # Use total_row_count if we auto-added LIMIT, otherwise use actual fetched row count
                    actual_row_count = total_row_count if (auto_limited and total_row_count is not None) else row_count
                    
                    # Normalize and limit results for LLM context
                    results_for_llm = []
                    for row_dict in rows_data[:ROW_LIMIT]:
                        if isinstance(row_dict, dict):
                            normalized_row = {col: _normalize_value(val) for col, val in row_dict.items()}
                        else:
                            normalized_row = {col: _normalize_value(val) for col, val in zip(columns, row_dict)}
                        results_for_llm.append(normalized_row)
                    
                    # Normalize and limit results for frontend display
                    results_for_frontend = []
                    for row_dict in rows_data[:FRONTEND_ROW_LIMIT]:
                        if isinstance(row_dict, dict):
                            normalized_row = {col: _normalize_value(val) for col, val in row_dict.items()}
                        else:
                            normalized_row = {col: _normalize_value(val) for col, val in zip(columns, row_dict)}
                        results_for_frontend.append(normalized_row)
                    
                    # DDL Detection: Check if SQL is a DDL statement that modifies schema
                    sql_upper = sql_code.strip().upper()
                    is_ddl = any(sql_upper.startswith(keyword) for keyword in ["CREATE", "ALTER", "DROP", "TRUNCATE"])
                    if is_ddl:
                        from connection_manager import mark_schema_updated
                        mark_schema_updated(session_id)
                    
                    # Call LLM again with results to get final explanation
                    schema_sent_for_results = is_schema_sent(session_id)
                    
                    # Build static and dynamic prompts separately for caching
                    static_system_prompt_results = _build_static_system_prompt(engine, language)
                    dynamic_sections_results = _build_dynamic_prompt_sections(
                        db_structure=db_structure,
                        engine=engine,
                        sql_results={
                            "success": True,
                            "sql": sql_code,
                            "results": results_for_llm,
                            "columns": columns,
                            "row_count": actual_row_count
                        },
                        language=language,
                        include_structure=not schema_sent_for_results,
                        current_editor_code=current_editor_code,
                        code_context_metadata=code_context_metadata
                    )
                    
                    messages_with_results = [
                        {"role": "system", "content": static_system_prompt_results}
                    ]
                    if dynamic_sections_results:
                        messages_with_results.append({"role": "system", "content": dynamic_sections_results})
                    messages_with_results.append({"role": "user", "content": user_query})
                    
                    # Use prompt caching for results explanation
                    final_response = _call_llm(messages_with_results, cache_control="ephemeral", session_id=session_id, active_model=active_model, fastapi_request=fastapi_request)
                    
                    # Parse final response
                    try:
                        final_parsed = _parse_llm_response(final_response)
                        final_explanation = final_parsed.get("explanation", explanation)
                        final_chart_hint = final_parsed.get("chart_hint") or parsed.get("chart_hint")
                    except ValueError:
                        final_explanation = explanation
                        final_chart_hint = parsed.get("chart_hint")

                    # Store query result
                    try:
                        from connection_manager import store_query_result
                        store_query_result(session_id, {
                            "sql": sql_code,
                            "data": results_for_frontend,
                            "columns": columns,
                            "timestamp": datetime.now().isoformat(),
                            "row_count": actual_row_count,
                            "execution_time_ms": round(execution_time, 2),
                            "truncated": actual_row_count > FRONTEND_ROW_LIMIT
                        })
                    except Exception:
                        pass

                    return {
                        "success": True,
                        "mode": "select",
                        "sql": sql_code,
                        "explanation": final_explanation or explanation,
                        "results": results_for_frontend,
                        "columns": columns,
                        "row_count": actual_row_count,
                        "execution_time_ms": round(execution_time, 2),
                        "truncated": actual_row_count > FRONTEND_ROW_LIMIT,
                        "chart_hint": final_chart_hint
                    }
                else:
                    agent_error = (result.result.get("error") if result.result else None) or "Query execution failed"
                    return _analyze_error_with_llm(
                        error_msg=agent_error,
                        sql_code=sql_code,
                        session_id=session_id,
                        user_query=user_query,
                        db_structure=db_structure,
                        engine=engine,
                        language=language,
                        current_editor_code=current_editor_code,
                        code_context_metadata=code_context_metadata,
                        active_model=active_model,
                        fastapi_request=fastapi_request
                    )
                break
            elif result and result.status == "failed":
                return _analyze_error_with_llm(
                    error_msg=result.error or "Query execution failed",
                    sql_code=sql_code,
                    session_id=session_id,
                    user_query=user_query,
                    db_structure=db_structure,
                    engine=engine,
                    language=language,
                    current_editor_code=current_editor_code,
                    code_context_metadata=code_context_metadata,
                    active_model=active_model,
                    fastapi_request=fastapi_request
                )
            time.sleep(0.3)
        else:
            return {
                "success": False,
                "mode": "error",
                "error": "Timeout waiting for agent response",
                "sql": sql_code
            }
    else:
        # Standard connection - execute query directly
        if is_select and not has_limit and not is_call:
            auto_limited = True
            # First, get the total row count using COUNT(*) before limiting
            # This allows us to show accurate "X of Y rows" even when we limit results
            try:
                # Build COUNT query by wrapping the original SELECT in a subquery
                # This works for ALL SELECT queries (simple, complex, with UNION, CTEs, etc.)
                original_sql = sql_code.strip().rstrip(';')
                count_sql = f"SELECT COUNT(*) FROM ({original_sql}) AS count_query"
                
                count_cursor = conn.cursor()
                count_cursor.execute(count_sql)
                count_result = count_cursor.fetchone()
                if count_result:
                    total_row_count = int(count_result[0])
                count_cursor.close()
            except Exception:
                pass
            
            # Add LIMIT to prevent memory issues
            safe_limit = FRONTEND_ROW_LIMIT + 50  # Small buffer for accurate counting
            if engine == 'sqlserver':
                # SQL Server uses TOP instead of LIMIT
                sql_code = re.sub(r'(\bSELECT\b)', rf'\1 TOP {safe_limit}', sql_code, count=1, flags=re.IGNORECASE)
            else:
                # PostgreSQL and MySQL use LIMIT
                sql_code = sql_code.rstrip(';').rstrip() + f' LIMIT {safe_limit};'
        
        cursor = conn.cursor()
        try:
            start_time = time.time()
            cursor.execute(sql_code)
            execution_time = (time.time() - start_time) * 1000
            
            # DDL Detection: Check if SQL is a DDL statement that modifies schema
            # If so, mark schema as updated for next request
            sql_upper = sql_code.strip().upper()
            is_ddl = any(sql_upper.startswith(keyword) for keyword in ["CREATE", "ALTER", "DROP", "TRUNCATE"])
            if is_ddl:
                from connection_manager import mark_schema_updated
                mark_schema_updated(session_id)
            
            # Try to fetch results
            rows = []
            columns = []
            if cursor.description:
                rows = cursor.fetchall()
                columns = [desc[0] for desc in cursor.description]
            
            # Use total_row_count if we auto-added LIMIT, otherwise use actual fetched row count
            actual_row_count = total_row_count if (auto_limited and total_row_count is not None) else len(rows)
            
            # Normalize and limit results for LLM context
            results_for_llm = []
            for row in rows[:ROW_LIMIT]:
                normalized_row = {col: _normalize_value(val) for col, val in zip(columns, row)}
                results_for_llm.append(normalized_row)
            
            # Normalize and limit results for frontend display
            results_for_frontend = []
            for row in rows[:FRONTEND_ROW_LIMIT]:
                normalized_row = {col: _normalize_value(val) for col, val in zip(columns, row)}
                results_for_frontend.append(normalized_row)
            
            # Call LLM again with results to get final explanation
            # Schema should already be in history (use session storage check)
            schema_sent_for_results = is_schema_sent(session_id)
            
            # Build static and dynamic prompts separately for caching
            static_system_prompt_results = _build_static_system_prompt(engine, language)
            dynamic_sections_results = _build_dynamic_prompt_sections(
                db_structure=db_structure,
                engine=engine,
                sql_results={
                    "success": True,
                    "sql": sql_code,
                    "results": results_for_llm,
                    "columns": columns,
                    "row_count": actual_row_count
                },
                language=language,
                include_structure=not schema_sent_for_results,
                current_editor_code=current_editor_code,
                code_context_metadata=code_context_metadata
            )
            
            messages_with_results = [
                {"role": "system", "content": static_system_prompt_results}
            ]
            if dynamic_sections_results:
                messages_with_results.append({"role": "system", "content": dynamic_sections_results})
            messages_with_results.append({"role": "user", "content": user_query})
            
            # Use prompt caching for results explanation (static prompt is cacheable)
            final_response = _call_llm(messages_with_results, cache_control="ephemeral", session_id=session_id, active_model=active_model, fastapi_request=fastapi_request)
            
            # Parse final response (should also be JSON)
            try:
                final_parsed = _parse_llm_response(final_response)
                final_explanation = final_parsed.get("explanation", explanation)
                final_chart_hint = final_parsed.get("chart_hint") or parsed.get("chart_hint")
            except ValueError:
                # If final response is not JSON, extract explanation from text
                final_explanation = explanation
                final_chart_hint = parsed.get("chart_hint")

            # Store query result
            try:
                from connection_manager import store_query_result
                store_query_result(session_id, {
                    "sql": sql_code,
                    "data": results_for_frontend,
                    "columns": columns,
                    "timestamp": datetime.now().isoformat(),
                    "row_count": actual_row_count,
                    "execution_time_ms": round(execution_time, 2),
                    "truncated": actual_row_count > FRONTEND_ROW_LIMIT
                })
            except Exception:
                pass

            return {
                "success": True,
                "mode": "select",
                "sql": sql_code,
                "explanation": final_explanation or explanation,
                "results": results_for_frontend,
                "columns": columns,
                "row_count": actual_row_count,
                "execution_time_ms": round(execution_time, 2),
                "truncated": actual_row_count > FRONTEND_ROW_LIMIT,
                "chart_hint": final_chart_hint
            }
        
        except Exception as e:
            try:
                conn.rollback()
            except:
                pass
            
            error_msg = str(e)
            
            # Check if we've had too many consecutive errors in this conversation
            # Count error messages in recent conversation history
            recent_error_count = 0
            for msg in reversed(conversation_history[-10:]):  # Check last 10 messages
                content = msg.get("content", "")
                role = msg.get("role", "")
                if role == "assistant" and (
                    "error" in content.lower() or 
                    "fehler" in content.lower() or
                    "failed" in content.lower() or
                    "nicht möglich" in content.lower() or
                    "could not" in content.lower()
                ):
                    recent_error_count += 1
                elif role == "user":
                    break
            
            MAX_ERROR_RETRIES = 3  # Maximum number of consecutive error-fixing attempts
            
            # If we've exceeded the limit, stop trying to fix and return a clear message
            if recent_error_count >= MAX_ERROR_RETRIES:
                lang_messages = {
                    "de": f"Ich habe bereits {recent_error_count} Versuche unternommen, den Fehler automatisch zu beheben, aber es funktioniert nicht. Bitte überprüfe den Code manuell und korrigiere die Fehler. Die automatische Fehlerbehebung wurde gestoppt, um eine Endlosschleife zu vermeiden.\n\nLetzter Fehler: {error_msg}",
                    "en": f"I've already attempted {recent_error_count} times to automatically fix the error, but it's not working. Please manually review and correct the code. Automatic error fixing has been stopped to prevent an infinite loop.\n\nLast error: {error_msg}"
                }
                error_explanation = lang_messages.get(language, lang_messages["en"])
                
                return {
                    "success": False,
                    "mode": "error",
                    "sql": sql_code,
                    "error": error_msg,
                    "explanation": error_explanation
                }
            
            # Call LLM to analyze and explain the error (only if we haven't exceeded the limit)
            # Schema should already be in history
            schema_sent_for_error2 = is_schema_sent(session_id)
            
            # Build static and dynamic prompts separately for caching
            static_system_prompt_error = _build_static_system_prompt(engine, language)
            dynamic_sections_error = _build_dynamic_prompt_sections(
                db_structure=db_structure,
                engine=engine,
                sql_results={
                    "success": False,
                    "sql": sql_code,
                    "error": error_msg
                },
                language=language,
                include_structure=not schema_sent_for_error2,
                current_editor_code=current_editor_code,
                code_context_metadata=code_context_metadata
            )
            
            messages_with_error = [
                {"role": "system", "content": static_system_prompt_error}
            ]
            if dynamic_sections_error:
                messages_with_error.append({"role": "system", "content": dynamic_sections_error})
            messages_with_error.append({"role": "user", "content": user_query})
            
            try:
                # Use prompt caching for error analysis (static prompt is cacheable)
                error_response = _call_llm(messages_with_error, cache_control="ephemeral", session_id=session_id, active_model=active_model, fastapi_request=fastapi_request)
                # Parse error response (should be JSON)
                try:
                    error_parsed = _parse_llm_response(error_response)
                    error_explanation = error_parsed.get("explanation", f"Es gab einen Fehler bei der Ausführung: {error_msg}")
                except ValueError:
                    error_explanation = f"Es gab einen Fehler bei der Ausführung: {error_msg}"
            except Exception as llm_error:
                error_explanation = f"Es gab einen Fehler bei der Ausführung. Bitte überprüfe die SQL-Abfrage und versuche es erneut."
            
            return {
                "success": False,
                "mode": "error",
                "sql": sql_code,
                "error": error_msg,
                "explanation": error_explanation
            }


