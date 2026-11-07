import {test, expect} from "bun:test";
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {runFind} from "../src/find.js";
import {createState, execute, decode} from "../src/shell.js";

async function fixture(fn) {
  const cwd = mkdtempSync(join(tmpdir(), "bunmsh-find-expression-"));
  mkdirSync(join(cwd, "skip"));
  for (const file of ["a.txt", "b.js", "skip/hidden.txt"]) writeFileSync(join(cwd, file), "");
  try { await fn(cwd); } finally { rmSync(cwd, {recursive:true, force:true}); }
}
test("find groups expressions, short circuits actions, and prunes traversal", () => fixture(async cwd => {
  const run = args => runFind(["find", ".", ...args], {cwd});
  expect((await run(["-name","skip","-prune","-o","-type","f","-print"])).stdout).toBe("./a.txt\n./b.js\n");
  expect((await run(["(","-name","*.txt","-o","-name","*.js",")","!","-path","./skip/*"])).stdout).toBe("./a.txt\n./b.js\n");
  expect((await run(["-false","-a","-print","-o","-maxdepth","0","-print0"])).stdout).toBe(".\0");
}));
test("find exec supports constant commands, embedded placeholders and literal plus", () => fixture(async cwd => {
  const calls = [];
  const exec = async args => { calls.push(args); return {status:1,stdout:"",stderr:""}; };
  const run = args => runFind(["find",".","-maxdepth","0",...args],{cwd},process.platform,exec);
  expect((await run(["-exec","echo","constant",";","-o","-print"])).stdout).toBe(".\n");
  expect(calls.pop()).toEqual(["echo","constant"]);
  await run(["-exec","echo","prefix{}suffix","literal","+",";"]);
  expect(calls.pop()).toEqual(["echo","prefix.suffix","literal","+"]);
  expect((await run(["-exec","echo","{}","{}","+"])).status).toBe(2);
  expect(calls).toHaveLength(0);
  expect((await run(["-exec","echo","{}","+"])).status).toBe(1);
  expect(calls.pop()).toEqual(["echo","."]);
}));
test("find rejects invalid expressions before any action", () => fixture(async cwd => {
  for (const args of [["-print","-o"],["(","-print"],["!"],["-name","[z-a]"]]) {
    const chunks=[];
    const out=await runFind(["find",".",...args],{cwd},process.platform,null,text=>chunks.push(text));
    expect(out.status).toBe(2);
    expect(chunks).toEqual([]);
  }
}));
test("find awaits streamed output and leaves captured stdout empty", () => fixture(async cwd => {
  const args=["find",".","-type","f","-print0"];
  const expected=await runFind(args,{cwd});
  const chunks=[];
  const streamed=await runFind(args,{cwd},process.platform,null,async text=>{
    await Bun.sleep(1); chunks.push(text);
  });
  expect(streamed).toEqual({status:0,stdout:"",stderr:""});
  expect(chunks.join("")).toBe(expected.stdout);
}));
test("find capture remains isolated inside a pipeline child", () => fixture(async cwd => {
  const state=createState({cwd,env:{...process.env},args:["bunmsh"]});
  state.pipelineChild=true;
  const out=await execute('printf "<%s>\\n" "$(builtin find . -maxdepth 0)"',state,{capture:true});
  expect(decode(out.stdout)).toBe("<.>\n");
  expect(out.status).toBe(0);
}));
test("find streams through pipes and obeys output redirection", () => fixture(async cwd => {
  const state=createState({cwd,env:{...process.env},args:["bunmsh"]});
  for (const source of [
    "builtin find . -maxdepth 0 | cat",
    "builtin find . -maxdepth 0 > out; cat out",
    "builtin find . -maxdepth 0 1>&2",
  ]) {
    const out=await execute(source,state,{capture:true});
    expect(out.status).toBe(0);
    expect(decode(source.includes("1>&2")?out.stderr:out.stdout)).toBe(".\n");
  }
}));
test("find handles long flat expressions and rejects excessive nesting", () => fixture(async cwd => {
  const flat=await runFind(["find",".","-maxdepth","0",...Array(10000).fill("-true")],{cwd});
  expect(flat).toEqual({status:0,stdout:".\n",stderr:""});
  const nested=await runFind(["find",".",...Array(1000).fill("!"),"-true"],{cwd});
  expect(nested.status).toBe(2);
}));
test("find batches exec paths without losing order", () => fixture(async cwd => {
  const paths=Array(5000).fill(".");
  const calls=[];
  const out=await runFind(["find",...paths,"-maxdepth","0","-exec","echo","{}","+"],{cwd},process.platform,
    async args=>{ calls.push(args.slice(1)); return {status:0,stdout:"",stderr:""}; });
  expect(out.status).toBe(0);
  expect(calls.length).toBeGreaterThan(1);
  expect(calls.flat()).toEqual(paths);
}));
test("find expressions agree with the host find on the same tree", () => fixture(async cwd => {
  const reference=Bun.which("find");
  if (!reference) throw new Error("reference find is required for this comparison");
  for (const args of [
    ["-name","skip","-prune","-o","-type","f","-print"],
    ["(","-name","*.txt","-o","-name","*.js",")","!","-path","./skip/*"],
    ["-false","-a","-print","-o","-maxdepth","0","-print0"],
    ["-maxdepth","0","-exec","echo","constant",";"],
    ["-maxdepth","0","-exec","echo","prefix{}suffix","literal","+",";"],
  ]) {
    const expected=Bun.spawnSync([reference,".",...args],{cwd});
    const actual=await runFind(["find",".",...args],{cwd},process.platform,async command=>{
      const p=Bun.spawnSync(command,{cwd});
      return {status:p.exitCode,stdout:p.stdout,stderr:p.stderr};
    });
    expect({args, status:actual.status}).toEqual({args,status:expected.exitCode});
    expect(actual.stdout.split("\n").sort()).toEqual(expected.stdout.toString().split("\n").sort());
  }
}));
