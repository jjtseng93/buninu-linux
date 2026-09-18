import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { defaultAllSettings, LOCAL_SETTINGS } from "./defaults.js";

function settingsEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function createCleanPrompt() {
  if (process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    return {
      ask: async () => {
        const text = (await rl.question("Continue [Y/n]: ")).trim();
        return text.length === 0 || text.toLowerCase().startsWith("y");
      },
      close: () => rl.close(),
    };
  }

  const answers = (await Bun.stdin.text()).split(/\r?\n/);
  let index = 0;
  return {
    ask: async () => {
      process.stdout.write("Continue [Y/n]: ");
      const text = (answers[index++] ?? "").trim();
      return text.length === 0 || text.toLowerCase().startsWith("y");
    },
    close: () => {},
  };
}

function cleanDefaultSettings(config) {
  const defaults = defaultAllSettings();
  const cleaned = { ...config.parsedSettings };
  for (const [key, value] of Object.entries(cleaned)) {
    if (LOCAL_SETTINGS.has(key)) {
      delete cleaned[key];
      continue;
    }
    if (key in defaults && settingsEqual(config.globalSettings[key], defaults[key]) && settingsEqual(value, defaults[key])) {
      delete cleaned[key];
    }
  }
  return cleaned;
}

function findUnusedOptions(settings, pluginNames) {
  const defaults = defaultAllSettings();
  const unused = [];
  for (const key of Object.keys(settings)) {
    if (key.startsWith("ft:") || key.startsWith("glob:")) continue;
    if (key in defaults) continue;
    let valid = false;
    for (const name of pluginNames) {
      if (key === name || key.startsWith(`${name}.`)) {
        valid = true;
        break;
      }
    }
    if (!valid) unused.push(key);
  }
  return unused.sort();
}

async function writeCleanSettings(config, settings) {
  const settingsFile = join(config.configDir, "settings.json");
  await Bun.write(settingsFile, JSON.stringify(settings, null, "    ") + "\n");
}

function invalidBunBufferStateFile(path, name) {
  if (name !== "history.json" && name !== "cursor_state.json") return false;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return !parsed || typeof parsed !== "object" || Array.isArray(parsed);
  } catch {
    return true;
  }
}

export async function cleanConfig(config, plugins) {
  const prompt = await createCleanPrompt();
  try {
    console.log("Cleaning your configuration directory at", config.configDir);
    console.log(`Please consider backing up ${config.configDir} before continuing`);

    if (!(await prompt.ask())) {
      console.log("Stopping early");
      return;
    }

    console.log("Cleaning default settings");
    let cleanedSettings = cleanDefaultSettings(config);
    try {
      await writeCleanSettings(config, cleanedSettings);
    } catch (err) {
      console.log(`Error writing settings.json file: ${err.message}`);
    }

    const pluginNames = new Set(plugins.list().map((plugin) => plugin.name));
    const unusedOptions = findUnusedOptions(cleanedSettings, pluginNames);
    if (unusedOptions.length > 0) {
      const settingsFile = join(config.configDir, "settings.json");
      console.log("The following options are unused:");
      for (const option of unusedOptions) console.log(`${option} (value: ${JSON.stringify(cleanedSettings[option])})`);
      console.log(`These options will be removed from ${settingsFile}`);

      if (await prompt.ask()) {
        for (const option of unusedOptions) delete cleanedSettings[option];
        try {
          await writeCleanSettings(config, cleanedSettings);
          console.log("Removed unused options");
          console.log("\n");
        } catch (err) {
          console.log(`Error overwriting settings.json file: ${err.message}`);
        }
      }
    }

    const buffersPath = join(config.configDir, "buffers");
    if (existsSync(buffersPath)) {
      const badFiles = [];
      for (const entry of readdirSync(buffersPath, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        const path = join(buffersPath, entry.name);
        if (invalidBunBufferStateFile(path, entry.name)) badFiles.push(path);
      }
      if (badFiles.length > 0) {
        console.log(`Detected ${badFiles.length} files with an invalid format in ${buffersPath}`);
        console.log("These files store cursor and undo history.");
        console.log(`Removing badly formatted files in ${buffersPath}`);

        if (await prompt.ask()) {
          let removed = 0;
          for (const file of badFiles) {
            try {
              await rm(file);
              removed++;
            } catch (err) {
              console.log(err.message);
            }
          }
          if (removed === 0) console.log("Failed to remove files");
          else console.log(`Removed ${removed} badly formatted files`);
          console.log("\n");
        }
      }
    }

    const oldPluginsDir = join(config.configDir, "plugins");
    if (existsSync(oldPluginsDir) && statSync(oldPluginsDir).isDirectory()) {
      console.log(`Found directory ${oldPluginsDir}`);
      console.log(`Plugins should now be stored in ${join(config.configDir, "plug")}`);
      console.log(`Removing ${oldPluginsDir}`);

      if (await prompt.ask()) {
        try {
          await rm(oldPluginsDir, { recursive: true, force: true });
        } catch (err) {
          console.log(err.message);
        }
      }
      console.log("\n");
    }

    console.log("Done cleaning");
  } finally {
    prompt.close();
  }
}
