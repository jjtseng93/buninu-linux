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
# Check package identity without extracting files onto disk.
printf 'Checking npm package name and version: %s\n' "$package" >&2
tar -xOzf "$package" package/package.json |
  bun -e 'const p=await Bun.stdin.json(); if(p.name!=="buninu-linux" || p.version!==process.argv[1]) throw Error("npm package name/version mismatch")' "$version"

# Recompute after the final npm pack. Keep temporary output out of the upload glob.
checks=$(mktemp .SHA256SUMS.XXXXXX)
trap 'rm -f "$checks"' EXIT
for file in *; do
  [ "$file" != SHA256SUMS ] && [ -f "$file" ] || continue
  printf 'Computing SHA-256: %s\n' "$file" >&2
  sha256sum "$file" >> "$checks"
done
mv "$checks" SHA256SUMS

# Quote the absolute directory so the printed command works from any directory.
dir=$(pwd -P | sed "s/'/'\\\\''/g")
repo=jjtseng93/buninu-linux
if [ "$mode" = --upload ]; then
  printf '\n' >&2
  printf "gh release upload 'v%s' '%s'/* --repo %s\n" "$version" "$dir" "$repo"
else
  printf 'Computing normalized image content checksum: %s\n' "$image" >&2
  content=$(bun ../../check_build.js "$image")
  digest=${content%% *}
  sed "s/@RELEASE_TAG@/v$version/g" > .release-notes.md <<'NOTES'
x86_64 OS image, npm package, build sources and SHA-256 checksums.

**Downloaded files:** Verify the release assets against `SHA256SUMS` (use `sha256sum -c SHA256SUMS` after downloading all assets).

**Local builds**

With Git and Bun installed, run these commands to fetch the pinned dependencies, build the x86_64 image, and print its content checksum before booting it.

```sh
git clone --branch @RELEASE_TAG@ --depth 1 https://github.com/jjtseng93/buninu-linux.git
cd buninu-linux
bun ./index.js -fb --arch x86_64 --real
bun ./index.js --check vda.img
```

Compare the first column of the last command’s output with the image content checksum below. GPT GUIDs, FAT metadata and build timestamps can change the SHA-256 of the entire image between builds.
NOTES
  printf '\nImage content checksum: `%s`\n' "$digest" >> .release-notes.md
  printf '\n' >&2
  printf "gh release create 'v%s' '%s'/* --repo %s --title 'Buninu Linux %s' --notes-file '%s/.release-notes.md'\n" "$version" "$dir" "$repo" "$version" "$dir"
fi
