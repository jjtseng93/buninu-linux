# chroot — run a command inside another root directory

`/bin/chroot` is a Bun script that calls `chroot(2)` and `mount(2)` through
`/lib/dlopen.js`.

Unlike the traditional `chroot`, it prepares the new root first, so a
freshly unpacked root filesystem is usable straight away, and it undoes
every mount it made when the command exits.

## Synopsis

```sh
chroot NEWROOT [COMMAND [ARGUMENT...]]
chroot [-n] [-k] [-v] [-b HOST[:GUEST]] [--shared-tmp] NEWROOT [COMMAND [ARGUMENT...]]
chroot -h | --help
```

With no COMMAND it runs `$SHELL` if that exists inside NEWROOT, otherwise
`/bin/sh`, interactively when the terminal is one.

## What it mounts

| Inside NEWROOT | What | Why |
|---|---|---|
| `/proc` | a fresh `proc` | path resolution, `ps`, anything reading `/proc/self` |
| `/sys` | a fresh `sysfs` | device and network information |
| `/dev` | recursive bind of the host's `/dev`, made a slave mount | every device node, including `/dev/ptmx`, without a second devtmpfs |
| `/dev/pts` | `devpts`, only if the bind brought none | pseudo-terminals for shells and editors |
| `/run` | `tmpfs` | runtime state |
| `/tmp` | `tmpfs` | scratch space that does not touch the root filesystem |
| `/etc/resolv.conf` | bind of the host's file | name resolution, without editing anything inside |

For automatic mounts, a destination that is already mounted is left alone. A directory that
is missing is created; if the root filesystem is read-only and that fails,
that one mount is skipped and the rest still happen — use `-v` to see which.

Making `/dev` a slave mount means mounts appearing inside the root do not
propagate back to the host, and unmounting it afterwards cannot take the
host's `/dev` with it.

## Options

| Option | Meaning |
|---|---|
| `-n`, `--no-mount` | Skip automatic system mounts; explicit `-b` mounts still apply. Without binds, this is the behaviour of the traditional `chroot`. Note that Bun itself cannot start without `/proc` and `/dev/urandom`, so `-n` suits statically linked programs. |
| `-b HOST[:GUEST]`, `--bind HOST[:GUEST]` | Bind a host directory or file into the new root; repeat for multiple paths. Without GUEST, use HOST’s absolute path inside the guest. |
| `--shared-tmp` | Equivalent to `-b "$TMPDIR:/tmp"`; TMPDIR must be set and exist. Replaces the automatic `/tmp` tmpfs. |
| `-k`, `--keep-mounts` | Leave the mounts in place after the command exits, to enter the same root again cheaply. Clean up later with `umount -R`. |
| `-v`, `--verbose` | Report every mount and unmount. |
| `--` | End of options; everything after it is NEWROOT and COMMAND. |

Bind options must appear before NEWROOT. Host paths may be relative to the
current directory; guest paths must be absolute. Missing destination directories
and file placeholders are created. Guest symlinks are resolved relative to
NEWROOT, including absolute symlinks. Binding over the guest root `/` is rejected.

Explicit binds replace automatic mounts at or below their destination. Directories
are bound recursively and made slave mounts, like `/dev`; files use a plain bind.
A repeated destination uses the last argument, so a later `-b HOST:/tmp` can
override `--shared-tmp` (and vice versa). Parent binds are applied before children.
Explicit bind failures abort with status 125 and clean up this invocation's mounts,
even with `-k`. Existing mounts may be covered by a new explicit bind and are
revealed again when it is removed. Source data is shared, not copied.

`--shared-tmp` only adds the bind; it does not rewrite environment variables.
If the host's TMPDIR path is different from `/tmp`, applications in the guest may
need `TMPDIR=/tmp` in their environment.

## Examples

```sh
# Mount a disk and enter the system on it
mount /dev/vda2 /mnt --mkdir
chroot /mnt

# Run one command and leave
chroot /mnt /bin/bun --version

# Watch what is set up and taken down
chroot -v /mnt /bin/sh -c 'ls /proc | head -3'

# Traditional behaviour: nothing is mounted for you
chroot -n /mnt /bin/sh

# Share a host directory at a different guest path
chroot -b /home/user/project:/work /mnt /bin/sh

# Share the same absolute path inside the guest
chroot -b /home/user/project /mnt /bin/sh

# Share files, or multiple paths
chroot -b /home/user/project:/work -b /etc/hosts:/etc/hosts /mnt /bin/sh

# Share the host temporary directory (including Unix sockets)
export TMPDIR=/tmp
chroot --shared-tmp /mnt /bin/sh
# Equivalent explicit bind:
chroot -b "$TMPDIR:/tmp" /mnt /bin/sh

# Keep the mounts for repeated visits
chroot -k /mnt /bin/sh -c 'true'
chroot -k /mnt
umount -R /mnt
```

## Cleanup

When the command exits, every mount this invocation made is unmounted,
deepest first, including anything that appeared under the recursive `/dev`
bind. A mount that is still busy — a process left running inside, a shell
with its working directory there — is detached instead (`MNT_DETACH`), so
the kernel releases it once its last user goes away. The same cleanup runs
if `chroot(2)` itself fails or the command cannot be started, and on
`SIGTERM` or `SIGHUP`.

`Ctrl-C` goes to the command, not to `chroot`, so the mounts are still
removed after an interrupted program.

## Limits

- Needs to be superuser: `chroot(2)` requires `CAP_SYS_CHROOT`, and the
  mounts require `CAP_SYS_ADMIN`. Buninu normally runs as root.
- The new root must contain the program you ask for and whatever it links
  against; `chroot /mnt /bin/sh` fails with "not found" if `/mnt/bin/sh`
  is not there.
- Only the filesystem view changes. Processes, network, users and the
  hostname are shared with the host; this is not a container.
- `-k` leaves mounts behind on purpose. `umount -R NEWROOT` removes them.

## Exit status

The command's own status, or `125` if `chroot` itself failed, `126` if the
command was found but could not be run, and `127` if it was not found.

## See also

- Source: `/bin/chroot`
- `mount --help`, `umount --help`
- Shared native binding: `/lib/dlopen.js`
