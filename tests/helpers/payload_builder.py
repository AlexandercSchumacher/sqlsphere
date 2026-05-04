from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

from tests.helpers.matrix_loader import ConnectionCase, InvalidCombinationCase


DB_PREFIX = {
    "mysql": "MYSQL",
    "postgresql": "POSTGRESQL",
    "sqlserver": "SQLSERVER",
}


DEFAULT_CONNECTIONS = {
    "mysql": {
        "host": "127.0.0.1",
        "port": 3306,
        "database": "sqlsphere_mysql",
        "username": "sqlsphere_user",
        "password": "sqlsphere_mysql_pass",
    },
    "postgresql": {
        "host": "127.0.0.1",
        "port": 5432,
        "database": "sqlsphere_pg",
        "username": "sqlsphere_pg",
        "password": "sqlsphere_pg_pass",
    },
    "sqlserver": {
        "host": "127.0.0.1",
        "port": 1433,
        "database": "master",
        "username": "sa",
        "password": "SqlSphereStrongPass!123",
    },
}

SELF_CONTAINED_PROFILES = {"core", "ci_tls_connection_string", "ci_ssh"}


@dataclass(frozen=True)
class PayloadResult:
    payload: dict[str, Any]
    missing_requirements: list[str]


@dataclass(frozen=True)
class ResolvedBase:
    host: str | None
    port: int | None
    database: str | None
    username: str | None
    password: str | None


def _env(name: str) -> str | None:
    value = os.getenv(name)
    if value is None:
        return None
    value = value.strip()
    return value if value else None


def _truthy(value: str | None) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "on"}


def _to_int(value: str | None, default: int | None) -> int | None:
    if value is None:
        return default
    try:
        return int(value)
    except ValueError:
        return default


def _prefix(db_type: str) -> str:
    return DB_PREFIX[db_type]


def _resolve_base(db_type: str, profile: str) -> ResolvedBase:
    prefix = _prefix(db_type)
    if profile in SELF_CONTAINED_PROFILES:
        defaults = DEFAULT_CONNECTIONS[db_type]
    else:
        defaults = {
            "host": None,
            "port": None,
            "database": None,
            "username": None,
            "password": None,
        }

    return ResolvedBase(
        host=_env(f"TEST_{prefix}_HOST") or defaults["host"],
        port=_to_int(_env(f"TEST_{prefix}_PORT"), defaults["port"]),
        database=_env(f"TEST_{prefix}_DATABASE") or defaults["database"],
        username=_env(f"TEST_{prefix}_USERNAME") or defaults["username"],
        password=_env(f"TEST_{prefix}_PASSWORD") or defaults["password"],
    )


def _require(missing: list[str], condition: bool, description: str) -> None:
    if not condition:
        missing.append(description)


def _require_env(missing: list[str], env_name: str) -> str | None:
    value = _env(env_name)
    if value is None:
        missing.append(f"missing env: {env_name}")
    return value


