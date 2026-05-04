# Connection Matrix: Secrets/Environments Setup (DE)

Dieses Dokument beschreibt exakt:

1. Welche GitHub Actions `Secrets` und `Variables` du brauchst.
2. Wofür jeder Key verwendet wird.
3. Wie du jeden Wert erzeugst/beschaffst.
4. Welche offiziellen Webseiten/Dokumentationen du dafür nutzt.

Es basiert auf der aktuellen Implementierung in:

- `.github/workflows/connection-matrix.yml`
- `scripts/connection_matrix_setup.py`

## 1. Offizielle Webseiten / Dokumentation

### GitHub Actions

- Secrets in GitHub Actions:
  - <https://docs.github.com/actions/how-tos/security-for-github-actions/security-guides/using-secrets-in-github-actions>
- Variables in GitHub Actions:
  - <https://docs.github.com/actions/how-tos/writing-workflows/choosing-what-your-workflow-does/store-information-in-variables>
- `gh secret set`:
  - <https://cli.github.com/manual/gh_secret_set>
- `gh variable set`:
  - <https://cli.github.com/manual/gh_variable_set>
- Self-hosted Runner (für Kerberos/Domain-Szenarien oft notwendig):
  - <https://docs.github.com/en/actions/hosting-your-own-runners/managing-self-hosted-runners/about-self-hosted-runners>

### AWS

- RDS DB-Instanz erstellen:
  - <https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_CreateDBInstance.html>
- RDS Endpoint/Port:
  - <https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_CommonTasks.Connect.EndpointAndPort.html>
- IAM Database Authentication (RDS):
  - <https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.IAMDBAuth.html>
- IAM Access Keys verwalten:
  - <https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html>

### Azure

- Entra App + Service Principal registrieren:
  - <https://learn.microsoft.com/en-us/entra/identity-platform/howto-create-service-principal-portal>
- Client Secret hinzufügen:
  - <https://learn.microsoft.com/en-us/entra/identity-platform/how-to-add-credentials>
- Azure Database for PostgreSQL erstellen:
  - <https://learn.microsoft.com/en-us/azure/postgresql/flexible-server/quickstart-create-server-portal>
- Azure SQL Database erstellen:
  - <https://learn.microsoft.com/en-us/azure/azure-sql/database/single-database-create-quickstart>

### Kerberos / SQL Server / PostgreSQL

- SQL Server SPN für Kerberos:
  - <https://learn.microsoft.com/en-us/sql/database-engine/configure-windows/register-a-service-principal-name-for-kerberos-connections?view=sql-server-ver17>
- SQL Server Netzwerkprotokolle aktivieren (TCP/Named Pipes):
  - <https://learn.microsoft.com/en-us/sql/database-engine/configure-windows/enable-or-disable-a-server-network-protocol?view=sql-server-ver17>
- PostgreSQL GSSAPI/Kerberos:
  - <https://www.postgresql.org/docs/current/gssapi-auth.html>
- PostgreSQL `pg_hba.conf` Auth-Methoden:
  - <https://www.postgresql.org/docs/current/auth-pg-hba-conf.html>

## 2. Wo diese Keys in GitHub angelegt werden

In deinem GitHub Repository:

1. `Settings`
2. `Secrets and variables`
3. `Actions`
4. Tab `Secrets` für alle sensiblen Werte
5. Tab `Variables` für nicht-sensitive Feature-Toggles

## 3. Pflicht-Keys (ohne full-core Optionalfälle)

## 3.1 Global Pflicht

| Key | Typ | Verwendet von | Zweck | Woher |
| --- | --- | --- | --- | --- |
| `FASTAPI_AUTH_TOKEN` | Secret | alle Jobs | Auth gegen Backend-Endpoints `/connect` und `/query` | Wert aus deinem Backend-Environment (`FASTAPI_AUTH_TOKEN`) |

## 3.2 Job-Flags (Variables)

| Key | Typ | Verwendet von | Zweck | Wert |
| --- | --- | --- | --- | --- |
| `RUN_AWS_MATRIX` | Variable | `aws` Job | AWS-Profil aktivieren/deaktivieren | `true` oder `false` |
| `RUN_AZURE_AD_MATRIX` | Variable | `azure_ad` Job | Azure-Profil aktivieren/deaktivieren | `true` oder `false` |
| `RUN_KERBEROS_WINDOWS_MATRIX` | Variable | `kerberos_windows` Job | Kerberos/Windows-Profil aktivieren/deaktivieren | `true` oder `false` |

