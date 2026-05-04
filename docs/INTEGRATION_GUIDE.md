# Integration Guide: Lovable Frontend → FastAPI Backend

## Overview

This guide shows how to connect your Lovable website to the FastAPI backend using dynamic database credentials.

## Architecture Flow

```
User (Lovable Website)
  ↓ 1. Enter DB credentials
Supabase Edge Function (test-connection)
  ↓ 2. Validate connection
FastAPI Backend (/connect)
  ↓ 3. Test & create session
  ↓ 4. Return session_id
Frontend stores session_id
  ↓ 5. Use session_id for all queries
FastAPI endpoints (uses user's DB)
```

## Step-by-Step Integration

### Step 1: User Enters Credentials (Frontend)

```typescript
// In your Lovable component
const [connectionParams, setConnectionParams] = useState({
  name: '',
  type: 'mysql', // or 'postgresql', 'sqlserver'
  connectionMethod: 'standard',
  host: '127.0.0.1',
  port: 3306,
  database: 'employees',
  username: 'newuser',
  password: 'Abcdefg123&'
});
```

### Step 2: Call Your Supabase Edge Function

```typescript
// Your existing Supabase edge function call
const response = await fetch('YOUR_SUPABASE_FUNCTION_URL/test-connection', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(connectionParams)
});

const result = await response.json();

if (result.success) {
  console.log('✅ Connection validated by Supabase');
  // Now forward to FastAPI backend
  connectToBackend(connectionParams);
}
```

### Step 3: Forward to FastAPI Backend

```typescript
async function connectToBackend(params: DatabaseConnection) {
  try {
    const response = await fetch('http://localhost:8000/connect', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: params.type,
        connectionMethod: params.connectionMethod,
        host: params.host,
        port: params.port,
        database: params.database,
        username: params.username,
        password: params.password
      })
    });
    
    const data = await response.json();
    
    if (data.success) {
      // Store session_id for future requests
      localStorage.setItem('db_session_id', data.session_id);
      console.log('✅ Session created:', data.session_id);
      
      return {
        success: true,
        sessionId: data.session_id,
        databaseType: data.database_type,
        databaseName: data.database_name
      };
    } else {
      throw new Error(data.error || 'Connection failed');
    }
  } catch (error) {
    console.error('Backend connection error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}
```

### Step 4: Use Session ID in Queries

```typescript
// Get stored session ID
const sessionId = localStorage.getItem('db_session_id');

// Example: Get visualization data
async function getVisualization(level = 'table', filterObj = null) {
  const url = new URL('http://localhost:8000/visualization/data');
  url.searchParams.append('session_id', sessionId);
  url.searchParams.append('level', level);
  if (filterObj) {
    url.searchParams.append('filter_obj', filterObj);
  }
  
  const response = await fetch(url);
  const data = await response.json();
  
  return data; // { nodes: [...], edges: [...], stats: {...} }
}

// Example: Get all tables
async function getTables() {
  const response = await fetch(
    `http://localhost:8000/tables?session_id=${sessionId}`
  );
  return await response.json();
}

// Example: Get table columns
async function getColumns(tableName) {
  const response = await fetch(
    `http://localhost:8000/columns/${tableName}?session_id=${sessionId}`
  );
  return await response.json();
}
```

### Step 5: Display Visualization in Frontend

```tsx
import React, { useEffect, useState } from 'react';