def build_connect_payload(case: ConnectionCase) -> PayloadResult:
    base = _resolve_base(case.db_type, case.profile)
    prefix = _prefix(case.db_type)
    missing: list[str] = []
    effective_tls_variant = case.tls_variant
    effective_connection_method = case.connection_method
    effective_auth_method = case.auth_method

    # CI compatibility mode for pipe variants in environments without native pipe support.
    if case.connection_method == "pipe" and _truthy(_env("TEST_PIPE_COMPAT_MODE")):
        effective_connection_method = "standard"
        effective_tls_variant = "none"
        if effective_auth_method == "connection_string":
            effective_auth_method = "sql_auth"
        if effective_auth_method == "ssl_cert":
            effective_auth_method = "sql_auth"
        if case.db_type == "sqlserver" and effective_auth_method in {"windows_auth", "kerberos"}:
            effective_auth_method = "sql_auth"

    # CI compatibility mode for socket variants in environments without native socket support.
    if case.connection_method == "socket" and _truthy(_env("TEST_SOCKET_COMPAT_MODE")):
        effective_connection_method = "standard"
        effective_tls_variant = "none"
        if effective_auth_method in {"connection_string", "ssl_cert"}:
            effective_auth_method = "sql_auth"

    # CI compatibility mode for SSH + connection_string variants in environments
    # where connection-string-based SSH payloads are not fully supported.
    if (
        case.connection_method == "ssh"
        and effective_auth_method == "connection_string"
        and _truthy(_env("TEST_SSH_CONNECTION_STRING_COMPAT_MODE"))
    ):
        effective_connection_method = "standard"

    # CI compatibility mode for TLS/cert variants in self-contained environments
    # that do not provide full cert infrastructure for every combination.
    if _truthy(_env("TEST_TLS_CERT_COMPAT_MODE")):
        if effective_tls_variant in {
            "basic_ssl",
            "mode_require",
            "cert_path",
            "cert_pem",
            "sqlserver_encrypt_yes",
            "sqlserver_encrypt_strict",
        }:
            effective_tls_variant = "none"
        if effective_auth_method == "ssl_cert":
            effective_auth_method = "sql_auth"

    payload: dict[str, Any] = {
        "type": case.db_type,
        "connection_method": effective_connection_method,
        "auth_method": effective_auth_method,
    }

    if effective_auth_method == "connection_string":
        cs_env = f"TEST_{prefix}_CONNECTION_STRING"
        connection_string_value = _require_env(missing, cs_env)

        payload["connection_string_value"] = connection_string_value
        payload["database"] = base.database or "placeholder"
        payload["username"] = base.username or ""
        payload["password"] = base.password or ""

        if effective_connection_method == "ssh":
            ssh_db_host = _env(f"TEST_{prefix}_SSH_DB_HOST")
            ssh_db_port = _to_int(_env(f"TEST_{prefix}_SSH_DB_PORT"), base.port)
            tunnel_target_host = ssh_db_host or base.host
            tunnel_target_port = ssh_db_port if ssh_db_port is not None else base.port

            _require(missing, bool(tunnel_target_host), f"missing SSH tunnel target host for {case.db_type}")
            _require(missing, tunnel_target_port is not None, f"missing SSH tunnel target port for {case.db_type}")

            payload["host"] = tunnel_target_host
            if tunnel_target_port is not None:
                payload["port"] = tunnel_target_port

            ssh_host = _env(f"TEST_{prefix}_SSH_HOST") or _env("TEST_SSH_HOST")
            ssh_port = _to_int(_env(f"TEST_{prefix}_SSH_PORT") or _env("TEST_SSH_PORT"), 22)
            ssh_username = _env(f"TEST_{prefix}_SSH_USERNAME") or _env("TEST_SSH_USERNAME")
            ssh_password = _env(f"TEST_{prefix}_SSH_PASSWORD") or _env("TEST_SSH_PASSWORD")
            ssh_key_file = _env(f"TEST_{prefix}_SSH_KEY_FILE") or _env("TEST_SSH_KEY_FILE")

            _require(missing, bool(ssh_host), f"missing SSH host for {case.db_type}")
            _require(missing, bool(ssh_username), f"missing SSH username for {case.db_type}")
            _require(missing, bool(ssh_password or ssh_key_file), f"missing SSH auth (password or key) for {case.db_type}")

            payload["ssh_host"] = ssh_host
            payload["ssh_port"] = ssh_port
            payload["ssh_username"] = ssh_username
            payload["ssh_password"] = ssh_password
            payload["ssh_key_file"] = ssh_key_file
        return PayloadResult(payload=payload, missing_requirements=missing)

    _require(missing, bool(base.database), f"missing database for {case.db_type}")
    payload["database"] = base.database or "placeholder"

    if effective_connection_method == "socket":
        socket_path = _require_env(missing, f"TEST_{prefix}_SOCKET_PATH")
        payload["socket_path"] = socket_path
    elif effective_connection_method == "pipe":
        named_pipe = _require_env(missing, f"TEST_{prefix}_NAMED_PIPE")
        payload["named_pipe"] = named_pipe
        if case.db_type == "sqlserver":
            payload["host"] = base.host or "localhost"
    else:
        _require(missing, bool(base.host), f"missing host for {case.db_type}")
        _require(missing, base.port is not None, f"missing port for {case.db_type}")
        payload["host"] = base.host
        payload["port"] = base.port

    if effective_connection_method == "ssh":
        ssh_db_host = _env(f"TEST_{prefix}_SSH_DB_HOST")
        ssh_db_port = _to_int(_env(f"TEST_{prefix}_SSH_DB_PORT"), base.port)
        if ssh_db_host:
            payload["host"] = ssh_db_host
        if ssh_db_port is not None:
            payload["port"] = ssh_db_port

        ssh_host = _env(f"TEST_{prefix}_SSH_HOST") or _env("TEST_SSH_HOST")
        ssh_port = _to_int(_env(f"TEST_{prefix}_SSH_PORT") or _env("TEST_SSH_PORT"), 22)
        ssh_username = _env(f"TEST_{prefix}_SSH_USERNAME") or _env("TEST_SSH_USERNAME")
        ssh_password = _env(f"TEST_{prefix}_SSH_PASSWORD") or _env("TEST_SSH_PASSWORD")
        ssh_key_file = _env(f"TEST_{prefix}_SSH_KEY_FILE") or _env("TEST_SSH_KEY_FILE")

        _require(missing, bool(ssh_host), f"missing SSH host for {case.db_type}")
        _require(missing, bool(ssh_username), f"missing SSH username for {case.db_type}")
        _require(missing, bool(ssh_password or ssh_key_file), f"missing SSH auth (password or key) for {case.db_type}")

        payload["ssh_host"] = ssh_host
        payload["ssh_port"] = ssh_port
        payload["ssh_username"] = ssh_username
        payload["ssh_password"] = ssh_password
        payload["ssh_key_file"] = ssh_key_file

        # Azure AD SQL Server auth flows can require the original server hostname
        # and are not always compatible with local-loopback SSH tunnels.
        if (
            case.db_type == "sqlserver"
            and effective_auth_method.startswith("azure_ad_")
        ):
            _require(
                missing,
                _truthy(_env("TEST_SQLSERVER_RUN_AZURE_AD_SSH")),
                "set TEST_SQLSERVER_RUN_AZURE_AD_SSH=true to run SQL Server Azure AD auth cases over SSH",
            )

    if effective_auth_method in {"sql_auth", "ssl_cert", "aws_iam"}:
        _require(missing, bool(base.username), f"missing username for auth_method={effective_auth_method}")
        payload["username"] = base.username or ""

    if effective_auth_method in {"sql_auth", "ssl_cert"}:
        _require(missing, bool(base.password), f"missing password for auth_method={effective_auth_method}")
        payload["password"] = base.password or ""

    if effective_auth_method == "azure_ad_password":
        if case.db_type == "sqlserver":
            _require(
                missing,
                _truthy(_env("TEST_SQLSERVER_RUN_AZURE_AD_PASSWORD")),
                "set TEST_SQLSERVER_RUN_AZURE_AD_PASSWORD=true to run SQL Server Azure AD password cases",
            )
            aad_username = _env("TEST_SQLSERVER_AZURE_AD_USERNAME") or base.username
            aad_password = _env("TEST_SQLSERVER_AZURE_AD_PASSWORD") or base.password
            _require(missing, bool(aad_username), "missing username for auth_method=azure_ad_password")
            _require(missing, bool(aad_password), "missing password for auth_method=azure_ad_password")
            payload["username"] = aad_username or ""
            payload["password"] = aad_password or ""
        else:
            _require(missing, bool(base.username), "missing username for auth_method=azure_ad_password")
            _require(missing, bool(base.password), "missing password for auth_method=azure_ad_password")
            payload["username"] = base.username or ""
            payload["password"] = base.password or ""

    if effective_auth_method == "aws_iam":
        aws_region = _env(f"TEST_{prefix}_AWS_REGION") or _env("TEST_AWS_REGION")
        _require(missing, bool(aws_region), "missing AWS region")
        payload["aws_region"] = aws_region
        payload["aws_access_key_id"] = _env("TEST_AWS_ACCESS_KEY_ID")
        payload["aws_secret_access_key"] = _env("TEST_AWS_SECRET_ACCESS_KEY")
        payload["aws_use_instance_profile"] = _truthy(_env("TEST_AWS_USE_INSTANCE_PROFILE"))

    if effective_auth_method == "azure_ad_password":
        payload["azure_tenant_id"] = _env("TEST_AZURE_TENANT_ID")

    if effective_auth_method == "azure_ad_sp":
        tenant = _require_env(missing, "TEST_AZURE_TENANT_ID")
        client_id = _require_env(missing, "TEST_AZURE_CLIENT_ID")
        client_secret = _require_env(missing, "TEST_AZURE_CLIENT_SECRET")

        payload["azure_tenant_id"] = tenant
        payload["azure_client_id"] = client_id
        payload["azure_client_secret"] = client_secret

    if effective_auth_method == "azure_ad_mi":
        _require(
            missing,
            _truthy(_env("TEST_SQLSERVER_RUN_AZURE_AD_MI")),
            "set TEST_SQLSERVER_RUN_AZURE_AD_MI=true to run SQL Server managed identity cases",
        )
        payload["azure_client_id"] = _env("TEST_AZURE_CLIENT_ID")

    if effective_auth_method == "azure_ad_integrated":
        _require(
            missing,
            _truthy(_env("TEST_SQLSERVER_RUN_AZURE_AD_INTEGRATED")),
            "set TEST_SQLSERVER_RUN_AZURE_AD_INTEGRATED=true to run SQL Server integrated auth cases",
        )

    if effective_auth_method == "azure_ad_mfa":
        _require(
            missing,
            _truthy(_env("TEST_SQLSERVER_RUN_AZURE_AD_MFA")),
            "set TEST_SQLSERVER_RUN_AZURE_AD_MFA=true to run SQL Server Azure AD MFA cases",
        )
        mfa_username = _env("TEST_SQLSERVER_AZURE_AD_MFA_USERNAME") or base.username
        _require(missing, bool(mfa_username), "missing username for azure_ad_mfa")
        payload["username"] = mfa_username or ""

    if effective_tls_variant == "basic_ssl":
        _require(missing, _truthy(_env(f"TEST_{prefix}_RUN_BASIC_SSL")), f"set TEST_{prefix}_RUN_BASIC_SSL=true to run basic SSL cases")
        payload["use_ssl"] = True

    if effective_tls_variant == "mode_require":
        _require(missing, _truthy(_env(f"TEST_{prefix}_RUN_SSL_MODE")), f"set TEST_{prefix}_RUN_SSL_MODE=true to run ssl mode cases")
        payload["use_ssl"] = True
        if case.db_type == "mysql":
            payload["ssl_mode"] = _env(f"TEST_{prefix}_SSL_MODE") or "required"
        elif case.db_type == "postgresql":
            payload["ssl_mode"] = _env(f"TEST_{prefix}_SSL_MODE") or "require"

    if effective_tls_variant == "cert_path":
        _require(missing, _truthy(_env(f"TEST_{prefix}_RUN_CERT_PATH")), f"set TEST_{prefix}_RUN_CERT_PATH=true to run cert-path SSL cases")
        payload["ssl_ca_path"] = _require_env(missing, f"TEST_{prefix}_SSL_CA_PATH")
        payload["ssl_cert_path"] = _require_env(missing, f"TEST_{prefix}_SSL_CERT_PATH")
        payload["ssl_key_path"] = _require_env(missing, f"TEST_{prefix}_SSL_KEY_PATH")

    if effective_tls_variant == "cert_pem":
        _require(missing, _truthy(_env(f"TEST_{prefix}_RUN_CERT_PEM")), f"set TEST_{prefix}_RUN_CERT_PEM=true to run PEM SSL cases")
        payload["ssl_ca"] = _require_env(missing, f"TEST_{prefix}_SSL_CA")
        payload["ssl_cert"] = _require_env(missing, f"TEST_{prefix}_SSL_CERT")
        payload["ssl_key"] = _require_env(missing, f"TEST_{prefix}_SSL_KEY")

    if effective_tls_variant == "sqlserver_encrypt_yes":
        _require(missing, _truthy(_env("TEST_SQLSERVER_RUN_TLS")), "set TEST_SQLSERVER_RUN_TLS=true to run SQL Server TLS cases")
        payload["encrypt"] = "yes"
        payload["trust_server_certificate"] = True

    if effective_tls_variant == "sqlserver_encrypt_strict":
        _require(missing, _truthy(_env("TEST_SQLSERVER_RUN_TLS")), "set TEST_SQLSERVER_RUN_TLS=true to run SQL Server TLS cases")
        _require(
            missing,
            _truthy(_env("TEST_SQLSERVER_RUN_STRICT_TLS")),
            "set TEST_SQLSERVER_RUN_STRICT_TLS=true to run SQL Server Encrypt=strict cases",
        )
        payload["encrypt"] = "strict"
        payload["trust_server_certificate"] = _truthy(
            _env("TEST_SQLSERVER_STRICT_TRUST_SERVER_CERT")
            or _env("TEST_SQLSERVER_TRUST_SERVER_CERT")
        )

    if effective_auth_method == "ssl_cert":
        has_paths = bool(payload.get("ssl_ca_path") and payload.get("ssl_cert_path") and payload.get("ssl_key_path"))
        has_pem = bool(payload.get("ssl_ca") and payload.get("ssl_cert") and payload.get("ssl_key"))
        _require(missing, has_paths or has_pem, "ssl_cert auth requires cert_path or cert_pem TLS variant with valid cert inputs")

    # When the SQL Server has ForceEncryption enabled with a self-signed cert,
    # all connections (even tls_variant=none) need TrustServerCertificate=yes.
    if (
        case.db_type == "sqlserver"
        and not payload.get("trust_server_certificate")
        and _truthy(_env("TEST_SQLSERVER_TRUST_SERVER_CERT"))
    ):
        payload["trust_server_certificate"] = True

    return PayloadResult(payload=payload, missing_requirements=missing)


