# Notices

Buninu Linux is licensed under the MIT License; see `LICENSE`.

It redistributes the third-party components below under their own licenses.
The full license texts are in `LICENSES/`. Every SHA-256 here was checked
byte-for-byte against the official Alpine Linux v3.24 x86_64 package (or the
official Bun release) it came from.

Alpine's CDN serves only the current pkgrel of each branch, so the package
URLs below stop working once a build is superseded. The pinned aports commits
are permanent and are the Corresponding Source for each exact build.

## Components tracked in this repository

These files are committed under `initramfs/lib/`.

### ld-musl-x86_64.so.1 and libc.musl-x86_64.so.1

- License: MIT
- See: `LICENSES/musl-COPYRIGHT.txt`

The musl C library and dynamic loader, version 1.2.6, as packaged by Alpine
Linux 3.24 (package `musl`, version 1.2.6-r2, x86_64). The two files are
byte-identical; the second is a separate copy so that `bun:ffi` can `dlopen`
libc without touching the inode that is already acting as Bun's loader (see
`README.md`).

- Upstream source: https://musl.libc.org/releases/musl-1.2.6.tar.gz
- Alpine build recipe (Corresponding Source), pinned to the commit shipping
  pkgrel=2:
  https://gitlab.alpinelinux.org/alpine/aports/-/blob/f5640d3a10f664c9119720c60515265d3d6f6d01/main/musl/APKBUILD
- Package: https://dl-cdn.alpinelinux.org/alpine/v3.24/main/x86_64/musl-1.2.6-r2.apk
  SHA-256 `573712e2f49c15bfc20a2699f204acdfc74c772722b15e7353d768057fae0e71`

SHA-256 of the shipped files:

```text
ld-musl-x86_64.so.1   38d022ce7425ff105ccfb53598f606e6e5f5f0a34bfbc793d65e6f34c9d72806
libc.musl-x86_64.so.1 38d022ce7425ff105ccfb53598f606e6e5f5f0a34bfbc793d65e6f34c9d72806
```

### libgcc_s.so.1 and libstdc++.so.6

- License: GPL-3.0-or-later WITH GCC-exception-3.1
- See: `LICENSES/GPL-3.0.txt` and `LICENSES/GCC-Runtime-Library-Exception-3.1.txt`

The GCC runtime support library and the GNU C++ standard library, built from
GCC 15.2.0, as packaged by Alpine Linux 3.24 (packages `libgcc` and
`libstdc++`, version 15.2.0-r5, x86_64). `libstdc++.so.6` is the package's
`libstdc++.so.6.0.34` under its SONAME.

The GCC Runtime Library Exception is what allows these libraries to be linked
into the MIT-licensed Bun binary without placing Bun under the GPL. Alpine's
package metadata labels the whole `gcc` build `GPL-2.0-or-later AND
LGPL-2.1-or-later`; the license stated above is the one carried by the runtime
libraries' own sources.

- Upstream source: https://gcc.gnu.org/pub/gcc/releases/gcc-15.2.0/gcc-15.2.0.tar.xz
- Alpine build recipe and patches (Corresponding Source), pinned to the commit
  shipping pkgrel=5:
  https://gitlab.alpinelinux.org/alpine/aports/-/blob/fd4fecacbfd0cd40be42efa3c9d72bc03a88428c/main/gcc/APKBUILD
- Packages:
  https://dl-cdn.alpinelinux.org/alpine/v3.24/main/x86_64/libgcc-15.2.0-r5.apk
  SHA-256 `393dcd32629f06d7d85409c272d142d0c082772d10b87ef55ee82f47de3be637`
  https://dl-cdn.alpinelinux.org/alpine/v3.24/main/x86_64/libstdc++-15.2.0-r5.apk
  SHA-256 `14c987b556f5385a5db18376e788c75f37d85321b8dc1920d926ea7daac1d6f6`

SHA-256 of the shipped files:

```text
libgcc_s.so.1    5ea51dd885b6fc691eccc569d0bda739204204f6161e97075b26dc9c050d1ca1
libstdc++.so.6   67a940194aec6c44c3eb47a98e44c53d248e4dac5f4eb57c0971c0d6286eafe5
```

## Components fetched at build time

