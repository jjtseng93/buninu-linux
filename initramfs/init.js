console.log("init.js: Bun runtime entered JavaScript");

const { dlopen, FFIType, ptr, read } = await import("bun:ffi");

// The musl file name and the number of finit_module, which musl has no
// wrapper for, are all that differs per CPU in this file. /lib/dlopen.js has
// the same table for the commands; it is repeated rather than imported so
// that nothing but bun:ffi loads before the mounts below.
const architecture = {
  x64: { libc: "libc.musl-x86_64.so.1", SYS_finit_module: 313 },
  arm64: { libc: "libc.musl-aarch64.so.1", SYS_finit_module: 273 },
}[process.arch];
if (!architecture) throw new Error(`init.js: unsupported CPU architecture ${process.arch}`);

console.log(`init.js: loading physical musl libc /lib/${architecture.libc} for FFI`);

const libc = dlopen(`/lib/${architecture.libc}`, {
  mount: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u64, FFIType.ptr],
    returns: FFIType.i32,
  },
  __errno_location: {
    args: [],
    returns: FFIType.ptr,
  },
  waitpid: {
    args: [FFIType.i32, FFIType.ptr, FFIType.i32],
    returns: FFIType.i32,
  },
  open: {
    args: [FFIType.ptr, FFIType.i32, FFIType.i32],
    returns: FFIType.i32,
  },
  syscall: {
    args: [FFIType.i64, FFIType.i64, FFIType.ptr, FFIType.i64],
    returns: FFIType.i32,
  },
  socket: {
    args: [FFIType.i32, FFIType.i32, FFIType.i32],
    returns: FFIType.i32,
  },
  ioctl: {
    args: [FFIType.i32, FFIType.u64, FFIType.ptr],
    returns: FFIType.i32,
  },
  close: {
    args: [FFIType.i32],
    returns: FFIType.i32,
  },
  mkdir: {
    args: [FFIType.ptr, FFIType.i32],
    returns: FFIType.i32,
  },
});

const cString = (value) => new TextEncoder().encode(`${value}\0`);
const check = (operation, result, allowed = []) => {
  if (result < 0 && !allowed.includes(result)) {
    throw new Error(`${operation} failed: Linux errno ${-result}`);
  }
  return result;
};

// The libc wrappers report failure as -1 plus errno, unlike the raw syscalls
// used elsewhere in this file, which return the negated error directly.
const errnoLocation = libc.symbols.__errno_location();
const errno = () => read.i32(errnoLocation);

// Bun is PID 1 on a kernel that mounted nothing but the initramfs, so these
// are the first syscalls of the system. Bun gets this far on the cpio alone:
// `-e` never opens an entry file, so it never readlinks /proc/self/fd/N, and
// the devices it does need are recorded in the archive by scripts/pack-initramfs.sh.
// From here on /proc must exist, because path canonicalization (`bun install`,
// `node:fs` realpath, the resolver's symlink handling) uses /proc/self/fd/N,
// and /dev has to become devtmpfs for anything beyond the handful of nodes the
// archive carries.
//
// EBUSY is tolerated so this still works if something else mounted them first.
const mountFilesystems = () => {
  for (const [source, target, type, data] of [
    ["proc", "/proc", "proc"],
    ["sysfs", "/sys", "sysfs"],
    ["devtmpfs", "/dev", "devtmpfs"],
    ["tmpfs", "/tmp", "tmpfs"],
    // Since Linux 4.7 open("/dev/ptmx") resolves through /dev/pts/ptmx, so
    // without this mount every pty open fails with ENODEV. The directory is
    // created on the devtmpfs mounted just above.
    ["devpts", "/dev/pts", "devpts", "gid=5,mode=620,ptmxmode=666"],
  ]) {
    if (type === "devpts") libc.symbols.mkdir(ptr(cString(target)), 0o755);
    const result = libc.symbols.mount(
      ptr(cString(source)),
      ptr(cString(target)),
      ptr(cString(type)),
      0n,
      data === undefined ? null : ptr(cString(data)),
    );
    if (result === 0) continue;
    if (errno() === 16) continue; // EBUSY: already mounted
    console.error(`mount(${type}, ${target}) failed: errno ${errno()}`);
  }
};

