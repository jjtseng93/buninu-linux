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

mkdir -p downloads kernel initramfs/lib \
    "initramfs/lib/modules/$kernel_release/kernel/net/core" \
    "initramfs/lib/modules/$kernel_release/kernel/drivers/net"

. ./scripts/fetch.sh

fetch "$base/$linux_package" "$linux_package" "$linux_sha256"
fetch "$base/$musl_package" "$musl_package" "$musl_sha256"
fetch "$base/$stub_package" "$stub_package" "$stub_sha256"

tar --warning=no-unknown-keyword -xOf "downloads/$linux_package" \
    "boot/vmlinuz-$linux_flavor" > "kernel/vmlinuz-$linux_flavor"
tar --warning=no-unknown-keyword -xOf "downloads/$musl_package" \
    lib/ld-musl-x86_64.so.1 > initramfs/lib/ld-musl-x86_64.so.1
tar --warning=no-unknown-keyword -xOf "downloads/$stub_package" \
    usr/lib/systemd/boot/efi/linuxx64.efi.stub > kernel/linuxx64.efi.stub
tar --warning=no-unknown-keyword -xOf "downloads/$linux_package" \
    "lib/modules/$kernel_release/kernel/net/core/failover.ko.gz" \
    | gzip -dc > "initramfs/lib/modules/$kernel_release/kernel/net/core/failover.ko"
tar --warning=no-unknown-keyword -xOf "downloads/$linux_package" \
    "lib/modules/$kernel_release/kernel/drivers/net/net_failover.ko.gz" \
    | gzip -dc > "initramfs/lib/modules/$kernel_release/kernel/drivers/net/net_failover.ko"
tar --warning=no-unknown-keyword -xOf "downloads/$linux_package" \
    "lib/modules/$kernel_release/kernel/drivers/net/virtio_net.ko.gz" \
    | gzip -dc > "initramfs/lib/modules/$kernel_release/kernel/drivers/net/virtio_net.ko"

chmod 0755 initramfs/lib/ld-musl-x86_64.so.1

echo "Fetched Alpine linux-$linux_flavor kernel, virtio-net modules, musl, and the x64 UKI stub."
