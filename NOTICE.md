# Notices

Buninu Linux is licensed under the MIT License; see `LICENSE`.

It redistributes the third-party components below under their own licenses.
Platform license texts are in `LICENSES/`; npm application licenses and
notices also remain inside their installed package directories, as listed
below. Platform SHA-256 values here were checked
byte-for-byte against the official Alpine Linux v3.24 x86_64 or aarch64
package (or the official Bun release) it came from. The x86_64 guest is the
default build; `--arch aarch64` builds the other one from the same versions.

The sections below cover the platform, fetched npm applications and graphics
resources. The Buninu userspace under `initramfs/buninu/`
carries its own third-party notices; see the last section.

Alpine's CDN serves only the current pkgrel of each branch, so the package
URLs below stop working once a build is superseded. The pinned aports commits
are permanent and are the Corresponding Source for each exact build.

## Optional GPU firmware

Images whose kernel packages PC GPU modules also bundle the unmodified firmware
files from Alpine v3.24 `linux-firmware-{amdgpu,i915,nvidia,radeon,xe}`
`20260519-r0` (x86_64 APKs). URLs use
`https://dl-cdn.alpinelinux.org/alpine/v3.24/main/x86_64/`; exact archive filenames
and SHA-256 values are in `scripts/gpu-firmware.json`.
The Alpine recipe is aports commit `0d703a66341886130fe4e46c51cd4f161d8b96b8`,
`main/linux-firmware/APKBUILD`; upstream is
<https://gitlab.com/kernel-firmware/linux-firmware/-/tree/20260519>.
Redistribution terms differ by firmware. The upstream `WHENCE` inventory and
`LICENSE.amdgpu`, `LICENSE.radeon`, `LICENSE.i915`, `LICENSE.xe`,
`LICENCE.nvidia`, and `LICENSE.amdisp` are preserved in `LICENSES/linux-firmware/`
and copied into the image's license directory. This includes GPU firmware, not
NVIDIA's proprietary host kernel/userspace driver. Loading remains opt-in via
`cfg.gpu`; firmware does not change the project source license.

## Bootstrap source archives

`initramfs/usr/lib/bootstrap/sources/` additionally carries uncompiled source:

- musl 1.2.6, from https://musl.libc.org/releases/musl-1.2.6.tar.gz;
  its full `COPYRIGHT` is preserved inside the archive.
- TinyCC commit `05f0faf`, with `COPYING` and per-file license notices preserved
  in `tinycc-05f0faf-upstream.tar.gz`.
- Local TinyCC bootstrap recipes in `tinycc-local-bootstrap-files.tar.gz`.

### Bootstrap route credit and build-time downloads

Credit to [ZilchOS/bootstrap-from-tcc](https://github.com/ZilchOS/bootstrap-from-tcc)
by Alexander Sosedkin (Copyright (c) 2021 Alexander Sosedkin), whose bootstrap
route and recipes informed Buninu's TinyCC-to-GCC stages. The complete MIT
notice is preserved in `LICENSES/MIT-ZilchOS-bootstrap-from-tcc.txt` and in
the bootstrap payload. Reference checkout:
`d2f9454b34fef570cfb32cf5b17d85a90dba81bf`.

Stages 5–12 additionally fetch GNU Make 4.4.1, Binutils 2.39, GMP 4.3.2,
MPFR 2.4.2, MPC 0.8.1, GNU m4 1.4.18, Flex 2.6.4 and the pinned GCC 4.7
vendor snapshot. These source archives and compiled results are not bundled
in the npm package. Their own licenses apply, independently of Buninu's and
ZilchOS's MIT licenses.

See [the bootstrap-specific notices](initramfs/usr/lib/bootstrap/NOTICE.md)
for component licenses, provenance, runtime-helper exceptions and where
upstream license texts are retained. The credit and MIT license are copied
into each prepared rootfs and the final result's license directory.

The numbered bootstrap scripts extract these sources into the new rootfs.
See `initramfs/usr/lib/bootstrap/README.md` for the source-generation steps
and the ARM64 ordinary-CRT compatibility adjustment.

## Components tracked in this repository

These files are committed under `native/x86_64/lib/` and
`native/aarch64/lib/`.

### ld-musl-x86_64.so.1, libc.musl-x86_64.so.1 and their aarch64 pair

- License: MIT
- See: `LICENSES/musl-COPYRIGHT.txt`

The musl C library and dynamic loader, version 1.2.6, as packaged by Alpine
Linux 3.24 (package `musl`, version 1.2.6-r3, x86_64 and aarch64). The two
files of each architecture are byte-identical; the second is a separate copy so that `bun:ffi` can `dlopen`
libc without touching the inode that is already acting as Bun's loader (see
`README.md`).