function DatabaseVisualizer() {
  const [sessionId, setSessionId] = useState(null);
  const [visualizationUrl, setVisualizationUrl] = useState('');
  
  useEffect(() => {
    const storedSessionId = localStorage.getItem('db_session_id');
    if (storedSessionId) {
      setSessionId(storedSessionId);
      // Build visualization URL with session_id
      setVisualizationUrl(
        `http://localhost:8000/visualization/html?session_id=${storedSessionId}&level=table`
      );
    }
  }, []);
  
  if (!sessionId) {
    return <div>Please connect to a database first</div>;
  }
  
  return (
    <iframe
      src={visualizationUrl}
      width="100%"
      height="800px"
      style={{ border: 'none', borderRadius: '8px' }}
    />
  );
}
```

## Modified Supabase Edge Function

Update your edge function to forward to FastAPI after validation:

```typescript
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const params = await req.json();
    
    // Validate parameters...
    
    let success = false;
    let errorMessage = '';
    
    // Test connection (your existing code)
    switch(params.type.toLowerCase()) {
      case 'mysql':
        // Test MySQL connection...
        success = true;
        break;
      // ... other cases
    }
    
    if (success) {
      // Connection validated - now forward to FastAPI backend
      try {
        const backendResponse = await fetch('http://YOUR_FASTAPI_SERVER/connect', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(params)
        });
        
        const backendData = await backendResponse.json();
        
        if (backendData.success) {
          return new Response(JSON.stringify({
            success: true,
            message: 'Connection successful',
            session_id: backendData.session_id,
            database_type: backendData.database_type,
            database_name: backendData.database_name
          }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
      } catch (backendError) {
        console.error('Backend connection error:', backendError);
        // Continue with success from edge function validation
      }
    }
    
    return new Response(JSON.stringify({
      success,
      error: errorMessage || undefined,
      message: success ? 'Connection successful' : errorMessage
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
```

## API Endpoints Reference

### POST /connect
Test connection and create session.

**Request:**
```json
{
  "type": "mysql",
  "host": "127.0.0.1",
  "port": 3306,
  "database": "employees",
  "username": "newuser",
  "password": "Abcdefg123&"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Connection successful",
  "session_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "database_type": "mysql",
  "database_name": "employees"
}
```

### GET /session/{session_id}
Check session status.

**Response:**
```json
{
  "session_id": "a1b2c3d4...",
  "database_type": "mysql",
  "database_name": "employees",
  "username": "newuser",
  "created_at": "2025-11-06T10:30:00",
  "expires_at": "2025-11-06T12:30:00"
}
```

### GET /visualization/data
Get visualization data as JSON.

**Request:**
```
GET /visualization/data?session_id={session_id}&level=table&filter_obj=employees
```

### GET /visualization/html
Get interactive HTML visualization.

**Request:**
```
GET /visualization/html?session_id={session_id}&level=table
```

## Complete Frontend Example

```typescript
import { useState, useEffect } from 'react';

export default function DatabaseDashboard() {
  const [sessionId, setSessionId] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState(null);
  
  const handleConnect = async (credentials) => {
    try {
      // 1. Validate with Supabase edge function
      const supabaseResponse = await fetch('YOUR_SUPABASE_EDGE_FUNCTION', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials)
      });
      
      const supabaseResult = await supabaseResponse.json();
      
      if (!supabaseResult.success) {
        throw new Error(supabaseResult.error);
      }
      
      // 2. Connect to FastAPI backend
      const backendResponse = await fetch('http://localhost:8000/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials)
      });
      
      const backendResult = await backendResponse.json();
      
      if (backendResult.success) {
        setSessionId(backendResult.session_id);
        setIsConnected(true);
        localStorage.setItem('db_session_id', backendResult.session_id);
      } else {
        throw new Error(backendResult.error);
      }
      
    } catch (err) {
      setError(err.message);
      setIsConnected(false);
    }
  };
  
  if (!isConnected) {
    return <ConnectionForm onConnect={handleConnect} error={error} />;
  }
  
  return (
    <div>
      <h1>Database Visualization</h1>
      <iframe
        src={`http://localhost:8000/visualization/html?session_id=${sessionId}&level=table`}
        width="100%"
        height="800px"
        style={{ border: 'none' }}
      />
    </div>
  );
}
```

## Security Considerations

### For Production:

1. **Use HTTPS** for API communication
2. **Encrypt connection parameters** in transit and at rest
3. **Use Redis or Supabase** for session storage instead of in-memory
4. **Implement rate limiting** to prevent abuse
5. **Add authentication** (JWT tokens, API keys)
6. **Set CORS properly**:
   ```python
   app.add_middleware(
       CORSMiddleware,
       allow_origins=["https://your-domain.lovable.app"],
       allow_credentials=True,
       allow_methods=["*"],
       allow_headers=["*"],
   )
   ```

### Redis Session Storage (Recommended for Production):

```python
import redis
import json

redis_client = redis.Redis(host='localhost', port=6379, db=0)

def create_session(conn_params: DatabaseConnection) -> str:
    session_id = str(uuid.uuid4())
    
    # Store in Redis with TTL
    redis_client.setex(
        f"session:{session_id}",
        7200,  # 2 hours
        json.dumps(conn_params.dict())
    )
    
    return session_id

def get_connection(session_id: str):
    data = redis_client.get(f"session:{session_id}")
    if not data:
        raise ValueError("Invalid or expired session")
    
    conn_params = DatabaseConnection(**json.loads(data))
    # Build connection...
```

## Testing the Integration

```bash
# 1. Start FastAPI backend
uvicorn main:app --reload --host 0.0.0.0 --port 8000

# 2. Test connection endpoint
curl -X POST http://localhost:8000/connect \
  -H "Content-Type: application/json" \
  -d '{
    "type": "mysql",
    "host": "127.0.0.1",
    "port": 3306,
    "database": "employees",
    "username": "newuser",
    "password": "Abcdefg123&"
  }'

# Response: { "success": true, "session_id": "abc-123-...", ... }

# 3. Use session_id for visualization
curl "http://localhost:8000/visualization/data?session_id=abc-123-...&level=table"

# 4. Get visualization HTML
open "http://localhost:8000/visualization/html?session_id=abc-123-...&level=table"
```

## Environment Variables (Optional)

```bash
# .env file
FASTAPI_HOST=0.0.0.0
FASTAPI_PORT=8000
SESSION_EXPIRY_HOURS=2
REDIS_URL=redis://localhost:6379
ALLOWED_ORIGINS=https://your-app.lovable.app
```

## Summary

✅ User enters credentials on Lovable website  
✅ Supabase edge function validates connection  
✅ Forward credentials to FastAPI `/connect` endpoint  
✅ FastAPI tests connection and returns `session_id`  
✅ Frontend stores `session_id`  
✅ All subsequent API calls include `session_id` parameter  
✅ Backend uses user's specific database for each request  

**Sessions expire after 2 hours** to ensure security.