mountFilesystems();
console.log("init.js: mounted /proc, /sys, /dev, /tmp, /dev/pts");

// Num Lock. The keypad's lock state lives per virtual console in the
// kernel's keyboard table, and the kernel starts every console with it off,
// so the keypad types arrows instead of digits. KDSKBLED carries the current
// flags in its low nibble and the ones a console is reset to in its high
// nibble; KDSETLED with a value above 7 puts the physical LED back to
// following those flags. A console allocated later (Ctrl-Alt-F3 for the
// first time) starts from the kernel default again, so numlock() is left in
// the REPL for that case.
const KDSETLED = 0x4b32;
const KDGKBLED = 0x4b64;
const KDSKBLED = 0x4b65;
const LED_NUM = 0x02;

// Nothing here is essential to booting, so a console that is not a virtual
// terminal, a missing device node or a rejected ioctl is skipped rather than
// reported: the remaining consoles are still set, and the system comes up
// either way.
const setNumLock = (enabled = true) => {
  const consoles = [];
  const paths = ["/dev/tty0", "/dev/console", "/dev/tty"];
  for (let index = 1; index <= 12; index++) paths.push(`/dev/tty${index}`);
  for (const path of paths) {
    let fd = -1;
    try {
      fd = libc.symbols.open(cString(path), 2, 0);
      if (fd < 0) continue;
      const state = new Uint8Array(1);
      if (libc.symbols.ioctl(fd, KDGKBLED, ptr(state)) !== 0) continue;
      const current = enabled ? state[0] | LED_NUM : state[0] & ~LED_NUM;
      const fallback = enabled ? (state[0] >> 4) | LED_NUM : (state[0] >> 4) & ~LED_NUM;
      const flags = (current & 7) | ((fallback & 7) << 4);
      if (libc.symbols.ioctl(fd, KDSKBLED, flags) !== 0) continue;
      libc.symbols.ioctl(fd, KDSETLED, 0x80);
      consoles.push(path);
    } catch {
      // This console keeps whatever state it had; the others still get set.
    } finally {
      if (fd >= 0) {
        try { libc.symbols.close(fd); } catch {}
      }
    }
  }
  return consoles;
};

globalThis.numlock = setNumLock;
try {
  const consoles = setNumLock(true);
  console.log(consoles.length
    ? `init.js: num lock on (${consoles.join(" ")})`
    : "init.js: no virtual console accepted a num lock setting");
} catch (error) {
  console.error(`init.js: num lock: ${error?.message ?? error}`);
}

// The input layer's character devices, so a pointing device has a
// /dev/input/event* node for `bunterm --mouse` to read. Loading them only
// creates those nodes: the console keyboard is unaffected, and nothing reads
// a pointer unless it is asked to. psmouse is the PS/2 mouse of a PC or q35;
// QEMU's aarch64 virt machine has virtio-input instead. Each image ships only
// the one its machine has, and tryModprobe skips the other. A USB mouse also
// needs the usbhid stack, which `cfg.all` or a --real boot brings in.
try {
  const { tryModprobe } = await import("/lib/modprobe.js");
  const loaded = ["evdev", "psmouse", "virtio_input"].filter((module) => tryModprobe(module) !== null);
  const { readdirSync } = await import("node:fs");
  const devices = (() => {
    try { return readdirSync("/dev/input").filter((name) => name.startsWith("event")); } catch { return []; }
  })();
  console.log(`init.js: input modules ${loaded.length ? loaded.join(" ") : "none"}`
    + ` (${devices.length} event device${devices.length === 1 ? "" : "s"})`);
} catch (error) {
  console.error(`init.js: input modules: ${error?.message ?? error}`);
}

const { default: repl } = await import("node:repl");
const { mkdirSync, writeFileSync } = await import("node:fs");

global.repl = repl;

// QEMU user networking exposes its DNS proxy at 10.0.2.3. A real-machine
// image instead starts with public resolvers until the user configures DNS
// for the local network.
writeFileSync(
  "/etc/resolv.conf",
  process.env.REAL_MACHINE === "1"
    ? "nameserver 1.1.1.1\nnameserver 8.8.8.8\n"
    : "nameserver 10.0.2.3\n",
);


