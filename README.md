# Buninu Linux
- Buninu Linux is a Linux distribution running Bun as PID 1 with the Buninu userspace.
- The entire userland is based on Bun
- It boots an unsigned UEFI UKI (Unified Kernel Image), a single `.EFI` file inside vda.img with these components
  * a prebuilt kernel from Alpine
  * a prebuilt systemd EFI stub from Alpine
  * initramfs JavaScript components:
  * `/init.js` and other modules
  * initramfs Native components:
  * Official `bun-linux-x64-musl` and its dependencies
    + ld-musl-x86_64.so.1
    + libc.musl-x86_64.so.1 (intentional copy)
    + libgcc_s.so.1
    + libstdc++.so.6
- The kernel runs `bun` as PID 1
  * Everything an init would normally do — mounting filesystems, loading modules, configuring the network, reaping children
  * happens in JavaScript through `bun:ffi`
  * There is no BusyBox and no C bootstrap.

> Still early, tested on Android Termux QEMU
> built in PRoot Debian 13

- The hello-world EFI application in Section 1 is the starting point that the UKI replaces
- It still builds, and it is the quickest way to check whether the disk image and firmware path work at all.

## Quick start

- Two shells are involved, sharing one checkout:
  * Build tools in Debian 13 PRoot,
  * QEMU in native Termux.
- Clone into the Termux home
  * proot-distro exposes that directory inside the guest at the same absolute path
  * So both shells work on the same files
  * (`~` differs between them, the full path does not)

### Steps
#### in native Termux
- pkg install qemu-system-x86-64
- git clone https://github.com/jjtseng93/buninu-linux.git ~/buninu-linux

#### in PRoot (Debian 13)
- apt install binutils-mingw-w64-x86-64 cpio curl dosfstools fakeroot mtools parted unzip
- cd /data/data/com.termux/files/home/buninu-linux
- bun ./index.js -fb
  * fetch ~80 MB from Alpine/Bun & build vda.img

#### back in native Termux
- cd ~/buninu-linux
- bun ./index.js -r
  * boot it

`index.js` runs under bun or node. A successful boot ends like this, with a
REPL on the serial console:

```text
Run /bin/bun as init process
init.js: Bun runtime entered JavaScript
init.js: loading physical musl libc for FFI
init.js: mounted /proc, /sys, /dev, /tmp
init.js: node:repl imported
Buninu Linux: Bun 1.4.2 is PID 1
network: eth0 10.0.2.15/24 via 10.0.2.2
fetch example.com: HTTP 200, text/html
Type bunmsh() to install and enter the bunmsh shell.
bun-init>
```

Ctrl-C stops QEMU. After editing `initramfs/init.js`, `bun ./index.js -b` in
PRoot rebuilds the image; `-h` lists the flags. Section 0 explains each
dependency, Section 2 the build and how PID 1 works.

## 0. Install dependencies

- Building Buninu Linux (Section 2) — needs no compiler:
- Bun ships as a prebuilt binary and the UKI is assembled with `objcopy`.

```sh
apt install binutils-mingw-w64-x86-64 cpio curl dosfstools fakeroot mtools parted unzip
```

- A C toolchain is only needed for:
  * The hello world .EFI (Section 1)
    + `hello/hello.c`
  * The retired bootstrap in `test/build-init-bootstrap.sh`

```sh
apt install clang lld
```

The baseline is the stock Debian 13 (trixie) OCI image, which is also what this
PRoot is; a dependency is anything that image does not already have.
`debian:13` and `debian:13-slim` carry the same 78 packages and identical
binaries in every `PATH` directory — slim only drops docs, man pages and
locales — so `debian:13-slim` is the better starting point at 105 MB against
149 MB, and the list below is the same either way.

The base image already provides `bash`, GNU `tar`, `gzip`, `sha256sum`,
`mknod`, `find`, `sort`, `mkdir`, `mktemp`, `cp`, `rm`, `chmod`, `truncate`,
`dd`, `printf`, `awk` and `dirname`, all used by these scripts as they are.
Everything else has to be added. For Section 2:

