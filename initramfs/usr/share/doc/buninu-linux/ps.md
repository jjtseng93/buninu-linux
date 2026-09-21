# ps — list processes

`/bin/ps` is a small Bun script that reads `/proc`. Its primary interface is
the full-command-line table consumed by bunmsh's `pspa` and coloured `pspac`
builtins.

## Synopsis

```sh
ps
ps -e | -A [-o pid,args]
ps -eo pid,args
ps -ef | ps aux | ps ax
ps -h | --help                       # this page
```

## Options

| Option | Meaning |
|---|---|
| `-e`, `-A`, `--all` | List every process instead of the default same-UID/same-TTY selection. |
| `-o FIELDS` | Select and order comma- or space-separated output fields. See below. |
| `-ef` | Full Unix view: UID, PID/PPID, CPU, start, TTY, accumulated time, and command. |
| `-eF` | Extra-full Unix view, adding `SZ`, `RSS`, and current processor (`PSR`). |
| `aux`, `-aux` | BSD view with user, CPU/memory percentages, VSZ/RSS, TTY, state, start, time, and command. |
| `ax`, `-ax` | Compact BSD view with PID, TTY, state, time, and command. |
| `-h`, `--help` | Render this page. |

`-e` and `-o` may be combined as `-eo pid,args`, which is the form bunmsh
uses. Rows are sorted numerically by PID. A process with an empty cmdline is
shown using its `/proc/PID/comm` name in brackets, as for a kernel thread.
With no `-o` or extended view, the standard columns are `PID TTY TIME CMD`,
and `CMD` is the short process name. The default selection is the caller's
effective UID and terminal, excluding session leaders. `-e`/`-A` selects all;
`a`, `x`, `-a`, and `-x` apply their usual BSD or Unix selection rules.

### `-o` fields

Supported names are:

```text
pid ppid uid user euser comm args cmd command tty tt stat state
%cpu pcpu %mem pmem vsz rss sz time etime etimes
start stime lstart ni nice pri psr
```

They may be combined and reordered, for example:

```sh
ps -eo pid,ppid,user,comm
ps -eo pid,stat,%cpu,%mem,rss,args
ps -o pid,tty,time,comm
```

`comm` is the kernel's short process name; `args` is the complete command
line. The exact `pid,args` layout remains the interface consumed by bunmsh.

## Examples

```sh
ps
ps -eo pid,args
ps -ef                         # common LLM/tutorial spelling
ps aux
pspac                         # bunmsh: the same table with syntax colours
```

## Limits

Values come from `/proc/PID/stat`, `/proc/PID/status`, `/proc/uptime`, and
`/proc/meminfo`; user names come from `/etc/passwd`. CPU percentages are the
process's average since it started, and memory percentage is resident memory
over `MemTotal`. Forest display, custom column headings, and less common
procps fields remain outside this minimal command. `/proc` must be mounted.

## Exit status

`0` success, `1` bad usage or `/proc` could not be read.

## See also

- `ip --help`
- Source: `initramfs/bin/ps` in
  [buninu-linux](https://github.com/jjtseng93/buninu-linux)
