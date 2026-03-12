#!/bin/bash

cd "$(dirname "$0")"
cd ..

PROJECT_ROOT=$PWD

# Get port from config
PORT=$(node -e "console.log(require('./config').server.port)")

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

echo "========================================"
echo "   LPF File Server"
echo "========================================"
echo ""

# Check Node.js
node --version >/dev/null 2>&1
if [ $? -ne 0 ]; then
    echo -e "${RED}[ERROR] Node.js not installed${NC}"
    echo "Please install Node.js 18+: https://nodejs.org/"
    exit 1
fi

echo "[OK] Node.js installed"
node -v
echo ""

# Check if LPF is already running (check port)
if netstat -tln 2>/dev/null | grep -q ":$PORT" || ss -tuln 2>/dev/null | grep -q ":$PORT"; then
    echo -e "${RED}[ERROR] LPF service is already running on port $PORT${NC}"
    echo "Please stop the existing service first"
    exit 1
fi

# Check modules
if [ ! -d "node_modules" ]; then
    echo "[INFO] Installing dependencies..."
    npm install
fi

echo "[OK] Dependencies ready"
echo ""
echo "========================================"
echo "Starting server..."
echo "========================================"
echo ""
echo "User: admin / admin123"
echo ""

# Get local IP
get_local_ip() {
    local ip=""
    if command -v ip &> /dev/null; then
        ip=$(ip route get 1.1.1.1 2>/dev/null | grep -oP 'src \K[^ ]+' | head -1)
    fi
    if [ -z "$ip" ]; then
        ip=$(hostname -I 2>/dev/null | awk '{print $1}')
    fi
    if [ -z "$ip" ]; then
        ip="127.0.0.1"
    fi
    echo "$ip"
}

LOCAL_IP=$(get_local_ip)

# Start server in background
nohup node server.js > /dev/null 2>&1 &
SERVER_PID=$!

echo "LPF Server running on http://localhost:$PORT"
echo "LPF Server running on http://${LOCAL_IP}:$PORT"
echo ""
echo "Service started (PID: $SERVER_PID)"
echo "To stop: kill $SERVER_PID"