## 3.3 AWS-Profil Keys

| Key | Typ | Zweck | Wie erstellen / beschaffen |
| --- | --- | --- | --- |
| `TEST_AWS_REGION` | Secret | AWS Region für IAM Token Flow | Region der Test-RDS Instanzen (z. B. `eu-central-1`) |
| `TEST_AWS_ACCESS_KEY_ID` | Secret | Programmatic Auth in CI | IAM User Access Key ID erzeugen |
| `TEST_AWS_SECRET_ACCESS_KEY` | Secret | Programmatic Auth in CI | Beim Erstellen des Access Keys einmalig kopieren |
| `TEST_AWS_USE_INSTANCE_PROFILE` | Secret | Umschalten auf Role/Profile-basierte Credentials | `false` bei Key-Pair-Nutzung, sonst `true` |
| `TEST_AWS_MYSQL_HOST` | Secret | MySQL Endpoint | RDS/Aurora Endpoint |
| `TEST_AWS_MYSQL_PORT` | Secret | MySQL Port | i. d. R. `3306` |
| `TEST_AWS_MYSQL_DATABASE` | Secret | MySQL DB-Name | eigener Test-DB Name |
| `TEST_AWS_MYSQL_USERNAME` | Secret | MySQL Login | Test-User mit minimalen Rechten |
| `TEST_AWS_POSTGRESQL_HOST` | Secret | PostgreSQL Endpoint | RDS/Aurora Endpoint |
| `TEST_AWS_POSTGRESQL_PORT` | Secret | PostgreSQL Port | i. d. R. `5432` |
| `TEST_AWS_POSTGRESQL_DATABASE` | Secret | PostgreSQL DB-Name | eigener Test-DB Name |
| `TEST_AWS_POSTGRESQL_USERNAME` | Secret | PostgreSQL Login | Test-User mit minimalen Rechten |
| `TEST_AWS_SSH_HOST` | Secret | SSH Bastion Host für AWS `ssh`-Cases | Öffentliche IP/DNS einer dedizierten Bastion im gleichen VPC |
| `TEST_AWS_SSH_PORT` | Secret | SSH Port der Bastion | Normalerweise `22` |
| `TEST_AWS_SSH_USERNAME` | Secret | SSH Login-User der Bastion | z. B. `ec2-user` auf Amazon Linux |
| `TEST_AWS_SSH_PRIVATE_KEY` | Secret | Optionaler privater SSH-Key (PEM) für Bastion Login | Key-Material des EC2-Keypairs (wenn Key-Auth genutzt wird) |
| `TEST_AWS_SSH_PASSWORD` | Secret | Optionales SSH Passwort für Bastion Login | Passwort des Bastion-Users (wenn Password-Auth genutzt wird) |
| `TEST_AWS_MYSQL_SSH_DB_HOST` | Secret | Optionales Remote-DB-Host Override für MySQL über SSH | In der Regel identisch zu `TEST_AWS_MYSQL_HOST` |
| `TEST_AWS_POSTGRESQL_SSH_DB_HOST` | Secret | Optionales Remote-DB-Host Override für PostgreSQL über SSH | In der Regel identisch zu `TEST_AWS_POSTGRESQL_HOST` |

## 3.4 Azure-Profil Keys

