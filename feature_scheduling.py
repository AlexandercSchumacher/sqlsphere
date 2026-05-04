# feature_scheduling.py
# APScheduler integration for scheduled queries and data alerts.
# Uses Supabase for persistence, Resend for email delivery.

import csv
import html
import io
import json
import logging
import os
import re
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from apscheduler.triggers.cron import CronTrigger

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Supabase helper (service-role client, not user-scoped)
# ---------------------------------------------------------------------------
_supabase_client = None

def _get_supabase():
    global _supabase_client
    if _supabase_client is None:
        from supabase import create_client
        url = os.getenv("SUPABASE_URL", "")
        key = os.getenv("SUPABASE_SERVICE_KEY", "") or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
        if not url or not key:
            raise RuntimeError("SUPABASE_URL / SUPABASE_SERVICE_KEY not set")
        _supabase_client = create_client(url, key)
    return _supabase_client

# ---------------------------------------------------------------------------
# Email via Resend
# ---------------------------------------------------------------------------
def _send_email(to: List[str], subject: str, html: str, attachments: list | None = None, from_email: str = "SQLSphere <noreply@sqlsphere.com>"):
    api_key = os.getenv("RESEND_API_KEY", "")
    if not api_key:
        logger.warning("RESEND_API_KEY not set — skipping email")
        return
    try:
        import resend
        resend.api_key = api_key
        params: dict = {
            "from": from_email,
            "to": to,
            "subject": subject,
            "html": html,
        }
        if attachments:
            params["attachments"] = attachments
        resend.Emails.send(params)
        logger.info(f"Email sent to {to}")
    except Exception as e:
        logger.error(f"Failed to send email: {e}")

# ---------------------------------------------------------------------------
# DB execution helper (reuses backend's connect logic)
# ---------------------------------------------------------------------------
def _execute_query_on_connection(connection_row: dict, sql: str, max_rows: Optional[int] = None) -> Dict[str, Any]:
    """Connect to the user's DB and run *sql*. Returns {columns, rows, row_count, truncated}."""
    from models import DatabaseConnection
    from connection_manager import connect_with_params

    # DB stores type as "PostgreSQL" / "MySQL" / "SQL Server" but model expects lowercase
    db_type = connection_row["type"].lower().replace(" ", "")
    params = {
        "type": db_type,
        "database": connection_row.get("database") or "",
        "host": connection_row.get("host"),
        "port": connection_row.get("port"),
        "username": connection_row.get("username") or "",
        "password": connection_row.get("password") or "",
        "useSSL": connection_row.get("use_ssl", False),
        "connectionMethod": connection_row.get("connection_method", "standard"),
        "defaultSchema": connection_row.get("default_schema"),
        "sshHost": connection_row.get("ssh_host"),
        "sshPort": connection_row.get("ssh_port"),
        "sshUsername": connection_row.get("ssh_username"),
        "sshPassword": connection_row.get("ssh_password"),
        "sshKeyFile": connection_row.get("ssh_key_file"),
        "socketPath": connection_row.get("socket_path"),
    }
    db_conn_model = DatabaseConnection(**{k: v for k, v in params.items() if v is not None})

    conn, engine = connect_with_params(db_conn_model)
    try:
        if getattr(conn, "is_local_agent", False):
            raise RuntimeError("Scheduled reports are currently not supported for local agent connections")
        cursor = conn.cursor()
        cursor.execute(sql)
        if cursor.description:
            columns = [col[0] for col in cursor.description]
            if max_rows is None:
                fetched = cursor.fetchall()
                truncated = False
            else:
                fetched = cursor.fetchmany(max_rows)
                truncated = bool(cursor.fetchmany(1))
            rows = [dict(zip(columns, row)) for row in fetched]
            return {"columns": columns, "rows": rows, "row_count": len(rows), "truncated": truncated}
        return {"columns": [], "rows": [], "row_count": 0, "truncated": False}
    finally:
        conn.close()

