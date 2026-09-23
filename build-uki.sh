#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

. ./scripts/arch.sh

if [ ! -s "$kernel_image" ] || [ ! -s "$kernel_dir/$efi_stub" ] || [ ! -s "$modules_root/modules.dep" ] || \
    { [ "${REAL_MACHINE:-}" = 1 ] && \
    { [ ! -s "$modules_root/kernel/drivers/hid/usbhid/usbhid.ko" ] || \
      [ ! -s "$modules_root/kernel/drivers/acpi/battery.ko" ]; }; }; then
    ./fetch-alpine.sh
fi
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
# The serial port (ttyS0, or ttyAMA0 on aarch64) is listed last so it, not
# tty0, is the console the kernel opens as the init process's fd 0/1/2.
# `-display none` leaves tty0 with nowhere to go.
if [ "${REAL_MACHINE:-}" = 1 ]; then
    consoles="console=$serial_console,115200 console=tty0 REAL_MACHINE=1"
else
    consoles="console=tty0 console=$serial_console,115200"
fi
printf '%s' "$consoles panic=0 PATH=/bin KERNEL_RELEASE=$kernel_release rdinit=/bin/bun -- -e import('/init.js')" > build/cmdline

if ! command -v "$uki_objcopy" >/dev/null || ! command -v "$uki_objdump" >/dev/null; then
    echo "error: build stage needs $uki_objcopy and $uki_objdump (Debian $uki_binutils_package)" >&2
    echo "run inside PRoot or with ./index.js --docker; see README Build environment" >&2
    exit 1
fi

stub="$kernel_dir/$efi_stub"
pe_header() { "$uki_objdump" -p "$stub" | awk -v key="$1" '$1 == key { print $2; exit }'; }
align_up() { echo $(( ($1 + $2 - 1) / $2 * $2 )); }
max() { echo $(( $1 > $2 ? $1 : $2 )); }

# The conventional x86-64 UKI offsets from the image base: .osrel +0x20000,
# .cmdline +0x30000, .linux +0x2000000, .initrd +0x3000000. The stub's own
# sections (SizeOfImage) and the kernel are measured rather than assumed, so
# a larger stub or a kernel of 16 MiB or more moves the later sections up
# instead of overlapping them. The x86_64 stub and both kernels fit the
# conventional layout; the aarch64 stub ends at +0x38000, which puts .osrel
# and .cmdline at +0x40000 and +0x50000 there.
image_base=$((16#$(pe_header ImageBase)))
stub_size=$((16#$(pe_header SizeOfImage)))
kernel_size=$(wc -c < "$kernel_image")
osrel_offset=$(max 0x20000 "$(align_up "$stub_size" 0x10000)")
cmdline_offset=$((osrel_offset + 0x10000))
linux_offset=$(max 0x2000000 "$(align_up $((cmdline_offset + 0x10000)) 0x1000000)")
initrd_offset=$(max 0x3000000 "$(align_up $((linux_offset + kernel_size)) 0x1000000)")
osrel_vma=$((image_base + osrel_offset))
cmdline_vma=$((image_base + cmdline_offset))
linux_vma=$((image_base + linux_offset))
initrd_vma=$((image_base + initrd_offset))

# Only this architecture's removable-media name may remain: firmware of the
# other architecture ignores it, but run-qemu.sh reads the guest from it.
for efi in vda/EFI/BOOT/*.EFI; do
    [ "$efi" = "vda/EFI/BOOT/$efi_boot_name" ] || rm -f "$efi"
done

"$uki_objcopy" \
    --add-section .osrel=build/os-release \
    --change-section-vma .osrel="$osrel_vma" \
    --set-section-flags .osrel=contents,alloc,load,readonly,data \
    --add-section .cmdline=build/cmdline \
    --change-section-vma .cmdline="$cmdline_vma" \
    --set-section-flags .cmdline=contents,alloc,load,readonly,data \
    --add-section .linux="$kernel_image" \
    --change-section-vma .linux="$linux_vma" \
    --set-section-flags .linux=contents,alloc,load,readonly,data \
    --add-section .initrd=build/initramfs.cpio.gz \
    --change-section-vma .initrd="$initrd_vma" \
    --set-section-flags .initrd=contents,alloc,load,readonly,data \
    "$stub" "vda/EFI/BOOT/$efi_boot_name"

echo "Built $arch UKI with Alpine linux-$linux_flavor at vda/EFI/BOOT/$efi_boot_name"
