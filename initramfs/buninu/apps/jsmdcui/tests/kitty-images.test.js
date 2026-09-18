import { expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fitKittyImageToWidth, prepareKittyImages, renderAnsiWithDataImages } from "../src/cui/kitty-images.mjs";
import { Screen } from "../src/screen/screen.js";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test("Bun-rendered Markdown image links reserve rows and retain Kitty data", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jsmdcui-kitty-"));
  const markdownPath = join(dir, "app.md");
  await writeFile(join(dir, "pixel.png"), ONE_PIXEL_PNG);
  const ansi = Bun.markdown.ansi("before\n\n![pixel](pixel.png)\n\nafter\n", {
    hyperlinks: true,
    columns: 40,
  });
  const result = await prepareKittyImages(ansi, markdownPath, 40);

  expect(result.images).toHaveLength(1);
  expect(result.images[0]).toMatchObject({ mime: "image/png", cols: 1, rows: 1 });
  expect(result.images[0].data.equals(ONE_PIXEL_PNG)).toBe(true);
  expect(Bun.stripANSI(result.rendered)).toContain("📷 pixel");
});

test("Kitty images accept base64 image data URLs", async () => {
  const dataUrl = `data:image/png;base64,${ONE_PIXEL_PNG.toString("base64")}`;
  const ansi = renderAnsiWithDataImages(`![pixel](${dataUrl})`, {
    hyperlinks: true,
    columns: 40,
  });
  const result = await prepareKittyImages(ansi, "/tmp/app.md", 40);

  expect(result.images).toHaveLength(1);
  expect(result.images[0]).toMatchObject({
    mime: "image/png",
    path: "data:image/png",
  });
  expect(result.images[0].data.equals(ONE_PIXEL_PNG)).toBe(true);
});

test("Kitty images prefer lazily supplied compiled HTML bundle assets", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jsmdcui-kitty-bundled-"));
  const bundledPath = join(dir, "pixel-bundled.png");
  await writeFile(bundledPath, ONE_PIXEL_PNG);
  const ansi = Bun.markdown.ansi("![pixel](./images/pixel.png?version=2#preview)", {
    hyperlinks: true,
    columns: 40,
  });
  let imageMapRequests = 0;
  const result = await prepareKittyImages(ansi, join(dir, "missing-app.md"), 40, {
    getBundledImageMap: async () => {
      imageMapRequests++;
      return new Map([["./images/pixel.png?version=2#preview", bundledPath]]);
    },
  });

  expect(imageMapRequests).toBe(1);
  expect(result.images).toHaveLength(1);
  expect(result.images[0].path).toBe(bundledPath);
  expect(result.images[0].data.equals(ONE_PIXEL_PNG)).toBe(true);
});

test("Kitty images can switch away from and back to a compiled embedded asset", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jsmdcui-kitty-bundled-return-"));
  const bundledPath = join(dir, "pixel-bundled.png");
  const localPath = join(dir, "local.png");
  await writeFile(bundledPath, ONE_PIXEL_PNG);
  await writeFile(localPath, ONE_PIXEL_PNG);
  const markdownPath = join(dir, "app.md");
  const imageMap = new Map([["embedded.png", bundledPath]]);
  let imageMapRequests = 0;
  const options = {
    getBundledImageMap: async () => {
      imageMapRequests++;
      return imageMap;
    },
  };
  const render = (href) => Bun.markdown.ansi(`![pixel](${href})`, {
    hyperlinks: true,
    columns: 40,
  });

  const embeddedFirst = await prepareKittyImages(
    render("embedded.png"), markdownPath, 40, options,
  );
  const local = await prepareKittyImages(
    render("local.png"), markdownPath, 40, options,
  );
  const embeddedAgain = await prepareKittyImages(
    render("embedded.png"), markdownPath, 40, options,
  );

  expect(embeddedFirst.images[0]?.path).toBe(bundledPath);
  expect(local.images[0]?.path).toBe(localPath);
  expect(embeddedAgain.images[0]?.path).toBe(bundledPath);
  expect(embeddedAgain.images[0]?.data.equals(ONE_PIXEL_PNG)).toBe(true);
  expect(imageMapRequests).toBe(3);
});

