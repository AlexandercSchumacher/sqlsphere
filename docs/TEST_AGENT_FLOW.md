# Agent Flow Test Checklist

## Was sollte funktionieren:

### 1. GUI öffnet sich ✅
- Executable starten → GUI öffnet sich

### 2. Daten eingeben
- Connection Code (aus Web-App generiert)
- Database Type (PostgreSQL/MySQL/SQL Server)
- Host, Port, Database, Username, Password

### 3. Agent startet
- Klick auf "Start Agent"
- Agent verbindet sich zu:
  - ✅ Lokaler Datenbank (mit eingegebenen Credentials)
  - ✅ Backend WebSocket (mit Connection Code)

### 4. Backend erkennt Agent
- Backend empfängt WebSocket-Verbindung
- Agent sendet `agent_info` mit DB-Typ
- Backend registriert Agent als "connected"

### 5. SQL-Queries ausführen
- In Web-App: SQL-Query eingeben
- Backend erstellt Job für Agent
- Backend sendet Job über WebSocket
- Agent führt SQL lokal aus
- Agent sendet Resultate zurück
- Web-App zeigt Resultate an

## Mögliche Probleme:

### Problem 1: WebSocket-Verbindung schlägt fehl
**Symptom:** "Failed to connect to backend" in GUI
**Lösung:** 
- Prüfe Backend-URL (sollte `wss://your-backend.example.com` sein)
- Prüfe ob Backend läuft
- Prüfe Firewall/Netzwerk

### Problem 2: Lokale DB-Verbindung schlägt fehl
**Symptom:** "Failed to connect to database" in GUI
**Lösung:**
- Prüfe DB-Credentials
- Prüfe ob DB läuft
- Prüfe ob Port korrekt ist

### Problem 3: Backend erkennt Agent nicht
**Symptom:** Agent läuft, aber Web-App zeigt "Agent not connected"
**Lösung:**
- Prüfe Backend-Logs
- Prüfe ob Connection Code übereinstimmt
- Prüfe WebSocket-Endpoint im Backend

## Test-Schritte:

1. **Backend starten** (Railway sollte laufen)
2. **Connection Code generieren** (in Web-App)
3. **Agent starten** (GUI öffnen)
4. **Daten eingeben** (Connection Code + DB-Daten)
5. **"Start Agent" klicken**
6. **Status prüfen:**
   - GUI sollte "Connected to backend" zeigen
   - Backend-Logs sollten Agent-Verbindung zeigen
7. **Test-Query senden** (in Web-App)
8. **Resultate prüfen**

## Debugging:

### GUI-Logs
Die GUI zeigt alle wichtigen Events im Status-Fenster:
- "Starting agent..."
- "Connecting to: wss://..."
- "Connected to backend"
- "Job executed: ..."

### Backend-Logs
Prüfe Railway-Logs für:
- "Agent connected via WebSocket: [code]"
- "Job created: [job_id]"
- "Job completed: [job_id]"

### Agent-Logs
In der GUI im Status-Fenster sichtbar.

