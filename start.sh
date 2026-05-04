#!/bin/bash
set -e

echo "===== ODBC Library Detection Debug ====="
echo "Searching for ODBC libraries..."

# Try multiple patterns
echo "Searching for libodbc.so*:"
find /nix/store -name "libodbc.so*" 2>/dev/null | head -10 || echo "No libodbc.so* found"

echo ""
echo "Searching for unixODBC directories:"
find /nix/store -type d -name "*unixODBC*" 2>/dev/null | head -5 || echo "No unixODBC dirs found"

echo ""
echo "Searching for any lib directories in unixODBC:"
find /nix/store -path "*unixODBC*/lib" -type d 2>/dev/null | head -5 || echo "No lib dirs found"

# Build library path from all found lib directories
LIB_PATHS=""

# Add unixODBC lib paths
for libdir in $(find /nix/store -path "*unixODBC*/lib" -type d 2>/dev/null); do
  LIB_PATHS="$LIB_PATHS:$libdir"
done

# Add PostgreSQL lib paths
for libdir in $(find /nix/store -path "*postgresql*/lib" -type d 2>/dev/null | head -1); do
  LIB_PATHS="$LIB_PATHS:$libdir"
done

# Clean up and export
LIB_PATHS=$(echo "$LIB_PATHS" | sed 's/^://')
if [ -n "$LIB_PATHS" ]; then
  export LD_LIBRARY_PATH="$LIB_PATHS:$LD_LIBRARY_PATH"
fi

echo ""
echo "Final LD_LIBRARY_PATH=$LD_LIBRARY_PATH"
echo "===== Starting uvicorn ====="

# Start uvicorn
exec /opt/venv/bin/uvicorn main:app --host 0.0.0.0 --port $PORT

