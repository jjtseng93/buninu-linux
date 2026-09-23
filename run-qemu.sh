#!/bin/sh

cd "$(dirname "$0")"

# The guest is whatever build-uki.sh last put in vda/EFI/BOOT (it leaves only
# one architecture there), unless BUNINU_ARCH (index.js --arch) names one.
if [ -z "$BUNINU_ARCH" ] && [ -f vda/EFI/BOOT/BOOTAA64.EFI ]; then
    BUNINU_ARCH=aarch64
fi
. ./scripts/arch.sh

test -f vda.img || ./build-image.sh || exit 1
test -f "vda/EFI/BOOT/$efi_boot_name" || {
    echo "error: vda.img holds no $arch UKI; build one with ./index.js -b --arch $arch" >&2
    exit 1
}

qemu="qemu-system-$arch"
command -v "$qemu" >/dev/null || {
    echo "error: $qemu not found (macOS: brew install qemu; Debian: apt install qemu-system)" >&2
    exit 1
}

case $arch in
    x86_64) machine=q35 distro_firmware=/usr/share/OVMF/OVMF_CODE_4M.fd ;;
    aarch64) machine=virt distro_firmware=/usr/share/AAVMF/AAVMF_CODE.fd ;;
esac

# UEFI firmware: OVMF_FILE if set; then the edk2 build QEMU ships next to its
# own binary (Termux's $PREFIX/share/qemu, Homebrew's share/qemu, ...); then
# the distribution packages (Debian ovmf / qemu-efi-aarch64).
qemu_share="$(dirname "$(command -v "$qemu")")/../share/qemu"
ovmf_filepath=
for candidate in "$OVMF_FILE" "$distro_firmware" "$qemu_share/edk2-$arch-code.fd" \
    "/usr/share/qemu/edk2-$arch-code.fd"; do
    if [ -n "$candidate" ] && [ -f "$candidate" ]; then
        ovmf_filepath=$candidate
        break
    fi
done
test -n "$ovmf_filepath" || {
    echo "error: no $arch UEFI firmware found; set OVMF_FILE to an edk2-$arch-code.fd" >&2
    exit 1
}

# Hardware acceleration needs the guest to match the host CPU: KVM on Linux,
# Hypervisor.framework on macOS (Apple Silicon runs the aarch64 guest natively,
# an Intel Mac the x86_64 one). Anything else, such as the x86_64 guest on
# Apple Silicon or on an Android phone, is emulated with TCG. ACCEL overrides
# the choice, e.g. ACCEL=tcg to rule acceleration out while debugging.
case "$(uname -m)" in
    arm64 | aarch64) host_arch=aarch64 ;;
    *) host_arch=$(uname -m) ;;
esac
if [ -z "$ACCEL" ]; then
    ACCEL=tcg
    if [ "$host_arch" = "$arch" ]; then
        case "$(uname -s)" in
            Linux) [ -r /dev/kvm ] && [ -w /dev/kvm ] && ACCEL=kvm ;;
            Darwin) [ "$(sysctl -n kern.hv_support 2>/dev/null)" = 1 ] && ACCEL=hvf ;;
        esac
    fi
fi
# TCG emulates every feature it knows; KVM and HVF pass the host CPU through.
if [ "$ACCEL" = tcg ]; then cpu=max; else cpu=host; fi
echo "run-qemu.sh: $arch guest on $machine, accel=$ACCEL, firmware $ovmf_filepath" >&2

# User-mode networking is NAT: the guest can reach out, nothing reaches in
# unless a port is forwarded. PORTS lists them, space-separated, as
# host[:guest] with guest defaulting to host, e.g. PORTS="8080 2222:22".
# The host side binds to 127.0.0.1 only. A forwarded port reaches the guest
# at its eth0 address (10.0.2.15), so the service there has to listen on
# 0.0.0.0 or 10.0.2.15 — one bound to the guest's 127.0.0.1 is not reachable.
nic="user,model=virtio-net-pci"
for port in ${PORTS:-}; do
    # Both expansions return the whole word when there is no colon, so a bare
    # "8080" maps to itself without a case statement.
    host="${port%%:*}"
    guest="${port#*:}"
    nic="$nic,hostfwd=tcp:127.0.0.1:$host-:$guest"
done

exec "$qemu" \
    -machine "$machine,accel=$ACCEL" \
    -cpu "$cpu" \
    -m 1G \
    -drive if=pflash,format=raw,readonly=on,file="$ovmf_filepath" \
    -drive if=virtio,format=raw,file=vda.img \
    -nic "$nic" \
    -display none \
    -serial stdio \
    -no-reboot \
    "$@"