* **`binutils-mingw-w64-x86-64`** — `x86_64-w64-mingw32-objcopy` appends the
  `.osrel`, `.cmdline`, `.linux` and `.initrd` sections to the EFI stub, and
  `x86_64-w64-mingw32-objdump` reads `ImageBase` back out of it. Both need a
  PE-aware binutils: the ELF `objcopy` cannot write these sections, and
  `llvm-objcopy` rejects `--change-section-vma`.
* **`cpio`** — writes `build/initramfs.cpio.gz`. The scripts pass
  `--owner=0:0 --reproducible`, so it has to be GNU cpio rather than a busybox
  applet.
* **`curl`** — fetches the Alpine `.apk` packages and the Bun release zip.
* **`dosfstools`** — `mkfs.fat` formats the ESP, and its `-h` hidden-sector
  count has to match the sector the partition starts at.
* **`fakeroot`** — lets `mknod` and `cpio` record root-owned character devices
  in the archive without real root, which PRoot cannot grant.
* **`mtools`** — `mmd` and `mcopy` create `/EFI/BOOT` inside the FAT image and
  copy the UKI in, without a mount or a loop device.
* **`parted`** — writes the protective MBR, the primary and backup GPT, and the
  ESP partition entry with its type GUID.
* **`unzip`** — extracts the `bun` binary from the release zip.

To boot, from native Termux rather than PRoot:

* **`qemu-system-x86_64`** — not an `apt` dependency: `pkg install
  qemu-system-x86-64` provides it together with the OVMF firmware at
  `$PREFIX/share/qemu/edk2-x86_64-code.fd`.
* **`bun`** (or `node`) — runs `index.js`; needed in both shells. Install bun
  from <https://bun.sh>, or `pkg install nodejs` / `apt install nodejs`. Under
  bun, `--readme` renders the Markdown; under node it is printed as-is.

For Section 1 and the retired bootstrap only:

* **`clang`** *(Section 1 only)* — compiles `hello/hello.c` to a PE32+ object
  (`--target=x86_64-pc-win32-coff`) and, in `test/build-init-bootstrap.sh`, the
  freestanding x86-64 `/init`. Nothing in the Bun path compiles anything.
  Resolves to `clang-19` on trixie.
* **`lld`** *(Section 1 only)* — `lld-link` links `hello/hello.obj` into an EFI
  application (`/subsystem:efi_application`), and the same package backs
  `clang -fuse-ld=lld` for the bootstrap. Resolves to `lld-19`.

`parted`, `dosfstools` and `mtools` back `build-image.sh`, which both sections
use.

## 1. Hello world

- `hello/hello.c` is a freestanding PE32+ EFI application installed at the
  removable media fallback path `EFI/BOOT/BOOTX64.EFI`.
- It's a smoke test rather than the complete Buninu Linux

```sh
./hello/build-hello.sh   # in PRoot
./build-image.sh         # in PRoot
bun ./index.js -r        # in native Termux
```

It writes `Hello world from x64 UEFI!` to the UEFI console. The included OVMF
firmware exposes that console over COM1 and `run-qemu.sh` attaches COM1 to the
current terminal, so the message is visible without a graphical display. The
application waits after printing; press any key to return to the OVMF
interface, then Ctrl-C to stop QEMU.