const loadModule = (path) => {
  const name = cString(path);
  const fd = check(`open(${path})`, libc.symbols.open(ptr(name), 0, 0));
  try {
    const parameters = cString("");
    // -EEXIST is harmless when firmware or another module loaded it first.
    // musl has no finit_module wrapper, so use its generic syscall(2).
    check(
      `finit_module(${path})`,
      libc.symbols.syscall(architecture.SYS_finit_module, fd, ptr(parameters), 0),
      [-17],
    );
  } finally {
    libc.symbols.close(fd);
  }
};

const writeInterfaceName = (buffer, name = "eth0") => {
  buffer.set(new TextEncoder().encode(name), 0);
};

const writeSockaddrIpv4 = (buffer, offset, address) => {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  view.setUint16(offset, 2, true); // AF_INET (host endian)
  buffer.set(address.split(".").map(Number), offset + 4); // network byte order
};

// Sets IFF_UP on an interface: read its flags, or in the bit, write them back.
const bringUp = (ioctl, name) => {
  const flags = new Uint8Array(40);
  const flagsView = new DataView(flags.buffer);
  writeInterfaceName(flags, name);
  ioctl(0x8913, flags, "SIOCGIFFLAGS");
  flagsView.setUint16(16, flagsView.getUint16(16, true) | 1, true); // IFF_UP
  ioctl(0x8914, flags, "SIOCSIFFLAGS");
};

// The kernel creates `lo` down, and only assigns 127.0.0.1/8 once it comes
// up. Normally an init system does that; here that is us, and until it is
// done every bind to 127.0.0.1 fails with EADDRNOTAVAIL. Kept apart from the
// virtio/QEMU setup so loopback works even when that part fails.
const bringUpLoopback = () => {
  const fd = check("socket(AF_INET, SOCK_DGRAM)", libc.symbols.socket(2, 2, 0));
  try {
    const ioctl = (request, value, operation) =>
      check(operation, libc.symbols.ioctl(fd, request, ptr(value)));
    bringUp(ioctl, "lo");
  } finally {
    libc.symbols.close(fd);
  }
};

// Which virtio pieces are modules differs per kernel flavor and CPU (linux-lts
// has virtio_pci as a module, linux-virt builds it in), so /lib/modprobe.js
// resolves them from the shipped modules.dep and modules.builtin: the PCI
// transport first, since nothing in modules.dep depends on it, then the NIC.
const configureQemuNetwork = async () => {
  const { modprobe, tryModprobe } = await import("/lib/modprobe.js");
  tryModprobe("virtio_pci");
  modprobe("virtio_net");

  const fd = check("socket(AF_INET, SOCK_DGRAM)", libc.symbols.socket(2, 2, 0));
  const ioctl = (request, value, operation) =>
    check(operation, libc.symbols.ioctl(fd, request, ptr(value)));

  try {
    const address = new Uint8Array(40);
    writeInterfaceName(address);
    writeSockaddrIpv4(address, 16, "10.0.2.15");
    ioctl(0x8916, address, "SIOCSIFADDR");

    const netmask = new Uint8Array(40);
    writeInterfaceName(netmask);
    writeSockaddrIpv4(netmask, 16, "255.255.255.0");
    ioctl(0x891c, netmask, "SIOCSIFNETMASK");

    bringUp(ioctl, "eth0");

    // struct rtentry on 64-bit Linux, the same on x86_64 and aarch64. Only
    // gateway and flags are needed for the default route; rt_dst and
    // rt_genmask remain 0.0.0.0.
    const route = new Uint8Array(120);
    const routeView = new DataView(route.buffer);
    writeSockaddrIpv4(route, 8, "0.0.0.0");
    writeSockaddrIpv4(route, 24, "10.0.2.2");
    writeSockaddrIpv4(route, 40, "0.0.0.0");
    routeView.setUint16(56, 0x0001 | 0x0002, true); // RTF_UP | RTF_GATEWAY
    const device = cString("eth0");
    routeView.setBigUint64(88, BigInt(ptr(device)), true);
    ioctl(0x890b, route, "SIOCADDRT");
  } finally {
    libc.symbols.close(fd);
  }
};

