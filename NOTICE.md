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

Linux 6.18.58 as packaged by Alpine Linux 3.24 from the `linux-lts` aport.
The default build uses package `linux-virt`, version 6.18.58-r0.
`--linux-lts` and `--real` use package `linux-lts`, version 6.18.58-r0.
Each comes from the x86_64 or aarch64 repository to match `--arch`. All
listed modules are the selected package's `.ko.gz` files decompressed without
modification.

- Upstream source: https://cdn.kernel.org/pub/linux/kernel/v6.x/linux-6.18.58.tar.xz
- Alpine build recipe, configuration and patches (Corresponding Source),
  pinned to the commit shipping 6.18.58-r0 (the same for both architectures):
  https://gitlab.alpinelinux.org/alpine/aports/-/blob/5fe63f789de75f6a71001cf2de771f922bedd0d2/main/linux-lts/APKBUILD
- Packages:
  https://dl-cdn.alpinelinux.org/alpine/v3.24/main/x86_64/linux-virt-6.18.58-r0.apk
  SHA-256 `1eec55004cf7167c914c8839f46691d2bc82767e20466bff51eb45d06f8e90cc`
  https://dl-cdn.alpinelinux.org/alpine/v3.24/main/x86_64/linux-lts-6.18.58-r0.apk
  SHA-256 `af399fba75cafb2940fc2853eb73ba2289aa463228f33541cd3010334a30992b`
  https://dl-cdn.alpinelinux.org/alpine/v3.24/main/aarch64/linux-virt-6.18.58-r0.apk
  SHA-256 `b46c51ddf572d85b2ba7b9adfaa64f4c38fc490c93d97a20ffd2418d51284085`
  https://dl-cdn.alpinelinux.org/alpine/v3.24/main/aarch64/linux-lts-6.18.58-r0.apk
  SHA-256 `65ab581dd6773e2b1b6831dac50142518b2f2083668f164f68ebfcd00d1763c4`

SHA-256 of files in the default x86_64 `linux-virt` image:

```text
kernel/x86_64/vmlinuz-virt   17fbd3efd16f2e7cb1b945f06423b37399ba7d5ac8cdd3665e7f13f363500e85
failover.ko                  4a9c64a0e9a8e7ea9899fe2a4958fedb71691e904e91a16109f944cae3647745
net_failover.ko              175984d70fd5bd11de5f184f729fd7aee8d50146b23f0e591670b175837c7010
virtio_net.ko                72bdeeb075dccbb8c67938d633662e890784f0c388fcdddfe72e9c4b509b987c
```

SHA-256 of files in an x86_64 `--linux-lts` image:

```text
kernel/x86_64/vmlinuz-lts   14ac8b1b0f92aacb815c46c2e6e9e70e9e80d9fd1391ebf48c0d4ba5059f6652
failover.ko                 8154cc9a26e1a751fd0e29b35653679a22189dce9a35c1b78c42838d7f10e40c
net_failover.ko             3b45635fed29500db82ca400bfd4080f6129240f34f7b603e6f4d7612c019c94
virtio_net.ko               5a81ac1fbf786a33609d3f1f00f0b08f6da4e8ea9509690cd7fe59c30f81b596
virtio_ring.ko              529b4e5c64787a80af7c1a06e44ce8fc007b4e805d3b2a7b673acbcffad887ed
virtio.ko                   87b99cefeb119f9a49c589cdd1ae732d34d9416bb92385c7022bc038bc0146e0
virtio_pci_legacy_dev.ko    10be513db7fdb8b2eec44347fbe74f482be83085aabe3b4abeb193f47fac0615
virtio_pci_modern_dev.ko    fa2dd36e83a65202b4494765f6ef75634cf5e9fc21906ccaee71a0106427638f
virtio_pci.ko               acb46043812dfc42fa0bd9d6bbebc7b61d313eb36236ba9bd4ace3cfaa89f902
```

`--real` additionally includes the following modules from that same
x86_64 `linux-lts` package for physical xHCI controllers and USB HID keyboards:

```text
usb-common.ko               fea517ef78b4f39c2de5980bcff506b1b9a55561b35949f1f320bcd923b04b78
usbcore.ko                  8229fce701d624d6ed9b436406eb35155d78a4f2af12e0ebaeff7c5f78f33d78
xhci-hcd.ko                 36e62e85b9f312f5fffcf6d1c74bd86ddaf0d0253bb000376163360b04ed75d2
xhci-pci.ko                 8132c975ee33dc50f213b20e4cb836f5bf9e46d14a93665781b6d171ead764c0
xhci-pci-renesas.ko         5e4cb38fce1668cb8780a4fadf4ce51bfbc0f586a129c6203f4b7e6e6ce24292
hid.ko                      bb08c478b6efc032f5e22e461c529e05fe811f28c63646d8a0e3a961020b5e9e
hid-generic.ko              eb6f98948b7d82d750bf3320bb886e00fd03fa4683a35ec0ee28eff6b20a1ad5
usbhid.ko                   e479535c61bed7691f72ebd09a35ab3b5b53ed23dda3a07d5899049685b8a3b8
```

SHA-256 of files in the default aarch64 `linux-virt` image:

```text
kernel/aarch64/vmlinuz-virt  849394914e6a93cc9bb17e901f445ce21fcd7e4528541d9496a74d6a6ccee319
failover.ko                  3c806423468d1ca1d2339125a958ef42ee2fc8f56d3ee3547ec5e848f997c4e7
net_failover.ko              04443fea2bec85ebc3634732c8b4023c66a86c11b7ad07ddcca57adbbd24a56c
virtio_net.ko                052a058c333d4d59e8b5b4f82822d3ccfb54cda03cc8cff2007cfc7145cf4520
```

SHA-256 of files in an aarch64 `--linux-lts` image:

```text
kernel/aarch64/vmlinuz-lts  1a1c64908397369119a016b163b726741ec97a52e5405e5bbe3275e97f6a39cc
failover.ko                 b8d1e9ea95083cce714b8b045ac28799e08fa388b95062f4ac90335903ec6709
net_failover.ko             be4271294cd959c86dab7e3498127f5194b67aeab63521755acd78ddfed15ff7
virtio_net.ko               df090940866c21e0ae2af9c75ca2c8c0c2f4a732e346ddeab734befa801af64a
virtio_pci_legacy_dev.ko    0528589d3347a19bcfab93c860703f97e5636ccaeb6498a02257026abe9c8c2e
virtio_pci_modern_dev.ko    facbbeb0324365aa90abd47496059855e0ebe4523c01dd531d0304ad01ccdb84
virtio_pci.ko               618ba972e7b26f7321a73652c9f1d036f78ea0add7aa58fd71472da3e4bb3248
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
