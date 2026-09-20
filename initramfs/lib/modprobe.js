// /lib/modprobe.js — kernel module loading shared by the Buninu Linux commands.
//
// There is no /sbin/modprobe for the kernel to call, so anything that needs a
// driver (a filesystem, a block device, a NIC) has to load it, and its
// dependencies, itself. fetch-alpine.sh ships the modules under
// /lib/modules/<release>/ together with a modules.dep trimmed to that set and
// the `fs-*` lines of modules.alias, and this module reads those.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { libc, cString, check, ptr, Errno, arch } from "./dlopen.js";

export const kernelRelease = () => {
  if (process.env.KERNEL_RELEASE) return process.env.KERNEL_RELEASE;
  try {
    return readFileSync("/proc/sys/kernel/osrelease", "utf8").trim();
  } catch {
    return "unknown";
  }
};

// /lib/modules/<release> in the guest; resolved relative to this file so a
// checkout can be tested the same way.
export const modulesDirectory = () => `${import.meta.dir}/modules/${kernelRelease()}`;

// Module names are canonical with underscores: usb-common.ko is usb_common in
// /proc/modules.
const canonical = (name) => name.replaceAll("-", "_");

const readIndex = (file) => {
  try {
    return readFileSync(`${modulesDirectory()}/${file}`, "utf8");
  } catch {
    return "";
  }
};

// name -> { path, dependencies: [names] } from modules.dep.
let dependencyTable;
const dependencies = () => {
  if (dependencyTable) return dependencyTable;
  dependencyTable = new Map();
  for (const line of readIndex("modules.dep").split("\n")) {
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const path = line.slice(0, separator);
    const deps = line.slice(separator + 1).trim().split(/\s+/).filter(Boolean);
    dependencyTable.set(canonical(moduleName(path)), {
      path,
      dependencies: deps.map((dep) => canonical(moduleName(dep))),
    });
  }
  return dependencyTable;
};

const moduleName = (path) => path.slice(path.lastIndexOf("/") + 1).replace(/\.ko(\.gz)?$/, "");

// modules.alias: exact names (fs-ntfs -> ntfs3) in a map, and the device
// patterns (pci:v000010ECd00008168sv*sd*bc*sc*i* -> r8169) as regexps.
let aliasTable;
const aliases = () => {
  if (aliasTable) return aliasTable;
  aliasTable = { exact: new Map(), patterns: [] };
  for (const line of readIndex("modules.alias").split("\n")) {
    const [keyword, pattern, target] = line.trim().split(/\s+/);
    if (keyword !== "alias" || !target) continue;
    const module = canonical(target);
    if (/[*?]/.test(pattern)) {
      const source = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*").replaceAll("?", ".");
      aliasTable.patterns.push({ regexp: new RegExp(`^${source}$`), module });
    } else {
      aliasTable.exact.set(pattern, module);
    }
  }
  return aliasTable;
};

export const resolveAlias = (alias) => {
  const { exact } = aliases();
  return exact.get(alias) ?? exact.get(canonical(alias)) ?? canonical(alias);
};

// The modules whose alias patterns match a device's modalias string.
export const modulesForModalias = (modalias) => {
  const found = [];
  for (const { regexp, module } of aliases().patterns) {
    if (regexp.test(modalias) && !found.includes(module)) found.push(module);
  }
  return found;
};

// What udev's coldplug does: read each device's modalias under
// /sys/bus/<bus>/devices and load the drivers that claim it. `accept`
// filters by modalias (e.g. PCI class 02 = network: /bc02/), `acceptModule`
// by module name and path (e.g. only kernel/drivers/net/). A driver built
// into the kernel has no alias line, so its device simply goes unreported.
// Returns one
// entry per device with the modules loaded, or the error, for it.
export const modulePath = (name) => dependencies().get(resolveAlias(name))?.path ?? null;

