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

- Souce: [github.com/jjtseng93/buninu-linux](https://github.com/jjtseng93/buninu-linux)
- Buninu userspace source: [github.com/jjtseng93/buninu](https://github.com/jjtseng93/buninu)
  + **BUNinu Is Not Unix** 🐮
  + **幫你牛** 🐂 ・ **Bunに入魂** 🔥
- <img src="https://raw.githubusercontent.com/jjtseng93/buninu/main/icon.png" width="256">
- Still in the early stages
  * Built & tested on Android Termux QEMU (PRoot+Native)
  * [Video here](https://www.reddit.com/r/bun/comments/1wkpraj/buninu_linux_a_distro_with_bun_as_pid_1): Booted successfully on real x86-64 UEFI hardware with `--real`: Bun reached
    its interactive REPL on the local display and keyboard. Physical networking
    is not implemented yet, but the bundled `jmi` editor and local JavaScript
    execution work.
  * Built & booted in a cloud VM provided by ChatGPT Work mode, running Ubuntu 24.04.3 LTS on x86-64 with QEMU 8.2.2, TCG, and OVMF. Bun 1.4.2 was verified running as PID 1, and the Buninu userspace and bunmsh started successfully.

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
init.js: mounted /proc, /sys, /dev, /tmp, /dev/pts
network: lo 127.0.0.1/8
network: eth0 10.0.2.15/24 via 10.0.2.2
fetch example.com: HTTP 200, text/html

Welcome to Buninu Linux!
Bun 1.4.2 is now PID 1

Type start() to run buninu --local
bun-repl>
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

`--linux-lts` selects Alpine's general-purpose LTS kernel. `--real` implies
`--linux-lts` and builds for physical hardware: it makes `tty0` the primary
console and includes the xHCI/USB HID modules needed by a typical USB keyboard.

`-fbr` is the whole pipeline, `-br` is the edit-and-boot loop, and anything
after `--` is handed to `qemu-system-x86_64` verbatim (`-r -- -m 1G`). Before
starting, it checks that every tool the chosen stages need is on `PATH` and
lists what is missing instead of failing halfway; fetch and build want the
PRoot toolchain from Section 0, run wants Termux's QEMU. The shell scripts are
what actually does the work and each still runs on its own.

```text
index.js                  entry point: -f / -b / -r / --linux-lts / --real
fetch-alpine.sh           [fetch]  kernel, EFI stub, musl, network/input modules
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
| `fetch-alpine.sh` | Alpine CDN | `kernel/vmlinuz-virt`, `kernel/linuxx64.efi.stub`, `initramfs/lib/ld-musl-x86_64.so.1`, `initramfs/lib/modules/…/` (virtio_net, virtio_blk, ext4, vfat, exfat, ntfs3, NLS tables, each with its dependencies, plus a trimmed `modules.dep`/`modules.alias`/`modules.builtin`) |
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

#### Real hardware

Build the physical-machine image in PRoot, then write the complete `vda.img`
(not its inner FAT partition) to a USB drive and boot it as x86-64 UEFI media:

```sh
bun ./index.js -fb --real
```

`--real` uses Alpine `linux-lts`, adds the xHCI and USB HID module chain, and
changes the embedded console order to:

```text
console=ttyS0,115200 console=tty0
```

Serial kernel logging is retained, while `/dev/console` and the Bun REPL use
the physical display and keyboard. The UKI is unsigned, so Secure Boot must be
disabled unless the image is signed separately.

This path has been tested successfully on real hardware: the machine entered
the interactive `bun-repl>` with working local keyboard input. Physical NIC
drivers and configuration are not included yet, so networking is currently
expected to fail there; that failure is caught and does not prevent local use.

From the Bun REPL, start the bundled Buninu userspace:

```text
bun-repl> start()
```

The bundled `jmi` terminal editor works without a network connection. For
example, open a new `hlw.js` from the Buninu shell:

```sh
jmi hlw.js
```

The recommended colour theme for `jmi` is `cmc-tc`. Once inside the editor,
press `Ctrl-E`, type `theme ` (including the trailing space), press `Tab`, then
use the `Up` and `Down` arrow keys to select `cmc-tc` and press `Enter`.

Enter and save this content:

```js
console.log("Hello world from real hardware");
```

After leaving the editor, execute it locally:

```sh
bun hlw.js
```

The normal QEMU image should still be built without `--real`, because QEMU's
default runner uses `-display none` and expects the Bun REPL on `ttyS0`:

```sh
bun ./index.js -fb --linux-lts
```

#### Networking

The NIC is QEMU user-mode networking (SLIRP): the guest is `10.0.2.15/24`
behind a NAT with `10.0.2.2` as gateway and `10.0.2.3` as DNS, so it can reach
out — `fetch example.com` at boot proves it — but nothing reaches in unless a
port is forwarded. `PORTS` does that, space-separated, as `host[:guest]` with
`guest` defaulting to `host`:

```sh
PORTS="18080" bun ./index.js -r           # host 127.0.0.1:18080 → guest :18080
PORTS="18080 2222:22" bun ./index.js -r   # …plus host 127.0.0.1:2222 → guest :22
```

`run-qemu.sh` turns each entry into `hostfwd=tcp:127.0.0.1:H-:G`. Two things
follow from how SLIRP forwards:

* The host side binds `127.0.0.1` only, so nothing is exposed on the device's
  own network interfaces. Drop the address (`hostfwd=tcp::H-:G`) to change
  that.
* A forwarded connection arrives at the guest's `eth0` address, so the service
  inside has to listen on `0.0.0.0` (or `10.0.2.15`). One bound to the guest's
  own `127.0.0.1` gets no traffic from outside; verified with two servers on
  forwarded ports, one on each address.

The guest's `127.0.0.1` still works for anything inside the guest: `init.js`
brings `lo` up right after mounting, which is when the kernel assigns
`127.0.0.1/8`. Without that step every bind to `127.0.0.1` fails with
`EADDRNOTAVAIL`.

Two things to expect:

* **Booting modifies `vda.img`.** The firmware is attached read-only and has no
  separate variable store, so OVMF persists its NV variables as `/NvVars` on
  the ESP. `git status` reports `vda.img` as modified after every boot.
* **QEMU write-locks `vda.img`.** A second instance fails with `Failed to get
  "write" lock`; copy the image first if you want two at once.

### Commands in /bin

Besides `bun` (and `sh`/`node` pointing at it), `/bin` carries three commands
written as Bun scripts on top of two shared modules in `/lib`:

| command | does | manual |
| --- | --- | --- |
| `mount` | `mount(2)` with type detection, `-o` parsing, `LABEL=`/`UUID=`, bind/move/remount; loads the filesystem and disk modules it needs | `mount --help` → `/usr/share/doc/buninu-linux/mount.md` |
| `umount` | `umount2(2)` with `-l`, `-f`, `-R` | `umount --help` |
| `ip` | iproute2 grammar over `SIOC*` ioctls and `/proc/net`: `link`, `addr`, `route`, `neigh` | `ip --help` |

`--help` renders the Markdown manual with `Bun.markdown.ansi`, hyperlinks
included. The shared pieces:

* `/lib/dlopen.js` — one `bun:ffi` binding to `/lib/libc.musl-x86_64.so.1`
  (`mount`, `umount2`, `ioctl`, `socket`, `syscall`, …), `errno`/`strerror`,
  a `SysError` class and the `showDocument()` helper behind every `--help`.
  `init.js` keeps its own copy of the binding because it runs before `/proc`
  exists and cannot import anything.
* `/lib/modprobe.js` — `modprobe(name)` resolves `modules.alias` and
  `modules.dep` under `/lib/modules/<release>/` and calls `finit_module`
  for each dependency in order. The kernel has no `/sbin/modprobe` to call
  here, so `mount` preloads `ext4`+`jbd2`, `vfat`+NLS tables, `ntfs3`,
  `virtio_blk`, and so on itself.

```sh
mount /dev/vda1 /mnt --mkdir           # the ESP: vfat detected, modules loaded
mount -t tmpfs -o size=64M tmpfs /tmp/x
mount -t ntfs3 -o force /dev/sda3 /mnt/windows
ip -br addr && ip route
ip addr replace 10.0.2.20/24 dev eth0 && ip route replace default via 10.0.2.2
```

Which modules the image carries is the list in `fetch-alpine.sh`; the
`select_module` helper there pulls in dependencies from Alpine's
`modules.dep`, and `--real` adds the disk controllers (`sd_mod`, `ahci`,
`nvme`, `usb-storage`), the wired NICs and the ACPI power drivers. Alpine's
kernels build all of these as modules; a self-built kernel with them `=y`
works the same way, the loaders just find nothing to load.

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

The default QEMU kernel command line is

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
`bun:ffi`, mounts `/proc`, `/sys`, `/dev`, `/tmp` and `/dev/pts` (without
the devpts mount every pty open fails with `ENODEV`, since `/dev/ptmx`
resolves through `/dev/pts/ptmx`), prints a greeting, and starts `node:repl`. The loader and libc paths
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

On a `--real` image the REPL also offers the getter-based `cfg` namespace:
`cfg.eth`, `cfg.mod` and `cfg.bat` run as soon as the property is read, without
parentheses. `cfg.eth` loads every packaged network module (including PHY and bus support),
then reads the `modalias` of every PCI network device, virtio net device and
USB device, matches it against the `pci:`/`virtio:`/`usb:` lines
`fetch-alpine.sh` kept in `modules.alias` and lists the interfaces. `cfg.mod`
unconditionally attempts every packaged module and recursively loads its
declared dependencies. `--real` ships Intel `e1000`/`e1000e`/`igb`/`igc`,
Realtek `r8169`, Atheros `alx`, Broadcom `tg3` and the `r8152`/`ax88179_178a`/
`cdc_ether` USB dongles. `cfg.bat` loads the ACPI
`battery`, `ac`, `button` and `thermal` modules through `/lib/modprobe.js`
and lists `/sys/class/power_supply` (a desktop without a battery simply
reports nothing registered). Nothing loads them at boot. PID 1 also installs
`uncaughtException`/`unhandledRejection` listeners: without them a stray
`Promise.reject()` at the prompt makes Bun exit, which is a kernel panic
(`Attempted to kill init!`).

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

Buninu Linux's own work — the build scripts, `hello/hello.c`, `init.js`, the
retired bootstrap, and the configuration and metadata files — is under the
MIT License; see [LICENSE](LICENSE). The Buninu userspace under
`initramfs/buninu/` is also MIT (`initramfs/buninu/LICENSE`) and carries its
own third-party notices, listed at the end of [NOTICE.md](NOTICE.md).

The repository also commits four third-party platform binaries under
`initramfs/lib/`, and the built image redistributes several more. Each stays
under its own terms, with the full texts in [`LICENSES/`](LICENSES/):

| Component | License | Where |
|---|---|---|
| musl (`ld-musl-x86_64.so.1`, `libc.musl-x86_64.so.1`) | MIT | committed |
| GCC runtime (`libgcc_s.so.1`, `libstdc++.so.6`) | GPL-3.0-or-later with the GCC Runtime Library Exception | committed |
| Linux `virt`/`lts` kernels and VirtIO, networking, xHCI, USB and HID modules | GPL-2.0-only with the Linux syscall note | image only |
| systemd EFI stub | LGPL-2.1-or-later | image only |
| Bun | MIT, plus the licenses of what it statically links | image only |

One component is worth naming here rather than leaving to be found: the two
GCC runtime libraries are **GPL-3.0 with the GCC Runtime Library Exception**
(as are the aarch64 `libgcc_s.so.1` / `libstdc++.so.6` that Buninu's
`apps/musl-la/` commits and the image carries along). That exception is what
lets them ship next to MIT-licensed code, so nothing here changes Buninu
Linux's own terms — but if your organisation screens for GPL, these are the
components it will find. [NOTICE.md](NOTICE.md) records the
exact Alpine build of every component, the pinned aports commit that is its
Corresponding Source, and SHA-256 sums for every binary.
