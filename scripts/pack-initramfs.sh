#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

. ./scripts/arch.sh

test -x "$native_dir/bin/bun" || {
    echo "error: no $native_dir/bin/bun yet; run the fetch stage first (./index.js -f)" >&2
    exit 1
}
mkdir -p build

staging="$(mktemp -d "$PWD/.initramfs.XXXXXX")"
archive="$(mktemp "$PWD/.initramfs.XXXXXX.cpio")"
trap 'rm -rf "$staging"; rm -f "$archive"' EXIT

# initramfs/ is the same for every architecture; native/<arch>/ adds bun, the
# musl loader, the GCC runtime and the kernel modules on top of it.
# A checkout fetched before native/ existed still has an x86_64 bun and its
# modules under initramfs/; they are dropped rather than packed.
cp -a --reflink=auto initramfs/. "$staging/"
rm -rf "$staging/bin/bun" "$staging/lib/modules"
cp -a --reflink=auto "$native_dir/." "$staging/"
# Keep the project README canonical while making it available to
# buninu-linux-help from the conventional installed-document path.
cp README.md "$staging/usr/share/doc/buninu-linux/README.md"
cp -a LICENSE NOTICE.md LICENSES "$staging/usr/share/licenses/"

# fakeroot lets cpio record the character devices without real root. Nothing
# has mounted devtmpfs when the kernel execs Bun as PID 1, so every device
# Bun's startup needs has to be in the archive itself:
#
#   console  the kernel opens it as init's fd 0/1/2 before the exec
#   urandom  JSC's OSRandomSource calls CRASH() outright if open() fails, which
#            is the `panic(main thread): abort() called` you get without it.
#            This is the one device that actually blocks booting Bun as PID 1.
#
# The rest are cheap to include and keep /dev usable if the devtmpfs mount in
# init.js ever fails. The serial port is ttyS0 (4, 64) on x86_64 and the
# PL011 ttyAMA0 (204, 64) on aarch64.
fakeroot-tcp -- sh -c '
    mknod -m 0600 "$1/dev/console" c 5 1
    mknod -m 0620 "$1/dev/$3" c "$4" 64
    mknod -m 0666 "$1/dev/null" c 1 3
    mknod -m 0666 "$1/dev/zero" c 1 5
    mknod -m 0666 "$1/dev/random" c 1 8
    mknod -m 0666 "$1/dev/urandom" c 1 9
    mknod -m 0666 "$1/dev/tty" c 5 0
    cd "$1"
    find . -mindepth 1 -print0 \
        | sort -z \
        | cpio --null --create --format=newc --owner=0:0 --reproducible 2>/dev/null \
        > "$2"
' sh "$staging" "$archive" "$serial_console" "$serial_major"

gzip -9n < "$archive" > build/initramfs.cpio.gz

echo "Built build/initramfs.cpio.gz for $arch"