- Upstream source: https://musl.libc.org/releases/musl-1.2.6.tar.gz
- Alpine build recipe (Corresponding Source), pinned to the commit shipping
  pkgrel=3 (the fix for CVE-2026-107891):
  https://gitlab.alpinelinux.org/alpine/aports/-/blob/8f79d39391b46d6dbf1800fb68b8212a21d5ee2e/main/musl/APKBUILD
- Packages:
  https://dl-cdn.alpinelinux.org/alpine/v3.24/main/x86_64/musl-1.2.6-r3.apk
  SHA-256 `e142255d0fa397f14318996bc10378093dcc069dc3dd1b6818c8f28a789c21da`
  https://dl-cdn.alpinelinux.org/alpine/v3.24/main/aarch64/musl-1.2.6-r3.apk
  SHA-256 `2e17864102278d9049c3a56f1bceed9e8cf287065617e579325123443daed8a5`

SHA-256 of the shipped files:

```text
ld-musl-x86_64.so.1    095b047c631447e4fa50401fa7ffce01f678587040d65ba18c574981dc630de5
libc.musl-x86_64.so.1  095b047c631447e4fa50401fa7ffce01f678587040d65ba18c574981dc630de5
ld-musl-aarch64.so.1   53282acc2be8a08a9fdcf880334bf35bbfd0a13862b7f3616be3919fcda11793
libc.musl-aarch64.so.1 53282acc2be8a08a9fdcf880334bf35bbfd0a13862b7f3616be3919fcda11793
```

### libgcc_s.so.1 and libstdc++.so.6

- License: GPL-3.0-or-later WITH GCC-exception-3.1
- See: `LICENSES/GPL-3.0.txt` and `LICENSES/GCC-Runtime-Library-Exception-3.1.txt`

The GCC runtime support library and the GNU C++ standard library, built from
GCC 15.2.0, as packaged by Alpine Linux 3.24 (packages `libgcc` and
`libstdc++`, version 15.2.0-r5, x86_64 and aarch64). `libstdc++.so.6` is the package's
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
  https://dl-cdn.alpinelinux.org/alpine/v3.24/main/aarch64/libgcc-15.2.0-r5.apk
  SHA-256 `369aaa6e9d099a737bad6dd3e6c2fe7bb1547ca26d22b94ee0411228f709b403`
  https://dl-cdn.alpinelinux.org/alpine/v3.24/main/aarch64/libstdc++-15.2.0-r5.apk
  SHA-256 `2302e766d4e4926038ec166ecb85837ee884576115236ddb565e3a5fca4a11d7`

SHA-256 of the shipped files:

```text
x86_64/lib/libgcc_s.so.1    5ea51dd885b6fc691eccc569d0bda739204204f6161e97075b26dc9c050d1ca1
x86_64/lib/libstdc++.so.6   67a940194aec6c44c3eb47a98e44c53d248e4dac5f4eb57c0971c0d6286eafe5
aarch64/lib/libgcc_s.so.1   b83bc14b3e1660d66b0387077aea7e104fce3ed93bb56d05e30e4e2cdb37b473
aarch64/lib/libstdc++.so.6  bc958507db0cacf75cbf7298c395fbc7596667b17e1283d98bd6cfe3e59df951
```

## Components fetched at build time

These are not committed (see `.gitignore`). `fetch-plus-build.sh` downloads each
one, verifies the SHA-256 pinned in `scripts/arch.sh`, and packs it into the
UKI and the disk image. They are listed here because
the built image redistributes them.

### Linux kernels and modules

- License: GPL-2.0-only WITH Linux-syscall-note
- See: `LICENSES/GPL-2.0.txt` and `LICENSES/Linux-syscall-note.txt`

Linux 6.18.65 as packaged by Alpine Linux 3.24 from the `linux-lts` aport.
The default build uses package `linux-virt`, version 6.18.65-r0.
`--linux-lts` and `--real` use package `linux-lts`, version 6.18.65-r0.
Each comes from the x86_64 or aarch64 repository to match `--arch`. All
listed modules are the selected package's `.ko.gz` files decompressed without
modification.

