# connection_manager.py
# Manages database connections with user-provided credentials

import os
import uuid
import tempfile
import logging
from datetime import datetime, timedelta
from typing import Dict, Optional, Any

import mysql.connector  # type: ignore
import pyodbc
from sshtunnel import SSHTunnelForwarder
from models import DatabaseConnection

logger = logging.getLogger(__name__)

# In-memory session storage (for development)
# In production, use Redis, Supabase, or encrypted database
sessions: Dict[str, dict] = {}

# Session expiry time
SESSION_EXPIRY_HOURS = 2


class LocalAgentConnection:
    """Marker connection used when DB traffic is routed via local agent."""

    def __init__(self, connection_code: Optional[str], db_type: str):
        self.connection_code = connection_code
        self.db_type = db_type
        self.is_local_agent = True

    def close(self):
        pass  # No-op for local agent connections


class TunnelManagedConnection:
    """Proxy DB connection that closes SSH tunnel together with DB connection."""

    def __init__(self, conn: Any, tunnel: SSHTunnelForwarder):
        self._conn = conn
        self._tunnel = tunnel

    def __getattr__(self, item):
        return getattr(self._conn, item)

    def close(self):
        try:
            self._conn.close()
        finally:
            try:
                self._tunnel.stop()
            except Exception:
                pass


def _validate_capabilities(conn_params: DatabaseConnection) -> None:
    """Validate DB-type specific connection/auth/SSL capabilities."""
    db_type = conn_params.type
    method = conn_params.connection_method or "standard"
    auth = conn_params.auth_method or "sql_auth"

    supported_methods = {
        "mysql": {"standard", "ssh", "socket", "pipe"},
        "postgresql": {"standard", "ssh", "socket"},
        "sqlserver": {"standard", "ssh", "pipe"},
        "oracle": {"standard", "ssh"},
    }

    supported_auth = {
        "mysql": {"sql_auth", "ssl_cert", "aws_iam", "connection_string"},
        "postgresql": {"sql_auth", "ssl_cert", "aws_iam", "azure_ad_password", "azure_ad_sp", "kerberos", "connection_string"},
        "sqlserver": {
            "sql_auth",
            "windows_auth",
            "azure_ad_password",
            "azure_ad_integrated",
            "azure_ad_mfa",
            "azure_ad_sp",
            "azure_ad_mi",
            "kerberos",
            "connection_string",
        },
        "oracle": {"sql_auth", "connection_string"},
    }

    allowed_methods = supported_methods.get(db_type, set())
    if method not in allowed_methods:
        raise ConnectionError(f"Connection method '{method}' is not supported for database type '{db_type}'.")

    allowed_auth = supported_auth.get(db_type, set())
    if auth not in allowed_auth:
        raise ConnectionError(f"Authentication method '{auth}' is not supported for database type '{db_type}'.")

    # Oracle SSL is supported only via custom connection strings.
    if db_type == "oracle" and auth != "connection_string":
        if conn_params.use_ssl or conn_params.ssl_mode or conn_params.ssl_ca or conn_params.ssl_ca_path or conn_params.ssl_cert or conn_params.ssl_cert_path or conn_params.ssl_key or conn_params.ssl_key_path:
            raise ConnectionError("Oracle SSL/TLS options are only supported via 'connection_string' auth mode.")

def _get_mysql_driver() -> str:
    if os.path.exists("/usr/lib/libmaodbc.so"):
        return "/usr/lib/libmaodbc.so"
    if os.path.exists("/usr/lib/x86_64-linux-gnu/odbc/libmaodbc.so"):
        return "/usr/lib/x86_64-linux-gnu/odbc/libmaodbc.so"
    if os.path.exists("/opt/homebrew/opt/mariadb-connector-odbc/lib/mariadb/libmaodbc.dylib"):
        return "/opt/homebrew/opt/mariadb-connector-odbc/lib/mariadb/libmaodbc.dylib"
    return "MySQL ODBC 8.0 Driver"