const configureRealKeyboard = () => {
  if (process.env.REAL_MACHINE !== "1") return;
  const release = process.env.KERNEL_RELEASE;
  for (const module of [
    "drivers/usb/common/usb-common.ko",
    "drivers/usb/core/usbcore.ko",
    "drivers/usb/host/xhci-hcd.ko",
    "drivers/usb/host/xhci-pci.ko",
    "drivers/usb/host/xhci-pci-renesas.ko",
    "drivers/hid/hid.ko",
    "drivers/hid/hid-generic.ko",
    "drivers/hid/usbhid/usbhid.ko",
  ]) loadModule(`/lib/modules/${release}/kernel/${module}`);
};

// ACPI battery, AC adapter, power button and thermal zones are modules on
// Alpine's kernels; until they are loaded /sys/class/power_supply is empty.
// Loaded on demand from the REPL as cfg.power, through /lib/modprobe.js (a
// require() is fine here: /proc exists by the time anyone can type it). The
// modules are only in the image when it was built with --real.
const configureBattery = () => {
  const { modprobe } = require("/lib/modprobe.js");
  for (const module of ["battery", "ac", "button", "thermal"]) {
    try {
      const inserted = modprobe(module);
      console.log(`acpi: ${module} ${inserted.length ? "loaded" : "already loaded"}`);
    } catch (error) {
      console.error(`acpi: ${module}: ${error.message}`);
    }
  }
  const { readdirSync, readFileSync } = require("node:fs");
  const read = (path) => { try { return readFileSync(path, "utf8").trim(); } catch { return "-"; } };
  const supplies = (() => { try { return readdirSync("/sys/class/power_supply"); } catch { return []; } })();
  if (supplies.length === 0) console.log("power_supply: nothing registered (no ACPI battery or AC adapter on this machine)");
  for (const name of supplies) {
    const base = `/sys/class/power_supply/${name}`;
    const type = read(`${base}/type`);
    const detail = type === "Battery"
      ? `${read(`${base}/status`)} ${read(`${base}/capacity`)}%`
      : `online=${read(`${base}/online`)}`;
    console.log(`power_supply: ${name} ${type} ${detail}`);
  }
  return supplies;
};

const reapChildren = () => {
  const status = new Int32Array(1);
  while (libc.symbols.waitpid(-1, ptr(status), 1) > 0) {}
};

process.on("SIGCHLD", reapChildren);

process.on("SIGTERM", () => console.log("PID 1 received SIGTERM"));
process.on("SIGINT", () => console.log("PID 1 received SIGINT"));

// The REPL catches what its eval throws, but not a rejection or a throw
// from a timer or callback: Bun then exits, and PID 1 exiting is a kernel
// panic ("Attempted to kill init!"). With a listener installed Bun only
// reports, so a stray `Promise.reject()` at the prompt stays a message.
process.on("uncaughtException", (error) => console.error("PID 1 uncaught exception (ignored):", error));
process.on("unhandledRejection", (reason) => console.error("PID 1 unhandled rejection (ignored):", reason));


try {
  bringUpLoopback();
  console.log("network: lo 127.0.0.1/8");
} catch (error) {
  console.error("loopback setup failed:", error);
}

try {
  configureRealKeyboard();
  if (process.env.REAL_MACHINE === "1") console.log("input: USB xHCI/HID enabled");
} catch (error) {
  console.error("USB keyboard setup failed:", error);
}


try {
  await configureQemuNetwork();
  console.log("network: eth0 10.0.2.15/24 via 10.0.2.2");
  const response = await fetch("http://example.com");
  console.log(`fetch example.com: HTTP ${response.status}, ${response.headers.get("content-type")}`);
} catch (error) {
  console.error("network setup failed:", error);
}

