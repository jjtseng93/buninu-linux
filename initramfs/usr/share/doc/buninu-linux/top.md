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

## Memory summary

The summary uses `/proc/meminfo`, converting KiB to MiB:

- `total`: `MemTotal`.
- `free`: `MemFree`, currently unused memory.
- `used`: `MemTotal - MemAvailable` (clamped at zero).
- `available`: `MemAvailable`, the kernel's estimate of memory available to
  new applications without swapping.
- `buff/cache`: `Buffers + Cached + SReclaimable`, shown for reference.

Cache is not all immediately reclaimable, particularly with memory-backed
filesystems. It is no longer subtracted directly to calculate `used`.
These fields overlap: `used + free + buff/cache` need not equal `total`.
If a kernel does not report `MemAvailable`, `available` shows `n/a` and
`used` falls back to `MemTotal - MemFree`, without subtracting cache.
Per-process memory columns are unchanged.
