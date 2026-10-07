# RoosterX - Readme

to run in watch mode:

```bash
# install air
go install github.com/air-verse/air@latest

# run air
air
```

make sure you have sqlboiler installed:

```bash
go install github.com/volatiletech/sqlboiler/v4@latest

# also install the sqlite3 driver
go install github.com/volatiletech/sqlboiler/v4/drivers/sqlboiler-sqlite3@latest
```

run this to generate models:

```bash
sqlboiler sqlite3 --add-global-variants --add-panic-variants
```

## Building

The torrent engine is libtorrent (C++), linked in with cgo, so building needs
MinGW-w64 gcc plus cmake and ninja (WinLibs has all three):

```bash
winget install BrechtSanders.WinLibs.POSIX.UCRT

# once per machine: downloads, verifies and builds libtorrent into third_party/
bash scripts/build-libtorrent.sh
```

better to run the build-script.sh to include the client-side (it also builds
libtorrent when third_party/ is missing)

```bash

./build-script.sh

CGO_ENABLED=1 go build -ldflags="-H windowsgui -extldflags=-static" -o roosterx.exe
```

## change executable icon

Replace icon.ico and rebuild the resource files (icon only: a manifest of our
own can't be linked next to gcc's, see scripts/rsrc.rc):

```bash
windres -F pe-x86-64 -i scripts/rsrc.rc -O coff -o rsrc_windows_amd64.syso
windres -F pe-i386 -i scripts/rsrc.rc -O coff -o rsrc_windows_386.syso
```