def _get_postgres_driver() -> str:
    preferred_names = [
        "PostgreSQL Unicode",
        "PostgreSQL Unicode(x64)",
        "PostgreSQL ANSI",
        "PostgreSQL",
    ]
    try:
        installed = set(pyodbc.drivers())
        for name in preferred_names:
            if name in installed:
                return name
    except Exception:
        pass

    candidates = [
        "/usr/lib/x86_64-linux-gnu/odbc/psqlodbcw.so",
        "/usr/lib/psqlodbcw.so",
        "/usr/local/lib/psqlodbcw.so",
        "/opt/homebrew/lib/psqlodbcw.so"
    ]
    for candidate in candidates:
        if os.path.exists(candidate):
            return candidate
    return "PostgreSQL Unicode"


def _get_sqlserver_driver() -> str:
    preferred_names = [
        "ODBC Driver 18 for SQL Server",
        "ODBC Driver 17 for SQL Server",
    ]
    try:
        installed = set(pyodbc.drivers())
        for name in preferred_names:
            if name in installed:
                return name
    except Exception:
        pass
    return "ODBC Driver 18 for SQL Server"


def _get_oracle_driver() -> str:
    candidates = [
        "Oracle 21 ODBC driver",
        "Oracle 19 ODBC driver",
        "Oracle in instantclient_21_1",
        "Oracle in OraClient19Home1",
        "Oracle ODBC Driver",
    ]
    for candidate in candidates:
        if os.path.exists(candidate) or not candidate.startswith("/"):
            return candidate
    return "Oracle 19 ODBC driver"


def _get_cert_path(pem_content: Optional[str], file_path: Optional[str], suffix: str) -> Optional[str]:
    """Return a filesystem path to a certificate.

    If pem_content is provided, writes it to a temp file and returns that path.
    Otherwise returns file_path as-is. Returns None if neither is set.
    The caller is responsible for tracking and deleting temp files.
    """
    if pem_content:
        tmp = tempfile.NamedTemporaryFile(mode='w', suffix=suffix, delete=False)
        tmp.write(pem_content)
        tmp.flush()
        tmp.close()
        return tmp.name
    return file_path or None


def _write_ssl_temp_files(conn_params: DatabaseConnection) -> dict:
    """Write PEM content to temp files if provided; returns paths dict and list of temp paths to clean up."""
    temp_files = []
    paths = {}

    ca_path = _get_cert_path(conn_params.ssl_ca, conn_params.ssl_ca_path, ".ca.pem")
    if ca_path and conn_params.ssl_ca:
        temp_files.append(ca_path)
    paths['ca'] = ca_path

    cert_path = _get_cert_path(conn_params.ssl_cert, conn_params.ssl_cert_path, ".cert.pem")
    if cert_path and conn_params.ssl_cert:
        temp_files.append(cert_path)
    paths['cert'] = cert_path

    key_path = _get_cert_path(conn_params.ssl_key, conn_params.ssl_key_path, ".key.pem")
    if key_path and conn_params.ssl_key:
        temp_files.append(key_path)
    paths['key'] = key_path

    return paths, temp_files


def _cleanup_temp_files(temp_files: list) -> None:
    """Remove temporary SSL certificate files."""
    for path in temp_files:
        try:
            os.unlink(path)
        except OSError:
            pass


def _generate_aws_iam_token(host: str, port: int, username: str, region: str,
                             aws_access_key_id: Optional[str] = None,
                             aws_secret_access_key: Optional[str] = None) -> str:
    """Generate an AWS RDS IAM authentication token via boto3."""
    try:
        import boto3
        kwargs = {'region_name': region}
        if aws_access_key_id and aws_secret_access_key:
            kwargs['aws_access_key_id'] = aws_access_key_id
            kwargs['aws_secret_access_key'] = aws_secret_access_key
        client = boto3.client('rds', **kwargs)
        token = client.generate_db_auth_token(
            DBHostname=host,
            Port=port,
            DBUsername=username,
            Region=region,
        )
        return token
    except ImportError:
        raise ConnectionError("boto3 is required for AWS IAM authentication. Install it with: pip install boto3")
    except Exception as e:
        raise ConnectionError(f"Failed to generate AWS IAM token: {e}")


