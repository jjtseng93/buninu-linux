// Explicit one-shot GPU coldplug. Importing this module never loads a driver.
import * as fs from "node:fs";
import { join, basename } from "node:path";

const drivers = new Set(["i915", "xe", "amdgpu", "radeon", "nouveau", "virtio_gpu", "vmwgfx"]);
export const isGpuPath = (_module, path) => path.startsWith("kernel/drivers/gpu/");
export const isGpuDriver = (module, path) => isGpuPath(module, path) && drivers.has(module.replaceAll("-", "_"));

export const framebufferUsers = ({ root = "/", io = fs } = {}) => {
  const users = [];
  for (const pid of io.readdirSync(join(root, "proc")).filter(name => /^\d+$/.test(name))) {
    try {
      const dir = join(root, "proc", pid, "fd");
      let busy = false;
      for (const fd of io.readdirSync(dir)) {
        try { if (/^\/dev\/fb\d+(?: \(deleted\))?$/.test(io.readlinkSync(join(dir, fd)))) busy = true; }
        catch (error) { if (error.code !== "ENOENT") throw error; }
      }
      // An mmap can outlive its fd.
      if (/\/dev\/fb\d+(?:\s|$)/m.test(io.readFileSync(join(root, "proc", pid, "maps"), "utf8"))) busy = true;
      if (busy) users.push(pid);
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ESRCH") throw error;
    }
  }
  return users;
};

export const configureGpu = ({ autoload, tryModprobe, root = "/", io = fs, env = process.env, log = console.log } = {}) => {
  const result = { devices: [], renderNodes: [], framebuffers: [], errors: [], blocked: false };
  const say = text => { try { log(`[gpu] ${text}`); } catch {} };
  try {
    const gid = env.BUNINU_RENDER_GID === undefined ? 0 : Number(env.BUNINU_RENDER_GID);
    if (!Number.isInteger(gid) || gid < 0 || gid >= 0xffffffff || env.BUNINU_RENDER_GID === "")
      throw Error("BUNINU_RENDER_GID must be a numeric group ID");
    const users = framebufferUsers({ root, io });
    if (users.length) {
      result.blocked = true;
      say(`not loaded: framebuffer in use by PID ${users.join(", ")}; exit bunterm/fbdev and run cfg.gpu before reopening it`);
      return result;
    }
    // A virtio GPU may not appear on the virtio bus until its PCI transport loads.
    try { tryModprobe("virtio_pci"); } catch (error) { result.errors.push(`virtio_pci: ${error?.message ?? error}`); }
    result.devices = autoload({ buses: ["pci", "virtio"], acceptModule: isGpuDriver });
    for (const device of result.devices) {
      if (device.error) result.errors.push(`${device.bus}/${device.device}: ${device.error}`);
      say(`${device.bus}/${device.device} ${device.modules.join(" ")}: ${device.error ?? (device.loaded.length ? "loaded " + device.loaded.join(" ") : "already loaded/probed")}`);
    }
    const list = path => { try { return io.readdirSync(join(root, path)); } catch (error) { if (error.code === "ENOENT") return []; throw error; } };
    for (const name of list("dev/dri").filter(name => /^renderD\d+$/.test(name)).sort()) {
      const path = join(root, "dev/dri", name);
      try {
        if (!io.statSync(path).isCharacterDevice()) continue;
        io.chownSync(path, 0, gid);
        io.chmodSync(path, 0o660);
        let driver = "unknown";
        try {
          const device = join(root, "sys/class/drm", name, "device");
          driver = basename(io.readlinkSync(join(device, "driver")));
          // virtio DRM nodes can point at the parent PCI transport device.
          if (driver === "virtio-pci") for (const child of io.readdirSync(device).filter(n => /^virtio\d+$/.test(n))) {
            const candidate = basename(io.readlinkSync(join(device, child, "driver")));
            if (candidate === "virtio_gpu" || candidate === "virtio-gpu") { driver = candidate; break; }
          }
        } catch {}
        result.renderNodes.push({ path: `/dev/dri/${name}`, driver, gid });
        say(`/dev/dri/${name}: driver=${driver}, root:${gid} mode=0660`);
      } catch (error) { result.errors.push(`${name}: ${error?.message ?? error}`); }
    }
    result.framebuffers = list("dev").filter(name => /^fb\d+$/.test(name)).sort().map(name => `/dev/${name}`);
    say(`framebuffer: ${result.framebuffers.join(", ") || "none"}; reopen framebuffer clients after GPU handoff`);
    if (!result.renderNodes.length) say("no accessible render node yet; check kernel firmware/driver messages and GPU support, then retry cfg.gpu after probing finishes");
    say("clients still need their own Mesa/Vulkan driver; non-root clients need the render node's numeric group");
  } catch (error) { result.errors.push(String(error?.message ?? error)); }
  for (const error of result.errors) say(`failed: ${error}; init continues`);
  return result;
};
