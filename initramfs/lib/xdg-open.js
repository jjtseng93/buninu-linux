import { realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function browserTarget(target, cwd = process.cwd()) {
  if (/^about:/i.test(target)) return target;
  if (/^https?:\/\//i.test(target)) {
    // Reject malformed URLs before starting a new terminal.
    try { return new URL(target).href; }
    catch { throw openError("Invalid HTTP/HTTPS URL", 1); }
  }
  const fileUrl = /^file:/i.test(target);
  if (!fileUrl && /^[a-z][a-z0-9+.-]*:/i.test(target)) {
    throw openError("Unsupported URL scheme; use http://, https://, about: or a local file", 4);
  }
  const path = realpathSync(fileUrl ? fileURLToPath(target) : resolve(cwd, target));
  if (!statSync(path).isFile()) throw openError("Expected a regular file", 4);
  // Encode spaces, #, %, and non-ASCII characters as URL path components.
  return pathToFileURL(path).href;
}

export function parseOpenArgs(args) {
  if (args.length === 1 && ["-h", "--help", "--manual"].includes(args[0])) return { help: true };
  if (args.length === 1 && args[0] === "--version") return { version: true };
  if (args.length !== 1 || !args[0]) throw openError("Usage: xdg-open URL | FILE (see --help)", 1);
  if (args[0].startsWith("-")) throw openError("Use ./ before a filename beginning with '-'", 1);
  return { target: args[0] };
}

export function openError(message, exitCode) {
  return Object.assign(new Error(message), { exitCode });
}

export function openExitCode(error) {
  return error.exitCode ?? (["ENOENT", "ENOTDIR"].includes(error.code) ? 2 : 4);
}

export function releaseVersion(text) {
  const value = /^VERSION_ID=(.*)$/m.exec(text)?.[1]?.trim();
  if (!value) throw new Error("VERSION_ID missing from os-release");
  return value.replace(/^["']|["']$/g, "");
}
