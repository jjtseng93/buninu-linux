# ip — show and configure network interfaces, addresses and routes

`/bin/ip` is a Bun script with the iproute2 command grammar. It reads
`/sys/class/net` and `/proc/net`, and configures the kernel through the
classic `SIOC*` ioctls on an AF_INET socket bound in `/lib/dlopen.js` — the
same calls `init.js` uses to bring up `lo` and `eth0` at boot. It does not
speak rtnetlink, which keeps it small; the limits that come with that are
listed at the end.

## Synopsis

```sh
ip [-4 | -6] [-br] OBJECT [COMMAND] [ARGUMENTS]
ip -h | --help | help                  # this page
OBJECT  := link | address | route | neighbour
```

Any unambiguous prefix works, as in iproute2: `ip a`, `ip addr`, `ip li`,
`ip r`, `ip n`, and `show`/`list`/`ls`, `del`/`delete`.

## Global options

| Option | Meaning |
|---|---|
| `-4` / `-6` | Show only IPv4 / IPv6 addresses. |
| `-br`, `-brief` | One line per interface. |
| `-f inet\|inet6` | Same as `-4` / `-6`. |
| `-c`, `-s`, `-d`, `-o`, `-p` | Accepted for muscle memory, no effect. |

## Links

```sh
ip link                        # every interface: flags, mtu, state, MAC
ip -br link                    # eth0   UP   52:54:00:12:34:56 <BROADCAST,...>
ip link show eth0
ip link set eth0 up
ip link set eth0 down
ip link set eth0 mtu 1400
ip link set eth0 address 02:00:00:00:00:01   # interface must be down
ip link set eth0 name lan0
ip link set eth0 promisc on
ip link set eth0 up mtu 9000                 # several changes at once
```

`ip link add`/`delete` (vlan, bridge, dummy, ...) need rtnetlink and are not
available.

## Addresses

```sh
ip addr                        # links plus their inet / inet6 addresses
ip -br addr                    # eth0   UP   10.0.2.15/24 fec0::5054:ff:fe12:3456/64
ip -4 addr show eth0
ip addr add 10.0.2.15/24 dev eth0
ip addr add 192.168.1.10/24 brd + dev eth0
ip addr replace 192.168.1.11/24 dev eth0     # change the address in place
ip addr del 10.0.2.15/24 dev eth0
ip addr flush dev eth0
```

One IPv4 address per interface: `add` refuses when one is already set (use
`replace`, or `del` first). IPv6 addresses are shown from
`/proc/net/if_inet6` but cannot be added or removed here.

## Routes

```sh
ip route                       # default via 10.0.2.2 dev eth0
                               # 10.0.2.0/24 dev eth0 proto kernel scope link src 10.0.2.15
ip route add default via 10.0.2.2
ip route add default via 10.0.2.2 dev eth0 metric 100
ip route add 192.168.5.0/24 via 10.0.2.1
ip route add 10.10.0.0/16 dev eth0           # on-link, no gateway
ip route add 10.0.2.99 dev eth0              # host route (/32)
ip route replace default via 10.0.2.1
ip route del default
ip route del 192.168.5.0/24
```

Without `dev`, the interface whose subnet contains the gateway is picked.
IPv6 routes and `ip route get` are not available.

## Neighbours

```sh
ip neigh                       # 10.0.2.2 dev eth0 lladdr 52:55:0a:00:02:02 REACHABLE
```

Read from `/proc/net/arp`. Entries cannot be added or flushed here.

## Bringing up a wired network by hand

The QEMU user-mode network `init.js` configures at boot, done manually:

```sh
ip link set eth0 up
ip addr add 10.0.2.15/24 dev eth0
ip route add default via 10.0.2.2
echo 'nameserver 10.0.2.3' > /etc/resolv.conf
ip -br addr && ip route
```

A real Ethernet port is the same three commands once its driver is loaded
and the cable shows `LOWER_UP` in `ip link`; the address and gateway come
from your network (there is no DHCP client yet). If `ip link` shows no
`eth0`, load the driver first from the Bun REPL:

```js
cfg.net       // loads network modules and matches PCI/USB network devices
```

It uses `/lib/modprobe.js`'s `autoload()`, which reads each device's
`modalias` under `/sys/bus/{pci,virtio,usb}/devices` and loads whatever
`modules.alias` says claims it. An image built with `--real` carries Intel
`e1000`/`e1000e`/`igb`/`igc`, Realtek `r8169` (+ PHY), Atheros `alx`,
Broadcom `tg3` and the USB dongles `r8152`, `ax88179_178a`, `cdc_ether`.
A single module by name: `require("/lib/modprobe.js").modprobe("e1000e")`.

## Output format

`ip link` / `ip addr` print the iproute2 layout:

```
2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 state UP qlen 1000
    link/ether 52:54:00:12:34:56 brd ff:ff:ff:ff:ff:ff
    inet 10.0.2.15/24 brd 10.0.2.255 scope global eth0
    inet6 fe80::5054:ff:fe12:3456/64 scope link
```

`NO-CARRIER` appears when the link is up but has no carrier (unplugged, or
the driver never attached).

## Limits of the ioctl approach

- One IPv4 address per interface, no secondary addresses, no labels.
- IPv6: display only.
- No `link add`/`del`, no `route get`, no `neigh add`, no policy routing,
  no netns.
- Route `proto`, `scope`, `src` and `table` words are accepted and ignored.

## Exit status

`0` ok, `1` bad usage or unknown object, `2` the kernel refused
(`RTNETLINK answers: ...` style messages, plus the errno text).

## See also

- `mount --help`, `umount --help`
- [ip(8)](https://man7.org/linux/man-pages/man8/ip.8.html),
  [netdevice(7)](https://man7.org/linux/man-pages/man7/netdevice.7.html),
  [route(7)](https://man7.org/linux/man-pages/man7/route.7.html)
- [/proc/net/route](https://docs.kernel.org/filesystems/proc.html#networking-info-in-proc-net),
  [sysfs net class](https://docs.kernel.org/ABI/testing/sysfs-class-net.html)
- Source: `initramfs/bin/ip`, `initramfs/lib/dlopen.js` in
  [buninu-linux](https://github.com/jjtseng93/buninu-linux)
