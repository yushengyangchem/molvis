#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST_DIR="$ROOT_DIR/web"
FORCE=0

usage() {
	cat <<'EOF'
Usage: scripts/fetch-web-libs.sh [--force]

Download frontend JS libraries for offline usage:
  - web/3Dmol-min.js
  - web/plotly.min.js

Options:
  --force   Re-download even if target file already exists
EOF
}

while [[ $# -gt 0 ]]; do
	case "$1" in
	--force)
		FORCE=1
		shift
		;;
	-h | --help)
		usage
		exit 0
		;;
	*)
		echo "Unknown option: $1" >&2
		usage >&2
		exit 1
		;;
	esac
done

if command -v curl >/dev/null 2>&1; then
	downloader() {
		local url="$1"
		local out="$2"
		curl -fL --retry 3 --connect-timeout 10 -o "$out" "$url"
	}
elif command -v wget >/dev/null 2>&1; then
	downloader() {
		local url="$1"
		local out="$2"
		wget -O "$out" "$url"
	}
else
	echo "Need curl or wget to download JS files." >&2
	exit 1
fi

mkdir -p "$DEST_DIR"

download_if_needed() {
	local url="$1"
	local out="$2"
	local tmp="${out}.tmp"

	if [[ -f $out && $FORCE -eq 0 ]]; then
		echo "Skip existing: $out"
		return
	fi

	echo "Downloading: $url"
	downloader "$url" "$tmp"
	mv "$tmp" "$out"
	echo "Saved: $out"
}

download_if_needed \
	"https://3dmol.org/build/3Dmol-min.js" \
	"$DEST_DIR/3Dmol-min.js"

download_if_needed \
	"https://cdn.plot.ly/plotly-2.35.2.min.js" \
	"$DEST_DIR/plotly.min.js"

echo "Done."