- Upstream source: https://cdn.kernel.org/pub/linux/kernel/v6.x/linux-6.18.65.tar.xz
- Alpine build recipe, configuration and patches (Corresponding Source),
  pinned to the commit shipping 6.18.65-r0 (the same for both architectures):
  https://gitlab.alpinelinux.org/alpine/aports/-/blob/2559e452e8d4712c964e6f35c3fd7605dc4b28e4/main/linux-lts/APKBUILD
- Packages:
  https://dl-cdn.alpinelinux.org/alpine/v3.24/main/x86_64/linux-virt-6.18.65-r0.apk
  SHA-256 `364e4276a4e758bfdf0056ec9601bcbec15e511234593cdc6e6ae4cb8ae9ee75`
  https://dl-cdn.alpinelinux.org/alpine/v3.24/main/x86_64/linux-lts-6.18.65-r0.apk
  SHA-256 `9afad91ec1fad31487f08937f350dae3fac505197c56e76abca2de9179c1ea05`
  https://dl-cdn.alpinelinux.org/alpine/v3.24/main/aarch64/linux-virt-6.18.65-r0.apk
  SHA-256 `21bc1217671a2b450f3f8703fe76c8ffacc2cc7f93423cbe232f20cf1a0cbe6a`
  https://dl-cdn.alpinelinux.org/alpine/v3.24/main/aarch64/linux-lts-6.18.65-r0.apk
  SHA-256 `cdf4e799807d7e63db228ed18ed4110b133cfec65fc81e9466744bb552dd9389`

SHA-256 of files in the default x86_64 `linux-virt` image:

```text
kernel/x86_64/vmlinuz-virt   9aa581d9dc7c4b23d13c05fb68bd0bfc5e5a3110ca57c643b229d27d1a619641
failover.ko                  e358a3c262dbbb367e07b718779bae946c6edb0c053e7d2e60da4d662451db3a
net_failover.ko              c596b818d1b49b3fe16371b699b0b3e2240ba49df9f0301d10d3aabc93cff6f7
virtio_net.ko                5a7cfaeebf8483f52b1f17e68a793ac3cd7f87116c0e6cce5683f4df15549c64
```

SHA-256 of files in an x86_64 `--linux-lts` image:

```text
kernel/x86_64/vmlinuz-lts   b9adfd11be454d3d6d16cd06173ae3dfab4d279d6a0c4323d79c2b9c9d950f50
failover.ko                 56bd108af518cfc0fda8ef080025cccdd31b7b99c47db00796e0ceab938060ff
net_failover.ko             80a5c0399cb52abbfa3b652d4151c98886a942ef246f5bd810e7222650145c21
virtio_net.ko               d6c93da0c866a141e87e3c4af981a4e11d877a3d5f6789761ef17636966be60d
virtio_ring.ko              52417f95d1f76d425d5d69943860d021cc0573e6b42c61833e8ef0c80da279bd
virtio.ko                   2b3a0821fee86a04287e2ba0c7e77c0a167ff9316424ed257e19db6cec376aea
virtio_pci_legacy_dev.ko    0363b44ca829e79621ba3d63867a7f87d680db1c25b1a4737a86913f947f687d
virtio_pci_modern_dev.ko    e600a5790fe71d935d8b6f7c868b895494302a923502a798c00ce731206f136b
virtio_pci.ko               7b9df094b1ea4e794334436daabe7345e116f37b2ce41e272b5092c112d9169f
```

`--real` additionally includes the following modules from that same
x86_64 `linux-lts` package for physical xHCI controllers and USB HID keyboards:

```text
usb-common.ko               e5f40df67e7a67c559beb16f7291250940abbc724591758582875937decd06b1
usbcore.ko                  cc7daa4b39b55b36276e1e752ba28224220b61e9832a604e40716a67a8a38aa3
xhci-hcd.ko                 4420adce4ab2c7c84ff89ba35c49ca1d541519527bc805c264896e5bb058aaea
xhci-pci.ko                 47ed0a7b9d27b4bbbb636df5c2c857864d4feb7b04a21428337b87f3ee026186
xhci-pci-renesas.ko         33ccfc7ccd0fe43c2abd6ed73a4fb142819a196584b63073d2928e525c5dfe1b
hid.ko                      e812816ca53f31af381c6d1cc1a52afc75af9b8b27485a0ee32a9f535d233689
hid-generic.ko              b508fd0cea4c0a3b593263fa9eea10d87a2f5c2bb892cc3500f371078581a468
usbhid.ko                   6187dbf3d62685785a0498f81439dfcecd52d3e1a516f695ceefb0314ad33d31
```

