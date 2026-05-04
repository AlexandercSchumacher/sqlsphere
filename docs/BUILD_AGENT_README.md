# Building the SQLSphere Agent

This guide explains how to build the standalone executable for the SQLSphere Local Database Agent.

## Prerequisites

- Python 3.8 or higher
- pip

## Build Steps

### 1. Install Dependencies

```bash
pip install pyinstaller
```

### 2. Build the Executable

```bash
python build_agent.py
```

This will create:
- **Windows**: `dist/SQLSphere-Agent.exe`
- **Mac/Linux**: `dist/SQLSphere-Agent`

### 3. Test the Executable

Run the executable to ensure it works:

**Windows:**
```bash
dist\SQLSphere-Agent.exe
```

**Mac/Linux:**
```bash
chmod +x dist/SQLSphere-Agent
./dist/SQLSphere-Agent
```

### 4. Distribute

Upload the executable to your CDN or file server, then update the download URLs in the frontend (`Connections.tsx`).

## Build Options

The build script uses PyInstaller with the following options:
- `--onefile`: Creates a single executable file (no installation needed)
- `--console`: Keeps console window (for logging/debugging)
- `--windowed`: Use this instead of `--console` for GUI-only (no console)

## GUI Mode

The agent includes a simple GUI built with tkinter (included with Python). Users can:
1. Enter their connection code
2. Configure database settings
3. Start/stop the agent with buttons
4. See status messages in real-time

## CLI Mode (Advanced)

Users can still use CLI mode by passing command-line arguments:
```bash
SQLSphere-Agent.exe --connection-code CODE --websocket-url URL --db-type postgresql ...
```

## Distribution

### Recommended Structure

```
downloads/
  ├── SQLSphere-Agent-Windows.exe
  ├── SQLSphere-Agent-Mac
  ├── SQLSphere-Agent-Linux
  └── README.txt (simple instructions)
```

### File Sizes

Expect file sizes around:
- Windows: ~15-25 MB
- Mac/Linux: ~15-25 MB

This includes all Python dependencies and database drivers.

## Troubleshooting

### "Failed to execute script"
- Ensure all dependencies are included in the build
- Check PyInstaller version compatibility
- Test on a clean system

### Database drivers not found
- Ensure ODBC drivers are installed on target system (for SQL Server)
- Include driver paths in PyInstaller if needed

### GUI not showing
- Ensure tkinter is available (usually included with Python)
- Check if `--windowed` flag is set correctly

