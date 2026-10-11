// Opt-in --strip-components / --exclude extraction (count may be zero).
// The ordinary Bun.Archive path is
// deliberately separate. Payload offsets come from the CLI's tar scanner.
import { linkSync, lstatSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export function strippedName(name, count) {
  const parts = name.replace(/^\/+/, "").split("/").filter(Boolean);
  // Validate before stripping so removed prefixes cannot hide traversal.
  if (parts.includes("..") || name.includes("\0")) throw new Error(`unsafe archive path: ${name}`);
  // A leading './' counts as a component, as in GNU tar. Interior '.'
  // components can be removed after counting to form the destination path.
  const remaining = parts.slice(count).filter((part) => part !== ".");
  return remaining.length ? remaining.join("/") : null;
}

const stat = (path) => {
  try { return lstatSync(path); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
};

export function extractStripped(bytes, entries, directory, count, { verbose = false, filtered = false } = {}) {
  mkdirSync(directory, { recursive: true });
  const root = realpathSync(directory);
  // Refuse existing symlink ancestors too, not just links in this archive.
  const ensureDirectory = (name) => {
    let path = root;
    for (const part of name.split("/")) {
      if (!part || part === ".") continue;
      path = join(path, part);
      const info = stat(path);
      if (info && (!info.isDirectory() || info.isSymbolicLink())) throw new Error(`not a safe directory: ${path}`);
      if (!info) mkdirSync(path);
    }
    return path;
  };
  const destination = (name) => {
    ensureDirectory(dirname(name));
    return join(root, name);
  };
  const removeLeaf = (path) => {
    if (stat(path)) rmSync(path); // Never recursively remove directories.
  };
  const hardlinks = [], symlinks = [];
  for (const entry of entries) {
    const name = strippedName(entry.archiveName ?? entry.name, count);
    if (!name) continue;
    if (verbose) console.log(entry.name);
    if (entry.kind === "directory") {
      ensureDirectory(name);
    } else if (entry.kind === "file") {
      const { dataOffset: start, size } = entry;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(size) || size < 0
          || start < 0 || size > bytes.length - start) throw new Error(`truncated tar member: ${entry.name}`);
      const path = destination(name);
      removeLeaf(path);
      writeFileSync(path, bytes.subarray(start, start + size), { flag: "wx" });
    } else if (entry.kind === "hardlink") {
      const target = strippedName(entry.target, count);
      if (target) hardlinks.push({ name, target });
    } else if (entry.kind === "symlink") {
      symlinks.push({ name, target: entry.target });
    }
    // Device nodes and FIFOs remain unsupported, like Bun.Archive.
  }
  // Hardlink targets are archive-root-relative and must also be stripped.
  // Retry forward references and chains before making any symbolic links.
  let pending = hardlinks;
  while (pending.length) {
    const next = [];
    for (const entry of pending) {
      const source = destination(entry.target);
      const info = stat(source);
      if (!info) { next.push(entry); continue; }
      if (!info.isFile() || info.isSymbolicLink()) throw new Error(`unsafe hardlink target: ${entry.target}`);
      const path = destination(entry.name);
      if (path === source) continue;
      removeLeaf(path);
      linkSync(source, path);
    }
    if (next.length === pending.length) {
      if (!filtered) throw new Error(`missing hardlink target: ${next[0].target}`);
      break;
    }
    pending = next;
  }
  // Symbolic link contents are not member names: preserve them verbatim,
  // including absolute rootfs targets. No file data is written afterwards.
  for (const entry of symlinks) {
    const path = destination(entry.name);
    removeLeaf(path);
    symlinkSync(entry.target, path);
  }
}
