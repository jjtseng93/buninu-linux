#!/bin/sh
set -eu

cd "$(dirname "$0")"

test -f vda.img || ./build-image.sh

if [ -z "$PREFIX" ] ; then
  PREFIX=/usr
fi

ovmf_filepath="$PREFIX"/share/qemu/edk2-x86_64-code.fd

if [ -f /usr/share/OVMF/OVMF_CODE_4M.fd ] ; then
  ovmf_filepath=/usr/share/OVMF/OVMF_CODE_4M.fd
elif [ -f "$OVMF_FILE" ] ; then
  ovmf_filepath=$OVMF_FILE
fi

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

exec qemu-system-x86_64 \
    -machine q35,accel=tcg \
    -cpu max \
    -m 512M \
    -drive if=pflash,format=raw,readonly=on,file="$ovmf_filepath" \
    -drive if=virtio,format=raw,file=vda.img \
    -nic "$nic" \
    -display none \
    -serial stdio \
    -no-reboot \
    "$@"