def _rows_to_csv(columns: List[str], rows: List[dict]) -> str:
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=columns)
    writer.writeheader()
    for row in rows:
        safe = {}
        for c in columns:
            v = row.get(c)
            if isinstance(v, (datetime,)):
                safe[c] = v.isoformat()
            else:
                safe[c] = v
        writer.writerow(safe)
    return buf.getvalue()


def _format_email_cell_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, bytes):
        return value.hex()
    if isinstance(value, (dict, list, tuple)):
        try:
            return json.dumps(value, default=str, ensure_ascii=False)
        except Exception:
            return str(value)
    return str(value)


_DATE_TIME_PATTERNS = re.compile(r"date|time|year|month|week|day|quarter|period|created|updated|ts\b|timestamp", re.IGNORECASE)
_SUPPORTED_CHART_TYPES = {"bar", "line", "area", "pie", "table"}


def _is_numeric(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, bool):
        return False
    if isinstance(value, (int, float, Decimal)):
        return True
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return False
        try:
            float(text)
            return True
        except ValueError:
            return False
    return False


def _to_float(value: Any) -> Optional[float]:
    if not _is_numeric(value):
        return None
    try:
        return float(value)
    except Exception:
        return None


def _column_is_numeric(column: str, rows: List[dict]) -> bool:
    sample = rows[:20]
    if not sample:
        return False
    numeric_count = sum(1 for row in sample if _is_numeric(row.get(column)))
    return numeric_count >= max(1, int(len(sample) * 0.6))


def _infer_chart_config(columns: List[str], rows: List[dict], requested_type: str = "auto") -> Optional[Dict[str, Any]]:
    if len(columns) < 2 or not rows:
        return None

    numeric_cols = [col for col in columns if _column_is_numeric(col, rows)]
    if not numeric_cols:
        return None
    categorical_cols = [col for col in columns if col not in numeric_cols]

    requested = (requested_type or "auto").strip().lower()
    if requested not in _SUPPORTED_CHART_TYPES and requested != "auto":
        requested = "auto"
    if requested == "table":
        return None

    def _default_x() -> Optional[str]:
        if categorical_cols:
            return categorical_cols[0]
        return columns[0] if columns else None

    if requested == "pie":
        x_key = _default_x()
        y_keys = [c for c in numeric_cols if c != x_key]
        if x_key and y_keys:
            return {"type": "pie", "x_key": x_key, "y_keys": y_keys[:1]}
        return None

    if requested in {"line", "area", "bar"}:
        x_key = _default_x()
        y_keys = [c for c in numeric_cols if c != x_key]
        if x_key and y_keys:
            return {"type": requested, "x_key": x_key, "y_keys": y_keys[:3]}
        return None

    # Auto mode
    time_key = next((c for c in columns if _DATE_TIME_PATTERNS.search(str(c))), None)
    x_key = time_key or _default_x()
    if not x_key:
        return None

    y_keys = [c for c in numeric_cols if c != x_key]
    if not y_keys:
        return None

    if len(rows) <= 12 and categorical_cols:
        return {"type": "pie", "x_key": x_key, "y_keys": y_keys[:1]}
    if time_key:
        return {"type": "line", "x_key": x_key, "y_keys": y_keys[:3]}
    return {"type": "bar", "x_key": x_key, "y_keys": y_keys[:3]}


def _build_chart_data(rows: List[dict], chart_cfg: Dict[str, Any], max_points: int = 60) -> List[dict]:
    x_key = chart_cfg["x_key"]
    y_keys = chart_cfg["y_keys"]
    buckets: Dict[str, Dict[str, float]] = {}

    for row in rows:
        label_raw = row.get(x_key)
        label = "NULL" if label_raw is None else str(label_raw)
        bucket = buckets.setdefault(label, {y: 0.0 for y in y_keys})
        for y in y_keys:
            value = _to_float(row.get(y))
            if value is not None:
                bucket[y] += value

    data: List[dict] = []
    for label, metrics in list(buckets.items())[:max_points]:
        item: dict = {"label": label}
        for y in y_keys:
            item[y] = round(float(metrics.get(y, 0.0)), 6)
        data.append(item)
    return data