def _build_azure_ad_token(conn_params: DatabaseConnection) -> str:
    """Obtain an Azure AD access token for database authentication."""
    try:
        from azure.identity import ClientSecretCredential, ManagedIdentityCredential
        scope = "https://database.windows.net/.default"

        if conn_params.auth_method == "azure_ad_sp":
            if not (conn_params.azure_tenant_id and conn_params.azure_client_id and conn_params.azure_client_secret):
                raise ValueError("azureTenantId, azureClientId, and azureClientSecret are required for Service Principal auth")
            credential = ClientSecretCredential(
                tenant_id=conn_params.azure_tenant_id,
                client_id=conn_params.azure_client_id,
                client_secret=conn_params.azure_client_secret,
            )
        elif conn_params.auth_method == "azure_ad_mi":
            credential = ManagedIdentityCredential(
                client_id=conn_params.azure_client_id or None
            )
        else:
            raise ValueError(f"Unsupported Azure AD auth method for token generation: {conn_params.auth_method}")

        token = credential.get_token(scope)
        return token.token
    except ImportError:
        raise ConnectionError("azure-identity is required for Azure AD authentication. Install it with: pip install azure-identity")
    except Exception as e:
        raise ConnectionError(f"Failed to obtain Azure AD token: {e}")


def _resolve_mysql_ssl_mode(conn_params: DatabaseConnection) -> Optional[str]:
    """Resolve the SSL mode string for MySQL connections."""
    if conn_params.ssl_mode:
        return conn_params.ssl_mode
    if conn_params.use_ssl:
        return "required"
    return None


def _rewrite_connection_string_for_tunnel(connection_string: str, db_type: str, local_port: int) -> str:
    """Rewrite raw ODBC connection string to target an already-open SSH local tunnel."""
    segments = [segment for segment in connection_string.split(";") if segment]
    updated_segments: list[str] = []
    saw_server = False
    saw_port = False

    for segment in segments:
        if "=" not in segment:
            updated_segments.append(segment)
            continue

        key, value = segment.split("=", 1)
        key_norm = key.strip().lower()

        if key_norm in {"server", "address", "addr", "host"}:
            saw_server = True
            if db_type == "sqlserver":
                updated_segments.append(f"{key}=127.0.0.1,{local_port}")
            else:
                updated_segments.append(f"{key}=127.0.0.1")
            continue

        if key_norm == "port":
            saw_port = True
            if db_type != "sqlserver":
                updated_segments.append(f"{key}={local_port}")
            continue

        updated_segments.append(f"{key}={value}")

    if not saw_server:
        if db_type == "sqlserver":
            updated_segments.append(f"SERVER=127.0.0.1,{local_port}")
        else:
            updated_segments.append("SERVER=127.0.0.1")

    if db_type != "sqlserver" and not saw_port:
        updated_segments.append(f"PORT={local_port}")

    return ";".join(updated_segments) + ";"


