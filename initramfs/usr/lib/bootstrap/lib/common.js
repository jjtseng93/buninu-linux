import {
  existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";

export const bootstrap = resolve(import.meta.dir, "..");
export const bun = () => Bun.which("bun") || process.argv0;
export const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";

export function normalizeArch(name) {
  if (["x", "x64", "x86_64", "x86-64"].includes(name)) return "x86_64";
  if (["a", "aarch64", "arm64"].includes(name)) return "aarch64";
  throw new Error(`Unsupported architecture: ${name}`);
}

export function options(args) {
  if (args.includes("--help") || args.includes("-h")) {
    console.log("Usage: bun SCRIPT [ARCH] [ROOTFS]");
    console.log("ARCH: a/arm64/aarch64 or x/x64/x86_64/x86-64; default: host architecture.");
    console.log("ROOTFS: default ./roota (arm64) or ./rootx (x64). A lone path is accepted.");
    return null;
  }
  let arch = normalizeArch(process.arch);
  const rest = [...args];
  if (rest.length && /^(x|x64|x86_64|x86-64|a|arm64|aarch64)$/.test(rest[0])) {
    arch = normalizeArch(rest.shift());
  }
  if (rest.length > 1 || rest.some(arg => arg.startsWith("-"))) {
    throw new Error("Expected [ARCH] [ROOTFS]; use --help");
  }
  return { arch, rootfs: resolve(rest[0] ?? (arch === "aarch64" ? "roota" : "rootx")) };
}

// Parse data only: do not execute os-release as shell code.
export function isBuninuLinux() {
  let text;
  try { text = readFileSync("/etc/os-release", "utf8"); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    try { text = readFileSync("/usr/lib/os-release", "utf8"); }
    catch (fallback) { if (fallback.code === "ENOENT") return false; throw fallback; }
  }
  return hasBuninuId(text);
}

export function hasBuninuId(text) {
  const ids = [...text.matchAll(/^ID=(.*)\r?$/gm)];
  const value = ids.at(-1)?.[1].trim();
  return ["buninu-linux", '"buninu-linux"', "'buninu-linux'"].includes(value);
}

export function assertAbsent(path) {
  try { lstatSync(path); }
  catch (error) { if (error.code === "ENOENT") return; throw error; }
  throw new Error(`Refusing existing destination: ${path}`);
}

export function write(path, bytes, mode = 0o644) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes, { flag: "wx", mode });
}

export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

export async function download(name) {
  const pins = Bun.YAML.parse(readFileSync(join(bootstrap, "downloads.md"), "utf8"));
  const pin = pins[name];
  if (!Array.isArray(pin) || !/^sha256:[a-f0-9]{64}$/.test(pin[1])) {
    throw new Error(`Missing or invalid download pin: ${name}`);
  }
  const [url, hash] = pin;
  const expected = hash.slice(7);
  const cache = join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "buninu-bootstrap");
  const path = join(cache, expected + "-" + new URL(url).pathname.split("/").at(-1));
  if (existsSync(path)) {
    const bytes = readFileSync(path);
    if (sha256(bytes) !== expected) throw new Error(`Cached file hash mismatch: ${path}`);
    console.log(`Verified cache: ${name}`);
    return path;
  }
  console.log(`Fetching ${name}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (sha256(bytes) !== expected) throw new Error(`Download hash mismatch: ${name}`);
  mkdirSync(cache, { recursive: true });
  writeFileSync(path, bytes, { flag: "wx", mode: 0o644 });
  return path;
}

export async function run(argv) {
  console.log("$ " + argv.map(quote).join(" "));
  const child = Bun.spawn(argv, { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  const status = await child.exited;
  if (status !== 0) throw new Error(`Command exited ${status}: ${argv[0]}`);
}

export async function cli(main) {
  const mask = process.umask(0o022);
  try { await main(Bun.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
  finally { process.umask(mask); }
}

export function requireRootfs() {
  // Prevent an accidental stage 3/4 invocation from writing host /usr/include.
  const marker = JSON.parse(readFileSync("/etc/buninu-bootstrap.json", "utf8"));
  if (marker.format !== 1 || marker.arch !== normalizeArch(process.arch)) {
    throw new Error("Enter the prepared rootfs for the matching architecture first");
  }
  if (bootstrap !== "/bootstrap") throw new Error("Run this stage inside the prepared rootfs");
  return marker;
}

export function validateElf(name, data, arch) {
  if (data.length < 64 || data.toString("hex", 0, 4) !== "7f454c46"
      || data[4] !== 2 || data[5] !== 1 || data.readUInt16LE(18) !== (arch === "aarch64" ? 183 : 62)) {
    throw new Error(`Not a ${arch} little-endian ELF64 file: ${name}`);
  }
}

export function elfInterpreter(data) {
  const start = Number(data.readBigUInt64LE(32)), stride = data.readUInt16LE(54), count = data.readUInt16LE(56);
  for (let i = 0; i < count; i++) {
    const p = start + i * stride;
    if (!Number.isSafeInteger(p) || stride < 56 || p + 56 > data.length) throw new Error("Invalid Bun ELF program headers");
    if (data.readUInt32LE(p) !== 3) continue;
    const at = Number(data.readBigUInt64LE(p + 8)), size = Number(data.readBigUInt64LE(p + 32));
    if (!Number.isSafeInteger(at) || !Number.isSafeInteger(size) || at + size > data.length) throw new Error("Invalid Bun ELF interpreter range");
    return data.subarray(at, at + size).toString().replace(/\0.*$/s, "");
  }
}
