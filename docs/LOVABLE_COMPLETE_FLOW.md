# Complete Lovable → FastAPI Integration

## Overview

Your Lovable website provides **2 features**, and your FastAPI backend supports both:

1. **AI Chat** - Session-based (persistent connection for multiple questions)
2. **Visualization** - Stateless (one-time request)

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    LOVABLE FRONTEND                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ Connection   │  │  AI Chat     │  │  Visualization   │  │
│  │ Form         │  │  Interface   │  │  Dashboard       │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
└─────────────────────────────────────────────────────────────┘
         │                    │                    │
         │                    │                    │
         ▼                    ▼                    ▼
┌─────────────────────────────────────────────────────────────┐
│               SUPABASE EDGE FUNCTION                        │
│         (Validates DB connection first)                      │
└─────────────────────────────────────────────────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
┌─────────────────────────────────────────────────────────────┐
│                  FASTAPI BACKEND                            │
│  POST /connect     POST /chat     POST /visualization/data  │
│  (create session)  (use session)  (stateless)              │
└─────────────────────────────────────────────────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
    [Session Store]    [User's Database]    [User's Database]
```

---

## Feature 1: AI Chat (Session-Based)

### **Step 1: User Connects Database**

User fills form in Lovable:
```typescript
const connectionParams = {
  name: 'My Database',
  type: 'postgresql',  // or 'mysql', 'sqlserver'
  host: 'caboose.proxy.rlwy.net',
  port: 35176,
  database: 'railway',
  username: 'postgres',
  password: 'password123'
};
```

### **Step 2: Validate with Supabase Edge Function**

Call your existing Supabase function:
```typescript
const supabaseResponse = await fetch('YOUR_SUPABASE_FUNCTION_URL/test-connection', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(connectionParams)
});

const supabaseResult = await supabaseResponse.json();

if (!supabaseResult.success) {
  // Show error to user
  alert('Connection failed: ' + supabaseResult.error);
  return;
}
```

### **Step 3: Create Session in FastAPI**

After Supabase validates, create session:
```typescript
const fastAPIResponse = await fetch('http://your-backend.com/connect', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(connectionParams)
});

const fastAPIResult = await fastAPIResponse.json();

if (fastAPIResult.success) {
  const sessionId = fastAPIResult.session_id;
  
  // Store session_id for chat
  localStorage.setItem('db_session_id', sessionId);
  localStorage.setItem('db_name', fastAPIResult.database_name);
  localStorage.setItem('db_type', fastAPIResult.database_type);
  
  // Navigate to chat interface
  router.push('/chat');
}
```

### **Step 4: Send Chat Messages**

When user asks a question:
```typescript
const [conversationHistory, setConversationHistory] = useState([]);

async function sendChatMessage(userQuery) {
  const sessionId = localStorage.getItem('db_session_id');
  
  const response = await fetch('http://your-backend.com/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: sessionId,
      query: userQuery,
      conversation_history: conversationHistory
    })
  });
  
  const result = await response.json();
  
  if (result.success) {
    // Update conversation history
    setConversationHistory([
      ...conversationHistory,
      { role: 'user', content: userQuery },
      { role: 'assistant', content: result.explanation }
    ]);
    
    // Display results to user
    return {
      sql: result.sql,
      results: result.results,
      columns: result.columns,
      executionTime: result.execution_time_ms,
      explanation: result.explanation
    };
  } else {
    throw new Error(result.error);
  }
}
```

### **Complete Chat Component Example:**

```tsx
import { useState, useEffect } from 'react';

