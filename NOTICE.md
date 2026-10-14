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

Linux 6.18.56 as packaged by Alpine Linux 3.24 from the `linux-lts` aport.
The default build uses package `linux-virt`, version 6.18.56-r0.
`--linux-lts` and `--real` use package `linux-lts`, version 6.18.56-r0.
Each comes from the x86_64 or aarch64 repository to match `--arch`. All
listed modules are the selected package's `.ko.gz` files decompressed without
modification.

- Upstream source: https://cdn.kernel.org/pub/linux/kernel/v6.x/linux-6.18.56.tar.xz
- Alpine build recipe, configuration and patches (Corresponding Source),
  pinned to the commit shipping 6.18.56-r0 (the same for both architectures):
  https://gitlab.alpinelinux.org/alpine/aports/-/blob/efc8ddbb20c827d2bd8223c19a2625e754e5cb3c/main/linux-lts/APKBUILD
- Packages:
  https://dl-cdn.alpinelinux.org/alpine/v3.24/main/x86_64/linux-virt-6.18.56-r0.apk
  SHA-256 `755deb045cfeb8c2bcaa2b2febe01ab2101d747921e64d4cd54d0312321e8d5d`
  https://dl-cdn.alpinelinux.org/alpine/v3.24/main/x86_64/linux-lts-6.18.56-r0.apk
  SHA-256 `b0d8cc4d7e031b5619221e7978920d051bf1dd1e335f6d05d03964b2285fc3b4`
  https://dl-cdn.alpinelinux.org/alpine/v3.24/main/aarch64/linux-virt-6.18.56-r0.apk
  SHA-256 `e3839bfd751ff0a4421484f712b9b29efb514024523736a0ef62521521571b12`
  https://dl-cdn.alpinelinux.org/alpine/v3.24/main/aarch64/linux-lts-6.18.56-r0.apk
  SHA-256 `795bcd49840be7f4ff9566f5f669201bd41202376a455b720a98eb814f0e72f8`

SHA-256 of files in the default x86_64 `linux-virt` image:

```text
kernel/x86_64/vmlinuz-virt   dc99c86bb8e58cb4eda5f01eac44c4d972105945a46dfe76a9e86e8529915c72
failover.ko                  ddf94fe8a89b24e839f21866f828adc3eb91e62fa46dd977c74d7c2b6f92fe21
net_failover.ko              fb710ef0450417dea2f6dede919d14f5a4a94b1be73f338cfe2ed05e32f0cc30
virtio_net.ko                2fb98ab7d06cfb7a1e1a07dcc5098da44316360097d75e288a30ad4855c449f7
```

SHA-256 of files in an x86_64 `--linux-lts` image:

```text
kernel/x86_64/vmlinuz-lts   e893ce0f7aecbdf2dcf012659ec5a0b35740780ae5c3af5ad188029f5cd4aa8f
failover.ko                 59e4e4808dca2d18d849c2da850e4ea659485007b09a690c7e57fb0e623cd1df
net_failover.ko             20dd06a6f6f1528079a438630d741f125d11cc9bae58d618e0e6381f8bff6f5c
virtio_net.ko               39bcd12bfc3149351fa226dabdbb1f82137c53f3b1ccbacbf30661bf8ff99ad4
virtio_ring.ko              e8fdebd89345ef39a54d3b23e6f2a57c6c4b201708b35113705b56d0fa373596
virtio.ko                   d4ab148e31f5d4d5a1dd3c3f30bb52ba9a13e670929c9f7f1668396edf8049b7
virtio_pci_legacy_dev.ko    15c35c8875b68dcaed3ac58d463d1b3f2c3e52dcf9a3840366d3fa6da7cd4dd7
virtio_pci_modern_dev.ko    59bd6e34e6cf3c0ce54bab1eca1d7ac0325112280a6718613460002d2cde70d0
virtio_pci.ko               cc3ad8eaffa321bd58dbd663afba074dee81a5ad6f283d50cd5b1b340672430e
```

`--real` additionally includes the following modules from that same
x86_64 `linux-lts` package for physical xHCI controllers and USB HID keyboards:

```text
usb-common.ko               37feaa14670d4bbd3dca77d701344d2fb02e2cb139d21c5af8b2c140aab5c6fe
usbcore.ko                  75efddfd7d1bf996ad99f0d9be790be767ca72ebdb53a00194b449c3588faa16
xhci-hcd.ko                 bd5772b2ba908dff16c74ae10211a1e5cfd72910d861dbdf30b8f71c5995066a
xhci-pci.ko                 6c688038c9b45297fce752c8f0443cd0f398f31e0b4efffd7f869325ce9884fa
xhci-pci-renesas.ko         aa08808c9e609fe570a1c5b90d0f0ba33f2ca2e7d84e8ccbb3a2856fe65a7b3f
hid.ko                      161160bf12d18a24c25aef6355e265142fc4fb2122b09923a6e184fabedf6246
hid-generic.ko              6d5ae3cfd8f8b034cbe444869485ac9012376c4ca604a3cd039f0cae442005f9
usbhid.ko                   6ed1e4891b242f64520621d689a24828dfc24a96236c71b86d9af9361248aa5a
```

SHA-256 of files in the default aarch64 `linux-virt` image:

```text
kernel/aarch64/vmlinuz-virt  039c532c2fa8f49896a679065d79a03b8a444c9d54fa80ac9bc4d0ce1ecd0ca6
failover.ko                  ce65a98acce98720753c4a9a7e339f6c70d22eae70b65cc1b4211543a7c6c3a3
net_failover.ko              39c9222d800ae95d8a82ff797e408187411ac2ff47bec2c9d7ddbfe99537dbe3
virtio_net.ko                762f8e362ae2e2bbf200ab9bc742524999e8bce12c72671bf8560fd9bb7907d5
```

SHA-256 of files in an aarch64 `--linux-lts` image:

```text
kernel/aarch64/vmlinuz-lts  de5ff95fd663a30e53765cb0794707656bb80749d77f16bbf94225d17c512447
failover.ko                 7f3d40067603c9916d22e9d85fea1512bd95c087aaae774e5ea70f8bacb7ae04
net_failover.ko             085e4fd53a40704408b6bf914ee464d16007296fa3615940fa54688afe84466c
virtio_net.ko               4ea86521819063df91cfd18191e8bc2bd2551392e8f7a33126df0aba675ee409
virtio_pci_legacy_dev.ko    baf8033c183819a8bccacf36677247740a5cff9eec9b403b94840af258b60b6e
virtio_pci_modern_dev.ko    2905133de7c9baceff9fc6a27dba9b8469744019545c19cf1456e64f7e50f062
virtio_pci.ko               3b506947c25866e08a311f124cd143bd0f501179f0b556aed7ca4d6632143d8d
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
| `buninu-browser` | 0.2.2 | MIT for the browser's own code; bundled components retain their own terms | https://github.com/jjtseng93/buninu-browser | `buninu-browser/LICENSE`, `THIRD_PARTY_NOTICES.md`, `LICENSES/` and vendor notices within that package |
| `@drxiaozhi/casty` | 1.3.4 | MIT | https://github.com/jjtseng93/casty | `@drxiaozhi/casty/LICENSE` |
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
