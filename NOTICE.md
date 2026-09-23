# Notices

Buninu Linux is licensed under the MIT License; see `LICENSE`.

It redistributes the third-party components below under their own licenses.
The full license texts are in `LICENSES/`. Every SHA-256 here was checked
byte-for-byte against the official Alpine Linux v3.24 x86_64 or aarch64
package (or the official Bun release) it came from. The x86_64 guest is the
default build; `--arch aarch64` builds the other one from the same versions.

The sections below cover the platform: the kernel, the C library, the GCC
runtime, the UEFI stub and Bun. The Buninu userspace under `initramfs/buninu/`
carries its own third-party notices; see the last section.

Alpine's CDN serves only the current pkgrel of each branch, so the package
URLs below stop working once a build is superseded. The pinned aports commits
are permanent and are the Corresponding Source for each exact build.

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

Linux 6.18.53 as packaged by Alpine Linux 3.24 from the `linux-lts` aport.
The default build uses package `linux-virt`, version 6.18.53-r0.
`--linux-lts` and `--real` use package `linux-lts`, version 6.18.53-r0.
Each comes from the x86_64 or aarch64 repository to match `--arch`. All
listed modules are the selected package's `.ko.gz` files decompressed without
modification.

- Upstream source: https://cdn.kernel.org/pub/linux/kernel/v6.x/linux-6.18.53.tar.xz
- Alpine build recipe, configuration and patches (Corresponding Source),
  pinned to the commit shipping 6.18.53-r0 (the same for both architectures):
  https://gitlab.alpinelinux.org/alpine/aports/-/blob/00abeb21803f818099833e761976a578dd1c0380/main/linux-lts/APKBUILD
- Packages:
  https://dl-cdn.alpinelinux.org/alpine/v3.24/main/x86_64/linux-virt-6.18.53-r0.apk
  SHA-256 `cad859cc46342e18002621fdde166bf2cd520dfec5e781d241de7d13e53970d6`
  https://dl-cdn.alpinelinux.org/alpine/v3.24/main/x86_64/linux-lts-6.18.53-r0.apk
  SHA-256 `8e3cfdd1d98e0e70c2e70a8c299ed3cd1e0939d60ad7bbd1da1cf241d794490b`
  https://dl-cdn.alpinelinux.org/alpine/v3.24/main/aarch64/linux-virt-6.18.53-r0.apk
  SHA-256 `fea61b7fd5e72e626d771f9798df56c83db658d0e221044f06fc28aacf5a118b`
  https://dl-cdn.alpinelinux.org/alpine/v3.24/main/aarch64/linux-lts-6.18.53-r0.apk
  SHA-256 `46885041022ea11afa1e07c40199c74146bf72d362368a844338af0c162e365c`

SHA-256 of files in the default x86_64 `linux-virt` image:

```text
kernel/x86_64/vmlinuz-virt   3b6e001d41938fdf4fab7d87826fc40dfab733973a5ef96a14c892dbdec87502
failover.ko                  f52f8dedf68be2a228e84d796170471c7103d88910a14e2307484fe94c4d1a11
net_failover.ko              8fe715d813a1e795cf0b46d54fd67f6c625dfabf1a4eebfeec96ae34f8aab0b1
virtio_net.ko                cdf49d6216ba92313d3e40f065c326d86eae654bcbb811ac53e7c2613e686f1e
```

SHA-256 of files in an x86_64 `--linux-lts` image:

```text
kernel/x86_64/vmlinuz-lts   1b2ba2cad7973637f0f5589f845f7b773e73920e69d26785d2ff21c6c8995dc7
failover.ko                 0fcd683e5023a3910bac2d2eb02eff349ce00d81b572f4a9093a0c70fc1c77f3
net_failover.ko             613809bd8d4c283b7a2b9dba5d8466cc36f478772a86e8c89de5e792bce69207
virtio_net.ko               1fb4ce7a0b546933b1e40d67b3570aec808307dcafead342d3f4bcd5a0523b7c
virtio_ring.ko              eba2c109827a5d3b0e869505268a68d72cd6f2f9cc68778b66145c0503d9561f
virtio.ko                   00d107d78dc1d47a4eea335c6d6b28026ae2c783a9b7629f2cc080bdbc8d2dc3
virtio_pci_legacy_dev.ko    370b8ad3521cbd3934c78eacc5965b20eff29c55c7fcded023c75c5d21424841
virtio_pci_modern_dev.ko    572d719ccad98342ebce909b8dac65ef64379c3a6c97e2d1fb38ff66950d9322
virtio_pci.ko               e64039e30729e535b3ce9394249c79147bab27dfd20b7cf9914cd635dda95fc3
```

`--real` additionally includes the following modules from that same
x86_64 `linux-lts` package for physical xHCI controllers and USB HID keyboards:

```text
usb-common.ko               3c7f2f1de34cafbf64fa3528862539cbe8cd3830cd97110e8401b510835c8761
usbcore.ko                  0fce52fd1836304d48d25ef322558f27304ea9247c5b234f8ac2ecb9d8f00597
xhci-hcd.ko                 22e687fe561127ea4cd1aba21058cbf253d0541ccf315555004f5a94ed7ab727
xhci-pci.ko                 82eb0ea3869da82d1762130a738f2ff3ae6d77b16670f69f7f09cff4e8f3e360
xhci-pci-renesas.ko         07df52a6ee408723938bc8a32cb4a2bfe4cbcf014ff48d23fd7f7ab41c201f6f
hid.ko                      fbe4561a8dd65cd26160cbe9b7c5af23c7920044771e2e08a8aee6aa71141053
hid-generic.ko              acfda4f50e19c055e5d719ebc2b9b8f8c6c076552592dfaabccbe128a9862694
usbhid.ko                   12d3648467db87c2904a11a076c17768d8d51c28fe8ec41046e7d961592a81f1
```

SHA-256 of files in the default aarch64 `linux-virt` image:

```text
kernel/aarch64/vmlinuz-virt  9884ee00ecfff6a0dc9821cc9981b3aca74f741950704776b4335b1e076d96e6
failover.ko                  61b052e5ed3ef01bc6f71d84acb79bfe8cf2e5168f625fce76630dec14bf8b99
net_failover.ko              a0b150f46c7e9aa48156a8b94916ab65a4d8947143b381af56da677436584259
virtio_net.ko                e9c007778d2b0a7d4986cd04b724965a01ffee05ada92f75ce13bf59bef2491c
```

SHA-256 of files in an aarch64 `--linux-lts` image:

```text
kernel/aarch64/vmlinuz-lts  00426cce3a4b2b4972043eeb68a3a2af5645eb7a50ca853c375e41944ac66d27
failover.ko                 b9bea5bb0c956b58faf0f803a205dafd889bfda75e7c59d234f60e65145fbec8
net_failover.ko             d8eb3087b75aba891e93327c6c43f37362cfe49421b7cabfd12f57a34d5c215a
virtio_net.ko               10e73397bbb424b4bdb86781297f6fc30b13091e9a77fc7059e4861c09ef609d
virtio_pci_legacy_dev.ko    476c6762743b9a5789200a31ee339173610f975b42e588914aabf41d8ade2958
virtio_pci_modern_dev.ko    595618d12b67c67a0f29c406f6578d10d010024ac83014855672fd3fd695d6ed
virtio_pci.ko               545a599cb7136a509a33cd3b52e80a8cd2bfa10668b0e766dc52872ce07d510b
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
