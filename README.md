# SQLSphere

> **AI-powered SQL IDE for non-technical users.** Talk to your database in plain English. Connects to cloud databases directly and to on-premises databases through a standalone desktop agent over WebSocket.

![Python](https://img.shields.io/badge/Python-3.11-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.110-009688?logo=fastapi&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-5-646CFF?logo=vite&logoColor=white)
![Tailwind](https://img.shields.io/badge/Tailwind-3-06B6D4?logo=tailwindcss&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-Auth%20%2B%20Storage-3ECF8E?logo=supabase&logoColor=white)
![Railway](https://img.shields.io/badge/Railway-Hosting-0B0D0E?logo=railway&logoColor=white)

---

## What it does

SQLSphere lets users who have never written SQL pull insights from their data:

- Ask questions in natural language. An LLM (Claude, GPT, or Gemini, selectable per-request) converts the question to SQL, executes it against the connected database, and returns results plus an explanation.
- Connect to **SQL Server, MySQL, or PostgreSQL** through a unified session-based API.
- Reach **on-premises databases** that have no public exposure: a downloadable desktop agent runs on the user's machine, opens an outbound WebSocket to the backend, and proxies queries through.
- Import CSV / Excel files into a target database with type-inferred schemas.
- Auto-generate dashboards: chart suggestions, schema relationship analysis, scheduled report delivery.

## Architecture

This repository ships in **self-hosted demo mode**: the frontend is
deployed publicly on Cloudflare Pages, but the backend runs on the
visitor's own machine via `docker compose up`. Browsers treat
`localhost` as a secure origin even from an HTTPS page, so a
sqlsphere.com tab can talk to a backend at `http://localhost:8000`
on the same machine.

```mermaid
flowchart LR
    Visitor((Recruiter / reviewer))
    CF[Cloudflare Pages<br/>sqlsphere.com<br/>static React bundle]
    Browser[Browser tab<br/>JS bundle running]
    Stack[docker compose stack<br/>on visitor's machine]
    BE[FastAPI backend<br/>localhost:8000<br/>LOCAL_MODE=true]
    PG[(Postgres 16<br/>localhost:5432<br/>sqlsphere + chinook)]

    Visitor -- 1. visits --> CF
    CF -- 2. serves bundle --> Browser
    Visitor -- A. starts --> Stack
    Stack --> BE
    Stack --> PG
    BE <--> PG
    Browser -- 3. fetch http://localhost:8000 --> BE
```

The original cloud version (private repo) talks to Supabase, Stripe,
Resend, and a local desktop agent over WebSocket. None of that is
present here: edge functions are gone, 19 cloud-only endpoints
return 503 in `LOCAL_MODE`, agent binary downloads are disabled,
and the frontend ships a thin Supabase shim that routes every
remaining `database-proxy` call to the local FastAPI backend.

```
┌────────────────────────────────────────────────────────────────────┐
│ Connection list :  Browser  -> /api/connections           -> Postgres │
│ Open session    :  Browser  -> /api/connections/{id}/connect -> Postgres │
│ Run SQL         :  Browser  -> /query (with session_id)   -> target DB │
│ AI chat         :  Browser  -> /chat   -> Claude / OpenAI -> SQL   │
│ Schema view     :  Browser  -> /tables / /columns         -> target DB │
└────────────────────────────────────────────────────────────────────┘
```

## Tech Stack

| Layer | Stack |
|---|---|
| **Backend** | FastAPI, Python 3.11, SQLAlchemy, pyodbc, mysql-connector-python, psycopg2-binary, Pydantic |
| **Frontend** | React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui, i18next |
| **Local Agent** | CustomTkinter (GUI), pystray (system tray), darkdetect, websockets, PyInstaller |
| **Infra** | Railway (backend), Supabase (auth, Postgres, storage, edge functions), GitHub Actions (cross-platform agent builds for Windows / macOS / Linux) |
| **AI** | Anthropic Claude, OpenAI GPT, Google Gemini, switchable per request |

## Repository Layout

```
sqlsphere/
├── main.py                      # FastAPI app, all HTTP and WebSocket routes
├── models.py                    # Pydantic request/response schemas
├── connection_manager.py        # DB session and connection lifecycle
├── feature_chat_json_based.py   # LLM SQL generation pipeline
├── feature_visualization.py     # Schema introspection, chart inference
├── feature_import.py            # CSV / Excel import pipeline
├── feature_scheduling.py        # Scheduled report jobs
├── local_agent_manager.py       # WebSocket job queue / dispatch
├── agent_gui.py                 # CustomTkinter GUI for the local agent
├── local_db_agent.py            # Agent core (WS client + SQL executor)
├── tray_icon.py                 # System tray icon
├── config_manager.py            # Config persistence + autostart on Win/macOS/Linux
├── SQLSphere-Agent.spec         # PyInstaller spec (Windows / Linux)
├── SQLSphere-Agent-Mac.spec     # PyInstaller spec (macOS)
├── build_agent.py               # Cross-platform build entry
├── tests/                       # pytest suite (incl. AWS IAM, connection matrix)
├── lovable/query-sage-lab/      # Frontend (React + TypeScript + Vite)
│   ├── src/
│   ├── supabase/functions/      # Deno edge functions (checkout, portal, proxies)
│   └── ...
├── docs/                        # Architecture and operational documentation
├── scripts/                     # Connection matrix setup, deploy helpers
└── .github/workflows/           # CI: cross-OS agent builds, release uploads
```

## Key Architectural Patterns

- **Session-based API.** The frontend opens a session after a successful connection test; every subsequent call carries `session_id`. State stays on the backend.
- **Feature modules.** Each `feature_*.py` is a self-contained slice that depends only on `connection_manager`. Easy to extract or replace.
- **Dual execution paths.** Cloud and on-prem queries share one API. The backend chooses the route based on session type.
- **WebSocket job queue.** The local agent uses submit (`POST /api/local-agent/job`) → poll (`GET /api/local-agent/job/{job_id}`). Survives flaky networks and lets the backend dispatch jobs while the agent is briefly disconnected.
- **LLM abstraction.** A single chat endpoint takes a `model` parameter; provider routing happens in `feature_chat_json_based.py`.

## Try the demo

The demo is split into two halves: a public, hosted frontend and a
backend you run locally. They are designed to be combined.

### One-liner

```bash
git clone https://github.com/AlexandercSchumacher/sqlsphere.git
cd sqlsphere
docker compose up
```

That starts three containers on your own machine:

| Service | Where | What |
|---|---|---|
| `sqlsphere-postgres` | `localhost:5432` | Postgres 16 with the SQLSphere schema (consolidated migrations) and a `chinook` placeholder DB. Two demo connections are seeded (`Demo: SQLSphere Internal` and `Demo: Chinook`). |
| `sqlsphere-backend` | `localhost:8000` | FastAPI in `LOCAL_MODE`. No Supabase, no Stripe, no auth. |
| `sqlsphere-frontend` | `localhost:8080` | nginx serving the React bundle plus reverse-proxying API calls to the backend. Same origin, no CORS, no Mixed Content, works in every browser. |

Then open one of these in your browser:

1. **Recommended:** **http://localhost:8080** — the self-contained
   docker-compose stack. Same origin for frontend and API, so it
   works in **every browser including Safari**.
2. **https://sqlsphere.com** — the Cloudflare Pages deployment of
   the same React app. Works in **Chrome, Firefox, and Edge** but
   **not Safari**: Safari blocks an HTTPS page from calling
   `http://localhost:8000` as Mixed Content. Chrome and Firefox
   special-case localhost as a secure origin and let it through;
   Safari does not.

### Step-by-step, what each step does

1. `git clone` brings you the source plus `docker-compose.yml`,
   the consolidated database schema, and the seed data.
2. `docker compose up` starts Postgres, applies the schema
   (15 SQLSphere tables plus a chinook DB), seeds two demo
   connections, then starts FastAPI which mounts the
   `LOCAL_MODE` REST endpoints.
3. Visiting **https://sqlsphere.com** loads the React bundle from
   Cloudflare. The bundle calls
   `GET http://localhost:8000/api/connections` -> sees your two
   seeded connections.
4. Click "Demo: SQLSphere Internal". The frontend calls
   `POST /api/connections/{id}/connect`, which reads the row
   from your local Postgres, decrypts the password, opens a
   pyodbc/psycopg2 session, and returns a `session_id`.
5. Type SQL in the editor. The frontend calls `POST /query` with
   the `session_id`, the backend executes against the chosen
   target database, and returns rows + schema.

### What you will see if you skip step 2

`https://sqlsphere.com` will still load (the static bundle is
public), but every list will be empty and you will see
`ERR_CONNECTION_REFUSED` in the browser console for the API
calls. That is expected: there is no backend hosted anywhere
publicly, by design. Run `docker compose up` and refresh.

### Run the frontend locally too (optional)

If you would rather not depend on the Cloudflare-hosted bundle:

```bash
cd lovable/query-sage-lab
cp .env.example .env
npm install && npm run dev    # http://localhost:5173
```

You then visit `http://localhost:5173` and the same flow works
end to end without ever touching the public site.

### What works in LOCAL_MODE

- Connections (CRUD against the local Postgres)
- Ad-hoc SQL queries via the demo connections
- Schema visualisation
- Query history
- AI chat (only with your own API key, see next section)

### Enable AI chat with your own API key

The AI chat feature needs an Anthropic or OpenAI API key. The key
is read from the backend's environment, so you supply it once when
you start docker compose. There is **no key shipped with this
repo and no shared demo key** — the project does not pay for
recruiter usage. Bring your own.

#### Option 1: inline (one-shot)

```bash
ANTHROPIC_API_KEY=sk-ant-api03-... docker compose up
# or
OPENAI_API_KEY=sk-proj-... docker compose up
```

#### Option 2: `.env` file (persists across restarts)

```bash
cat > .env <<'EOF'
ANTHROPIC_API_KEY=sk-ant-api03-...
# OPENAI_API_KEY=sk-proj-...
# ACTIVE_MODEL=claude   # or "chatgpt"
EOF
docker compose up
```

`.env` is `.gitignore`'d so your key never ends up in a commit.

Without a key the rest of the demo (connections, raw SQL, schema
view, visualisation, query history) keeps working; only the chat
endpoint returns `503 {"error": "AI features require ANTHROPIC_API_KEY
or OPENAI_API_KEY env var"}` and the chat tab shows that message
inline.

Where to get a key:
- Anthropic: https://console.anthropic.com/settings/keys
- OpenAI: https://platform.openai.com/api-keys

### What does NOT work in LOCAL_MODE

The demo intentionally hides cloud-only features. They are present
in the source for reference but disabled at the routing / API
layer: scheduled queries, data alerts, dashboards, public share
links, Stripe billing, contact form, agent binary downloads, and
multi-user auth.

### Bring your own data (optional Chinook)

```bash
curl -L https://raw.githubusercontent.com/lerocha/chinook-database/master/ChinookDatabase/DataSources/Chinook_PostgreSql.sql \
  -o docker/postgres-init/03-chinook-data.sql
docker compose down -v && docker compose up
```

The "Demo: Chinook" connection in the UI then becomes useful (artists,
albums, tracks, customers, invoices).

## Local Development

### Backend (without docker)

```bash
pip install -r requirements.txt

# create .env from .env.example, fill in values
cp .env.example .env
# set LOCAL_MODE=true and DATABASE_URL=postgresql://postgres:demo@localhost:5432/sqlsphere
# (start a Postgres yourself, or use docker compose up postgres)

uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend

```bash
cd lovable/query-sage-lab

cp .env.example .env  # fill VITE_* values

npm install
npm run dev           # http://localhost:5173
```

### Local Agent (from source)

```bash
pip install -r requirements.txt
python agent_gui.py
```

### Build agent executable

```bash
python build_agent.py
# → dist/SQLSphere-Agent (macOS / Linux)
# → dist/SQLSphere-Agent.exe (Windows)
```

### Run tests

```bash
pytest
```

## Architecture notes

- **LOCAL_MODE flag** in `db.py` keys a fixed demo user UUID and
  swaps the entire data layer from Supabase to a local Postgres
  reached via SQLAlchemy. 19 cloud-only endpoints in `main.py` are
  guarded with `_disable_in_local_mode` and return 503.
- **`feature_local_mode.py`** mounts the new REST endpoints
  (`/api/connections`, `/api/query-history`, `/api/user-settings`,
  `/api/auth/me`, `/api/health`, `/api/connections/{id}/connect`)
  that replace direct Supabase access from the frontend.
- **Frontend** in LOCAL_MODE uses `src/lib/api.ts` for new code, plus
  a thin shim at `src/integrations/supabase/client.ts` that proxies
  legacy `database-proxy` / `manage-connection` invocations onto
  the FastAPI endpoints, keeping older call sites compiling without
  a wholesale rewrite.
- **Frontend deployment**: GitHub Action `deploy-frontend.yml` builds
  with `VITE_BACKEND_URL=http://localhost:8000` and pushes the static
  bundle to Cloudflare Pages.

See `docs/DEPLOY_AGENT_FILES.md` and `docs/BUILD_AGENT_README.md` for
agent-specific guides.

## Status

This repository is a **public portfolio snapshot** of an actively developed product. The primary development happens in a private repository; this snapshot exists to make the architecture and code style reviewable for hiring conversations. Issues and pull requests here are not actively monitored.

## Copyright

(c) Alexander Schumacher. All rights reserved. The code in this repository is published for review purposes only and is not licensed for use, copying, modification, or distribution.
