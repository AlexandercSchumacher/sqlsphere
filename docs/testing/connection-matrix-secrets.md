# Connection Matrix Secrets and Infrastructure

This guide defines exactly which GitHub Actions variables/secrets you need,
what each key is used for, and where each value comes from.

It complements:

- `.github/workflows/connection-matrix.yml`
- `docs/testing/connection-matrix.md`
- `scripts/connection_matrix_setup.py`
- `docs/testing/connection-matrix-secrets-de.md` (German step-by-step guide with official web links)

## 1. Mandatory baseline

You always need:

- `FASTAPI_AUTH_TOKEN` (GitHub Secret)
  - Used by: all matrix jobs
  - Purpose: authorizes test requests to `/connect` and `/query`
  - Source: backend runtime environment variable `FASTAPI_AUTH_TOKEN`

## 2. Job toggles (GitHub Variables)

Set these in `Settings -> Secrets and variables -> Actions -> Variables`:

- `RUN_AWS_MATRIX` (`true` or `false`)
- `RUN_AZURE_AD_MATRIX` (`true` or `false`)
- `RUN_KERBEROS_WINDOWS_MATRIX` (`true` or `false`)

Recommendation:

1. Start with all three set to `false`.
2. Enable each flag only after its profile secrets and infra are ready.

## 3. Required keys by profile

### 3.1 AWS profile (`pytest -m aws`)

Infrastructure needed:

- AWS account + region
- MySQL test DB endpoint (RDS/Aurora)
- PostgreSQL test DB endpoint (RDS/Aurora)
- IAM credentials for token generation
- Dedicated SSH bastion in the same VPC (for AWS `ssh` matrix cases)

Secrets:

- `TEST_AWS_REGION`
- `TEST_AWS_ACCESS_KEY_ID`
- `TEST_AWS_SECRET_ACCESS_KEY`
- `TEST_AWS_USE_INSTANCE_PROFILE`
- `TEST_AWS_MYSQL_HOST`
- `TEST_AWS_MYSQL_PORT`
- `TEST_AWS_MYSQL_DATABASE`
- `TEST_AWS_MYSQL_USERNAME`
- `TEST_AWS_POSTGRESQL_HOST`
- `TEST_AWS_POSTGRESQL_PORT`
- `TEST_AWS_POSTGRESQL_DATABASE`
- `TEST_AWS_POSTGRESQL_USERNAME`
- `TEST_AWS_SSH_HOST`
- `TEST_AWS_SSH_PORT`
- `TEST_AWS_SSH_USERNAME`
- `TEST_AWS_SSH_PRIVATE_KEY` (optional, for key auth)
- `TEST_AWS_SSH_PASSWORD` (optional, for password auth)
- `TEST_AWS_MYSQL_SSH_DB_HOST` (optional)
- `TEST_AWS_POSTGRESQL_SSH_DB_HOST` (optional)

Where to get values:

1. Region: AWS console/CLI region of your DB instances.
2. Access key/secret: IAM user credentials used for CI (or set `TEST_AWS_USE_INSTANCE_PROFILE=true` for role-based credentials).
3. DB host/port: RDS or Aurora endpoint details.
4. DB database/user: dedicated test DB and test user with minimal read permissions.
5. SSH bastion values:
   - `TEST_AWS_SSH_HOST`: bastion public IP/DNS
   - `TEST_AWS_SSH_PORT`: usually `22`
   - `TEST_AWS_SSH_USERNAME`: e.g. `ec2-user`
   - set one auth path:
     - `TEST_AWS_SSH_PRIVATE_KEY`: PEM content of the EC2 keypair private key
     - `TEST_AWS_SSH_PASSWORD`: bastion user password

### 3.2 Azure AD profile (`pytest -m azure_ad`)

Infrastructure needed:

- Azure tenant (Entra ID)
- App registration for token flow
- PostgreSQL test endpoint
- SQL Server test endpoint