const launchBunmsh = () => {
  const runtimeDirectory = "/tmp/bunmsh-runtime";
  const homeDirectory = "/tmp/home";
  const environment = {
    PATH: "/bin",
    HOME: homeDirectory,
    TMPDIR: "/tmp",
    TERM: process.env.TERM ?? "linux",
    //PS1: "bunmsh$ ",
  };

  mkdirSync(runtimeDirectory, { recursive: true });
  mkdirSync(homeDirectory, { recursive: true });
  writeFileSync(`${runtimeDirectory}/package.json`, JSON.stringify({
    private: true,
    dependencies: { bunmsh: "0.3.6" },
  }));

  console.log("bunmsh: installing bunmsh@0.3.6 into /tmp/bunmsh-runtime");
  const install = Bun.spawnSync([
    "/bin/bun", "install", "--cwd", runtimeDirectory, "--production", "--no-progress",
  ], {
    cwd: runtimeDirectory,
    env: environment,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  if (install.exitCode !== 0) throw new Error(`bun install exited with ${install.exitCode}`);

  const entry = `${runtimeDirectory}/node_modules/bunmsh/src/main.js`;
  console.log(`bunmsh: starting ${entry}`);
  const shell = Bun.spawnSync(["/bin/bun", entry], {
    cwd: "/",
    env: environment,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  console.log(`bunmsh exited with status ${shell.exitCode}; returning to Bun REPL.`);
  return shell.exitCode;
};



const launchBuninu = () => {

  console.log(`
Type bunterm in bunmsh: Graphical Terminal
  Shows Emojis, CJK chars
  Supports Kitty Graphics Protocol
`)

  const entry = `/buninu/bin/init.js`;
  console.log(`buninu: Starting ${entry} --local`);
  const shell = Bun.spawnSync([
    "/bin/bun", entry, "--local"
  ], {
    env: {
      ...process.env,
      PATH:"/bin:/sbin:/usr/bin:/usr/sbin:/buninu/.bun/bin:/buninu/bin",
      HOME:"/buninu"
    },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  console.log(`buninu exited with status ${shell.exitCode}; returning to Bun REPL.`);
  return shell.exitCode;
  
}





//  Configuration complete


globalThis.bunmsh = launchBunmsh;
//console.log("Type bunmsh() to install and enter the bunmsh shell.");

globalThis.start = launchBuninu;

// cfg.net loads every packaged network module, including PHY and bus support
// that a kernel userspace modprobe helper would normally load on demand. It
// then reports the device matches and lists the resulting interfaces. The
// address and route are still yours to set with `ip`.
const configureEthernet = () => {
  const { autoload, modprobeAll } = require("/lib/modprobe.js");
  const { readdirSync, readFileSync } = require("node:fs");
  const read = (path) => { try { return readFileSync(path, "utf8").trim(); } catch { return "-"; } };
  const all = modprobeAll({ accept: (_module, path) => path.startsWith("kernel/drivers/net/") });
  console.log(`eth: loaded all packaged network modules (${all.inserted.length} newly loaded, ${all.errors.length} failed)`);
  for (const { module, error } of all.errors) console.log(`eth: ${module}: ${error}`);
  const report = autoload({
    // PCI class 02 (network), virtio device id 1 (net), every USB device —
    // but only network drivers, so a USB keyboard does not show up as usbhid.
    accept: (modalias) => /^usb:/.test(modalias) || /^virtio:d00000001v/.test(modalias) || /bc02sc/.test(modalias),
    acceptModule: (module, path) => path.startsWith("kernel/drivers/net/"),
  });
  if (report.length === 0) console.log("eth: no network device matched a module in the image (driver built in, or not built with --real)");
  // Network devices nothing in the image claims, so the chip is at least named.
  try {
    for (const device of readdirSync("/sys/bus/pci/devices")) {
      const modalias = read(`/sys/bus/pci/devices/${device}/modalias`);
      if (!/bc02sc/.test(modalias) || report.some((entry) => entry.device === device)) continue;
      const [, vendor, id] = /^pci:v0000([0-9A-F]{4})d0000([0-9A-F]{4})/.exec(modalias) ?? [];
      const kind = /bc02sc80/.test(modalias) ? "wireless" : "network";
      console.log(`eth: pci ${device} ${kind} controller ${vendor}:${id} has no driver in the image`);
    }
  } catch {}
  for (const { bus, device, modules, loaded, error } of report) {
    const status = error ?? (loaded.length ? `loaded ${loaded.join(" ")}` : "already loaded");
    console.log(`eth: ${bus} ${device} -> ${modules.join(" ")}: ${status}`);
  }
  const interfaces = (() => { try { return readdirSync("/sys/class/net").filter((name) => name !== "lo"); } catch { return []; } })();
  for (const name of interfaces) {
    const carrier = read(`/sys/class/net/${name}/carrier`);
    console.log(`eth: ${name} ${read(`/sys/class/net/${name}/address`)} ${read(`/sys/class/net/${name}/operstate`)}${carrier === "1" ? " carrier" : ""}`);
  }
  if (interfaces.length) console.log(`eth:
  Next steps in shell( after start() ):
  ip link set ${interfaces[0]} up
  ip addr add A.B.C.D/24 dev ${interfaces[0]};
  ip route add default via GATEWAY
`);
  return interfaces;
};

// Explicit full coldplug for this deliberately tiny system: load every .ko
// represented in modules.dep, recursively including each module's declared
// dependencies. Failures are reported individually without stopping the rest.
const configureModules = () => {
  const { modprobeAll } = require("/lib/modprobe.js");
  const report = modprobeAll();
  console.log(`modules: ${report.inserted.length} newly loaded, ${report.errors.length} failed`);
  for (const { module, error } of report.errors) console.log(`modules: ${module}: ${error}`);
  return report;
};

// Load the packaged storage stack so devtmpfs can expose disks before the
// user has a concrete /dev path to pass to mount. This covers virtio block,
// SATA/PATA/SCSI, NVMe behind VMD, and USB mass-storage/UAS.
const configureDisks = () => {
  const { modprobeAll } = require("/lib/modprobe.js");
  const { readdirSync } = require("node:fs");
  const storagePath = /^kernel\/drivers\/(?:ata\/|block\/virtio_blk\.ko$|nvme\/|pci\/controller\/vmd\.ko$|scsi\/|usb\/storage\/)/;
  const report = modprobeAll({ accept: (_module, path) => storagePath.test(path) });
  console.log(`disk: ${report.inserted.length} newly loaded, ${report.errors.length} failed`);
  for (const { module, error } of report.errors) console.log(`disk: ${module}: ${error}`);
  const devices = (() => { try { return readdirSync("/sys/class/block"); } catch { return []; } })();
  console.log(`disk: ${devices.length ? devices.map((name) => `/dev/${name}`).join(" ") : "no block devices registered"}`);
  return devices;
};

globalThis.cfg = Object.freeze(Object.defineProperties({}, {
  all: { enumerable: true, get: configureModules },
  disk: { enumerable: true, get: configureDisks },
  net: { enumerable: true, get: configureEthernet },
  power: { enumerable: true, get: configureBattery },
}));

// Compatibility aliases for images and notes that used the original API.
globalThis.cfgEth = configureEthernet;
globalThis.cfgNet = configureEthernet;
globalThis.cfgDisk = configureDisks;
globalThis.cfgMod = configureModules;
globalThis.cfgBat = configureBattery;

const showWelcome = () => {
  console.log(`
Welcome to Buninu Linux!
Bun ${Bun.version} is now PID ${process.pid}
Type start() to run buninu --local`);
  if (process.env.REAL_MACHINE === "1") {
    console.log(`Configuration getters: ${Object.keys(globalThis.cfg).map((name) => `cfg.${name}`).join(", ")}`);
  }
  console.log();
};

showWelcome();

const startRepl = () => {
  const server = repl.start({
    prompt: "bun-repl> ",
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });
  // Run before REPL's own line listener so its next prompt is printed after
  // the repeated welcome. Empty and whitespace-only lines both trigger it.
  server.prependListener("line", (line) => {
    if (line.trim() === "") showWelcome();
  });
  server.on("exit", () => {
    console.log("REPL exited; restarting it to keep PID 1 alive.");
    setTimeout(startRepl, 0);
  });
};

startRepl();