def build_connection_string(conn_params: DatabaseConnection, *, original_host: str | None = None) -> tuple[str, str]:
    """Build ODBC connection string from parameters.

    Returns (connection_string, engine_type).
    For auth_method='connection_string', returns the raw value directly.

    Args:
        original_host: When connecting through an SSH tunnel, the real remote
            hostname before it was rewritten to 127.0.0.1.  Used for
            HostNameInCertificate with Encrypt=strict.
    """

    # Expert mode: raw connection string — bypass all other logic
    if conn_params.auth_method == "connection_string" and conn_params.connection_string_value:
        return conn_params.connection_string_value, conn_params.type

    if conn_params.type == "mysql":
        driver = _get_mysql_driver()

        # Named Pipe (Windows)
        if conn_params.connection_method == "pipe" and conn_params.named_pipe:
            conn_parts = [
                f"DRIVER={driver};",
                f"SOCKET={conn_params.named_pipe};",
                f"DATABASE={conn_params.database};",
                f"USER={conn_params.username};",
                f"PASSWORD={conn_params.password};",
                "OPTION=3;",
            ]
        # Unix Socket
        elif conn_params.connection_method == "socket" and conn_params.socket_path:
            conn_parts = [
                f"DRIVER={driver};",
                f"SERVER={conn_params.socket_path};",
                f"DATABASE={conn_params.database};",
                f"USER={conn_params.username};",
                f"PASSWORD={conn_params.password};",
                "OPTION=3;",
            ]
        else:
            conn_parts = [
                f"DRIVER={driver};",
                f"SERVER={conn_params.host};" if conn_params.host else "",
                f"PORT={conn_params.port};" if conn_params.port else "",
                f"DATABASE={conn_params.database};",
                f"USER={conn_params.username};",
                f"PASSWORD={conn_params.password};",
                "OPTION=3;",
            ]

        # SSL Mode
        ssl_mode = _resolve_mysql_ssl_mode(conn_params)
        if ssl_mode:
            conn_parts.append(f"SSLMODE={ssl_mode};")

        # SSL Certificates (temp file paths will be added in get_connection for mysql.connector fallback)
        ca_path = conn_params.ssl_ca_path or (None if not conn_params.ssl_ca else "<pem>")
        cert_path = conn_params.ssl_cert_path or (None if not conn_params.ssl_cert else "<pem>")
        key_path = conn_params.ssl_key_path or (None if not conn_params.ssl_key else "<pem>")
        # ODBC-level SSL cert paths — actual temp file creation happens in get_connection
        if conn_params.ssl_ca_path:
            conn_parts.append(f"SSLCA={conn_params.ssl_ca_path};")
        if conn_params.ssl_cert_path:
            conn_parts.append(f"SSLCERT={conn_params.ssl_cert_path};")
        if conn_params.ssl_key_path:
            conn_parts.append(f"SSLKEY={conn_params.ssl_key_path};")

        return "".join(part for part in conn_parts if part), "mysql"

    if conn_params.type == "sqlserver":
        sqlserver_driver = _get_sqlserver_driver()
        # Named Pipe takes precedence, then named instance, then host+port.
        if conn_params.connection_method == "pipe" and conn_params.named_pipe:
            server_str = conn_params.named_pipe if conn_params.named_pipe.lower().startswith("np:") else f"np:{conn_params.named_pipe}"
        elif conn_params.named_instance:
            server_str = f"{conn_params.host or 'localhost'}\\{conn_params.named_instance}"
        else:
            server = conn_params.host or "localhost"
            port = conn_params.port or 1433
            server_str = f"{server},{port}"

        conn_parts = [
            f"DRIVER={{{sqlserver_driver}}};",
            f"SERVER={server_str};",
            f"DATABASE={conn_params.database};",
        ]

        auth = conn_params.auth_method or "sql_auth"

        if auth == "windows_auth":
            conn_parts.append("Trusted_Connection=Yes;")
        elif auth == "azure_ad_password":
            conn_parts.append(f"Authentication=ActiveDirectoryPassword;")
            conn_parts.append(f"UID={conn_params.username};")
            conn_parts.append(f"PWD={conn_params.password};")
        elif auth == "azure_ad_integrated":
            conn_parts.append("Authentication=ActiveDirectoryIntegrated;")
        elif auth == "azure_ad_mfa":
            conn_parts.append("Authentication=ActiveDirectoryInteractive;")
            if conn_params.username:
                conn_parts.append(f"UID={conn_params.username};")
        elif auth == "azure_ad_sp":
            conn_parts.append(f"Authentication=ActiveDirectoryServicePrincipal;")
            conn_parts.append(f"UID={conn_params.azure_client_id};")
            conn_parts.append(f"PWD={conn_params.azure_client_secret};")
        elif auth == "azure_ad_mi":
            conn_parts.append("Authentication=ActiveDirectoryMsi;")
        elif auth == "kerberos":
            conn_parts.append("Trusted_Connection=Yes;")  # via Kerberos ticket
        else:
            # sql_auth (default)
            conn_parts.append(f"UID={conn_params.username};")
            conn_parts.append(f"PWD={conn_params.password};")

        # Encrypt
        if conn_params.encrypt:
            conn_parts.append(f"Encrypt={conn_params.encrypt};")
        elif conn_params.use_ssl:
            conn_parts.append("Encrypt=yes;")
        else:
            # ODBC Driver 18 defaults to encrypted connections; explicitly disable for non-TLS mode.
            conn_parts.append("Encrypt=no;")

        # Trust Server Certificate
        if conn_params.trust_server_certificate:
            conn_parts.append("TrustServerCertificate=yes;")

        # For strict TLS through an SSH tunnel, the SERVER points at the local
        # tunnel endpoint (127.0.0.1) but the certificate was issued for the
        # real remote hostname.  Pin HostNameInCertificate to the original host
        # so the driver validates the cert correctly.
        # When connecting directly (no tunnel), omit HostNameInCertificate and
        # let the driver validate against SERVER, which matches the IP SAN.
        # Note: TrustServerCertificate is ignored by the driver for strict TLS,
        # so we always set HostNameInCertificate when tunnelling regardless.
        if (
            str(conn_params.encrypt or "").lower() == "strict"
            and original_host
        ):
            conn_parts.append(f"HostNameInCertificate={original_host};")

        return "".join(conn_parts), "sqlserver"

    if conn_params.type == "postgresql":
        driver = _get_postgres_driver()
        conn_parts = [f"DRIVER={driver};"]

        if conn_params.connection_method == "socket" and conn_params.socket_path:
            conn_parts.append(f"SERVER={conn_params.socket_path};")
        else:
            if conn_params.host:
                conn_parts.append(f"SERVER={conn_params.host};")
            if conn_params.port:
                conn_parts.append(f"PORT={conn_params.port};")

        conn_parts.extend([
            f"DATABASE={conn_params.database};",
        ])

        auth = conn_params.auth_method or "sql_auth"

        if auth == "azure_ad_sp":
            # Service principal credentials are stored separately from username/password.
            if conn_params.azure_client_id:
                conn_parts.append(f"UID={conn_params.azure_client_id};")
            elif conn_params.username:
                conn_parts.append(f"UID={conn_params.username};")
            if conn_params.azure_client_secret:
                conn_parts.append(f"PWD={conn_params.azure_client_secret};")
            elif conn_params.password:
                conn_parts.append(f"PWD={conn_params.password};")
        elif auth not in ("windows_auth", "azure_ad_integrated", "azure_ad_mi", "kerberos"):
            conn_parts.append(f"UID={conn_params.username};")
            conn_parts.append(f"PWD={conn_params.password};")

        # SSL Mode
        if conn_params.ssl_mode:
            conn_parts.append(f"SSLmode={conn_params.ssl_mode};")
        elif conn_params.use_ssl:
            conn_parts.append("SSLmode=require;")

        # SSL Certificates (file path variants — PEM temp files handled in get_connection)
        if conn_params.ssl_ca_path:
            conn_parts.append(f"SSLrootcert={conn_params.ssl_ca_path};")
        if conn_params.ssl_cert_path:
            conn_parts.append(f"SSLcert={conn_params.ssl_cert_path};")
        if conn_params.ssl_key_path:
            conn_parts.append(f"SSLkey={conn_params.ssl_key_path};")

        # Kerberos
        if auth == "kerberos":
            conn_parts.append("Krbsrvname=postgres;")

        if conn_params.default_schema:
            conn_parts.append(f"CurrentSchema={conn_params.default_schema};")

        return "".join(conn_parts), "postgresql"

    if conn_params.type == "oracle":
        driver = _get_oracle_driver()
        host = conn_params.host or "localhost"
        port = conn_params.port or 1521
        service_name = conn_params.database

        conn_parts = [
            f"DRIVER={driver};",
            f"DBQ={host}:{port}/{service_name};",
            f"UID={conn_params.username};" if conn_params.username else "",
            f"PWD={conn_params.password};" if conn_params.password else "",
        ]

        return "".join(part for part in conn_parts if part), "oracle"

    raise ValueError(f"Unsupported database type: {conn_params.type}")

