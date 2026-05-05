#!/bin/bash

# Change to the directory where the script is located
cd "$(dirname "$0")" || exit 1

echo "========================================================"
echo "Antigravity Patch Installer (macOS)"
echo "========================================================"
echo
echo "This script will temporarily download Node.js to apply"
echo "the patch without modifying your system installations."
echo

TMP_DIR="$(pwd)/.tmp_node"
mkdir -p "$TMP_DIR"

# Determine architecture (Apple Silicon vs Intel)
ARCH=$(uname -m)
if [ "$ARCH" = "arm64" ]; then
    NODE_ARCH="darwin-arm64"
elif [ "$ARCH" = "x86_64" ]; then
    NODE_ARCH="darwin-x64"
else
    echo "ERROR: Unsupported architecture ($ARCH)"
    read -p "Press [Enter] to exit..."
    exit 1
fi

echo "[1/3] Fetching latest Node.js release info for $NODE_ARCH..."
LATEST_TARBALL=$(curl -s https://nodejs.org/dist/latest/SHASUMS256.txt | grep "$NODE_ARCH.tar.gz" | awk '{print $2}')

if [ -z "$LATEST_TARBALL" ]; then
    echo
    echo "ERROR: Could not determine the latest Node.js version. Please check your internet connection."
    echo "Cleaning up..."
    rm -rf "$TMP_DIR"
    read -p "Press [Enter] to exit..."
    exit 1
fi

NODE_URL="https://nodejs.org/dist/latest/$LATEST_TARBALL"
TAR_FILE="$TMP_DIR/node_latest.tar.gz"

echo "Downloading $LATEST_TARBALL..."
curl -# -L -o "$TAR_FILE" "$NODE_URL"

if [ ! -f "$TAR_FILE" ]; then
    echo
    echo "ERROR: Failed to download Node.js."
    echo "Cleaning up..."
    rm -rf "$TMP_DIR"
    read -p "Press [Enter] to exit..."
    exit 1
fi

echo "Extracting Node.js..."
tar -xzf "$TAR_FILE" -C "$TMP_DIR"

# Find the node executable inside the extracted folder
NODE_EXE=$(find "$TMP_DIR" -path "*/bin/node" -type f | head -n 1)

if [ -z "$NODE_EXE" ] || [ ! -f "$NODE_EXE" ]; then
    echo
    echo "ERROR: Failed to extract or find the Node.js executable."
    echo "Cleaning up..."
    rm -rf "$TMP_DIR"
    read -p "Press [Enter] to exit..."
    exit 1
fi

# Ensure it is executable
chmod +x "$NODE_EXE"

# Remove quarantine attribute just in case to prevent Gatekeeper prompts
xattr -d com.apple.quarantine "$NODE_EXE" 2>/dev/null

echo
echo "[2/3] Applying the patch..."
echo
"$NODE_EXE" applyAutoRetryContinueAllowPatch.js
EXIT_CODE=$?

echo
echo "[3/3] Cleaning up temporary files..."
rm -rf "$TMP_DIR"

echo
echo "========================================================"
if [ $EXIT_CODE -eq 0 ]; then
    echo "Patch process finished successfully!"
else
    echo "Patch process finished with errors (Code $EXIT_CODE)."
fi
echo "========================================================"

# Keep terminal open when run by double-clicking in Finder
read -p "Press [Enter] to exit..."
