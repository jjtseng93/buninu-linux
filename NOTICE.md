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
Linux 3.24 (package `musl`, version 1.2.6-r2, x86_64 and aarch64). The two
files of each architecture are byte-identical; the second is a separate copy so that `bun:ffi` can `dlopen`
libc without touching the inode that is already acting as Bun's loader (see
`README.md`).

- Upstream source: https://musl.libc.org/releases/musl-1.2.6.tar.gz
- Alpine build recipe (Corresponding Source), pinned to the commit shipping
  pkgrel=2:
  https://gitlab.alpinelinux.org/alpine/aports/-/blob/f5640d3a10f664c9119720c60515265d3d6f6d01/main/musl/APKBUILD
- Packages:
  https://dl-cdn.alpinelinux.org/alpine/v3.24/main/x86_64/musl-1.2.6-r2.apk
  SHA-256 `573712e2f49c15bfc20a2699f204acdfc74c772722b15e7353d768057fae0e71`
  https://dl-cdn.alpinelinux.org/alpine/v3.24/main/aarch64/musl-1.2.6-r2.apk
  SHA-256 `5e9674b7f41152fe2119093b5cb4c13eaaadb19c2d5422b2d7267913e663ee6e`

SHA-256 of the shipped files:

```text
ld-musl-x86_64.so.1    38d022ce7425ff105ccfb53598f606e6e5f5f0a34bfbc793d65e6f34c9d72806
libc.musl-x86_64.so.1  38d022ce7425ff105ccfb53598f606e6e5f5f0a34bfbc793d65e6f34c9d72806
ld-musl-aarch64.so.1   32377e6d71725bb019e9ff6d5e9f16b4d5156d6f2c36504191c2d6a7c4d4a44d
libc.musl-aarch64.so.1 32377e6d71725bb019e9ff6d5e9f16b4d5156d6f2c36504191c2d6a7c4d4a44d
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

Linux 6.18.59 as packaged by Alpine Linux 3.24 from the `linux-lts` aport.
The default build uses package `linux-virt`, version 6.18.59-r0.
`--linux-lts` and `--real` use package `linux-lts`, version 6.18.59-r0.
Each comes from the x86_64 or aarch64 repository to match `--arch`. All
listed modules are the selected package's `.ko.gz` files decompressed without
modification.

- Upstream source: https://cdn.kernel.org/pub/linux/kernel/v6.x/linux-6.18.59.tar.xz
- Alpine build recipe, configuration and patches (Corresponding Source),
  pinned to the commit shipping 6.18.59-r0 (the same for both architectures):
  https://gitlab.alpinelinux.org/alpine/aports/-/blob/36d3ca8442f7d978ad15bf4be74b7a4ff7bf815e/main/linux-lts/APKBUILD
- Packages:
  https://dl-cdn.alpinelinux.org/alpine/v3.24/main/x86_64/linux-virt-6.18.59-r0.apk
  SHA-256 `73ad4774ca26c196103a00e2fb8d28ed02de4c08c11fad96e903da03dcb085f4`
  https://dl-cdn.alpinelinux.org/alpine/v3.24/main/x86_64/linux-lts-6.18.59-r0.apk
  SHA-256 `ae0a669a08c90ef971996f81f1bcb6f7ca8211ad62624ad8c5b57412c3f1def8`
  https://dl-cdn.alpinelinux.org/alpine/v3.24/main/aarch64/linux-virt-6.18.59-r0.apk
  SHA-256 `89b68fc32d61a1483ab0d9db78b5a06144ac115fe2ee8102cb4ad7987f46d524`
  https://dl-cdn.alpinelinux.org/alpine/v3.24/main/aarch64/linux-lts-6.18.59-r0.apk
  SHA-256 `f6387970517083d5f08abacbf81baf1d70e1baa8fe4c2783469f45bb0751075c`

SHA-256 of files in the default x86_64 `linux-virt` image:

```text
kernel/x86_64/vmlinuz-virt   55fcc67c770730412a505df82b80dce098083e5680a7449dc6b4eaed895de21d
failover.ko                  21c1882e1dd7aacf48d0cc33a5848542b8d4eba9eff53b76a872d0f88cb0eacc
net_failover.ko              b8578044a43d94f7a737792ef8918e76b3dd54b982f64721f8576e7383a1284c
virtio_net.ko                e43e19e84dfbdf3b85b6558a791b2af0e707d1a95b291bc3d9e4d096022a0f98
```

SHA-256 of files in an x86_64 `--linux-lts` image:

```text
kernel/x86_64/vmlinuz-lts   a36355ddda308e1cb7229319212485244d22991dfe00ad4c5c2de0e0a2a160ae
failover.ko                 fe224da2637ef77046211d0415d52bf44c10fc2a541ae625cb1fa5b418430904
net_failover.ko             80f682ad83e4d635115459b158db3c530a074bcf1ccba9c7c4105889287aa297
virtio_net.ko               1c15837e328e8d385ec4fb0440ecce8d09662472621c00eb742461eaf892f1a9
virtio_ring.ko              c224f71f79e132019bfd239d6286f101fd7e561e279f336eff5650f8e06b35f0
virtio.ko                   bd6f21cb4e73ec312a1c712b20caff7595998a2e0c977e4f4d281a41fefbd743
virtio_pci_legacy_dev.ko    f27fd98525aa69d59eafd36d9082f42a8ac96e8e4948f2a1cedd3daa0ac96e19
virtio_pci_modern_dev.ko    e9a5fe9c4a6d65b4467b03cda06eedc92e5725a0afd2f87180bf5d62a9d380d7
virtio_pci.ko               0dde14759f4b7a3694f1f85705795fb42ed772e85dd189dbaf2c5fcfba211afb
```

`--real` additionally includes the following modules from that same
x86_64 `linux-lts` package for physical xHCI controllers and USB HID keyboards:

```text
usb-common.ko               bd76c601653653ea9823239483bd993d26db14b6516099eff0338078f0ce11d0
usbcore.ko                  1460d8c9a9859bfff7ddac22d108729d32f4bd1a4db7c9f4bed1eee1529259cf
xhci-hcd.ko                 da5d9b1f221c6ae64c250b84238ad05029d781858d42eb776fb279274e9c6a09
xhci-pci.ko                 52fa7545987bf51937d52947b8df85d1c5d4afb32534ff38289fa4c738aa9237
xhci-pci-renesas.ko         3942d1cc3a71936f243e6c189f4e3cf90950b7077669230b24656994248aa393
hid.ko                      9f238b469282c9112d3198e10304f98e6473877efd832053b8d35c237bf6204e
hid-generic.ko              37c085e37836a9d8398b6f3b7c50826f7dfe364be24ca53d2a02e9b4f7dbd04d
usbhid.ko                   e5100f737e69e8b6407371c51be3f0ead720058209bf450eb587caa080eea535
```

SHA-256 of files in the default aarch64 `linux-virt` image:

```text
kernel/aarch64/vmlinuz-virt  200c82866453b2faa2c39e53b5bdd04368153c767f014c9e5bbb8ac6b76cde0d
failover.ko                  be03d9e43cb15fdc2ab76f5bed6dbb2ab4385159cddd7ec5182ac1534408deb9
net_failover.ko              0fbcf10f4e7255ae3fb8e560ed96ed57908e40456022ace26437d1dbc84fc8d7
virtio_net.ko                552285e13b3722e0006d2bdf9efe950409b5f8e93295c4e59c013a16e116183a
```

SHA-256 of files in an aarch64 `--linux-lts` image:

```text
kernel/aarch64/vmlinuz-lts  73d5dce99b14221b7756537b71f0081e103cddcc6d46038d21223c51cc775d15
failover.ko                 0cdc25b36316ef98bb8a97334c10ba76e925059634314df11b191b9ac8a4b813
net_failover.ko             fa0371b74f99f8b05ff7d7e1595f810505552a5beeb1a2a4c96f0f5c12a44665
virtio_net.ko               3561663d1abf5a15c245b3e42732dbbca59590e52f5abf934816320a9f9eba90
virtio_pci_legacy_dev.ko    59a78df1890892581f8653327972a6cb7312d1538fe118c446cfc9562b42208a
virtio_pci_modern_dev.ko    39e0c7a21ac529290fbb105c09670808ecf06e7c95f2cd7baa280988ef8b8263
virtio_pci.ko               c0943a24ef93d5f977272f1392f2165977804049c7e98b365ab5101f46def1af
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
| `initramfs/lib/canvaskit/canvaskit.js`, `canvaskit.wasm` | CanvasKit 0.41.1, Skia compiled to WebAssembly (npm `canvaskit-wasm`) | BSD-3-Clause, `LICENSES/BSD-3-Clause-Skia.txt` |
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