def build_report_chart_preview(columns: List[str], rows: List[dict], requested_type: str = "auto") -> Dict[str, Any]:
    chart_cfg = _infer_chart_config(columns, rows, requested_type=requested_type)
    if not chart_cfg:
        return {}
    data = _build_chart_data(rows, chart_cfg)
    if not data:
        return {}
    return {
        "chart_type": chart_cfg["type"],
        "x_key": chart_cfg["x_key"],
        "y_keys": chart_cfg["y_keys"],
        "data": data,
    }


def _render_chart_png(chart_preview: Dict[str, Any], title: Optional[str] = None) -> Optional[bytes]:
    if not chart_preview:
        return None
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except Exception as e:
        logger.warning(f"matplotlib not available, skipping chart rendering: {e}")
        return None

    chart_type = chart_preview.get("chart_type")
    x_key = chart_preview.get("x_key")
    y_keys = chart_preview.get("y_keys") or []
    data = chart_preview.get("data") or []
    if not x_key or not y_keys or not data:
        return None

    labels = [str(item.get("label", "")) for item in data]
    fig, ax = plt.subplots(figsize=(10, 4.6), dpi=120)
    palette = ["#6366f1", "#22c55e", "#f59e0b", "#ec4899", "#14b8a6"]

    try:
        if chart_type == "pie":
            y = y_keys[0]
            values = [max(0.0, float(item.get(y, 0.0))) for item in data][:12]
            pie_labels = labels[:12]
            if not any(values):
                return None
            ax.pie(values, labels=pie_labels, autopct="%1.0f%%")
        elif chart_type == "line":
            for idx, y in enumerate(y_keys):
                series = [float(item.get(y, 0.0)) for item in data]
                ax.plot(labels, series, label=y, linewidth=2, color=palette[idx % len(palette)])
            if len(y_keys) > 1:
                ax.legend()
            ax.grid(alpha=0.25)
        elif chart_type == "area":
            for idx, y in enumerate(y_keys):
                series = [float(item.get(y, 0.0)) for item in data]
                ax.fill_between(labels, series, alpha=0.25, color=palette[idx % len(palette)])
                ax.plot(labels, series, linewidth=1.8, color=palette[idx % len(palette)], label=y)
            if len(y_keys) > 1:
                ax.legend()
            ax.grid(alpha=0.25)
        else:  # bar default
            width = 0.8 / max(1, len(y_keys))
            positions = list(range(len(labels)))
            for idx, y in enumerate(y_keys):
                series = [float(item.get(y, 0.0)) for item in data]
                offset = (idx - (len(y_keys) - 1) / 2.0) * width
                bar_positions = [p + offset for p in positions]
                ax.bar(bar_positions, series, width=width, label=y, color=palette[idx % len(palette)])
            ax.set_xticks(positions)
            ax.set_xticklabels(labels)
            if len(y_keys) > 1:
                ax.legend()
            ax.grid(axis="y", alpha=0.25)

        if title:
            ax.set_title(str(title))
        ax.set_xlabel(str(x_key))
        ax.tick_params(axis="x", labelrotation=25)
        fig.tight_layout()

        output = io.BytesIO()
        fig.savefig(output, format="png")
        output.seek(0)
        return output.read()
    except Exception as e:
        logger.warning(f"Failed to render chart PNG: {e}")
        return None
    finally:
        try:
            plt.close(fig)
        except Exception:
            pass


def render_report_chart_png_base64(
    columns: List[str],
    rows: List[dict],
    requested_type: str = "auto",
    title: Optional[str] = None,
) -> Dict[str, Any]:
    import base64

    preview = build_report_chart_preview(columns, rows, requested_type=requested_type)
    png_bytes = _render_chart_png(preview, title=title)
    if not png_bytes:
        return {"chart": preview, "png_base64": None}
    return {
        "chart": preview,
        "png_base64": base64.b64encode(png_bytes).decode(),
    }


