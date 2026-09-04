#!/bin/bash
set -e
echo "Bootstrapping global AEOS terminal hooks..."
cat << 'INNER_EOF' > /usr/local/bin/aeos
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
        echo "AEOS CLI. Usage: aeos [start|stop]"
        ;;
esac
INNER_EOF
chmod +x /usr/local/bin/aeos
echo "alias /aeos=\"/usr/local/bin/aeos start\"" >> ~/.bashrc || true
echo "AEOS installation completed successfully!"
