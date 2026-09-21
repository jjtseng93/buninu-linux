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
| `-v` | Print names while creating/extracting; with `-t`, also show each regular file's size and modification time. |

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
```

## Current Bun.Archive limits

Creation stores regular files only. Symbolic links are rejected rather than
silently archived as the wrong type; modes, ownership, hard links, and empty
directories are not preserved. Bun 1.4.3 also requires file contents to be
materialized in memory before archive creation.

Extraction restores directories and symbolic links, but Bun 1.4.3 skips hard
links. Listing and verbose extraction use `Archive.files()`, so they report
regular files only. Verbose listing can show their size and modification time,
but not the unavailable mode or owner. Bun provides gzip and zstd codecs but no xz or bzip2 codec,
so this command does not accept `.tar.xz` or `.tar.bz2`.

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
