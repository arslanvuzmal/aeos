#!/bin/bash
set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}[aeosd-install] Upgrading AEOS system hooks with Drive Mount & Inotify Watcher...${NC}"

# Target binary paths
TARGET_BIN=""
if [ -d "/usr/local/bin" ] && [ -w "/usr/local/bin" ]; then
    TARGET_BIN="/usr/local/bin/aeos"
elif [ -d "/c/usr/local/bin" ]; then
    TARGET_BIN="/c/usr/local/bin/aeos"
elif [ -d "C:/usr/local/bin" ]; then
    TARGET_BIN="C:/usr/local/bin/aeos"
else
    mkdir -p /c/usr/local/bin 2>/dev/null || mkdir -p /usr/local/bin 2>/dev/null || true
    TARGET_BIN="/c/usr/local/bin/aeos"
fi

echo "Installing AEOS CLI to $TARGET_BIN..."

# Create unified CLI binary
cat << 'EOF' > "$TARGET_BIN"
#!/bin/bash
WORKSPACE_DIR="$(pwd)"
PLANNING_DIR="$WORKSPACE_DIR/.planning"
PID_FILE="$PLANNING_DIR/aeosd.pid"

mkdir -p "$PLANNING_DIR"

case "$1" in
    start|/aeos)
        echo "Starting AEOS Unified Runtime Engine..."
        
        # 1. Boot Google Drive FUSE Mount
        if [ -f "$WORKSPACE_DIR/bin/aeos-mount.sh" ]; then
            echo "[AEOS] Initiating Drive mount service..."
            bash "$WORKSPACE_DIR/bin/aeos-mount.sh" start 2>/dev/null || true
        elif [ -f "/opt/aeosd/bin/aeos-mount.sh" ]; then
            bash "/opt/aeosd/bin/aeos-mount.sh" start 2>/dev/null || true
        fi
        
        # 2. Fire up Active Directory Watcher & Indexer
        if [ -f "$WORKSPACE_DIR/bin/aeos-watcher.sh" ]; then
            echo "[AEOS] Initiating filesystem event watcher..."
            bash "$WORKSPACE_DIR/bin/aeos-watcher.sh" start 2>/dev/null || true
        elif [ -f "/opt/aeosd/bin/aeos-watcher.sh" ]; then
            bash "/opt/aeosd/bin/aeos-watcher.sh" start 2>/dev/null || true
        fi
        
        # 3. Launch Central State Machine Coordinator
        if [ -f /opt/aeosd/src/aeosd-core.js ]; then
            DAEMON_PATH="/opt/aeosd/src/aeosd-core.js"
        elif [ -f "/c/opt/aeosd/src/aeosd-core.js" ]; then
            DAEMON_PATH="/c/opt/aeosd/src/aeosd-core.js"
        elif [ -f "C:/opt/aeosd/src/aeosd-core.js" ]; then
            DAEMON_PATH="C:/opt/aeosd/src/aeosd-core.js"
        else
            DAEMON_PATH="$WORKSPACE_DIR/src/aeosd-core.js"
        fi
        
        echo "[AEOS] Launching state machine coordinator daemon..."
        node "$DAEMON_PATH" --watch > "$PLANNING_DIR/aeosd.log" 2>&1 &
        echo $! > "$PID_FILE"
        echo "AEOS Linkage Connected. PID: $(cat $PID_FILE)"
        ;;
    stop)
        # Teardown watcher
        if [ -f "$WORKSPACE_DIR/bin/aeos-watcher.sh" ]; then
            bash "$WORKSPACE_DIR/bin/aeos-watcher.sh" stop 2>/dev/null || true
        fi
        # Teardown mount
        if [ -f "$WORKSPACE_DIR/bin/aeos-mount.sh" ]; then
            bash "$WORKSPACE_DIR/bin/aeos-mount.sh" stop 2>/dev/null || true
        fi
        # Teardown daemon
        if [ -f "$PID_FILE" ]; then
            kill $(cat "$PID_FILE") 2>/dev/null || true
            rm -f "$PID_FILE"
            echo "AEOS Linkage Safely Disconnected."
        else
            echo "No running AEOS daemon PID file found."
        fi
        ;;
    status)
        if [ -f "$PID_FILE" ]; then
            echo "AEOS Daemon is RUNNING (PID: $(cat $PID_FILE))"
        else
            echo "AEOS Daemon is STOPPED."
        fi
        if [ -f "$PLANNING_DIR/watcher.pid" ]; then
            echo "AEOS Watcher is RUNNING (PID: $(cat $PLANNING_DIR/watcher.pid))"
        else
            echo "AEOS Watcher is STOPPED."
        fi
        ;;
    *)
        echo "AEOS Interface CLI. Usage: aeos [start|stop|status]"
        ;;
esac
EOF

chmod +x "$TARGET_BIN" 2>/dev/null || true

# Mirror to Windows C:\usr\local\bin if different
if [ -d "C:/usr/local/bin" ] && [ "$TARGET_BIN" != "C:/usr/local/bin/aeos" ]; then
    cp "$TARGET_BIN" "C:/usr/local/bin/aeos" 2>/dev/null || true
fi

# Link aliases to the user's runprofiles
BASHRC_FILE="$HOME/.bashrc"
if [ -f "$BASHRC_FILE" ]; then
    grep -q "alias /aeos=" "$BASHRC_FILE" 2>/dev/null || echo "alias /aeos=\"$TARGET_BIN start\"" >> "$BASHRC_FILE"
    grep -q "alias aeos-stop=" "$BASHRC_FILE" 2>/dev/null || echo "alias aeos-stop=\"$TARGET_BIN stop\"" >> "$BASHRC_FILE"
fi

echo -e "${GREEN}[aeosd-install] INSTALLATION SUCCESSFUL!${NC}"
echo -e "${BLUE}[aeosd-install] Run: aeos start${NC}"
