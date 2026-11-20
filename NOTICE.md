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

Linux 6.18.64 as packaged by Alpine Linux 3.24 from the `linux-lts` aport.
The default build uses package `linux-virt`, version 6.18.64-r0.
`--linux-lts` and `--real` use package `linux-lts`, version 6.18.64-r0.
Each comes from the x86_64 or aarch64 repository to match `--arch`. All
listed modules are the selected package's `.ko.gz` files decompressed without
modification.

- Upstream source: https://cdn.kernel.org/pub/linux/kernel/v6.x/linux-6.18.64.tar.xz
- Alpine build recipe, configuration and patches (Corresponding Source),
  pinned to the commit shipping 6.18.64-r0 (the same for both architectures):
  https://gitlab.alpinelinux.org/alpine/aports/-/blob/d65a2d332a8ba2153c1c732411ddd44f8dd2beb8/main/linux-lts/APKBUILD
- Packages:
  https://dl-cdn.alpinelinux.org/alpine/v3.24/main/x86_64/linux-virt-6.18.64-r0.apk
  SHA-256 `cdcff66a46c4c512accff5c569efa2ae44e6006d97286c0dd44775ea1d54901b`
  https://dl-cdn.alpinelinux.org/alpine/v3.24/main/x86_64/linux-lts-6.18.64-r0.apk
  SHA-256 `98cbbb0e382ff6d0d04816965bf02907939325fad9390b17be29180bf46ce0b1`
  https://dl-cdn.alpinelinux.org/alpine/v3.24/main/aarch64/linux-virt-6.18.64-r0.apk
  SHA-256 `cf171f51ab44d637a7758dd5a2f6a4ecd7ddbea18d61b9e37a6d39357d2fb1d5`
  https://dl-cdn.alpinelinux.org/alpine/v3.24/main/aarch64/linux-lts-6.18.64-r0.apk
  SHA-256 `9d380c0060d43d4929b2de6b5ae85ccdb389d4179f222b19439ff7158d645f4a`

SHA-256 of files in the default x86_64 `linux-virt` image:

```text
kernel/x86_64/vmlinuz-virt   ebdba905d6a2e25593a9fa5537646a9c214608083ad7c0096869f778543d788e
failover.ko                  bc1aeb9142b60264c348dd335bdbea9b4d81d2e80905d3c2eaf4a02a20649b91
net_failover.ko              5d263a2637ef1010552c7e5ae1619bf8b23cfb02df7cac7e114fc4464b047916
virtio_net.ko                2994a7963395253448939f1e37178b2519fe2c42c888cacbac37a2e3c206f837
```

SHA-256 of files in an x86_64 `--linux-lts` image:

```text
kernel/x86_64/vmlinuz-lts   7a8247139fb6e1a2752178f9a5387316d8dd4d8883d3e607cc212e23f6ede0e0
failover.ko                 9d1cae4534d0cda560ae492a47af85abc4d9bee900fd5a588a4522a534c87b93
net_failover.ko             3c5b02754b4b0d1886093f735b764b98081cac6e12bbf5d83040e7350bcc0084
virtio_net.ko               bdff9544e738e5744cba055f6b847d5c28058c928a9682d31d484f417f08496f
virtio_ring.ko              0c625aacdeb8b9a394a3b10f4db424acdc48b2416f4baaf3656dfa351db77da8
virtio.ko                   e3bcec0e60585e02b5f4d30ba82e92f6c2811742fb40d1f6cc6f0bd630025e77
virtio_pci_legacy_dev.ko    9edcad63358b082dbe1bc29ae4200aa350245195a81b2b4b896f839e13d797f1
virtio_pci_modern_dev.ko    da3e38c4efba83089f41fe4dbb78d39a43a2bfae188f216970acc3d6dad02e6b
virtio_pci.ko               d707d54c2640da321107d94eb562a0fe892bca3fb1fb3e2e182a1643b8c725dd
```

`--real` additionally includes the following modules from that same
x86_64 `linux-lts` package for physical xHCI controllers and USB HID keyboards:

