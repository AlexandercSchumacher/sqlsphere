# Komplette Erklärung der Visualisierungslogik

## Übersicht

Die Visualisierungsfunktion erstellt interaktive Graph-Visualisierungen von Datenbankstrukturen und deren Beziehungen. Sie zeigt Tabellen, Views, Prozeduren, Trigger, Sequenzen und Materialized Views als Knoten (Nodes) und deren Abhängigkeiten als Kanten (Edges) in einem Netzwerk-Graphen.

---

## Architektur und Datenfluss

### 1. Frontend (`Visualization.tsx`)

**Zweck**: React-Komponente für die Benutzeroberfläche

**Hauptfunktionen**:
- **Connection Management**: Lädt Datenbankverbindungen aus Supabase, priorisiert Default-Verbindung
- **Schema/Table/Column Selection**: Dropdowns für hierarchische Auswahl (Schema → Tabelle → Spalte)
- **Filter-Optionen**:
  - `showAllColumns`: Zeigt alle Spalten oder nur verbundene
  - `showOnlyConnectedTables`: Zeigt nur Tabellen mit Beziehungen
  - `objectTypes`: Checkboxen für verschiedene Objekttypen (Tables, Views, Procedures, etc.)
- **Visualization Generation**: Ruft Backend-Endpoint auf und rendert HTML in iframe

**API-Aufruf**:
```typescript
supabase.functions.invoke('database-proxy', {
  body: {
    endpoint: `/visualization/html?level=${level}&filter_obj=${filterObj}&...`,
    connectionId: selectedConnection,
  }
})
```

**Rendering**:
- HTML wird in einem `<iframe>` mit `srcDoc` gerendert
- Zoom-Controls für Zoom-In/Out
- CSS-Injection um Header/Controls zu verstecken
- Disable von Browser-Zoom (Ctrl+Scroll)

---

### 2. Backend API (`main.py`)

**Endpoint**: `POST /visualization/html`

**Parameter**:
- `level`: `'database'`, `'schema'`, `'table'`, oder `'column'`
- `filter_obj`: Optional - Schema-Name oder `schema.table` Format
- `column`: Optional - Spaltenname für Column-Level
- `show_all_columns`: Boolean
- `show_only_connected_tables`: Boolean
- `object_types`: Komma-separierte Liste

**Datenabfrage** (in `feature_visualization.py`):
1. **Foreign Keys**: `get_table_relationships()` - FK-Beziehungen zwischen Tabellen
2. **Views**: `get_all_views()` + `get_view_dependencies()` - Views und ihre Abhängigkeiten
3. **Columns**: `get_column_info()` - Spalteninformationen (Name, Datentyp, Nullable, PK/FK)
4. **Procedures/Functions**: `get_all_procedures()` + `get_procedure_table_dependencies()` - Prozeduren und welche Tabellen sie lesen/schreiben
5. **Triggers**: `get_all_triggers()` - Trigger und ihre zugehörigen Tabellen
6. **Sequences**: `get_all_sequences()` - Sequenzen
7. **Materialized Views**: `get_all_materialized_views()` - Materialized Views
8. **Column Dependencies**: `get_column_dependencies()` - Für Column-Level: Upstream/Downstream Abhängigkeiten

**Datenbank-spezifische Queries**:
- **PostgreSQL**: Nutzt `information_schema` Views
- **MySQL**: Nutzt `INFORMATION_SCHEMA` Tabellen
- **SQL Server**: Nutzt `sys.*` System Views

---

### 3. HTML-Generierung (`feature_visualization.py`)

**Funktion**: `generate_visualization_html()`

#### Schritt 1: Node-Erstellung

**Für Schema/Table-Level**:
- **Tabellen-Nodes**: 
  - Label enthält Tabellenname + Spaltenliste (als HTML-Tabelle)
  - Spalten werden sortiert: PKs zuerst, dann FKs, dann andere
  - Icons: 🔑 für PK, 🔗 für FK
  - Nur verbundene Spalten werden angezeigt (außer `show_all_columns=True`)
  - HTML-Format: `<table>` mit `<tr>` für jede Spalte
