// /lib/dlopen.js — the shared libc binding for Buninu Linux commands.
//
// init.js opens musl on its own because it runs before /proc exists and must
// not import anything. Every other command imports this module instead, so
// the symbol table, the errno plumbing and the error messages live in one
// place. Automatic lookup follows the runtime ABI; BUNINU_LIBC overrides it.

import { dlopen, FFIType, ptr, read, CString, toArrayBuffer } from "bun:ffi";

export { ptr, read, toArrayBuffer };

// Everything that differs per CPU lives in this table: the musl file name
// and the syscall numbers musl has no wrapper for. Struct layouts used by
// the commands (ifreq, rtentry) are the LP64 ones and hold on both.
const architectures = {
  x64: { libc: "libc.musl-x86_64.so.1", SYS_finit_module: 313 },
  arm64: { libc: "libc.musl-aarch64.so.1", SYS_finit_module: 273 },
};
export const arch = architectures[process.arch]
  ?? (() => { throw new Error(`unsupported CPU architecture ${process.arch}`); })();

// Automatic lookup must not mix bionic, glibc and musl runtime ABIs.
// An explicit override is authoritative: report its error instead of hiding it.
const android = process.platform === "android";
const glibc = !android && !!process.report?.getReport?.().header?.glibcVersionRuntime;
export const libcFamily = android ? "bionic" : glibc ? "glibc" : "musl";
const errnoSymbol = android ? "__errno" : "__errno_location";
const definitions = {
  mount: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u64, FFIType.ptr],
    returns: FFIType.i32,
  },
  umount2: {
    args: [FFIType.ptr, FFIType.i32],
    returns: FFIType.i32,
  },
  reboot: {
    args: [FFIType.i32],
    returns: FFIType.i32,
  },
  sync: {
    args: [],
    returns: FFIType.void,
  },
  [errnoSymbol]: {
    args: [],
    returns: FFIType.ptr,
  },
  strerror: {
    args: [FFIType.i32],
    returns: FFIType.ptr,
  },
  open: {
    args: [FFIType.ptr, FFIType.i32, FFIType.i32],
    returns: FFIType.i32,
  },
  close: {
    args: [FFIType.i32],
    returns: FFIType.i32,
  },
  mmap: {
    args: [FFIType.ptr, FFIType.u64, FFIType.i32, FFIType.i32, FFIType.i32, FFIType.i64],
    returns: FFIType.ptr,
  },
  msync: {
    args: [FFIType.ptr, FFIType.u64, FFIType.i32],
    returns: FFIType.i32,
  },
  munmap: {
    args: [FFIType.ptr, FFIType.u64],
    returns: FFIType.i32,
  },
  ioctl: {
    args: [FFIType.i32, FFIType.u64, FFIType.ptr],
    returns: FFIType.i32,
  },
  socket: {
    args: [FFIType.i32, FFIType.i32, FFIType.i32],
    returns: FFIType.i32,
  },
  bind: { args: [FFIType.i32, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
  inet_pton: { args: [FFIType.i32, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
  connect: { args: [FFIType.i32, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
  getsockname: { args: [FFIType.i32, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
  setsockopt: { args: [FFIType.i32, FFIType.i32, FFIType.i32, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
  send: { args: [FFIType.i32, FFIType.ptr, FFIType.u64, FFIType.i32], returns: FFIType.i64 },
  sendto: { args: [FFIType.i32, FFIType.ptr, FFIType.u64, FFIType.i32, FFIType.ptr, FFIType.u32], returns: FFIType.i64 },
  recv: { args: [FFIType.i32, FFIType.ptr, FFIType.u64, FFIType.i32], returns: FFIType.i64 },
  syscall: {
    args: [FFIType.i64, FFIType.i64, FFIType.ptr, FFIType.i64],
    returns: FFIType.i32,
  },
  waitpid: {
    args: [FFIType.i32, FFIType.ptr, FFIType.i32],
    returns: FFIType.i32,
  },
  prctl: {
    args: [FFIType.i32, FFIType.ptr, FFIType.u64, FFIType.u64, FFIType.u64],
    returns: FFIType.i32,
  },
  chroot: {
    args: [FFIType.ptr],
    returns: FFIType.i32,
  },
};
const override = process.env.BUNINU_LIBC;
const candidates = override !== undefined ? [override]
  : android ? ["libc.so", "/apex/com.android.runtime/lib64/bionic/libc.so", "/system/lib64/libc.so"]
  : glibc ? ["libc.so.6", `/lib/${process.arch === "x64" ? "x86_64" : "aarch64"}-linux-gnu/libc.so.6`, `/usr/lib/${process.arch === "x64" ? "x86_64" : "aarch64"}-linux-gnu/libc.so.6`]
  : [`${import.meta.dir}/${arch.libc}`, arch.libc, `/lib/${arch.libc}`, `/lib/ld-musl-${process.arch === "x64" ? "x86_64" : "aarch64"}.so.1`, "libc.so"];
// Bun requires at least one symbol per dlopen call. Defer opening until a
// symbol is requested; unrelated missing symbols never prevent an import.
export let libcPath;
const handles = [], bound = new Map();
let closed = false;
function resolve(name) {
  if (bound.has(name)) return bound.get(name);
  const failures = [];
  for (const path of libcPath === undefined ? candidates : [libcPath]) {
    try {
      const handle = dlopen(path, { [name]: definitions[name] });
      libcPath = path; handles.push(handle); bound.set(name, handle.symbols[name]);
      return handle.symbols[name];
    } catch (error) { failures.push(`${path}: ${error.message}`); }
  }
  throw new Error(`Cannot load libc symbol ${name}:\n${failures.join("\n")}`);
}
export const libc = {
  symbols: new Proxy({}, {
    get(_target, name) {
      if (closed) throw new Error("libc is closed");
      if (!Object.hasOwn(definitions, name)) return undefined;
      const symbol = resolve(name);
      // Compile the errno accessor before the native call, so first-use FFI
      // compilation cannot clobber the errno that the caller wants to inspect.
      // An absent accessor only fails when errno() is actually requested.
      if (name !== errnoSymbol && !bound.has(errnoSymbol)) {
        try { resolve(errnoSymbol); } catch {}
      }
      return symbol;
    },
  }),
  close() { if (closed) return; closed = true; for (const handle of handles) handle.close(); },
};

export const cString = (value) => new TextEncoder().encode(`${value}\0`);

// musl reports failure as -1 plus errno; the raw syscall() wrapper does too.
export const errno = () => read.i32(libc.symbols[errnoSymbol]());
export const strerror = (code) => new CString(libc.symbols.strerror(code)).toString();

export const Errno = {
  EPERM: 1, ENOENT: 2, ESRCH: 3, EIO: 5, ENXIO: 6, EBADF: 9, EAGAIN: 11, ENOMEM: 12,
  EACCES: 13, EBUSY: 16, EEXIST: 17, ENODEV: 19, ENOTDIR: 20, EISDIR: 21,
  EINVAL: 22, EROFS: 30, ENOTEMPTY: 39, ENOPKG: 65, ENOTSUP: 95,
  EADDRNOTAVAIL: 99, ENETUNREACH: 101,
};

export class SysError extends Error {
  constructor(operation, code = errno()) {
    super(`${operation}: ${strerror(code)}`);
    this.name = "SysError";
    this.operation = operation;
    this.errno = code;
  }
}

// Wraps a libc call: throws SysError on -1 unless errno is in `allowed`,
// in which case the negated errno comes back so the caller can tell.
export const check = (operation, result, allowed = []) => {
  if (result !== -1) return result;
  const code = errno();
  if (allowed.includes(code)) return -code;
  throw new SysError(operation, code);
};

// An AF_INET datagram socket is the handle every SIOC* interface and route
// ioctl wants. `use` receives an ioctl(request, buffer, operation) closure.
export const withInetSocket = (use) => {
  const fd = check("socket(AF_INET, SOCK_DGRAM)", libc.symbols.socket(2, 2, 0));
  try {
    const ioctl = (request, buffer, operation, allowed) =>
      check(operation, libc.symbols.ioctl(fd, request, ptr(buffer)), allowed);
    return use(ioctl, fd);
  } finally {
    libc.symbols.close(fd);
  }
};
