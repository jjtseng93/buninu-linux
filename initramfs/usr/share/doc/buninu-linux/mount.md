# mount — mount a filesystem

`/bin/mount` is a Bun script. It calls `mount(2)` through `/lib/dlopen.js`
and loads the kernel modules a filesystem or a disk needs through
`/lib/modprobe.js`, because on Buninu Linux there is no `/sbin/modprobe` for
the kernel to ask.

## Synopsis

```sh
mount                                   # list mounted filesystems
mount [-fv] [-t TYPE] [-o OPTIONS] SOURCE TARGET
mount -L LABEL | -U UUID [-o OPTIONS] TARGET
mount --bind | --rbind | --move OLD NEW
mount -o remount[,ro|rw] TARGET
mount -h | --help                       # this page
```

## Options

| Option | Meaning |
|---|---|
| `-t TYPE` | Filesystem type. Omitted or `auto`: read the superblock of SOURCE and pick one. |
| `-o OPTIONS` | Comma-separated list, see below. May be repeated. |
| `-r`, `--read-only` | Same as `-o ro`. |
| `-w`, `--rw` | Same as `-o rw`. |
| `-L LABEL`, `-U UUID` | Find the block device by label or UUID (ext2/3/4, FAT, exFAT, NTFS serial). |
| `-B`, `--bind` | Bind-mount a directory or file somewhere else. |
| `-R`, `--rbind` | Bind, including everything mounted below OLD. |
| `-M`, `--move` | Move a mount to a new place. |
| `--make-shared`, `--make-private`, `--make-rshared`, `--make-rprivate` | Change mount propagation of TARGET. |
| `--mkdir` | Create TARGET first. |
| `-v` | Say what is being loaded and mounted. |
| `-f`, `--fake` | Show the `mount(2)` call and stop. |

`-f` and `-v` may be combined as `-fv` or `-vf`; this probes and reports the
filesystem without performing the mount.

### `-o` words

Flags: `ro` `rw` `nosuid` `suid` `nodev` `dev` `noexec` `exec` `sync` `async`
`dirsync` `noatime` `atime` `nodiratime` `relatime` `strictatime` `lazytime`
`nosymfollow` `remount` `bind` `rbind` `move` `shared` `private` `slave`
`unbindable` `defaults`.

Anything else (`size=64M`, `iocharset=utf8`, `uid=1000`, `force`, ...) goes
to the filesystem driver unchanged.

## Examples

### tmpfs

```sh
mount -t tmpfs tmpfs /mnt/scratch
mount -t tmpfs -o size=64M,mode=1777 tmpfs /tmp/big
mount -t tmpfs -o remount,size=256M tmpfs /tmp/big   # grow it later
```

### ext4 (a Linux disk or partition)

```sh
mount /dev/vda2 /mnt                  # type detected, ext4 + jbd2 loaded
mount -t ext4 -o ro,noatime /dev/vda2 /mnt
mount -L rootfs /mnt                  # by label
mount -U 3f2a...-...  /mnt            # by UUID
mount -o remount,rw /mnt              # flip an ro mount to rw
```

`ext3` volumes mount with the ext4 driver; `ext2` uses its own module.

### A Windows disk (NTFS)

```sh
mount /dev/sda3 /mnt/windows                     # ntfs3, read-write
mount -t ntfs3 -o ro /dev/sda3 /mnt/windows      # look, don't touch
mount -t ntfs3 -o force /dev/sda3 /mnt/windows   # volume left dirty by Windows
mount -t ntfs3 -o windows_names,uid=1000,gid=1000 /dev/sda3 /mnt/windows
```

Windows Fast Startup and hibernation leave the volume marked dirty; ntfs3
then refuses to mount read-write. Either boot Windows and shut it down
fully, mount `-o ro`, or pass `force`. `windows_names` rejects names Windows
could not open. The type name `ntfs` is accepted as an alias for `ntfs3`.

### The EFI system partition, USB sticks, SD cards (FAT / exFAT)

```sh
mount /dev/vda1 /mnt/efi                                 # vfat, detected
mount -t vfat -o iocharset=utf8,umask=022 /dev/sdb1 /mnt/usb
mount -t exfat -o uid=1000,gid=1000 /dev/sdb1 /mnt/card
```

FAT and exFAT need NLS tables (`nls_utf8`, `nls_cp437`, `nls_iso8859-1`);
`mount` loads them before calling the kernel, and also whatever
`iocharset=`/`codepage=` names, if the module is shipped.

### Bind mounts and moves

```sh
mount --bind /tmp/home /buninu/home
mount --bind -o ro /usr/share/doc /mnt/doc   # bind, then remount read-only
mount --rbind / /mnt/root                    # with all submounts
mount --move /mnt/usb /media/usb
```

### Pseudo filesystems

```sh
mkdir -p /dev/pts && mount -t devpts -o gid=5,mode=620,ptmxmode=666 devpts /dev/pts
mount -t proc proc /proc
mount -t sysfs sysfs /sys
mount -t devtmpfs devtmpfs /dev
mount -t cgroup2 none /sys/fs/cgroup
mount -t debugfs none /sys/kernel/debug
```

`/dev/pts` matters: since Linux 4.7 opening `/dev/ptmx` goes through
`/dev/pts/ptmx`, so without this mount every pty open fails with `ENODEV`.
`init.js` mounts it at boot.

### Listing

```sh
mount                     # SOURCE on TARGET type TYPE (OPTIONS), from /proc/self/mounts
cat /proc/self/mountinfo  # the long form
```

## How devices and drivers are found

- A missing `/dev/vd*`, `/dev/sd*` or `/dev/nvme*` node makes `mount` load
  `virtio_blk`, `sd_mod` (+ `ahci`, `usb_storage`) or `nvme` and wait up to
  3 s for devtmpfs to create it.
- The filesystem driver is loaded when `/proc/filesystems` does not list the
  type; `modules.alias` turns `fs-ntfs` into `ntfs3`, `fs-ext3` into `ext4`.
- Which modules are in the image is decided by `fetch-alpine.sh` in the
  build tree; `--real` adds `sd_mod`, `ahci`, `nvme` and `usb-storage`.

## Exit status

`0` mounted, `1` bad usage, `32` the mount itself failed. Messages follow
util-linux wording, and `dmesg` usually has the kernel's reason for `EINVAL`.

## See also

- `umount --help`, `ip --help`
- [mount(2)](https://man7.org/linux/man-pages/man2/mount.2.html),
  [mount(8)](https://man7.org/linux/man-pages/man8/mount.8.html)
- [tmpfs](https://docs.kernel.org/filesystems/tmpfs.html),
  [ext4](https://docs.kernel.org/admin-guide/ext4.html),
  [ntfs3](https://docs.kernel.org/filesystems/ntfs3.html),
  [vfat](https://docs.kernel.org/filesystems/vfat.html),
  [devpts](https://docs.kernel.org/filesystems/devpts.html)
- Source: `initramfs/bin/mount`, `initramfs/lib/dlopen.js`,
  `initramfs/lib/modprobe.js` in
  [buninu-linux](https://github.com/jjtseng93/buninu-linux)
