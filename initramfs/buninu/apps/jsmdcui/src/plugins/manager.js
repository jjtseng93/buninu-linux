import { existsSync, readdirSync, readFileSync } from "node:fs";
import { readdir, readFile, rm, unlink } from "node:fs/promises";
import { basename, dirname, extname, join, sep } from "node:path";
import { fetchHttp, downloadFile } from "../platform/commands.js";
import { extractAndStrip } from "../platform/archive.js";
import { createLuaEngine } from "../lua/engine.js";
import { assetPath, hasInternalAssets, internalAssetSource, listInternalAssetDirs, listInternalAssetPaths, readInternalAssetText } from "../../single-exe/assetsHelper.js";
import { execCommand, runBackgroundShell, runCommand } from "../shell/shell.js";
import { Loc } from "../buffer/loc.js";
import { BTDefault, BTHelp, BTInfo, BTLog, BTRaw, BTScratch, byteOffset, BufferCore } from "../buffer/buffer.js";
import { MTError, MTInfo, MTWarning, newMessage, newMessageAtLine } from "../buffer/message.js";

const VALID_PLUGIN_NAME = /^[_A-Za-z0-9]+$/;

export class PluginManager {
  constructor({ config, runtime, repoRoot }) {
    this.config = config;
    this.runtime = runtime;
    this.repoRoot = repoRoot;
    this.plugins = [];
    this.lua = null;
    this.loadError = null;
    this.lintLog = [];
  }

  async init() {
    this.plugins = [];
    await this.scanUserInit();
    await this.scanUserPlugins();
    await this.scanBuiltinPlugins();
  }

  async loadAll() {
    try {
      this.lua ??= await createLuaEngine();
      await this.installMicroBridge();
    } catch (error) {
      this.loadError = error;
      return error;
    }

    for (const plugin of this.plugins) {
      if (this.config.getGlobalOption(plugin.name) === false) continue;
      try {
        await plugin.load(this.lua, this.config);
      } catch (error) {
        plugin.error = error;
        this.loadError = error;
      }
    }
    return this.loadError;
  }

  async run(fn, ...args) {
    for (const plugin of this.plugins) {
      if (!plugin.loaded) continue;
      if (this.config.getGlobalOption(plugin.name) === false) continue;
      try {
        await plugin.call(this.lua, fn, ...args);
      } catch (error) {
        plugin.error = error;
        this.loadError = error;
      }
    }
    return this.loadError;
  }

  async runBool(fn, ...args) {
    let ok = true;
    for (const plugin of this.plugins) {
      if (!plugin.loaded) continue;
      if (this.config.getGlobalOption(plugin.name) === false) continue;
      try {
        const result = await plugin.call(this.lua, fn, ...args);
        if (result === false) ok = false;
      } catch (error) {
        plugin.error = error;
        this.loadError = error;
      }
    }
    return ok;
  }

  list() {
    return this.plugins.map((plugin) => ({
      name: plugin.name,
      builtin: plugin.builtin,
      loaded: plugin.loaded,
      error: plugin.error?.message ?? "",
    }));
  }

  async scanUserInit() {
    const initlua = join(this.config.configDir, "init.lua");
    if (!existsSync(initlua)) return;
    this.plugins.push(new Plugin({ name: "initlua", dirName: "initlua", srcs: [fileSource(initlua)], builtin: false }));
  }

  async scanUserPlugins() {
    const plugdir = join(this.config.configDir, "plug");
    if (!existsSync(plugdir)) return;
    const entries = await readdir(plugdir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const plugin = await scanPluginDirectory(join(plugdir, entry.name), entry.name, false);
      if (plugin) this.plugins.push(plugin);
    }
  }

