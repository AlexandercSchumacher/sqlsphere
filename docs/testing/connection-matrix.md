# Connection Matrix Testing

This test suite validates that SQLSphere can connect and execute a test query for supported combinations of:

- database type
- connection method
- authentication method
- SSL/TLS variant

It is constraint-based: only backend-supported combinations are generated.

## Files

- `tests/test_connection_matrix.py`: main matrix tests
- `tests/matrix/capabilities.yaml`: backend capability source for tests
- `tests/matrix/profiles.yaml`: profile-specific case generation (`core`, `ci_tls_connection_string`, `ci_ssh`, `aws`, `azure_ad`, `kerberos_windows`)
- `tests/helpers/matrix_loader.py`: case generation + validation
- `tests/helpers/payload_builder.py`: payload construction and env/default resolution
- `tests/docker-compose.test.yml`: local core DB containers

## Local Run (Core + Self-Contained Advanced)

```bash
docker compose -f tests/docker-compose.test.yml up -d --wait
pip install -r requirements.txt
pip install -r tests/requirements-test.txt
pytest -m "core or ci_tls_connection_string or ci_ssh" -q
docker compose -f tests/docker-compose.test.yml down -v
```

`core` uses defaults for plain TCP SQL auth against local containers:

- MySQL: `127.0.0.1:3306`, db `sqlsphere_mysql`
- PostgreSQL: `127.0.0.1:5432`, db `sqlsphere_pg`
- SQL Server: `127.0.0.1:1433`, db `master`

Oracle is part of the matrix, but runs only when Oracle env vars are provided.

## Optional Profiles

```bash
pytest -m aws -q
pytest -m azure_ad -q
pytest -m kerberos_windows -q
```

These profiles are opt-in and rely on external infrastructure + env vars/secrets.

## Key Environment Variables

### Generic per DB

- `TEST_<DB>_HOST`
- `TEST_<DB>_PORT`
- `TEST_<DB>_DATABASE`
- `TEST_<DB>_USERNAME`
- `TEST_<DB>_PASSWORD`

`<DB>` is one of: `MYSQL`, `POSTGRESQL`, `SQLSERVER`, `ORACLE`.

### Connection methods

- SSH:
  - `TEST_<DB>_SSH_HOST` (or fallback `TEST_SSH_HOST`)
  - `TEST_<DB>_SSH_PORT` (or `TEST_SSH_PORT`)
  - `TEST_<DB>_SSH_USERNAME` (or `TEST_SSH_USERNAME`)
  - `TEST_<DB>_SSH_PASSWORD` or `TEST_<DB>_SSH_KEY_FILE`
  - optional SSH tunnel DB target override: `TEST_<DB>_SSH_DB_HOST`, `TEST_<DB>_SSH_DB_PORT`
- Socket:
  - `TEST_<DB>_SOCKET_PATH`
- Pipe:
  - `TEST_<DB>_NAMED_PIPE`

### Auth methods

- Connection string:
  - `TEST_<DB>_CONNECTION_STRING`
  - Oracle TLS via connection string: `TEST_ORACLE_TLS_CONNECTION_STRING`
- AWS IAM:
  - `TEST_AWS_REGION`
  - optional: `TEST_AWS_ACCESS_KEY_ID`, `TEST_AWS_SECRET_ACCESS_KEY`, `TEST_AWS_USE_INSTANCE_PROFILE`
- Azure AD:
  - `TEST_AZURE_TENANT_ID`
  - `TEST_AZURE_CLIENT_ID`
  - `TEST_AZURE_CLIENT_SECRET`

### TLS variants (opt-in flags)

- Basic SSL: `TEST_<DB>_RUN_BASIC_SSL=true`
- SSL mode cases: `TEST_<DB>_RUN_SSL_MODE=true`
- Cert path: `TEST_<DB>_RUN_CERT_PATH=true` +
  - `TEST_<DB>_SSL_CA_PATH`
  - `TEST_<DB>_SSL_CERT_PATH`
  - `TEST_<DB>_SSL_KEY_PATH`
- Cert PEM: `TEST_<DB>_RUN_CERT_PEM=true` +
  - `TEST_<DB>_SSL_CA`
  - `TEST_<DB>_SSL_CERT`
  - `TEST_<DB>_SSL_KEY`
- SQL Server TLS variants: `TEST_SQLSERVER_RUN_TLS=true`
- SQL Server Encrypt=strict variants: `TEST_SQLSERVER_RUN_STRICT_TLS=true`
- SQL Server strict TrustServerCertificate override: `TEST_SQLSERVER_STRICT_TRUST_SERVER_CERT=false`
  - In the default self-contained Linux CI, strict remains opt-in and can be left disabled when the driver/server combination does not support `Encrypt=strict` reliably.

## Skip Behavior

A generated test case is skipped if its required env vars or runtime prerequisites are missing.
This keeps the matrix deterministic while allowing incremental rollout of advanced auth/TLS environments.

## CI

Workflow: `.github/workflows/connection-matrix.yml`

- `core`: always runs on Linux with dockerized DBs
  - includes self-contained `ssh`, `connection_string`, and TLS cases via markers `ci_ssh` and `ci_tls_connection_string`
- `core_windows_pipe`: runs on Windows and targets SQL Server named-pipe core combinations (`pipe + sql_auth`)
  - uses `TEST_CORE_WINDOWS_SQLSERVER_*` secrets for host/db/login/pipe/connection_string endpoint data
  - supports optional SMB pre-auth (for remote named-pipe access) via `TEST_CORE_WINDOWS_SQLSERVER_SMB_USERNAME` and `TEST_CORE_WINDOWS_SQLSERVER_SMB_PASSWORD`
  - excludes `sqlserver_encrypt_strict` for `pipe` because this transport/TLS combo is not portable in CI
  - optional strict TLS toggles via variables `TEST_CORE_WINDOWS_SQLSERVER_RUN_STRICT_TLS` and `TEST_CORE_WINDOWS_SQLSERVER_TRUST_SERVER_CERT`
- `aws`: runs when repo variable `RUN_AWS_MATRIX=true` (and uses AWS secrets for credentials/endpoints)
- `azure_ad`: runs when repo variable `RUN_AZURE_AD_MATRIX=true` (and uses Azure secrets)
- `kerberos_windows`: runs on Windows when repo variable `RUN_KERBEROS_WINDOWS_MATRIX=true` (and uses Kerberos/DB secrets)
- external profile jobs fail fast with `scripts/connection_matrix_setup.py validate-env` if required keys are missing

## Secrets Automation

Use `scripts/connection_matrix_setup.py` to manage matrix environment setup:

```bash
# Show requirements with purpose/source
python scripts/connection_matrix_setup.py list --profiles all --include-optional-core

# Generate editable env template
python scripts/connection_matrix_setup.py template --profiles all --include-optional-core --output .env.connection-matrix

# Validate local env file completeness
python scripts/connection_matrix_setup.py validate-env --profiles all --env-file .env.connection-matrix

# Validate currently configured GitHub repo keys
python scripts/connection_matrix_setup.py validate-github --profiles all

# Apply all keys from env file to GitHub (secrets + variables)
python scripts/connection_matrix_setup.py apply-github --profiles all --env-file .env.connection-matrix
```

If your target is full no-skip core coverage (Oracle + advanced TLS/socket/pipe/SSH), add `--include-optional-core` to `validate-env` and `apply-github`.

Detailed per-key documentation:

- `docs/testing/connection-matrix-secrets.md`
- `docs/testing/connection-matrix-secrets-de.md` (deutsche Schritt-für-Schritt-Version mit offiziellen Weblinks)