export function AIChat() {
  const [sessionId, setSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  
  useEffect(() => {
    const storedSessionId = localStorage.getItem('db_session_id');
    if (!storedSessionId) {
      router.push('/connect'); // Redirect to connection page
      return;
    }
    setSessionId(storedSessionId);
  }, []);
  
  const sendMessage = async () => {
    if (!input.trim() || !sessionId) return;
    
    setLoading(true);
    const userMessage = input;
    setInput('');
    
    // Add user message to chat
    setMessages(prev => [...prev, {
      type: 'user',
      content: userMessage
    }]);
    
    try {
      const response = await fetch('http://your-backend.com/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          query: userMessage,
          conversation_history: messages.map(m => ({
            role: m.type === 'user' ? 'user' : 'assistant',
            content: m.content
          }))
        })
      });
      
      const result = await response.json();
      
      if (result.success) {
        // Add AI response
        setMessages(prev => [...prev, {
          type: 'assistant',
          content: result.explanation,
          sql: result.sql,
          results: result.results,
          columns: result.columns,
          executionTime: result.execution_time_ms
        }]);
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      setMessages(prev => [...prev, {
        type: 'error',
        content: 'Error: ' + error.message
      }]);
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <div className="chat-container">
      <div className="messages">
        {messages.map((msg, i) => (
          <div key={i} className={`message ${msg.type}`}>
            {msg.type === 'assistant' && (
              <>
                <p>{msg.content}</p>
                {msg.results && (
                  <table>
                    <thead>
                      <tr>{msg.columns.map(col => <th key={col}>{col}</th>)}</tr>
                    </thead>
                    <tbody>
                      {msg.results.map((row, i) => (
                        <tr key={i}>
                          {msg.columns.map(col => <td key={col}>{row[col]}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <small>Executed in {msg.executionTime}ms</small>
              </>
            )}
            {msg.type === 'user' && <p>{msg.content}</p>}
            {msg.type === 'error' && <p className="error">{msg.content}</p>}
          </div>
        ))}
      </div>
      
      <div className="input-area">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyPress={e => e.key === 'Enter' && sendMessage()}
          placeholder="Ask a question about your database..."
          disabled={loading}
        />
        <button onClick={sendMessage} disabled={loading || !input.trim()}>
          {loading ? 'Thinking...' : 'Send'}
        </button>
      </div>
    </div>
  );
}
```

---

## Feature 2: Visualization (Stateless)

### **Option A: Send Connection Params Directly**

When user clicks "Visualize", send connection parameters:

```typescript
async function loadVisualization(connectionParams) {
  const response = await fetch('http://your-backend.com/visualization/data?level=table', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(connectionParams)
  });
  
  const vizData = await response.json();
  
  // Render with your visualization library
  renderGraph(vizData.nodes, vizData.edges);
}
```

### **Option B: Use Session ID (if already created for chat)**

```typescript
// If user already has a session from chat feature
const sessionId = localStorage.getItem('db_session_id');

// Just send connection params (same as Option A)
// OR you could modify backend to accept session_id for viz too
```

### **Get HTML Visualization (Recommended for Quick Start):**

```tsx
function DatabaseVisualization({ connectionParams }) {
  const [htmlContent, setHtmlContent] = useState('');
  
  useEffect(() => {
    async function load() {
      const response = await fetch('http://your-backend.com/visualization/html?level=table', {
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
      title="Database Visualization"
    />
  );
}
```

---

## Complete Flow Example

```tsx
import { useState } from 'react';

export default function DatabaseApp() {
  const [step, setStep] = useState('connect'); // 'connect' | 'chat' | 'visualize'
  const [sessionId, setSessionId] = useState(null);
  const [connectionParams, setConnectionParams] = useState(null);
  
  // Step 1: Connect to database
  const handleConnect = async (params) => {
    try {
      // 1. Validate with Supabase
      const supabaseResp = await fetch('YOUR_SUPABASE_URL/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
      });
      
      const supabaseResult = await supabaseResp.json();
      if (!supabaseResult.success) {
        throw new Error(supabaseResult.error);
      }
      
      // 2. Create session in FastAPI
      const fastAPIResp = await fetch('http://your-backend.com/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
      });
      
      const fastAPIResult = await fastAPIResp.json();
      if (!fastAPIResult.success) {
        throw new Error(fastAPIResult.error);
      }
      
      // 3. Save session and connection params
      setSessionId(fastAPIResult.session_id);
      setConnectionParams(params);
      localStorage.setItem('db_session_id', fastAPIResult.session_id);
      
      // 4. Go to chat/dashboard
      setStep('chat');
      
    } catch (error) {
      alert('Connection failed: ' + error.message);
    }
  };
  
  if (step === 'connect') {
    return <ConnectionForm onConnect={handleConnect} />;
  }
  
  if (step === 'chat') {
    return <AIChat sessionId={sessionId} />;
  }
  
  if (step === 'visualize') {
    return <DatabaseVisualization connectionParams={connectionParams} />;
  }
}
```

---

## What Your Lovable Frontend Needs:

### **1. Connection Page:**
- ✅ You already have this (form with DB parameters)
- ✅ You already validate with Supabase edge function
- ➕ Add call to FastAPI `/connect` after validation
- ➕ Store returned `session_id`

### **2. Chat Page:**
- ➕ Component that sends messages to `/chat` endpoint
- ➕ Includes `session_id` from Step 1
- ➕ Maintains `conversation_history` array
- ➕ Displays: user query, SQL, results table, explanation, execution time

### **3. Visualization Page:**
- ➕ Component that calls `/visualization/html` or `/visualization/data`
- ➕ Sends `connectionParams` in POST body
- ➕ Displays interactive graph (iframe or custom renderer)

---

## API Request Examples

### 1. Connect Database (creates session)

```bash
POST http://your-backend.com/connect

Body:
{
  "type": "postgresql",
  "host": "caboose.proxy.rlwy.net",
  "port": 35176,
  "database": "railway",
  "username": "postgres",
  "password": "password123"
}

Response:
{
  "success": true,
  "session_id": "abc-def-123",
  "database_type": "postgresql",
  "database_name": "railway"
}
```

### 2. Chat Query (uses session)

```bash
POST http://your-backend.com/chat

Body:
{
  "session_id": "abc-def-123",
  "query": "who is the highest paid employee?",
  "conversation_history": []
}

Response:
{
  "success": true,
  "sql": "SELECT first_name, last_name, salary FROM employees ORDER BY salary DESC LIMIT 1;",
  "results": [
    {"first_name": "Tokuyasu", "last_name": "Pesch", "salary": 158220}
  ],
  "columns": ["first_name", "last_name", "salary"],
  "execution_time_ms": 12.34,
  "row_count": 1,
  "explanation": "The highest paid employee is Tokuyasu Pesch with a salary of 158,220."
}
```

### 3. Get Visualization (stateless)

```bash
POST http://your-backend.com/visualization/data?level=table

Body:
{
  "type": "postgresql",
  "host": "caboose.proxy.rlwy.net",
  "port": 35176,
  "database": "railway",
  "username": "postgres",
  "password": "password123"
}

Response:
{
  "nodes": [...],
  "edges": [...],
  "stats": {
    "node_count": 8,
    "table_count": 6,
    "view_count": 2
  }
}
```

---

## Summary: What You Need from Lovable Frontend

### **Connection Flow:**
1. ✅ Existing: Form to collect DB parameters
2. ✅ Existing: Supabase edge function validates connection
3. ➕ **NEW**: Call FastAPI `/connect` endpoint
4. ➕ **NEW**: Store `session_id` in localStorage/state

### **Chat Feature:**
1. ➕ **NEW**: Chat UI component
2. ➕ **NEW**: Function to call `/chat` endpoint with `session_id`
3. ➕ **NEW**: Display: query results, SQL code, explanation
4. ➕ **NEW**: Maintain conversation history array

### **Visualization Feature:**
1. ➕ **NEW**: Visualization component
2. ➕ **NEW**: Call `/visualization/html` or `/visualization/data`
3. ➕ **NEW**: Display in iframe or custom graph renderer

---

## TypeScript Types for Lovable

```typescript
// types.ts
export interface DatabaseConnection {
  name?: string;
  type: 'mysql' | 'postgresql' | 'sqlserver' | 'oracle';
  connectionMethod?: 'standard' | 'ssh' | 'socket';
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  sshHost?: string;
  sshPort?: number;
  sshUsername?: string;
  sshPassword?: string;
  socketPath?: string;
  defaultSchema?: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  session_id: string;
  query: string;
  conversation_history: ChatMessage[];
}

export interface ChatResponse {
  success: boolean;
  sql?: string;
  results?: any[];
  columns?: string[];
  execution_time_ms?: number;
  row_count?: number;
  explanation?: string;
  error?: string;
}

export interface VisualizationData {
  level: string;
  nodes: Array<{
    id: string;
    label: string;
    type: 'table' | 'view' | 'schema' | 'column';
  }>;
  edges: Array<{
    id: string;
    from: string;
    to: string;
    label: string;
    type: 'foreign_key' | 'view_dependency';
  }>;
  stats: {
    node_count: number;
    edge_count: number;
    table_count: number;
    view_count: number;
  };
}
```

---

## That's Everything You Need!

The backend is ready. Your Lovable frontend just needs to:
1. Call `/connect` after Supabase validates (get `session_id`)
2. Call `/chat` for each user question (use `session_id`)
3. Call `/visualization/html` or `/visualization/data` to show graphs

Sessions last **2 hours**, then user needs to reconnect.


