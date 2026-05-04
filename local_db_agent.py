#!/usr/bin/env python3
"""
Local Database Agent
Connects to backend via WebSocket and executes SQL queries on local database.
"""

import asyncio
import json
import sys
import argparse
from typing import Optional, Dict, Any, Callable
import logging
from datetime import datetime
import websockets
try:
    from websockets.client import connect
except ImportError:
    # Fallback for older websockets versions
    from websockets import connect

# Database drivers - these should be installed and included in the build
import pyodbc
import mysql.connector
import psycopg2

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class LocalDBAgent:
    """Local database agent that connects to backend and executes SQL queries."""
    
    def __init__(self, connection_code: str, websocket_url: str, db_type: str,
                 connection_string: Optional[str] = None,
                 status_callback: Optional[Callable[[str], None]] = None,
                 **db_params):
        self.connection_code = connection_code
        self.websocket_url = websocket_url
        self.db_type = db_type.lower()
        self.connection_string = connection_string
        self.db_params = db_params
        self.websocket = None
        self.connection = None
        self.running = False
        self._status_callback = status_callback

    def _notify_status(self, status: str):
        """Notify status callback if one is registered."""
        if self._status_callback:
            try:
                self._status_callback(status)
            except Exception:
                pass

    def connect_to_database(self):
        """Connect to local database."""
        try:
            if self.db_type == "sqlserver":
                if self.connection_string:
                    self.connection = pyodbc.connect(self.connection_string)
                else:
                    # Build connection string from params
                    driver = self.db_params.get("driver", "ODBC Driver 17 for SQL Server")
                    server = self.db_params.get("server", "localhost")
                    database = self.db_params.get("database")
                    username = self.db_params.get("username")
                    password = self.db_params.get("password")
                    
                    conn_str = (
                        f"DRIVER={{{driver}}};"
                        f"SERVER={server};"
                        f"DATABASE={database};"
                        f"UID={username};"
                        f"PWD={password};"
                    )
                    self.connection = pyodbc.connect(conn_str)
                    
            elif self.db_type == "mysql":
                host = self.db_params.get("host", "localhost")
                port = self.db_params.get("port", 3306)
                database = self.db_params.get("database")
                username = self.db_params.get("username")
                password = self.db_params.get("password")
                
                self.connection = mysql.connector.connect(
                    host=host,
                    port=port,
                    database=database,
                    user=username,
                    password=password
                )
                self.connection.autocommit = True
                
            elif self.db_type == "postgresql":
                host = self.db_params.get("host", "localhost")
                port = self.db_params.get("port", 5432)
                database = self.db_params.get("database")
                username = self.db_params.get("username")
                password = self.db_params.get("password")
                
                self.connection = psycopg2.connect(
                    host=host,
                    port=port,
                    database=database,
                    user=username,
                    password=password
                )
                self.connection.autocommit = True
            else:
                raise ValueError(f"Unsupported database type: {self.db_type}")
            
            logger.info(f"Connected to local {self.db_type} database")
            return True
            
        except Exception as e:
            error_msg = str(e)
            # Provide more detailed error information
            if "Access denied" in error_msg or "authentication failed" in error_msg.lower():
                detailed_error = f"Authentication failed: {error_msg}\n\nPlease check:\n- Username: {self.db_params.get('username', 'N/A')}\n- Password: (hidden)\n- Database: {self.db_params.get('database', 'N/A')}"
            elif "Unknown database" in error_msg or "database" in error_msg.lower() and "does not exist" in error_msg.lower():
                detailed_error = f"Database not found: {error_msg}\n\nPlease check:\n- Database name: {self.db_params.get('database', 'N/A')}\n- Ensure the database exists"
            elif "Can't connect" in error_msg or "Connection refused" in error_msg or "timed out" in error_msg.lower():
                detailed_error = f"Connection failed: {error_msg}\n\nPlease check:\n- Host: {self.db_params.get('host', 'N/A')}\n- Port: {self.db_params.get('port', 'N/A')}\n- Ensure the database server is running"
            else:
                detailed_error = f"Database connection error: {error_msg}\n\nConnection details:\n- Type: {self.db_type}\n- Host: {self.db_params.get('host', 'N/A')}\n- Port: {self.db_params.get('port', 'N/A')}\n- Database: {self.db_params.get('database', 'N/A')}\n- Username: {self.db_params.get('username', 'N/A')}"
            
            logger.error(detailed_error)
            raise ConnectionError(detailed_error)
    
    def _convert_row_value(self, value):
        """Convert a row value to a JSON-serializable type."""
        if isinstance(value, (datetime,)):
            return value.isoformat()
        elif hasattr(value, 'isoformat'):  # date
            return value.isoformat()
        elif hasattr(value, '__float__') and not isinstance(value, (int, float)):  # Decimal
            return float(value)
        return value

    def _execute_single(self, cursor, sql: str) -> Dict[str, Any]:
        """Execute a single SQL statement and return the result."""
        cursor.execute(sql)

        if cursor.description:
            columns = [desc[0] for desc in cursor.description]
            rows = cursor.fetchall()
            results = [
                {col: self._convert_row_value(row[i]) for i, col in enumerate(columns)}
                for row in rows
            ]
            return {
                "success": True,
                "columns": columns,
                "results": results,
                "row_count": len(results)
            }
        else:
            row_count = cursor.rowcount if hasattr(cursor, 'rowcount') else 0
            return {
                "success": True,
                "columns": [],
                "results": [],
                "row_count": row_count,
                "message": f"Query executed successfully. {row_count} row(s) affected."
            }

    def _split_statements(self, sql: str) -> list:
        """Split SQL into individual statements, respecting quoted strings."""
        statements = []
        current = []
        in_single_quote = False
        in_double_quote = False
        i = 0
        while i < len(sql):
            ch = sql[i]
            if ch == "'" and not in_double_quote:
                # Check for escaped quote ''
                if in_single_quote and i + 1 < len(sql) and sql[i + 1] == "'":
                    current.append("''")
                    i += 2
                    continue
                in_single_quote = not in_single_quote
            elif ch == '"' and not in_single_quote:
                in_double_quote = not in_double_quote
            elif ch == ';' and not in_single_quote and not in_double_quote:
                stmt = ''.join(current).strip()
                if stmt:
                    statements.append(stmt)
                current = []
                i += 1
                continue
            current.append(ch)
            i += 1
        # Last statement (no trailing semicolon)
        stmt = ''.join(current).strip()
        if stmt:
            statements.append(stmt)
        return statements

    def execute_sql(self, sql: str) -> Dict[str, Any]:
        """Execute SQL query and return results. Automatically reconnects if connection is lost.
        Supports multi-statement SQL by splitting and executing each statement individually."""
        # Check if connection is still alive, reconnect if needed
        if not self.connection:
            logger.warning("Database connection lost, attempting to reconnect...")
            if not self.connect_to_database():
                return {"success": False, "error": "Not connected to database and reconnection failed"}

        # Split into individual statements to avoid "Commands out of sync" errors
        statements = self._split_statements(sql)
        if not statements:
            return {"success": False, "error": "Empty SQL query"}

        cursor = None
        try:
            cursor = self.connection.cursor()

            # Single statement — fast path
            if len(statements) == 1:
                result = self._execute_single(cursor, statements[0])
                if not result.get("columns") and hasattr(self.connection, 'commit'):
                    self.connection.commit()
                cursor.close()
                return result

            # Multi-statement — execute each, return last meaningful result
            total_rows_affected = 0
            last_select_result = None
            messages = []

            for stmt in statements:
                stmt_upper = stmt.upper().strip()
                # Skip transaction control for autocommit connections; execute otherwise
                if stmt_upper in ("BEGIN", "START TRANSACTION"):
                    if hasattr(self.connection, 'autocommit') and self.connection.autocommit:
                        self.connection.autocommit = False
                    else:
                        cursor.execute(stmt)
                    continue
                elif stmt_upper == "COMMIT":
                    if hasattr(self.connection, 'commit'):
                        self.connection.commit()
                    if hasattr(self.connection, 'autocommit'):
                        self.connection.autocommit = True
                    continue
                elif stmt_upper == "ROLLBACK":
                    if hasattr(self.connection, 'rollback'):
                        self.connection.rollback()
                    if hasattr(self.connection, 'autocommit'):
                        self.connection.autocommit = True
                    continue

                result = self._execute_single(cursor, stmt)
                if result.get("columns"):
                    last_select_result = result
                else:
                    rc = result.get("row_count", 0)
                    total_rows_affected += rc
                    if rc > 0:
                        messages.append(f"{stmt_upper.split()[0]}: {rc} row(s)")

            cursor.close()

            # If any statement returned SELECT results, return those
            if last_select_result:
                return last_select_result

            return {
                "success": True,
                "columns": [],
                "results": [],
                "row_count": total_rows_affected,
                "message": f"Query executed successfully. {total_rows_affected} row(s) affected."
                           + (f" ({', '.join(messages)})" if messages else "")
            }

        except Exception as e:
            error_msg = str(e)
            logger.error(f"SQL execution error: {error_msg}")

            # Try to rollback any open transaction
            try:
                if hasattr(self.connection, 'rollback'):
                    self.connection.rollback()
                if hasattr(self.connection, 'autocommit'):
                    self.connection.autocommit = True
            except:
                pass

            # Check if it's a connection error - try to reconnect once
            if any(keyword in error_msg.lower() for keyword in ["connection", "lost", "closed", "timeout", "broken"]):
                logger.warning("Database connection error detected, attempting to reconnect...")
                if cursor:
                    try:
                        cursor.close()
                    except:
                        pass
                try:
                    if self.connection:
                        try:
                            self.connection.close()
                        except:
                            pass
                    self.connection = None
                    if self.connect_to_database():
                        logger.info("Database reconnection successful, retrying query...")
                        return self.execute_sql(sql)
                    else:
                        return {"success": False, "error": "Database reconnection failed"}
                except Exception as reconnect_error:
                    logger.error(f"Failed to reconnect to database: {reconnect_error}")
                    return {"success": False, "error": f"Database connection error and reconnection failed: {error_msg}"}

            # For non-connection errors, close cursor if it exists and return the error
            if cursor:
                try:
                    cursor.close()
                except:
                    pass
            return {"success": False, "error": error_msg}
    
    async def send_heartbeat(self):
        """Send heartbeat to backend."""
        if self.websocket and self.running:
            try:
                await self.websocket.send(json.dumps({
                    "type": "heartbeat"
                }))
                logger.debug("Heartbeat sent successfully")
            except websockets.exceptions.ConnectionClosed:
                logger.warning("WebSocket connection closed while sending heartbeat")
                self.running = False
            except Exception as e:
                logger.error(f"Failed to send heartbeat: {e}")
                # If heartbeat fails, connection might be dead
                self.running = False
    
    async def send_agent_info(self):
        """Send agent information to backend."""
        if self.websocket:
            try:
                await self.websocket.send(json.dumps({
                    "type": "agent_info",
                    "db_type": self.db_type,
                    "db_name": self.db_params.get("database", "unknown")
                }))
            except Exception as e:
                logger.error(f"Failed to send agent info: {e}")
    
    async def handle_job(self, job_data: Dict):
        """Handle a job from backend. Errors in job execution don't break the connection."""
        job_id = job_data.get("job_id")
        sql = job_data.get("sql")
        
        if not job_id or not sql:
            logger.error(f"Invalid job data: job_id={job_id}, sql={'present' if sql else 'missing'}")
            return
        
        logger.info(f"Executing job {job_id}: {sql[:100]}...")
        
        # Execute SQL - errors are caught and returned, not raised
        try:
            result = self.execute_sql(sql)
        except Exception as e:
            # If execute_sql itself fails (shouldn't happen, but be safe)
            logger.error(f"Unexpected error executing SQL for job {job_id}: {e}")
            result = {
                "success": False,
                "error": f"Unexpected error: {str(e)}"
            }
        
        # Send result back - errors here don't break the connection
        if self.websocket:
            max_retries = 3
            retry_delay = 0.5
            for attempt in range(max_retries):
                try:
                    # Check if websocket is still open before sending
                    if hasattr(self.websocket, 'closed') and self.websocket.closed:
                        if attempt < max_retries - 1:
                            logger.warning(f"WebSocket closed for job {job_id}, waiting {retry_delay}s before retry {attempt + 1}/{max_retries}")
                            await asyncio.sleep(retry_delay)
                            continue
                        else:
                            logger.warning(f"Cannot send job result - WebSocket is closed for job {job_id} after {max_retries} attempts")
                            return
                    
                    await self.websocket.send(json.dumps({
                        "type": "job_result",
                        "job_id": job_id,
                        "result": result if result.get("success") else None,
                        "error": result.get("error") if not result.get("success") else None
                    }))
                    logger.info(f"Job {job_id} completed (success: {result.get('success', False)})")
                    return  # Successfully sent
                except websockets.exceptions.ConnectionClosed:
                    if attempt < max_retries - 1:
                        logger.warning(f"WebSocket closed while sending job result for {job_id}, retrying in {retry_delay}s (attempt {attempt + 1}/{max_retries})")
                        await asyncio.sleep(retry_delay)
                        continue
                    else:
                        logger.warning(f"WebSocket closed while sending job result for {job_id} after {max_retries} attempts - connection will be reestablished")
                        # Don't raise - let the outer loop handle reconnection
                        return
                except Exception as e:
                    if attempt < max_retries - 1:
                        logger.warning(f"Failed to send job result for {job_id} (attempt {attempt + 1}/{max_retries}): {e}, retrying in {retry_delay}s")
                        await asyncio.sleep(retry_delay)
                        continue
                    else:
                        logger.error(f"Failed to send job result for {job_id} after {max_retries} attempts: {e} - connection will continue")
                        # Don't raise - individual job failures don't break the connection
                        return
    
    async def run(self):
        """Main agent loop with auto-reconnect."""
        self.running = True
        
        # Connect to database (only once, keep connection alive)
        if not self.connect_to_database():
            error_msg = "Failed to connect to local database. Please check your credentials and ensure the database is running."
            logger.error(error_msg)
            raise ConnectionError(error_msg)
        
        # Auto-reconnect loop - keep trying to connect and stay connected
        max_reconnect_attempts = None  # Infinite retries
        reconnect_delay = 5  # Wait 5 seconds between reconnection attempts
        attempt = 0
        
        while self.running:
            try:
                attempt += 1
                if attempt > 1:
                    self._notify_status("connecting")
                    logger.info(f"Reconnection attempt {attempt}...")
                    await asyncio.sleep(reconnect_delay)
                
                # Connect to backend WebSocket
                logger.info(f"Attempting to connect to backend: {self.websocket_url}")
                # For wss:// connections, we need to disable SSL verification
                # This is necessary for PyInstaller bundles that don't include full cert chain
                # Railway uses valid certificates, but the bundle can't verify them
                import ssl
                ssl_context = None
                if self.websocket_url.startswith("wss://"):
                    ssl_context = ssl.create_default_context()
                    ssl_context.check_hostname = False
                    ssl_context.verify_mode = ssl.CERT_NONE
                    if attempt == 1:  # Only log warning on first attempt
                        logger.warning("SSL verification disabled for WebSocket connection (PyInstaller bundle limitation)")
                
                # Connect with SSL context (or None for ws://)
                async with connect(self.websocket_url, ssl=ssl_context) as websocket:
                    self.websocket = websocket
                    self._notify_status("connected")
                    logger.info(f"✅ Successfully connected to backend: {self.websocket_url}")
                    
                    # Send agent info
                    logger.info("Sending agent info to backend...")
                    await self.send_agent_info()
                    logger.info("Agent info sent successfully")
                    
                    # Request pending jobs
                    logger.info("Requesting pending jobs...")
                    await websocket.send(json.dumps({"type": "request_jobs"}))
                    logger.info("✅ Pending jobs requested. Agent is now ready and waiting for jobs...")
                    
                    # Start heartbeat task
                    heartbeat_task = asyncio.create_task(self._heartbeat_loop())
                    
                    # Main message loop
                    try:
                        while self.running:
                            try:
                                message = await asyncio.wait_for(websocket.recv(), timeout=30.0)
                                data = json.loads(message)
                                
                                msg_type = data.get("type")
                                
                                if msg_type == "job":
                                    job_id = data.get("job_id")
                                    sql_preview = data.get("sql", "")[:50] if data.get("sql") else "N/A"
                                    logger.info(f"Received job {job_id} from backend (SQL preview: {sql_preview}...)")
                                    await self.handle_job(data)
                                elif msg_type == "heartbeat_ack":
                                    pass  # Heartbeat acknowledged
                                elif msg_type == "job_ack":
                                    # Job result acknowledged by backend
                                    job_id = data.get("job_id")
                                    if job_id:
                                        logger.debug(f"Job {job_id} result acknowledged by backend")
                                    pass
                                elif msg_type == "info_ack":
                                    # Agent info acknowledged by backend
                                    pass
                                elif msg_type == "error":
                                    logger.error(f"Backend error: {data.get('message')}")
                                else:
                                    logger.warning(f"Unknown message type: {msg_type}")
                                    
                            except asyncio.TimeoutError:
                                # Timeout - send heartbeat to keep connection alive
                                try:
                                    if self.websocket:
                                        await self.send_heartbeat()
                                except websockets.exceptions.ConnectionClosed:
                                    logger.warning("WebSocket closed while sending heartbeat - will reconnect")
                                    break  # Break inner loop to reconnect
                                except Exception as e:
                                    logger.error(f"Failed to send heartbeat: {e} - will reconnect")
                                    break  # Break inner loop to reconnect
                            except websockets.exceptions.ConnectionClosed as e:
                                logger.warning(f"WebSocket connection closed: {e.code} - {e.reason}. Will reconnect...")
                                break  # Break inner loop to reconnect
                            except websockets.exceptions.InvalidStatusCode as e:
                                logger.error(f"WebSocket connection failed with status {e.status_code}: {e.headers}")
                                # Don't reconnect for invalid status codes - these are permanent errors
                                raise
                            except Exception as e:
                                logger.error(f"Error in message loop: {type(e).__name__}: {e}")
                                import traceback
                                logger.error(traceback.format_exc())
                                # Don't break on general errors - continue processing messages
                                # Only break if it's a connection error
                                if isinstance(e, (websockets.exceptions.ConnectionClosed, websockets.exceptions.InvalidStatusCode)):
                                    break
                                # For other errors, continue the loop
                                continue
                                
                    finally:
                        # Clean up heartbeat task
                        heartbeat_task.cancel()
                        try:
                            await heartbeat_task
                        except asyncio.CancelledError:
                            pass
                        
                    # If we get here, the connection was closed - will reconnect in outer loop
                    self._notify_status("disconnected")
                    logger.info("WebSocket connection closed, will attempt to reconnect...")
                        
            except websockets.exceptions.InvalidURI as e:
                error_msg = f"Invalid WebSocket URL: {self.websocket_url}\nError: {e}"
                logger.error(error_msg)
                # Invalid URI is a permanent error - don't retry
                raise ConnectionError(error_msg)
            except websockets.exceptions.InvalidStatusCode as e:
                error_msg = f"WebSocket connection failed: HTTP {e.status_code}\nURL: {self.websocket_url}\nHeaders: {e.headers}"
                logger.error(error_msg)
                # Invalid status code is a permanent error - don't retry
                raise ConnectionError(error_msg)
            except KeyboardInterrupt:
                logger.info("Agent stopped by user")
                self.running = False
                break
            except Exception as e:
                # For other exceptions, log and retry
                self._notify_status("disconnected")
                logger.error(f"Unexpected error in agent loop: {type(e).__name__}: {e}")
                import traceback
                logger.error(traceback.format_exc())
                if not self.running:
                    break
                # Continue to retry connection
                continue
        
        # Cleanup when agent stops
        self.running = False
        if self.connection:
            try:
                self.connection.close()
            except:
                pass
    
    async def _heartbeat_loop(self):
        """Send periodic heartbeats."""
        while self.running:
            try:
                await asyncio.sleep(10)  # Send heartbeat every 10 seconds (Railway/proxy may close ~60s idle)
                if self.running and self.websocket:
                    try:
                        # Check if websocket is still open
                        if hasattr(self.websocket, 'closed') and self.websocket.closed:
                            logger.warning("WebSocket is closed, stopping heartbeat")
                            break
                        await self.send_heartbeat()
                    except websockets.exceptions.ConnectionClosed:
                        logger.warning("WebSocket connection closed during heartbeat")
                        break
                    except Exception as e:
                        logger.error(f"Error sending heartbeat: {e}")
                        break
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in heartbeat loop: {e}")
                break

