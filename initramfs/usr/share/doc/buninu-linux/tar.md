# tar — create and extract archives

`/bin/tar` is a small Bun script over `Bun.Archive`. It handles uncompressed
tar archives plus gzip and zstd without invoking another program.

## Synopsis

```sh
tar -cf ARCHIVE FILE...
tar -czf ARCHIVE FILE...
tar --zstd -cf ARCHIVE FILE...
tar -xf ARCHIVE [-C DIR] [MEMBER...]
tar -tf ARCHIVE [MEMBER...]
tar -h | --help                         # this page
```

Use `-` as ARCHIVE to read from standard input or write to standard output.

## Options

| Option | Meaning |
|---|---|
| `-c` | Create an archive. |
| `-x` | Extract an archive. |
| `-t` | List archive members. |
| `-f ARCHIVE`, `--file=ARCHIVE` | Archive file, or `-` for standard input/output. |
| `-C DIR`, `--directory=DIR` | Read input files from DIR, or extract into DIR. |
| `-z`, `--gzip` | Create gzip-compressed tar, or explicitly identify gzip input. |
| `--zstd` | Create or read a zstd-compressed tar. A `.zst` or `.tzst` input is also detected by name. |
| `-v` | Print names while creating/extracting; with `-t`, also show each member's size, modification time, kind and link target. |
| `-o`, `--no-same-owner`, `--no-same-permissions`, `--overwrite` | GNU tar compatibility for extraction; these already match Bun.Archive's behaviour. |
| `--exclude=PATTERN` | Accepted for js-udocker compatibility. Device nodes are not extracted and js-udocker removes whiteout files separately. |

Short options can be combined, for example `-xzvf` or `-czf`.
For the traditional first option word, the leading hyphen is optional, so
`tar tf`, `tar xf`, and `tar cf` are equivalent to `tar -tf`, `tar -xf`, and
`tar -cf`.

## Examples

```sh
tar -czf source.tar.gz src README.md
tar -xzf source.tar.gz -C /tmp/source
tar -tf source.tar.gz
tar --zstd -cf backup.tar.zst home
tar --zstd -xf backup.tar.zst -C /mnt/restore

# An Alpine root filesystem, symbolic links and all; then enter it
tar -xzf alpine-minirootfs-3.24.1-x86_64.tar.gz -C /mnt/alpine
chroot /mnt/alpine
```

## Links

Extraction restores symbolic links exactly as the archive records them,
including absolute targets such as `/bin/busybox` and targets that do not
exist yet, and it restores hard links. This is what GNU tar does, and it is
what an unpacked root filesystem needs: an Alpine minirootfs is 335 symbolic
links, 306 of them absolute, and without them the result has no `/bin/sh`.

`Bun.Archive` creates only the symbolic links whose target is relative and
stays inside the extraction directory, and skips hard links entirely, so
this command reads the archive's own headers (ustar, GNU `L`/`K` long names,
pax `x` records) and creates the rest itself once every file is in place.
Nothing is ever written through a link, because the links are made last.

A member's own name still follows GNU tar's rule: a leading `/` is dropped
and a name containing `..` is refused, so an archive cannot write outside
the extraction directory.

The same header scan backs listing, so `-t` reports every member —
directories, links, devices — and not just regular files. A symbolic link
shows its target, a hard link the file it points at.

## Current Bun.Archive limits

Creation stores regular files only. Symbolic links are rejected rather than
silently archived as the wrong type; modes, ownership, hard links, and empty
directories are not preserved. Bun 1.4.3 also requires file contents to be
materialized in memory before archive creation.

Extraction does not restore modes, ownership or timestamps. Bun provides gzip
and zstd codecs but no xz or bzip2 codec, so this command does not accept
`.tar.xz` or `.tar.bz2`.

Appending with `-r`/`rvf` is not supported. `Bun.Archive` has no append API;
rebuilding an existing archive through `Archive.files()` would silently lose
its directories, links, ownership, and modes, so this command refuses instead.

## Exit status

`0` success, `2` bad usage or an archive/file operation failed.

## See also

- [Bun.Archive](https://bun.com/docs/runtime/archive)
- [tar(1)](https://man7.org/linux/man-pages/man1/tar.1.html)
- Source: `initramfs/bin/tar` in
  [buninu-linux](https://github.com/jjtseng93/buninu-linux)
