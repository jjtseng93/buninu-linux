import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWui, extractJs } from "../runmd.mjs";

const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("createWui constrains images to their content width", async () => {
  const directory = mkdtempSync(join(tmpdir(), "jsmdcui-wui-image-"));
  temporaryDirectories.push(directory);
  const markdownPath = join(directory, "image.md");
  const html = await createWui("![wide](wide.png)", markdownPath);

  expect(html).toContain("img {\n  max-width: 100%;\n  height: auto;\n}");
  expect(html).toContain("table {\n  border-collapse: collapse;\n}");
  expect(html).toContain("th, td {\n  border: 1px solid black;");
  expect(html).toContain("tr:hover {\n  background: #ddddee;\n}");
  expect(html).toContain('src="wide.png" alt="wide" data-mdcui-src="wide.png"');
  expect(html.match(/max-width: 100%/g)).toHaveLength(1);
  expect(html.match(/image\.md\.front\.js/g)).toHaveLength(1);
});

test("createWui injects the image rule into an existing document head", async () => {
  const directory = mkdtempSync(join(tmpdir(), "jsmdcui-wui-document-"));
  temporaryDirectories.push(directory);
  const markdownPath = join(directory, "document.md");
  const source = "<!doctype html><html><head><title>x</title></head><body><img src=\"wide.png\"></body></html>";
  const html = await createWui(source, markdownPath);

  expect(html.indexOf("max-width: 100%")).toBeLessThan(html.indexOf("</head>"));
  expect(html).toContain('src="wide.png" data-mdcui-src="wide.png"');
  expect(html.match(/document\.md\.front\.js/g)).toHaveLength(1);
});

test("bundling mode creates a browser-only front entry", async () => {
  const directory = mkdtempSync(join(tmpdir(), "jsmdcui-wui-bundling-"));
  temporaryDirectories.push(directory);
  const markdownPath = join(directory, "bundle.md");
  const source = "```js front\nexport function pav() { return rpc }\n```";
  const markdown = await extractJs(source, markdownPath, { bundling: true });
  const html = await createWui(markdown, markdownPath, { bundling: true });
  const frontSource = readFileSync(`${markdownPath}.tmpfs.js`, "utf8");
  const installerSource = readFileSync(`${markdownPath}.tmpfi.js`, "utf8");

  expect(frontSource).toContain("const rpc = wuiRpcClient");
  expect(frontSource).not.toContain("globalThis.process");
  expect(frontSource).not.toContain('import("./bundle.md.front.js")');
  expect(installerSource).toContain('import * as frontMod from "./bundle.md.tmpfs.js"');
  expect(installerSource).toContain("Object.assign(window, frontMod)");
  expect(installerSource).toContain("await runWebMdcuiLoad(window, frontMod)");
  expect(html).toContain('src="./bundle.md.tmpfi.js"');
  expect(html).not.toContain("bundle.md.front.js");
});
