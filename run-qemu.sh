#!/bin/sh
set -eu

cd "$(dirname "$0")"

test -f vda.img || ./build-image.sh

exec qemu-system-x86_64 \
    -machine q35,accel=tcg \
    -cpu max \
    -m 512M \
    -drive if=pflash,format=raw,readonly=on,file="${PREFIX}/share/qemu/edk2-x86_64-code.fd" \
    -drive if=virtio,format=raw,file=vda.img \
    -nic user,model=virtio-net-pci \
    -display none \
    -serial stdio \
    -no-reboot \
    "$@"
