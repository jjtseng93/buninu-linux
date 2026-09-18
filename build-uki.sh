#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

test -s kernel/vmlinuz-virt || ./fetch-alpine.sh
./scripts/pack-initramfs.sh

mkdir -p build vda/EFI/BOOT
printf '%s\n' \
    'NAME="Buninu Linux"' \
    'ID=buninu-linux' \
    'PRETTY_NAME="Buninu Linux 1"' \
    'VERSION_ID=1' > build/os-release
# Bun itself is PID 1: no native bootstrap. `-e import('/init.js')` avoids the
# entry-file open that would readlink /proc/self/fd/N before /proc exists;
# init.js mounts /proc, /sys, /dev and /tmp as its first action.
#
# Everything before `--` needs an `=`: the kernel appends any bare word to the
# init argv instead of treating it as an environment assignment. Everything
# after `--` becomes argv[1..] verbatim, and argv[0] is the rdinit path. The
# kernel does not care about the order of the parameters, so `rdinit=` goes
# last and the tail of the line reads as the `bun -e ...` it turns into.
#
# ttyS0 is listed last so it, not tty0, is the console the kernel opens as the
# init process's fd 0/1/2. `-display none` leaves tty0 with nowhere to go.
printf '%s' "console=tty0 console=ttyS0,115200 panic=0 PATH=/bin rdinit=/bin/bun -- -e import('/init.js')" > build/cmdline

if command -v x86_64-w64-mingw32-objcopy >/dev/null; then
    objcopy_command=x86_64-w64-mingw32-objcopy
    objdump_command=x86_64-w64-mingw32-objdump
else
    echo "error: build stage needs x86_64-w64-mingw32-objcopy (Debian binutils-mingw-w64-x86-64)" >&2
    echo "run inside PRoot; see README section 0" >&2
    exit 1
fi

image_base_hex="$($objdump_command -p kernel/linuxx64.efi.stub \
    | awk '$1 == "ImageBase" { print $2; exit }')"
image_base=$((16#$image_base_hex))
osrel_vma=$((image_base + 0x20000))
cmdline_vma=$((image_base + 0x30000))
linux_vma=$((image_base + 0x2000000))
initrd_vma=$((image_base + 0x3000000))

# These are the conventional non-overlapping VMAs used for x86-64 UKIs.
# The Alpine virt kernel is below 16 MiB, so .linux ends before .initrd.
"$objcopy_command" \
    --add-section .osrel=build/os-release \
    --change-section-vma .osrel="$osrel_vma" \
    --set-section-flags .osrel=contents,alloc,load,readonly,data \
    --add-section .cmdline=build/cmdline \
    --change-section-vma .cmdline="$cmdline_vma" \
    --set-section-flags .cmdline=contents,alloc,load,readonly,data \
    --add-section .linux=kernel/vmlinuz-virt \
    --change-section-vma .linux="$linux_vma" \
    --set-section-flags .linux=contents,alloc,load,readonly,data \
    --add-section .initrd=build/initramfs.cpio.gz \
    --change-section-vma .initrd="$initrd_vma" \
    --set-section-flags .initrd=contents,alloc,load,readonly,data \
    kernel/linuxx64.efi.stub vda/EFI/BOOT/BOOTX64.EFI

echo "Built UKI at vda/EFI/BOOT/BOOTX64.EFI"
