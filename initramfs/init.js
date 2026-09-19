console.log("init.js: Bun runtime entered JavaScript");

const { dlopen, FFIType, ptr, read } = await import("bun:ffi");

console.log("init.js: loading physical musl libc for FFI");

const libc = dlopen("/lib/libc.musl-x86_64.so.1", {
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
  for (const [source, target, type] of [
    ["proc", "/proc", "proc"],
    ["sysfs", "/sys", "sysfs"],
    ["devtmpfs", "/dev", "devtmpfs"],
    ["tmpfs", "/tmp", "tmpfs"],
  ]) {
    const result = libc.symbols.mount(
      ptr(cString(source)),
      ptr(cString(target)),
      ptr(cString(type)),
      0n,
      null,
    );
    if (result === 0) continue;
    if (errno() === 16) continue; // EBUSY: already mounted
    console.error(`mount(${type}, ${target}) failed: errno ${errno()}`);
  }
};

mountFilesystems();
console.log("init.js: mounted /proc, /sys, /dev, /tmp");

const { default: repl } = await import("node:repl");
const { mkdirSync, writeFileSync } = await import("node:fs");

global.repl = repl;


const loadModule = (path) => {
  const name = cString(path);
  const fd = check(`open(${path})`, libc.symbols.open(ptr(name), 0, 0));
  try {
    const parameters = cString("");
    // -EEXIST is harmless when firmware or another module loaded it first.
    // musl has no finit_module wrapper, so use its generic syscall(2).
    check(`finit_module(${path})`, libc.symbols.syscall(313, fd, ptr(parameters), 0), [-17]);
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

const configureQemuNetwork = () => {
  const release = process.env.KERNEL_RELEASE ?? "6.18.52-0-virt";
  for (const module of [
    `lib/modules/${release}/kernel/net/core/failover.ko`,
    `lib/modules/${release}/kernel/drivers/net/net_failover.ko`,
    `lib/modules/${release}/kernel/drivers/net/virtio_net.ko`,
  ]) loadModule(`/${module}`);

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

    // struct rtentry on Linux x86_64. Only gateway and flags are needed for
    // the default route; rt_dst and rt_genmask remain 0.0.0.0.
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

const reapChildren = () => {
  const status = new Int32Array(1);
  while (libc.symbols.waitpid(-1, ptr(status), 1) > 0) {}
};

process.on("SIGCHLD", reapChildren);

process.on("SIGTERM", () => console.log("PID 1 received SIGTERM"));
process.on("SIGINT", () => console.log("PID 1 received SIGINT"));


try {
  bringUpLoopback();
  console.log("network: lo 127.0.0.1/8");
} catch (error) {
  console.error("loopback setup failed:", error);
}

try {
  configureQemuNetwork();
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

  const entry = `/buninu/bin/init.js`;
  console.log(`buninu: Starting ${entry} --local`);
  const shell = Bun.spawnSync([
    "/bin/bun", entry, "--local"
  ], {
    env: { 
      PATH:"/bin:/usr/bin:/buninu/bin",
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





console.log(`
Welcome to Buninu Linux!
Bun ${Bun.version} is now PID ${process.pid}
`);

globalThis.bunmsh = launchBunmsh;
//console.log("Type bunmsh() to install and enter the bunmsh shell.");

globalThis.start = launchBuninu;
console.log("Type start() to run buninu --local");

const startRepl = () => {
  const server = repl.start({
    prompt: "bun-repl> ",
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });
  server.on("exit", () => {
    console.log("REPL exited; restarting it to keep PID 1 alive.");
    setTimeout(startRepl, 0);
  });
};

startRepl();
