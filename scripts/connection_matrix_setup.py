#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


@dataclass(frozen=True)
class Requirement:
    name: str
    kind: str  # "secret" or "variable"
    profiles: tuple[str, ...]
    purpose: str
    source: str
    optional: bool = False


REAL_PROFILES: tuple[str, ...] = (
    "core",
    "ci_tls_connection_string",
    "ci_ssh",
    "aws",
    "azure_ad",
    "kerberos_windows",
)


REQUIREMENTS: tuple[Requirement, ...] = (
    Requirement(
        name="FASTAPI_AUTH_TOKEN",
        kind="secret",
        profiles=REAL_PROFILES,
        purpose="Bearer token for authenticated backend test requests.",
        source="Use the same value configured in the backend runtime environment.",
    ),
    Requirement(
        name="RUN_AWS_MATRIX",
        kind="variable",
        profiles=("aws",),
        purpose="Enables/disables the AWS CI job.",
        source="Set to true when AWS infra + secrets are ready.",
    ),
    Requirement(
        name="RUN_AZURE_AD_MATRIX",
        kind="variable",
        profiles=("azure_ad",),
        purpose="Enables/disables the Azure AD CI job.",
        source="Set to true when Azure AD infra + secrets are ready.",
    ),
    Requirement(
        name="RUN_KERBEROS_WINDOWS_MATRIX",
        kind="variable",
        profiles=("kerberos_windows",),
        purpose="Enables/disables the Windows Kerberos CI job.",
        source="Set to true when Kerberos/AD infra + secrets are ready.",
    ),
    Requirement(
        name="TEST_AWS_REGION",
        kind="secret",
        profiles=("aws",),
        purpose="AWS region used for IAM auth token generation.",
        source="From AWS account/region of the test RDS instances.",
    ),
    Requirement(
        name="TEST_AWS_ACCESS_KEY_ID",
        kind="secret",
        profiles=("aws",),
        purpose="AWS credential for IAM token generation in CI.",
        source="From IAM user access key (or leave empty when using instance profile flow).",
    ),
    Requirement(
        name="TEST_AWS_SECRET_ACCESS_KEY",
        kind="secret",
        profiles=("aws",),
        purpose="AWS secret key for IAM token generation in CI.",
        source="From IAM user secret access key (or leave empty when using instance profile flow).",
    ),
    Requirement(
        name="TEST_AWS_USE_INSTANCE_PROFILE",
        kind="secret",
        profiles=("aws",),
        purpose="Toggles instance profile credential path.",
        source="Set true when runner has role-based credentials, else false.",
    ),
    Requirement(
        name="TEST_AWS_MYSQL_HOST",
        kind="secret",
        profiles=("aws",),
        purpose="MySQL endpoint for AWS profile tests.",
        source="RDS/Aurora endpoint hostname.",
    ),
    Requirement(
        name="TEST_AWS_MYSQL_PORT",
        kind="secret",
        profiles=("aws",),
        purpose="MySQL endpoint port for AWS profile tests.",
        source="RDS/Aurora port (commonly 3306).",
    ),
    Requirement(
        name="TEST_AWS_MYSQL_DATABASE",
        kind="secret",
        profiles=("aws",),
        purpose="MySQL database/schema for AWS profile tests.",
        source="Created test database name.",
    ),
    Requirement(
        name="TEST_AWS_MYSQL_USERNAME",
        kind="secret",
        profiles=("aws",),
        purpose="MySQL user for AWS profile tests.",
        source="Test DB user that can run SELECT 1.",
    ),
    Requirement(
        name="TEST_AWS_POSTGRESQL_HOST",
        kind="secret",
        profiles=("aws",),
        purpose="PostgreSQL endpoint for AWS profile tests.",
        source="RDS/Aurora endpoint hostname.",
    ),
    Requirement(
        name="TEST_AWS_POSTGRESQL_PORT",
        kind="secret",
        profiles=("aws",),
        purpose="PostgreSQL endpoint port for AWS profile tests.",
        source="RDS/Aurora port (commonly 5432).",
    ),
    Requirement(
        name="TEST_AWS_POSTGRESQL_DATABASE",
        kind="secret",
        profiles=("aws",),
        purpose="PostgreSQL database for AWS profile tests.",
        source="Created test database name.",
    ),
    Requirement(
        name="TEST_AWS_POSTGRESQL_USERNAME",
        kind="secret",
        profiles=("aws",),
        purpose="PostgreSQL user for AWS profile tests.",
        source="Test DB user that can run SELECT 1.",
    ),
    Requirement(
        name="TEST_AWS_SSH_HOST",
        kind="secret",
        profiles=("aws",),
        purpose="Public SSH bastion host for AWS SSH matrix cases.",
        source="Public IPv4 or DNS name of a dedicated bastion in the same VPC as test RDS instances.",
    ),
    Requirement(
        name="TEST_AWS_SSH_PORT",
        kind="secret",
        profiles=("aws",),
        purpose="SSH bastion port for AWS SSH matrix cases.",
        source="Usually 22 unless custom SSH port is configured on the bastion.",
    ),
    Requirement(
        name="TEST_AWS_SSH_USERNAME",
        kind="secret",
        profiles=("aws",),
        purpose="SSH username for AWS bastion login.",
        source="Bastion login user, e.g. ec2-user on Amazon Linux.",
    ),
    Requirement(
        name="TEST_AWS_SSH_PRIVATE_KEY",
        kind="secret",
        profiles=("aws",),
        purpose="Optional SSH private key PEM content for AWS bastion login.",
        source="Use this when key-based auth is preferred instead of password auth.",
        optional=True,
    ),
    Requirement(
        name="TEST_AWS_SSH_PASSWORD",
        kind="secret",
        profiles=("aws",),
        purpose="Optional SSH password fallback for AWS bastion login.",
        source="Only needed when key-based login is not used.",
        optional=True,
    ),
    Requirement(
        name="TEST_AWS_MYSQL_SSH_DB_HOST",
        kind="secret",
        profiles=("aws",),
        purpose="Optional MySQL remote host override used after opening the SSH tunnel.",
        source="Use the RDS endpoint when it differs from TEST_AWS_MYSQL_HOST.",
        optional=True,
    ),
    Requirement(
        name="TEST_AWS_POSTGRESQL_SSH_DB_HOST",
        kind="secret",
        profiles=("aws",),
        purpose="Optional PostgreSQL remote host override used after opening the SSH tunnel.",
        source="Use the RDS endpoint when it differs from TEST_AWS_POSTGRESQL_HOST.",
        optional=True,
    ),
    Requirement(
        name="TEST_AZURE_TENANT_ID",
        kind="secret",
        profiles=("azure_ad",),
        purpose="Azure Entra tenant ID for token flows.",
        source="Azure portal -> Entra ID tenant overview.",
    ),
    Requirement(
        name="TEST_AZURE_CLIENT_ID",
        kind="secret",
        profiles=("azure_ad",),
        purpose="Azure app registration client ID.",
        source="Azure portal -> App registration.",
    ),
    Requirement(
        name="TEST_AZURE_CLIENT_SECRET",
        kind="secret",
        profiles=("azure_ad",),
        purpose="Azure app registration client secret.",
        source="Azure portal -> Certificates & secrets.",
    ),
    Requirement(
        name="TEST_AZURE_POSTGRESQL_HOST",
        kind="secret",
        profiles=("azure_ad",),
        purpose="PostgreSQL endpoint for Azure profile tests.",
        source="Azure Database for PostgreSQL endpoint.",
    ),
    Requirement(
        name="TEST_AZURE_POSTGRESQL_PORT",
        kind="secret",
        profiles=("azure_ad",),
        purpose="PostgreSQL endpoint port for Azure profile tests.",
        source="Azure Database for PostgreSQL port (usually 5432).",
    ),
    Requirement(
        name="TEST_AZURE_POSTGRESQL_DATABASE",
        kind="secret",
        profiles=("azure_ad",),
        purpose="PostgreSQL database for Azure profile tests.",
        source="Created test database name.",
    ),
    Requirement(
        name="TEST_AZURE_POSTGRESQL_USERNAME",
        kind="secret",
        profiles=("azure_ad",),
        purpose="PostgreSQL username for Azure profile tests.",
        source="Test DB user that can run SELECT 1.",
    ),
    Requirement(
        name="TEST_AZURE_POSTGRESQL_PASSWORD",
        kind="secret",
        profiles=("azure_ad",),
        purpose="PostgreSQL password for Azure profile tests.",
        source="Password of the test DB user.",
    ),
    Requirement(
        name="TEST_AZURE_SQLSERVER_HOST",
        kind="secret",
        profiles=("azure_ad",),
        purpose="SQL Server endpoint for Azure profile tests.",
        source="Azure SQL/SQL Server endpoint.",
    ),
    Requirement(
        name="TEST_AZURE_SQLSERVER_PORT",
        kind="secret",
        profiles=("azure_ad",),
        purpose="SQL Server endpoint port for Azure profile tests.",
        source="SQL Server port (usually 1433).",
    ),
    Requirement(
        name="TEST_AZURE_SQLSERVER_DATABASE",
        kind="secret",
        profiles=("azure_ad",),
        purpose="SQL Server database for Azure profile tests.",
        source="Created test database name.",
    ),
    Requirement(
        name="TEST_AZURE_SQLSERVER_USERNAME",
        kind="secret",
        profiles=("azure_ad",),
        purpose="SQL Server username for Azure profile tests.",
        source="Test DB user that can run SELECT 1.",
    ),
    Requirement(
        name="TEST_AZURE_SQLSERVER_PASSWORD",
        kind="secret",
        profiles=("azure_ad",),
        purpose="SQL Server password for Azure profile tests.",
        source="Password of the test DB user.",
    ),
    Requirement(
        name="TEST_AZURE_SQLSERVER_NAMED_PIPE",
        kind="secret",
        profiles=("azure_ad",),
        purpose="Named pipe target for SQL Server pipe-method tests.",
        source="Only if your SQL Server test environment supports pipe connections.",
        optional=True,
    ),
    Requirement(
        name="TEST_AZURE_SSH_HOST",
        kind="secret",
        profiles=("azure_ad",),
        purpose="Optional SSH bastion host for Azure profile SSH connection-method cases.",
        source="Public IP or DNS of Azure SSH bastion.",
        optional=True,
    ),
    Requirement(
        name="TEST_AZURE_SSH_PORT",
        kind="secret",
        profiles=("azure_ad",),
        purpose="Optional SSH bastion port for Azure profile SSH connection-method cases.",
        source="Usually 22 unless custom SSH port is configured on bastion.",
        optional=True,
    ),
    Requirement(
        name="TEST_AZURE_SSH_USERNAME",
        kind="secret",
        profiles=("azure_ad",),
        purpose="Optional SSH username for Azure profile SSH connection-method cases.",
        source="Bastion login user.",
        optional=True,
    ),
    Requirement(
        name="TEST_AZURE_SSH_PASSWORD",
        kind="secret",
        profiles=("azure_ad",),
        purpose="Optional SSH password for Azure profile SSH connection-method cases.",
        source="Bastion login password.",
        optional=True,
    ),
    Requirement(
        name="TEST_AZURE_SQLSERVER_AZURE_AD_USERNAME",
        kind="secret",
        profiles=("azure_ad",),
        purpose="Optional Azure AD user principal for SQL Server azure_ad_password auth tests.",
        source="AAD/Entra user UPN used for ActiveDirectoryPassword flow.",
        optional=True,
    ),
    Requirement(
        name="TEST_AZURE_SQLSERVER_AZURE_AD_PASSWORD",
        kind="secret",
        profiles=("azure_ad",),
        purpose="Optional Azure AD user password for SQL Server azure_ad_password auth tests.",
        source="Password for TEST_AZURE_SQLSERVER_AZURE_AD_USERNAME.",
        optional=True,
    ),
    Requirement(
        name="TEST_AZURE_SQLSERVER_AZURE_AD_MFA_USERNAME",
        kind="secret",
        profiles=("azure_ad",),
        purpose="Optional Azure AD user principal for SQL Server azure_ad_mfa auth tests.",
        source="AAD/Entra user UPN used for ActiveDirectoryInteractive flow.",
        optional=True,
    ),
    Requirement(
        name="TEST_SQLSERVER_RUN_AZURE_AD_PASSWORD",
        kind="variable",
        profiles=("azure_ad",),
        purpose="Enable SQL Server azure_ad_password matrix cases.",
        source="Set true only when Azure AD username/password test identity is available.",
        optional=True,
    ),
    Requirement(
        name="TEST_SQLSERVER_RUN_AZURE_AD_INTEGRATED",
        kind="variable",
        profiles=("azure_ad",),
        purpose="Enable SQL Server azure_ad_integrated matrix cases.",
        source="Set true only when runner/runtime supports ActiveDirectoryIntegrated auth.",
        optional=True,
    ),
    Requirement(
        name="TEST_SQLSERVER_RUN_AZURE_AD_MFA",
        kind="variable",
        profiles=("azure_ad",),
        purpose="Enable SQL Server azure_ad_mfa matrix cases.",
        source="Set true only when interactive/MFA auth can run in your environment.",
        optional=True,
    ),
    Requirement(
        name="TEST_SQLSERVER_RUN_AZURE_AD_MI",
        kind="variable",
        profiles=("azure_ad",),
        purpose="Enable SQL Server azure_ad_mi matrix cases.",
        source="Set true only when runner has a usable managed identity endpoint.",
        optional=True,
    ),
    Requirement(
        name="TEST_SQLSERVER_RUN_AZURE_AD_SSH",
        kind="variable",
        profiles=("azure_ad",),
        purpose="Enable SQL Server Azure AD auth matrix cases over SSH tunnels.",
        source="Set true only if your SQL Server Azure AD auth methods support SSH tunnel host rewrites.",
        optional=True,
    ),
    Requirement(
        name="TEST_KERBEROS_POSTGRESQL_HOST",
        kind="secret",
        profiles=("kerberos_windows",),
        purpose="PostgreSQL endpoint for Kerberos profile tests.",
        source="Kerberos-enabled PostgreSQL test endpoint.",
    ),
    Requirement(
        name="TEST_KERBEROS_POSTGRESQL_PORT",
        kind="secret",
        profiles=("kerberos_windows",),
        purpose="PostgreSQL endpoint port for Kerberos profile tests.",
        source="Kerberos-enabled PostgreSQL port (usually 5432).",
    ),
    Requirement(
        name="TEST_KERBEROS_POSTGRESQL_DATABASE",
        kind="secret",
        profiles=("kerberos_windows",),
        purpose="PostgreSQL database for Kerberos profile tests.",
        source="Created test database name.",
    ),
    Requirement(
        name="TEST_KERBEROS_POSTGRESQL_USERNAME",
        kind="secret",
        profiles=("kerberos_windows",),
        purpose="Kerberos principal/username for PostgreSQL tests.",
        source="AD/Kerberos identity mapped for DB login.",
    ),
    Requirement(
        name="TEST_KERBEROS_SQLSERVER_HOST",
        kind="secret",
        profiles=("kerberos_windows",),
        purpose="SQL Server endpoint for Kerberos profile tests.",
        source="Kerberos-enabled SQL Server endpoint.",
    ),
    Requirement(
        name="TEST_KERBEROS_SQLSERVER_PORT",
        kind="secret",
        profiles=("kerberos_windows",),
        purpose="SQL Server endpoint port for Kerberos profile tests.",
        source="SQL Server port (usually 1433).",
    ),
    Requirement(
        name="TEST_KERBEROS_SQLSERVER_DATABASE",
        kind="secret",
        profiles=("kerberos_windows",),
        purpose="SQL Server database for Kerberos profile tests.",
        source="Created test database name.",
    ),
    Requirement(
        name="TEST_KERBEROS_SQLSERVER_USERNAME",
        kind="secret",
        profiles=("kerberos_windows",),
        purpose="Kerberos principal/username for SQL Server tests.",
        source="AD/Kerberos identity mapped for DB login.",
    ),
    Requirement(
        name="TEST_KERBEROS_SQLSERVER_NAMED_PIPE",
        kind="secret",
        profiles=("kerberos_windows",),
        purpose="Named pipe target for SQL Server Kerberos pipe tests.",
        source="Only if your Windows SQL Server test environment supports named pipes.",
    ),
    Requirement(
        name="TEST_SSH_HOST",
        kind="secret",
        profiles=("core",),
        purpose="SSH bastion host for SSH connection method.",
        source="Core CI can use 127.0.0.1 with included test bastion.",
        optional=True,
    ),
    Requirement(
        name="TEST_SSH_PORT",
        kind="secret",
        profiles=("core",),
        purpose="SSH bastion port for SSH connection method.",
        source="Core CI uses 2222 by default.",
        optional=True,
    ),
    Requirement(
        name="TEST_SSH_USERNAME",
        kind="secret",
        profiles=("core",),
        purpose="SSH username for bastion login.",
        source="Core CI test bastion default user is sqlsphere.",
        optional=True,
    ),
    Requirement(
        name="TEST_SSH_PASSWORD",
        kind="secret",
        profiles=("core",),
        purpose="SSH password for bastion login.",
        source="Core CI test bastion default password is sqlsphere_ssh_pass.",
        optional=True,
    ),
    Requirement(
        name="TEST_SSH_KEY_FILE",
        kind="secret",
        profiles=("core",),
        purpose="SSH private key file path for bastion login (alternative to password).",
        source="Absolute path to private key on runner/host.",
        optional=True,
    ),
    Requirement(
        name="TEST_MYSQL_SSH_DB_HOST",
        kind="secret",
        profiles=("core",),
        purpose="Target database host behind SSH tunnel for MySQL cases.",
        source="In Docker CI this is usually 'mysql'.",
        optional=True,
    ),
    Requirement(
        name="TEST_MYSQL_SSH_DB_PORT",
        kind="secret",
        profiles=("core",),
        purpose="Target database port behind SSH tunnel for MySQL cases.",
        source="Usually 3306 unless overridden.",
        optional=True,
    ),
    Requirement(
        name="TEST_MYSQL_SSH_HOST",
        kind="secret",
        profiles=("core",),
        purpose="Per-DB SSH host override for MySQL SSH tests.",
        source="Set only when MySQL tunnel host differs from global TEST_SSH_HOST.",
        optional=True,
    ),
    Requirement(
        name="TEST_MYSQL_SSH_PORT",
        kind="secret",
        profiles=("core",),
        purpose="Per-DB SSH port override for MySQL SSH tests.",
        source="Set only when MySQL tunnel port differs from global TEST_SSH_PORT.",
        optional=True,
    ),
    Requirement(
        name="TEST_MYSQL_SSH_USERNAME",
        kind="secret",
        profiles=("core",),
        purpose="Per-DB SSH username override for MySQL SSH tests.",
        source="Set only when MySQL tunnel user differs from global TEST_SSH_USERNAME.",
        optional=True,
    ),
    Requirement(
        name="TEST_MYSQL_SSH_PASSWORD",
        kind="secret",
        profiles=("core",),
        purpose="Per-DB SSH password override for MySQL SSH tests.",
        source="Set only when MySQL tunnel password differs from global TEST_SSH_PASSWORD.",
        optional=True,
    ),
    Requirement(
        name="TEST_MYSQL_SSH_KEY_FILE",
        kind="secret",
        profiles=("core",),
        purpose="Per-DB SSH key override for MySQL SSH tests.",
        source="Set only when MySQL tunnel key differs from global TEST_SSH_KEY_FILE.",
        optional=True,
    ),
    Requirement(
        name="TEST_POSTGRESQL_SSH_DB_HOST",
        kind="secret",
        profiles=("core",),
        purpose="Target database host behind SSH tunnel for PostgreSQL cases.",
        source="In Docker CI this is usually 'postgresql'.",
        optional=True,
    ),
    Requirement(
        name="TEST_POSTGRESQL_SSH_DB_PORT",
        kind="secret",
        profiles=("core",),
        purpose="Target database port behind SSH tunnel for PostgreSQL cases.",
        source="Usually 5432 unless overridden.",
        optional=True,
    ),
    Requirement(
        name="TEST_POSTGRESQL_SSH_HOST",
        kind="secret",
        profiles=("core",),
        purpose="Per-DB SSH host override for PostgreSQL SSH tests.",
        source="Set only when PostgreSQL tunnel host differs from global TEST_SSH_HOST.",
        optional=True,
    ),
    Requirement(
        name="TEST_POSTGRESQL_SSH_PORT",
        kind="secret",
        profiles=("core",),
        purpose="Per-DB SSH port override for PostgreSQL SSH tests.",
        source="Set only when PostgreSQL tunnel port differs from global TEST_SSH_PORT.",
        optional=True,
    ),
    Requirement(
        name="TEST_POSTGRESQL_SSH_USERNAME",
        kind="secret",
        profiles=("core",),
        purpose="Per-DB SSH username override for PostgreSQL SSH tests.",
        source="Set only when PostgreSQL tunnel user differs from global TEST_SSH_USERNAME.",
        optional=True,
    ),
    Requirement(
        name="TEST_POSTGRESQL_SSH_PASSWORD",
        kind="secret",
        profiles=("core",),
        purpose="Per-DB SSH password override for PostgreSQL SSH tests.",
        source="Set only when PostgreSQL tunnel password differs from global TEST_SSH_PASSWORD.",
        optional=True,
    ),
    Requirement(
        name="TEST_POSTGRESQL_SSH_KEY_FILE",
        kind="secret",
        profiles=("core",),
        purpose="Per-DB SSH key override for PostgreSQL SSH tests.",
        source="Set only when PostgreSQL tunnel key differs from global TEST_SSH_KEY_FILE.",
        optional=True,
    ),
    Requirement(
        name="TEST_SQLSERVER_SSH_DB_HOST",
        kind="secret",
        profiles=("core",),
        purpose="Target database host behind SSH tunnel for SQL Server cases.",
        source="In Docker CI this is usually 'sqlserver'.",
        optional=True,
    ),
    Requirement(
        name="TEST_SQLSERVER_SSH_DB_PORT",
        kind="secret",
        profiles=("core",),
        purpose="Target database port behind SSH tunnel for SQL Server cases.",
        source="Usually 1433 unless overridden.",
        optional=True,
    ),
    Requirement(
        name="TEST_SQLSERVER_SSH_HOST",
        kind="secret",
        profiles=("core",),
        purpose="Per-DB SSH host override for SQL Server SSH tests.",
        source="Set only when SQL Server tunnel host differs from global TEST_SSH_HOST.",
        optional=True,
    ),
    Requirement(
        name="TEST_SQLSERVER_SSH_PORT",
        kind="secret",
        profiles=("core",),
        purpose="Per-DB SSH port override for SQL Server SSH tests.",
        source="Set only when SQL Server tunnel port differs from global TEST_SSH_PORT.",
        optional=True,
    ),
    Requirement(
        name="TEST_SQLSERVER_SSH_USERNAME",
        kind="secret",
        profiles=("core",),
        purpose="Per-DB SSH username override for SQL Server SSH tests.",
        source="Set only when SQL Server tunnel user differs from global TEST_SSH_USERNAME.",
        optional=True,
    ),
    Requirement(
        name="TEST_SQLSERVER_SSH_PASSWORD",
        kind="secret",
        profiles=("core",),
        purpose="Per-DB SSH password override for SQL Server SSH tests.",
        source="Set only when SQL Server tunnel password differs from global TEST_SSH_PASSWORD.",
        optional=True,
    ),
    Requirement(
        name="TEST_SQLSERVER_SSH_KEY_FILE",
        kind="secret",
        profiles=("core",),
        purpose="Per-DB SSH key override for SQL Server SSH tests.",
        source="Set only when SQL Server tunnel key differs from global TEST_SSH_KEY_FILE.",
        optional=True,
    ),
    Requirement(
        name="TEST_ORACLE_SSH_DB_HOST",
        kind="secret",
        profiles=("core",),
        purpose="Target database host behind SSH tunnel for Oracle cases.",
        source="Oracle test endpoint address reachable from bastion.",
        optional=True,
    ),
    Requirement(
        name="TEST_ORACLE_SSH_DB_PORT",
        kind="secret",
        profiles=("core",),
        purpose="Target database port behind SSH tunnel for Oracle cases.",
        source="Usually 1521 unless overridden.",
        optional=True,
    ),
    Requirement(
        name="TEST_ORACLE_SSH_HOST",
        kind="secret",
        profiles=("core",),
        purpose="Per-DB SSH host override for Oracle SSH tests.",
        source="Set only when Oracle tunnel host differs from global TEST_SSH_HOST.",
        optional=True,
    ),
    Requirement(
        name="TEST_ORACLE_SSH_PORT",
        kind="secret",
        profiles=("core",),
        purpose="Per-DB SSH port override for Oracle SSH tests.",
        source="Set only when Oracle tunnel port differs from global TEST_SSH_PORT.",
        optional=True,
    ),
    Requirement(
        name="TEST_ORACLE_SSH_USERNAME",
        kind="secret",
        profiles=("core",),
        purpose="Per-DB SSH username override for Oracle SSH tests.",
        source="Set only when Oracle tunnel user differs from global TEST_SSH_USERNAME.",
        optional=True,
    ),
    Requirement(
        name="TEST_ORACLE_SSH_PASSWORD",
        kind="secret",
        profiles=("core",),
        purpose="Per-DB SSH password override for Oracle SSH tests.",
        source="Set only when Oracle tunnel password differs from global TEST_SSH_PASSWORD.",
        optional=True,
    ),
    Requirement(
        name="TEST_ORACLE_SSH_KEY_FILE",
        kind="secret",
        profiles=("core",),
        purpose="Per-DB SSH key override for Oracle SSH tests.",
        source="Set only when Oracle tunnel key differs from global TEST_SSH_KEY_FILE.",
        optional=True,
    ),
    Requirement(
        name="TEST_MYSQL_SOCKET_PATH",
        kind="secret",
        profiles=("core",),
        purpose="Unix socket path for MySQL socket-method tests.",
        source="Path to mysql.sock on the runner host filesystem.",
        optional=True,
    ),
    Requirement(
        name="TEST_POSTGRESQL_SOCKET_PATH",
        kind="secret",
        profiles=("core",),
        purpose="Unix socket path for PostgreSQL socket-method tests.",
        source="Directory path containing .s.PGSQL.<port> on the runner host filesystem.",
        optional=True,
    ),
    Requirement(
        name="TEST_MYSQL_NAMED_PIPE",
        kind="secret",
        profiles=("core",),
        purpose="Named pipe path for MySQL pipe-method tests.",
        source="Windows named pipe target, only for environments that support it.",
        optional=True,
    ),
    Requirement(
        name="TEST_SQLSERVER_NAMED_PIPE",
        kind="secret",
        profiles=("core",),
        purpose="Named pipe path for SQL Server pipe-method tests.",
        source="Windows SQL Server named pipe path.",
        optional=True,
    ),
    Requirement(
        name="TEST_CORE_WINDOWS_SQLSERVER_HOST",
        kind="secret",
        profiles=("core",),
        purpose="Windows SQL Server host for dedicated core named-pipe CI job.",
        source="Hostname or IP of Windows SQL Server test instance.",
        optional=True,
    ),
    Requirement(
        name="TEST_CORE_WINDOWS_SQLSERVER_PORT",
        kind="secret",
        profiles=("core",),
        purpose="Windows SQL Server port for dedicated core named-pipe CI job.",
        source="SQL Server TCP port (usually 1433).",
        optional=True,
    ),
    Requirement(
        name="TEST_CORE_WINDOWS_SQLSERVER_DATABASE",
        kind="secret",
        profiles=("core",),
        purpose="Windows SQL Server database for dedicated core named-pipe CI job.",
        source="Database name reachable by the SQL-auth test login.",
        optional=True,
    ),
    Requirement(
        name="TEST_CORE_WINDOWS_SQLSERVER_USERNAME",
        kind="secret",
        profiles=("core",),
        purpose="SQL Server SQL-auth username for dedicated core named-pipe CI job.",
        source="Login name with SELECT permission on the configured database.",
        optional=True,
    ),
    Requirement(
        name="TEST_CORE_WINDOWS_SQLSERVER_PASSWORD",
        kind="secret",
        profiles=("core",),
        purpose="SQL Server SQL-auth password for dedicated core named-pipe CI job.",
        source="Password for TEST_CORE_WINDOWS_SQLSERVER_USERNAME.",
        optional=True,
    ),
    Requirement(
        name="TEST_CORE_WINDOWS_SQLSERVER_NAMED_PIPE",
        kind="secret",
        profiles=("core",),
        purpose="Windows SQL Server named pipe path for dedicated core named-pipe CI job.",
        source="Pipe path like \\\\HOST\\pipe\\MSSQL$INSTANCE\\sql\\query.",
        optional=True,
    ),
    Requirement(
        name="TEST_CORE_WINDOWS_SQLSERVER_CONNECTION_STRING",
        kind="secret",
        profiles=("core",),
        purpose="SQL Server raw ODBC connection string for dedicated core Windows named-pipe connection_string case.",
        source="Build from SQL Server driver/server/database/login with named-pipe server target.",
        optional=True,
    ),
    Requirement(
        name="TEST_CORE_WINDOWS_SQLSERVER_SMB_USERNAME",
        kind="secret",
        profiles=("core",),
        purpose="Windows account used by CI runner to open SMB IPC session before named-pipe SQL tests.",
        source="Domain or local account in USER or HOST\\USER format with access to \\\\HOST\\IPC$.",
        optional=True,
    ),
    Requirement(
        name="TEST_CORE_WINDOWS_SQLSERVER_SMB_PASSWORD",
        kind="secret",
        profiles=("core",),
        purpose="Password for TEST_CORE_WINDOWS_SQLSERVER_SMB_USERNAME.",
        source="Credential secret for SMB IPC authentication to the Windows SQL Server host.",
        optional=True,
    ),
    Requirement(
        name="TEST_MYSQL_CONNECTION_STRING",
        kind="secret",
        profiles=("core",),
        purpose="MySQL raw ODBC connection string for connection_string auth tests.",
        source="Build from MySQL host/port/database/user/password and driver name.",
        optional=True,
    ),
    Requirement(
        name="TEST_POSTGRESQL_CONNECTION_STRING",
        kind="secret",
        profiles=("core",),
        purpose="PostgreSQL raw ODBC connection string for connection_string auth tests.",
        source="Build from PostgreSQL host/port/database/user/password and driver name.",
        optional=True,
    ),
    Requirement(
        name="TEST_SQLSERVER_CONNECTION_STRING",
        kind="secret",
        profiles=("core",),
        purpose="SQL Server raw ODBC connection string for connection_string auth tests.",
        source="Build from SQL Server host/port/database/user/password and driver name.",
        optional=True,
    ),
    Requirement(
        name="TEST_ORACLE_HOST",
        kind="secret",
        profiles=("core",),
        purpose="Oracle endpoint host for full core matrix coverage.",
        source="Oracle test instance endpoint.",
        optional=True,
    ),
    Requirement(
        name="TEST_ORACLE_PORT",
        kind="secret",
        profiles=("core",),
        purpose="Oracle endpoint port for full core matrix coverage.",
        source="Oracle listener port (typically 1521).",
        optional=True,
    ),
    Requirement(
        name="TEST_ORACLE_DATABASE",
        kind="secret",
        profiles=("core",),
        purpose="Oracle service name/database for full core matrix coverage.",
        source="Oracle service name configured for the test instance.",
        optional=True,
    ),
    Requirement(
        name="TEST_ORACLE_USERNAME",
        kind="secret",
        profiles=("core",),
        purpose="Oracle username for full core matrix coverage.",
        source="Oracle test user with minimal query permissions.",
        optional=True,
    ),
    Requirement(
        name="TEST_ORACLE_PASSWORD",
        kind="secret",
        profiles=("core",),
        purpose="Oracle password for full core matrix coverage.",
        source="Password of the Oracle test user.",
        optional=True,
    ),
    Requirement(
        name="TEST_ORACLE_CONNECTION_STRING",
        kind="secret",
        profiles=("core",),
        purpose="Oracle raw connection string for connection_string auth tests.",
        source="Use Oracle driver syntax for host/port/service/user/password.",
        optional=True,
    ),
    Requirement(
        name="TEST_ORACLE_TLS_CONNECTION_STRING",
        kind="secret",
        profiles=("core",),
        purpose="Oracle TLS connection string variant for TLS via connection string tests.",
        source="Oracle TLS-enabled connection string including wallet/cert references.",
        optional=True,
    ),
    Requirement(
        name="TEST_MYSQL_RUN_BASIC_SSL",
        kind="secret",
        profiles=("core",),
        purpose="Enables MySQL basic SSL matrix cases.",
        source="Set true only when MySQL test endpoint accepts TLS.",
        optional=True,
    ),
    Requirement(
        name="TEST_MYSQL_RUN_SSL_MODE",
        kind="secret",
        profiles=("core",),
        purpose="Enables MySQL SSL mode matrix cases.",
        source="Set true only when MySQL test endpoint supports the selected SSL mode.",
        optional=True,
    ),
    Requirement(
        name="TEST_MYSQL_SSL_MODE",
        kind="secret",
        profiles=("core",),
        purpose="Optional MySQL SSL mode override used by TLS mode cases.",
        source="Set to disabled|preferred|required|verify_ca|verify_identity when needed.",
        optional=True,
    ),
    Requirement(
        name="TEST_MYSQL_RUN_CERT_PATH",
        kind="secret",
        profiles=("core",),
        purpose="Enables MySQL cert-path TLS matrix cases.",
        source="Set true when CA/client cert/key files are available to the runner.",
        optional=True,
    ),
    Requirement(
        name="TEST_MYSQL_SSL_CA_PATH",
        kind="secret",
        profiles=("core",),
        purpose="CA certificate path for MySQL cert-path TLS cases.",
        source="Absolute path to CA PEM file on runner.",
        optional=True,
    ),
    Requirement(
        name="TEST_MYSQL_SSL_CERT_PATH",
        kind="secret",
        profiles=("core",),
        purpose="Client certificate path for MySQL cert-path TLS cases.",
        source="Absolute path to client cert PEM file on runner.",
        optional=True,
    ),
    Requirement(
        name="TEST_MYSQL_SSL_KEY_PATH",
        kind="secret",
        profiles=("core",),
        purpose="Client private key path for MySQL cert-path TLS cases.",
        source="Absolute path to client key PEM file on runner.",
        optional=True,
    ),
    Requirement(
        name="TEST_MYSQL_RUN_CERT_PEM",
        kind="secret",
        profiles=("core",),
        purpose="Enables MySQL inline-PEM TLS matrix cases.",
        source="Set true when CA/client cert/key PEM content is provided in env.",
        optional=True,
    ),
    Requirement(
        name="TEST_MYSQL_SSL_CA",
        kind="secret",
        profiles=("core",),
        purpose="CA certificate PEM content for MySQL inline-PEM TLS cases.",
        source="PEM content from CA file.",
        optional=True,
    ),
    Requirement(
        name="TEST_MYSQL_SSL_CERT",
        kind="secret",
        profiles=("core",),
        purpose="Client certificate PEM content for MySQL inline-PEM TLS cases.",
        source="PEM content from client certificate.",
        optional=True,
    ),
    Requirement(
        name="TEST_MYSQL_SSL_KEY",
        kind="secret",
        profiles=("core",),
        purpose="Client private key PEM content for MySQL inline-PEM TLS cases.",
        source="PEM content from client key.",
        optional=True,
    ),
    Requirement(
        name="TEST_POSTGRESQL_RUN_BASIC_SSL",
        kind="secret",
        profiles=("core",),
        purpose="Enables PostgreSQL basic SSL matrix cases.",
        source="Set true only when PostgreSQL test endpoint accepts TLS.",
        optional=True,
    ),
    Requirement(
        name="TEST_POSTGRESQL_RUN_SSL_MODE",
        kind="secret",
        profiles=("core",),
        purpose="Enables PostgreSQL SSL mode matrix cases.",
        source="Set true only when PostgreSQL test endpoint supports the selected SSL mode.",
        optional=True,
    ),
    Requirement(
        name="TEST_POSTGRESQL_SSL_MODE",
        kind="secret",
        profiles=("core",),
        purpose="Optional PostgreSQL SSL mode override used by TLS mode cases.",
        source="Set to disable|allow|prefer|require|verify-ca|verify-full when needed.",
        optional=True,
    ),
    Requirement(
        name="TEST_POSTGRESQL_RUN_CERT_PATH",
        kind="secret",
        profiles=("core",),
        purpose="Enables PostgreSQL cert-path TLS matrix cases.",
        source="Set true when CA/client cert/key files are available to the runner.",
        optional=True,
    ),
    Requirement(
        name="TEST_POSTGRESQL_SSL_CA_PATH",
        kind="secret",
        profiles=("core",),
        purpose="CA certificate path for PostgreSQL cert-path TLS cases.",
        source="Absolute path to CA PEM file on runner.",
        optional=True,
    ),
    Requirement(
        name="TEST_POSTGRESQL_SSL_CERT_PATH",
        kind="secret",
        profiles=("core",),
        purpose="Client certificate path for PostgreSQL cert-path TLS cases.",
        source="Absolute path to client cert PEM file on runner.",
        optional=True,
    ),
    Requirement(
        name="TEST_POSTGRESQL_SSL_KEY_PATH",
        kind="secret",
        profiles=("core",),
        purpose="Client private key path for PostgreSQL cert-path TLS cases.",
        source="Absolute path to client key PEM file on runner.",
        optional=True,
    ),
    Requirement(
        name="TEST_POSTGRESQL_RUN_CERT_PEM",
        kind="secret",
        profiles=("core",),
        purpose="Enables PostgreSQL inline-PEM TLS matrix cases.",
        source="Set true when CA/client cert/key PEM content is provided in env.",
        optional=True,
    ),
    Requirement(
        name="TEST_POSTGRESQL_SSL_CA",
        kind="secret",
        profiles=("core",),
        purpose="CA certificate PEM content for PostgreSQL inline-PEM TLS cases.",
        source="PEM content from CA file.",
        optional=True,
    ),
    Requirement(
        name="TEST_POSTGRESQL_SSL_CERT",
        kind="secret",
        profiles=("core",),
        purpose="Client certificate PEM content for PostgreSQL inline-PEM TLS cases.",
        source="PEM content from client certificate.",
        optional=True,
    ),
    Requirement(
        name="TEST_POSTGRESQL_SSL_KEY",
        kind="secret",
        profiles=("core",),
        purpose="Client private key PEM content for PostgreSQL inline-PEM TLS cases.",
        source="PEM content from client key.",
        optional=True,
    ),
    Requirement(
        name="TEST_SQLSERVER_RUN_TLS",
        kind="secret",
        profiles=("core",),
        purpose="Enables SQL Server TLS matrix cases.",
        source="Set true when SQL Server test endpoint supports TLS.",
        optional=True,
    ),
    Requirement(
        name="TEST_SQLSERVER_RUN_STRICT_TLS",
        kind="secret",
        profiles=("core",),
        purpose="Enables SQL Server Encrypt=strict matrix cases.",
        source="Set true only when strict certificate validation succeeds in your test environment.",
        optional=True,
    ),
    Requirement(
        name="TEST_SQLSERVER_TRUST_SERVER_CERT",
        kind="secret",
        profiles=("core",),
        purpose="Controls TrustServerCertificate behavior in SQL Server strict mode tests.",
        source="Set true for self-signed certs, false with CA trust chain.",
        optional=True,
    ),
    Requirement(
        name="TEST_SQLSERVER_STRICT_TRUST_SERVER_CERT",
        kind="secret",
        profiles=("core",),
        purpose="Optional strict-mode override for TrustServerCertificate in SQL Server Encrypt=strict tests.",
        source="Set false to enforce CA+hostname validation only for strict cases while keeping non-strict cases unchanged.",
        optional=True,
    ),
    Requirement(
        name="TEST_CORE_WINDOWS_SQLSERVER_RUN_STRICT_TLS",
        kind="variable",
        profiles=("core",),
        purpose="Enable SQL Server Encrypt=strict case in Windows core named-pipe CI job.",
        source="Set true only when strict certificate validation is configured on that Windows SQL Server endpoint.",
        optional=True,
    ),
    Requirement(
        name="TEST_CORE_WINDOWS_SQLSERVER_TRUST_SERVER_CERT",
        kind="variable",
        profiles=("core",),
        purpose="TrustServerCertificate toggle for Windows core named-pipe CI job.",
        source="Set false for CA-validated strict TLS, true only when explicitly trusting server cert.",
        optional=True,
    ),
    Requirement(
        name="TEST_PIPE_COMPAT_MODE",
        kind="variable",
        profiles=("core",),
        purpose="Enable CI compatibility fallback for pipe-method matrix cases in non-pipe-capable runners.",
        source="Set true in CI when pipe combinations should execute via compatible transport fallback.",
        optional=True,
    ),
    Requirement(
        name="TEST_SOCKET_COMPAT_MODE",
        kind="variable",
        profiles=("core",),
        purpose="Enable CI compatibility fallback for socket-method matrix cases in non-socket-capable runners.",
        source="Set true in CI when socket combinations should execute via compatible transport fallback.",
        optional=True,
    ),
    Requirement(
        name="TEST_SSH_CONNECTION_STRING_COMPAT_MODE",
        kind="variable",
        profiles=("core",),
        purpose="Enable CI compatibility fallback for SSH + connection_string matrix cases in hosted CI.",
        source="Set true in CI when SSH connection-string combinations should execute via standard transport fallback.",
        optional=True,
    ),
    Requirement(
        name="TEST_TLS_CERT_COMPAT_MODE",
        kind="variable",
        profiles=("core",),
        purpose="Enable CI compatibility fallback for TLS/cert matrix variants in self-contained CI.",
        source="Set true in CI when TLS/cert combinations should execute via compatible non-TLS fallbacks.",
        optional=True,
    ),
)


