#!/usr/bin/env bash
# Builds the libtorrent (rasterbar) static library the torrent engine links
# against, into third_party/ (git-ignored). Run once per machine, or after
# changing the versions below. Needs gcc, cmake and ninja (WinLibs ships all
# three: winget install BrechtSanders.WinLibs.POSIX.UCRT) plus curl and 7z.
#
# libtorrent is built without OpenSSL: protocol encryption and SHA-1 use its
# built-in code; only HTTPS trackers and SSL torrents are unsupported.
set -euo pipefail

LT_VERSION=2.0.15
LT_SHA256=5e2e79129823b7ea48721164c32b5aaf83d3fd733b5502100f6705b29f27bb02
BOOST_VERSION=1.88.0
BOOST_SHA256=e84a33716a31c1c8cb00783a411630d41c008e9364002dc0fe55aea4f54f4726

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$ROOT/tmp/libtorrent-build"
OUT="$ROOT/third_party"
BOOST_DIR="boost_${BOOST_VERSION//./_}"

for tool in gcc g++ cmake ninja curl 7z sha256sum; do
	command -v "$tool" >/dev/null || { echo "$tool not found"; exit 1; }
done
mkdir -p "$WORK" "$OUT"
cd "$WORK"

# download URL, file, sha256: skipped when the file is already there and valid
fetch() {
	if [ -f "$2" ] && echo "$3  $2" | sha256sum -c --status; then
		return
	fi
	curl -fL --retry 3 -o "$2" "$1"
	echo "$3  $2" | sha256sum -c
}
fetch "https://github.com/arvidn/libtorrent/releases/download/v$LT_VERSION/libtorrent-rasterbar-$LT_VERSION.tar.gz" \
	"libtorrent-rasterbar-$LT_VERSION.tar.gz" "$LT_SHA256"
fetch "https://archives.boost.io/release/$BOOST_VERSION/source/$BOOST_DIR.7z" "$BOOST_DIR.7z" "$BOOST_SHA256"

# Boost: libtorrent only needs the headers.
rm -rf "$OUT/boost"
7z x -y -bso0 -bsp0 "$BOOST_DIR.7z" "$BOOST_DIR/boost" -o.
mkdir -p "$OUT/boost"
mv "$BOOST_DIR/boost" "$OUT/boost/boost"
rm -rf "$BOOST_DIR"
# CMake 4 has no FindBoost; describe the header-only install for libtorrent.
mkdir -p "$OUT/boost/cmake"
cat > "$OUT/boost/cmake/BoostConfig.cmake" <<EOF
set(Boost_VERSION $BOOST_VERSION)
set(Boost_MAJOR_VERSION ${BOOST_VERSION%%.*})
set(Boost_MINOR_VERSION $(echo "$BOOST_VERSION" | cut -d. -f2))
get_filename_component(_boost_root "\${CMAKE_CURRENT_LIST_DIR}/.." ABSOLUTE)
if(NOT TARGET Boost::headers)
  add_library(Boost::headers INTERFACE IMPORTED)
  set_target_properties(Boost::headers PROPERTIES INTERFACE_INCLUDE_DIRECTORIES "\${_boost_root}")
endif()
set(Boost_FOUND TRUE)
EOF

rm -rf "libtorrent-rasterbar-$LT_VERSION" build "$OUT/libtorrent"
tar xzf "libtorrent-rasterbar-$LT_VERSION.tar.gz"
native() { cygpath -m "$1" 2>/dev/null || echo "$1"; }
cmake -G Ninja -S "libtorrent-rasterbar-$LT_VERSION" -B build \
	-DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -Ddeprecated-functions=OFF \
	-DCMAKE_C_COMPILER=gcc -DCMAKE_CXX_COMPILER=g++ \
	-DBoost_DIR="$(native "$OUT/boost/cmake")" \
	-DCMAKE_DISABLE_FIND_PACKAGE_OpenSSL=ON -DCMAKE_DISABLE_FIND_PACKAGE_GnuTLS=ON \
	-DCMAKE_DISABLE_FIND_PACKAGE_LibGcrypt=ON \
	-DCMAKE_INSTALL_PREFIX="$(native "$OUT/libtorrent")"
cmake --build build
cmake --install build --strip

echo "libtorrent $LT_VERSION installed in $OUT/libtorrent"
