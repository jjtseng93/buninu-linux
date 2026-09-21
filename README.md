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

---

- Still in the early stages
- [Video here](https://www.reddit.com/r/bun/comments/1wkpraj/buninu_linux_a_distro_with_bun_as_pid_1): Booted successfully on real x86-64 UEFI hardware with `--real`:
  * Bun reaches its interactive REPL
  * start() starts the Buninu userspace shell
  * `cfg.disk` + shell `mount` mounts local disks
  * `cfg.net` loads common wired NIC and Android USB-tethering drivers
  * Android phone USB tethering over RNDIS has been tested successfully, allowing Buninu Linux to access the Internet through an Android phone
  * IP addresses and routes are configured manually because the image does not yet include a DHCP client.
  * The bundled `jmi` editor, `jsmdcui` app runtime, and local JavaScript execution also work.

---

- The hello-world EFI application in [Section 1](#1-hello-world) is the starting point that the UKI replaces
- It still builds, and it is the quickest way to check whether the disk image and firmware path work at all.

## Quick start

- This guide builds a bootable `buninu-linux-<version>.img`
- The documented build environment is Debian 13 under Termux PRoot
- A regular Debian installation works as well.
- For a source checkout, clone into the Termux home so native Termux and PRoot
  can share it; `~` differs between them, but the absolute path is the same.

### Steps

- Before anything, install Bun in Debian first:

```sh
apt update
apt install curl unzip
curl -fsSL https://bun.sh/install | bash
```

- Small tip: The below `apt install` command shows in the terminal when you run -b without the needed tools

#### Build directly with bun x

Install the build tools, enter a directory where
you want to keep the finished image, then run the published package:

```sh
apt install binutils-mingw-w64-x86-64 cpio curl dosfstools fakeroot mtools parted unzip

mkdir -p /data/data/com.termux/files/home/buninu-build
cd /data/data/com.termux/files/home/buninu-build

$HOME/.bun/bin/bun x buninu-linux --version

$HOME/.bun/bin/bun x buninu-linux -fb --real --export
```

`--export` copies the completed `vda.img` out of bunx's package directory and
into the directory where the command was invoked, as
`buninu-linux-<version>.img`. Use the exact exported filename printed by the
command when writing the USB drive.

#### Or build from a source checkout

In native Termux:

- git clone https://github.com/jjtseng93/buninu-linux.git ~/buninu-linux

In Debian 13 under PRoot:

- apt install binutils-mingw-w64-x86-64 cpio curl dosfstools fakeroot mtools parted unzip
- cd /data/data/com.termux/files/home/buninu-linux
- bun ./index.js -fb --real --export
  * Fetches from Alpine/Bun
  * Selects the physical-hardware modules
  * Builds `vda.img`
  * Exports it to `buninu-linux-<version>.img`

#### Write the image to a USB drive

Write the complete exported image (or `vda.img` when not using `--export`), not
the FAT partition inside it, to a USB drive. The source filename below is an
example; replace it with the exact name printed by the build. The destination
is also only an example: identify the correct whole-disk device first, because
this overwrites it completely.

```sh
sudo dd if='buninu-linux-<version>.img' of=/dev/sdX bs=4M conv=fsync status=progress
```

#### Booting from the USB drive

Boot that drive as x86-64 UEFI media. The UKI is unsigned, so disable Secure
Boot unless you sign it yourself. A successful physical boot reaches the local
display and USB keyboard with a welcome ending like this:

```text
Welcome to Buninu Linux!
Bun 1.4.2 is now PID 1
Type start() to run buninu --local
Configuration getters: cfg.all, cfg.disk, cfg.net, cfg.power

bun-repl>
```

If this welcome is not visible, later kernel messages may simply have scrolled
over it on the same console. Press Enter at an empty REPL prompt; an empty or
whitespace-only line prints the welcome and current `cfg.*` getter list again.

Load only the subsystem needed, then enter the Buninu shell:

```js
cfg.net       // wired NIC and Android USB-tethering drivers
cfg.disk      // SATA/NVMe/USB storage drivers and detected block devices
cfg.power     // battery, AC, button and thermal drivers
start()
```

There is no DHCP client yet; configure a detected wired interface with `ip` as
described under [Real hardware](#real-hardware). Run `poweroff` for a synced
shutdown. After editing the initramfs, `bun ./index.js -b --real --export` rebuilds the
image; `-h` lists all flags.

## Running

### Real hardware

Real hardware is the primary target. Boot the USB drive with Secure Boot
disabled unless you have signed the UKI yourself. The physical display and USB
keyboard provide the `bun-repl>` prompt.

Load only the hardware subsystem you need:

```js
cfg.net
cfg.disk
cfg.power
```

`cfg.net` loads the packaged wired-network and Android USB-tethering drivers and prints detected
interfaces and MAC addresses. There is no DHCP client yet, so configure the
interface manually after entering the Buninu shell with `start()`:

```sh
ip link set eth0 up
ip addr add 192.168.1.50/24 dev eth0
ip route add default via 192.168.1.1
```

The real image initializes `/etc/resolv.conf` with `1.1.1.1` and `8.8.8.8`;
replace them if your network requires different DNS servers. `cfg.disk` loads
common SATA/PATA/SCSI, NVMe/VMD and USB-storage drivers so detected disks and
partitions appear in `/dev`. To inspect a filesystem without mounting it:

```sh
mount -fv /dev/sda1 /mnt
```

Run `poweroff` for a synced shutdown.

The bundled `jmi` terminal editor works without a network connection:

```sh
jmi hlw.js
```

- The recommended `jmi` color theme is `cmc-tc`
- Set it by: 
  * Press `Ctrl-E`
  * Type `theme ` (including the trailing space)
  * Press `Tab`, select it with up/dn keys
  * Press `Enter`. 
  
- Enter and save(Ctrl-S) this content:

```js
console.log("Hello world from real hardware");
```

After leaving the editor with `Ctrl-Q`, run it locally:

```sh
bun hlw.js
```

- Sometimes `Enters` in some scenarios don't directly work; if that's the case, try `Ctrl-J` or `Ctrl-M`

## Commands inside /bin

Besides `bun` (and `sh`/`node` pointing at it), `/bin` includes seven commands
implemented as Bun scripts:

| command | does | manual |
| --- | --- | --- |
| `mount` | `mount(2)` with type detection, `-o` parsing, `LABEL=`/`UUID=`, bind/move/remount; loads required filesystem and disk modules | `mount --help` → `/usr/share/doc/buninu-linux/mount.md` |
| `umount` | `umount2(2)` with `-l`, `-f`, `-R` | `umount --help` |
| `ip` | iproute2 grammar over `SIOC*` ioctls and `/proc/net`: `link`, `addr`, `route`, `neigh` | `ip --help` |
| `ps` | all processes from `/proc` as the `PID COMMAND` table used by bunmsh `pspa`/`pspac` | `ps --help` |
| `poweroff` | sync pending writes and power off through the Linux reboot system call | `poweroff --help` |
| `reboot` | sync pending writes and restart through the shared Linux reboot logic | `reboot --help` |
| `tar` | create, extract, or list tar archives with gzip and zstd compression through `Bun.Archive` | `tar --help` |

The small `tar` follows the current `Bun.Archive` boundary: extraction
restores directories and symbolic links, while hard links are skipped by Bun
1.4.3. Creation stores regular files but not Unix metadata, links, or empty
directories, and listing reports regular files only. It supports gzip and
Bun's built-in zstd, not xz or bzip2.

`--help` renders each Markdown manual in the terminal. Common examples:

```sh
mount /dev/sda1 /mnt --mkdir
mount -fv /dev/sda1 /mnt
mount -t tmpfs -o size=64M tmpfs /tmp/x
mount -t ntfs3 -o force /dev/sda3 /mnt/windows

ip link set eth0 up
ip addr add 192.168.1.50/24 dev eth0
ip route add default via 192.168.1.1

ip -br addr && ip route
ip addr replace 192.168.1.50/24 dev eth0
ip route replace default via 192.168.1.1

ps -eo pid,args
ps -ef
ps aux
pspac

poweroff
reboot
```

## Environment and dependencies

### Build environment

The baseline is the stock Debian 13 (trixie) OCI image, which is also what this
PRoot is; a dependency is anything that image does not already have.
`debian:13` and `debian:13-slim` carry the same 78 packages and identical
binaries in every `PATH` directory — slim only drops docs, man pages and
locales — so `debian:13-slim` is the better starting point at 105 MB against
149 MB, and the list below is the same either way.

The base image already provides `bash`, GNU `tar`, `gzip`, `sha256sum`,
`mknod`, `find`, `sort`, `mkdir`, `mktemp`, `cp`, `rm`, `chmod`, `truncate`,
`dd`, `printf`, `awk` and `dirname`, all used by these scripts as they are.
Everything else has to be added.

### Buninu Linux ([Section 2](#2-buninu-linux-bun-as-pid-1))

Buninu Linux needs no compiler: Bun is downloaded as a prebuilt binary and the
UKI is assembled with `objcopy`.

```sh
apt install binutils-mingw-w64-x86-64 cpio curl dosfstools fakeroot mtools parted unzip
```

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
* **`bun`** (or **`node`**) — runs `index.js` in the build environment. 
  + Under bun, `--readme` renders the Markdown; under node it is printed as-is.

### Hello world ([Section 1](#1-hello-world))

The hello-world EFI application needs the C/PE toolchain plus the shared disk
image tools:

```sh
apt install clang lld dosfstools mtools parted
```

* **`clang`** — compiles `hello/hello.c` to a PE32+ object with
  `--target=x86_64-pc-win32-coff`. It resolves to `clang-19` on trixie.
* **`lld`** — provides `lld-link`, which links `hello/hello.obj` into an EFI
  application with `/subsystem:efi_application`. It resolves to `lld-19` on
  trixie.
* **`dosfstools`**, **`mtools`** and **`parted`** — create the FAT ESP and wrap
  it in the GPT `vda.img` through the shared `build-image.sh`.

### Retired native bootstrap

The retired `test/build-init-bootstrap.sh` also needs `clang lld`. It compiles
the historical freestanding x86-64 `/init`; the current Buninu Linux path does
not use or compile it.

## Implementation details

### 1. Hello world

- `hello/hello.c` is a freestanding PE32+ EFI application installed at the
  removable media fallback path `EFI/BOOT/BOOTX64.EFI`.
- It's a smoke test rather than the complete Buninu Linux

```sh
./hello/build-hello.sh   # in PRoot
./build-image.sh         # in PRoot
sudo dd if=vda.img of=/dev/sdX bs=4M conv=fsync status=progress
```

After verifying `/dev/sdX` is the whole destination USB device, boot it on the
physical x86-64 UEFI machine. It writes `Hello world from x64 UEFI!` to the
firmware console and waits; press any key to return to the firmware interface.

`build-image.sh` is shared with [Section 2](#2-buninu-linux-bun-as-pid-1) — see [Disk layout](#disk-layout).

### 2. Buninu Linux – Bun as PID 1

An unsigned x64 Unified Kernel Image assembled from official Alpine packages,
with Bun as the init process, replaces the hello-world application:

```sh
# physical-machine image, in PRoot Debian
bun ./index.js -fb --real --export

# bun x buninu-linux -fb --real --export
```

`index.js` is the single entry point (`npm run fetch` and `npm run pack` call
it too). Its physical-image stages run as fetch → build:

| flag | runs | use it when |
| --- | --- | --- |
| `-f`, `--fetch` | `fetch-alpine.sh`, `fetch-bun.sh` | first clone, or after bumping a pinned version |
| `-b`, `--build` | `build-uki.sh`, `build-image.sh` | after editing `initramfs/init.js` or the kernel command line |

`--export` is a post-build option: after `-b` finishes, it copies `vda.img` to
the directory where the command was invoked as
`buninu-linux-<version>.img`. It therefore requires `-b`/`--build` and is the
recommended way to retain an image produced through npx/bunx:

```sh
bun x buninu-linux -fb --real --export
```

`--linux-lts` selects Alpine's general-purpose LTS kernel. `--real` implies
`--linux-lts` and builds for physical hardware: it makes `tty0` the primary
console and includes xHCI/USB HID, common wired NIC, Android USB-tethering,
storage and ACPI power modules needed by typical laptops and desktops.

For real hardware, `-fb --real` is the complete image pipeline and
`-b --real` is the edit-and-rebuild loop. Before starting, `index.js` checks
that every required tool is on `PATH` and lists what is missing instead of
failing halfway. The shell scripts do the actual work and each still runs on
its own.

```text
index.js                  entry point: -f / -b / --export / --linux-lts / --real
fetch-alpine.sh           [fetch]  kernel, EFI stub, musl, network/input modules
fetch-bun.sh              [fetch]  Bun, libstdc++, libgcc
build-uki.sh              [build]  UKI; calls scripts/pack-initramfs.sh
build-image.sh            [build]  GPT disk image; shared with the hello-world EFI
scripts/fetch.sh          hash-checked download helper, sourced by fetch-*.sh
scripts/pack-initramfs.sh cpio archive with the device nodes
hello/                    hello-world EFI: hello.c and build-hello.sh
test/                     the retired C bootstrap and its build script
initramfs/                init.js and the committed libraries; rest fetched
```

The `--real` inputs are Alpine v3.24 `linux-lts-6.18.52-r0`, musl `1.2.6-r2`,
`systemd-efistub-260.2-r0`, `libstdc++`/`libgcc` `15.2.0-r5`, and Bun 1.4.2
`linux-x64-musl-baseline`. There is no BusyBox and no userland beyond Bun
itself.

Every step is idempotent and `-f` re-downloads nothing: `scripts/fetch.sh`
treats each pinned SHA-256 as the cache key, so a file already in `downloads/`
with the right hash is used as-is, and anything missing, truncated, stale or
tampered with is fetched again and has to pass the same hash before a script
extracts from it. Bumping a version changes both the file name and the hash, so
it always refetches.

#### Build pipeline

The primary `bun ./index.js -fb --real` pipeline runs the steps below in order;
each writes files the next one reads. When selected, `--export` runs afterward
and copies the final `vda.img` to the invocation directory.

| script | reads | writes |
| --- | --- | --- |
| `fetch-alpine.sh` | Alpine CDN | `kernel/vmlinuz-lts`, `kernel/linuxx64.efi.stub`, musl, and the selected network, storage, input, power and filesystem modules with trimmed module indexes |
| `fetch-bun.sh` | GitHub, Alpine CDN | `initramfs/bin/bun`, `initramfs/lib/{libc.musl-x86_64.so.1,libstdc++.so.6,libgcc_s.so.1}` |
| `scripts/pack-initramfs.sh` | `initramfs/` | `build/initramfs.cpio.gz` |
| `build-uki.sh` | that archive, kernel, stub | `build/cmdline`, `build/os-release`, `vda/EFI/BOOT/BOOTX64.EFI` |
| `build-image.sh` | `vda/EFI/BOOT/BOOTX64.EFI` | `vda.img` |

`build-uki.sh` calls `scripts/pack-initramfs.sh` itself, so that one is rarely
run directly.

The stages nest — the initramfs is baked into the UKI, and the UKI into the
disk image — so a one-line edit to `initramfs/init.js` still needs both of:

```sh
bun ./index.js -b --real
```

The kernel command line works the same way: `build-uki.sh` writes it to
`build/cmdline` and compiles it into the UKI. Nothing reads it from disk at
boot.

#### UKI layout

`build-uki.sh` appends sections to systemd's `linuxx64.efi.stub` with
`objcopy`, at hand-picked VMAs because `objcopy` will not lay them out for you:

| section | offset from image base | contents | size |
| --- | --- | --- | --- |
| `.text` | +0x0 | the stub itself | 66 KB |
| `.osrel` | +0x20000 | `build/os-release` | 78 B |
| `.cmdline` | +0x30000 | `build/cmdline` | 136 B |
| `.linux` | +0x2000000 | `kernel/vmlinuz-lts` | 14.5 MB |
| `.initrd` | +0x3000000 | `build/initramfs.cpio.gz` | 44.6 MB |

The current `--real` result is a single 59.3 MB PE32+ file holding kernel, initramfs and command
line.

#### Disk layout

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

#### Real-hardware boot details

The physical boot chain is firmware → the UKI stub → its embedded
`.linux`/`.initrd`/`.cmdline` sections → kernel → `rdinit=/bin/bun`.
`--real` uses Alpine `linux-lts`, includes the xHCI and USB HID module chain,
and, with the currently pinned kernel, embeds this complete command line:

```text
console=ttyS0,115200 console=tty0 REAL_MACHINE=1 panic=0 PATH=/bin KERNEL_RELEASE=6.18.52-0-lts rdinit=/bin/bun -- -e import('/init.js')
```

Serial kernel logging is retained, while the final console makes
`/dev/console` and the Bun REPL use the physical display and keyboard. This
path has been tested successfully on real hardware.

#### QEMU development

This optional path has been tested in native Android Termux and in an Ubuntu
24.04 cloud VM with QEMU 8.2.2, TCG and OVMF. In native Termux, install the
runner separately from the PRoot build dependencies:

```sh
pkg install qemu-system-x86-64
```

That package supplies OVMF at `$PREFIX/share/qemu/edk2-x86_64-code.fd`. Build
without `--real`; this selects Alpine `linux-virt`, omits the physical-hardware
module set, and puts `ttyS0` last so serial stdio owns `/dev/console`:

```text
console=tty0 console=ttyS0,115200 panic=0 PATH=/bin KERNEL_RELEASE=6.18.52-0-virt rdinit=/bin/bun -- -e import('/init.js')
```

Build and boot it with:

```sh
bun ./index.js -fb

# When running inside PRoot with Termux's native qemu-system-x86_64,
# expose both the native executable and its OVMF path:
PREFIX=/data/data/com.termux/files/usr \
PATH="/data/data/com.termux/files/usr/bin:$PATH" \
bun ./index.js -r
```

If QEMU is installed inside the current Debian environment instead, plain
`bun ./index.js -r` is sufficient; `run-qemu.sh` will use Debian's OVMF path.

`bun ./index.js -r` runs `run-qemu.sh`, which boots `vda.img` on q35 under TCG
with 512 MiB, a virtio disk, virtio-net user networking, no display, and COM1
on stdio. Anything after `--` is appended to the QEMU command line. Ctrl-C
quits QEMU. Leaving the REPL does not end the session: `init.js` restarts it,
because a PID 1 that exits panics the kernel.

The QEMU-only CLI stage is `-r`/`--run`; `-fbr` is the full virtual pipeline,
`-br` is its edit-and-boot loop, and arguments after `--` are passed through
verbatim, for example `-r -- -m 1G`. The corresponding repository entry is
`run-qemu.sh`. To smoke-test the [Section 1](#1-hello-world) EFI hello-world image instead, build
it and run the same `-r` stage; OVMF exposes its console over COM1.
The legacy `fetch-plus-build.sh` wrapper is equivalent to the virtual `-fb`
stages and does not select `--real`. `npm start` invokes the run stage.

For an even shorter initramfs loop, bypass the UKI and disk image:

```sh
qemu-system-x86_64 -machine q35,accel=tcg -cpu max -m 512M \
    -kernel kernel/vmlinuz-virt -initrd build/initramfs.cpio.gz \
    -append "console=ttyS0,115200 panic=0 PATH=/bin rdinit=/bin/bun -- -e console.log(1+1)" \
    -nic user,model=virtio-net-pci -display none -serial stdio -no-reboot
```

Only `./scripts/pack-initramfs.sh` must be rerun between these tests. A panic
parks the guest because of `panic=0`, so press Ctrl-C. This shortcut does not
exercise the UKI stub, GPT, physical console or hardware drivers; validate the
result afterward with `bun ./index.js -b --real` on the real UEFI path.

##### QEMU networking

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

#### Command implementation

The `/bin` commands described earlier are Bun scripts built on two shared
modules in `/lib`. `--help` uses `Bun.markdown.ansi` to render the Markdown
manual with hyperlinks. The shared pieces are:

* `/lib/dlopen.js` — one `bun:ffi` binding to `/lib/libc.musl-x86_64.so.1`
  (`mount`, `umount2`, `ioctl`, `socket`, `sync`, `reboot`, `syscall`, …), `errno`/`strerror`,
  a `SysError` class and the `showDocument()` helper behind every `--help`.
  `init.js` keeps its own copy of the binding because it runs before `/proc`
  exists and cannot import anything.
* `/lib/modprobe.js` — `modprobe(name)` resolves `modules.alias` and
  `modules.dep` under `/lib/modules/<release>/` and calls `finit_module`
  for each dependency in order. The kernel has no `/sbin/modprobe` to call
  here, so `mount` preloads `ext4`+`jbd2`, `vfat`+NLS tables, `ntfs3`,
  `sd_mod`, `nvme`, and so on itself.

Which modules the image carries is the list in `fetch-alpine.sh`; the
`select_module` helper there pulls in dependencies from Alpine's
`modules.dep`, and `--real` adds common storage paths (`sd_mod`, `ahci`,
`ata_generic`, `pata_acpi`, `nvme`, Intel `vmd`, `usb-storage` and `uas`),
the wired NICs, Android USB-tethering drivers and the ACPI power drivers. Alpine's
kernels build all of these as modules; a self-built kernel with them `=y`
works the same way, the loaders just find nothing to load.

#### Reaching JavaScript with nothing mounted

The default `--real` image embeds this kernel command line (shown for the
currently pinned LTS release):

```text
console=ttyS0,115200 console=tty0 REAL_MACHINE=1 panic=0 PATH=/bin KERNEL_RELEASE=6.18.52-0-lts rdinit=/bin/bun -- -e import('/init.js')
```

The physical display (`tty0`) is the final console and therefore owns PID 1's
standard streams; serial logging remains available on `ttyS0`. The kernel
execs `/bin/bun` itself, with nothing native in between, and `init.js` mounts
`/proc`, `/sys`, `/dev`, `/tmp` and `/dev/pts` through `bun:ffi` as its first
action. Everything before `--` needs an `=`, because the kernel appends
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
For `--real`, `tty0` is listed last among the `console=` arguments so the
physical display owns `/dev/console`; `ttyS0` remains available for serial
kernel logs.

The initramfs holds no `/init`; the kernel reaches Bun through `rdinit=` alone.
The retired native bootstrap is kept in `test/build-init-bootstrap.sh`, which
rebuilds it as `/init` — useful for mounting something before Bun starts, or
for bisecting a boot failure by exec'ing Bun with different arguments. Build
it, repack, and boot it with `rdinit=/init`. Varying which filesystems such a
bootstrap mounted before the exec is how the `/dev/urandom` requirement above
was found.

#### What init.js does

It installs signal handlers, loads a separate physical copy of musl through
`bun:ffi`, mounts `/proc`, `/sys`, `/dev`, `/tmp` and `/dev/pts` (without
the devpts mount every pty open fails with `ENODEV`, since `/dev/ptmx`
resolves through `/dev/pts/ptmx`), prints a greeting, and starts `node:repl`.
Submitting an empty or whitespace-only REPL line prints the welcome message
and the available `cfg` getters again. The loader and libc paths
contain identical bytes but are deliberately distinct inodes:

```text
/lib/ld-musl-x86_64.so.1
/lib/libc.musl-x86_64.so.1
```

Calling `dlopen` on the same musl inode that is already acting as Bun's loader
deadlocks, while the independent physical libc works. It provides `mount`,
`waitpid`, networking calls, and the generic `syscall` entry point, so no
custom `libinit.so` is needed.

On a `--real` boot, init starts `/etc/resolv.conf` with `1.1.1.1` and
`8.8.8.8`; these are initial public resolvers until the user replaces them
with DNS appropriate for the local network. Hardware networking remains down
until `cfg.net` loads the packaged drivers and the user assigns an address and
route.

On a `--real` image the REPL also offers the getter-based `cfg` namespace:
`cfg.net`, `cfg.disk`, `cfg.power` and `cfg.all` run as soon as the property is read, without
parentheses. `cfg.net` loads every packaged network module (including PHY and bus support),
then reads the `modalias` of every PCI and USB network device, matches it
against the `pci:`/`usb:` lines
`fetch-alpine.sh` kept in `modules.alias` and lists the interfaces. `cfg.disk`
loads the packaged SATA/PATA/SCSI, NVMe/VMD and USB storage stacks so
their disks and partitions appear in `/dev`, then lists `/sys/class/block`. `cfg.all`
unconditionally attempts every packaged module and recursively loads its
declared dependencies. `--real` ships Intel `e1000`/`e1000e`/`igb`/`igc`,
Realtek `r8169`, Atheros `alx`, Broadcom `tg3`, common USB dongles, and
`rndis_host`/`cdc_ether`/`cdc_ncm`/`cdc_eem`/`cdc_subset`/`zaurus` for Android
USB tethering. `cfg.net` unconditionally attempts all of these packaged
network modules. `cfg.power` loads the ACPI
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
to the Bun REPL. `start()` launches Buninu with the current process environment
preserved, while overriding `PATH` and `HOME` for the userspace session.

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
| Linux kernels and networking, storage, xHCI, USB and HID modules | GPL-2.0-only with the Linux syscall note | image only |
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