def _parse_profiles(raw: str) -> tuple[str, ...]:
    if raw.strip().lower() == "all":
        return REAL_PROFILES

    result: list[str] = []
    for item in raw.split(","):
        profile = item.strip()
        if not profile:
            continue
        if profile not in REAL_PROFILES:
            raise ValueError(f"Unknown profile '{profile}'. Valid: {', '.join(REAL_PROFILES)}")
        if profile not in result:
            result.append(profile)
    if not result:
        raise ValueError("No profiles selected.")
    return tuple(result)


def _select_requirements(profiles: Iterable[str], include_optional_core: bool) -> list[Requirement]:
    selected_profiles = set(profiles)
    selected: list[Requirement] = []
    for req in REQUIREMENTS:
        if req.optional and not include_optional_core:
            continue
        if selected_profiles.intersection(req.profiles):
            selected.append(req)
    return sorted(selected, key=lambda r: (r.kind, r.name))


def _load_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for line_no, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            raise ValueError(f"Invalid line in {path} at {line_no}: expected KEY=VALUE")
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("'").strip('"')
        if not key:
            raise ValueError(f"Invalid line in {path} at {line_no}: empty key")
        values[key] = value
    return values


def _check_required_values(requirements: Iterable[Requirement], values: dict[str, str]) -> tuple[list[Requirement], list[Requirement]]:
    present: list[Requirement] = []
    missing: list[Requirement] = []
    for req in requirements:
        value = values.get(req.name, "")
        if value.strip():
            present.append(req)
        else:
            missing.append(req)
    return present, missing


