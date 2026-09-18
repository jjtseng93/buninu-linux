#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

bun_version=1.4.2
alpine_base=https://dl-cdn.alpinelinux.org/alpine/v3.24/main/x86_64
bun_url="https://github.com/oven-sh/bun/releases/download/bun-v${bun_version}/bun-linux-x64-musl-baseline.zip"
bun_zip="bun-linux-x64-musl-baseline-${bun_version}.zip"
libstdcpp_package=libstdc++-15.2.0-r5.apk
libgcc_package=libgcc-15.2.0-r5.apk
bun_sha256=76e1db84e98f22f78de0a87e309bfbbf297732847f9720db36750646c85c8c18
libstdcpp_sha256=14c987b556f5385a5db18376e788c75f37d85321b8dc1920d926ea7daac1d6f6
libgcc_sha256=393dcd32629f06d7d85409c272d142d0c082772d10b87ef55ee82f47de3be637

mkdir -p downloads initramfs/bin initramfs/lib initramfs/dev initramfs/proc initramfs/sys initramfs/tmp

. ./scripts/fetch.sh

fetch "$bun_url" "$bun_zip" "$bun_sha256"
fetch "$alpine_base/$libstdcpp_package" "$libstdcpp_package" "$libstdcpp_sha256"
fetch "$alpine_base/$libgcc_package" "$libgcc_package" "$libgcc_sha256"

test -s initramfs/lib/ld-musl-x86_64.so.1 || {
  echo "error: fetch stage incomplete: run ./fetch-alpine.sh first (./index.js -f runs both)" >&2
  exit 1
}

unzip -p "downloads/$bun_zip" \
  'bun-linux-x64-musl-baseline/bun' > initramfs/bin/bun
tar --warning=no-unknown-keyword -xOf "downloads/$libstdcpp_package" \
  usr/lib/libstdc++.so.6.0.34 > initramfs/lib/libstdc++.so.6
tar --warning=no-unknown-keyword -xOf "downloads/$libgcc_package" \
  usr/lib/libgcc_s.so.1 > initramfs/lib/libgcc_s.so.1

# Keep libc as a distinct inode from the active dynamic loader. Calling dlopen
# on the loader inode itself deadlocks, while this physical copy is FFI-safe.
cp initramfs/lib/ld-musl-x86_64.so.1 initramfs/lib/libc.musl-x86_64.so.1
chmod 0755 initramfs/init.js initramfs/bin/bun initramfs/lib/*.so*

echo "Fetched Bun $bun_version and its x86_64 musl runtime into initramfs/."
