#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

. ./scripts/arch.sh

mkdir -p "$downloads_dir" "$native_dir/bin" "$native_dir/lib" \
  initramfs/dev initramfs/proc initramfs/sys initramfs/tmp

. ./scripts/fetch.sh

fetch "$bun_url" "$bun_zip" "$bun_sha256"
fetch "$alpine_base/$libstdcpp_package" "$libstdcpp_package" "$libstdcpp_sha256"
fetch "$alpine_base/$libgcc_package" "$libgcc_package" "$libgcc_sha256"

test -s "$native_dir/lib/$musl_loader" || {
  echo "error: fetch stage incomplete: run ./fetch-alpine.sh first (./index.js -f runs both)" >&2
  exit 1
}

unzip -p "$downloads_dir/$bun_zip" \
  "$bun_build/bun" > "$native_dir/bin/bun"
tar --warning=no-unknown-keyword -xOf "$downloads_dir/$libstdcpp_package" \
  usr/lib/libstdc++.so.6.0.34 > "$native_dir/lib/libstdc++.so.6"
tar --warning=no-unknown-keyword -xOf "$downloads_dir/$libgcc_package" \
  usr/lib/libgcc_s.so.1 > "$native_dir/lib/libgcc_s.so.1"

# Keep libc as a distinct inode from the active dynamic loader. Calling dlopen
# on the loader inode itself deadlocks, while this physical copy is FFI-safe.
cp "$native_dir/lib/$musl_loader" "$native_dir/lib/$musl_libc"
chmod 0755 initramfs/init.js "$native_dir/bin/bun" "$native_dir"/lib/*.so*

echo "Fetched Bun $bun_version and its $arch musl runtime into $native_dir/."