def create_session(conn_params: DatabaseConnection) -> str:
    """Create a new session and store connection parameters."""
    session_id = str(uuid.uuid4())

    # Store session with expiry
    sessions[session_id] = {
        'connection': conn_params,
        'created_at': datetime.now(),
        'expires_at': datetime.now() + timedelta(hours=SESSION_EXPIRY_HOURS),
        'query_results': [],
        'schema_sent': False,  # Track if database schema has been sent to LLM
        'last_db_structure': None  # Cache last successfully fetched DB structure
    }

    # Clean up expired sessions
    cleanup_expired_sessions()

    return session_id


def _create_ssh_tunnel(conn_params: DatabaseConnection) -> Optional[SSHTunnelForwarder]:
    """Create SSH tunnel when connection_method is ssh."""
    if conn_params.connection_method != "ssh":
        return None
    if not conn_params.ssh_host:
        raise ConnectionError("sshHost is required for SSH connection method")

    default_port = (
        3306 if conn_params.type == "mysql"
        else (5432 if conn_params.type == "postgresql" else (1521 if conn_params.type == "oracle" else 1433))
    )
    remote_host = conn_params.host or "localhost"
    remote_port = conn_params.port or default_port

    try:
        tunnel = SSHTunnelForwarder(
            (conn_params.ssh_host, conn_params.ssh_port or 22),
            ssh_username=conn_params.ssh_username,
            ssh_password=conn_params.ssh_password,
            ssh_pkey=conn_params.ssh_key_file or None,
            local_bind_address=("127.0.0.1", 0),
            remote_bind_address=(remote_host, remote_port),
            logger=logging.getLogger("sshtunnel"),
        )
        tunnel.start()
        return tunnel
    except Exception as e:
        raise ConnectionError(f"SSH tunnel connection failed: {e}")


