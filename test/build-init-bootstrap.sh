#!/usr/bin/env bash
set -euo pipefail

# Retired: the native bootstrap that used to be /init.
#
# Bun now boots as PID 1 directly (rdinit=/bin/bun -- -e import('/init.js')),
# so nothing in the normal build path needs this. It is kept because it is the
# only way to run something before Bun starts — mounting a filesystem Bun needs
# at startup, or bisecting a boot failure by exec'ing Bun with different
# arguments. Build it, then point the kernel at it with rdinit=/init.
#
# init-bootstrap.c, next to this script, mounts devtmpfs, proc, sysfs and
# tmpfs, wires fd 0/1/2 to /dev/ttyS0 (falling back to /dev/console), and
# execve()s `/bin/bun /init.js`, so Bun replaces it and still ends up as PID 1.
# Freestanding: raw syscalls, no libc.

cd "$(dirname "$0")/.."

clang --target=x86_64-linux-gnu -fuse-ld=lld -nostdlib -static -fno-stack-protector \
    -fno-pic -Wl,-e,_start -Wl,--build-id=none \
    test/init-bootstrap.c -o initramfs/init

echo "Built initramfs/init; boot it with rdinit=/init and repack with ./scripts/pack-initramfs.sh"
