# Agent Files Deployment Guide

## Option 1: Supabase Storage (Empfohlen)

### Schritt 1: Supabase Storage Bucket erstellen

1. Gehe zu deinem Supabase Dashboard
2. Navigiere zu **Storage** → **Buckets**
3. Klicke auf **New Bucket**
4. Name: `agent-downloads`
5. Settings:
   - **Public bucket**: ✅ Aktiviert (damit Downloads funktionieren)
   - **File size limit**: 50 MB (oder mehr, je nach Agent-Größe)
6. Klicke auf **Create bucket**

### Schritt 2: Agent Files hochladen

1. Baue die Agent-Executables:
   ```bash
   python build_agent.py
   ```

2. Gehe zu **Storage** → **agent-downloads** → **Upload file**
3. Lade hoch:
   - `SQLSphere-Agent-Windows.exe` (aus `dist/`)
   - `SQLSphere-Agent-Mac` (aus `dist/`)
   - `SQLSphere-Agent-Linux` (aus `dist/`)

### Schritt 3: Public URLs erhalten

Nach dem Upload:
1. Klicke auf eine Datei
2. Kopiere die **Public URL** (sieht aus wie: `https://[project].supabase.co/storage/v1/object/public/agent-downloads/SQLSphere-Agent-Windows.exe`)

### Schritt 4: URLs in Frontend eintragen

Die URLs werden in `Connections.tsx` verwendet.

---

## Option 2: Public Folder (Lovable)

### Schritt 1: Downloads-Ordner erstellen

```bash
mkdir -p lovable/query-sage-lab/public/downloads
```

### Schritt 2: Agent Files kopieren

```bash
cp dist/SQLSphere-Agent.exe lovable/query-sage-lab/public/downloads/SQLSphere-Agent-Windows.exe
cp dist/SQLSphere-Agent lovable/query-sage-lab/public/downloads/SQLSphere-Agent-Mac
cp dist/SQLSphere-Agent lovable/query-sage-lab/public/downloads/SQLSphere-Agent-Linux
```

### Schritt 3: Git commit & push

Die Files werden beim Lovable-Build automatisch deployed.

**Nachteil**: Große Files können das Git-Repo aufblähen.

---

## Option 3: Cloudflare R2 / AWS S3 (Für später)

Wenn du später mehr Kontrolle brauchst:
- **Cloudflare R2**: Kostenlos bis 10 GB, keine egress fees
- **AWS S3**: Pay-as-you-go, sehr zuverlässig

---

## Domain Setup bei Lovable

### Schritt 1: Domain bei Lovable verbinden

1. Gehe zu deinem Lovable Projekt
2. Navigiere zu **Settings** → **Domains**
3. Klicke auf **Add Custom Domain**
4. Gib deine Custom-Domain ein (z.B. `your-domain.example.com`)

### Schritt 2: DNS bei GoDaddy konfigurieren

Lovable gibt dir DNS-Einträge. In GoDaddy:

1. Gehe zu **DNS Management**
2. Füge einen **CNAME** Record hinzu:
   - **Type**: CNAME
   - **Name**: @ (oder www)
   - **Value**: Die CNAME-URL von Lovable (z.B. `your-project.lovable.app`)

3. Oder **A Record** (wenn Lovable eine IP gibt):
   - **Type**: A
   - **Name**: @
   - **Value**: IP-Adresse von Lovable

### Schritt 3: SSL-Zertifikat

Lovable erstellt automatisch ein SSL-Zertifikat (kann 5-10 Minuten dauern).

---

## Download-URLs im Code anpassen

Nachdem du die Files hochgeladen hast, passe die URLs in `Connections.tsx` an:

**Für Supabase Storage:**
```typescript
const agentUrl = `https://[dein-project].supabase.co/storage/v1/object/public/agent-downloads/SQLSphere-Agent-Windows.exe`;
```

**Für Public Folder:**
```typescript
const agentUrl = `${window.location.origin}/downloads/SQLSphere-Agent-Windows.exe`;
```

---

## Empfehlung

**Jetzt (schnell):** Supabase Storage
- ✅ Bereits eingerichtet
- ✅ Kostenlos
- ✅ Keine Git-Änderungen nötig
- ✅ Schnelle Downloads

**Später (optional):** Eigener CDN
- Für bessere Performance
- Für Analytics
- Für Versionierung

