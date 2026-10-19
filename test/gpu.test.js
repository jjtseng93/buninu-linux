import { test, expect, afterEach } from "bun:test";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configureGpu, framebufferUsers, isGpuPath } from "../initramfs/lib/gpu.js";
import { extractFirmware, firmwareLinkTarget } from "../scripts/fetch-gpu.js";
import { readTar } from "../scripts/fetch.js";
import { requests, select } from "../scripts/modules.js";

const dirs = [];
const temporary = () => { const p = fs.mkdtempSync(join(tmpdir(), "buninu-gpu-test-")); dirs.push(p); return p; };
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
const archive = (files, links = {}) => ({ entries: () => Object.entries(files).map(([n,b]) => [n, Buffer.from(b)]), links: () => Object.entries(links) });
const soft = target => ({ target, hard: false });

test("firmware preserves directory aliases, cross-package links and hardlinks", () => {
  const root = temporary();
  const files = extractFirmware([
    archive({ "lib/firmware/nvidia/ad102/gsp.bin.zst": "firmware", "lib/firmware/amdgpu/a.bin.zst": "amd" }),
    archive({}, {
      "lib/firmware/nvidia/ad103": soft("ad102"),
      "lib/firmware/nvidia/alias.bin.zst": soft("ad103/gsp.bin.zst"),
      "lib/firmware/radeon/alias.bin.zst": soft("../amdgpu/a.bin.zst"),
      "lib/firmware/nvidia/hard.bin.zst": { target: "lib/firmware/nvidia/ad102/gsp.bin.zst", hard: true },
    }),
  ], root);
  expect(files).toHaveLength(6);
  expect(fs.readFileSync(join(root, "lib/firmware/nvidia/ad103/gsp.bin.zst"), "utf8")).toBe("firmware");
  expect(fs.readFileSync(join(root, "lib/firmware/nvidia/alias.bin.zst"), "utf8")).toBe("firmware");
  expect(fs.readFileSync(join(root, "lib/firmware/nvidia/hard.bin.zst"), "utf8")).toBe("firmware");
  expect(fs.readFileSync(join(root, "lib/firmware/radeon/alias.bin.zst"), "utf8")).toBe("amd");
});

test("firmware rejects escaping, missing and cyclic links before extraction", () => {
  for (const target of ["/etc/passwd", "../../../etc/passwd", "..\\etc\\passwd"])
    expect(() => firmwareLinkTarget("lib/firmware/nvidia/x", soft(target))).toThrow();
  for (const links of [
    { "lib/firmware/a": soft("missing") },
    { "lib/firmware/a": soft("b"), "lib/firmware/b": soft("a") },
    { "lib/firmware/a": soft("a/child") },
  ]) expect(() => extractFirmware([archive({}, links)], temporary())).toThrow();
  expect(() => extractFirmware([archive({"lib/firmware/../../escape": "bad"})], temporary())).toThrow();
});

test.skipIf(!Bun.which("tar"))("APK tar reader retains GNU long symlinks and hardlinks", () => {
  const root = temporary(), tree = join(root, "tree"); fs.mkdirSync(tree);
  const name = "x".repeat(120);
  fs.writeFileSync(join(tree, name), "firmware");
  fs.linkSync(join(tree, name), join(tree, "hard"));
  fs.symlinkSync(name, join(tree, "alias"));
  const pkg = join(root, "package.tar.gz");
  expect(Bun.spawnSync(["tar", "--format=gnu", "-czf", pkg, "-C", tree, name, "hard", "alias"]).exitCode).toBe(0);
  const tar = readTar(pkg), links = new Map(tar.links());
  expect(tar.get(name).toString()).toBe("firmware");
  expect(links.get("alias")).toEqual({ target: name, hard: false });
  expect(links.get("hard")).toEqual({ target: name, hard: true });
});

const runtime = () => {
  const root = temporary(), calls = [], logs = [];
  fs.mkdirSync(join(root, "proc/1/fd"), { recursive:true });
  fs.writeFileSync(join(root, "proc/1/maps"), "");
  fs.mkdirSync(join(root, "dev/dri"), { recursive:true });
  fs.writeFileSync(join(root, "dev/dri/renderD129"), "node");
  fs.writeFileSync(join(root, "dev/fb0"), "node");
  const io = {...fs,
    statSync: path => path.includes("renderD") ? { isCharacterDevice: () => true } : fs.statSync(path),
    chownSync: (path, uid, gid) => calls.push(["chown", uid, gid]),
    chmodSync: (path, mode) => calls.push(["chmod", mode]),
  };
  const options = { root, io, env: {}, log: s => logs.push(s),
    tryModprobe: name => calls.push(["transport", name]),
    autoload: options => {
      const candidates = [ ["amdgpu", "kernel/drivers/gpu/drm/amd/amdgpu/amdgpu.ko"], ["simpledrm", "kernel/drivers/gpu/drm/sysfb/simpledrm.ko"], ["e1000", "kernel/drivers/net/e1000.ko"] ];
      const modules = candidates.filter(x => options.acceptModule(...x)).map(x => x[0]);
      calls.push(["autoload", modules]);
      return [{ bus:"pci", device:"0000:01:00.0", modules, loaded:modules, error:null }];
    },
  };
  return { root, calls, logs, options };
};

