import { expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildHtmlBundleImageMap,
  canonicalHtmlBundleImageHref,
  decodeHtmlAttribute,
  findHtmlBundleAsset,
  findHtmlBundleImageAsset,
  htmlBundleImageAssetPath,
  readAssetBytes,
  readAssetText,
} from "../single-exe/assetsHelper.js";

const homepage = {
  files: [
    {
      input: "../../images/pixel.png",
      path: "/$bunfs/root/pixel-abc123.png",
      loader: "file",
      headers: { "content-type": "image/png" },
    },
    {
      input: "scripts/app.js",
      path: "/$bunfs/root/app-test.js",
      loader: "file",
      headers: { "content-type": "text/javascript" },
    },
  ],
};

test("readAssetText prefers internal text and falls back under REPO_ROOT", async () => {
  const previousAssets = globalThis.internalAssets;
  try {
    globalThis.internalAssets = new Map([
      ["virtual-only.txt", new TextEncoder().encode("embedded")],
    ]);
    expect(await readAssetText("virtual-only.txt")).toBe("embedded");

    globalThis.internalAssets = null;
    expect(await readAssetText("package.json"))
      .toContain('"name"');
  } finally {
    globalThis.internalAssets = previousAssets;
  }
});

test("readAssetBytes prefers internal bytes and falls back under REPO_ROOT", async () => {
  const previousAssets = globalThis.internalAssets;
  try {
    globalThis.internalAssets = new Map([
      ["virtual-only.bin", Uint8Array.from([1, 2, 3])],
    ]);
    expect([...await readAssetBytes("virtual-only.bin")]).toEqual([1, 2, 3]);

    globalThis.internalAssets = null;
    const bytes = await readAssetBytes("package.json");
    expect(new TextDecoder().decode(bytes)).toContain('"name"');
  } finally {
    globalThis.internalAssets = previousAssets;
  }
});

test("HTML bundle asset lookup matches the compiled public asset path", () => {
  expect(findHtmlBundleAsset(homepage, "/pixel-abc123.png"))
    .toBe(homepage.files[0]);
  expect(htmlBundleImageAssetPath(homepage, "/pixel-abc123.png?version=2"))
    .toBe("/$bunfs/root/pixel-abc123.png");
});

test("HTML bundle image lookup rejects non-images and unavailable development bundles", () => {
  expect(findHtmlBundleImageAsset(homepage, "/app-test.js")).toBeNull();
  expect(findHtmlBundleAsset({}, "/pixel-abc123.png")).toBeNull();
  expect(findHtmlBundleAsset(null, "/pixel-abc123.png")).toBeNull();
});

test("HTML bundle image map joins preserved Markdown hrefs to compiled bunfs assets", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jsmdcui-html-assets-"));
  const htmlPath = join(directory, "app.html");
  await writeFile(htmlPath, [
    '<img src="/dms-ajghf5bd.jpg" data-mdcui-src="jsmdcui/single-exe/dms.jpg">',
    '<img src="/unicode-xyz.png" data-mdcui-src="%E5%9C%96%E7%89%87/%E6%B8%AC%E8%A9%A6%20%E5%9C%96.png">',
    '<img src="/query-qwe.png" data-mdcui-src="./query.png?x=1&amp;y=2#preview">',
  ].join("\n"));
  const compiledHomepage = {
    index: htmlPath,
    files: [
      {
        input: "dms.jpg",
        path: "/$bunfs/root/dms-ajghf5bd.jpg",
        loader: "file",
        headers: { "content-type": "image/jpeg" },
      },
      {
        input: "../../unicode.png",
        path: "/$bunfs/root/unicode-xyz.png",
        loader: "file",
        headers: { "content-type": "image/png" },
      },
      {
        input: "../query.png",
        path: "/$bunfs/root/query-qwe.png",
        loader: "file",
        headers: { "content-type": "image/png" },
      },
    ],
  };

  const images = await buildHtmlBundleImageMap(compiledHomepage);
  expect(images.get("jsmdcui/single-exe/dms.jpg"))
    .toBe("/$bunfs/root/dms-ajghf5bd.jpg");
  expect(images.get("圖片/測試 圖.png"))
    .toBe("/$bunfs/root/unicode-xyz.png");
  expect(images.get("./query.png?x=1&y=2#preview"))
    .toBe("/$bunfs/root/query-qwe.png");
});

test("HTML bundle href canonicalization decodes serialization without resolving paths", () => {
  expect(decodeHtmlAttribute("./a.png?x=1&amp;y=2")).toBe("./a.png?x=1&y=2");
  expect(canonicalHtmlBundleImageHref("%E5%9C%96%E7%89%87/a%20b.png"))
    .toBe("圖片/a b.png");
  expect(canonicalHtmlBundleImageHref("./a.png?x=1&amp;y=2", { htmlAttribute: true }))
    .toBe("./a.png?x=1&y=2");
});

test("HTML bundle image map accepts a custom source attribute", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jsmdcui-html-assets-custom-"));
  const htmlPath = join(directory, "custom.html");
  await writeFile(
    htmlPath,
    '<img src="/photo-custom123.jpg" data-original-image="./photos/a.jpg">',
  );
  const customHomepage = {
    index: htmlPath,
    files: [{
      input: "../../photos/a.jpg",
      path: "/$bunfs/root/photo-custom123.jpg",
      loader: "file",
      headers: { "content-type": "image/jpeg" },
    }],
  };

  const images = await buildHtmlBundleImageMap(
    customHomepage,
    "data-original-image",
  );
  expect(images.get("./photos/a.jpg"))
    .toBe("/$bunfs/root/photo-custom123.jpg");
});