test("Kitty compat converts compressed images to standard PNG payloads", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jsmdcui-kitty-compat-"));
  const markdownPath = join(dir, "app.md");
  const jpeg = Buffer.from(await new Bun.Image(ONE_PIXEL_PNG).jpeg().toBuffer());
  await writeFile(join(dir, "pixel.jpg"), jpeg);
  const ansi = Bun.markdown.ansi("![pixel](pixel.jpg)", {
    hyperlinks: true,
    columns: 40,
  });

  const result = await prepareKittyImages(ansi, markdownPath, 40, {
    kittyMode: "compat",
  });

  expect(result.images).toHaveLength(1);
  expect(result.images[0].mime).toBe("image/png");
  expect(result.images[0].data.subarray(0, 8).equals(Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]))).toBe(true);
  expect(result.images[0].data.equals(jpeg)).toBe(false);
});

test("remote Kitty images require allowUrl and use the configured HTTP byte fetcher", async () => {
  const imageUrl = "https://example.test/assets/pixel.png";
  const ansi = Bun.markdown.ansi(`![pixel](${imageUrl})`, {
    hyperlinks: true,
    columns: 40,
  });
  const requests = [];
  const fetchHttpBytes = async (url) => {
    requests.push(url);
    return ONE_PIXEL_PNG;
  };

  const blocked = await prepareKittyImages(ansi, "/tmp/app.md", 40, { fetchHttpBytes });
  expect(blocked.images).toHaveLength(0);
  expect(requests).toHaveLength(0);

  const allowed = await prepareKittyImages(ansi, "/tmp/app.md", 40, {
    allowUrl: true,
    fetchHttpBytes,
  });
  expect(requests).toEqual([imageUrl]);
  expect(allowed.images).toHaveLength(1);
  expect(allowed.images[0].path).toBe(imageUrl);
});

test("an unresponsive remote Kitty image cannot block rerender forever", async () => {
  const imageUrl = "https://example.test/assets/stalled.png";
  const ansi = Bun.markdown.ansi(`![stalled](${imageUrl})`, {
    hyperlinks: true,
    columns: 40,
  });
  const result = await prepareKittyImages(ansi, "/tmp/app.md", 40, {
    allowUrl: true,
    remoteTimeoutMs: 5,
    fetchHttpBytes: (url, { signal }) => new Promise(() => {
      expect(url).toBe(imageUrl);
      signal.addEventListener("abort", () => {}, { once: true });
    }),
  });

  expect(result.rendered).toBe(ansi);
  expect(result.images).toEqual([]);
});

test("remote Kitty images share one rerender timeout budget", async () => {
  const urls = [1, 2, 3].map(
    number => `https://example.test/assets/stalled-${number}.png`,
  );
  const ansi = Bun.markdown.ansi(
    urls.map(url => `![stalled](${url})`).join("\n\n"),
    { hyperlinks: true, columns: 40 },
  );
  const signals = [];
  const started = performance.now();
  const result = await prepareKittyImages(ansi, "/tmp/app.md", 40, {
    allowUrl: true,
    remoteTimeoutMs: 20,
    fetchHttpBytes: (url, { signal }) => {
      signals.push({ url, signal });
      return new Promise(() => {});
    },
  });

  expect(performance.now() - started).toBeLessThan(100);
  expect(signals).toHaveLength(1);
  expect(signals[0].signal.aborted).toBe(true);
  expect(result.images).toEqual([]);
});

