// Fetch only: no package manager, lifecycle scripts, extraction or install
// paths. Shell and JS use the same pins; both architectures share the cache.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { rootDir, runIfMain } from "./arch.js";
import { download } from "./fetch.js";

export function parseNpmPins(text) {
  // Only check the fixed shell-compatible shape here (including mandatory
  // double quotes). Values are parsed once below, then validated as data.
  const lines = text.split(/\r?\n/).filter((line) => line.trim() && !line.startsWith("#"));
  const shape = [/^"[^"\\]+":$/, /^  - https:\/\/[^\s"#]+$/, /^  - sha256:[^\s"#]+$/];
  if (!lines.length || lines.length % 3 || lines.some((line, index) => !shape[index % 3].test(line))) {
    throw new Error("invalid npm pin format");
  }
  // Bun uses its native YAML parser. Node's fallback reads only the fixed
  // three-line format, without a YAML dependency or a second parse on Bun.
  const document = globalThis.Bun?.YAML
    ? Bun.YAML.parse(text)
    : Object.fromEntries(lines.flatMap((line, index) => index % 3 ? [] : [
      [line.slice(1, -2), [lines[index + 1].slice(4), lines[index + 2].slice(4)]],
    ]));
  const entries = Object.entries(document);
  if (entries.length !== lines.length / 3) throw new Error("duplicate npm pin");
  const archives = new Set();
  return entries.map(([key, values]) => {
    const header = key.match(/^((?:@[a-z0-9._-]+\/)?[a-z0-9._-]+)@(\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?)$/);
    if (!header || !Array.isArray(values) || values.length !== 2
        || typeof values[0] !== "string" || typeof values[1] !== "string"
        || !/^https:\/\/registry\.npmjs\.org\/[^\s"#]+\.tgz$/.test(values[0])
        || !/^sha256:[a-f0-9]{64}$/.test(values[1])) throw new Error(`invalid npm pin: ${key}`);
    const [, name, version] = header;
    const archive = `${name.replace(/^@/, "").replace("/", "-")}-${version}.tgz`;
    if (archives.has(archive)) throw new Error(`duplicate npm pin: ${name}`);
    archives.add(archive);
    return { name, version, archive, url: values[0], sha256: values[1].slice(7) };
  });
}

export const npmPackages = parseNpmPins(readFileSync(new URL("./npm-packages.md", import.meta.url), "utf8"));
export const npmDownloadsDir = join(rootDir, "downloads", "npm");

export async function fetchNpm({ downloadsDir = npmDownloadsDir, downloadFile = download } = {}) {
  const paths = [];
  for (const pkg of npmPackages) {
    paths.push(await downloadFile({ downloadsDir }, pkg.url, pkg.archive, pkg.sha256));
  }
  return paths;
}

runIfMain(import.meta.url, () => fetchNpm());