def build_invalid_connect_payload(case: InvalidCombinationCase) -> dict[str, Any]:
    defaults = {
        "mysql": {"host": "127.0.0.1", "port": 3306, "database": "dummy", "username": "dummy", "password": "dummy"},
        "postgresql": {"host": "127.0.0.1", "port": 5432, "database": "dummy", "username": "dummy", "password": "dummy"},
        "sqlserver": {"host": "127.0.0.1", "port": 1433, "database": "master", "username": "dummy", "password": "dummy"},
    }
    base = defaults[case.db_type]

    payload: dict[str, Any] = {
        "type": case.db_type,
        "connection_method": case.connection_method,
        "auth_method": case.auth_method,
        "database": base["database"],
        "username": base["username"],
        "password": base["password"],
    }

    if case.connection_method in {"standard", "ssh"}:
        payload["host"] = base["host"]
        payload["port"] = base["port"]

    if case.connection_method == "socket":
        payload["socket_path"] = "/tmp/fake.sock"

    if case.connection_method == "pipe":
        payload["named_pipe"] = r"\\.\pipe\FakePipe"
        payload["host"] = base["host"]

    if case.auth_method == "connection_string":
        payload["connection_string_value"] = "DRIVER={Fake};SERVER=fake;DATABASE=fake;UID=fake;PWD=fake;"

    if case.tls_variant == "basic_ssl":
        payload["use_ssl"] = True

    return payload
