# ping — send ICMP echo requests

`ping` sends real IPv4 ICMP or IPv6 ICMPv6 echo requests through Bun FFI.
It does not execute a system ping, open a TCP connection, or use an HTTP probe.

```sh
ping [-4|-6] [-nqD] [-c COUNT] [-i SECONDS] [-W SECONDS]
     [-w SECONDS] [-s BYTES] [-t TTL] [-I ADDRESS|INTERFACE] DESTINATION
ping --help
```

| Option | Meaning |
|---|---|
| `-c COUNT` | Stop after COUNT requests and their replies/timeouts. Default: 4 requests, then exit. |
| `-i SECONDS` | Send interval, default 1 second; fractional values supported, minimum 0.002 seconds. |
| `-W SECONDS` | Per-request reply timeout, default 2 seconds; fractional values supported. |
| `-w SECONDS` | Overall probing deadline, including outstanding requests. DNS resolution happens first. |
| `-s BYTES` | Payload size, default 56; 0–65507 bytes. The ICMP header adds 8 bytes. |
| `-t TTL` | IPv4 TTL or IPv6 hop limit, 1–255; default 64. |
| `-I ADDRESS` | Bind a source IPv4/IPv6 address. |
| `-I INTERFACE` | Bind an interface such as `eth0` or `wlan0`; OS permissions may be required. |
| `-4`, `-6` | Select IPv4 or IPv6. Numeric destinations infer their family; hostnames default to IPv4. |
| `-n` | Numeric reply addresses (currently always used; no reverse DNS). |
| `-q` | Print only the initial line and final statistics. |
| `-D` | Add Unix timestamps to per-packet output. |
| `-h`, `--help` | Show this document. |

Short options can be combined (`-nq`) and values attached (`-c3`). Use `--`
to end option parsing. Unknown options are rejected rather than ignored.

```sh
ping -c 4 1.1.1.1
ping -c 3 localhost
ping -6 -c 3 ::1
ping -n -c 10 -i 0.2 -W 1 -s 1200 192.168.1.1
ping -q -w 5 192.168.1.1
ping -I eth0 -c 3 192.168.1.1
```

Statistics include transmitted/received counts, loss and RTT min/average/max/
standard deviation. Ctrl-C prints statistics and closes the socket. Exit status
is 0 if any reply arrived, 1 if none arrived (or a combined `-c`/`-w` deadline
prevented receiving the requested count), and 2 for argument/setup/system errors.
RTT is measured by the Bun process, so event-loop scheduling affects it.

The preferred socket is an unprivileged ICMP datagram (ping) socket. If the OS
refuses that socket, a raw ICMP socket is attempted; this normally requires root
or `CAP_NET_RAW`. Linux controls datagram access with `ping_group_range`, and
Android may impose additional restrictions. The command does not change system
permissions. Replies are matched by identifier, sequence and payload; IPv4
checksums are checked. Concurrent outstanding probes are supported. Datagram
replies do not expose their received TTL through this implementation, so it is
not printed; raw IPv4 replies do include TTL.

Supported runtimes: 64-bit Linux (glibc or musl) and native Android/Termux
(bionic), on x86_64 or aarch64. `/lib/dlopen.js` chooses libc automatically:

- Android: `libc.so`, then the APEX and `/system/lib64` bionic paths; `__errno`.
- Linux glibc runtime: `libc.so.6`, then architecture-specific `/lib` and
  `/usr/lib` glibc paths; `__errno_location`.
- Linux musl runtime: the adjacent `libc.musl-<arch>.so.1`, its soname,
  `/lib/libc.musl-<arch>.so.1`, `/lib/ld-musl-<arch>.so.1`, then `libc.so`;
  `__errno_location`.
- Search stays within the runtime ABI: loading musl into glibc can crash on
  errno/TLS access.
- `BUNINU_LIBC=/absolute/path` overrides the search. A bad override fails
  explicitly rather than silently selecting a different library. Symbols resolve
  on first use: an unavailable mount symbol does not prevent ping from using
  the socket symbols. An explicit override is not rejected based on its filename;
  matching the runtime ABI remains the caller's responsibility.

Windows requires a separate `iphlpapi.dll` ICMP backend and is not implemented.
Flood/adaptive modes, IPv4 record-route/timestamps, reverse DNS, broadcast ping,
and IPv6 scoped address notation (`fe80::1%eth0`) are not implemented.

## Tests

```sh
bun test test/ping.test.js test/libc.test.js
```

These compare local IPv4/IPv6 echo replies, payload sizes, counts, quiet output,
source selection, deadlines and exit codes against the installed system ping.
RTT values are not expected to match. A missing system ping or unavailable
loopback ICMP support skips the corresponding network comparisons. Older
Android systems have a separate `ping6` and a 200 ms interval restriction; the
reference tests accommodate those without limiting this command's options.
Packet validation, argument errors, fast intervals and Ctrl-C also have tests.

References: [Linux ICMP sockets](https://man7.org/linux/man-pages/man7/icmp.7.html),
[Android errno](https://android.googlesource.com/platform/bionic/+/master/libc/include/errno.h).