`build-image.sh` is shared with Section 2 — see [Disk layout](#disk-layout).

## 2. Buninu Linux – Bun as PID 1

An unsigned x64 Unified Kernel Image assembled from official Alpine packages,
with Bun as the init process, replaces the hello-world application:

```sh
bun ./index.js -fb   # in PRoot
bun ./index.js -r    # in native Termux
```

`index.js` is the single entry point (`npm run build` / `npm run pack` /
`npm start` call it too). It has three stage flags that combine in any order
and always run as fetch → build → run:

| flag | runs | use it when |
| --- | --- | --- |
| `-f`, `--fetch` | `fetch-alpine.sh`, `fetch-bun.sh` | first clone, or after bumping a pinned version |
| `-b`, `--build` | `build-uki.sh`, `build-image.sh` | after editing `initramfs/init.js` or the kernel command line |
| `-r`, `--run` | `run-qemu.sh` | to boot what is there |

`-fbr` is the whole pipeline, `-br` is the edit-and-boot loop, and anything
after `--` is handed to `qemu-system-x86_64` verbatim (`-r -- -m 1G`). Before
starting, it checks that every tool the chosen stages need is on `PATH` and
lists what is missing instead of failing halfway; fetch and build want the
PRoot toolchain from Section 0, run wants Termux's QEMU. The shell scripts are
what actually does the work and each still runs on its own.

```text
index.js                  entry point: -f / -b / -r
fetch-alpine.sh           [fetch]  kernel, EFI stub, musl, virtio_net modules
fetch-bun.sh              [fetch]  Bun, libstdc++, libgcc
build-uki.sh              [build]  UKI; calls scripts/pack-initramfs.sh
build-image.sh            [build]  GPT disk image; shared with Section 1
run-qemu.sh               [run]
fetch-plus-build.sh       shell-only -fb
scripts/fetch.sh          hash-checked download helper, sourced by fetch-*.sh
scripts/pack-initramfs.sh cpio archive with the device nodes
hello/                    Section 1: hello.c and build-hello.sh
test/                     the retired C bootstrap and its build script
initramfs/                init.js and the committed libraries; rest fetched
```

The pinned inputs are Alpine v3.24 `linux-virt-6.18.52-r0`, musl `1.2.6-r2`,
`systemd-efistub-260.2-r0`, `libstdc++`/`libgcc` `15.2.0-r5`, and Bun 1.4.2
`linux-x64-musl-baseline` — about 80 MB in total. No BusyBox, and no userland
beyond Bun itself.

Every step is idempotent and `-f` re-downloads nothing: `scripts/fetch.sh`
treats each pinned SHA-256 as the cache key, so a file already in `downloads/`
with the right hash is used as-is, and anything missing, truncated, stale or
tampered with is fetched again and has to pass the same hash before a script
extracts from it. Bumping a version changes both the file name and the hash, so
it always refetches.

### Build pipeline

`fetch-plus-build.sh` is only a wrapper, the same as `bun ./index.js -fb`: it
runs the steps below in order. Each one writes files the next one reads.

| script | reads | writes |
| --- | --- | --- |
| `fetch-alpine.sh` | Alpine CDN | `kernel/vmlinuz-virt`, `kernel/linuxx64.efi.stub`, `initramfs/lib/ld-musl-x86_64.so.1`, `initramfs/lib/modules/…/{failover,net_failover,virtio_net}.ko` |
| `fetch-bun.sh` | GitHub, Alpine CDN | `initramfs/bin/bun`, `initramfs/lib/{libc.musl-x86_64.so.1,libstdc++.so.6,libgcc_s.so.1}` |
| `scripts/pack-initramfs.sh` | `initramfs/` | `build/initramfs.cpio.gz` |
| `build-uki.sh` | that archive, kernel, stub | `build/cmdline`, `build/os-release`, `vda/EFI/BOOT/BOOTX64.EFI` |
| `build-image.sh` | `vda/EFI/BOOT/BOOTX64.EFI` | `vda.img` |

`build-uki.sh` calls `scripts/pack-initramfs.sh` itself, so that one is rarely
run directly.

The stages nest — the initramfs is baked into the UKI, and the UKI into the
disk image — so a one-line edit to `initramfs/init.js` still needs both of:

```sh
bun ./index.js -b      # or: ./build-uki.sh && ./build-image.sh
```

The kernel command line works the same way: `build-uki.sh` writes it to
`build/cmdline` and compiles it into the UKI. Nothing reads it from disk at
boot.

### UKI layout

`build-uki.sh` appends sections to systemd's `linuxx64.efi.stub` with
`objcopy`, at hand-picked VMAs because `objcopy` will not lay them out for you:

| section | offset from image base | contents | size |
| --- | --- | --- | --- |
| `.text` | +0x0 | the stub itself | 66 KB |
| `.osrel` | +0x20000 | `build/os-release` | 78 B |
| `.cmdline` | +0x30000 | `build/cmdline` | 92 B |
| `.linux` | +0x2000000 | `kernel/vmlinuz-virt` | 12 MB |
| `.initrd` | +0x3000000 | `build/initramfs.cpio.gz` | 34 MB |

The result is a single 46 MB PE32+ file holding kernel, initramfs and command
line.

### Disk layout

`build-image.sh` needs no mount, no loop device and no root privilege. It
formats a standalone FAT32 image, fills it with mtools, builds the GPT with
`parted`, and `dd`s the filesystem into the partition with
`conv=notrunc,sparse`. The `mkfs.fat -h 2048` matters: the FAT hidden-sector
count has to match the sector the partition will start at, or some firmware
rejects the volume.

```text
LBA 0              protective MBR
LBA 1..33          primary GPT
LBA 2048..262110   ESP, FAT32 "EFIBOOT", type GUID C12A7328-F81F-11D2-BA4B-00A0C93EC93B
                     /EFI/BOOT/BOOTX64.EFI     the UKI
LBA 262111..       backup GPT
```

128 MiB sparse, 1 MiB-aligned, with 34 sectors reserved at the end for the
backup GPT. `EFI/BOOT/BOOTX64.EFI` is the removable-media fallback path, so the
firmware runs it without any NVRAM boot entry.

### Running

`bun ./index.js -r` runs `run-qemu.sh`, which boots `vda.img` on q35 under
TCG with 512 MiB, a virtio disk, virtio-net user networking, no display, and
COM1 on stdio; anything after `--` is appended to the QEMU command line. The
chain is OVMF → the stub's `.text` → the stub loading its own
`.linux`/`.initrd`/`.cmdline` → kernel → `rdinit=/bin/bun`.

Ctrl-C quits QEMU. Leaving the REPL does not end the session: `init.js`
restarts it, because a PID 1 that exits panics the kernel.

Two things to expect:

* **Booting modifies `vda.img`.** The firmware is attached read-only and has no
  separate variable store, so OVMF persists its NV variables as `/NvVars` on
  the ESP. `git status` reports `vda.img` as modified after every boot.
* **QEMU write-locks `vda.img`.** A second instance fails with `Failed to get
  "write" lock`; copy the image first if you want two at once.

### Iterating on the boot

Rebuilding the UKI and the disk image for every attempt is slow, and neither is
needed to exercise the guest: QEMU can boot the kernel and initramfs directly
and take the command line on the host side, so only
`./scripts/pack-initramfs.sh` has to be re-run between attempts.

```sh
qemu-system-x86_64 -machine q35,accel=tcg -cpu max -m 512M \
    -kernel kernel/vmlinuz-virt -initrd build/initramfs.cpio.gz \
    -append "console=ttyS0,115200 panic=0 PATH=/bin rdinit=/bin/bun -- -e console.log(1+1)" \
    -nic user,model=virtio-net-pci -display none -serial stdio -no-reboot
```

A panicking guest does not exit QEMU — `panic=0` parks it rather than rebooting
into the firmware menu — so press Ctrl-C. Run the real UEFI path once at the
end, since it is the only thing that exercises the stub and the GPT.

### Reaching JavaScript with nothing mounted

The kernel command line is

```text
console=tty0 console=ttyS0,115200 panic=0 PATH=/bin rdinit=/bin/bun -- -e import('/init.js')
```

so the kernel execs `/bin/bun` itself, with nothing native in between, and
`init.js` mounts `/proc`, `/sys`, `/dev` and `/tmp` through `bun:ffi` as its
first action. Everything before `--` needs an `=`, because the kernel appends
any bare word to the init argv instead of treating it as an environment
assignment; everything after `--` becomes `argv[1..]` verbatim, with `argv[0]`
set to the `rdinit=` path. Parameter order is otherwise free, so `rdinit=` is
placed last and the tail of the line reads as the `bun -e …` it turns into.

Two separate things have to be true for this to work.

**The entry point must be `-e`, not a file.** `bun /init.js` opens the entry
file and then `readlink("/proc/self/fd/N")` to canonicalize it
(`maybe_open_with_bun_js` in `src/runtime/cli/run_command.rs`); it gives up
when that fails, which is what a /proc-less boot runs into. `-e` never opens an
entry file, so it skips that step. Bun's startup does *not* resolve
`/proc/self/exe` — that is memoized behind `process.execPath`/`process.argv[0]`
and falls back to `argv[0]` — and the remaining `/proc` reads during startup
(`vm/overcommit_memory`, `vm/mmap_min_addr`, `self/cgroup`, `self/statm`) are
all non-fatal.

**`/dev/urandom` must exist before Bun starts.** JSC's `OSRandomSource` calls
`CRASH()` when it cannot open it, and as PID 1 that is an instant kernel panic:

```text
panic(main thread): abort() called
traps: bun[1] trap invalid opcode
Kernel panic - not syncing: Attempted to kill init!
```

Nothing has mounted devtmpfs at that point, so `scripts/pack-initramfs.sh`
records `urandom` — along with `console`, which the kernel opens as init's
fd 0/1/2 before the exec, and a few other harmless nodes — directly in the
cpio archive.
`ttyS0` is listed last among the `console=` arguments so it, rather than the
invisible `tty0`, is what `/dev/console` points at.

The initramfs holds no `/init`; the kernel reaches Bun through `rdinit=` alone.
The retired native bootstrap is kept in `test/build-init-bootstrap.sh`, which
rebuilds it as `/init` — useful for mounting something before Bun starts, or
for bisecting a boot failure by exec'ing Bun with different arguments. Build
it, repack, and boot it with `rdinit=/init`. Varying which filesystems such a
bootstrap mounted before the exec is how the `/dev/urandom` requirement above
was found.

### What init.js does

It installs signal handlers, loads a separate physical copy of musl through
`bun:ffi`, prints a greeting, and starts `node:repl`. The loader and libc paths
contain identical bytes but are deliberately distinct inodes:

```text
/lib/ld-musl-x86_64.so.1
/lib/libc.musl-x86_64.so.1
```

Calling `dlopen` on the same musl inode that is already acting as Bun's loader
deadlocks, while the independent physical libc works. It provides `mount`,
`waitpid`, networking calls, and the generic `syscall` entry point, so no
custom `libinit.so` is needed.

The Bun init also loads Alpine's three compressed `virtio_net` modules through
musl's generic `syscall`, configures QEMU user networking as `10.0.2.15/24`
with the standard `10.0.2.2` gateway and `10.0.2.3` DNS proxy, and fetches
`http://example.com` before opening the REPL.

The REPL exposes a global `bunmsh()` function. Calling it creates
`/tmp/bunmsh-runtime`, installs the pinned `bunmsh@0.3.6` package there, and
directly runs its `src/main.js` with a small explicit environment. The calls
are synchronous so bunmsh exclusively owns the terminal until `exit` returns
to the Bun REPL.

## Authorship

Buninu Linux is written and maintained by Dr. John (醫者小智), the author of
[Buninu](https://github.com/jjtseng93/buninu), whose userspace it runs. The
kernel, the C library, the GCC runtime, the UEFI stub and Bun itself are the
work of their respective projects; [NOTICE.md](NOTICE.md) names each one with
the exact version, package and SHA-256 that ships here.

## License

Everything in this repository that is not listed in the table below — the
build scripts, `hello/hello.c`, `init.js`, the retired bootstrap, and the
configuration and metadata files — is Buninu Linux's own work under the MIT
License; see [LICENSE](LICENSE).

The repository also commits four third-party binaries under `initramfs/lib/`,
and the built image redistributes several more. Each stays under its own
terms, with the full texts in [`LICENSES/`](LICENSES/):

| Component | License | Where |
|---|---|---|
| musl (`ld-musl-x86_64.so.1`, `libc.musl-x86_64.so.1`) | MIT | committed |
| GCC runtime (`libgcc_s.so.1`, `libstdc++.so.6`) | GPL-3.0-or-later with the GCC Runtime Library Exception | committed |
| Linux kernel and `virtio_net` modules | GPL-2.0-only with the Linux syscall note | image only |
| systemd EFI stub | LGPL-2.1-or-later | image only |
| Bun | MIT, plus the licenses of what it statically links | image only |

One component is worth naming here rather than leaving to be found: the two
GCC runtime libraries are **GPL-3.0 with the GCC Runtime Library Exception**.
That exception is what lets them ship next to MIT-licensed code, so nothing
here changes Buninu Linux's own terms — but if your organisation screens for
GPL, this is the component it will find. [NOTICE.md](NOTICE.md) records the
exact Alpine build of every component, the pinned aports commit that is its
Corresponding Source, and SHA-256 sums for every binary.
