#!/bin/bash

cd "$(dirname "$0")"
cd ..

# Get port from config
PORT=$(node -e "console.log(require('./config').server.port)")

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

echo "========================================"
echo "   LPF File Server - Stop"
echo "========================================"
echo ""

# Find process using port
PID=$(netstat -tlnp 2>/dev/null | grep ":$PORT" | grep LISTENING | awk '{print $7}' | cut -d'/' -f1)

if [ -z "$PID" ]; then
    PID=$(ss -tlnp 2>/dev/null | grep ":$PORT" | awk '{print $6}' | cut -d'=' -f2 | cut -d',' -f1)
fi

if [ -z "$PID" ]; then
    echo -e "${RED}[ERROR] LPF service is not running${NC}"
    exit 1
fi

# Kill the process
kill $PID 2>/dev/null
if [ $? -eq 0 ]; then
    echo -e "${GREEN}[OK] LPF service stopped (PID: $PID)${NC}"
else
    echo -e "${RED}[ERROR] Failed to stop service${NC}"
    exit 1
fi