def _build_summary_fallback(schedule_name: str, result: Dict[str, Any], report_description: Optional[str]) -> str:
    columns = result.get("columns", []) or []
    rows = result.get("rows", []) or []
    row_count = int(result.get("row_count") or len(rows))
    prefix = report_description.strip() if report_description else f"Report '{schedule_name}' summary"
    if not columns:
        return f"{prefix}: no rows returned."

    sample_row = rows[0] if rows else {}
    sample_pairs = []
    for col in columns[:4]:
        sample_pairs.append(f"{col}={_format_email_cell_value(sample_row.get(col))}")
    sample_text = ", ".join(sample_pairs)
    return f"{prefix}: {row_count} rows across {len(columns)} columns. Sample: {sample_text}".strip()


def generate_report_summary_text(
    schedule_name: str,
    sql_text: str,
    result: Dict[str, Any],
    report_description: Optional[str] = None,
) -> str:
    api_key = os.getenv("OPENAI_API_KEY", "")
    if not api_key:
        return _build_summary_fallback(schedule_name, result, report_description)

    try:
        import openai

        columns = result.get("columns", []) or []
        rows = result.get("rows", []) or []
        row_count = int(result.get("row_count") or len(rows))
        sample_rows = rows[:20]
        payload = {
            "schedule_name": schedule_name,
            "report_description": report_description or "",
            "sql": sql_text,
            "row_count": row_count,
            "columns": columns,
            "sample_rows": sample_rows,
        }
        system_prompt = (
            "You are a data analyst writing concise business report summaries for email. "
            "Write 2-4 short sentences in plain text. Mention what the report represents, key trend/outcome if visible, "
            "and keep it factual without speculation."
        )
        user_prompt = json.dumps(payload, default=str)

        client = openai.OpenAI(api_key=api_key)
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            temperature=0.2,
            max_tokens=250,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        )
        text = (response.choices[0].message.content or "").strip()
        if not text:
            return _build_summary_fallback(schedule_name, result, report_description)
        return text[:1200]
    except Exception as e:
        logger.warning(f"Failed to generate report summary text via LLM: {e}")
        return _build_summary_fallback(schedule_name, result, report_description)


def _rows_to_html_table(columns: List[str], rows: List[dict], max_rows: int = 200) -> str:
    if not columns:
        return "<p>No rows returned.</p>"

    preview_rows = rows[:max_rows]
    header_html = "".join(
        f"<th style='border:1px solid #ddd;padding:6px;text-align:left;background:#f7f7f7'>{html.escape(str(column))}</th>"
        for column in columns
    )

    body_rows: List[str] = []
    for row in preview_rows:
        cell_html = "".join(
            f"<td style='border:1px solid #ddd;padding:6px;vertical-align:top'>{html.escape(_format_email_cell_value(row.get(column)))}</td>"
            for column in columns
        )
        body_rows.append(f"<tr>{cell_html}</tr>")

    table_html = (
        "<div style='overflow-x:auto'>"
        "<table style='border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:12px'>"
        f"<thead><tr>{header_html}</tr></thead>"
        f"<tbody>{''.join(body_rows)}</tbody>"
        "</table>"
        "</div>"
    )

    hidden_rows = len(rows) - len(preview_rows)
    if hidden_rows > 0:
        table_html += f"<p>Showing first {len(preview_rows)} of {len(rows)} rows.</p>"

    return table_html


