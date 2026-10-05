// Everything that differs between the two guest architectures and the two
// kernel flavors, as scripts/arch.sh has it: the pinned packages and their
// SHA-256, the file names inside them, the EFI names and the serial console.
// fetch.js, pack.js and build.js take the object config() returns.
//
//   config({ arch, flavor, real, mirror })   arguments override
//   BUNINU_ARCH, LINUX_FLAVOR, REAL_MACHINE=1 and ALPINE_MIRROR
//
// Paths are absolute, under the checkout. Run directly, it prints the config.

import { accessSync, constants } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const pins = {
  x86_64: {
    linuxVirtSha256: "a941c15fc5db26b6692fd0140fa0970da76cb12aadf3dc8306c419f21bd39c93",
    linuxLtsSha256: "02ba9491d4cc110707de64ed03dd7e2fa5c93fdd851979c244ceb018785a9eea",
    muslSha256: "573712e2f49c15bfc20a2699f204acdfc74c772722b15e7353d768057fae0e71",
    stubSha256: "8e64a5a3afee5f930e6e6716be726dc6d405530ac7f8fa5be6251dae68671ec9",
    libstdcppSha256: "14c987b556f5385a5db18376e788c75f37d85321b8dc1920d926ea7daac1d6f6",
    libgccSha256: "393dcd32629f06d7d85409c272d142d0c082772d10b87ef55ee82f47de3be637",
    // Bun ships one x64 musl build; -baseline is an alias (NOTICE.md).
    bunBuild: "bun-linux-x64-musl-baseline",
    bunSha256: "76e1db84e98f22f78de0a87e309bfbbf297732847f9720db36750646c85c8c18",
    efiStub: "linuxx64.efi.stub",
    efiBootName: "BOOTX64.EFI",
    // COM1 on q35 and on PCs.
    serialConsole: "ttyS0",
    serialMajor: 4,
  },
  aarch64: {
    linuxVirtSha256: "c7fb892408d7fe163a18671e5c7816752976d1c67fd17794dfba794aa0d6c1ac",
    linuxLtsSha256: "31aeae56fa527b2fb4fdd4aefbd693cbec210a8cbfd4ea7597a1773b832e9f83",
    muslSha256: "5e9674b7f41152fe2119093b5cb4c13eaaadb19c2d5422b2d7267913e663ee6e",
    stubSha256: "a1823d2d7082db555d528f82c1809f276c818aeb5b40f198f4565f104e055c38",
    libstdcppSha256: "2302e766d4e4926038ec166ecb85837ee884576115236ddb565e3a5fca4a11d7",
    libgccSha256: "369aaa6e9d099a737bad6dd3e6c2fe7bb1547ca26d22b94ee0411228f709b403",
    bunBuild: "bun-linux-aarch64-musl",
    bunSha256: "71760b6c8ea30623b81a4907cb815d48e2ea266f2e73e751534a44a0607950df",
    efiStub: "linuxaa64.efi.stub",
    efiBootName: "BOOTAA64.EFI",
    // The PL011 UART of QEMU's virt machine.
    serialConsole: "ttyAMA0",
    serialMajor: 204,
  },
};

const normalizeArch = (name) => {
  if (["x86_64", "amd64", "x64"].includes(name)) return "x86_64";
  if (["aarch64", "arm64"].includes(name)) return "aarch64";
  throw new Error(`unsupported BUNINU_ARCH=${name} (use x86_64 or aarch64)`);
};

export const config = ({
  arch = process.env.BUNINU_ARCH || "x86_64",
  flavor = process.env.LINUX_FLAVOR || "virt",
  real = process.env.REAL_MACHINE === "1",
  mirror = process.env.ALPINE_MIRROR || "https://dl-cdn.alpinelinux.org/alpine",
} = {}) => {
  arch = normalizeArch(arch);
  if (flavor !== "virt" && flavor !== "lts") throw new Error(`unsupported LINUX_FLAVOR=${flavor} (use virt or lts)`);
  if (real && arch !== "x86_64") throw new Error("--real images are x86_64 only; its module set is PC hardware");
  const pin = pins[arch];
  // The Alpine repository keeps only the newest build of a package, so a pin
  // stops downloading when Alpine bumps it; the hashes then fail loudly.
  const alpineBase = `${mirror}/v3.24/main/${arch}`;
  const kernelVersion = "6.18.55";
  const kernelRelease = `${kernelVersion}-0-${flavor}`;
  const bunVersion = "1.4.2";
  const downloadsDir = join(rootDir, "downloads", arch);
  const kernelDir = join(rootDir, "kernel", arch);
  const nativeDir = join(rootDir, "native", arch);
  return {
    arch,
    flavor,
    real,
    rootDir,
    alpineBase,
    kernelVersion,
    kernelRelease,
    linuxPackage: `linux-${flavor}-${kernelVersion}-r0.apk`,
    linuxSha256: flavor === "lts" ? pin.linuxLtsSha256 : pin.linuxVirtSha256,
    muslPackage: "musl-1.2.6-r2.apk",
    muslSha256: pin.muslSha256,
    stubPackage: "systemd-efistub-260.2-r0.apk",
    stubSha256: pin.stubSha256,
    libstdcppPackage: "libstdc++-15.2.0-r5.apk",
    libstdcppSha256: pin.libstdcppSha256,
    libgccPackage: "libgcc-15.2.0-r5.apk",
    libgccSha256: pin.libgccSha256,
    bunVersion,
    bunBuild: pin.bunBuild,
    bunSha256: pin.bunSha256,
    bunZip: `${pin.bunBuild}-${bunVersion}.zip`,
    bunUrl: `https://github.com/oven-sh/bun/releases/download/bun-v${bunVersion}/${pin.bunBuild}.zip`,
    downloadsDir,
    kernelDir,
    kernelImage: join(kernelDir, `vmlinuz-${flavor}`),
    nativeDir,
    modulesRoot: join(nativeDir, "lib", "modules", kernelRelease),
    muslLoader: `ld-musl-${arch}.so.1`,
    muslLibc: `libc.musl-${arch}.so.1`,
    efiStub: pin.efiStub,
    efiBootName: pin.efiBootName,
    serialConsole: pin.serialConsole,
    serialMajor: pin.serialMajor,
  };
};

/**
 * The runtime for scripts/cpio.js and scripts/uki.js: bun, else node, from
 * PATH, as the shell scripts' `command -v bun || command -v node` (bun's and
 * node's zlib compress differently), else whatever runs this.
 */
export const jsRuntime = () => {
  for (const name of ["bun", "node"]) {
    for (const directory of (process.env.PATH ?? "").split(delimiter)) {
      if (!directory) continue;
      try {
        accessSync(join(directory, name), constants.X_OK);
        return join(directory, name);
      } catch {}
    }
  }
  return process.execPath;
};

/**
 * Runs `action` with umask 022, so what the stages create gets the same
 * modes everywhere: native Termux runs with 0077, PRoot and most hosts 022,
 * and the modes end up in the initramfs.
 */
export const withUmask022 = async (action) => {
  const previous = process.umask(0o022);
  try {
    return await action();
  } finally {
    process.umask(previous);
  }
};

/** Runs `main` when `url` (a module's import.meta.url) is the script node or bun was started with. */
export const runIfMain = (url, main) => {
  if (!process.argv[1] || resolve(process.argv[1]) !== fileURLToPath(url)) return;
  Promise.resolve()
    .then(main)
    .catch((error) => {
      console.error(`error: ${error.message}`);
      process.exit(1);
    });
};

runIfMain(import.meta.url, () => console.log(JSON.stringify(config(), null, 2)));