Secrets:

- `TEST_AZURE_TENANT_ID`
- `TEST_AZURE_CLIENT_ID`
- `TEST_AZURE_CLIENT_SECRET`
- `TEST_AZURE_POSTGRESQL_HOST`
- `TEST_AZURE_POSTGRESQL_PORT`
- `TEST_AZURE_POSTGRESQL_DATABASE`
- `TEST_AZURE_POSTGRESQL_USERNAME`
- `TEST_AZURE_POSTGRESQL_PASSWORD`
- `TEST_AZURE_SQLSERVER_HOST`
- `TEST_AZURE_SQLSERVER_PORT`
- `TEST_AZURE_SQLSERVER_DATABASE`
- `TEST_AZURE_SQLSERVER_USERNAME`
- `TEST_AZURE_SQLSERVER_PASSWORD`
- `TEST_AZURE_SQLSERVER_NAMED_PIPE` (only when pipe tests are supported)

Where to get values:

1. Tenant/app values: Azure Portal -> Entra ID / App registrations.
2. Client secret: Azure Portal -> App registration -> Certificates & secrets.
3. DB host/port/database/user/password: Azure DB resource connection details and test user credentials.

### 3.3 Kerberos/Windows profile (`pytest -m kerberos_windows`)

Infrastructure needed:

- Windows runner environment with Kerberos-capable network path
- AD/Kerberos domain
- Kerberos-enabled PostgreSQL test endpoint
- Kerberos-enabled SQL Server test endpoint

Secrets:

- `TEST_KERBEROS_POSTGRESQL_HOST`
- `TEST_KERBEROS_POSTGRESQL_PORT`
- `TEST_KERBEROS_POSTGRESQL_DATABASE`
- `TEST_KERBEROS_POSTGRESQL_USERNAME`
- `TEST_KERBEROS_SQLSERVER_HOST`
- `TEST_KERBEROS_SQLSERVER_PORT`
- `TEST_KERBEROS_SQLSERVER_DATABASE`
- `TEST_KERBEROS_SQLSERVER_USERNAME`
- `TEST_KERBEROS_SQLSERVER_NAMED_PIPE` (only when named pipe tests are supported)

Where to get values:

1. Host/port/database: from your Kerberos-enabled test DB deployments.
2. User names: AD/Kerberos principals mapped to DB logins.
3. Named pipe: SQL Server pipe path from the Windows SQL Server configuration.

## 4. Optional keys for full core coverage (reduce skips)

The `core` profile intentionally generates many combinations. Some need additional keys and/or infrastructure.
Without these values, those combinations are skipped.

Important groups:

- Connection string keys:
  - `TEST_MYSQL_CONNECTION_STRING`
  - `TEST_POSTGRESQL_CONNECTION_STRING`
  - `TEST_SQLSERVER_CONNECTION_STRING`
  - `TEST_ORACLE_CONNECTION_STRING`
  - `TEST_ORACLE_TLS_CONNECTION_STRING`
- SSH keys:
  - `TEST_SSH_HOST`, `TEST_SSH_PORT`, `TEST_SSH_USERNAME`, `TEST_SSH_PASSWORD`/`TEST_SSH_KEY_FILE`
  - optional DB target overrides like `TEST_MYSQL_SSH_DB_HOST`