def _build_schedule_email_html(
    schedule_name: str,
    result: Dict[str, Any],
    include_csv_note: bool,
    summary_text: Optional[str] = None,
    report_description: Optional[str] = None,
    chart_image_base64: Optional[str] = None,
) -> str:
    row_count = int(result.get("row_count") or 0)
    table_html = _rows_to_html_table(result.get("columns", []), result.get("rows", []))
    csv_note_html = "<p>Full result is attached as CSV.</p>" if include_csv_note else ""
    summary_html = (
        f"<p style='white-space:pre-line'>{html.escape(summary_text)}</p>"
        if summary_text else ""
    )
    description_html = (
        f"<p><strong>Description:</strong> {html.escape(report_description)}</p>"
        if report_description else ""
    )
    chart_html = (
        f"<div style='margin:12px 0'><img alt='Report chart' style='max-width:100%;height:auto;border:1px solid #ddd;border-radius:6px' "
        f"src='data:image/png;base64,{chart_image_base64}'/></div>"
        if chart_image_base64 else ""
    )

    return (
        f"<h2>{html.escape(str(schedule_name))}</h2>"
        f"<p>{row_count} rows returned.</p>"
        f"{description_html}"
        f"{summary_html}"
        f"{chart_html}"
        f"{csv_note_html}"
        f"{table_html}"
    )

# ---------------------------------------------------------------------------
# Scheduled query execution
# ---------------------------------------------------------------------------
def _compute_next_run(schedule: dict) -> datetime:
    """Compute next_run_at from schedule definition."""
    now = datetime.now(timezone.utc)
    stype = schedule["schedule_type"]
    time_parts = str(schedule["schedule_time"]).split(":")
    hour, minute = int(time_parts[0]), int(time_parts[1])

    if stype == "daily":
        candidate = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
        if candidate <= now:
            candidate += timedelta(days=1)
        return candidate
    elif stype == "weekly":
        dow = schedule.get("schedule_day_of_week", 0)
        days_ahead = dow - now.weekday()
        if days_ahead < 0 or (days_ahead == 0 and now.hour * 60 + now.minute >= hour * 60 + minute):
            days_ahead += 7
        candidate = (now + timedelta(days=days_ahead)).replace(hour=hour, minute=minute, second=0, microsecond=0)
        return candidate
    else:  # monthly
        dom = schedule.get("schedule_day_of_month", 1)
        candidate = now.replace(day=dom, hour=hour, minute=minute, second=0, microsecond=0)
        if candidate <= now:
            month = now.month + 1
            year = now.year
            if month > 12:
                month = 1
                year += 1
            candidate = candidate.replace(year=year, month=month)
        return candidate