def connect_with_params(conn_params: DatabaseConnection):
    """Create DB connection directly from parameters."""
    tunnel = None
    effective_params = conn_params

    # For local agent connections, return marker connection.
    if conn_params.connection_method == "local":
        return LocalAgentConnection(conn_params.connection_code, conn_params.type), conn_params.type

    _validate_capabilities(conn_params)

    # SSH tunneling is handled centrally so session-based and direct paths are consistent.
    tunnel = _create_ssh_tunnel(conn_params)
    original_host = None
    if tunnel:
        original_host = conn_params.host
        effective_params = conn_params.model_copy(update={
            "host": "127.0.0.1",
            "port": tunnel.local_bind_port,
            "connection_method": "standard",
        })

    # Expert mode: raw connection string
    if effective_params.auth_method == "connection_string" and effective_params.connection_string_value:
        try:
            raw_connection_string = effective_params.connection_string_value
            if tunnel:
                raw_connection_string = _rewrite_connection_string_for_tunnel(
                    raw_connection_string,
                    effective_params.type,
                    tunnel.local_bind_port,
                )
            conn = pyodbc.connect(raw_connection_string)
            return (TunnelManagedConnection(conn, tunnel), effective_params.type) if tunnel else (conn, effective_params.type)
        except Exception as e:
            if tunnel:
                try:
                    tunnel.stop()
                except Exception:
                    pass
            raise ConnectionError(f"Failed to connect using custom connection string: {e}")

    # AWS IAM: replace password with generated token
    effective_password = effective_params.password
    if effective_params.auth_method == "aws_iam":
        # IAM token must be generated for the real DB endpoint, not the local tunnel endpoint.
        iam_params = conn_params if conn_params.connection_method == "ssh" else effective_params
        use_instance_profile = bool(iam_params.aws_use_instance_profile)

        host = iam_params.host or "localhost"
        port = (
            iam_params.port
            or (3306 if iam_params.type == "mysql" else (5432 if iam_params.type == "postgresql" else 1521))
        )
        region = iam_params.aws_region
        if not region:
            if tunnel:
                try:
                    tunnel.stop()
                except Exception:
                    pass
            raise ValueError("awsRegion is required for AWS IAM authentication")
        if not use_instance_profile and (not iam_params.aws_access_key_id or not iam_params.aws_secret_access_key):
            if tunnel:
                try:
                    tunnel.stop()
                except Exception:
                    pass
            raise ValueError(
                "awsAccessKeyId and awsSecretAccessKey are required when awsUseInstanceProfile is false"
            )
        effective_password = _generate_aws_iam_token(
            host=host,
            port=port,
            username=iam_params.username,
            region=region,
            aws_access_key_id=iam_params.aws_access_key_id if not use_instance_profile else None,
            aws_secret_access_key=iam_params.aws_secret_access_key if not use_instance_profile else None,
        )
        effective_params = effective_params.model_copy(update={"password": effective_password})

    conn_string, engine = build_connection_string(effective_params, original_host=original_host)
    temp_files = []

    try:
        if engine == "mysql":
            use_mysql_connector = effective_params.auth_method == "aws_iam"
            if not use_mysql_connector:
                try:
                    conn = pyodbc.connect(conn_string, timeout=15)
                    return (TunnelManagedConnection(conn, tunnel), engine) if tunnel else (conn, engine)
                except pyodbc.Error:
                    # Fallback to mysql.connector.
                    pass

            # mysql.connector path (used as fallback and for aws_iam by default).
            ssl_paths, temp_files = _write_ssl_temp_files(effective_params)
            ssl_kwargs = {}
            if ssl_paths.get('ca'):
                ssl_kwargs['ssl_ca'] = ssl_paths['ca']
            if ssl_paths.get('cert'):
                ssl_kwargs['ssl_cert'] = ssl_paths['cert']
            if ssl_paths.get('key'):
                ssl_kwargs['ssl_key'] = ssl_paths['key']

            ssl_mode = _resolve_mysql_ssl_mode(effective_params)
            ssl_disabled = (ssl_mode in (None, "disabled", "disable")) and not ssl_kwargs

            host = effective_params.host or "localhost"
            port = effective_params.port or 3306
            if effective_params.connection_method == "socket" and effective_params.socket_path:
                host = effective_params.socket_path
                port = None  # not used for unix socket

            connect_kwargs = dict(
                host=host,
                database=effective_params.database,
                user=effective_params.username,
                password=effective_password,
                ssl_disabled=ssl_disabled,
                connection_timeout=15,
                **ssl_kwargs,
            )
            if effective_params.auth_method == "aws_iam":
                # RDS IAM for MySQL requires cleartext password plugin support.
                connect_kwargs["auth_plugin"] = "mysql_clear_password"
                # mysql-connector C-extension can hang on Linux for IAM+SSH+TLS.
                # Force pure-Python implementation for stable timeout behavior.
                connect_kwargs["use_pure"] = True
            if port:
                connect_kwargs['port'] = port
            if effective_params.connection_method == "socket" and effective_params.socket_path:
                connect_kwargs['unix_socket'] = effective_params.socket_path
                connect_kwargs.pop('host', None)
                connect_kwargs.pop('port', None)

            conn = mysql.connector.connect(**connect_kwargs)
            conn.autocommit = True
            return (TunnelManagedConnection(conn, tunnel), engine) if tunnel else (conn, engine)

        # PostgreSQL with PEM-content SSL
        if engine == "postgresql" and (
            effective_params.auth_method == "aws_iam"
            or effective_params.ssl_ca
            or effective_params.ssl_cert
            or effective_params.ssl_key
        ):
            ssl_paths, temp_files = _write_ssl_temp_files(effective_params)
            import psycopg2
            psycopg2_ssl = {}
            if ssl_paths.get('ca'):
                psycopg2_ssl['sslrootcert'] = ssl_paths['ca']
            if ssl_paths.get('cert'):
                psycopg2_ssl['sslcert'] = ssl_paths['cert']
            if ssl_paths.get('key'):
                psycopg2_ssl['sslkey'] = ssl_paths['key']
            ssl_mode_val = effective_params.ssl_mode or ("require" if effective_params.use_ssl else "prefer")
            pg_host = effective_params.host
            pg_port = effective_params.port or 5432
            if effective_params.connection_method == "socket" and effective_params.socket_path:
                # psycopg2 expects the directory containing .s.PGSQL.<port> for unix socket mode.
                pg_host = effective_params.socket_path
            connect_kwargs = dict(
                host=pg_host,
                port=pg_port,
                dbname=effective_params.database,
                user=effective_params.username,
                password=effective_password,
                sslmode=ssl_mode_val,
                connect_timeout=15,
                **psycopg2_ssl,
            )
            conn = psycopg2.connect(**connect_kwargs)
            conn.autocommit = True
            return (TunnelManagedConnection(conn, tunnel), engine) if tunnel else (conn, engine)

        conn = pyodbc.connect(conn_string, timeout=15)
        return (TunnelManagedConnection(conn, tunnel), engine) if tunnel else (conn, engine)

    except Exception as e:
        _cleanup_temp_files(temp_files)
        if tunnel:
            try:
                tunnel.stop()
            except Exception:
                pass
        raise ConnectionError(f"Failed to connect to database: {str(e)}")
    finally:
        # Temp files cleanup is deferred; caller should close connection before cleanup
        pass


