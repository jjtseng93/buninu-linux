import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Config } from "../src/config/config.js";

const tempDirs = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function loadConfig(settings) {
  const configDir = await mkdtemp(join(tmpdir(), "jsmdcui-config-"));
  tempDirs.push(configDir);
  await writeFile(join(configDir, "settings.json"), JSON.stringify(settings), "utf8");
  return await new Config({ configDir }).init();
}

test("Config.init discards top-level encoding from settings.json in memory", async () => {
  const config = await loadConfig({
    encoding: "big5",
    ruler: false,
    "ft:markdown": { encoding: "big5", tabsize: 2 },
  });

  expect(config.getGlobalOption("encoding")).toBe("utf-8");
  expect(config.parsedSettings).not.toHaveProperty("encoding");
  expect(config.parsedSettings["ft:markdown"].encoding).toBe("big5");
});

test("Config.saveSettings removes the top-level encoding discarded during init", async () => {
  const config = await loadConfig({
    encoding: "big5",
    ruler: false,
    "ft:markdown": { encoding: "big5", tabsize: 2 },
  });

  await config.saveSettings();
  const saved = JSON.parse(await readFile(join(config.configDir, "settings.json"), "utf8"));
  expect(saved).toEqual({ ruler: false, "ft:markdown": { encoding: "big5", tabsize: 2 } });
});

test("CLI encoding applies to the current invocation but saveSettings never persists it", async () => {
  const config = await loadConfig({ ruler: false });
  config.applyCliSettings(new Map([["encoding", "big5"]]));

  expect(config.getGlobalOption("encoding")).toBe("big5");
  await config.saveSettings();
  const saved = JSON.parse(await readFile(join(config.configDir, "settings.json"), "utf8"));
  expect(saved).toEqual({ ruler: false });
});