export const autoload = ({ buses = ["pci", "virtio", "usb"], accept = () => true, acceptModule = () => true } = {}) => {
  const report = [];
  for (const bus of buses) {
    let devices;
    try {
      devices = readdirSync(`/sys/bus/${bus}/devices`);
    } catch {
      continue;
    }
    for (const device of devices) {
      let modalias;
      try {
        modalias = readFileSync(`/sys/bus/${bus}/devices/${device}/modalias`, "utf8").trim();
      } catch {
        continue;
      }
      if (!accept(modalias, device)) continue;
      const modules = modulesForModalias(modalias).filter((module) => acceptModule(module, modulePath(module) ?? ""));
      if (modules.length === 0) continue;
      const entry = { bus, device, modalias, modules, loaded: [], error: null };
      for (const module of modules) {
        try {
          entry.loaded.push(...modprobe(module));
        } catch (error) {
          entry.error = error.message;
        }
      }
      report.push(entry);
    }
  }
  return report;
};

export const loadedModules = () => {
  const loaded = new Set();
  try {
    for (const line of readFileSync("/proc/modules", "utf8").split("\n")) {
      const name = line.split(" ")[0];
      if (name) loaded.add(name);
    }
  } catch {}
  return loaded;
};

export const isLoaded = (name) => loadedModules().has(canonical(name));

// Built-in drivers are absent from /proc/modules and from modules.dep, so
// the ones that matter to callers are listed in modules.builtin.
let builtinTable;
export const isBuiltin = (name) => {
  if (!builtinTable) {
    builtinTable = new Set(
      readIndex("modules.builtin").split("\n").filter(Boolean).map((path) => canonical(moduleName(path))),
    );
  }
  return builtinTable.has(canonical(name));
};

// finit_module(2) on one .ko file. EEXIST (loaded meanwhile, or built in
// and registered under the same name) is not an error.
export const insertModule = (path, parameters = "") => {
  const fd = check(`open(${path})`, libc.symbols.open(ptr(cString(path)), 0, 0));
  try {
    const flags = path.endsWith(".gz") ? 4 : 0; // MODULE_INIT_COMPRESSED_FILE
    // musl has no finit_module wrapper, so use its generic syscall(2).
    const result = check(
      `finit_module(${path})`,
      libc.symbols.syscall(arch.SYS_finit_module, fd, ptr(cString(parameters)), flags),
      [Errno.EEXIST],
    );
    return result === 0;
  } finally {
    libc.symbols.close(fd);
  }
};

export class ModuleNotFound extends Error {
  constructor(name) {
    super(`module ${name} not found in ${modulesDirectory()}`);
    this.name = "ModuleNotFound";
    this.module = name;
  }
}

// Loads `name` (a module name or a modules.alias key) and, first, whatever
// modules.dep says it needs. Returns the list of modules actually inserted.
export const modprobe = (name, parameters = "", { loaded = loadedModules(), inserted = [] } = {}) => {
  const module = resolveAlias(name);
  if (loaded.has(module) || isBuiltin(module)) return inserted;

  const entry = dependencies().get(module);
  if (!entry) throw new ModuleNotFound(module);

  // modules.dep lists dependencies in reverse load order; recursing on each
  // one covers the deps-of-deps case no matter how the line is ordered.
  for (const dependency of [...entry.dependencies].reverse()) {
    modprobe(dependency, "", { loaded, inserted });
  }

  const path = `${modulesDirectory()}/${entry.path}`;
  if (!existsSync(path)) throw new ModuleNotFound(module);
  if (insertModule(path, parameters)) inserted.push(module);
  loaded.add(module);
  return inserted;
};

// Load every selected module shipped in the initramfs (all modules by
// default). This is useful on the small real-machine image, where there is no
// userspace modprobe helper to satisfy a driver's later request for an
// optional PHY or bus module. Keep going after an individual failure: a
// module for absent hardware commonly rejects initialization, and that must
// not prevent the remaining modules loading.
export const modprobeAll = ({ accept = () => true } = {}) => {
  const loaded = loadedModules();
  const inserted = [];
  const errors = [];
  for (const [module, entry] of dependencies()) {
    if (!accept(module, entry.path)) continue;
    try {
      modprobe(module, "", { loaded, inserted });
    } catch (error) {
      errors.push({ module, error: error.message });
    }
  }
  return { inserted, errors };
};

// Best-effort variant for optional drivers: a missing module is not an error.
export const tryModprobe = (name, parameters = "") => {
  try {
    return modprobe(name, parameters);
  } catch (error) {
    if (error instanceof ModuleNotFound) return null;
    throw error;
  }
};