  async scanBuiltinPlugins() {
    const userNames = new Set(this.plugins.map((plugin) => plugin.name));
    const internalPrefix = assetPath("runtime", "plugins");

    if (hasInternalAssets()) {
      const entries = listInternalAssetDirs(internalPrefix);
      if (entries.length > 0) {
        for (const entryName of entries) {
          if (userNames.has(entryName)) continue;
          const plugin = await scanPluginDirectoryFromAssets(assetPath(internalPrefix, entryName), entryName, true);
          if (plugin) this.plugins.push(plugin);
        }
        return;
      }
    }

    const plugdir = join(this.repoRoot, "runtime", "plugins");
    if (!existsSync(plugdir)) return;
    const entries = await readdir(plugdir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || userNames.has(entry.name)) continue;
      const plugin = await scanPluginDirectory(join(plugdir, entry.name), entry.name, true);
      if (plugin) this.plugins.push(plugin);
    }
  }

  // ── Plugin management (CLI) ──────────────────────────────────────────────

  async pluginCommand(subcmd, args) {
    switch (subcmd) {
      case "list":    return this._cmdList();
      case "available":
      case "avail":     return this._cmdAvailable();
      case "search":  return this._cmdSearch(args);
      case "install": return this._cmdInstall(args);
      case "remove":  return this._cmdRemove(args);
      case "update":  return this._cmdUpdate(args);
      default:
        console.error(`Invalid plugin command: ${subcmd}`);
        console.error("Valid commands: list, available, search, install, remove, update");
        process.exit(1);
    }
  }

  _cmdList() {
    const infos = this.plugins.map((p) => {
      const ver = p.builtin ? "" : (this._installedVersion(p.name) ?? "");
      const tag = p.builtin ? " (built-in)" : (ver ? ` ${ver}` : "");
      return `${p.name}${tag}`;
    });
    if (infos.length === 0) {
      console.log("No plugins found.");
    } else {
      console.log("Installed plugins:");
      for (const line of infos) console.log(`  ${line}`);
    }
  }

  async _cmdAvailable() {
    const packages = await this._fetchAllPackages((msg) => process.stderr.write(msg + "\n"));
    if (packages.length === 0) {
      console.log("No plugins available (check pluginchannels setting and network).");
      return;
    }
    console.log("Available plugins:");
    for (const pkg of packages) console.log(`  ${pkg.Name}`);
  }

  async _cmdSearch(keywords) {
    if (keywords.length === 0) {
      console.error("Usage: -plugin search <keyword> [keyword...]");
      process.exit(1);
    }
    const packages = await this._fetchAllPackages((msg) => process.stderr.write(msg + "\n"));
    const results = packages.filter((pkg) => _matchPlugin(pkg, keywords));
    console.log(`${results.length} plugin${results.length === 1 ? "" : "s"} found`);
    for (const pkg of results) {
      console.log("----------------");
      console.log(_formatPlugin(pkg));
    }
    if (results.length > 0) console.log("----------------");
  }

  async _cmdInstall(names) {
    if (names.length === 0) {
      console.error("Usage: -plugin install <name> [name...]");
      process.exit(1);
    }
    const packages = await this._fetchAllPackages((msg) => process.stderr.write(msg + "\n"));
    let anyInstalled = false;
    for (const name of names) {
      const pkg = packages.find((p) => p.Name?.toLowerCase() === name.toLowerCase());
      if (!pkg) { console.error(`Unknown plugin "${name}"`); continue; }
      if (!pkg.Versions?.length) { console.error(`No versions available for "${name}"`); continue; }
      const plugDir = join(this.config.configDir, "plug", pkg.Name);
      if (existsSync(plugDir)) {
        const cur = this._installedVersion(pkg.Name);
        const latest = String(pkg.Versions[0].Version ?? "");
        if (cur && _compareSemver(latest, cur) > 0) {
          console.log(`${pkg.Name} is already installed but out-of-date: use '-plugin update ${pkg.Name}' to update`);
        } else {
          console.log(`${pkg.Name} is already installed`);
        }
        continue;
      }
      try {
        await this._downloadAndInstall(pkg, plugDir);
        anyInstalled = true;
      } catch (e) {
        console.error(`Error installing ${pkg.Name}: ${e.message}`);
      }
    }
    if (anyInstalled) console.log("One or more plugins installed.");
    else console.log("Nothing to install / update");
  }

  async _cmdRemove(names) {
    if (names.length === 0) {
      console.error("Usage: -plugin remove <name> [name...]");
      process.exit(1);
    }
    let removed = [];
    for (const name of names) {
      if (name === "initlua") {
        console.log("initlua cannot be removed, but can be disabled via settings.");
        continue;
      }
      const builtin = this.plugins.find((p) => p.name === name && p.builtin);
      if (builtin) {
        console.log(`${name} is a built-in plugin which cannot be removed, but can be disabled via settings.`);
        continue;
      }
      const plugDir = join(this.config.configDir, "plug", name);
      if (!existsSync(plugDir)) {
        console.log(`Plugin "${name}" is not installed`);
        continue;
      }
      await rm(plugDir, { recursive: true, force: true });
      removed.push(name);
    }
    if (removed.length > 0) console.log(`Removed ${removed.join(" ")}`);
    else console.log("No plugins removed");
  }

  async _cmdUpdate(names) {
    const packages = await this._fetchAllPackages((msg) => process.stderr.write(msg + "\n"));
    const targets = names.length > 0
      ? names
      : this.plugins.filter((p) => !p.builtin && p.name !== "initlua").map((p) => p.name);
    if (targets.length === 0) { console.log("No user plugins to update."); return; }
    let anyUpdated = false;
    for (const name of targets) {
      const pkg = packages.find((p) => p.Name?.toLowerCase() === name.toLowerCase());
      if (!pkg) { console.log(`Unknown plugin "${name}"`); continue; }
      if (!pkg.Versions?.length) continue;
      const latest = String(pkg.Versions[0].Version ?? "");
      const cur = this._installedVersion(pkg.Name);
      if (cur && cur !== "unknown" && _compareSemver(latest, cur) <= 0) {
        console.log(`${pkg.Name} is already up to date (${cur})`);
        continue;
      }
      const plugDir = join(this.config.configDir, "plug", pkg.Name);
      if (existsSync(plugDir)) await rm(plugDir, { recursive: true, force: true });
      try {
        await this._downloadAndInstall(pkg, plugDir);
        anyUpdated = true;
      } catch (e) {
        console.error(`Error updating ${pkg.Name}: ${e.message}`);
      }
    }
    if (!anyUpdated) console.log("Nothing to update");
  }

  async _fetchAllPackages(onStatus) {
    if (this._packages) return this._packages;
    const channelUrls = [].concat(this.config.getGlobalOption("pluginchannels") ?? []).map(String);
    const repoUrls = [].concat(this.config.getGlobalOption("pluginrepos") ?? []).map(String);
    const packages = [];
    const seen = new Set();

    for (const channelUrl of channelUrls) {
      onStatus?.(`Fetching channel: ${channelUrl}`);
      try {
        const data = Bun.JSON5.parse(await fetchHttp(channelUrl));
        if (Array.isArray(data)) repoUrls.push(...data.map(String));
      } catch (e) {
        onStatus?.(`Warning: failed to fetch channel ${channelUrl}: ${e.message}`);
      }
    }
    for (const repoUrl of repoUrls) {
      onStatus?.(`Fetching repository: ${repoUrl}`);
      try {
        const data = Bun.JSON5.parse(await fetchHttp(repoUrl));
        const list = Array.isArray(data) ? data : [data];
        for (const pkg of list) {
          if (!pkg?.Name || seen.has(pkg.Name)) continue;
          seen.add(pkg.Name);
          packages.push(pkg);
        }
      } catch (e) {
        onStatus?.(`Warning: failed to fetch repo ${repoUrl}: ${e.message}`);
      }
    }
    this._packages = packages;
    return packages;
  }

  async _downloadAndInstall(pkg, plugDir) {
    const version = pkg.Versions[0];
    const versionStr = String(version.Version ?? "");
    console.log(`Downloading "${pkg.Name}" (${versionStr}) from "${version.Url}"`);
    const tmpFile = join(this.config.configDir, `_tmp_${pkg.Name}.zip`);
    try {
      await downloadFile(String(version.Url), tmpFile);
      await extractAndStrip(tmpFile, plugDir);
      // Write version marker for future update checks
      await Bun.write(join(plugDir, "_installed_version.txt"), versionStr);
    } finally {
      if (existsSync(tmpFile)) await unlink(tmpFile).catch(() => {});
    }
    console.log(`Installed ${pkg.Name} ${versionStr}`);
  }

  _installedVersion(name) {
    const plugDir = join(this.config.configDir, "plug", name);
    if (!existsSync(plugDir)) return null;
    // Check version marker written by _downloadAndInstall
    const marker = join(plugDir, "_installed_version.txt");
    if (existsSync(marker)) {
      try { return readFileSync(marker, "utf8").trim(); } catch {}
    }
    // Fallback: scan JSON files for version info
    try {
      for (const f of readdirSync(plugDir)) {
        if (!f.endsWith(".json")) continue;
        try {
          const data = JSON.parse(readFileSync(join(plugDir, f), "utf8"));
          const list = Array.isArray(data) ? data : [data];
          const ver = list[0]?.Versions?.[0]?.Version;
          if (ver) return String(ver);
        } catch {}
      }
    } catch {}
    return "unknown";
  }

  // ── End plugin management ────────────────────────────────────────────────

  async installMicroBridge() {
    this.lua.setGlobal("import", (pkg) => this.importPackage(pkg));
    await this.lua.doString(`
      if module == nil then
        function module(name, mode)
          local t = _G[name] or {}
          _G[name] = t
          if mode == package.seeall then
            setmetatable(t, { __index = _G })
          end
          _ENV = t
          return t
        end
      end

      -- gopher-lua compat: PUC Lua 5.4 rejects %x (x non-digit, non-%) in gsub
      -- replacement strings; gopher-lua treats them as literal characters.
      -- Wrap string.gsub so that such sequences are escaped before handing off.
      do
        local _gsub = string.gsub
        function string.gsub(s, pattern, repl, n)
          if type(repl) == "string" then
            repl = _gsub(repl, "%%([^%d%%])", function(c) return "%%" .. c end)
          end
          if n ~= nil then return _gsub(s, pattern, repl, n) end
          return _gsub(s, pattern, repl)
        end
      end
    `, "micro-compat");
  }

  importPackage(pkg) {
    if (pkg === "micro/config") return this.configPackage();
    if (pkg === "runtime") return { GOOS: process.platform, GOARCH: process.arch };
    if (pkg === "micro") return { Log: console.log, TermMessage: console.log, TermError: console.error, SetStatusInfoFn: (name) => { this.statusInfoFns ??= new Set(); this.statusInfoFns.add(name); }, CurPane: () => this.curPaneAdapter ?? null };
    if (pkg === "micro/shell") return this.shellPackage();
    if (pkg === "micro/buffer") return this.bufferPackage();
    if (pkg === "micro/util") return this.utilPackage();
    if (pkg === "humanize") return { Bytes: humanizeBytes };
    if (pkg === "strings") return { TrimSpace: (s) => String(s).trim() };
    if (pkg === "path/filepath" || pkg === "filepath") return { Dir: dirname, Base: basename, Split: splitPath };
    if (pkg === "os") return { PathSeparator: sep, Stat: (path) => ({ _unsupported: true, path }) };
    return {};
  }

  configPackage() {
    return {
      RegisterCommonOption: (plugin, option, value) => this.config.registerCommonOption(plugin, option, value),
      RegisterGlobalOption: (option, value) => this.config.registerGlobalOption(option, value),
      GetGlobalOption: (option) => this.config.getGlobalOption(option),
      SetGlobalOptionNative: (option, value) => this.config.setGlobalOptionNative(option, value),
      MakeCommand: (name, fn) => { this.commands ??= new Map(); this.commands.set(name, fn); },
      TryBindKey: () => false,
      NoComplete: () => [],
      FileComplete: () => [],
      HelpComplete: () => [],
      OptionComplete: () => [],
      OptionValueComplete: () => [],
      Reload: () => undefined,
      AddRuntimeFileFromMemory: (kind, name, data) => this.runtime.addMemoryFile(kind, name, data),
      AddRuntimeFile: (plugin, kind, relpath) => this.addPluginRuntimeFile(plugin, kind, relpath),
      ListRuntimeFiles: (kind) => this.runtime.list(kind).map((file) => file.name),
      ReadRuntimeFile: async (kind, name) => (await this.runtime.find(kind, name)?.text()) ?? "",
      NewRTFiletype: () => this.runtime.files.push([]) - 1,
      RTColorscheme: 0, RTSyntax: 1, RTHelp: 2, RTPlugin: 3, RTSyntaxHeader: 4,
      ConfigDir: this.config.configDir,
    };
  }

  addPluginRuntimeFile(plugin, kind, relpath) {
    const owner = this.plugins.find((p) => p.name === plugin);
    if (!owner) return;
    const internalPath = assetPath("runtime", "plugins", owner.dirName, relpath);
    const internalText = readInternalAssetText(internalPath);
    if (internalText != null) {
      this.runtime.files[kind].push({
        name: basename(relpath, extname(relpath)),
        path: internalPath,
        text: async () => internalText,
      });
      return;
    }
    const path = join(this.repoRoot, "runtime", "plugins", owner.dirName, relpath);
    this.runtime.files[kind].push({ name: basename(path, extname(path)), path, text: async () => await readFile(path, "utf8") });
  }

  shellPackage() {
    // JobSpawn: mirrors Go's shell.JobSpawn(cmd, args, onStdout, onStderr, onExit, ...userArgs).
    // Spawns cmd asynchronously; calls onExit(output, userArgsTable) on exit.
    // onStdout/onStderr called per-chunk if provided (linter passes nil for both).
    // userArgs is a plain JS array. wasmoon's ProxyTypeExtension wraps it with __index that
    // applies (key - 1) for numeric keys, so Lua's args[1] → array[0], args[2] → array[1], etc.
    // This matches Go/luar's 1-indexed Lua table convention without any manual conversion.
    const spawnJob = async (argv, onStdout, onStderr, onExit, userArgs) => {
      let proc;
      try {
        proc = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
      } catch (err) {
        this.lintLog.push(`[JobSpawn] spawn "${argv[0]}": ${err.message}`);
        return;
      }
      const collectStream = async (stream, onChunk) => {
        const chunks = [];
        if (stream) {
          const reader = stream.getReader();
          const dec = new TextDecoder();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const text = dec.decode(value, { stream: true });
            chunks.push(text);
            if (typeof onChunk === "function") await onChunk(text, userArgs);
          }
        }
        return chunks.join("");
      };
      const [out, err] = await Promise.all([
        collectStream(proc.stdout, onStdout),
        collectStream(proc.stderr, onStderr),
      ]);
      await proc.exited;
      const output = out + err;
      if (output.trim()) this.lintLog.push(`[${argv[0]}]\n${output.trim()}`);
      if (typeof onExit === "function") await onExit(output, userArgs);
    };

    return {
      ExecCommand: (name, ...args) => execCommand(name, args),
      RunCommand: (input) => runCommand(input),
      RunBackgroundShell: (input) => runBackgroundShell(input),
      // JobSpawn(cmd, args, onStdout, onStderr, onExit, ...userArgs)
      JobSpawn: (cmd, luaArgs, onStdout, onStderr, onExit, ...userArgs) => {
        const argv = [String(cmd), ...luaSeqToArray(luaArgs).map(String)];
        spawnJob(argv, onStdout ?? null, onStderr ?? null, onExit ?? null, userArgs)
          .catch((e) => this.lintLog.push(`[JobSpawn] ${argv[0]}: ${e.message}`));
      },
      // JobStart(cmdStr, onStdout, onStderr, onExit, ...userArgs) — shell-split single string
      JobStart: (cmdStr, onStdout, onStderr, onExit, ...userArgs) => {
        const argv = String(cmdStr ?? "").trim().split(/\s+/).filter(Boolean);
        if (!argv.length) return;
        spawnJob(argv, onStdout ?? null, onStderr ?? null, onExit ?? null, userArgs)
          .catch((e) => this.lintLog.push(`[JobStart] ${argv[0]}: ${e.message}`));
      },
      JobStop: () => undefined,
      JobSend: () => undefined,
      RunInteractiveShell: () => ["", "shell bridge not implemented"],
      RunTermEmulator: () => undefined,
      TermEmuSupported: () => true,
    };
  }

  bufferPackage() {
    return {
      Loc: (x, y) => new Loc(x, y),
      NewMessage: newMessage,
      NewMessageAtLine: newMessageAtLine,
      NewBuffer: (text, path) => new BufferCore({ text, path }),
      NewBufferFromFile: async (path) => new BufferCore({ text: await Bun.file(path).text(), path }),
      MTInfo, MTWarning, MTError,
      BTDefault: BTDefault.Kind, BTHelp: BTHelp.Kind, BTLog: BTLog.Kind, BTScratch: BTScratch.Kind, BTRaw: BTRaw.Kind, BTInfo: BTInfo.Kind,
      ByteOffset: byteOffset,
      Log: console.log,
      LogBuf: () => null,
    };
  }

  utilPackage() {
    return {
      RuneAt: (s, i) => Array.from(String(s))[i] ?? "",
      GetLeadingWhitespace: (s) => String(s).match(/^\s*/)?.[0] ?? "",
      IsWordChar: (ch) => /^[A-Za-z0-9_]$/.test(String(ch)),
      String: (v) => String(v),
      RuneStr: (v) => String(v),
      CharacterCountInString: (s) => Array.from(String(s)).length,
      Version: "0.1.0-bun",
      SemVersion: "0.1.0",
      HttpRequest: async (url) => await fetchHttp(String(url)),
      Unzip: () => { throw new Error("Unzip bridge is not implemented here; use platform/archive.js"); },
    };
  }
}