- **View-Nodes**: Pink (#FB7E81)
- **Procedure/Function-Nodes**: Lila (#9B59B6)
- **Trigger-Nodes**: Orange (#E67E22)
- **Sequence-Nodes**: Gelb (#FFA807)
- **Materialized View-Nodes**: Grün (#7BE141)

**Für Column-Level**:
- Jede Spalte wird als eigener Node dargestellt
- Label: `<b>Tabellenname</b>\nSpaltenname`

#### Schritt 2: Edge-Erstellung

**Foreign Key Edges**:
- Von `source_table` zu `target_table`
- Gestrichelt (dashed)
- Label: `table.column → table.column`
- Speichert `sourceColumn` und `targetColumn` für präzise Positionierung

**View Dependencies**:
- Von View zu Tabelle (rot, #FB7E81)
- Label: "reads from"

**Procedure Dependencies**:
- **Reads**: Von Tabelle zu Prozedur (lila, #9B59B6)
- **Writes**: Von Prozedur zu Tabelle (rot, #E74C3C)
- Bei beidem: Zwei gekrümmte Edges (curvedCW/curvedCCW)

**Trigger Edges**:
- Von Trigger zu Tabelle (orange, #E67E22)

#### Schritt 3: HTML-Template

**Libraries** (via CDN):
1. **D3.js v7** (`https://d3js.org/d3.v7.min.js`):
   - Für SVG-Rendering, Force Simulation, Drag & Drop
   - Hauptbibliothek für Graph-Visualisierung

2. **Dagre** (`https://unpkg.com/dagre@0.8.5/dist/dagre.min.js`):
   - Für hierarchisches Layout (Left-to-Right)
   - Berechnet optimale Positionen für verbundene Nodes
   - Verhindert Überlappungen

**HTML-Struktur**:
```html
<!DOCTYPE html>
<html>
<head>
  <!-- D3.js & Dagre Scripts -->
  <style>
    /* CSS für Nodes, Links, Legend, etc. */
  </style>
</head>
<body>
  <div id="header">...</div>
  <div id="controls">...</div>
  <div id="legend">...</div>
  <div id="mynetwork">
    <!-- SVG wird hier von D3.js erstellt -->
  </div>
  <script>
    // D3.js Code für Rendering
  </script>
</body>
</html>
```

---

### 4. D3.js Rendering-Logik

#### Layout-Algorithmus

**1. Dagre Layout (für verbundene Nodes)**:
```javascript
var g = new dagre.graphlib.Graph();
g.setGraph({
  rankdir: 'LR',  // Left-to-Right
  nodesep: 40,    // Horizontal spacing
  ranksep: 80,    // Vertical spacing
});
dagre.layout(g);
```

**2. Grid Layout (für isolierte Nodes)**:
- Isolierte Nodes (ohne Verbindungen) werden in einem Grid links platziert
- Verbundene Nodes werden rechts davon positioniert

**3. D3 Force Simulation**:
- Wird hauptsächlich für Drag & Drop verwendet
- Keine aktiven Forces (alpha=0), da Dagre die Positionen vorgibt

#### SVG-Elemente

**1. Background Grid**:
- SVG-Pattern für Hintergrund-Grid
- Statisch (skaliert nicht mit Zoom)

**2. Links (Edges)**:
- SVG `<line>` Elemente
- Pfeil-Marker am Ende (`marker-end="url(#arrowhead)"`)
- Gestrichelt wenn `dashes: true`
- Farben basierend auf Edge-Typ

**3. Link Labels**:
- SVG `<text>` Elemente
- Positioniert in der Mitte zwischen Source und Target
- Zeigt Beziehungsname (z.B. "reads from")

**4. Nodes**:
- SVG `<g>` (Group) Elemente
- Enthalten:
  - **Foreign Object** (`<foreignObject>`) für HTML-Labels
  - **Rectangle** für Border/Background
  - **Text** für einfache Labels

**5. Column-Level Precision**:
- Links werden präzise an der richtigen Spalte positioniert
- `getColumnYOffsetEarly()` berechnet Y-Offset basierend auf Spaltenposition im HTML-Table
- `sourceColumn`/`targetColumn` werden verwendet um die exakte Zeile zu finden

#### Interaktivität

**Drag & Drop**:
```javascript
d3.drag()
  .on('start', dragstarted)
  .on('drag', dragged)
  .on('end', dragended)
```

**Zoom & Pan**:
- D3 Zoom Behavior (wird im Frontend via iframe-Container gehandhabt)
- Auto-Fit nach Layout-Berechnung

**Hover-Effekte**:
- CSS `:hover` für Nodes
- Tooltips via `title` Attribute

---

## Datenstrukturen

### Node-Format
```javascript
{
  id: "schema.table",           // Eindeutige ID
  label: "<table>...</table>",   // HTML-Label
  group: "table",                // Typ (table/view/procedure/etc.)
  title: "Tooltip text",        // Hover-Tooltip
  x: 100,                       // X-Position (von Dagre)
  y: 200,                       // Y-Position (von Dagre)
  fx: 100,                      // Fixed X (für Drag)
  fy: 200                       // Fixed Y (für Drag)
}
```

### Edge-Format
```javascript
{
  from: "schema.source_table",
  to: "schema.target_table",
  label: "reads from",
  title: "Detailed description",
  color: { color: "#9B59B6" },
  dashes: [5, 5],
  arrows: "to",
  sourceColumn: "column_name",  // Für präzise Positionierung
  targetColumn: "column_name"
}
```

---

## Filter-Logik

### Level-basierte Filterung

**Schema-Level**:
- Zeigt alle Tabellen/Views/etc. in einem Schema
- `filter_obj = "schema_name"`

**Table-Level**:
- Zeigt eine spezifische Tabelle + alle verbundenen Tabellen
- `filter_obj = "schema.table"`

**Column-Level**:
- Zeigt eine Spalte + alle verbundenen Spalten (via FK)
- `filter_obj = "schema.table"`, `column = "column_name"`

### Objekttyp-Filterung

- `object_types`: Komma-separierte Liste
- Mögliche Werte: `tables`, `views`, `procedures`, `functions`, `triggers`, `sequences`, `materialized_views`
- Nur aktivierte Typen werden als Nodes angezeigt

### Connection-Filterung

- `show_only_connected_tables`: Zeigt nur Tabellen die in Beziehungen vorkommen
- `show_all_columns`: Zeigt alle Spalten oder nur verbundene (PK/FK)

---

## Performance-Optimierungen

1. **Lazy Loading**: Spalten werden nur für Tabellen geladen, die in Beziehungen vorkommen
2. **Isolated Nodes**: Isolierte Nodes werden separat behandelt (Grid-Layout)
3. **Fixed Positions**: Nach Dagre-Layout werden Positionen fixiert (`fx`, `fy`)
4. **Column Position Caching**: Spaltenpositionen werden gecacht für schnelle Link-Positionierung

---

## Farben und Styling

### Node-Farben
- **Tables**: Weiß (#FFFFFF) mit blauem Border (#2B7CE9)
- **Views**: Pink (#FB7E81)
- **Procedures/Functions**: Lila (#9B59B6)
- **Triggers**: Orange (#E67E22)
- **Sequences**: Gelb (#FFA807)
- **Materialized Views**: Grün (#7BE141)

### Edge-Farben
- **Foreign Keys**: Blau (#2B7CE9), gestrichelt
- **View Dependencies**: Rot (#FB7E81), gestrichelt
- **Procedure Reads**: Lila (#9B59B6), gestrichelt
- **Procedure Writes**: Rot (#E74C3C), gestrichelt
- **Trigger**: Orange (#E67E22), gestrichelt

---

## Zusammenfassung

**Datenfluss**:
1. Frontend wählt Connection/Schema/Table/Column
2. Frontend ruft Supabase Edge Function `database-proxy` auf
3. Edge Function leitet Request an FastAPI Backend weiter
4. Backend sammelt Metadaten aus Datenbank (FKs, Views, Columns, etc.)
5. Backend generiert HTML mit D3.js + Dagre Code
6. HTML wird an Frontend zurückgegeben
7. Frontend rendert HTML in iframe
8. D3.js erstellt SVG-Graph mit interaktiven Nodes und Edges

**Technologie-Stack**:
- **Frontend**: React + TypeScript + Supabase Client
- **Backend**: Python + FastAPI + SQLAlchemy/pyodbc
- **Visualization**: D3.js v7 + Dagre.js
- **Database**: PostgreSQL / MySQL / SQL Server

**Hauptfeatures**:
- Interaktive Graph-Visualisierung
- Drag & Drop für Nodes
- Zoom & Pan
- Präzise Column-Level Link-Positionierung
- Hierarchisches Layout (Dagre)
- Filterung nach Schema/Table/Column
- Unterstützung für verschiedene Objekttypen

