## du

Estimate disk usage, after GNU du: each folder's line streams out as soon as it is finished.

### Usage

```sh
du [OPTIONS] [FILE ...]
```

### Options and forms

Short options combine (`-shc`, `-sbhc`, `-d1`, `-BM`), long ones may be abbreviated, and options may follow the files.

- `-s`, `--summarize`: One line per file operand.
- `-c`, `--total`: Add a `total` line.
- `-h`, `--human-readable`: Sizes such as `4.0K` and `12M`, rounded up; `--si` uses powers of 1000.
- `-b`, `--bytes`: Apparent size in bytes (`--apparent-size --block-size=1`).
- `-a`, `--all`: Lines for files as well as folders.
- `-d N`, `--max-depth=N`: Lines only down to depth N.
- `-k`, `-m`, `-B SIZE`, `--block-size=SIZE`: Units of 1K, 1M or SIZE (`-BM` prints `1M`).
- `--apparent-size`, `--inodes`, `-l`, `-L`, `-H`, `-P`, `-S`, `-x`, `-0`, `-t SIZE`, `--exclude=PATTERN`, `-X FILE`: As in GNU du.

A file with several hard links counts once; with several operands, as `du -shc *` gives, every item counts once. A folder that cannot be read is reported and the status is 1. `du -h` alone sizes the current folder; use `du --help` for this page.

### Example

```sh
du -shc *
```

Output:

```text
4.0K	notes.txt
1.2M	photos
1.2M	total
```