def _run_gh_json(cmd: list[str]) -> list[dict[str, object]]:
    process = subprocess.run(cmd, capture_output=True, text=True)
    if process.returncode != 0:
        raise RuntimeError(process.stderr.strip() or process.stdout.strip() or "gh command failed")
    stdout = process.stdout.strip()
    if not stdout:
        return []
    parsed = json.loads(stdout)
    if not isinstance(parsed, list):
        raise RuntimeError("Unexpected gh JSON output.")
    return parsed


def _gh_names(resource: str, repo: str | None) -> set[str]:
    if resource not in {"secret", "variable"}:
        raise ValueError(f"Unsupported gh resource type: {resource}")
    cmd = ["gh", resource, "list", "--json", "name"]
    if repo:
        cmd.extend(["--repo", repo])
    payload = _run_gh_json(cmd)
    names: set[str] = set()
    for item in payload:
        name = item.get("name")
        if isinstance(name, str):
            names.add(name)
    return names


def _print_requirements(requirements: Iterable[Requirement]) -> None:
    rows = list(requirements)
    if not rows:
        print("No requirements selected.")
        return
    print("| Kind | Name | Profiles | Optional | Purpose | Source |")
    print("| --- | --- | --- | --- | --- | --- |")
    for req in rows:
        profiles = ",".join(req.profiles)
        print(
            f"| {req.kind} | {req.name} | {profiles} | "
            f"{'yes' if req.optional else 'no'} | {req.purpose} | {req.source} |"
        )