async def run_scheduled_query(schedule_id: str):
    """Execute a scheduled query, record the run, send email."""
    sb = _get_supabase()
    try:
        sched = sb.table("scheduled_queries").select("*").eq("id", schedule_id).single().execute()
        if not sched.data or not sched.data.get("is_active"):
            return

        schedule = sched.data
        conn_row = sb.table("connections").select("*").eq("id", schedule["connection_id"]).single().execute()
        if not conn_row.data:
            logger.error(f"Connection {schedule['connection_id']} not found for schedule {schedule_id}")
            return

        # Decrypt credentials if needed
        password = conn_row.data.get("password", "")
        if password:
            try:
                dec = sb.rpc("decrypt_credential", {"encrypted": password}).execute()
                if dec.data:
                    conn_row.data["password"] = dec.data
            except Exception:
                pass

        # Create run record
        run = sb.table("scheduled_query_runs").insert({
            "schedule_id": schedule_id,
            "status": "running",
        }).execute()
        run_id = run.data[0]["id"] if run.data else None

        try:
            sql_to_run = (schedule.get("sql_final") or schedule.get("sql_text") or "").strip()
            if not sql_to_run:
                raise RuntimeError("No SQL found for scheduled report")
            result = _execute_query_on_connection(conn_row.data, sql_to_run)

            summary_text = generate_report_summary_text(
                schedule_name=schedule.get("name", "Report"),
                sql_text=sql_to_run,
                result=result,
                report_description=schedule.get("report_description"),
            )
            chart_blob = None
            include_chart = bool(schedule.get("include_chart"))
            if include_chart:
                chart_blob = render_report_chart_png_base64(
                    columns=result.get("columns", []) or [],
                    rows=result.get("rows", []) or [],
                    requested_type=schedule.get("chart_type") or "auto",
                    title=schedule.get("chart_title") or schedule.get("name"),
                )

            if run_id:
                sb.table("scheduled_query_runs").update({
                    "status": "success",
                    "row_count": result["row_count"],
                    "summary_text": summary_text,
                    "chart_generated": bool(chart_blob and chart_blob.get("png_base64")),
                    "completed_at": datetime.now(timezone.utc).isoformat(),
                }).eq("id", run_id).execute()

            # Send email with results
            recipients = schedule.get("email_recipients", [])
            if recipients:
                include_csv_attachment = schedule.get("output_format") == "csv" and bool(result["columns"])
                email_html = _build_schedule_email_html(
                    schedule_name=schedule["name"],
                    result=result,
                    include_csv_note=include_csv_attachment,
                    summary_text=summary_text,
                    report_description=schedule.get("report_description"),
                    chart_image_base64=(chart_blob or {}).get("png_base64"),
                )

                attachments = []
                if include_csv_attachment:
                    csv_content = _rows_to_csv(result["columns"], result["rows"])
                    import base64
                    attachments.append({
                        "filename": f"{schedule['name']}.csv",
                        "content": base64.b64encode(csv_content.encode()).decode(),
                    })

                if chart_blob and chart_blob.get("png_base64"):
                    attachments.append({
                        "filename": f"{schedule['name']}-chart.png",
                        "content": chart_blob["png_base64"],
                    })

                _send_email(
                    to=recipients,
                    subject=f"SQLSphere Report: {schedule['name']}",
                    html=email_html,
                    attachments=attachments or None,
                    from_email="SQLSphere Reports <report@sqlsphere.com>",
                )

            # Update schedule
            next_run = _compute_next_run(schedule)
            sb.table("scheduled_queries").update({
                "last_run_at": datetime.now(timezone.utc).isoformat(),
                "next_run_at": next_run.isoformat(),
            }).eq("id", schedule_id).execute()

        except Exception as e:
            logger.error(f"Schedule {schedule_id} execution failed: {e}")
            if run_id:
                sb.table("scheduled_query_runs").update({
                    "status": "error",
                    "error_message": str(e)[:500],
                    "completed_at": datetime.now(timezone.utc).isoformat(),
                }).eq("id", run_id).execute()

    except Exception as e:
        logger.error(f"Schedule {schedule_id} run error: {e}")


