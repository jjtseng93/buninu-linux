#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

. ./scripts/arch.sh

mkdir -p "$downloads_dir" "$kernel_dir" "$native_dir/lib" "$modules_root"

. ./scripts/fetch.sh

fetch "$alpine_base/$linux_package" "$linux_package" "$linux_sha256"
fetch "$alpine_base/$musl_package" "$musl_package" "$musl_sha256"
fetch "$alpine_base/$stub_package" "$stub_package" "$stub_sha256"

extract() { tar --warning=no-unknown-keyword -xOf "$downloads_dir/$1" "$2"; }

# On aarch64 vmlinuz is an EFI zboot image: a PE executable that inflates
# the kernel itself, so the stub can start it exactly like the x86_64 bzImage.
extract "$linux_package" "boot/vmlinuz-$linux_flavor" > "$kernel_image"
extract "$musl_package" "lib/$musl_loader" > "$native_dir/lib/$musl_loader"
extract "$stub_package" "usr/lib/systemd/boot/efi/$efi_stub" > "$kernel_dir/$efi_stub"

# Kernel modules. The package's modules.dep says what each one needs, so a
# module is requested by name and its dependencies come along: on linux-lts
# virtio_net pulls in virtio and virtio_ring, which linux-virt has built in. The initramfs gets a modules.dep trimmed to the shipped set,
# the fs-* lines of modules.alias and modules.builtin; /lib/modprobe.js reads
# those three files.
depfile="$(mktemp)"
selected="$(mktemp)"
trap 'rm -f "$depfile" "$selected" "$selected.names"' EXIT
extract "$linux_package" "lib/modules/$kernel_release/modules.dep" > "$depfile"
extract "$linux_package" "lib/modules/$kernel_release/modules.builtin" > "$modules_root/modules.builtin"

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

# For modules one architecture or flavor builds in or leaves out: a built-in
# one needs nothing, a missing one gets a note. aarch64 linux-virt has no
# ext2.ko: it sets CONFIG_EXT4_USE_FOR_EXT2, and modules.alias maps fs-ext2 to
# ext4, which is how /bin/mount looks the driver up.
select_optional_module() {
    if grep -qF -m1 -- "/$1.ko.gz:" "$depfile"; then
        select_module "$1"
    elif ! grep -q -- "/$1\.ko$" "$modules_root/modules.builtin"; then
        echo "note: module $1 is not in $arch $linux_package; skipped" >&2
    fi
}

# Network: virtio-net for QEMU (init.js loads these at boot). virtio_pci is
# the PCI transport for every virtio device, disk included; linux-virt builds
# it in, linux-lts has it as a module that nothing in modules.dep pulls in.
for module in failover net_failover virtio_net; do select_module "$module"; done
select_optional_module virtio_pci
# Storage: what /bin/mount loads on demand. ext4 brings jbd2, mbcache and
# crc16; FAT, exFAT and NTFS ask the kernel for the NLS tables at mount
# time, which has no /sbin/modprobe to answer, so mount preloads them.
for module in virtio_blk ext4 vfat exfat ntfs3 nls_utf8 nls_cp437 nls_iso8859-1; do
    select_module "$module"
done
select_optional_module ext2
# Pointing devices for `bunterm --mouse`, which reads /dev/input/event*.
# evdev is the character-device interface to the input layer; psmouse drives
# the PS/2 mouse every PC and QEMU's q35 machine has. QEMU's aarch64 virt
# machine has no PS/2 port; its keyboard and pointer are virtio-input. A USB
# mouse needs the usbhid stack, which only the --real image carries. init.js
# loads these at boot; nothing reads a pointer unless bunterm is asked to.
select_module evdev
if [ "$arch" = x86_64 ]; then
    select_module psmouse
else
    select_module virtio_input
fi
# The framebuffer for bunterm. Both lts kernels set CONFIG_SYSFB_SIMPLEFB, so
# the UEFI GOP (QEMU's ramfb on aarch64 virt) becomes a simple-framebuffer
# device that only simpledrm drives: x86_64 lts builds it in, aarch64 lts has
# it as a module. init.js loads it at boot, which is what makes /dev/fb0.
if [ "$linux_flavor" = lts ]; then
    select_optional_module simpledrm
fi

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
    # driver), Qualcomm Atheros (alx), Broadcom (tg3), and USB dongles.
    # Android USB tethering commonly presents RNDIS, CDC ECM/NCM/EEM, or an
    # older CDC subset/zaurus-compatible gadget. Selecting the leaf drivers
    # recursively includes usbnet, mii, usbcore and usb-common from
    # modules.dep. cfg.net unconditionally attempts every packaged
    # kernel/drivers/net module, then matches USB and PCI modaliases.
    for module in e1000 e1000e igb igc r8169 realtek alx tg3 \
                  r8152 ax88179_178a cdc_ether rndis_host cdc_ncm cdc_eem \
                  cdc_subset zaurus; do
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

chmod 0755 "$native_dir/lib/$musl_loader"

echo "Fetched Alpine $arch linux-$linux_flavor kernel, $(wc -l < "$selected") modules, musl, and the $efi_stub UKI stub."
