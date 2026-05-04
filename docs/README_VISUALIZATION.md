# Database Visualization API

## Overview
FastAPI endpoints for visualizing database dependencies at multiple levels: database, schema, table, and column.

## Starting the Server

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

## API Endpoints

### 1. Root Endpoint
```
GET /
```
Returns list of available endpoints.

### 2. Get Visualization Data (JSON)
```
GET /visualization/data?level={level}&filter_obj={object}&database={db_type}
```

**Parameters:**
- `level` (required): `database` | `schema` | `table` | `column`
- `filter_obj` (optional): Filter by specific object (e.g., table name)
- `database` (optional): `mysql` (default) | `sqlserver`

**Example Requests:**

```bash
# Get all table relationships
curl "http://localhost:8000/visualization/data?level=table"

# Get specific table with its relationships
curl "http://localhost:8000/visualization/data?level=table&filter_obj=employees"

# Get column-level view for a table
curl "http://localhost:8000/visualization/data?level=column&filter_obj=employees.employees"

# Get database schemas
curl "http://localhost:8000/visualization/data?level=database"
```

**Response Format:**
```json
{
  "level": "table",
  "filter": null,
  "database": "mysql",
  "nodes": [
    {
      "id": "employees.employees",
      "label": "employees",
      "type": "table",
      "schema": "employees",
      "title": "Table: employees.employees"
    }
  ],
  "edges": [
    {
      "id": "fk_constraint_name",
      "from": "employees.dept_emp",
      "to": "employees.employees",
      "label": "dept_emp_ibfk_1",
      "title": "emp_no → emp_no",
      "type": "foreign_key"
    }
  ],
  "stats": {
    "node_count": 8,
    "edge_count": 10,
    "table_count": 6,
    "view_count": 2,
    "column_count": 0
  }
}
```

### 3. Get Interactive HTML Visualization
```
GET /visualization/html?level={level}&filter_obj={object}&database={db_type}
```

Same parameters as `/visualization/data`.

Returns a complete HTML page with embedded interactive visualization using vis.js.

**Example:**
```bash
# Open in browser
http://localhost:8000/visualization/html?level=table

# Specific table visualization
http://localhost:8000/visualization/html?level=table&filter_obj=employees

# Column-level view
http://localhost:8000/visualization/html?level=column&filter_obj=employees.employees
```

### 4. Get All Tables
```
GET /tables?database={db_type}
```

Returns list of all tables in the database.

**Response:**
```json
{
  "tables": [
    {
      "schema": "employees",
      "name": "departments",
      "full_name": "employees.departments"
    }
  ],
  "count": 6
}
```

### 5. Get Table Columns
```
GET /columns/{table_name}?database={db_type}
```

Returns all columns for a specific table with data types.

**Example:**
```bash
curl "http://localhost:8000/columns/employees?database=mysql"
```

**Response:**
```json
{
  "table": "employees",
  "columns": [
    {
      "schema": "employees",
      "table": "employees",
      "column": "emp_no",
      "data_type": "int",
      "nullable": "NO",
      "default": null
    }
  ],
  "count": 6
}
```

## Visualization Levels

### 1. Database Level
Shows all schemas and their high-level structure.
- Use for: Database overview

### 2. Schema/Table Level (default)
Shows all tables, views, and their foreign key relationships.
- Use for: Understanding table relationships
- Node types: Tables (blue), Views (red)
- Edge types: Foreign keys (solid), View dependencies (dashed)

### 3. Table Level (filtered)
Shows a specific table and all tables it connects to via foreign keys.
- Use for: Understanding a specific table's context
- Requires: `filter_obj` parameter with table name

### 4. Column Level
Shows column-level dependencies with data types.
- Use for: Detailed schema analysis, finding specific columns
- Requires: `filter_obj` parameter with table name
- Node types: Columns (orange circles)
- Shows: Data types, nullable, foreign key relationships

## Frontend Integration

### Using JSON Data

```javascript
// Fetch visualization data
fetch('http://localhost:8000/visualization/data?level=table')
  .then(response => response.json())
  .then(data => {
    console.log('Nodes:', data.nodes);
    console.log('Edges:', data.edges);
    console.log('Stats:', data.stats);
    
    // Render with your preferred library (vis.js, cytoscape, d3.js, etc.)
    renderGraph(data.nodes, data.edges);
  });
```

### Using Embedded HTML

```html
<!-- Embed visualization in iframe -->
<iframe 
  src="http://localhost:8000/visualization/html?level=table" 
  width="100%" 
  height="800px"
  frameborder="0">
</iframe>
```

### React Example

```jsx
import React, { useEffect, useState } from 'react';

function DatabaseVisualization({ level = 'table', filter = null }) {
  const [data, setData] = useState(null);
  
  useEffect(() => {
    const url = `http://localhost:8000/visualization/data?level=${level}${filter ? '&filter_obj=' + filter : ''}`;
    
    fetch(url)
      .then(res => res.json())
      .then(setData);
  }, [level, filter]);
  
  if (!data) return <div>Loading...</div>;
  
  return (
    <div>
      <h2>Database Visualization - {level}</h2>
      <p>Tables: {data.stats.table_count}, Views: {data.stats.view_count}</p>
      {/* Render visualization here */}
    </div>
  );
}
```

## CORS Configuration

The API includes CORS middleware for frontend access. For production, update the `allow_origins` in `main.py`:

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://your-domain.com"],  # Update this
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

## Supported Databases

- MySQL/MariaDB
- SQL Server

## Color Scheme (HTML Visualization)

- 🔵 **Blue**: Tables
- 🔴 **Red**: Views
- 🟢 **Green**: Schemas
- 🟠 **Orange**: Columns

## Interactive Features (HTML)

- **Zoom**: Mouse wheel
- **Pan**: Click and drag background
- **Move nodes**: Click and drag nodes
- **Hover**: Tooltip with details
- **Stabilize**: Auto-arrange layout
- **Fit**: Zoom to fit all nodes

## Example Use Cases

1. **Database Documentation**: Generate HTML visualizations for documentation
2. **Impact Analysis**: See what tables/columns are affected by changes
3. **Schema Explorer**: Interactive exploration of database structure
4. **API Integration**: Provide data to frontend visualization components
5. **Data Lineage**: Track dependencies between views and tables

