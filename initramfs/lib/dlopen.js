// /lib/dlopen.js — the shared libc binding for Buninu Linux commands.
//
// init.js opens musl on its own because it runs before /proc exists and must
// not import anything. Every other command imports this module instead, so
// the symbol table, the errno plumbing and the error messages live in one
// place. The library is located relative to this file (/lib in the guest),
// which also lets the commands run from a checkout for testing.

import { dlopen, FFIType, ptr, read, CString } from "bun:ffi";

export { ptr, read };

// Everything that differs per CPU lives in this table: the musl file name
// and the syscall numbers musl has no wrapper for. Struct layouts used by
// the commands (ifreq, rtentry) are the LP64 ones and hold on both.
const architectures = {
  x64: { libc: "libc.musl-x86_64.so.1", SYS_finit_module: 313 },
  arm64: { libc: "libc.musl-aarch64.so.1", SYS_finit_module: 273 },
};
export const arch = architectures[process.arch]
  ?? (() => { throw new Error(`unsupported CPU architecture ${process.arch}`); })();

// BUNINU_LIBC lets the commands run on a glibc host for testing:
//   BUNINU_LIBC=/lib/aarch64-linux-gnu/libc.so.6 bun initramfs/bin/ip addr
export const libcPath = process.env.BUNINU_LIBC ?? `${import.meta.dir}/${arch.libc}`;

export const libc = dlopen(libcPath, {
  mount: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u64, FFIType.ptr],
    returns: FFIType.i32,
  },
  umount2: {
    args: [FFIType.ptr, FFIType.i32],
    returns: FFIType.i32,
  },
  __errno_location: {
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
  ioctl: {
    args: [FFIType.i32, FFIType.u64, FFIType.ptr],
    returns: FFIType.i32,
  },
  socket: {
    args: [FFIType.i32, FFIType.i32, FFIType.i32],
    returns: FFIType.i32,
  },
  syscall: {
    args: [FFIType.i64, FFIType.i64, FFIType.ptr, FFIType.i64],
    returns: FFIType.i32,
  },
  waitpid: {
    args: [FFIType.i32, FFIType.ptr, FFIType.i32],
    returns: FFIType.i32,
  },
});

export const cString = (value) => new TextEncoder().encode(`${value}\0`);

// musl reports failure as -1 plus errno; the raw syscall() wrapper does too.
const errnoLocation = libc.symbols.__errno_location();
export const errno = () => read.i32(errnoLocation);
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

// Renders /usr/share/doc/buninu-linux/<name>.md for --help. Hyperlinks are
// on so the references at the end of each page are clickable in terminals
// that support OSC 8.
export const showDocument = async (name) => {
  const path = `${import.meta.dir}/../usr/share/doc/buninu-linux/${name}.md`;
  const rendered = Bun.markdown.ansi(await Bun.file(path).text(), { hyperlinks: true });
  process.stdout.write(rendered.endsWith("\n") ? rendered : `${rendered}\n`);
};
