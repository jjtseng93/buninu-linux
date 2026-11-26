#!/bin/sh
set -eu

default_version=0.18.65
usage() {
  echo "Usage: $0 [version (default: $default_version)] [--upload]"
}

case ${1:-} in
  --help|-h) usage; exit 0 ;;
esac
version=${1:-$default_version}
mode=${2:-}
if [ $# -gt 2 ] || ! printf '%s\n' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' ||
   { [ -n "$mode" ] && [ "$mode" != --upload ]; }; then
  usage >&2
  exit 2
fi

cd "$(dirname "$0")/$version"
image="buninu-linux-$version.img"
package="buninu-linux-$version.tgz"
for file in "$image" "$package"; do
  [ -s "$file" ] || { echo "Missing or empty release asset: $file" >&2; exit 1; }
done
# Include legacy release layouts and any extra source archives prepared for them.
# This release ships these three source archives as separate downloads.
if [ "$version" = 0.18.65 ]; then
  for file in alpine-sources-0.18.65.tar bun-1.4.5-source.tar.gz webkit-d6375c72-build-source.tar.gz; do
    [ -s "$file" ] || { echo "Missing or empty release asset: $file" >&2; exit 1; }
  done
fi
# Check package identity without extracting files onto disk.
tar -xOzf "$package" package/package.json |
  bun -e 'const p=await Bun.stdin.json(); if(p.name!=="buninu-linux" || p.version!==process.argv[1]) throw Error("npm package name/version mismatch")' "$version"

# Recompute after the final npm pack. Keep temporary output out of the upload glob.
checks=$(mktemp .SHA256SUMS.XXXXXX)
trap 'rm -f "$checks"' EXIT
for file in *; do
  [ "$file" != SHA256SUMS ] && [ -f "$file" ] || continue
  sha256sum "$file" >> "$checks"
done
mv "$checks" SHA256SUMS

# Quote the absolute directory so the printed command works from any directory.
dir=$(pwd -P | sed "s/'/'\\\\''/g")
repo=jjtseng93/buninu-linux
if [ "$mode" = --upload ]; then
  printf "(cd '%s' && gh release upload 'v%s' ./* --repo %s)\n" "$dir" "$version" "$repo"
else
  target=$(git rev-parse HEAD)
  printf "(cd '%s' && gh release create 'v%s' ./* --repo %s --target %s --title 'Buninu Linux %s' --notes 'x86_64 OS image, npm package, build sources and SHA-256 checksums.')\n" "$dir" "$version" "$repo" "$target" "$version"
fi