SHA-256 of files in the default aarch64 `linux-virt` image:

```text
kernel/aarch64/vmlinuz-virt  5d85fe9961943b49998f4925cc0679eb45b9409d49ddad890952e390dfafa0d1
failover.ko                  964be8d9984b31dd86b97b5b42c07c0b248dd62dbdd0f1b032befdb71fc227f8
net_failover.ko              511e356f04067ea88b345ad704304ed50c91dd87b55fe9d719f895d6d0c617ad
virtio_net.ko                bd13839d8fea5d9b5e57e8a073a4c92868ffa95b35a4b597afd0b43ec91532b3
```

SHA-256 of files in an aarch64 `--linux-lts` image:

```text
kernel/aarch64/vmlinuz-lts  9bcc9940113ad8f5a71527dd42c839c42bbb35b86a9e583b63c64bb753c315e7
failover.ko                 e6f9bf8c03eda83fd67e73c965d715a1e2bcbc299b515eb66310c268f08634de
net_failover.ko             c3b323df0db2068aaab3b0192a66933d0ec8482363c2204af49797492250e5c2
virtio_net.ko               6fd417703d7de6d53426b855cff6f5c4fc19e82301d47a2208e29e28f394b67a
virtio_pci_legacy_dev.ko    f8595aea8e21d582d22932998652b9198938b09e461c53712f8ce402b8e6cccc
virtio_pci_modern_dev.ko    685cc77999adeaa151f86a5ef34c552f9accaebdbe62238b2b5304044d705551
virtio_pci.ko               ee13357f920b2d8922233e46c562ff28bc13def0bfc20e65af931721b57d9cbf
```

### linuxx64.efi.stub and linuxaa64.efi.stub

- License: LGPL-2.1-or-later
- See: `LICENSES/LGPL-2.1.txt`

systemd's UEFI boot stub, version 260.2, as packaged by Alpine Linux 3.24
(package `systemd-efistub`, version 260.2-r0, x86_64 and aarch64, from the
`systemd-boot` aport). The UKI is this stub with the kernel, initramfs, command line and
`os-release` appended as PE sections.

- Upstream source: https://github.com/systemd/systemd/archive/refs/tags/v260.2.tar.gz
- Alpine build recipe (Corresponding Source), pinned to the commit shipping
  260.2-r0:
  https://gitlab.alpinelinux.org/alpine/aports/-/blob/c329463d3dbe6b28360180706f843e605c97575b/main/systemd-boot/APKBUILD
- Packages:
  https://dl-cdn.alpinelinux.org/alpine/v3.24/main/x86_64/systemd-efistub-260.2-r0.apk
  SHA-256 `8e64a5a3afee5f930e6e6716be726dc6d405530ac7f8fa5be6251dae68671ec9`
  https://dl-cdn.alpinelinux.org/alpine/v3.24/main/aarch64/systemd-efistub-260.2-r0.apk
  SHA-256 `a1823d2d7082db555d528f82c1809f276c818aeb5b40f198f4565f104e055c38`

SHA-256 of the shipped files:

```text
kernel/x86_64/linuxx64.efi.stub    b9d1e11d11aa7137f9b1d24b530fac00daf58bfcf3a852267ccaec297492c6d3
kernel/aarch64/linuxaa64.efi.stub  939a1511162f26ef331b0b6754308b8393c79c94e5b955605f8e89e1821a0d06
```

### bun

- License: MIT, with bundled components under their own licenses
- See: `LICENSES/Bun-LICENSE.md` (Bun's `LICENSE.md` at tag `bun-v1.4.5`,
  which lists the licenses of everything statically linked into the binary,
  including JavaScriptCore)

Bun 1.4.5, the official `linux-x64-musl-baseline` release binary for
x86_64 and `linux-aarch64-musl` for aarch64. For this release the `-baseline`
and plain `linux-x64-musl` archives contain the same `bun` executable; Bun
ships one x64 build and keeps the `-baseline` name as an alias.

