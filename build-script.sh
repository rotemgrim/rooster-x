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

# Build the Go application
go build -ldflags="-H windowsgui" -o roosterx.exe