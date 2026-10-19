import {test,expect} from "bun:test";
import {mkdtempSync,mkdirSync,writeFileSync,existsSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {requests,select} from "../scripts/modules.js";
import {config} from "../scripts/arch.js";
import {fetchGpuFirmware,gpuReady} from "../scripts/fetch-gpu.js";
const additions=new Set(["virtio-gpu","vmwgfx","i915","xe","amdgpu","radeon","nouveau"]);
test("no-gpu only removes new explicit requests across target configurations",()=>{
 for(const arch of ["x86_64","aarch64"])for(const flavor of ["lts","virt"])for(const real of [true,false]){
   const cfg={arch,flavor,real};
   expect(requests({...cfg,noGpu:true})).toEqual(requests(cfg).filter(r=>!additions.has(r.name)));
 }
 expect(config({noGpu:true}).noGpu).toBe(true);
});
test("no-gpu retains a GPU-directory dependency when an original module needs it",()=>{
 const cfg={arch:"x86_64",flavor:"lts",real:false,noGpu:true};
 const dep=requests(cfg).map(({name})=>`kernel/test/${name}.ko.gz:${name==="snd-hda-intel"?" kernel/drivers/gpu/drm/shared.ko.gz":""}`).join("\n")+"\nkernel/drivers/gpu/drm/shared.ko.gz:";
 expect(select({...cfg,dep,builtin:"",packageName:"test"}).selected).toContain("kernel/drivers/gpu/drm/shared.ko.gz");
});
test("no-gpu clears generated firmware and caches cannot cross GPU modes",async()=>{
 const root=mkdtempSync(join(tmpdir(),"no-gpu-"));
 try{
   const cfg={...config({arch:"x86_64",flavor:"lts",real:true,noGpu:true}),nativeDir:root,modulesRoot:join(root,"modules")};
   mkdirSync(cfg.modulesRoot,{recursive:true});
   writeFileSync(join(cfg.modulesRoot,"modules.dep"),"");
   writeFileSync(join(cfg.modulesRoot,"modules.builtin"),"kernel/drivers/gpu/drm/i915/i915.ko\n");
   mkdirSync(join(root,"lib/firmware"),{recursive:true});
   writeFileSync(join(root,"lib/firmware/stale"),"old firmware");
   await fetchGpuFirmware(cfg);
   expect(existsSync(join(root,"lib/firmware"))).toBe(false);
   expect(gpuReady(cfg)).toBe(true);
   expect(gpuReady({...cfg,noGpu:false})).toBe(false);
   mkdirSync(join(root,"lib/firmware"));
   expect(gpuReady(cfg)).toBe(false);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test("launcher documents no-gpu and rejects it without fetch/build",()=>{
 const help=Bun.spawnSync([process.execPath,"index.js","--help"]);
 expect(help.exitCode).toBe(0);expect(help.stdout.toString()).toContain("--no-gpu");
 const invalid=Bun.spawnSync([process.execPath,"index.js","-r","--no-gpu"]);
 expect(invalid.exitCode).not.toBe(0);expect(invalid.stderr.toString()).toContain("only make sense");
});
