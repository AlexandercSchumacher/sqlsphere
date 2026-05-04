# Local Database Agent

Der Local Database Agent ermöglicht es, sich mit lokalen Datenbanken zu verbinden, ohne dass die Datenbank direkt aus dem Internet erreichbar sein muss.

## Architektur

```
Web UI → Backend (REST) → Agent (WebSocket) → Lokale Datenbank
```

1. **Web UI**: Generiert einen Connection Code
2. **Backend**: Verwaltet Agent-Verbindungen über WebSocket
3. **Agent**: Läuft lokal auf dem User-Rechner, verbindet sich zu Backend
4. **Lokale DB**: Agent führt SQL-Queries lokal aus

## Installation

### Voraussetzungen

- Python 3.8+
- Datenbank-Treiber installiert:
  - **SQL Server**: ODBC Driver 17 for SQL Server
  - **MySQL**: `mysql-connector-python` oder ODBC Driver
  - **PostgreSQL**: `psycopg2-binary`

### Python-Pakete installieren

```bash
pip install websockets pyodbc mysql-connector-python psycopg2-binary
```

## Verwendung

### 1. Connection Code generieren

1. Öffne die Connections-Seite in der Web-App
2. Klicke auf "Add Connection"
3. Wähle "Local Database (Agent)" als Connection Method
4. Klicke auf "Generate Code"
5. Kopiere den generierten Connection Code

### 2. Agent starten

#### SQL Server

```bash
python local_db_agent.py \
  --connection-code YOUR_CONNECTION_CODE \
  --websocket-url ws://your-backend-url/ws/agent/YOUR_CONNECTION_CODE \
  --db-type sqlserver \
  --host localhost \
  --port 1433 \
  --database YourDatabase \
  --username YourUsername \
  --password YourPassword \
  --driver "ODBC Driver 17 for SQL Server"
```

Oder mit Connection String:

```bash
python local_db_agent.py \
  --connection-code YOUR_CONNECTION_CODE \
  --websocket-url ws://your-backend-url/ws/agent/YOUR_CONNECTION_CODE \
  --db-type sqlserver \
  --connection-string "DRIVER={ODBC Driver 17 for SQL Server};SERVER=localhost;DATABASE=YourDatabase;UID=YourUsername;PWD=YourPassword;"
```

#### MySQL

```bash
python local_db_agent.py \
  --connection-code YOUR_CONNECTION_CODE \
  --websocket-url ws://your-backend-url/ws/agent/YOUR_CONNECTION_CODE \
  --db-type mysql \
  --host localhost \
  --port 3306 \
  --database YourDatabase \
  --username YourUsername \
  --password YourPassword
```

#### PostgreSQL

```bash
python local_db_agent.py \
  --connection-code YOUR_CONNECTION_CODE \
  --websocket-url ws://your-backend-url/ws/agent/YOUR_CONNECTION_CODE \
  --db-type postgresql \
  --host localhost \
  --port 5432 \
  --database YourDatabase \
  --username YourUsername \
  --password YourPassword
```

### 3. Verbindung prüfen

Der Agent sendet automatisch Heartbeats an das Backend. In der Web-App sollte der Status "Connected" angezeigt werden.

## Backend-Endpoints

### WebSocket: `/ws/agent/{connection_code}`
- Agent verbindet sich hier
- Backend pusht Jobs
- Agent sendet Resultate zurück

### REST: `/api/local-agent/generate-code`
- Generiert neuen Connection Code
- Response: `{ "connection_code": "...", "websocket_url": "..." }`

### REST: `/api/local-agent/status/{connection_code}`
- Prüft Agent-Status
- Response: `{ "status": "connected", "last_heartbeat": "...", ... }`

### REST: `/api/local-agent/job`
- Erstellt neuen SQL-Job
- Body: `{ "connection_code": "...", "sql": "..." }`
- Response: `{ "job_id": "...", "status": "pending" }`

### REST: `/api/local-agent/job/{job_id}`
- Prüft Job-Status
- Response: `{ "status": "completed", "result": {...}, ... }`

## Sicherheit

- Connection Codes sind zufällig generiert (24 Zeichen)
- WebSocket-Verbindung verwendet TLS (wss://) in Production
- Agent läuft nur lokal, keine direkte DB-Exposition
- Backend authentifiziert alle Requests

## Troubleshooting

### Agent verbindet sich nicht
- Prüfe WebSocket-URL (ws:// für Dev, wss:// für Production)
- Prüfe Firewall-Einstellungen
- Prüfe Backend-Logs

### Datenbank-Verbindung schlägt fehl
- Prüfe DB-Credentials
- Prüfe ob DB läuft
- Prüfe Treiber-Installation

### Jobs werden nicht ausgeführt
- Prüfe Agent-Status im Backend
- Prüfe Backend-Logs für Fehler
- Prüfe ob Agent Heartbeats sendet

## Entwicklung

### Backend lokal testen

```bash
# Backend starten
uvicorn main:app --reload --host 0.0.0.0 --port 8000

# Agent mit lokalem Backend verbinden
python local_db_agent.py \
  --connection-code TEST_CODE \
  --websocket-url ws://localhost:8000/ws/agent/TEST_CODE \
  --db-type postgresql \
  --host localhost \
  --database testdb \
  --username postgres \
  --password postgres
```

## Nächste Schritte

- [ ] Binary-Builds für Windows/Mac/Linux
- [ ] Auto-Update-Mechanismus
- [ ] GUI für Agent-Konfiguration
- [ ] Multi-Database-Support (mehrere DBs pro Agent)
- [ ] Connection Pooling im Agent