def _is_gui_mode() -> bool:
    """Determine whether we should launch in GUI mode."""
    # Explicit CLI args → CLI mode
    if "--connection-code" in sys.argv:
        return False
    # No args, --gui, -g, or --minimized → GUI mode
    return len(sys.argv) == 1 or any(
        flag in sys.argv for flag in ("--gui", "-g", "--minimized")
    )


def _run_gui():
    """Launch the CustomTkinter GUI with optional tray icon."""
    from config_manager import load_config

    start_minimized = "--minimized" in sys.argv
    config = load_config() or {}
    auto_start = config.get("auto_start", False)
    if config.get("start_minimized", False):
        start_minimized = True

    from agent_gui import AgentGUI

    # Try to set up tray icon
    # On macOS, pystray and Tk both fight over NSApplication's menu system
    # from different threads, causing "Menu should have been unscheduled for
    # updating" crashes.  The .app Dock icon already lets users restore the
    # window, so we skip pystray entirely on macOS.
    tray = None
    gui_holder: list = [None]

    if sys.platform != "darwin":
        try:
            from tray_icon import AgentTrayIcon, TRAY_AVAILABLE
            if TRAY_AVAILABLE:
                def on_open_settings():
                    if gui_holder[0]:
                        gui_holder[0].after(0, gui_holder[0].show_window)

                def on_quit():
                    if gui_holder[0]:
                        gui_holder[0].after(0, gui_holder[0].quit_app)

                tray = AgentTrayIcon(on_open_settings=on_open_settings, on_quit=on_quit)
                tray.run()
        except ImportError:
            pass

    gui = AgentGUI(tray=tray, start_minimized=start_minimized, auto_start=auto_start)
    gui_holder[0] = gui
    gui.mainloop()


