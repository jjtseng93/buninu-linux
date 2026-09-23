# The "ordinary Debian 13 machine" host-test.sh builds and boots the guests on:
# the README's build packages for both guests, QEMU with OVMF and AAVMF, node
# to run index.js, git to clone the checkout and expect to drive the serial
# console. Built for linux/amd64 or linux/arm64, whichever host is simulated.
FROM debian:13-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      binutils-mingw-w64-x86-64 binutils-aarch64-linux-gnu cpio curl dosfstools fakeroot mtools parted unzip \
      ca-certificates git nodejs expect \
      qemu-system-x86 ovmf qemu-system-arm qemu-efi-aarch64 \
    && rm -rf /var/lib/apt/lists/*

# parted asks udev to settle after writing a partition table; see ../../Dockerfile.
RUN ln -s /bin/true /usr/local/bin/udevadm
