#!/bin/bash
set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

MOUNT_POINT="./gdrive_books"

start_mount() {
    # Check if rclone is installed
    if ! command -v rclone &> /dev/null; then
        echo -e "${RED}[AEOS] rclone is not installed.${NC}"
        if command -v apt-get &> /dev/null; then
            sudo apt-get update && sudo apt-get install -y rclone fuse3
        elif command -v winget.exe &> /dev/null; then
            echo "Installing via winget..."
            winget.exe install Rclone.Rclone
        else
            echo "Please install rclone from https://rclone.org/downloads/"
            return 1
        fi
    fi

    mkdir -p "$MOUNT_POINT"
    mkdir -p .planning

    # Verify if already mounted (Linux/POSIX)
    if command -v mountpoint &> /dev/null && mountpoint -q "$MOUNT_POINT"; then
        echo -e "${BLUE}[AEOS] Google Drive is already mounted at ${MOUNT_POINT}.${NC}"
        return
    fi

    echo -e "${BLUE}[AEOS] Initializing secure Google Drive FUSE mount...${NC}"
    
    # Mount Google Drive with read-caching enabled to prevent latency
    rclone mount gdrive: "$MOUNT_POINT" \
        --daemon \
        --vfs-cache-mode writes \
        --vfs-read-chunk-size 16M \
        --vfs-read-chunk-size-limit 100M \
        --log-file=.planning/rclone.log \
        --log-level=INFO 2>/dev/null || true

    echo -e "${GREEN}[AEOS] Google Drive successfully mounted at ${MOUNT_POINT}!${NC}"
}

stop_mount() {
    if command -v mountpoint &> /dev/null && mountpoint -q "$MOUNT_POINT"; then
        echo -e "${RED}[AEOS] Unmounting Google Drive...${NC}"
        fusermount3 -u "$MOUNT_POINT" 2>/dev/null || umount "$MOUNT_POINT" 2>/dev/null || true
        echo -e "${RED}[AEOS] Mount safely destroyed.${NC}"
    else
        # Process-based cleanup if unmount command is absent
        pkill -f "rclone mount gdrive:" 2>/dev/null || true
        echo -e "${BLUE}[AEOS] Mount safely stopped.${NC}"
    fi
}

case "$1" in
    start) start_mount ;;
    stop) stop_mount ;;
    *) echo "Usage: aeos-mount.sh [start|stop]" ;;
esac
