# Sourced by the fetch, build and run scripts; not executable on its own.
#
# Everything that differs between the two guest architectures lives here:
# the pinned packages and their SHA-256, the file names inside them, the EFI
# removable-media name, the PE-aware objcopy that assembles the UKI and the
# serial console. BUNINU_ARCH (index.js --arch) picks one; x86_64 is the
# default. LINUX_FLAVOR (virt or lts) and REAL_MACHINE are read here too.
#
# Fetched and extracted files are kept per architecture, so both guests can
# be built from one checkout without refetching:
#
#   downloads/<arch>/  the pinned archives (both repos use the same names)
#   kernel/<arch>/     vmlinuz-<flavor> and the UKI stub
#   native/<arch>/     bun, musl, libgcc/libstdc++ and kernel modules;
#                      scripts/pack-initramfs.sh lays it over initramfs/

case "${BUNINU_ARCH:-x86_64}" in
    x86_64 | amd64 | x64) arch=x86_64 ;;
    aarch64 | arm64) arch=aarch64 ;;
    *)
        echo "error: unsupported BUNINU_ARCH=$BUNINU_ARCH (use x86_64 or aarch64)" >&2
        exit 1
        ;;
esac

linux_flavor=${LINUX_FLAVOR:-virt}
case $linux_flavor in
    virt | lts) ;;
    *)
        echo "error: unsupported LINUX_FLAVOR=$linux_flavor (use virt or lts)" >&2
        exit 1
        ;;
esac

if [ "${REAL_MACHINE:-}" = 1 ] && [ "$arch" != x86_64 ]; then
    echo "error: --real images are x86_64 only; its module set is PC hardware" >&2
    exit 1
fi

# The Alpine repository keeps only the newest build of a package, so a pin
# stops downloading when Alpine bumps it; the hashes below then fail loudly
# rather than silently taking the new build. ALPINE_MIRROR swaps the host for
# a closer mirror; the SHA-256 check is the same either way.
alpine_mirror=${ALPINE_MIRROR:-https://dl-cdn.alpinelinux.org/alpine}
alpine_base="$alpine_mirror/v3.24/main/$arch"

kernel_version=6.18.53
kernel_release="$kernel_version-0-$linux_flavor"
linux_package="linux-$linux_flavor-$kernel_version-r0.apk"
musl_package=musl-1.2.6-r2.apk
stub_package=systemd-efistub-260.2-r0.apk
libstdcpp_package=libstdc++-15.2.0-r5.apk
libgcc_package=libgcc-15.2.0-r5.apk
bun_version=1.4.2

downloads_dir="downloads/$arch"
kernel_dir="kernel/$arch"
kernel_image="$kernel_dir/vmlinuz-$linux_flavor"
native_dir="native/$arch"
modules_root="$native_dir/lib/modules/$kernel_release"
musl_loader="ld-musl-$arch.so.1"
musl_libc="libc.musl-$arch.so.1"

case $arch in
    x86_64)
        linux_virt_sha256=cad859cc46342e18002621fdde166bf2cd520dfec5e781d241de7d13e53970d6
        linux_lts_sha256=8e3cfdd1d98e0e70c2e70a8c299ed3cd1e0939d60ad7bbd1da1cf241d794490b
        musl_sha256=573712e2f49c15bfc20a2699f204acdfc74c772722b15e7353d768057fae0e71
        stub_sha256=8e64a5a3afee5f930e6e6716be726dc6d405530ac7f8fa5be6251dae68671ec9
        libstdcpp_sha256=14c987b556f5385a5db18376e788c75f37d85321b8dc1920d926ea7daac1d6f6
        libgcc_sha256=393dcd32629f06d7d85409c272d142d0c082772d10b87ef55ee82f47de3be637
        # Bun ships one x64 musl build; -baseline is an alias (NOTICE.md).
        bun_build=bun-linux-x64-musl-baseline
        bun_sha256=76e1db84e98f22f78de0a87e309bfbbf297732847f9720db36750646c85c8c18
        efi_stub=linuxx64.efi.stub
        efi_boot_name=BOOTX64.EFI
        uki_objcopy=x86_64-w64-mingw32-objcopy
        uki_objdump=x86_64-w64-mingw32-objdump
        uki_binutils_package=binutils-mingw-w64-x86-64
        # COM1 on q35 and on PCs.
        serial_console=ttyS0
        serial_major=4
        ;;
    aarch64)
        linux_virt_sha256=fea61b7fd5e72e626d771f9798df56c83db658d0e221044f06fc28aacf5a118b
        linux_lts_sha256=46885041022ea11afa1e07c40199c74146bf72d362368a844338af0c162e365c
        musl_sha256=5e9674b7f41152fe2119093b5cb4c13eaaadb19c2d5422b2d7267913e663ee6e
        stub_sha256=a1823d2d7082db555d528f82c1809f276c818aeb5b40f198f4565f104e055c38
        libstdcpp_sha256=2302e766d4e4926038ec166ecb85837ee884576115236ddb565e3a5fca4a11d7
        libgcc_sha256=369aaa6e9d099a737bad6dd3e6c2fe7bb1547ca26d22b94ee0411228f709b403
        bun_build=bun-linux-aarch64-musl
        bun_sha256=71760b6c8ea30623b81a4907cb815d48e2ea266f2e73e751534a44a0607950df
        efi_stub=linuxaa64.efi.stub
        efi_boot_name=BOOTAA64.EFI
        # The aarch64 ELF binutils also read and write pei-aarch64-little:
        # native binutils on an arm64 Debian, the cross package on amd64.
        uki_objcopy=aarch64-linux-gnu-objcopy
        uki_objdump=aarch64-linux-gnu-objdump
        uki_binutils_package=binutils-aarch64-linux-gnu
        # The PL011 UART of QEMU's virt machine.
        serial_console=ttyAMA0
        serial_major=204
        ;;
esac

if [ "$linux_flavor" = lts ]; then
    linux_sha256=$linux_lts_sha256
else
    linux_sha256=$linux_virt_sha256
fi

bun_zip="$bun_build-$bun_version.zip"
bun_url="https://github.com/oven-sh/bun/releases/download/bun-v$bun_version/$bun_build.zip"