test("remote Markdown resolves relative Kitty image URLs against its source URL", async () => {
  const ansi = Bun.markdown.ansi("![pixel](../images/pixel.png?size=1)", {
    hyperlinks: true,
    columns: 40,
  });
  const requests = [];
  const result = await prepareKittyImages(
    ansi,
    "https://example.test/docs/guide/app.md",
    40,
    {
      allowUrl: true,
      fetchHttpBytes: async (url) => {
        requests.push(url);
        return ONE_PIXEL_PNG;
      },
    },
  );

  expect(requests).toEqual(["https://example.test/docs/images/pixel.png?size=1"]);
  expect(result.images).toHaveLength(1);
});

test("Kitty image sizing subtracts the gutter width without depending on remaining rows", () => {
  // A 100-column pane with a 5-column gutter has 95 usable image columns.
  expect(fitKittyImageToWidth({ cols: 100, rows: 40 }, 95)).toEqual({ cols: 95, rows: 38 });
  expect(fitKittyImageToWidth({ cols: 62, rows: 21 }, 95)).toEqual({ cols: 62, rows: 21 });
  expect(fitKittyImageToWidth({ cols: 62, rows: 21 }, 40)).toEqual({ cols: 40, rows: 14 });
});

test("Screen emits chunked Kitty placement at the requested cell and deletes only its IDs", () => {
  const screen = new Screen({ mouse: false, kittyMode: "extended" });
  const writes = [];
  screen.write = (value) => writes.push(String(value));
  screen.setKittyImages([{
    id: 77,
    x: 3,
    y: 4,
    cols: 5,
    rows: 2,
    sourceX: 0,
    sourceY: 0,
    sourceWidth: 1,
    sourceHeight: 1,
    mime: "image/png",
    data: ONE_PIXEL_PNG,
  }]);
  screen.Show();
  const first = writes.join("");
  expect(first).toContain("\x1b[5;4H");
  expect(first).toContain("\x1b_Ga=T,f=100,t=d,i=77,p=77,q=2,x=0,y=0,w=1,h=1,c=5,r=2,C=1,U=image/png,m=0;");

  writes.length = 0;
  screen.setKittyImages([]);
  screen.Show();
  expect(writes.join("")).toContain("\x1b_Ga=d,d=i,i=77,q=2;");
  expect(writes.join("")).not.toContain("d=a");

  writes.length = 0;
  screen.setKittyImages([{
    id: 77, x: 3, y: 2, cols: 5, rows: 2,
    sourceX: 0, sourceY: 0, sourceWidth: 1, sourceHeight: 1,
    mime: "image/png", data: ONE_PIXEL_PNG,
  }]);
  screen.Show();
  const replaced = writes.join("");
  expect(replaced).toContain("\x1b_Ga=p,i=77,p=77,q=2,x=0,y=0,w=1,h=1,c=5,r=2,C=1,U=image/png;");
  expect(replaced).not.toContain("a=T");
  expect(replaced).not.toContain(ONE_PIXEL_PNG.toString("base64"));
});

test("Screen gates Kitty output by mode and compat mode omits the MIME U extension", () => {
  const image = {
    id: 88, x: 0, y: 0, cols: 1, rows: 1,
    sourceX: 0, sourceY: 0, sourceWidth: 1, sourceHeight: 1,
    mime: "image/jpeg", data: ONE_PIXEL_PNG,
  };

  const off = new Screen({ mouse: false });
  const offWrites = [];
  off.write = (value) => offWrites.push(String(value));
  off.setKittyImages([image]);
  off.Show();
  expect(offWrites.join("")).not.toContain("\x1b_G");

  const compat = new Screen({ mouse: false, kittyMode: "compat" });
  const compatWrites = [];
  compat.write = (value) => compatWrites.push(String(value));
  compat.setKittyImages([image]);
  compat.Show();
  const output = compatWrites.join("");
  expect(output).toContain("\x1b_Ga=T");
  expect(output).not.toContain("U=image/jpeg");
});
