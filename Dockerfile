# The fetch and build toolchain from README "Build environment", for hosts
# that do not have it natively (macOS) or would rather not install it.
# index.js --docker builds this image on first use and runs the fetch/build
# scripts inside it with the checkout bind-mounted at /src; macOS does that
# by default. The image only unpacks archives and assembles files, it never
# executes guest binaries, so its own architecture does not matter: Apple
# Silicon runs it as linux/arm64 and still builds both guests.
#
# binutils-mingw-w64-x86-64  PE-aware objcopy/objdump for the x86_64 UKI
# binutils-aarch64-linux-gnu PE-aware objcopy/objdump for the aarch64 UKI
#                            (native binutils on an arm64 host, cross on amd64)
FROM debian:13-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        binutils-aarch64-linux-gnu binutils-mingw-w64-x86-64 ca-certificates \
        cpio curl dosfstools fakeroot mtools parted unzip \
    && rm -rf /var/lib/apt/lists/*

# parted asks udev to settle after writing a partition table. build-image.sh
# only ever partitions a plain file, so a no-op stands in for the udev daemon
# a container does not run and keeps "udevadm: not found" out of the log.
RUN ln -s /bin/true /usr/local/bin/udevadm
