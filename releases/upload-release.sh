#!/bin/sh
set -eu

# Usage: ./upload-release.sh [version] [--upload]
# --upload adds assets to an existing release without replacing files.
# Otherwise, create a release; gh creates a missing tag from the remote
# default branch. Authenticate first with: gh auth login
#
# POSIX sh only (also runs under bunmsh): no [[ ]], arrays or BASH_SOURCE.

usage() {
  echo "Usage: $0 [version (default: 0.10.56)] [--upload]"
}

case ${1:-} in
  --help|-h) usage; exit 0 ;;
esac

version=${1:-0.18.64}
mode=${2:-}

if [ $# -gt 2 ] ||
   ! printf '%s\n' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' ||
   { [ -n "$mode" ] && [ "$mode" != --upload ]; }; then
  usage >&2
  exit 2
fi

cd "$(dirname "$0")"
command -v gh >/dev/null || {
  echo "GitHub CLI (gh) is required." >&2
  exit 1
}

repo=jjtseng93/buninu-linux
tag="v$version"
directory="$version"
for asset in \
  "$directory/buninu-linux-$version.tgz" \
  "$directory/buninu-linux-$version.img"
do
  if [ ! -s "$asset" ]; then
    echo "Missing or empty release asset: $asset" >&2
    exit 1
  fi
done

if [ "$mode" = --upload ]; then
  echo gh release upload "$tag" "$version"'/*' --repo "$repo"
else
  echo gh release create "$tag" "$version"'/*' \
    --repo "$repo" \
    --title "'Buninu Linux $version'" \
    --notes "'Buninu Linux OS image and source archives.'"
fi