def get_connection(session_id: str):
    """Get database connection from session."""
    if session_id not in sessions:
        raise ValueError("Invalid or expired session ID")

    session = sessions[session_id]

    # Check if expired
    if datetime.now() > session['expires_at']:
        del sessions[session_id]
        raise ValueError("Session expired")

    return connect_with_params(session['connection'])

def refresh_session(session_id: str) -> bool:
    """Extend the expiry of an existing session. Returns True if refreshed, False if not found/expired."""
    if session_id not in sessions:
        return False
    session = sessions[session_id]
    if datetime.now() > session['expires_at']:
        del sessions[session_id]
        return False
    session['expires_at'] = datetime.now() + timedelta(hours=SESSION_EXPIRY_HOURS)
    return True


def cleanup_expired_sessions():
    """Remove expired sessions from memory."""
    now = datetime.now()
    expired = [sid for sid, session in sessions.items() if now > session['expires_at']]
    for sid in expired:
        del sessions[sid]

def get_connection_params(session_id: str) -> Optional[DatabaseConnection]:
    """Get connection parameters for a session (without opening a connection)."""
    if session_id not in sessions:
        return None
    session = sessions[session_id]
    if datetime.now() > session['expires_at']:
        del sessions[session_id]
        return None
    return session['connection']

def get_session_info(session_id: str) -> Optional[dict]:
    """Get session information without creating connection."""
    if session_id not in sessions:
        return None

    session = sessions[session_id]
    if datetime.now() > session['expires_at']:
        del sessions[session_id]
        return None

    conn_params = session['connection']
    info = {
        'session_id': session_id,
        'database_type': conn_params.type,
        'database_name': conn_params.database,
        'username': conn_params.username,
        'created_at': session['created_at'].isoformat(),
        'expires_at': session['expires_at'].isoformat(),
        'connection_method': conn_params.connection_method
    }

    # Include connection_code for local agent connections
    if conn_params.connection_method == "local" and conn_params.connection_code:
        info['connection_code'] = conn_params.connection_code

    return info


