#!/bin/sh

sd=$(cd "$(dirname "$0")" && pwd)

show_help() {
  cat <<EOF
Usage: $0 <version>
       $0 -h | --help

Download Bun release binaries from oven-sh/bun and create:
  $sd/bunBin.tgz

Accepted version formats:
  1.3.14
  v1.3.14
  bun-v1.3.14
  canary

Archive contents:
  bun-la      Linux aarch64
  bun-lx      Linux x64
  bun-wx.exe  Windows x64

The archive is consumed by ../../bin/bun.sh and extracted into
no_backup/bin when it is newer than the selected Bun executable.
EOF
}

if [ "${1-}" = -h ] || [ "${1-}" = --help ]; then
  show_help
  exit 0
fi

if [ "$#" -ne 1 ]; then
  show_help 1>&2
  exit 2
fi

if [ "$1" = canary ]; then
  tag=canary
else
  version=${1#bun-}
  version=${version#v}
  tag=bun-v$version
fi
base_url=https://github.com/oven-sh/bun/releases/download/$tag
output=$sd/bunBin.tgz

for command in curl unzip tar mktemp; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Required command not found: $command" 1>&2
    exit 127
  fi
done

tmp=$(mktemp -d "${TMPDIR:-/tmp}/make-bunBin.XXXXXX")

cleanup() {
  rm -rf "$tmp"
}

download_bun() {
  asset=$1
  member=$2
  destination=$3
  archive=$tmp/$asset.zip

  echo "Downloading $asset for Bun $tag..."
  if ! curl --fail --location --retry 3 --output "$archive" "$base_url/$asset.zip"; then
    cleanup
    exit 1
  fi
  if ! unzip -p "$archive" "$asset/$member" >"$tmp/$destination"; then
    cleanup
    exit 1
  fi
  if ! chmod 755 "$tmp/$destination"; then
    cleanup
    exit 1
  fi
}

download_bun bun-linux-aarch64 bun bun-la
download_bun bun-linux-x64 bun bun-lx
download_bun bun-windows-x64 bun.exe bun-wx.exe

# bun.sh extracts this archive directly into no_backup/bin.
if ! tar -czf "$tmp/bunBin.tgz" -C "$tmp" bun-la bun-lx bun-wx.exe; then
  cleanup
  exit 1
fi
if ! mv "$tmp/bunBin.tgz" "$output"; then
  cleanup
  exit 1
fi
cleanup

echo "Created $output"
tar -tzvf "$output"
