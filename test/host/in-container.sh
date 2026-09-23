#!/usr/bin/env bash
# Runs inside the container host-test.sh starts: an ordinary Debian 13 machine
# of the chosen CPU. Clones the committed HEAD of the checkout mounted at
# /repo, builds each guest with the host toolchain (no --docker), boots it
# through boot-test.exp, and checks that the builds leave git status clean.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
guests=${GUESTS:-x86_64 aarch64}
kvm=no
if [ -r /dev/kvm ] && [ -w /dev/kvm ]; then kvm=yes; fi
echo "### host: $(uname -sm), node $(node --version), /dev/kvm: $kvm"

git config --global --add safe.directory '*'
git clone --quiet /repo /work
echo "### testing $(git -C /work log -1 --format='%h %s')"
# /cache is the host's downloads/, read-only; every file in it is still
# checked against its pinned SHA-256, and anything missing is fetched.
mkdir -p /work/downloads
cp -R /cache/. /work/downloads/
cd /work

strip_ansi() { sed 's/\x1b\[[0-9;?]*[a-zA-Z]//g' | tr -d '\r'; }

status=0
for guest in $guests; do
    echo "### $guest: fetch + build ${BUILD_FLAGS:-}"
    log=/tmp/build-$guest.log
    # BUILD_FLAGS is split on purpose: it holds flags such as --linux-lts.
    if node ./index.js -fb --arch "$guest" ${BUILD_FLAGS:-} > "$log" 2>&1; then
        grep -E '^==>|^Fetched|^Built|^Packed|^note' "$log" || true
    else
        echo "### FAIL: $guest build; last lines:"
        tail -n 30 "$log"
        status=1
        continue
    fi

    echo "### $guest: boot"
    log=/tmp/boot-$guest.log
    if expect "$here/boot-test.exp" /work "$guest" "${BOOT_TIMEOUT:-900}" > "$log" 2>&1; then
        strip_ansi < "$log" | grep -a -E '^run-qemu.sh:|^network: eth0|^fetch example|^### ' || true
    else
        strip_ansi < "$log" | grep -a -E '^run-qemu.sh:|^### ok' || true
        echo "### FAIL: $guest boot; last lines:"
        strip_ansi < "$log" | tail -n 40
        status=1
    fi
done

echo "### git status after the builds (should be empty):"
if [ -n "$(git status --porcelain)" ]; then
    git status --short
    status=1
fi

if [ "$status" = 0 ]; then echo "### PASS"; else echo "### FAIL"; fi
exit "$status"
