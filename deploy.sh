#!/usr/bin/env bash
# Build, deploy and run roosterx.exe.
#
# 1. Kills any running roosterx.exe.
# 2. Runs build-script.sh to produce a fresh roosterx.exe.
# 3. Copies it to the deploy folder, overwriting the existing one.
# 4. Launches it from the deploy folder.
#
# Usage:  ./deploy.sh

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR_WIN='C:\Users\TV\Desktop\go-rooster-x'
# Git Bash / MSYS-friendly path for file ops.
DEPLOY_DIR='/c/Users/TV/Desktop/go-rooster-x'
EXE_NAME='roosterx.exe'
REPO_EXE="$REPO_DIR/$EXE_NAME"
DEPLOY_EXE="$DEPLOY_DIR/$EXE_NAME"

rooster_running() {
    # Returns 0 if at least one roosterx process is running.
    powershell.exe -NoProfile -Command "if (Get-Process -Name 'roosterx' -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }" >/dev/null 2>&1
}

kill_rooster() {
    if rooster_running; then
        local old_pids
        old_pids="$(powershell.exe -NoProfile -Command "(Get-Process -Name 'roosterx' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id) -join ','" 2>/dev/null | tr -d '\r\n')"
        echo ">> Stopping running $EXE_NAME (PID: ${old_pids}) ..."
        powershell.exe -NoProfile -Command "Get-Process -Name 'roosterx' -ErrorAction SilentlyContinue | Stop-Process -Force" >/dev/null 2>&1 || true
        # Wait until it's actually gone so the file isn't locked.
        for _ in $(seq 1 50); do
            if ! rooster_running; then
                break
            fi
            sleep 0.2
        done
        if rooster_running; then
            echo "!! Failed to stop $EXE_NAME (still running)." >&2
            exit 1
        fi
        echo ">> Stopped."
    else
        echo ">> No running $EXE_NAME found."
    fi
}

# 1. Kill old executable.
kill_rooster

# 2. Build.
echo ">> Building via build-script.sh ..."
cd "$REPO_DIR"
bash ./build-script.sh

if [[ ! -f "$REPO_EXE" ]]; then
    echo "Build finished but $REPO_EXE not found." >&2
    exit 1
fi

# 3. Copy to deploy folder (kill again in case it respawned).
kill_rooster
mkdir -p "$DEPLOY_DIR"
echo ">> Copying $EXE_NAME to $DEPLOY_DIR_WIN ..."
cp -f "$REPO_EXE" "$DEPLOY_EXE"

# 4. Launch from deploy folder.
echo ">> Launching $DEPLOY_EXE ..."
( cd "$DEPLOY_DIR" && cmd //c start "" "$EXE_NAME" )

# Report the new PID for confirmation.
sleep 0.5
new_pid="$(powershell.exe -NoProfile -Command "(Get-Process -Name 'roosterx' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id) -join ','" 2>/dev/null | tr -d '\r\n')"
echo ">> New $EXE_NAME PID: ${new_pid:-<not detected>}"

echo ">> Deploy finished."