test("cfg.gpu matches only GPU leaf drivers and configures actual render node names", () => {
  const { options, calls } = runtime(); options.env.BUNINU_RENDER_GID = "107";
  const result = configureGpu(options);
  expect(result.errors).toEqual([]);
  expect(result.renderNodes).toEqual([{path:"/dev/dri/renderD129", driver:"unknown", gid:107}]);
  expect(calls).toContainEqual(["autoload", ["amdgpu"]]);
  expect(calls).toContainEqual(["chown", 0, 107]);
  expect(calls).toContainEqual(["chmod", 0o660]);
});

test("virtio render nodes report the GPU child driver rather than the PCI transport", () => {
  const { root, options } = runtime();
  const device = join(root, "sys/class/drm/renderD129/device");
  fs.mkdirSync(join(device, "virtio0"), {recursive:true});
  fs.symlinkSync("/sys/bus/pci/drivers/virtio-pci", join(device, "driver"));
  fs.symlinkSync("/sys/bus/virtio/drivers/virtio_gpu", join(device, "virtio0/driver"));
  expect(configureGpu(options).renderNodes[0].driver).toBe("virtio_gpu");
});

test("no matching GPU and no render node is diagnosed without claiming acceleration", () => {
  const { root, options, logs } = runtime();
  fs.unlinkSync(join(root, "dev/dri/renderD129"));
  options.autoload = () => [];
  const result = configureGpu(options);
  expect(result.errors).toEqual([]);
  expect(result.renderNodes).toEqual([]);
  expect(logs.some(s=>s.includes("no accessible render node"))).toBe(true);
});

test("framebuffer fd or surviving mmap prevents GPU takeover before loading anything", () => {
  for (const mapped of [false, true]) {
    const { root, options, calls } = runtime();
    if (mapped) fs.writeFileSync(join(root, "proc/1/maps"), "abc-def rw-s 00000000 00:01 3 /dev/fb0\n");
    else fs.symlinkSync("/dev/fb0", join(root, "proc/1/fd/4"));
    expect(framebufferUsers(options)).toEqual(["1"]);
    expect(configureGpu(options).blocked).toBe(true);
    expect(calls).toEqual([]);
  }
});

test("missing hardware, driver failure and invalid permissions do not escape cfg.gpu", () => {
  const { options, calls } = runtime();
  options.env.BUNINU_RENDER_GID = "bad";
  expect(configureGpu(options).errors.length).toBe(1); expect(calls).toEqual([]);
  options.env = {};
  options.autoload = () => { throw Error("driver failed"); };
  expect(configureGpu(options).errors).toEqual(["driver failed"]);
  options.autoload = () => []; options.io.chownSync = () => { throw Error("permission denied"); };
  expect(configureGpu(options).errors[0]).toContain("permission denied");
});

test("cfg.all's actual loader excludes GPU modules and still loads network/sound", () => {
  const source = fs.readFileSync(new URL("../initramfs/init.js", import.meta.url), "utf8");
  const body = source.match(/const configureModules = \(\) => \{([\s\S]*?)\n\};/)[1];
  const chosen = [];
  const require = () => ({ isGpuPath, modprobeAll: ({accept}) => {
    for (const path of ["kernel/drivers/gpu/drm/amd/amdgpu/amdgpu.ko", "kernel/drivers/net/e1000.ko", "kernel/sound/snd.ko"])
      if (accept("",path)) chosen.push(path);
    return {inserted:chosen,errors:[]};
  }});
  new Function("require", "console", body)(require, {log(){}});
  expect(chosen).toEqual(["kernel/drivers/net/e1000.ko", "kernel/sound/snd.ko"]);
  expect(source).toContain("gpu: { enumerable: true, get: configureGraphics }");
});

test("GPU leaves are optional for kernels without them and their dependencies are selected", () => {
  const target = {arch:"x86_64",flavor:"lts",real:false};
  const dep = requests(target).filter(x=>!x.optional).map(({name})=>`kernel/${name}.ko.gz:`);
  dep.push("kernel/drivers/gpu/drm/amd/amdgpu/amdgpu.ko.gz: kernel/drivers/gpu/drm/ttm/ttm.ko.gz", "kernel/drivers/gpu/drm/ttm/ttm.ko.gz:");
  const result = select({...target,dep:dep.join("\n"),builtin:"",packageName:"test"});
  expect(result.selected).toContain("kernel/drivers/gpu/drm/ttm/ttm.ko.gz");
  expect(result.notes.some(x=>x.includes("i915"))).toBe(true);
});
