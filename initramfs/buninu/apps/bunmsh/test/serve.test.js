import { afterAll, beforeAll, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import {
  highlightJson,
  main as startFileServer,
  openTargetUrl,
  parseServeArguments,
  randomServeRoute,
  resolveBunfsPath,
} from "../serve.js";

const cwd = join(import.meta.dir, "serve");
const servePath = join(import.meta.dir, "..", "serve.js");
let previousPort;
let server;

// SERVE_AUTO_OPEN/SERVE_MINAPK_WEBVIEW/SERVE_RANDOM_URL are read straight off
// process.env at module load (not passed through parseServeArguments'
// `env` parameter) so a bundler can inline them as build-time constants.
// That means their defaults can only be observed from a fresh process
// started with those variables already set.
function parseServeArgumentsWithEnv(args, env) {
  const script = `
    const { parseServeArguments } = await import(${JSON.stringify(servePath)});
    const result = parseServeArguments(${JSON.stringify(args)}, undefined, "/cwd");
    delete result.env;
    console.log(JSON.stringify(result));
  `;
  const proc = Bun.spawnSync({
    cmd: [process.execPath, "-e", script],
    env: { ...process.env, SERVE_AUTO_OPEN: "", SERVE_MINAPK_WEBVIEW: "", SERVE_RANDOM_URL: "", ...env },
  });
  if (proc.exitCode !== 0) throw new Error(proc.stderr.toString());
  return JSON.parse(proc.stdout.toString());
}

test("serve highlights pretty JSON using jsmdcui json syntax groups", () => {
  const html = highlightJson('{"key":"line\\n <tag> & \\"quoted\\" \'apostrophe\'","number":12,"ok":true,"empty":null}');
  expect(html).toContain('<span class="json-statement">&quot;key&quot;:</span>');
  expect(html).toContain('<span class="json-special">\\n</span>');
  expect(html).toContain('<span class="json-number">12</span>');
  expect(html).toContain('<span class="json-constant">true</span>');
  expect(html).toContain('<span class="json-constant">null</span>');
  expect(html).toContain("&lt;tag&gt; &amp;");
  expect(html).toContain("&#x27;apostrophe&#x27;");
  expect(html).not.toContain("<tag>");
});

test("serve accepts either bunfs spelling and derives the platform path", () => {
  expect(resolveBunfsPath("/$bunfs", "/$bunfs/root")).toBe("/$bunfs/root");
  expect(resolveBunfsPath("/$bunfs/assets/file.txt", "/$bunfs/root"))
    .toBe("/$bunfs/root/assets/file.txt");
  expect(resolveBunfsPath("B:/~BUN/root/assets/file.txt", "/$bunfs/root"))
    .toBe("/$bunfs/root/assets/file.txt");
  expect(resolveBunfsPath("/$bunfs", "B:\\~BUN\\root")).toBe("B:/~BUN/root");
  expect(resolveBunfsPath("/$bunfs/assets/file.txt", "B:\\~BUN\\root"))
    .toBe("B:/~BUN/root/assets/file.txt");
  expect(resolveBunfsPath("B:/~BUN/root/assets/file.txt", "B:\\~BUN\\root"))
    .toBe("B:/~BUN/root/assets/file.txt");
  expect(resolveBunfsPath("/$bunfs", "/source/bunmsh")).toBeNull();
});

test("serve CLI flags force options on even over an inline environment default left off", () => {
  expect(parseServeArgumentsWithEnv(["--auto-open", "--minapk-webview", "--random-url", "public"], {
    SERVE_AUTO_OPEN: "0",
    SERVE_MINAPK_WEBVIEW: "0",
    SERVE_RANDOM_URL: "false",
  })).toMatchObject({
    directory: "public",
    autoOpen: true,
    minapkWebview: "1",
    randomUrl: true,
  });
});

test("serve options default to off/not-passed with no flags or environment", () => {
  expect(parseServeArgumentsWithEnv([], {})).toMatchObject({
    directory: "/cwd",
    autoOpen: false,
    minapkWebview: null,
    randomUrl: false,
  });
});

test("serve inline environment defaults carry through unless overridden", () => {
  const env = { SERVE_AUTO_OPEN: "1", SERVE_MINAPK_WEBVIEW: "yes", SERVE_RANDOM_URL: "on" };
  expect(parseServeArgumentsWithEnv([], env)).toMatchObject({
    autoOpen: true,
    minapkWebview: "1",
    randomUrl: true,
  });
});

test("serve CLI =off/no/false/empty explicitly disables an environment default turned on", () => {
  const env = { SERVE_AUTO_OPEN: "1", SERVE_MINAPK_WEBVIEW: "1", SERVE_RANDOM_URL: "true" };
  expect(parseServeArgumentsWithEnv(
    ["--auto-open=off", "--minapk-webview=no", "--random-url=false"], env,
  )).toMatchObject({ autoOpen: false, minapkWebview: null, randomUrl: false });
  expect(parseServeArgumentsWithEnv(["--auto-open=", "--random-url="], env))
    .toMatchObject({ autoOpen: false, randomUrl: false });
});

test("serve --auto-open=/path sets a suffix path instead of plain on/off", () => {
  expect(parseServeArguments(["--auto-open=/index.html"], {}, "/cwd"))
    .toMatchObject({ autoOpen: "/index.html" });
  expect(parseServeArguments(["--auto-open=/nested/page.html"], {}, "/cwd"))
    .toMatchObject({ autoOpen: "/nested/page.html" });
});

test("serve SERVE_AUTO_OPEN=/path sets the same suffix as a default, CLI still overrides it", () => {
  expect(parseServeArgumentsWithEnv([], { SERVE_AUTO_OPEN: "/default.html" }))
    .toMatchObject({ autoOpen: "/default.html" });
  expect(parseServeArgumentsWithEnv(["--auto-open=off"], { SERVE_AUTO_OPEN: "/default.html" }))
    .toMatchObject({ autoOpen: false });
  expect(parseServeArgumentsWithEnv(["--auto-open=/override.html"], { SERVE_AUTO_OPEN: "/default.html" }))
    .toMatchObject({ autoOpen: "/override.html" });
});

test("openTargetUrl resolves a /path suffix relative to the served URL, including any random-url prefix", () => {
  const base = new URL("http://localhost:3000/");
  expect(openTargetUrl(base, true).href).toBe(base.href);
  expect(openTargetUrl(base, false).href).toBe(base.href);
  expect(openTargetUrl(base, "/index.html").href).toBe("http://localhost:3000/index.html");
  expect(openTargetUrl(base, "/nested/page.html").href).toBe("http://localhost:3000/nested/page.html");

  const prefixed = new URL("http://localhost:3000/AaBIsecretprefix/");
  expect(openTargetUrl(prefixed, "/index.html").href)
    .toBe("http://localhost:3000/AaBIsecretprefix/index.html");
});

test("serve --minapk-webview=N passes the literal digit string", () => {
  expect(parseServeArguments(["--minapk-webview=42"], {}, "/cwd"))
    .toMatchObject({ minapkWebview: "42" });
  expect(parseServeArguments(["--minapk-webview=bogus"], {}, "/cwd"))
    .toMatchObject({ error: "invalid value for --minapk-webview: bogus" });
});

test("serve --minapk-webview never consumes a following bare argument as its value", () => {
  // Only `--minapk-webview=N` sets a value; a space-separated "1" must stay a
  // directory operand, or a real directory named "1" would collide with it.
  expect(parseServeArguments(["--minapk-webview", "1"], {}, "/cwd"))
    .toMatchObject({ minapkWebview: "1", directory: "1" });
  expect(parseServeArguments(["--minapk-webview", "1", "dir"], {}, "/cwd"))
    .toMatchObject({ error: "too many directory operands" });
});

test("serve random routes have high entropy and are URL-safe", () => {
  const first = randomServeRoute();
  const second = randomServeRoute();
  expect(first).not.toBe(second);
  expect(first).toMatch(/^[A-Za-z0-9_-]{80,}\/$/);
});

beforeAll(() => {
  previousPort = process.env.PORT;
  process.env.PORT = "0";
  server = startFileServer(cwd);
});

afterAll(() => {
  server?.stop(true);
  if (previousPort === undefined) delete process.env.PORT;
  else process.env.PORT = previousPort;
});

test("serve exposes linked Markdown and parser previews", async () => {
  const index = await fetch(server.url).then((response) => response.text());
  expect(index).toContain('href="README.md-bun.markdown.html"');
  expect(index).toContain('href="data.json-json.parse"');
  expect(index).toContain('href="data.json5-bun.json5.parse"');
  expect(index).toContain("🔍");
  if (typeof Bun.XML?.parse === "function") {
    expect(index).toContain('href="data.xml-bun.xml.parse"');
    const xml = await fetch(new URL("data.xml-bun.xml.parse", server.url));
    expect(xml.status).toBe(200);
    expect(await xml.text()).toContain("xml");
  } else {
    expect(index).not.toContain('href="data.xml-bun.xml.parse"');
  }

  const markdown = await fetch(new URL("README.md-bun.markdown.html", server.url));
  expect(markdown.status).toBe(200);
  expect(await markdown.text()).toContain("<strong>Bun</strong>");

  const previews = [
    ["data.json-json.parse", '"name": "json"'],
    ["data.json5-bun.json5.parse", '"name": "json5"'],
    ["data.jsonc-bun.jsonc.parse", '"name": "jsonc"'],
    ["data.jsonl-bun.jsonl.parse", '"line": 2'],
    ["data.ndjson-bun.jsonl.parse", '"line": 3'],
    ["data.yaml-bun.yaml.parse", '"name": "yaml"'],
    ["data.yml-bun.yaml.parse", '"name": "yml"'],
    ["data.toml-bun.toml.parse", '"name": "toml"'],
  ];
  for (const [path, expected] of previews) {
    const response = await fetch(new URL(path, server.url));
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html.replace(/<\/?span(?: [^>]*)?>/g, ""))
      .toContain(expected.replaceAll('"', "&quot;"));
    expect(html).toContain('class="json-statement"');
  }

  expect((await fetch(new URL("bad.json-json.parse", server.url))).status).toBe(422);
  const afterParserError = await fetch(server.url);
  expect(afterParserError.status).toBe(200);
  expect(await afterParserError.text()).toContain("README.md");
});

test("serve keeps native HTTP Range handling on original files", async () => {
  const response = await fetch(new URL("README.md", server.url), {
    headers: { range: "bytes=0-8" },
  });
  expect(response.status).toBe(206);
  expect(response.headers.get("content-range")).toBe("bytes 0-8/26");
  expect(await response.text()).toBe("# Preview");
});

test("serve discovers request-time files without rebuilding routes", async () => {
  const path = join(cwd, "created-after-start.txt");
  try {
    await Bun.write(path, "dynamic file");
    const index = await fetch(server.url).then((response) => response.text());
    expect(index).toContain("created-after-start.txt");
    const response = await fetch(new URL("created-after-start.txt", server.url), {
      headers: { range: "bytes=0-6" },
    });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 0-6/12");
    expect(await response.text()).toBe("dynamic");
  } finally {
    rmSync(path, { force: true });
  }
  expect((await fetch(new URL("created-after-start.txt", server.url))).status).toBe(404);
  expect((await fetch(server.url)).status).toBe(200);
});

test("serve rejects paths escaping the served root", async () => {
  expect((await fetch(new URL("/%5c..%5cpackage.json", server.url))).status).toBe(400);
});
