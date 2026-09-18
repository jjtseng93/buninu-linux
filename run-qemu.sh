#!/bin/sh
set -eu

cd "$(dirname "$0")"

test -f vda.img || ./build-image.sh

# User-mode networking is NAT: the guest can reach out, nothing reaches in
# unless a port is forwarded. PORTS lists them, space-separated, as
# host[:guest] with guest defaulting to host, e.g. PORTS="8080 2222:22".
# The host side binds to 127.0.0.1 only. A forwarded port reaches the guest
# at its eth0 address (10.0.2.15), so the service there has to listen on
# 0.0.0.0 or 10.0.2.15 — one bound to the guest's 127.0.0.1 is not reachable.
nic="user,model=virtio-net-pci"
for port in ${PORTS:-}; do
    case "$port" in
        *:*) host="${port%%:*}"; guest="${port#*:}" ;;
        *)   host="$port"; guest="$port" ;;
    esac
    nic="$nic,hostfwd=tcp:127.0.0.1:$host-:$guest"
done

exec qemu-system-x86_64 \
    -machine q35,accel=tcg \
    -cpu max \
    -m 512M \
    -drive if=pflash,format=raw,readonly=on,file="${PREFIX}/share/qemu/edk2-x86_64-code.fd" \
    -drive if=virtio,format=raw,file=vda.img \
    -nic "$nic" \
    -display none \
    -serial stdio \
    -no-reboot \
    "$@"
