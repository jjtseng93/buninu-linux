# Notices

Buninu Linux is licensed under the MIT License; see `LICENSE`.

It redistributes the third-party components below under their own licenses.
The full license texts are in `LICENSES/`. Every SHA-256 here was checked
byte-for-byte against the official Alpine Linux v3.24 x86_64 package (or the
official Bun release) it came from.

The sections below cover the platform: the kernel, the C library, the GCC
runtime, the UEFI stub and Bun. The Buninu userspace under `initramfs/buninu/`
carries its own third-party notices; see the last section.

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
  the packages record in their `.PKGINFO` (`commit = 423a8ad…`; the follow-up
  `fd4fecac…` keeps pkgrel=5 and changes only packaging metadata):
  https://gitlab.alpinelinux.org/alpine/aports/-/blob/423a8ad043d07f2c7546c8ec3e2b0384cda360ae/main/gcc/APKBUILD
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

### Linux kernels and modules

- License: GPL-2.0-only WITH Linux-syscall-note
- See: `LICENSES/GPL-2.0.txt` and `LICENSES/Linux-syscall-note.txt`

Linux 6.18.52 as packaged by Alpine Linux 3.24 from the `linux-lts` aport.
The default build uses package `linux-virt`, version 6.18.52-r0, x86_64.
`--linux-lts` and `--real` use package `linux-lts`, version 6.18.52-r0,
x86_64. All listed modules are the selected package's `.ko.gz` files
decompressed without modification.

- Upstream source: https://cdn.kernel.org/pub/linux/kernel/v6.x/linux-6.18.52.tar.xz
- Alpine build recipe, configuration and patches (Corresponding Source),
  pinned to the commit shipping 6.18.52-r0:
  https://gitlab.alpinelinux.org/alpine/aports/-/blob/09a165f4c951edf370eddde03b2d1d5fd71805ed/main/linux-lts/APKBUILD
- Packages:
  https://dl-cdn.alpinelinux.org/alpine/v3.24/main/x86_64/linux-virt-6.18.52-r0.apk
  SHA-256 `dff0c365a6d6c0fd015175af08dca0c39048fa39df6ef3150a7ea88d2cfdfa4f`
  https://dl-cdn.alpinelinux.org/alpine/v3.24/main/x86_64/linux-lts-6.18.52-r0.apk
  SHA-256 `bd81f00522a7c7deb96886811a087c453d48530c0c8f742412ad73e24236037c`

SHA-256 of files in the default `linux-virt` image:

```text
kernel/vmlinuz-virt   40f620bc8c93d952e57dd8dfc0f94fca1759d192a4fc4a260705d50ca378559c
failover.ko           9637a7ce60a3d8369fa0aabff4dd365c6864d8b81cb85eb6d4fcfef799fe1532
net_failover.ko       9fe81eb66429aebb33c7cb2f177dcfcd1e3084b466b715e58f131411954948e3
virtio_net.ko         913a0d5baf407a5d8fe4a97ccc5f1ef40f27d458a1947b562961aeabe6906397
```

SHA-256 of files in a `--linux-lts` image:

```text
kernel/vmlinuz-lts          9a52d8cfe1c2d03a550405d1024de213376e1cacfc93081beeb8250456ca2c1f
failover.ko                 e1c82e9e63d5d402cadcf8fe94541919edeaf5987357675d0a33c07f6625d8e0
net_failover.ko             821bc61da636ffe0f7f0a89a1c63c5c9bbf732c744fcddd3354988849034c14f
virtio_net.ko               f207df3fe605c763def3a8a01117d5f5f122117aa552a24c2df9a01259fb2a4b
virtio_ring.ko              5c086ab5cc80ed21daea85d053e9cca969f024cb40e9a515d75a601be4593433
virtio.ko                   09f27668ca0e0a0405843cdfa8a9f395e5150f56447fe5f00957081a2b5c2f1e
virtio_pci_legacy_dev.ko    eff57bee4697f7212bc1535802daefeec450adaaad6400dede197d14ef463fdc
virtio_pci_modern_dev.ko    556a99dde723a42fd6ab23a99e43d2ffd956432ada960ad24d7122d33d4b0f72
virtio_pci.ko               3597dd05819e027402b2efe0b1c1d3bba80dca6116692ae78819768f212704f1
```

`--real` additionally includes the following modules from that same
`linux-lts` package for physical xHCI controllers and USB HID keyboards:

```text
usb-common.ko               cc121fdf8efb9d9db4e15717745fe09248f903d4948f9df806b913177e0e3c66
usbcore.ko                  1959bb44e32c8e1c071012a0e61e94c3d30db7e66c225f5adbe2987fff693105
xhci-hcd.ko                 cc4b561dda02a23bd4c6d11a58ba973bcaf6719c3771f4ee948a232fe2d8f5bf
xhci-pci.ko                 5911a1368deadf9b02e75c9e5d3549e0bd17f8f364e9e54c4b03a66b77c03361
xhci-pci-renesas.ko         2182381b58e5e2eba8cf7d305f4db7af31582c3c13826e70c7afcf2394a076e7
hid.ko                      d1a79b51bb1a7e77548985d4e6ad3d9c36d2718bb9f394ebbeeb5267d484f788
hid-generic.ko              c9933c253b4870bb9578f3950e2daf7cdcb6808837a1b351c3bdd6dde26fd649
usbhid.ko                   330d5355437e3bf8bf63ccae0692859b05edc66d991e2d2d6bac22e0e39f79da
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

## Buninu userspace

`initramfs/buninu/` is the Buninu userspace (version 0.4.12, MIT; see
`initramfs/buninu/LICENSE`), copied verbatim from
https://github.com/jjtseng93/buninu and packed whole into the initramfs. It
bundles third-party material that is documented next to the files that use
it rather than repeated here:

| Path | What it covers |
|---|---|
| `initramfs/buninu/apps/musl-la/NOTICE` | Three aarch64 binaries committed in this repository and shipped in the image: `ld-musl-aarch64.so.1` (musl 1.2.5, MIT) and `libgcc_s.so.1` / `libstdc++.so.6` (GCC 14.2.0, GPL-3.0-or-later WITH GCC-exception-3.1), with SHA-256 and Corresponding Source. License texts in `LICENSE_musl.txt` and `LICENSES/`. |
| `initramfs/buninu/apps/jsgotty/NOTICE` and `LICENSE` | js-gotty, an MIT derivative of gotty (Iwasaki Yudai, Søren L. Hansen); bundles `zmodem.js` (Apache-2.0, `LICENSES/Apache-2.0-zmodem.js.txt`). `static/js/gotty.licenses.txt` lists the licenses of everything in the browser bundle (xterm.js and its addons, preact, bootstrap, …), `node_modules/*/LICENSE*` cover `ws` and `node-addon-api`, and `patches/` carries patched files from `node-pty` (MIT, headers kept). |
| `initramfs/buninu/apps/jsmdcui/LICENSE` and `runtime/syntax/LICENSE` | jsmdcui, an MIT derivative of the micro editor (Zachary Yedidia et al.); the syntax and colorscheme files are micro's, MIT. |
| `initramfs/buninu/apps/bunmsh/LICENSE`, `LICENSE-MICRO`, `LICENSE-MKSH` | bunmsh (MIT) and the terms for what it derives from micro's syntax rules and from the MirBSD Korn Shell. |