def main():
    """Main entry point."""
    if _is_gui_mode():
        try:
            import customtkinter  # noqa: F401 — check availability
            _run_gui()
            return
        except ImportError:
            pass  # Fall back to CLI

    parser = argparse.ArgumentParser(description="Local Database Agent")
    parser.add_argument("--connection-code", required=True, help="Connection code from backend")
    parser.add_argument("--websocket-url", required=True, help="WebSocket URL to backend")
    parser.add_argument("--db-type", required=True, choices=["sqlserver", "mysql", "postgresql"],
                       help="Database type")
    parser.add_argument("--connection-string", help="ODBC connection string (for SQL Server)")
    parser.add_argument("--host", default="localhost", help="Database host")
    parser.add_argument("--port", type=int, help="Database port")
    parser.add_argument("--database", required=True, help="Database name")
    parser.add_argument("--username", required=True, help="Database username")
    parser.add_argument("--password", required=True, help="Database password")
    parser.add_argument("--driver", help="ODBC driver name (for SQL Server)")

    args = parser.parse_args()

    db_params = {
        "host": args.host,
        "database": args.database,
        "username": args.username,
        "password": args.password
    }

    if args.port:
        db_params["port"] = args.port
    if args.driver:
        db_params["driver"] = args.driver

    agent = LocalDBAgent(
        connection_code=args.connection_code,
        websocket_url=args.websocket_url,
        db_type=args.db_type,
        connection_string=args.connection_string,
        **db_params
    )

    try:
        asyncio.run(agent.run())
    except KeyboardInterrupt:
        logger.info("Agent stopped by user")
    except Exception as e:
        logger.error(f"Agent error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()