These are not committed (see `.gitignore`). `fetch-plus-build.sh` downloads each
one, verifies the SHA-256 pinned in `fetch-alpine.sh` / `fetch-bun.sh`,
and packs it into the UKI and the disk image. They are listed here because
the built image redistributes them.

### Linux kernel: vmlinuz-virt, failover.ko, net_failover.ko, virtio_net.ko

- License: GPL-2.0-only WITH Linux-syscall-note
- See: `LICENSES/GPL-2.0.txt` and `LICENSES/Linux-syscall-note.txt`

Linux 6.18.52 with Alpine's `virt` configuration, as packaged by Alpine Linux
3.24 (package `linux-virt`, version 6.18.52-r0, x86_64, from the `linux-lts`
aport). The three modules are the package's `.ko.gz` files decompressed.

- Upstream source: https://cdn.kernel.org/pub/linux/kernel/v6.x/linux-6.18.52.tar.xz
- Alpine build recipe, configuration and patches (Corresponding Source),
  pinned to the commit shipping 6.18.52-r0:
  https://gitlab.alpinelinux.org/alpine/aports/-/blob/09a165f4c951edf370eddde03b2d1d5fd71805ed/main/linux-lts/APKBUILD
- Package: https://dl-cdn.alpinelinux.org/alpine/v3.24/main/x86_64/linux-virt-6.18.52-r0.apk
  SHA-256 `dff0c365a6d6c0fd015175af08dca0c39048fa39df6ef3150a7ea88d2cfdfa4f`

SHA-256 of the shipped files:

```text
kernel/vmlinuz-virt   40f620bc8c93d952e57dd8dfc0f94fca1759d192a4fc4a260705d50ca378559c
failover.ko           9637a7ce60a3d8369fa0aabff4dd365c6864d8b81cb85eb6d4fcfef799fe1532
net_failover.ko       9fe81eb66429aebb33c7cb2f177dcfcd1e3084b466b715e58f131411954948e3
virtio_net.ko         913a0d5baf407a5d8fe4a97ccc5f1ef40f27d458a1947b562961aeabe6906397
```

### linuxx64.efi.stub

- License: LGPL-2.1-or-later
- See: `LICENSES/LGPL-2.1.txt`

systemd's UEFI boot stub, version 260.2, as packaged by Alpine Linux 3.24
(package `systemd-efistub`, version 260.2-r0, x86_64, from the `systemd-boot`
aport). The UKI is this stub with the kernel, initramfs, command line and
`os-release` appended as PE sections.

- Upstream source: https://github.com/systemd/systemd/archive/refs/tags/v260.2.tar.gz
- Alpine build recipe (Corresponding Source), pinned to the commit shipping
  260.2-r0:
  https://gitlab.alpinelinux.org/alpine/aports/-/blob/c329463d3dbe6b28360180706f843e605c97575b/main/systemd-boot/APKBUILD
- Package: https://dl-cdn.alpinelinux.org/alpine/v3.24/main/x86_64/systemd-efistub-260.2-r0.apk
  SHA-256 `8e64a5a3afee5f930e6e6716be726dc6d405530ac7f8fa5be6251dae68671ec9`

SHA-256 of the shipped file:

```text
kernel/linuxx64.efi.stub   b9d1e11d11aa7137f9b1d24b530fac00daf58bfcf3a852267ccaec297492c6d3
```

### bun

- License: MIT, with bundled components under their own licenses
- See: `LICENSES/Bun-LICENSE.md` (Bun's `LICENSE.md` at tag `bun-v1.4.2`,
  which lists the licenses of everything statically linked into the binary,
  including JavaScriptCore)

Bun 1.4.2, the official `linux-x64-musl-baseline` release binary. For this
release the `-baseline` and plain `linux-x64-musl` archives contain the same
`bun` executable; Bun ships one x64 build and keeps the `-baseline` name as an
alias.

- Upstream source: https://github.com/oven-sh/bun/tree/bun-v1.4.2
- Release archive: https://github.com/oven-sh/bun/releases/download/bun-v1.4.2/bun-linux-x64-musl-baseline.zip
  SHA-256 `76e1db84e98f22f78de0a87e309bfbbf297732847f9720db36750646c85c8c18`

SHA-256 of the shipped file:

```text
initramfs/bin/bun   16b72935ffd7a503b978c186874539c92aade4e3515b70a5abf5db2581fdef7d
```