- Socket/Pipe keys:
  - `TEST_MYSQL_SOCKET_PATH`, `TEST_POSTGRESQL_SOCKET_PATH`
  - `TEST_MYSQL_NAMED_PIPE`, `TEST_SQLSERVER_NAMED_PIPE`
  - dedicated Windows pipe CI job:
    - `TEST_CORE_WINDOWS_SQLSERVER_HOST`, `TEST_CORE_WINDOWS_SQLSERVER_PORT`, `TEST_CORE_WINDOWS_SQLSERVER_DATABASE`
    - `TEST_CORE_WINDOWS_SQLSERVER_USERNAME`, `TEST_CORE_WINDOWS_SQLSERVER_PASSWORD`, `TEST_CORE_WINDOWS_SQLSERVER_NAMED_PIPE`
    - `TEST_CORE_WINDOWS_SQLSERVER_CONNECTION_STRING`
    - optional SMB pre-auth credentials for remote named pipe: `TEST_CORE_WINDOWS_SQLSERVER_SMB_USERNAME`, `TEST_CORE_WINDOWS_SQLSERVER_SMB_PASSWORD`
    - optional variables: `TEST_CORE_WINDOWS_SQLSERVER_RUN_STRICT_TLS`, `TEST_CORE_WINDOWS_SQLSERVER_TRUST_SERVER_CERT`
- TLS toggles and material:
  - `TEST_MYSQL_RUN_BASIC_SSL`, `TEST_MYSQL_RUN_SSL_MODE`, `TEST_MYSQL_SSL_MODE`
  - `TEST_POSTGRESQL_RUN_BASIC_SSL`, `TEST_POSTGRESQL_RUN_SSL_MODE`, `TEST_POSTGRESQL_SSL_MODE`
  - `TEST_SQLSERVER_RUN_TLS`, `TEST_SQLSERVER_RUN_STRICT_TLS`, `TEST_SQLSERVER_TRUST_SERVER_CERT`
  - optional strict override: `TEST_SQLSERVER_STRICT_TRUST_SERVER_CERT`
  - cert-path: `TEST_<DB>_RUN_CERT_PATH`, `TEST_<DB>_SSL_CA_PATH`, `TEST_<DB>_SSL_CERT_PATH`, `TEST_<DB>_SSL_KEY_PATH`
  - cert-PEM: `TEST_<DB>_RUN_CERT_PEM`, `TEST_<DB>_SSL_CA`, `TEST_<DB>_SSL_CERT`, `TEST_<DB>_SSL_KEY`
- Oracle base keys:
  - `TEST_ORACLE_HOST`, `TEST_ORACLE_PORT`, `TEST_ORACLE_DATABASE`, `TEST_ORACLE_USERNAME`, `TEST_ORACLE_PASSWORD`

Use this command to list all currently modeled keys:

```bash
python scripts/connection_matrix_setup.py list --profiles all --include-optional-core
```

## 5. End-to-end setup workflow

1. Generate template:

```bash
python scripts/connection_matrix_setup.py template --profiles all --include-optional-core --output .env.connection-matrix
```

2. Fill `.env.connection-matrix` with real values.

3. Validate completeness locally:

```bash
python scripts/connection_matrix_setup.py validate-env --profiles all --env-file .env.connection-matrix
```

For full core no-skip coverage (Oracle/advanced TLS/socket/pipe/SSH variants), validate with:

```bash
python scripts/connection_matrix_setup.py validate-env --profiles all --include-optional-core --env-file .env.connection-matrix
```

4. Validate GitHub repository currently configured values:

```bash
python scripts/connection_matrix_setup.py validate-github --profiles all
```

5. Upload keys to GitHub:

```bash
python scripts/connection_matrix_setup.py apply-github --profiles all --env-file .env.connection-matrix
```

For full core no-skip coverage, upload with:

```bash
python scripts/connection_matrix_setup.py apply-github --profiles all --include-optional-core --env-file .env.connection-matrix
```

6. Re-validate GitHub:

```bash
python scripts/connection_matrix_setup.py validate-github --profiles all
```

7. Enable profile flags in GitHub Variables (`RUN_*_MATRIX=true`) and run workflow.

## 6. Security and operations defaults

- Use dedicated test infrastructure, never production endpoints.
- Keep permissions minimal (least privilege for IAM/Azure/AD identities).
- Rotate credentials and secrets regularly.
- Prefer short-lived credentials where possible.
- Store all sensitive values as GitHub Secrets (not Variables).
