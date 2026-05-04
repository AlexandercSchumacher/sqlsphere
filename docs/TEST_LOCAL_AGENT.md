# Lokaler Agent - Test-Anleitung

## Schritt 1: Agent bauen (falls noch nicht geschehen)

```bash
python build_agent.py
```

**Output**: `dist/SQLSphere-Agent` (oder `dist/SQLSphere-Agent.exe` auf Windows)

## Schritt 2: Backend-URL konfigurieren

Der Agent muss wissen, wo sich dein Backend befindet:

### Option A: Environment Variable
```bash
export BACKEND_URL=https://your-backend.example.com
```

### Option B: In der Agent-GUI
- Öffne den Agent
- Trage die Backend-URL in das Feld ein

**Wichtig**: 
- Für lokales Testing: `http://localhost:8000` (wenn Backend lokal läuft)
- Für Production: `https://deine-backend-url.com`

## Schritt 3: Agent starten

### Mit GUI:
```bash
python agent_gui.py
# oder
./dist/SQLSphere-Agent
```

### Ohne GUI (für Testing):
```bash
python local_db_agent.py --connection-code DEIN_CODE --db-type mysql --host localhost --port 3306 --database test --username root --password dein_passwort
```

## Schritt 4: Connection Code generieren

1. **In der Web-App**: Gehe zu "Connections" → "Add Connection"
2. **Connection Method**: Wähle "Local Database (Agent)"
3. **Klicke**: "Generate Code"
4. **Kopiere**: Den generierten Connection Code (z.B. `abc123xyz`)

## Schritt 5: Agent mit Code verbinden

### In der Agent-GUI:
1. **Connection Code**: Trage den generierten Code ein
2. **Database Type**: Wähle MySQL/PostgreSQL/SQL Server
3. **Host**: `localhost` (oder deine DB-IP)
4. **Port**: `3306` (MySQL) / `5432` (PostgreSQL) / `1433` (SQL Server)
5. **Database**: Name deiner Datenbank
6. **Username**: DB-Username
7. **Password**: DB-Password
8. **Klicke**: "Start Agent"

### Erwartete Ausgabe:
```
✅ Connected to local mysql database
✅ Successfully connected to backend: wss://...
✅ Agent info sent successfully
✅ Pending jobs requested. Agent is now ready and waiting for jobs...
```

## Schritt 6: Verbindung in Web-App testen

1. **In der Web-App**: Gehe zu "Connections"
2. **Connection Code**: Sollte bereits eingetragen sein
3. **Klicke**: "Check Agent & Auto-Fill" (falls verfügbar)
4. **Oder**: Fülle DB-Details manuell ein
5. **Klicke**: "Test Connection"

**Erwartung**: ✅ "Connection successful"

## Schritt 7: Im Chat verwenden

1. **Gehe zu**: "AI Chat"
2. **Wähle**: Die lokale Agent-Verbindung aus dem Dropdown
3. **Stelle eine Frage**: z.B. "Show me all tables"
4. **Erwartung**: Die KI sollte auf deine lokale DB zugreifen können

## Troubleshooting

### Agent verbindet sich nicht zum Backend

**Problem**: `WebSocket connection error: SSLCertVerificationError`

**Lösung**: 
- Prüfe `BACKEND_URL` ist korrekt
- Für `wss://` (HTTPS): SSL-Verification wird automatisch deaktiviert in PyInstaller-Builds
- Für `ws://` (HTTP): Sollte ohne Probleme funktionieren

### "Connection code is required"

**Problem**: Connection Code fehlt in der Web-App

**Lösung**:
- Stelle sicher, dass du "Generate Code" geklickt hast
- Prüfe, dass `connectionCode` in der Datenbank gespeichert ist

### Agent zeigt "Unknown message type: info_ack"

**Status**: ⚠️ Warnung, aber nicht kritisch - kann ignoriert werden

### Agent verbindet sich, aber Queries funktionieren nicht

**Prüfe**:
1. Agent-Logs: Siehst du "Job received" und "Job completed"?
2. Backend-Logs: Kommen WebSocket-Nachrichten an?
3. DB-Verbindung: Funktioniert die lokale DB-Verbindung?

### Test mit Python-Script

```bash
python test_local_agent.py
```

**Parameter**:
- `--connection-code`: Dein Connection Code
- `--sql`: SQL Query zum Testen (z.B. `SELECT 1`)

## Vollständiger Test-Workflow

```bash
# 1. Backend starten (falls lokal)
# uvicorn main:app --reload

# 2. Agent bauen
python build_agent.py

# 3. Agent starten (GUI)
./dist/SQLSphere-Agent

# 4. In Web-App:
# - Connection Code generieren
# - Code in Agent eingeben
# - DB-Details eingeben
# - "Start Agent" klicken

# 5. In Web-App:
# - Connection testen
# - Im Chat verwenden
```

## Erwartete Logs

### Agent-Logs:
```
2025-12-XX XX:XX:XX - INFO - Connected to local mysql database
2025-12-XX XX:XX:XX - INFO - Attempting to connect to backend: wss://...
2025-12-XX XX:XX:XX - INFO - ✅ Successfully connected to backend
2025-12-XX XX:XX:XX - INFO - Agent info sent successfully
2025-12-XX XX:XX:XX - INFO - ✅ Pending jobs requested. Agent is now ready...
```

### Backend-Logs:
```
INFO:local_agent_manager:Agent registered: abc123xyz
INFO:main:Agent connected via WebSocket: abc123xyz
INFO:local_agent_manager:Job created: xyz789 for agent abc123xyz
INFO:local_agent_manager:Job completed: xyz789 (status: completed)
```

## Nächste Schritte

Nach erfolgreichem Test:
- ✅ Agent funktioniert
- ✅ Web-App kann lokale DBs nutzen
- ✅ KI kann auf lokale Daten zugreifen

**Tipp**: Speichere den Connection Code, damit du ihn später wieder verwenden kannst!

