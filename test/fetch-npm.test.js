import { afterAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { download } from "../scripts/fetch.js";
import { fetchNpm, npmDownloadsDir, npmPackages, parseNpmPins } from "../scripts/fetch-npm.js";

const work = mkdtempSync(join(tmpdir(), "buninu-fetch-npm-"));
const body = Buffer.from("isolated archive-download fixture");
const sha256 = createHash("sha256").update(body).digest("hex");
let requests = 0;
const server = Bun.serve({
  hostname: "127.0.0.1", port: 0,
  fetch(request) {
    requests++;
    return new URL(request.url).pathname === "/missing"
      ? new Response("missing", { status: 404 }) : new Response(body);
  },
});
afterAll(() => { server.stop(true); rmSync(work, { recursive: true, force: true }); });
const url = `http://127.0.0.1:${server.port}/archive`;

test("five exact registry pins share an architecture-independent cache", () => {
  expect(npmPackages.map(({ name, version }) => `${name}@${version}`)).toEqual([
    "buninu-browser@0.2.4", "buninu-land@0.1.4", "@drxiaozhi/casty@1.3.7",
    "@drxiaozhi/jspulse@0.2.1", "@drxiaozhi/jspinyin@0.1.1",
  ]);
  expect(basename(npmDownloadsDir)).toBe("npm");
  for (const pkg of npmPackages) {
    expect(new URL(pkg.url).hostname).toBe("registry.npmjs.org");
    expect(pkg.url).toContain(`-${pkg.version}.tgz`);
    expect(pkg.sha256).toMatch(/^[a-f0-9]{64}$/);
  }
});

test("fetchNpm only delegates pinned downloads, without extracting or executing packages", async () => {
  const calls = [];
  const result = await fetchNpm({ downloadsDir: work, downloadFile: async (cfg, url, archive, sha256) => {
    calls.push({ cfg, url, archive, sha256 });
    return join(cfg.downloadsDir, archive);
  } });
  expect(calls).toEqual(npmPackages.map(({ url, archive, sha256 }) => ({ cfg: { downloadsDir: work }, url, archive, sha256 })));
  expect(result).toEqual(npmPackages.map(({ archive }) => join(work, archive)));
  for (const path of result) expect(existsSync(path)).toBe(false);
});

test("rejects malformed pins, floating versions, unsafe cache names and duplicate archives", () => {
  const block = `"example@1.0.0":\n  - https://registry.npmjs.org/example/-/example-1.0.0.tgz\n  - sha256:${sha256}`;
  for (const [from, to] of [["@1.0.0", "@latest"], ["@1.0.0", "@^1.0.0"], ["example@", "../bad@"], ["registry.npmjs.org", "example.invalid"], [sha256, "bad"], ['"example@1.0.0"', "example@1.0.0"]]) {
    expect(() => parseNpmPins(block.replace(from, to))).toThrow();
  }
  expect(() => parseNpmPins(`${block}\n\n${block}`)).toThrow();
  expect(() => parseNpmPins(block.split("\n").slice(0, 2).join("\n"))).toThrow();
  expect(() => parseNpmPins("")).toThrow();
  expect(parseNpmPins(`# Comment\r\n\r\n${block.replaceAll("\n", "\r\n")}\r\n`)[0].archive).toBe("example-1.0.0.tgz");
});

test("the Markdown manifest is directly parseable as YAML", () => {
  const text = readFileSync(new URL("../scripts/npm-packages.md", import.meta.url), "utf8");
  const yaml = Bun.YAML.parse(text);
  for (const pin of npmPackages) {
    expect(yaml[`${pin.name}@${pin.version}`]).toEqual([pin.url, `sha256:${pin.sha256}`]);
  }
});

test("valid cache is reused without a request; corrupt cache is repaired", async () => {
  const archive = "cache.tgz";
  const path = join(work, archive);
  const before = requests;
  await download({ downloadsDir: work }, url, archive, sha256);
  expect(requests).toBe(before + 1);
  expect(readFileSync(path).equals(body)).toBe(true);
  await download({ downloadsDir: work }, url, archive, sha256);
  expect(requests).toBe(before + 1);
  writeFileSync(path, "corrupt");
  await download({ downloadsDir: work }, url, archive, sha256);
  expect(requests).toBe(before + 2);
  expect(readFileSync(path).equals(body)).toBe(true);
  expect(existsSync(path + ".part")).toBe(false);
});

test("hash mismatch rejects the download and never promotes the partial archive", async () => {
  await expect(download({ downloadsDir: work }, url, "bad.tgz", "0".repeat(64))).rejects.toThrow("SHA-256");
  expect(existsSync(join(work, "bad.tgz"))).toBe(false);
  expect(existsSync(join(work, "bad.tgz.part"))).toBe(false);
});

test("HTTP failures do not create a final archive", async () => {
  await expect(download({ downloadsDir: work }, `http://127.0.0.1:${server.port}/missing`, "missing.tgz", sha256)).rejects.toThrow("HTTP 404");
  expect(existsSync(join(work, "missing.tgz"))).toBe(false);
});
