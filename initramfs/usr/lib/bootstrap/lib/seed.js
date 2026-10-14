import {
  chmodSync, cpSync, mkdirSync, readFileSync, readdirSync,
  renameSync, symlinkSync,
} from "node:fs";
import { join } from "node:path";
import {
  bootstrap, bun, download, elfInterpreter, run, sha256,
  validateElf, write,
} from "./common.js";

const tools = [
  "bin/tar", "bin/unzip", "usr/bin/env",
  "lib/crc32.js", "lib/document.js", "lib/tar-strip.js", "lib/tar-exclude.js",
  "usr/share/doc/buninu-linux/tar.md",
];
const shell = "buninu/apps/bunmsh/";

function addTree(files, directory, prefix) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name), target = prefix + entry.name;
    if (entry.isDirectory()) addTree(files, path, target + "/");
    else files.set(target, readFileSync(path)); // Resolve library/source symlinks.
  }
}

export function localSeed(arch) {
  const files = new Map();
  for (const path of tools) files.set(path, readFileSync("/" + path));
  addTree(files, "/" + shell, shell);
  for (const name of ["libgcc_s.so.1", "libstdc++.so.6"]) {
    let bytes;
    try { bytes = readFileSync("/lib/" + name); }
    catch (error) { if (error.code !== "ENOENT") throw error; bytes = readFileSync("/usr/lib/" + name); }
    files.set("usr/lib/" + name, bytes);
  }
  files.set(`lib/ld-musl-${arch}.so.1`, readFileSync(`/lib/ld-musl-${arch}.so.1`));
  files.set("bin/bun", readFileSync("/bin/bun"));
  files.set("etc/resolv.conf", readFileSync("/etc/resolv.conf"));
  return files;
}

export async function releaseSeed(arch, work) {
  const tarball = await download("buninu-linux@0.9.56");
  // Bun's archive reader works in-process; no host tar is required.
  const entries = await new Bun.Archive(readFileSync(tarball)).files();
  const get = async name => {
    const file = entries.get("package/" + name);
    if (!file) throw new Error(`Pinned buninu-linux tarball is missing ${name}`);
    return Buffer.from(await file.arrayBuffer());
  };
  const files = new Map();
  for (const path of tools) files.set(path, await get("initramfs/" + path));
  for (const [name, file] of entries) {
    const prefix = "package/initramfs/";
    if (name.startsWith(prefix + shell)) files.set(name.slice(prefix.length), Buffer.from(await file.arrayBuffer()));
  }
  for (const name of ["libgcc_s.so.1", "libstdc++.so.6"]) {
    files.set("usr/lib/" + name, await get(`native/${arch}/lib/${name}`));
  }
  const loader = `ld-musl-${arch}.so.1`;
  files.set("lib/" + loader, await get(`native/${arch}/lib/${loader}`));
  files.set("etc/resolv.conf", await get("initramfs/etc/resolv.conf"));

  console.log("② Extracting pinned musl-bun");
  const build = arch === "aarch64" ? "bun-linux-aarch64-musl" : "bun-linux-x64-musl-baseline";
  const zip = await download(`${build}@1.4.2`);
  // unzip is a CLI with top-level process.exit; invoke it separately.
  for (const path of ["bin/unzip", "lib/crc32.js"]) write(join(work, path), files.get(path));
  await run([bun(), join(work, "bin/unzip"), zip, `${build}/bun`, "-d", work]);
  files.set("bin/bun", readFileSync(join(work, build, "bun")));
  return files;
}

