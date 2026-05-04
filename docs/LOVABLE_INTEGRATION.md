# Lovable Website Integration (Simplified)

## Overview

Your Lovable website already has the database connection parameters. Just send them directly to the FastAPI backend - **no session management needed!**

## How It Works

```
User fills form on Lovable website
  ↓
Supabase Edge Function validates connection
  ↓
Frontend sends connection params to FastAPI (with EACH request)
  ↓
FastAPI connects and returns data
```

## Frontend Integration (TypeScript/React)

### 1. Get Connection Parameters from Your Form

You already have this in your Lovable website:

```typescript
const connectionParams = {
  type: 'postgresql',  // or 'mysql', 'sqlserver'
  host: 'caboose.proxy.rlwy.net',
  port: 35176,
  database: 'railway',
  username: 'postgres',
  password: 'your_password'
};
```

### 2. Call FastAPI Visualization Endpoint

```typescript
async function getVisualization(connectionParams, level = 'table', filterObj = null) {
  try {
    const url = new URL('http://your-api-url.com/visualization/data');
    url.searchParams.append('level', level);
    if (filterObj) {
      url.searchParams.append('filter_obj', filterObj);
    }
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(connectionParams)
    });
    
    if (!response.ok) {
      throw new Error(`API error: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data; // { nodes: [...], edges: [...], stats: {...} }
    
  } catch (error) {
    console.error('Visualization error:', error);
    throw error;
  }
}
```

### 3. Use in Your Component

```tsx
import React, { useState, useEffect } from 'react';

function DatabaseVisualization({ connectionParams }) {
  const [visualizationData, setVisualizationData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  
  const loadVisualization = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const data = await getVisualization(connectionParams, 'table');
      setVisualizationData(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
  
  useEffect(() => {
    if (connectionParams) {
      loadVisualization();
    }
  }, [connectionParams]);
  
  if (loading) return <div>Loading visualization...</div>;
  if (error) return <div>Error: {error}</div>;
  if (!visualizationData) return null;
  
  return (
    <div>
      <h2>Database Structure</h2>
      <p>Tables: {visualizationData.stats.table_count}, Views: {visualizationData.stats.view_count}</p>
      {/* Render nodes and edges with your preferred library */}
      <NetworkGraph nodes={visualizationData.nodes} edges={visualizationData.edges} />
    </div>
  );
}
```

## API Endpoints

All endpoints now accept connection parameters in the request body:

### POST /visualization/data

Get visualization data as JSON.

**Request:**
```bash
curl -X POST "http://localhost:8000/visualization/data?level=table" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "mysql",
    "host": "127.0.0.1",
    "port": 3306,
    "database": "employees",
    "username": "newuser",
    "password": "Abcdefg123&"
  }'
```

**Response:**
```json
{
  "level": "table",
  "nodes": [
    {
      "id": "employees.employees",
      "label": "employees",
      "type": "table",
      "schema": "employees"
    }
  ],
  "edges": [
    {
      "id": "fk_constraint",
      "from": "employees.dept_emp",
      "to": "employees.employees",
      "label": "dept_emp.emp_no ➜ employees.emp_no",
      "type": "foreign_key"
    }
  ],
  "stats": {
    "node_count": 8,
    "edge_count": 8,
    "table_count": 6,
    "view_count": 2
  }
}
```

### POST /visualization/html

Get complete interactive HTML visualization.

**Request:**
```javascript
// In your frontend
const response = await fetch('http://localhost:8000/visualization/html?level=table', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(connectionParams)
});

const html = await response.text();
// Display in iframe or new window
document.getElementById('viz-iframe').srcdoc = html;
```

### POST /tables

Get list of all tables.

**Request:**
```javascript
const response = await fetch('http://localhost:8000/tables', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(connectionParams)
});

const data = await response.json();
console.log(`Found ${data.count} tables:`, data.tables);
```

### POST /views

Get list of all views.

### POST /columns/{table_name}

Get columns for a specific table.

## Complete React Example

```tsx
import { useState } from 'react';

export default function DatabaseDashboard() {
  const [connectionParams, setConnectionParams] = useState(null);
  const [vizData, setVizData] = useState(null);
  
  // Called after your existing Supabase validation
  const handleConnectionValidated = async (params) => {
    setConnectionParams(params);
    
    // Immediately load visualization
    const response = await fetch('http://localhost:8000/visualization/data?level=table', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });
    
    const data = await response.json();
    setVizData(data);
  };
  
  if (!vizData) {
    return <ConnectionForm onConnect={handleConnectionValidated} />;
  }
  
  return (
    <div>
      <h1>Database: {connectionParams.database}</h1>
      <NetworkVisualization data={vizData} />
    </div>
  );
}
```

## Embedded HTML Visualization

```tsx
function HTMLVisualization({ connectionParams }) {
  const [htmlContent, setHtmlContent] = useState('');
  
  useEffect(() => {
    async function load() {
      const response = await fetch('http://localhost:8000/visualization/html?level=table', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(connectionParams)
      });
      
      const html = await response.text();
      setHtmlContent(html);
    }
    
    if (connectionParams) {
      load();
    }
  }, [connectionParams]);
  
  return (
    <iframe
      srcDoc={htmlContent}
      width="100%"
      height="800px"
      style={{ border: 'none', borderRadius: '8px' }}
    />
  );
}
```

## From Your Supabase Edge Function

After validating the connection, you can optionally call the FastAPI backend:

```typescript
// In your Supabase edge function
if (success) {
  // Connection validated - optionally pre-fetch visualization
  try {
    const vizResponse = await fetch('http://YOUR_FASTAPI_URL/visualization/data?level=table', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });
    
    const vizData = await vizResponse.json();
    
    return new Response(JSON.stringify({
      success: true,
      message: 'Connection successful',
      visualization: vizData  // Include pre-fetched data
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    // If visualization fails, still return success from connection test
  }
}
```

## Security Note

**Important:** Since you're sending credentials with each request:
- ✅ Use HTTPS in production
- ✅ Never log passwords
- ✅ Use environment variables for sensitive defaults
- ✅ Implement rate limiting
- ✅ Consider encrypting credentials in transit

## Summary

✅ **No session management needed** - your frontend already has the parameters  
✅ **Send connection params with each request** in the POST body  
✅ **Simpler architecture** - stateless API  
✅ **Works with your existing Lovable flow**  

Just POST the same parameters you're already collecting to the FastAPI endpoints!


