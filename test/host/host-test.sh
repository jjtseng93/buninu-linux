#!/usr/bin/env bash
# Builds and boots both guests on a fresh Debian 13 host of either CPU, in
# Docker:
#
#   test/host/host-test.sh [amd64|arm64]
#
# The platform defaults to this machine's own CPU; the other one runs
# emulated and takes a few times longer. The container (./Dockerfile) has the
# README's build packages and QEMU. It clones the committed HEAD of this
# checkout, so uncommitted changes to the project are not tested, then builds
# with the host toolchain rather than --docker and boots each guest through
# boot-test.exp. The exit status is 0 only when every step passed.
#
#   GUESTS="aarch64"         which guests to test (default: x86_64 aarch64)
#   BUILD_FLAGS=--linux-lts  extra flags for the build stage
#   BOOT_TIMEOUT=900         seconds to wait for the REPL
#   ALPINE_MIRROR=...        passed through to the fetch stage
#
# downloads/ is mounted read-only as a cache; running `./index.js -f --arch
# <arch>` here first saves the container from downloading.
set -euo pipefail

cd "$(dirname "$0")/../.."

case "${1:-$(uname -m)}" in
    amd64 | x86_64) platform=amd64 ;;
    arm64 | aarch64) platform=arm64 ;;
    *)
        echo "usage: $0 [amd64|arm64]" >&2
        exit 2
        ;;
esac

image="buninu-linux-hosttest:$platform"
echo "### building $image (the first build takes a few minutes)"
docker build --quiet --platform "linux/$platform" --tag "$image" test/host > /dev/null

# A Linux host's KVM reaches the container too, so a guest that matches the
# platform runs accelerated. Docker Desktop on macOS exposes no /dev/kvm.
kvm_device=
if [ -e /dev/kvm ]; then kvm_device=--device=/dev/kvm; fi

mkdir -p downloads
# $kvm_device is empty or a single word.
exec docker run --rm --platform "linux/$platform" $kvm_device \
    --mount "type=bind,src=$PWD,dst=/repo,readonly" \
    --mount "type=bind,src=$PWD/downloads,dst=/cache,readonly" \
    --env GUESTS --env BUILD_FLAGS --env BOOT_TIMEOUT --env ALPINE_MIRROR \
    "$image" /repo/test/host/in-container.sh