export function validateSeed(files, arch) {
  const loader = `lib/ld-musl-${arch}.so.1`;
  for (const name of ["bin/bun", loader, "usr/lib/libgcc_s.so.1", "usr/lib/libstdc++.so.6"]) {
    validateElf(name, files.get(name), arch);
  }
  if (elfInterpreter(files.get("bin/bun")) !== "/" + loader) throw new Error("Bun must use the target musl loader");
  for (const name of ["index.js", "package.json", "src/main.js"]) {
    if (!files.has(shell + name)) throw new Error(`Missing bunmsh ${name}`);
  }
  for (const name of files.keys()) {
    if (name.includes("\\") || name.includes("\0") || name.split("/").some(p => ["", ".", ".."].includes(p))) {
      throw new Error(`Unsafe seed path: ${name}`);
    }
  }
}

export function writeSeed(root, arch, files, origin) {
  mkdirSync(root);
  for (const name of ["bin", "lib", "etc", "usr/lib", "usr/bin", "tmp", "root", "dev", "proc", "sys", "run"]) {
    mkdirSync(join(root, name), { recursive: true });
  }
  for (const [name, bytes] of files) {
    const executable = name.startsWith("bin/") || name.startsWith("usr/bin/")
      || name === shell + "index.js" || /\.so\.[16]$/.test(name);
    write(join(root, name), bytes, executable ? 0o755 : 0o644);
  }
  chmodSync(join(root, "tmp"), 0o1777);
  write(join(root, "bin/sh"), `#!/bin/bun
// Guest entry shell; build stages use their own shell and explicit PATH.
const paths = [
  "/bootstrap/result/bin",
  "/bootstrap/toolchain/bin",
  ...(process.env.PATH || "/bin:/usr/bin").split(":"),
];
process.env.PATH = [...new Set(paths)].join(":");
await import("/buninu/apps/bunmsh/src/main.js");
`, 0o755);
  symlinkSync(`../../lib/ld-musl-${arch}.so.1`, join(root, "usr/lib/libc.so"));
  symlinkSync("libgcc_s.so.1", join(root, "usr/lib/libgcc_s.so"));
  symlinkSync("libc.so", join(root, "usr/lib/libm.so"));
  write(join(root, "etc/buninu-bootstrap.json"), JSON.stringify({ format: 1, arch, origin }, null, 2) + "\n");
}

const sources = [
  ["musl-1.2.6.tar.gz", "d585fd3b613c66151fc3249e8ed44f77020cb5e6c1e635a616d3f9f82460512a"],
  ["tinycc-05f0faf-upstream.tar.gz", "300d4fd6fc4a7294403e17bfd29201954410ac2baa94f189526f6bef83524c19"],
  ["tinycc-local-bootstrap-files.tar.gz", "59216479774f3c61b06420ca9b03ad4b8dcbdbb242d2d236d2daace135e35d59"],
];

export function sourceArchives() {
  return sources.map(([name, hash]) => {
    const bytes = readFileSync(join(bootstrap, "sources", name));
    if (sha256(bytes) !== hash) throw new Error(`Bundled source hash mismatch: ${name}`);
    return new Bun.Archive(bytes);
  });
}

export async function installSources(root, archives) {
  const src = join(root, "bootstrap/src");
  mkdirSync(src, { recursive: true });
  await archives[0].extract(src);
  renameSync(join(src, "musl-1.2.6"), join(src, "musl"));
  await archives[1].extract(src);
  renameSync(join(src, "tinycc-05f0faf"), join(src, "tinycc"));
  await archives[2].extract(root);
  // The overlay provides the cc wrapper. It becomes usable at stage 4.
  chmodSync(join(root, "bin/cc"), 0o755);
  // Copy the recipes/helpers, but do not duplicate the extracted tarballs.
  const target = join(root, "bootstrap");
  mkdirSync(target, { recursive: true });
  const stages = readdirSync(bootstrap).filter(name => /^(?:[1-9]|1[0-2])\..*\.js$/.test(name));
  for (const name of [...stages, "lib", "README.md", "downloads.md", "NOTICE.md", "LICENSE", "LICENSES"]) {
    cpSync(join(bootstrap, name), join(target, name), { recursive: true, errorOnExist: true, force: false });
  }
}