```text
usb-common.ko               0c79606401e334f2132da00e8d7d3bc4d34af1b5f1267a83ac57bd058e4f27b7
usbcore.ko                  a6b42bc6d532dd77cbf3caf00d105eef39c4437f4b2b0bad4a02e8059fa7dede
xhci-hcd.ko                 6d795084caae4e1a14ba6ac4712ae9970493f1fd2dd7223caf8632b7637a659a
xhci-pci.ko                 b40aa9cb9bcd7121e8905610f5f389eb8be1c474705f444751b399136ca189bb
xhci-pci-renesas.ko         5498ee2e3a3eb6d337e9d255dc052092d11af1879a8d4164c411350f2fb1c342
hid.ko                      ee325fcfe7a237e175414ff987e24aa41331875b4d635f190c1672eac966022f
hid-generic.ko              5d112b703e4741dcbb3e695aba1fe420de0082abb61ff08858d97e9e473af030
usbhid.ko                   59b75041cf215f38e0bd6629f3325ce0b219175281dd49bbf37e3b4cb2c4c308
```

SHA-256 of files in the default aarch64 `linux-virt` image:

```text
kernel/aarch64/vmlinuz-virt  424bee416151937d936fa367f14940b4accb8b75f6be025bfb2b9510bc65a5d3
failover.ko                  ced5340e2007de58f8816f319d9029c243e9b50388217df474cc3195f1091266
net_failover.ko              42a5db3e9814b483b9c3fee38487878ca1fd2f647e9df0066a3acd3d96642440
virtio_net.ko                272fa88f6b1bedeecc9d75a2e4a9c1d4bd0cd78ceecca4b475071754cc6eeaef
```

SHA-256 of files in an aarch64 `--linux-lts` image:

```text
kernel/aarch64/vmlinuz-lts  0ac68d9ecccfbcac34f8d866de9835be5975e9c484df069772f2d326941df989
failover.ko                 426dd774b38f45883663d056239157c52942b0332d20abdd8df9b08add7c7bd5
net_failover.ko             cb8c32d751f733c92c936cf35fdcf2a6b234fb602a61a58b2a783be1d5ea62c3
virtio_net.ko               a83cfc5867607731b5de45c5855737f5c9e893dac3f599e5b1e34ef1a8e368f4
virtio_pci_legacy_dev.ko    aff3fbd9cef2de95d2934f7565da840ef4fb985de37c248c8793b2bee29d1fbd
virtio_pci_modern_dev.ko    ba29b482dcfe94a75c14ef28b7eb850ef09745da97136ea4addc5935940cdeeb
virtio_pci.ko               5d114f0e6b82341ceadf5f1ed4b73107aaeef43deb45b81ed54a89ccf61eef83
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
- See: `LICENSES/Bun-LICENSE.md` (Bun's `LICENSE.md` at tag `bun-v1.4.2`,
  which lists the licenses of everything statically linked into the binary,
  including JavaScriptCore)

Bun 1.4.2, the official `linux-x64-musl-baseline` release binary for
x86_64 and `linux-aarch64-musl` for aarch64. For this release the `-baseline`
and plain `linux-x64-musl` archives contain the same `bun` executable; Bun
ships one x64 build and keeps the `-baseline` name as an alias.

- Upstream source: https://github.com/oven-sh/bun/tree/bun-v1.4.2
- Release archives:
  https://github.com/oven-sh/bun/releases/download/bun-v1.4.2/bun-linux-x64-musl-baseline.zip
  SHA-256 `76e1db84e98f22f78de0a87e309bfbbf297732847f9720db36750646c85c8c18`
  https://github.com/oven-sh/bun/releases/download/bun-v1.4.2/bun-linux-aarch64-musl.zip
  SHA-256 `71760b6c8ea30623b81a4907cb815d48e2ea266f2e73e751534a44a0607950df`
  (both as listed in the release's `SHASUMS256.txt`)

SHA-256 of the shipped files:

```text
native/x86_64/bin/bun    16b72935ffd7a503b978c186874539c92aade4e3515b70a5abf5db2581fdef7d
native/aarch64/bin/bun   1101cd0aa92ea214c2aaf4bb3761ca3c76a90aae0e6f94c07efb4e8c4f18a8fc
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
