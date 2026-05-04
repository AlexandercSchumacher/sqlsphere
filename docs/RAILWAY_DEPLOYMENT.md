# Railway Deployment Guide

## Prerequisites

✅ Railway account  
✅ GitHub account  
✅ Git installed locally  

## Deployment Steps

### 1. Prepare Git Repository

```bash
cd /path/to/sqlsphere

# Initialize git
git init

# Add .gitignore
echo "__pycache__/
*.pyc
.env
*.log
.DS_Store
venv/
.venv/" > .gitignore

# Add all files
git add .

# Commit
git commit -m "Initial commit: FastAPI backend for DB visualization and AI chat"
```

### 2. Push to GitHub

```bash
# Create a new repository on GitHub (https://github.com/new)
# Then:

git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
git branch -M main
git push -u origin main
```

### 3. Deploy on Railway

1. **Go to** [railway.app](https://railway.app)
2. **Click** "New Project"
3. **Select** "Deploy from GitHub repo"
4. **Choose** your repository
5. **Railway auto-detects** Python and starts building

### 4. Configure Environment Variables

In Railway dashboard → Variables tab:

```
OPENAI_API_KEY=sk-proj-your-key-here
GEMINI_API_KEY=AIzaSyYour-key-here
ACTIVE_MODEL=gemini
SESSION_EXPIRY_HOURS=2
ALLOWED_ORIGINS=https://your-app.lovable.app
```

### 5. Get Your Backend URL

After deployment:
- Railway provides a URL like: `https://your-app.up.railway.app`
- Find it in: Dashboard → Settings → Domains
- Optional: Add custom domain

### 6. Update Lovable Frontend

In your Lovable frontend, use the Railway URL:

```typescript
const API_URL = 'https://your-app.up.railway.app';

// Connect
const response = await fetch(`${API_URL}/connect`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(connectionParams)
});
```

### 7. Update CORS

Add your Lovable domain to Railway variables:

```
ALLOWED_ORIGINS=https://your-app.lovable.app,https://preview-xyz.lovable.app
```

---

## Important Railway Notes

### **ODBC Drivers on Railway**

Railway uses Linux, which requires different ODBC drivers than macOS:

**MySQL:** MariaDB Connector/ODBC is included in `nixpacks.toml`  
**PostgreSQL:** Built-in PostgreSQL driver  
**SQL Server:** Requires additional setup (Microsoft ODBC Driver)

The code already auto-detects the correct driver path!

### **Scaling**

Railway automatically scales based on:
- **Memory**: Starts with 512MB, scales up as needed
- **CPU**: Shared CPU, can upgrade to dedicated
- **Replicas**: Add more instances if needed

### **Costs**

- **Hobby Plan**: $5/month + usage
- **Pro Plan**: $20/month + usage
- Free trial: $5 credit

### **Monitoring**

Railway Dashboard shows:
- Deployment logs
- Request metrics
- Memory/CPU usage
- Errors and crashes

---

## Testing Your Deployment

### 1. Test Health Endpoint

```bash
curl https://your-app.up.railway.app/
```

Should return API info.

### 2. Test Connection

```bash
curl -X POST https://your-app.up.railway.app/connect \
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

### 3. Test from Lovable

Update your Lovable frontend to use the Railway URL and test the full flow.

---

## Troubleshooting

### **If deployment fails:**

Check Railway logs:
- Dashboard → Deployments → Click latest → View Logs

Common issues:
- Missing dependencies in `requirements.txt`
- ODBC driver not found (check `nixpacks.toml`)
- Port binding (Railway sets `$PORT` automatically)

### **If connections fail:**

- Ensure user's database is **publicly accessible**
- Check firewall rules
- Verify connection parameters
- Railway can't connect to `localhost` databases

---

## Alternative: Railway PostgreSQL for Sessions

For production, use Railway's PostgreSQL for session storage:

1. In Railway, add **PostgreSQL** service
2. Link to your app
3. Use the `DATABASE_URL` for session storage
4. Update `connection_manager.py` to use PostgreSQL

---

## Quick Start Commands

```bash
# 1. Commit your code
git add . && git commit -m "Ready for Railway"

# 2. Push to GitHub
git push origin main

# 3. Deploy on Railway (via web UI)
# railway.app → New Project → Deploy from GitHub

# 4. Get your URL
# https://your-app.up.railway.app

# 5. Test
curl https://your-app.up.railway.app/
```

That's it! Your FastAPI backend will be live and scalable! 🚀

**Your Railway URL will be:** `https://[project-name].up.railway.app`

Use this URL in your Lovable frontend to connect everything together!