function _matchPlugin(pkg, keywords) {
  return keywords.every((kw) => {
    const k = kw.toLowerCase();
    return (
      pkg.Name?.toLowerCase().includes(k) ||
      pkg.Description?.toLowerCase().includes(k) ||
      pkg.Tags?.some((t) => t.toLowerCase() === k)
    );
  });
}

function _formatPlugin(pkg) {
  let out = `Plugin: ${pkg.Name}`;
  if (pkg.Author) out += `\nAuthor: ${pkg.Author}`;
  if (pkg.Description) out += `\n\n${pkg.Description}`;
  if (pkg.Versions?.length) out += `\nLatest: ${pkg.Versions[0].Version}`;
  return out;
}

function _compareSemver(a, b) {
  const pa = String(a).replace(/^v/, "").split(".").map((n) => parseInt(n) || 0);
  const pb = String(b).replace(/^v/, "").split(".").map((n) => parseInt(n) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

class Plugin {
  constructor({ name, dirName, srcs, info = null, builtin = false }) {
    this.name = name;
    this.dirName = dirName;
    this.srcs = srcs;
    this.info = info;
    this.builtin = builtin;
    this.loaded = false;
    this.error = null;
  }

  async load(lua, config) {
    if (config.getGlobalOption(this.name) === false) return;
    for (const src of this.srcs) {
      const data = await src.text();
      await lua.doString(`local _ENV = module("${this.name}", package.seeall)\n${data}`, src.name);
    }
    this.loaded = true;
    config.registerGlobalOption(this.name, true);
  }

  async call(lua, fn, ...args) {
    for (let i = 0; i < args.length; i++) lua.setGlobal(`__micro_arg${i + 1}`, args[i]);
    const argv = args.map((_, i) => `__micro_arg${i + 1}`).join(", ");
    return lua.doString(`if ${this.name}.${fn} ~= nil then return ${this.name}.${fn}(${argv}) end`, `${this.name}.${fn}`);
  }
}

async function scanPluginDirectory(dir, defaultName, builtin) {
  const entries = await readdir(dir, { withFileTypes: true });
  const srcs = [];
  let info = null;
  let name = defaultName;
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isFile() && entry.name.endsWith(".lua")) {
      srcs.push(fileSource(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      const parsed = JSON.parse(await readFile(fullPath, "utf8"));
      info = Array.isArray(parsed) ? parsed[0] : parsed;
      if (info?.Name) name = info.Name;
    }
  }
  if (!VALID_PLUGIN_NAME.test(name) || srcs.length === 0) return null;
  return new Plugin({ name, dirName: basename(dir), srcs, info, builtin });
}

function fileSource(path) {
  const internalText = readInternalAssetText(path);
  if (internalText != null) {
    return {
      name: basename(path),
      path,
      text: async () => internalText,
    };
  }
  return {
    name: basename(path),
    path,
    text: () => readFile(path, "utf8"),
  };
}

async function scanPluginDirectoryFromAssets(prefix, defaultName, builtin) {
  const entries = listInternalAssetPaths(prefix);
  const srcs = [];
  let info = null;
  let name = defaultName;
  const base = `${assetPath(prefix)}/`;

  for (const fullPath of entries) {
    const rel = fullPath.slice(base.length);
    if (!rel || rel.includes("/")) continue;
    if (rel.endsWith(".lua")) {
      srcs.push(internalAssetSource(fullPath));
    } else if (rel.endsWith(".json")) {
      const parsed = JSON.parse(readInternalAssetText(fullPath) ?? "null");
      info = Array.isArray(parsed) ? parsed[0] : parsed;
      if (info?.Name) name = info.Name;
    }
  }
  if (!VALID_PLUGIN_NAME.test(name) || srcs.length === 0) return null;
  return new Plugin({ name, dirName: basename(prefix), srcs, info, builtin });
}

function humanizeBytes(bytes) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = Number(bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function splitPath(path) {
  return [dirname(path), basename(path)];
}

// Lua sequential table arrives from wasmoon as a 0-indexed JS array.
// This helper normalises it to a plain JS array regardless of form.
function luaSeqToArray(table) {
  if (!table) return [];
  if (Array.isArray(table)) return table;
  if (typeof table !== "object") return [];
  const keys = Object.keys(table).map(Number).filter((n) => Number.isInteger(n) && n >= 0).sort((a, b) => a - b);
  return keys.map((k) => table[k]);
}