# ---------------------------------------------------------------------------
# Data alert check
# ---------------------------------------------------------------------------
async def check_data_alert(alert_id: str):
    """Check a data alert condition and notify if triggered."""
    sb = _get_supabase()
    try:
        alert_resp = sb.table("data_alerts").select("*").eq("id", alert_id).single().execute()
        if not alert_resp.data or not alert_resp.data.get("is_active"):
            return

        alert = alert_resp.data
        conn_row = sb.table("connections").select("*").eq("id", alert["connection_id"]).single().execute()
        if not conn_row.data:
            return

        password = conn_row.data.get("password", "")
        if password:
            try:
                dec = sb.rpc("decrypt_credential", {"encrypted": password}).execute()
                if dec.data:
                    conn_row.data["password"] = dec.data
            except Exception:
                pass

        sql_to_run = (alert.get("sql_final") or alert.get("sql_text") or "").strip()
        if not sql_to_run:
            logger.error(f"Alert {alert_id} has no SQL configured")
            return

        result = _execute_query_on_connection(conn_row.data, sql_to_run)

        sb.table("data_alerts").update({
            "last_checked_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", alert_id).execute()

        # Alert triggers when query returns rows
        if result["row_count"] > 0:
            summary_text = generate_report_summary_text(
                schedule_name=alert.get("name", "Alert"),
                sql_text=sql_to_run,
                result=result,
                report_description=alert.get("nl_condition"),
            )

            sb.table("data_alerts").update({
                "last_triggered_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", alert_id).execute()

            # Create in-app notification
            sb.table("alert_notifications").insert({
                "user_id": alert["user_id"],
                "alert_id": alert_id,
                "title": f"Alert: {alert['name']}",
                "message": summary_text[:500],
            }).execute()

            # Send email
            recipients = alert.get("email_recipients", [])
            if recipients:
                _send_email(
                    to=recipients,
                    subject=f"SQLSphere Alert: {alert['name']}",
                    html=(
                        f"<h2>Alert Triggered: {html.escape(str(alert['name']))}</h2>"
                        f"<p><strong>Condition:</strong> {html.escape(str(alert.get('nl_condition') or ''))}</p>"
                        f"<p><strong>Rows matched:</strong> {int(result.get('row_count') or 0)}</p>"
                        f"<p style='white-space:pre-line'>{html.escape(summary_text)}</p>"
                    ),
                    from_email="SQLSphere Alerts <alert@sqlsphere.com>",
                )

    except Exception as e:
        logger.error(f"Alert {alert_id} check error: {e}")


# ---------------------------------------------------------------------------
# Scheduler lifecycle
# ---------------------------------------------------------------------------
scheduler: Optional[AsyncIOScheduler] = None


async def start_scheduler():
    """Load all active schedules and alerts from DB and start APScheduler."""
    global scheduler
    scheduler = AsyncIOScheduler()

    try:
        sb = _get_supabase()

        # Load active scheduled queries
        schedules = sb.table("scheduled_queries").select("*").eq("is_active", True).execute()
        for sched in (schedules.data or []):
            _add_schedule_job(sched)
            # Catch up missed runs
            next_run = sched.get("next_run_at")
            if next_run:
                try:
                    nrt = datetime.fromisoformat(next_run.replace("Z", "+00:00"))
                    if nrt < datetime.now(timezone.utc):
                        logger.info(f"Catching up missed schedule {sched['id']}")
                        await run_scheduled_query(sched["id"])
                except Exception:
                    pass

        # Load active alerts
        alerts = sb.table("data_alerts").select("*").eq("is_active", True).execute()
        for alert in (alerts.data or []):
            _add_alert_job(alert)

        scheduler.start()
        logger.info(f"Scheduler started with {len(schedules.data or [])} schedules and {len(alerts.data or [])} alerts")

    except Exception as e:
        logger.error(f"Failed to start scheduler: {e}")
        scheduler.start()  # Start anyway so new jobs can be added


async def stop_scheduler():
    """Shut down the scheduler gracefully."""
    global scheduler
    if scheduler:
        scheduler.shutdown(wait=False)
        scheduler = None
        logger.info("Scheduler stopped")


def _add_schedule_job(schedule: dict):
    """Register a scheduled query as an APScheduler job."""
    if not scheduler:
        return
    job_id = f"schedule_{schedule['id']}"
    stype = schedule["schedule_type"]
    time_parts = str(schedule["schedule_time"]).split(":")
    hour, minute = int(time_parts[0]), int(time_parts[1])

    if stype == "daily":
        trigger = CronTrigger(hour=hour, minute=minute)
    elif stype == "weekly":
        dow = schedule.get("schedule_day_of_week", 0)
        trigger = CronTrigger(day_of_week=dow, hour=hour, minute=minute)
    else:  # monthly
        dom = schedule.get("schedule_day_of_month", 1)
        trigger = CronTrigger(day=dom, hour=hour, minute=minute)

    scheduler.add_job(
        run_scheduled_query,
        trigger=trigger,
        args=[schedule["id"]],
        id=job_id,
        replace_existing=True,
    )


def _add_alert_job(alert: dict):
    """Register a data alert check as an APScheduler job."""
    if not scheduler:
        return
    job_id = f"alert_{alert['id']}"
    interval = alert.get("check_interval_minutes", 60)
    scheduler.add_job(
        check_data_alert,
        trigger=IntervalTrigger(minutes=interval),
        args=[alert["id"]],
        id=job_id,
        replace_existing=True,
    )


def remove_job(job_id: str):
    """Remove a job from the scheduler."""
    if scheduler:
        try:
            scheduler.remove_job(job_id)
        except Exception:
            pass
