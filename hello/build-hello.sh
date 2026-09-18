#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p vda/EFI/BOOT

clang --target=x86_64-pc-win32-coff \
    -ffreestanding -fshort-wchar -mno-red-zone -Wall -Wextra -Werror \
    -c hello/hello.c -o hello/hello.obj

lld-link /subsystem:efi_application /entry:efi_main /nodefaultlib \
    /machine:x64 /out:vda/EFI/BOOT/BOOTX64.EFI hello/hello.obj

echo "Built hello EFI at vda/EFI/BOOT/BOOTX64.EFI"
