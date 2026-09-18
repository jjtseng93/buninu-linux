#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

cd "$(dirname "$0")"

mkdir -p vda/EFI/BOOT
test -s vda/EFI/BOOT/BOOTX64.EFI || {
    echo "error: build stage: no EFI payload yet; run ./build-uki.sh (./index.js -b) or ./hello/build-hello.sh first" >&2
    exit 1
}

# Create a standalone FAT32 filesystem, populate it with mtools, then insert
# it into a GPT disk.  No mount, loop device, or root privilege is required.
for required_tool in parted mkfs.fat mmd mcopy; do
    command -v "$required_tool" >/dev/null || {
        echo "error: build stage needs $required_tool; run inside PRoot, see README section 0" >&2
        exit 1
    }
done

temporary_esp="$(mktemp --tmpdir=. .esp.XXXXXX.img)"
trap 'rm -f "$temporary_esp"' EXIT

disk_sectors=$((128 * 1024 * 1024 / 512))
esp_start=2048
esp_end=$((disk_sectors - 34))
esp_sectors=$((esp_end - esp_start + 1))

truncate -s $((esp_sectors * 512)) "$temporary_esp"
mkfs.fat -F 32 -h "$esp_start" -n EFIBOOT "$temporary_esp" >/dev/null
mmd -i "$temporary_esp" ::/EFI ::/EFI/BOOT
mcopy -i "$temporary_esp" vda/EFI/BOOT/BOOTX64.EFI ::/EFI/BOOT/BOOTX64.EFI

rm -f vda.img
truncate -s $((disk_sectors * 512)) vda.img
parted -s vda.img mklabel gpt
parted -s vda.img unit s mkpart ESP fat32 "${esp_start}s" "${esp_end}s"
parted -s vda.img set 1 esp on

dd if="$temporary_esp" of=vda.img bs=512 \
    seek="$esp_start" count="$esp_sectors" \
    conv=notrunc,sparse status=none

echo "Packed vda/EFI/BOOT/BOOTX64.EFI into vda.img"