def _template_lines(requirements: Iterable[Requirement]) -> list[str]:
    lines: list[str] = []
    lines.append("# Connection Matrix environment template")
    lines.append("# Fill values and use with:")
    lines.append("# python scripts/connection_matrix_setup.py validate-env --profiles all --env-file .env.connection-matrix")
    lines.append("# python scripts/connection_matrix_setup.py apply-github --profiles all --env-file .env.connection-matrix")
    lines.append("# Add --include-optional-core in both commands when you target full core no-skip coverage.")
    lines.append("")

    for req in requirements:
        lines.append(f"# {req.kind} | profiles={','.join(req.profiles)} | optional={'yes' if req.optional else 'no'}")
        lines.append(f"# purpose: {req.purpose}")
        lines.append(f"# source: {req.source}")
        lines.append(f"{req.name}=")
        lines.append("")
    return lines


def _write_template(output_path: Path, requirements: Iterable[Requirement]) -> None:
    output_path.write_text("\n".join(_template_lines(requirements)), encoding="utf-8")
    print(f"Wrote template: {output_path}")


def _validate_env(requirements: Iterable[Requirement], env_file: Path | None) -> int:
    values = dict(os.environ)
    if env_file:
        file_values = _load_env_file(env_file)
        values.update(file_values)

    present, missing = _check_required_values(requirements, values)
    print(f"Present: {len(present)}")
    print(f"Missing: {len(missing)}")
    if missing:
        print("\nMissing keys:")
        for req in missing:
            print(f"- {req.name} ({req.kind}) -> {req.source}")
        return 1
    return 0


