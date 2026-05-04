# Desktop IDE - Architektur & Implementierungsplan

## Übersicht

Desktop-IDE mit allen Features der Web-App + direkter Zugriff auf lokale Datenbanken (ohne Agent).

## Technologie-Stack

### Option 1: Electron (Empfohlen)
- **Frontend**: Bestehendes React-Frontend (1:1 wiederverwendbar)
- **Backend**: Node.js mit `electron` + lokale DB-Treiber
- **Vorteile**: 
  - Sehr etabliert, große Community
  - Einfache Integration bestehender React-App
  - Viele fertige Packages für DB-Treiber
- **Nachteile**: 
  - Größere Bundle-Größe (~100-150MB)
  - Höherer RAM-Verbrauch

### Option 2: Tauri
- **Frontend**: Bestehendes React-Frontend
- **Backend**: Rust + Node.js (via Tauri Commands)
- **Vorteile**: 
  - Sehr kleine Bundle-Größe (~10-20MB)
  - Niedriger RAM-Verbrauch
  - Bessere Performance
- **Nachteile**: 
  - Rust-Kenntnisse nötig für Backend
  - Weniger etabliert als Electron

**Empfehlung: Electron** (einfacherer Start, bewährte Technologie)

## Architektur

```
┌─────────────────────────────────────────────────────────┐
│                    Desktop IDE                          │
│                                                         │
│  ┌──────────────────────────────────────────────────┐  │
│  │  React Frontend (bestehendes lovable/query-...)  │  │
│  │  - Chat Interface                                 │  │
│  │  - Schema Browser                                 │  │
│  │  - Visualization                                  │  │
│  │  - Connections Management                         │  │
│  └──────────────────────────────────────────────────┘  │
│                          │                              │
│                          ▼                              │
│  ┌──────────────────────────────────────────────────┐  │
│  │  API Router (Electron Main Process)              │  │
│  │  - Route: /local/* → Lokales Backend             │  │
│  │  - Route: /cloud/* → Cloud Backend (FastAPI)     │  │
│  └──────────────────────────────────────────────────┘  │
│         │                          │                   │
│         ▼                          ▼                   │
│  ┌──────────────┐         ┌──────────────────────┐   │
│  │ Lokales      │         │ Cloud Backend        │   │
│  │ Backend      │         │ (FastAPI/Railway)    │   │
│  │              │         │                      │   │
│  │ - DB Treiber │         │ - LLM Integration    │   │
│  │   (MySQL,    │         │ - Session Management│   │
│  │    Postgres, │         │ - User Auth          │   │
│  │    SQL       │         │ - Subscription      │   │
│  │    Server)   │         │                      │   │
│  │              │         │                      │   │
│  │ - SQL Exec   │         │                      │   │
│  │ - Schema     │         │                      │   │
│  │   Queries    │         │                      │   │
│  └──────────────┘         └──────────────────────┘   │
│         │                                              │
│         ▼                                              │
│  ┌──────────────┐                                      │
│  │ Lokale DBs   │                                      │
│  │ (localhost)  │                                      │
│  └──────────────┘                                      │
└─────────────────────────────────────────────────────────┘
```

## Projektstruktur

```
desktop-ide/
├── package.json                 # Electron + React Setup
├── electron/
│   ├── main.js                  # Electron Main Process
│   ├── preload.js               # Preload Script (Bridge)
│   └── local-backend/           # Lokales Backend
│       ├── server.js             # Express/HTTP Server für lokale DBs
│       ├── db-connectors/        # DB-Treiber Wrapper
│       │   ├── mysql.js
│       │   ├── postgres.js
│       │   └── sqlserver.js
│       └── routes/
│           ├── connect.js        # DB-Verbindung testen
│           ├── query.js          # SQL ausführen
│           ├── schema.js         # Schema abfragen
│           └── tables.js         # Tabellen/Views/...
├── src/                         # React Frontend (Symlink oder Copy)
│   └── [bestehendes Frontend]
├── build/                       # Build Output
└── dist/                        # Distribution (Installer)
```

## Implementierungsschritte

### Phase 1: Electron Setup
1. Electron-Projekt initialisieren
2. Bestehendes React-Frontend integrieren
3. Basic Window + Menu erstellen
4. Dev-Mode testen

### Phase 2: Lokales Backend
1. Express-Server im Electron Main Process
2. DB-Treiber installieren (mysql2, pg, mssql)
3. Connection Manager für lokale DBs
4. API-Endpoints: /connect, /query, /schema, /tables

### Phase 3: Hybrid API Layer
1. API-Router im Frontend
2. Routing-Logik: Lokale DBs → Lokales Backend, Cloud DBs → Cloud Backend
3. LLM-Calls weiterhin über Cloud Backend
4. Session-Management für beide Backends

### Phase 4: Features Integration
1. Chat-Interface mit LLM (Cloud)
2. Schema Browser (lokal + cloud)
3. Visualization (lokal + cloud)
4. Connections Management (lokal + cloud)

### Phase 5: Build & Distribution
1. Electron Builder konfigurieren
2. Installer für Windows/Mac/Linux
3. Auto-Updater (optional)
4. Code Signing (optional, für Production)

## API-Design

### Lokales Backend (Express in Electron)

```javascript
// electron/local-backend/server.js
const express = require('express');
const { mysqlConnector, postgresConnector, sqlServerConnector } = require('./db-connectors');

const app = express();
app.use(express.json());

// Connection Test
app.post('/local/connect', async (req, res) => {
  const { type, host, port, database, username, password } = req.body;
  // Test connection, return session_id
});

// Execute Query
app.post('/local/query', async (req, res) => {
  const { session_id, sql } = req.body;
  // Execute SQL, return results
});

// Get Schema
app.get('/local/schema', async (req, res) => {
  const { session_id } = req.query;
  // Return tables, views, procedures, etc.
});
```

### Frontend API Router

```typescript
// src/utils/apiRouter.ts
const API_BASE = process.env.ELECTRON ? 'http://localhost:3001' : 'https://api.example.com';

export async function executeQuery(connection: Connection, sql: string) {
  if (connection.connectionMethod === 'local') {
    // Use local backend
    return fetch(`${API_BASE}/local/query`, { ... });
  } else {
    // Use cloud backend (via Supabase Edge Function)
    return supabase.functions.invoke('database-proxy', { ... });
  }
}
```

## Vorteile dieser Architektur

1. **Wiederverwendung**: 95% des Frontend-Codes bleibt gleich
2. **Einfache DB-Verbindungen**: Kein Agent/WebSocket nötig
3. **Hybrid**: Lokale DBs lokal, Cloud-Features (LLM) weiterhin über Cloud
4. **Offline-Fähig**: Lokale DBs funktionieren ohne Internet
5. **Bessere Performance**: Direkte DB-Verbindungen sind schneller

## Herausforderungen

1. **Zwei Codebases**: Web-App + Desktop-App müssen synchron gehalten werden
2. **Deployment**: Installer für 3 Plattformen erstellen
3. **Updates**: Auto-Update-Mechanismus implementieren
4. **Testing**: Beide Varianten testen

## Nächste Schritte

1. Electron-Projekt erstellen
2. Frontend integrieren
3. Lokales Backend implementieren
4. API-Router im Frontend
5. Build-System einrichten

