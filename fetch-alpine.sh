#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

base=https://dl-cdn.alpinelinux.org/alpine/v3.24/main/x86_64
linux_flavor=${LINUX_FLAVOR:-virt}
linux_package="linux-$linux_flavor-6.18.52-r0.apk"
musl_package=musl-1.2.6-r2.apk
stub_package=systemd-efistub-260.2-r0.apk
if [ "$linux_flavor" = lts ]; then
    linux_sha256=bd81f00522a7c7deb96886811a087c453d48530c0c8f742412ad73e24236037c
else
    linux_sha256=dff0c365a6d6c0fd015175af08dca0c39048fa39df6ef3150a7ea88d2cfdfa4f
fi

musl_sha256=573712e2f49c15bfc20a2699f204acdfc74c772722b15e7353d768057fae0e71
stub_sha256=8e64a5a3afee5f930e6e6716be726dc6d405530ac7f8fa5be6251dae68671ec9

kernel_release="6.18.52-0-$linux_flavor"

modules_root="initramfs/lib/modules/$kernel_release"
mkdir -p downloads kernel initramfs/lib "$modules_root"

. ./scripts/fetch.sh

fetch "$base/$linux_package" "$linux_package" "$linux_sha256"
fetch "$base/$musl_package" "$musl_package" "$musl_sha256"
fetch "$base/$stub_package" "$stub_package" "$stub_sha256"

extract() { tar --warning=no-unknown-keyword -xOf "downloads/$1" "$2"; }

extract "$linux_package" "boot/vmlinuz-$linux_flavor" > "kernel/vmlinuz-$linux_flavor"
extract "$musl_package" lib/ld-musl-x86_64.so.1 > initramfs/lib/ld-musl-x86_64.so.1
extract "$stub_package" usr/lib/systemd/boot/efi/linuxx64.efi.stub > kernel/linuxx64.efi.stub

# Kernel modules. The package's modules.dep says what each one needs, so a
# module is requested by name and its dependencies come along: on linux-lts
# virtio_net pulls in virtio, virtio_ring and virtio_pci, which linux-virt
# has built in. The initramfs gets a modules.dep trimmed to the shipped set,
# the fs-* lines of modules.alias and modules.builtin; /lib/modprobe.js reads
# those three files.
depfile="$(mktemp)"
selected="$(mktemp)"
trap 'rm -f "$depfile" "$selected" "$selected.names"' EXIT
extract "$linux_package" "lib/modules/$kernel_release/modules.dep" > "$depfile"

select_module() {
    local name=$1 line path dep
    line=$(grep -F -m1 -- "/$name.ko.gz:" "$depfile") \
        || { echo "error: module $name is not in $linux_package" >&2; exit 1; }
    path=${line%%:*}
    grep -qxF -- "$path" "$selected" && return
    printf '%s\n' "$path" >> "$selected"
    for dep in ${line#*:}; do
        dep=${dep##*/}
        select_module "${dep%.ko.gz}"
    done
}

# Network: virtio-net for QEMU (init.js loads these at boot).
for module in failover net_failover virtio_net; do select_module "$module"; done
# Storage: what /bin/mount loads on demand. ext4 brings jbd2, mbcache and
# crc16; FAT, exFAT and NTFS ask the kernel for the NLS tables at mount
# time, which has no /sbin/modprobe to answer, so mount preloads them.
for module in virtio_blk ext4 ext2 vfat exfat ntfs3 nls_utf8 nls_cp437 nls_iso8859-1; do
    select_module "$module"
done

if [ "${REAL_MACHINE:-}" = 1 ]; then
    # USB keyboard for the console; common storage paths (SATA/AHCI HDD and
    # SSD, NVMe including Intel VMD, legacy PATA, and USB mass-storage/UAS);
    # and the ACPI drivers behind
    # /sys/class/power_supply (battery, ac), the power button and thermal
    # zones — all modules on Alpine's kernels.
    for module in usb-common usbcore xhci-hcd xhci-pci xhci-pci-renesas hid hid-generic usbhid \
                  sd_mod ahci ata_generic pata_acpi nvme vmd usb-storage uas \
                  battery ac button thermal; do
        select_module "$module"
    done
    # Wired NICs: Intel (e1000/e1000e/igb/igc), Realtek (r8169 plus its PHY
    # driver), Qualcomm Atheros (alx), Broadcom (tg3), and USB dongles
    # (Realtek r8152, ASIX ax88179, CDC Ethernet). cfg.net in init.js
    # matches them to hardware through the pci:/usb: lines of modules.alias.
    for module in e1000 e1000e igb igc r8169 realtek alx tg3 r8152 ax88179_178a cdc_ether; do
        select_module "$module"
    done
fi

while read -r path; do
    mkdir -p "$modules_root/$(dirname "$path")"
    extract "$linux_package" "lib/modules/$kernel_release/$path" | gzip -dc > "$modules_root/${path%.gz}"
done < "$selected"

awk -F: 'NR == FNR { wanted[$0] = 1; next } $1 in wanted' "$selected" "$depfile" \
    | sed 's/\.ko\.gz/.ko/g' > "$modules_root/modules.dep"
# modules.alias: the fs-* names, and the pci:/usb:/virtio: device ids of the modules
# shipped, so /lib/modprobe.js can match hardware to drivers.
sed 's|.*/||; s|\.ko\.gz$||; s|-|_|g' "$selected" | sort -u > "$selected.names"
extract "$linux_package" "lib/modules/$kernel_release/modules.alias" \
    | awk -v names="$selected.names" '
        BEGIN { while ((getline n < names) > 0) shipped[n] = 1 }
        $2 ~ /^fs-/ { print; next }
        $2 ~ /^(pci|usb|virtio):/ { m = $3; gsub("-", "_", m); if (m in shipped) print }
    ' > "$modules_root/modules.alias"
extract "$linux_package" "lib/modules/$kernel_release/modules.builtin" > "$modules_root/modules.builtin"

chmod 0755 initramfs/lib/ld-musl-x86_64.so.1

echo "Fetched Alpine linux-$linux_flavor kernel, $(wc -l < "$selected") modules, musl, and the x64 UKI stub."
