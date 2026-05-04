#!/bin/sh
set -e

# Default PORT to 8000 if not set
PORT=${PORT:-8000}

echo "Starting uvicorn on port $PORT"

# Start uvicorn with the PORT variable
exec uvicorn main:app --host 0.0.0.0 --port "$PORT"

