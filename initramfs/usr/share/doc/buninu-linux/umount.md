# umount — unmount a filesystem

`/bin/umount` is a Bun script that calls `umount2(2)` through
`/lib/dlopen.js`.

## Synopsis

```sh
umount [-f] [-l] [-R] [-v] TARGET...
umount -h | --help
```

TARGET is a mount point. Naming the device (`umount /dev/vda1`) is not
supported; use `mount` with no arguments to see where it is mounted.

## Options

| Option | Meaning |
|---|---|
| `-l`, `--lazy` | Detach now, clean up when the last user goes away (`MNT_DETACH`). |
| `-f`, `--force` | Force, for unreachable network filesystems (`MNT_FORCE`). |
| `-R`, `--recursive` | Also unmount everything mounted below TARGET, deepest first. |
| `-v` | Report each successful unmount. |

## Examples

```sh
umount /mnt
umount -l /mnt/windows        # something still has a file open
umount -R /mnt/root           # a tree made with mount --rbind
umount /tmp/big /mnt/usb      # several at once
```

"target is busy" means a process has its working directory or an open file
inside the mount. On the Bun REPL, `process.chdir("/")` is usually the fix;
`-l` is the escape hatch.

## Exit status

`0` all targets unmounted, `1` bad usage, `32` at least one failed.

## See also

- `mount --help`
- [umount(2)](https://man7.org/linux/man-pages/man2/umount.2.html),
  [umount(8)](https://man7.org/linux/man-pages/man8/umount.8.html)
- Source: `initramfs/bin/umount` in
  [buninu-linux](https://github.com/jjtseng93/buninu-linux)
