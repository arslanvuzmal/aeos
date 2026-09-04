#!/bin/bash
set -e

# Create unified CLI binary
cat << 'EOF' > /usr/local/bin/aeos
#!/bin/bash
WORKSPACE_DIR="$(pwd)"
PLANNING_DIR="$WORKSPACE_DIR/.planning"
PID_FILE="$PLANNING_DIR/aeosd.pid"

case "$1" in
    start|/aeos)
        echo "Starting connection daemon..."
        node /opt/aeosd/src/aeosd-core.js --watch > "$PLANNING_DIR/aeosd.log" 2>&1 &
        echo $! > "$PID_FILE"
        echo "AEOS Linkage Connected."
        ;;
    stop)
        if [ -f "$PID_FILE" ]; then
            kill $(cat "$PID_FILE") 2>/dev/null || true
            rm -f "$PID_FILE"
            echo "AEOS Linkage Safely Disconnected."
        fi
        ;;
    *)
        echo "AEOS Interface CLI. Usage: aeos [start|stop]"
        ;;
esac
EOF

chmod +x /usr/local/bin/aeos

# Link aliases to the user's runprofiles
echo "alias /aeos=\"/usr/local/bin/aeos start\"" >> ~/.bashrc || true
echo "alias aeos-stop=\"/usr/local/bin/aeos stop\"" >> ~/.bashrc || true

echo "AEOS INSTALLATION SUCCESSFUL!"
echo "To boot the connected environment in any directory, type: aeos start"