- Upstream source: https://github.com/oven-sh/bun/tree/bun-v1.4.5
- Release archives:
  https://github.com/oven-sh/bun/releases/download/bun-v1.4.5/bun-linux-x64-musl-baseline.zip
  SHA-256 `96fb94108eed872ff623ed39007d6b5699a83a5d0086fcfba84921c18145e3e6`
  https://github.com/oven-sh/bun/releases/download/bun-v1.4.5/bun-linux-aarch64-musl.zip
  SHA-256 `d655765d3a0c0fdf707e27c7aa1a4f2c84f1bbc1f759db7e6e3d3c5be414396c`
  (both as listed in the release's `SHASUMS256.txt`)

SHA-256 of the shipped files:

```text
native/x86_64/bin/bun    cf5d285ddbe256785a5121a3c113191a6b577504976374c7cfd5aedca609b720
native/aarch64/bin/bun   9c48986093073afec8b76a3e285303598dd2462f52748aecb65e4d94866e1ea3
```

## npm applications fetched and redistributed in the image

The fetch stage downloads the following exact releases directly from the
npm registry. `scripts/npm-packages.md` is the canonical list of tarball
URLs and SHA-256 pins. Both fetch and pack verify those hashes. Pack removes
the leading `package/` component and installs the contents under
`/usr/lib/node_modules/`; it does not run npm lifecycle scripts or resolve
additional dependencies. The downloaded archives are build inputs, not
committed source files, but their contents are redistributed in the image.

| Package | Version | Package license | Project / package page | Installed license and notices (relative to `/usr/lib/node_modules/`) |
|---|---|---|---|---|
| `buninu-browser` | 0.2.3 | MIT for the browser's own code; bundled components retain their own terms | https://github.com/jjtseng93/buninu-browser | `buninu-browser/LICENSE`, `THIRD_PARTY_NOTICES.md`, `LICENSES/` and vendor notices within that package |
| `buninu-land` | 0.1.3 | MIT for its own code; bundled components retain their own terms | https://github.com/jjtseng93/buninu-land | `buninu-land/LICENSE`, `THIRD_PARTY_NOTICES.md`, `LICENSES/`, `SOURCES.md`, protocol XML notices and vendor notices |
| `@drxiaozhi/casty` | 1.3.7 | MIT | https://github.com/jjtseng93/casty | `@drxiaozhi/casty/LICENSE` |
| `@drxiaozhi/jspulse` | 0.2.1 | LGPL-2.1-or-later, with additional component notices | https://github.com/jjtseng93/jspulse | `@drxiaozhi/jspulse/LICENSE`, `NOTICE.md`, `LICENSES/` and source-file notices within that package |
| `@drxiaozhi/jspinyin` | 0.1.1 | MIT; hanzipinyin material under the Unlicense | https://www.npmjs.com/package/@drxiaozhi/jspinyin | `@drxiaozhi/jspinyin/LICENSE` and `@drxiaozhi/jspinyin/LICENSE-hanzipinyin.md` |

The upstream links identify the projects; the pinned registry archives
identify the exact releases used by this build. Preserve the packages'
copyright notices, license texts, third-party notices and source material
when redistributing or repacking the image. Buninu Linux's MIT license does
not relicense these components.

### Browser resources and LGPL media decoder

Only the browser's `usr/lib/canvaskit` and `usr/share/fonts` directories are
excluded from extraction. Its `usr/README.md`, top-level license collection,
third-party notices and vendor source material are retained. The distribution
launcher creates relative links to the system CanvasKit and fonts when those
resource directories are missing; their licenses are documented under
Graphics stack below and remain with the system copies.

The browser includes `@wasmpeg/cpu` 1.0.1 and its FFmpeg code under
LGPL-2.1-or-later. Within `/usr/lib/node_modules/buninu-browser/`, retain:

- `vendor/wasmpeg/LICENSE`, `vendor/wasmpeg/NOTICE` and `LICENSES/wasmpeg.txt`;
- `vendor/wasmpeg/source-v1.0.1.tar.gz`, the bundled source archive;
- `vendor/wasmpeg/VENDORING.md`, with artifact hashes and rebuild instructions;
- `patches/wasmpeg/`, documenting the package's local changes;
- the other license texts identified in `THIRD_PARTY_NOTICES.md`, including
  those for Emscripten and zlib.

The decoder's `cpu.wasm` remains a separate, replaceable file. Do not remove
the source archive or rebuild material merely to reduce the image size.

### Buninu Land

The compositor package retains its loader, protocol XML, source provenance,
patches and license collection. When its CanvasKit WASM is byte-identical to
the system copy, packing omits the duplicate and the distribution launcher
creates a relative symlink to `/lib/canvaskit/canvaskit.wasm`. Differing WASM
versions remain bundled. All associated licenses and notices are retained.
Retain `THIRD_PARTY_NOTICES.md`, `SOURCES.md`, `vendor-manifest.json`,
`LICENSES/`, `vendor/canvaskit/LICENSE`, and the notices embedded in the
Wayland protocol XML files. These cover Buninu Browser-derived code,
CanvasKit/Skia and embedded libraries, Wayland protocols, and the Hyprland
window-management/input reference credit (`LICENSES/hyprland.txt`).
The distribution-owned launcher uses the separately bundled Casty package.

### jspulse source and notices

jspulse is shipped as JavaScript source, with its LGPL license, modification
notices and additional notices intact. Its `NOTICE.md` describes the
PulseAudio, Termux, ALSA and Sun G.711 material; `LICENSES/` includes LGPL-2.1
and NCSA texts. Browser audio communicates with this separate server through
the PulseAudio protocol. The distribution's launcher does not replace or
remove the package's source or license files.

This inventory records the shipped materials; it is not a blanket compliance
certification. Redistributors remain responsible for applicable source,
notice and modification/replacement requirements, particularly if changing
the packages, their build artifacts or the source material supplied with them.

## Graphics stack

These files are committed under `initramfs/lib/` and `initramfs/usr/share/`
for `bunterm` and `/lib/canvas.js`; see `graphics.md`. Each also ships with
its license text next to it inside the image.

| Path | Component | License |
|---|---|---|
| `initramfs/lib/canvaskit/canvaskit.js`, `canvaskit.wasm` | CanvasKit 0.41.1, Skia compiled to WebAssembly (npm `canvaskit-wasm`); the WASM is unmodified, the JS loader carries two `wasmBinary` fixes recorded in [`patches/canvaskit/`](patches/canvaskit/README.md) | BSD-3-Clause, `LICENSES/BSD-3-Clause-Skia.txt` |
| `initramfs/lib/xterm/xterm-headless.mjs`, `addon-unicode-graphemes.mjs` | xterm.js 6.0.0 (npm `@xterm/headless`, `@xterm/addon-unicode-graphemes`) | MIT, `LICENSES/MIT-xterm.js.txt` |
| `initramfs/lib/bunterm/kitty-keyboard.cjs` | Kitty keyboard encoder from jsgotty 1.2.0, `static/js/kitty-keyboard.js`, with provenance comments | MIT; `initramfs/buninu/apps/jsgotty/LICENSE` |
| `initramfs/lib/bunterm/glyphs.js` | Box drawing / block / Powerline shape tables ported from xterm.js `addon-webgl/src/CustomGlyphs.ts` | MIT, as above |
| `initramfs/usr/share/fonts/DejaVuSansMono.ttf`, `DejaVuSansMono-Bold.ttf` | DejaVu fonts 2.37 (Debian `fonts-dejavu-core`) | Bitstream Vera, `LICENSES/Bitstream-Vera.txt` |
| `initramfs/usr/share/fonts/NotoSansCJK-Regular.ttc` | Noto Sans CJK 2.004 (variable, JP/KR/SC/TC/HK faces), from Android's `/system/fonts` | SIL OFL 1.1, `LICENSES/OFL-1.1.txt` |
| `initramfs/usr/share/fonts/NotoColorEmoji.ttf`, `NotoColorEmojiFlags.ttf` | Noto Color Emoji 2.047 (CBDT), from Android | SIL OFL 1.1 |
| `initramfs/usr/share/fonts/NotoSansSymbols-Regular-Subsetted.ttf`, `-Subsetted2.ttf` | Noto Sans Symbols / Symbols2 (Android subsets) | SIL OFL 1.1 |
| `initramfs/usr/share/fonts/Roboto-Regular.ttf` | Roboto 3.005 (variable), from Android | Apache-2.0, `LICENSES/Apache-2.0.txt` |

## Buninu userspace

`initramfs/buninu/` is the Buninu userspace (version 0.4.15, MIT; see
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
