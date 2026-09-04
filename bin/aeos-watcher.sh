#!/bin/bash
# Watches ./gdrive_books for file creation events and triggers the local-rag pipeline

WATCH_DIR="./gdrive_books"
PID_FILE=".planning/watcher.pid"

start_watcher() {
    mkdir -p "$WATCH_DIR" .planning
    
    if command -v inotifywait &> /dev/null; then
        echo "Activating filesystem watcher on $WATCH_DIR..."
        inotifywait -m -r -e close_write --format '%w%f' "$WATCH_DIR" | while read -r NEW_FILE
        do
            if [[ "$NEW_FILE" == *.pdf ]] || [[ "$NEW_FILE" == *.md ]] || [[ "$NEW_FILE" == *.txt ]]; then
                echo "🔥 [AEOS] New Book Detected: $NEW_FILE"
                echo "⚡ Starting local, token-zero RAG compilation..."
                python src/local-rag.py "$WATCH_DIR"
            fi
        done &
        echo $! > "$PID_FILE"
        echo "Watcher active (PID: $(cat $PID_FILE))"
    else
        echo "Activating cross-platform filesystem watcher on $WATCH_DIR..."
        node -e "
            const fs = require('fs');
            const path = require('path');
            const { execSync } = require('child_process');
            const watchDir = path.resolve('$WATCH_DIR');
            if (!fs.existsSync(watchDir)) fs.mkdirSync(watchDir, { recursive: true });
            console.log('[AEOS Watcher] Active on: ' + watchDir);
            let debounce = null;
            fs.watch(watchDir, { recursive: true }, (event, filename) => {
                if (filename && (filename.endsWith('.pdf') || filename.endsWith('.md') || filename.endsWith('.txt'))) {
                    clearTimeout(debounce);
                    debounce = setTimeout(() => {
                        console.log('🔥 [AEOS] New Book Detected: ' + filename);
                        console.log('⚡ Starting local, token-zero RAG compilation...');
                        try {
                            execSync('python src/local-rag.py \"' + watchDir + '\"', { stdio: 'inherit' });
                        } catch (e) {
                            console.error('[AEOS Watcher Error]: ' + e.message);
                        }
                    }, 500);
                }
            });
            setInterval(() => {}, 1000);
        " > .planning/watcher.log 2>&1 &
        echo $! > "$PID_FILE"
        echo "Watcher active (PID: $(cat $PID_FILE))"
    fi
}

stop_watcher() {
    if [ -f "$PID_FILE" ]; then
        kill $(cat "$PID_FILE") 2>/dev/null || true
        rm -f "$PID_FILE"
        echo "Watcher safely stopped."
    else
        echo "No running watcher PID file found."
    fi
}

case "$1" in
    start) start_watcher ;;
    stop) stop_watcher ;;
    *) echo "Usage: aeos-watcher.sh [start|stop]" ;;
esac
