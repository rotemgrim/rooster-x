#!/bin/bash

set -e  # Exit immediately if a command exits with a non-zero status
set -x  # Print commands and their arguments as they are executed

# Remove the dist directory
rm -rf renderer/dist
# Remove the roosterx.exe file
rm -f roosterx.exe
# Remove the static directory
rm -rf server/static

# Navigate to the renderer directory
cd renderer

# Build the package using pnpm
pnpm build

# Navigate back to the root directory
cd ..

# Copy the dist directory to the server/static directory
cp -r renderer/dist server/static

# copy icon.ico to static directory as favicon.ico
cp renderer/images/icon.ico server/static/favicon.ico

# Build the Go application with cgo: the torrent engine is libtorrent (C++),
# linked in from third_party/. Needs gcc, cmake and ninja (MinGW-w64), e.g.
# winget install BrechtSanders.WinLibs.POSIX.UCRT
command -v gcc >/dev/null || { echo "gcc not found: install MinGW-w64 (see above)"; exit 1; }
if [ ! -f third_party/libtorrent/lib/libtorrent-rasterbar.a ]; then
    bash scripts/build-libtorrent.sh
fi
# -static avoids shipping the libstdc++/libgcc DLLs.
CGO_ENABLED=1 go build -ldflags="-H windowsgui -extldflags=-static" -o roosterx.exe