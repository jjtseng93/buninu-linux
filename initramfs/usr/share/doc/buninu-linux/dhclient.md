# dhclient — DHCPv4 client

Acquire an IPv4 lease on an Ethernet-compatible interface. DHCP packets are
implemented in JavaScript; Bun FFI calls the runtime libc for packet/UDP
sockets and interface identification. Address and route changes invoke the
existing Buninu `ip` command, without an external DHCP binary or dependencies.

```sh
dhclient eth0                    # acquire, configure, then exit
dhclient -v -timeout 20 eth0     # show progress, fail after 20 seconds
dhclient -r eth0                # release a saved lease after the client stops
dhclient --no-dns eth0          # leave the resolver unchanged
```

| Option | Meaning |
| --- | --- |
| `-4` | DHCPv4 (default) |
| `-d` | Accepted for compatibility; all invocations exit after configuration |
| `-1` | Acquire once (already the default) |
| `-r` | Send DHCPRELEASE and remove the saved lease's configuration |
| `-timeout SECONDS` | Initial acquisition deadline; default 60 seconds |
| `-v`, `-q` | Verbose protocol progress, or quiet output |
| `-H HOSTNAME` | Send DHCP hostname option |
| `-lf PATH` | JSON lease file; default `/var/lib/dhclient/INTERFACE.json` |
| `--metric NUMBER` | Default route metric, 0–32766 |
| `--no-dns` | Do not write DNS configuration |
| `--resolv-conf PATH` | Resolver file; default `/etc/resolv.conf` |
| `-h`, `--help` | This manual |

Specify one interface per process. The interface is brought up first. This
client replaces its primary IPv4 address and installs the first offered
router as its default gateway. DNS server addresses replace the resolver
file; its previous content is saved and restored on explicit release only if
another writer has not modified it. `--no-dns` is useful for secondary links.
Avoid simultaneous resolver management by multiple clients.

Each invocation acquires and configures one lease, then exits. No background
renewal process is started. `-1` is an optional alias for this default behavior.
A DHCP lease is still time-limited unless the server grants an infinite lease:
run the command again before expiry, or use an appropriate static address.
After exit this command cannot renew or remove an expired address. The reported
lease duration and JSON timestamps show the server's validity period.
Ctrl-C/SIGTERM during acquisition stops the attempt; successful configuration
remains after normal exit. Use `-r` to release it explicitly. Saved JSON leases
support release and resolver restoration; their addresses are never assumed
valid on a later acquisition.

The per-interface `/run/dhclient-INTERFACE.lock` prevents duplicate Buninu
clients, including callers using different lease files. Stop the running
client before `-r`. After an unclean kill, verify it is gone before removing
the stale lock. UDP port 68 is reserved exclusively to detect other clients.

Linux/Android on x86-64 or aarch64 is supported, subject to privileges:
CAP_NET_RAW for packet sockets, CAP_NET_ADMIN for interface/route changes,
and permission to bind UDP 68 and write lease/resolver files. Ordinary
unprivileged Termux cannot configure Android networking. Root in Buninu's
VM can. Library selection follows the shared `dlopen.js` runtime ABI rules.

This is a focused client, not an ISC dhclient CLI clone. DHCPv6, ISC config/
script hooks, address-conflict ARP probing/DECLINE, classless static routes,
and automatic renewal/daemonization are not implemented. Wi-Fi must already be
associated. A failed acquisition exits nonzero; successful one-shot/release
or clean signal termination returns zero.

Protocol: [RFC 2131](https://www.rfc-editor.org/rfc/rfc2131) and
[DHCP options, RFC 2132](https://www.rfc-editor.org/rfc/rfc2132).
Run `bun test test/dhcp.test.js test/libc.test.js` for codec, state-machine,
configuration and libc regression tests; tests do not reconfigure host links.

`cfg.net` launches foreground clients as background child processes. Each has
a 20-second acquisition deadline and an independent 25-second startup watchdog
(SIGTERM, then SIGKILL after 2 seconds if necessary). Successful clients exit after configuration; none remain to renew. All child and output failures are caught and logged. Metrics start
at 100 per interface; only the first interface may write DNS. Repeated calls
reuse active clients; a later call can retry clients which have exited.