def _validate_github(requirements: Iterable[Requirement], repo: str | None) -> int:
    required = list(requirements)
    needed_secrets = {r.name for r in required if r.kind == "secret"}
    needed_variables = {r.name for r in required if r.kind == "variable"}

    existing_secrets = _gh_names("secret", repo)
    existing_variables = _gh_names("variable", repo)

    missing_secrets = sorted(needed_secrets - existing_secrets)
    missing_variables = sorted(needed_variables - existing_variables)

    print(f"Secrets present: {len(needed_secrets) - len(missing_secrets)}/{len(needed_secrets)}")
    print(f"Variables present: {len(needed_variables) - len(missing_variables)}/{len(needed_variables)}")

    if missing_secrets:
        print("\nMissing secrets:")
        for name in missing_secrets:
            print(f"- {name}")
    if missing_variables:
        print("\nMissing variables:")
        for name in missing_variables:
            print(f"- {name}")

    return 1 if (missing_secrets or missing_variables) else 0


def _set_gh_value(kind: str, name: str, value: str, repo: str | None, dry_run: bool) -> None:
    if kind == "secret":
        cmd = ["gh", "secret", "set", name, "--body", value]
    elif kind == "variable":
        cmd = ["gh", "variable", "set", name, "--body", value]
    else:
        raise ValueError(f"Unsupported requirement kind: {kind}")

    if repo:
        cmd.extend(["--repo", repo])

    if dry_run:
        print(f"[dry-run] {' '.join(cmd[:4])} ...")
        return

    process = subprocess.run(cmd, capture_output=True, text=True)
    if process.returncode != 0:
        message = process.stderr.strip() or process.stdout.strip() or "unknown gh error"
        raise RuntimeError(f"Failed setting {kind} {name}: {message}")
    print(f"Set {kind}: {name}")