| Key | Typ | Zweck | Wie erstellen / beschaffen |
| --- | --- | --- | --- |
| `TEST_AZURE_TENANT_ID` | Secret | Tenant für Token-Flow | Entra ID -> Tenant |
| `TEST_AZURE_CLIENT_ID` | Secret | App/SP Client ID | App Registration |
| `TEST_AZURE_CLIENT_SECRET` | Secret | App/SP Secret | Certificates & secrets |
| `TEST_AZURE_POSTGRESQL_HOST` | Secret | PG Endpoint | Azure PostgreSQL Host |
| `TEST_AZURE_POSTGRESQL_PORT` | Secret | PG Port | i. d. R. `5432` |
| `TEST_AZURE_POSTGRESQL_DATABASE` | Secret | PG DB-Name | Test-DB |
| `TEST_AZURE_POSTGRESQL_USERNAME` | Secret | PG User | Test-User |
| `TEST_AZURE_POSTGRESQL_PASSWORD` | Secret | PG Passwort | Password des Test-Users |
| `TEST_AZURE_SQLSERVER_HOST` | Secret | SQL Server Endpoint | Azure SQL Host |
| `TEST_AZURE_SQLSERVER_PORT` | Secret | SQL Server Port | i. d. R. `1433` |
| `TEST_AZURE_SQLSERVER_DATABASE` | Secret | SQL Server DB-Name | Test-DB |
| `TEST_AZURE_SQLSERVER_USERNAME` | Secret | SQL Server User | Test-User |
| `TEST_AZURE_SQLSERVER_PASSWORD` | Secret | SQL Server Passwort | Password des Test-Users |
| `TEST_AZURE_SQLSERVER_NAMED_PIPE` | Secret | Named Pipe Cases | Nur wenn Named Pipes in deiner Umgebung real verfügbar sind |

## 3.5 Kerberos/Windows-Profil Keys

| Key | Typ | Zweck | Wie erstellen / beschaffen |
| --- | --- | --- | --- |
| `TEST_KERBEROS_POSTGRESQL_HOST` | Secret | PG Endpoint | Kerberos-fähige PostgreSQL Instanz |
| `TEST_KERBEROS_POSTGRESQL_PORT` | Secret | PG Port | i. d. R. `5432` |
| `TEST_KERBEROS_POSTGRESQL_DATABASE` | Secret | PG DB-Name | Test-DB |
| `TEST_KERBEROS_POSTGRESQL_USERNAME` | Secret | Kerberos Principal/User | AD-User, der in PostgreSQL gemappt ist |
| `TEST_KERBEROS_SQLSERVER_HOST` | Secret | SQL Server Endpoint | Kerberos-fähige SQL Server Instanz |
| `TEST_KERBEROS_SQLSERVER_PORT` | Secret | SQL Server Port | i. d. R. `1433` |
| `TEST_KERBEROS_SQLSERVER_DATABASE` | Secret | SQL Server DB-Name | Test-DB |
| `TEST_KERBEROS_SQLSERVER_USERNAME` | Secret | Kerberos Principal/User | AD-User mit Login-Rechten |
| `TEST_KERBEROS_SQLSERVER_NAMED_PIPE` | Secret | Named Pipe Cases | Nur wenn Named Pipes aktiv und erreichbar sind |

## 4. Schritt-für-Schritt: Werte wirklich erzeugen

### 4.1 GitHub Side vorbereiten

1. `FASTAPI_AUTH_TOKEN` im Repo als Secret setzen.
2. `RUN_AWS_MATRIX`, `RUN_AZURE_AD_MATRIX`, `RUN_KERBEROS_WINDOWS_MATRIX` zuerst auf `false`.
3. Erst nach komplettem Profil-Setup auf `true` setzen.

### 4.2 AWS Werte erzeugen

1. RDS MySQL + RDS PostgreSQL Testinstanzen erstellen.
2. Endpoint, Port, DB Name notieren.
3. Pro Engine Test-User anlegen.
4. IAM DB Auth aktivieren (falls `aws_iam` getestet wird).
5. IAM User/Role für CI erstellen und Access Key/Secret erzeugen.
6. Dedizierte SSH-Bastion erstellen (EC2 im gleichen VPC wie RDS), Port 22 freigeben, Keypair erzeugen.
7. `TEST_AWS_SSH_*` Secrets plus optionale `TEST_AWS_*_SSH_DB_HOST` setzen.
8. Alle `TEST_AWS_*` Secrets in GitHub eintragen.

### 4.3 Azure Werte erzeugen

1. Entra App Registration erzeugen.
2. `Tenant ID`, `Client ID` notieren.
3. Client Secret erzeugen und sofort sichern.
4. Azure PostgreSQL Testserver erstellen.
5. Azure SQL Testdatenbank erstellen.
6. Test-User für PG und SQL Server anlegen.
7. Alle `TEST_AZURE_*` Secrets in GitHub eintragen.

### 4.4 Kerberos/Windows Werte erzeugen