def store_query_result(session_id: str, result: dict) -> None:
    """Store a query result for a session."""
    if session_id not in sessions:
        raise ValueError("Invalid or expired session ID")

    session = sessions[session_id]
    if 'query_results' not in session:
        session['query_results'] = []

    # Add timestamp if not present
    if 'timestamp' not in result:
        result['timestamp'] = datetime.now().isoformat()

    # Store result (keep last 50 results)
    session['query_results'].append(result)
    if len(session['query_results']) > 50:
        session['query_results'] = session['query_results'][-50:]


def get_query_results(session_id: str, limit: int = 50) -> list:
    """Get query results for a session."""
    if session_id not in sessions:
        return []

    session = sessions[session_id]
    results = session.get('query_results', [])

    # Return last N results
    return results[-limit:] if limit else results

def is_schema_sent(session_id: str) -> bool:
    """Check if database schema has been sent to LLM for this session."""
    if session_id not in sessions:
        return False
    session = sessions[session_id]
    if 'schema_sent' not in session:
        session['schema_sent'] = False
    return session.get('schema_sent', False)

def mark_schema_sent(session_id: str) -> None:
    """Mark that database schema has been sent to LLM for this session."""
    if session_id not in sessions:
        raise ValueError("Invalid or expired session ID")
    session = sessions[session_id]
    session['schema_sent'] = True

def mark_schema_updated(session_id: str) -> None:
    """Mark that database schema has been updated (DDL operation), so it needs to be resent."""
    if session_id not in sessions:
        raise ValueError("Invalid or expired session ID")
    session = sessions[session_id]
    session['schema_sent'] = False
    if 'schema_hash' in session:
        del session['schema_hash']

def get_schema_hash(session_id: str) -> Optional[str]:
    """Get the cached schema hash for this session."""
    if session_id not in sessions:
        return None
    session = sessions[session_id]
    return session.get('schema_hash')

def set_schema_hash(session_id: str, schema_hash: str) -> None:
    """Store the schema hash for this session."""
    if session_id not in sessions:
        raise ValueError("Invalid or expired session ID")
    session = sessions[session_id]
    session['schema_hash'] = schema_hash


def get_cached_db_structure(session_id: str) -> Optional[dict]:
    """Get the last successfully fetched DB structure for this session."""
    if session_id not in sessions:
        return None
    session = sessions[session_id]
    cached = session.get('last_db_structure')
    if isinstance(cached, dict) and cached:
        return cached
    return None


def set_cached_db_structure(session_id: str, db_structure: dict) -> None:
    """Store the last successfully fetched DB structure for this session."""
    if session_id not in sessions:
        raise ValueError("Invalid or expired session ID")
    if not isinstance(db_structure, dict) or not db_structure:
        return
    session = sessions[session_id]
    session['last_db_structure'] = db_structure