def _apply_github(requirements: Iterable[Requirement], env_file: Path, repo: str | None, dry_run: bool) -> int:
    values = _load_env_file(env_file)
    present, missing = _check_required_values(requirements, values)

    if missing:
        print("Cannot apply because required keys are missing in env file:")
        for req in missing:
            print(f"- {req.name}")
        return 1

    for req in present:
        _set_gh_value(req.kind, req.name, values[req.name], repo, dry_run=dry_run)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Provision and validate GitHub Actions env/secrets for connection matrix tests."
    )
    sub = parser.add_subparsers(dest="command", required=True)

    for name in ("list", "template", "validate-env", "validate-github", "apply-github"):
        cmd = sub.add_parser(name)
        cmd.add_argument(
            "--profiles",
            default="core,aws,azure_ad,kerberos_windows",
            help=f"Comma-separated profile list or 'all'. Available: {', '.join(REAL_PROFILES)}",
        )
        cmd.add_argument(
            "--include-optional-core",
            action="store_true",
            help="Include optional core keys for full matrix coverage (Oracle/advanced TLS/etc).",
        )

    template_cmd = sub.choices["template"]
    template_cmd.add_argument(
        "--output",
        default=".env.connection-matrix.template",
        help="Template output path.",
    )

    validate_env_cmd = sub.choices["validate-env"]
    validate_env_cmd.add_argument(
        "--env-file",
        default=None,
        help="Optional .env file to merge over process environment.",
    )

    validate_gh_cmd = sub.choices["validate-github"]
    validate_gh_cmd.add_argument(
        "--repo",
        default=None,
        help="Optional [HOST/]OWNER/REPO passed to gh --repo.",
    )

    apply_cmd = sub.choices["apply-github"]
    apply_cmd.add_argument(
        "--env-file",
        required=True,
        help="Dotenv file containing key/value pairs to upload.",
    )
    apply_cmd.add_argument(
        "--repo",
        default=None,
        help="Optional [HOST/]OWNER/REPO passed to gh --repo.",
    )
    apply_cmd.add_argument(
        "--dry-run",
        action="store_true",
        help="Print actions without writing to GitHub.",
    )
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    try:
        profiles = _parse_profiles(args.profiles)
        requirements = _select_requirements(profiles, include_optional_core=args.include_optional_core)
    except ValueError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 2

    if args.command == "list":
        _print_requirements(requirements)
        return 0

    if args.command == "template":
        output = Path(args.output)
        _write_template(output, requirements)
        return 0

    if args.command == "validate-env":
        env_file = Path(args.env_file) if args.env_file else None
        return _validate_env(requirements, env_file)

    if args.command == "validate-github":
        try:
            return _validate_github(requirements, repo=args.repo)
        except RuntimeError as exc:
            print(f"Error: {exc}", file=sys.stderr)
            return 1

    if args.command == "apply-github":
        env_file = Path(args.env_file)
        if not env_file.exists():
            print(f"Error: env file not found: {env_file}", file=sys.stderr)
            return 2
        try:
            return _apply_github(requirements, env_file=env_file, repo=args.repo, dry_run=args.dry_run)
        except (RuntimeError, ValueError) as exc:
            print(f"Error: {exc}", file=sys.stderr)
            return 1

    parser.print_help()
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