1. Windows-Domain/AD Umgebung bereitstellen (oder bestehende nutzen).
2. SQL Server SPN korrekt registrieren.
3. SQL Server Protokolle (TCP/Named Pipes) je nach Testfall aktivieren.
4. PostgreSQL für GSSAPI/Kerberos konfigurieren (`pg_hba.conf`, Mapping).
5. AD User/Principal in DB-Logins/Rollen mappen.
6. Alle `TEST_KERBEROS_*` Secrets in GitHub eintragen.

## 5. Optional: full-core/no-skip Abdeckung

Der `core`-Block kann ohne Zusatz-Infra laufen, aber viele Cases werden sonst geskippt.

Für komplette Abdeckung brauchst du zusätzlich:

1. Oracle-Zielsystem + Oracle-Verbindungsdaten
2. TLS-Zertifikate (Path oder PEM) je DB
3. Socket/Pipe erreichbare Umgebungen
4. SSH-Bastion-Setups inkl. DB-Host-Overrides
5. Für den dedizierten Windows-Pipe-Job: `TEST_CORE_WINDOWS_SQLSERVER_*` Secrets inkl. `TEST_CORE_WINDOWS_SQLSERVER_CONNECTION_STRING` sowie optional `TEST_CORE_WINDOWS_SQLSERVER_SMB_USERNAME`/`TEST_CORE_WINDOWS_SQLSERVER_SMB_PASSWORD` für SMB-Pre-Auth
6. Optional für Windows-Strict-TLS: `TEST_CORE_WINDOWS_SQLSERVER_RUN_STRICT_TLS` und `TEST_CORE_WINDOWS_SQLSERVER_TRUST_SERVER_CERT` (GitHub Variables)
7. Optional für Linux-Core-Strict-TLS-Override: `TEST_SQLSERVER_STRICT_TRUST_SERVER_CERT`

Exakte Liste aller optionalen Keys:

```bash
python scripts/connection_matrix_setup.py list --profiles core --include-optional-core
```

## 6. Automatisiert prüfen und hochladen

### 6.1 Template erzeugen

```bash
python scripts/connection_matrix_setup.py template --profiles all --include-optional-core --output .env.connection-matrix
```

### 6.2 Datei befüllen und validieren

```bash
python scripts/connection_matrix_setup.py validate-env --profiles all --env-file .env.connection-matrix
python scripts/connection_matrix_setup.py validate-env --profiles all --include-optional-core --env-file .env.connection-matrix
```

### 6.3 In GitHub schreiben

```bash
python scripts/connection_matrix_setup.py apply-github --profiles all --env-file .env.connection-matrix
python scripts/connection_matrix_setup.py apply-github --profiles all --include-optional-core --env-file .env.connection-matrix
```

### 6.4 Gegen GitHub prüfen

```bash
python scripts/connection_matrix_setup.py validate-github --profiles all
python scripts/connection_matrix_setup.py validate-github --profiles all --include-optional-core
```

## 7. Was nach dem Setup passieren muss

1. Profil-Variable(n) auf `true` setzen.
2. Workflow `.github/workflows/connection-matrix.yml` manuell starten.
3. Bei externen Jobs prüft ein Preflight automatisch fehlende Keys:
   - `python scripts/connection_matrix_setup.py validate-env --profiles aws`
   - `python scripts/connection_matrix_setup.py validate-env --profiles azure_ad`
   - `python scripts/connection_matrix_setup.py validate-env --profiles kerberos_windows`

## 8. Typische Fehlerbilder

| Symptom | Ursache | Fix |
| --- | --- | --- |
| Externer Job startet nicht | `RUN_*_MATRIX` steht auf `false` | Variable auf `true` |
| Externer Job failt direkt im Preflight | Pflicht-Key fehlt | fehlenden Secret/Variable setzen |
| AWS IAM Auth schlägt fehl | Region/Key falsch oder IAM DB Auth nicht aktiv | Region + IAM + RDS IAM Auth prüfen |
| Azure SP Flow schlägt fehl | Tenant/Client/Secret inkonsistent | App Registration Werte neu prüfen |
| Kerberos wird nicht verwendet | SPN oder Domain Trust fehlerhaft | SPN Registrierung und `auth_scheme` prüfen |
