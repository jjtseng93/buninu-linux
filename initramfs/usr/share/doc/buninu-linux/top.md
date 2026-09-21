# top

`top` periodically reads the process snapshot exported by `/bin/ps`. Process
discovery and row formatting are shared with `ps`; `top` only calculates CPU
changes between refreshes, sorts rows, and redraws the screen.

## Usage

```sh
top
top -d 1
top -b -n 1
```

- `-d SECONDS` sets the refresh interval (default: 3).
- `-n COUNT` exits after that many snapshots.
- `-b` uses batch output without terminal control sequences.
- `-h`, `--help` displays this document.

While running interactively, press `q` to quit, `P` to sort by CPU, `M` to
sort by memory, or `N` to sort by PID. The first screen shows the lifetime CPU
average available from `ps`; later screens show usage during the refresh
interval.
