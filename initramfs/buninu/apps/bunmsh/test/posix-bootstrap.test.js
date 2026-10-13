import { test, expect } from "bun:test";
import { createState, execute, finishShell } from "../src/shell.js";
import {mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, chmodSync, utimesSync, statSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

const decode = (value) => new TextDecoder().decode(value);
test('external stderr duplication reaches pipelines without losing buffered output',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'bunmsh-pipe-stderr-'));
 try {
  const script=join(dir,'writer.js');writeFileSync(script,'process.stdout.write("out\\n");process.stderr.write("Thread model: posix\\n");');
  const cmd=`'${process.execPath}' '${script}'`;
  const r=await run(`${cmd} 2>&1 | builtin sed -n 's/^Thread model: //p'`);
  expect(r.stdout).toBe('posix\n');expect(r.stderr).toBe('');expect(r.status).toBe(0);
  const both=await run(`${cmd} 2>&1 | builtin cat`);expect(both.stdout.split('\n').filter(Boolean).sort()).toEqual(['Thread model: posix','out']);expect(both.stderr).toBe('');
  const moved=await run(`${cmd} 2>&1 > '${dir}/out' | builtin cat`);expect(moved.stdout).toBe('Thread model: posix\n');expect(readFileSync(join(dir,'out'),'utf8')).toBe('out\n');
  const away=await run(`${cmd} 1>&2 | builtin cat`);expect(away.stdout).toBe('');expect(away.stderr).toContain('out\n');expect(away.stderr).toContain('Thread model: posix\n');
  writeFileSync(script,'process.on("SIGPIPE",()=>process.exit(0));while(true){process.stdout.write("out\\n");process.stderr.write("err\\n");await Bun.sleep(1);}');
  const early=await run(`${cmd} 2>&1 | builtin head -n 1`);expect(early.status).toBe(0);expect(['out\n','err\n']).toContain(early.stdout);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('cp -p preserves regular file contents, mode and timestamps without truncating itself',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'bunmsh-cp-p-'));
 try {
  const source=join(dir,'source'),target=join(dir,'target');writeFileSync(source,'preserved\n');chmodSync(source,0o640);utimesSync(source,1234567890,1234567891);
  const r=await run(`builtin cp -p '${source}' '${target}'`);
  expect(r.status).toBe(0);expect(r.stderr).toBe('');
  const st=statSync(target);expect(st.mode&0o777).toBe(0o640);expect(st.atimeMs).toBe(1234567890000);expect(st.mtimeMs).toBe(1234567891000);expect(readFileSync(target,'utf8')).toBe('preserved\n');
  const same=await run(`builtin cp -p '${source}' '${source}'`);expect(same.status).toBe(1);expect(readFileSync(source,'utf8')).toBe('preserved\n');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('if negation applies to its pipeline rather than the entire AND/OR list',async()=>{
 const r=await run('if ! false && false; then echo BAD; else echo and-ok; fi; if ! true || true; then echo or-ok; fi; if ! true; then echo BAD; elif ! false; then echo elif-ok; fi; if ! false | false; then echo pipe-ok; fi');
 expect(r.status).toBe(0);expect(r.stdout).toBe('and-ok\nor-ok\nelif-ok\npipe-ok\n');expect(r.stderr).toBe('');
});
async function run(source) {
  const state = createState();
  const value = await execute(source, state, {capture:true});
  const final = await finishShell(state,state.exitRequested ? state.exitStatus : value.status,{capture:true});
  return {status:final.status, stdout:decode(value.stdout)+decode(final.stdout), stderr:decode(value.stderr)+decode(final.stderr), state};
}
test("POSIX function bodies allow inline and newline opening braces", async () => {
  const r = await run('a () { echo a; }\nb ()\n{\n a\n}\nb');
  expect(r.stdout).toBe('a\n'); expect(r.stderr).toBe(''); expect(r.status).toBe(0);
});
test("return crosses conditionals and restores function arguments", async () => {
  const r = await run('f () { if true; then echo "$1"; return 7; fi; echo BAD; }\nset -- outer\nf inner\necho "$? $1"');
  expect(r.stdout).toBe('inner\n7 outer\n'); expect(r.stderr).toBe('');
});
test("break and continue unwind exactly the requested loop levels", async () => {
  const r = await run('for i in a b; do for j in 1 2; do echo "$i$j"; continue 2; done; echo BAD; done\nfor i in a b; do for j in 1 2; do echo "$i$j"; break 2; done; echo BAD; done\necho done');
  expect(r.stdout).toBe('a1\nb1\na1\ndone\n'); expect(r.stderr).toBe('');
});
test("brace groups preserve state and stream into a pipeline", async () => {
  const r = await run('{ x=kept; }\necho "$x"\n{ echo a; echo b; } | cat');
  expect(r.stdout).toBe('kept\na\nb\n'); expect(r.stderr).toBe('');
});
test("groups short circuit and preserve variable changes through redirects", async () => {
  const r = await run('false && { echo BAD; }\ntrue && { x=yes; }\n{ { echo hidden; } >/dev/null; x=kept; }\necho "$x"');
  expect(r.stdout).toBe('kept\n'); expect(r.stderr).toBe('');
});
test("persistent descriptors duplicate, close, and restore command redirects", async () => {
  const dir = mkdtempSync(join(tmpdir(),'bunmsh-fds-'));
  try {
    const log = join(dir,'log');
    const r = await run(`exec 5>'${log}'\necho first >&5\n{ echo second; x=kept; } >&5\necho "$x"\nexec 6>&5\nexec 5>&-\necho third >&6\nexec 6>&-`);
    expect(r.stdout).toBe('kept\n'); expect(r.stderr).toBe('');
    expect(readFileSync(log,'utf8')).toBe('first\nsecond\nthird\n');
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
test("redirect order snapshots the original stdout and truncates null commands", async () => {
  const dir = mkdtempSync(join(tmpdir(),'bunmsh-io-order-'));
  try {
    const path = join(dir,'out');
    const cmd = `'${process.execPath}' -e 'console.log("out");console.error("err")'`;
    let r = await run(`${cmd} 2>&1 >'${path}'`);
    expect(r.stdout).toBe('err\n'); expect(r.stderr).toBe('');
    expect(readFileSync(path,'utf8')).toBe('out\n');
    r = await run(`${cmd} >'${path}' 2>&1`);
    expect(r.stdout).toBe(''); expect(r.stderr).toBe('');
    expect(readFileSync(path,'utf8')).toBe('out\nerr\n');
    await run(`>'${path}'`);
    expect(readFileSync(path,'utf8')).toBe('');
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
test("errexit is suppressed in conditions, negation and tested functions", async () => {
  let r = await run('set -e\nfalse\necho BAD');
  expect(r.status).toBe(1); expect(r.stdout).toBe('');
  r = await run('set -e\nf () { false; echo allowed; }\nif f; then echo yes; fi\nfalse && echo BAD\n! true\necho done');
  expect(r.stdout).toBe('allowed\nyes\ndone\n'); expect(r.stderr).toBe('');
  r = await run('set -e\nf () { false; echo BAD; }\nf\necho BAD');
  expect(r.stdout).toBe(''); expect(r.status).toBe(1);
});
test("EXIT traps preserve status, run once, and allow an explicit override", async () => {
  let r = await run("trap 'echo status=$?' 0\nexit 7");
  expect(r.stdout).toBe('status=7\n'); expect(r.status).toBe(7);
  r = await run("trap 'echo once; exit 9' EXIT\nexit 7");
  expect(r.stdout).toBe('once\n'); expect(r.status).toBe(9);
  r = await run("trap 'echo BAD' 0\ntrap - 0\necho ok");
  expect(r.stdout).toBe('ok\n'); expect(r.stderr).toBe('');
});
test("source returns without exiting its caller", async () => {
  const dir = mkdtempSync(join(tmpdir(),'bunmsh-source-return-'));
  try {
    const path=join(dir,'source'); writeFileSync(path,'echo "$1"\nreturn 8\necho BAD\n');
    const r=await run(`set -- outer\n. '${path}' inner\necho "$? $1"`);
    expect(r.stdout).toBe('inner\n8 outer\n'); expect(r.stderr).toBe('');
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
test("descriptor inheritance reaches external children and subshells", async () => {
  const dir = mkdtempSync(join(tmpdir(),'bunmsh-inherit-'));
  try {
    const path=join(dir,'log');
    const r=await run(`exec 5>'${path}'\n'${process.execPath}' -e 'require("fs").writeSync(5,"external\\n")'\n(echo subshell >&5)\necho done`);
    expect(r.stdout).toBe('done\n'); expect(r.stderr).toBe('');
    expect(readFileSync(path,'utf8')).toBe('external\nsubshell\n');
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
test("signal traps defer execution and preserve the interrupted status", async () => {
  const state = createState();
  const before=process.listenerCount('SIGUSR1');
  try {
    await execute("trap 'echo caught=$?' USR1",state,{capture:true});
    state.lastStatus=7;
    process.emit('SIGUSR1');
    expect(state.lastStatus).toBe(7);
    const r=await execute('echo after=$?',state,{capture:true});
    expect(decode(r.stdout)).toBe('caught=7\nafter=7\n');
  } finally { await finishShell(state,0,{capture:true}); }
  expect(process.listenerCount('SIGUSR1')).toBe(before);
});
test("noglob and nounset preserve explicit parameter defaults", async () => {
  let r = await run('set -f\necho *\nset -u\necho "${BOOTSTRAP_UNSET_TEST-default}"\necho "$BOOTSTRAP_UNSET_TEST"\necho BAD');
  expect(r.stdout).toBe('*\ndefault\n'); expect(r.status).toBe(1);
  expect(r.stderr).toContain('parameter not set');
});
test("background registry keeps original objects and completed indices", async () => {
  const previous=Bun.sha.procs;
  Bun.sha.procs=[];
  try {
    const r=await run(`'${process.execPath}' -e 'await Bun.sleep(40)' &`);
    expect(r.status).toBe(0);
    const proc=Bun.sha.procs[0];
    expect(typeof proc.kill).toBe('function');
    await proc.exited;
    await run(`'${process.execPath}' -e 'await Bun.sleep(40)' &`);
    expect(Bun.sha.procs).toHaveLength(2);
    expect(Bun.sha.procs[0]).toBe(proc);
    await Bun.sha.procs[1].exited;
  } finally { Bun.sha.procs=previous; }
});
test("redirected compound pipelines keep their streams and variable scope", async () => {
  const dir = mkdtempSync(join(tmpdir(),'bunmsh-group-pipe-'));
  try {
    const path=join(dir,'out');
    const r=await run(`{ printf hello | cat; x=kept; } >'${path}'\necho "$x"\ncat '${path}'\n(cat '${path}') >'${path}.copy'`);
    expect(r.stdout).toBe('kept\nhello'); expect(r.stderr).toBe('');
    expect(readFileSync(path+'.copy','utf8')).toBe('hello');
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
test("multiline pipelines and Autoconf-shaped nested groups parse completely", async () => {
  const r=await run('case arm in arm)\n{ x=ok\n { { echo "$x"; } >/dev/null\n echo kept; }; }\n;; esac\necho pipe |\ncat');
  expect(r.stdout).toBe('kept\npipe\n'); expect(r.stderr).toBe('');
});
test("exec can retain a descriptor from a temporarily redirected group", async () => {
  const dir = mkdtempSync(join(tmpdir(),'bunmsh-retained-fd-'));
  try {
    const path=join(dir,'out');
    const r=await run(`{ exec 6>&1; echo inside; } >'${path}'\necho outside >&6\necho terminal`);
    expect(r.stdout).toBe('terminal\n'); expect(r.stderr).toBe('');
    expect(readFileSync(path,'utf8')).toBe('inside\noutside\n');
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
test("fd numbers are recognized only at unquoted token boundaries", async () => {
  const dir = mkdtempSync(join(tmpdir(),'bunmsh-io-number-'));
  try {
    const path=join(dir,'out');
    const r=await run(`echo word2>'${path}'\ncat '${path}'`);
    expect(r.stdout).toBe('word2\n'); expect(r.stderr).toBe('');
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
test("parameter operands retain quoted argument boundaries and empty arguments", async () => {
  let r = await run('set -- "one two" "" "*"\nprintf "<%s>\\n" ${1+"$@"}\nprintf "<%s>\\n" pre"$@"post');
  expect(r.stdout).toBe('<one two>\n<>\n<*>\n<preone two>\n<>\n<*post>\n'); expect(r.stderr).toBe('');
  r = await run('set --\nfor x in ${1+"$@"} "$@"; do echo BAD; done\nprintf "<%s>\\n" ${missing:-"a b"} ${missing:-${other:-"c d"}}');
  expect(r.stdout).toBe('<a b>\n<c d>\n'); expect(r.stderr).toBe('');
});
test("LINENO uses physical source lines through compound normalization", async () => {
  const r = await run('echo "$LINENO"\nif true; then echo "$LINENO"; fi\n# comment\necho "$LINENO"\nf () {\n echo "$LINENO"\n}\nf');
  expect(r.stdout).toBe('1\n2\n4\n6\n'); expect(r.stderr).toBe('');
});
test("command substitutions capture stdout inside redirected groups", async () => {
  const dir=mkdtempSync(join(tmpdir(),'bunmsh-substitution-'));
  try {
    const path=join(dir,'log');
    const r=await run(`{ x=$(printf kept); echo "$x"; } >'${path}'\necho "$x"`);
    expect(r.stdout).toBe('kept\n'); expect(readFileSync(path,'utf8')).toBe('kept\n'); expect(r.stderr).toBe('');
  } finally {rmSync(dir,{recursive:true,force:true});}
});
test("nested compound conditions do not terminate at an inner then", async () => {
  const r=await run('f () {\n if { if true; then echo inner; fi; } && { test x = x; }\n then echo outer\n else echo BAD\n fi\n}\nf\n(\necho subshell\n) | cat');
  expect(r.stdout).toBe('inner\nouter\nsubshell\n'); expect(r.stderr).toBe('');
});
test("large function state survives pipeline subprocess transport", async () => {
  const r=await run(`f () {\n : '${'padding'.repeat(1000)}'\n echo function\n}\nf | cat`);
  expect(r.stdout).toBe('function\n'); expect(r.stderr).toBe(''); expect(r.status).toBe(0);
});
test("expr supports BRE captures, arithmetic precedence and exit statuses", async () => {
  const r=await run("expr 2 + 3 \\* 4\nexpr 00001 : '.*\\(...\\)'\nexpr '' \\| fallback\nexpr a : z\necho $?");
  expect(r.stdout).toBe('14\n001\nfallback\n0\n1\n'); expect(r.stderr).toBe('');
});
test("sed handles delimiters, branches, hold space and multiline pattern space", async () => {
  let r=await run("printf 'a;b\\nc\\n' | sed -n 's/;/!/; t changed; b; :changed; h; n; G; p'");
  expect(r.stdout).toBe('c\na!b\n'); expect(r.stderr).toBe('');
  r=await run("printf 'a\\nb\\nc\\n' | sed -n '1,2{N;s/\\n/:/;p;}'");
  expect(r.stdout).toBe('a:b\n'); expect(r.stderr).toBe('');
});
test("only posix mode removes ls icons and survives pipeline state transfer", async () => {
  const dir=mkdtempSync(join(tmpdir(),'bunmsh-posix-ls-'));
  try {
    const path=join(dir,'file'); writeFileSync(path,'x');
    const r=await run(`ls '${path}'\nset -o posix\nls '${path}' | cat\nlsfancy '${path}'\nset +o posix\nls '${path}'`);
    expect(r.stdout).toBe(`📄 ${path}\n${path}\n📄 ${path}\n📄 ${path}\n`); expect(r.stderr).toBe('');
    const options=await run('set -o\nset -o posix\necho "flags=$-"\nset +o');
    expect(options.stdout).toContain('posix off\n'); expect(options.stdout).toContain('flags=\n'); expect(options.stdout).toContain('set -o posix\n');
  } finally {rmSync(dir,{recursive:true,force:true});}
});
test("LINENO retains original lines in nested case arms", async () => {
  const r=await run('echo "$LINENO"\ncase x in\nx)\n case y in y)\n echo "$LINENO"\n ;; esac\n ;;\nesac\necho "$LINENO"');
  expect(r.stdout).toBe('1\n5\n9\n'); expect(r.stderr).toBe('');
});
test("posix isolates external environments while default mode exports all values", async () => {
  const child=`'${process.execPath}' -e 'console.log([process.env.BUNMSH_PRIVATE??"missing",process.env.BUNMSH_PUBLIC??"missing"].join("/"))'`;
  const r=await run(`unset BUNMSH_PRIVATE BUNMSH_PUBLIC\nBUNMSH_PRIVATE=private\nBUNMSH_PUBLIC=public\n${child}\nset -o posix\nexport BUNMSH_PUBLIC\n${child}\nBUNMSH_PRIVATE=temporary ${child}\necho "$BUNMSH_PRIVATE"\nunset BUNMSH_PUBLIC\nBUNMSH_PUBLIC=unexported\n${child}\nset +o posix\n${child}`);
  expect(r.stdout).toBe('private/public\nmissing/public\ntemporary/public\nprivate\nmissing/missing\nprivate/unexported\n'); expect(r.stderr).toBe('');
});
test("posix subshells retain private values without exporting them to grandchildren", async () => {
  const child=`'${process.execPath}' -e 'console.log(process.env.BUNMSH_PRIVATE??"missing")'`;
  const r=await run(`set -o posix\nunset BUNMSH_PRIVATE\nBUNMSH_PRIVATE='${'x'.repeat(6000)}'\nf () { printf "%s\\n" "\${#BUNMSH_PRIVATE}"; ${child}; }\nf | cat\n(f)\nprintf '%s\\n' "$(f)"`);
  expect(r.stdout).toBe('6000\nmissing\n6000\nmissing\n6000\nmissing\n'); expect(r.stderr).toBe('');
});
test("posix env assignments and export attributes survive mode toggles", async () => {
  const r=await run('unset BUNMSH_PRIVATE BUNMSH_PUBLIC\nBUNMSH_PRIVATE=hidden\nexport BUNMSH_PUBLIC=shown\nset -o posix\nenv -i BUNMSH_PRIVATE=explicit\nexport -p\nset +o posix\nset -o posix\nenv');
  expect(r.stdout).toContain('BUNMSH_PRIVATE=explicit\n');
  expect(r.stdout).not.toContain('BUNMSH_PRIVATE=hidden');
  expect(r.stdout).toContain('BUNMSH_PUBLIC=shown\n'); expect(r.stderr).toBe('');
});
test("Autoconf detects and enables posix from multiline option output", async () => {
  const r=await run('case `(set -o) 2>/dev/null` in *posix*) set -o posix;; esac\nset -o');
  expect(r.stdout).toContain('posix on\n'); expect(r.stderr).toBe('');
});
test("rm force accepts no operands and a pipeline can feed a compound case", async () => {
  const r=await run('rm -f && rm -fr && rm -rf\nprintf hello | case x in x) cat;; esac');
  expect(r.stdout).toBe('hello'); expect(r.stderr).toBe(''); expect(r.status).toBe(0);
});
test("subshell rewriting leaves C parentheses in heredocs untouched", async () => {
  const r=await run("ac_ext=c\ncat <<EOF\nint main (void)\n{ return 0; }\nEOF");
  expect(r.stdout).toBe('int main (void)\n{ return 0; }\n'); expect(r.stderr).toBe('');
});
test("grep accepts multiple explicit patterns and counts selected lines", async () => {
  const r=await run("printf 'apple\\npear\\napricot\\n' | grep -e '^a' -e 'pear'\nprintf 'a\\nb\\na\\n' | grep -c -e '^a$'");
  expect(r.stdout).toBe('apple\npear\napricot\n2\n'); expect(r.stderr).toBe('');
});
test("sed reads scripts from a file", async () => {
  const dir=mkdtempSync(join(tmpdir(),'bunmsh-sed-file-'));
  try {
    const path=join(dir,'script'); writeFileSync(path,'s/a/b/\nt done\n:done\np\n');
    const r=await run(`printf 'a\\n' | sed -n -f '${path}'`);
    expect(r.stdout).toBe('b\n'); expect(r.stderr).toBe('');
  } finally {rmSync(dir,{recursive:true,force:true});}
});
test("diff distinguishes identical, changed, and inaccessible files", async () => {
  const dir=mkdtempSync(join(tmpdir(),'bunmsh-diff-'));
  try {
    const a=join(dir,'a'),b=join(dir,'b'); writeFileSync(a,'same\nold\n'); writeFileSync(b,'same\nnew\n');
    let r=await run(`diff '${a}' '${a}'`); expect(r.status).toBe(0); expect(r.stdout).toBe('');
    r=await run(`diff '${a}' '${b}'`); expect(r.status).toBe(1); expect(r.stdout).toBe('2c2\n< old\n---\n> new\n');
    r=await run(`diff '${a}' '${b}.missing'`); expect(r.status).toBe(2);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
test("diff aligns separated insertions, deletions, repeated lines and final newlines", async () => {
  const dir=mkdtempSync(join(tmpdir(),'bunmsh-diff-align-'));
  try {
    const a=join(dir,'a'), b=join(dir,'b');
    const cases=[
      ['a\nb\nc\nd\n','a\nnew\nb\nc\nmore\nd\n','1a2\n> new\n3a5\n> more\n'],
      ['a\nnew\nb\nc\nmore\nd\n','a\nb\nc\nd\n','2d1\n< new\n5d3\n< more\n'],
      ['a\nb\nc\nd\ne\n','a\nx\nb\nc\nD\ne\n','1a2\n> x\n4c5\n< d\n---\n> D\n'],
      ['a\nsame\nsame\nz\n','a\nsame\nnew\nsame\nz\n','2a3\n> new\n'],
      ['', 'new\n', '0a1\n> new\n'],
      ['old\n', '', '1d0\n< old\n'],
      ['a\n', 'a', '1c1\n< a\n---\n> a\n\\ No newline at end of file\n'],
      ['前\n後\n', '前\n中\n後\n', '1a2\n> 中\n'],
    ];
    for (const [before,after,expected] of cases) {
      writeFileSync(a,before); writeFileSync(b,after);
      const r=await run(`diff '${a}' '${b}'`);
      expect(r.status).toBe(1); expect(r.stderr).toBe(''); expect(r.stdout).toBe(expected);
    }
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test("arithmetic expands Autoconf positional expressions and nested substitutions", async () => {
  const r=await run('as_fn_arith () { as_val=$(( $* )); }\nas_fn_arith 10 + 1\necho "$as_val"\nx=3\necho "$(( ${x} + $(echo 2) + $((1 + 1)) ))"');
  expect(r.status).toBe(0); expect(r.stdout).toBe('11\n7\n'); expect(r.stderr).toBe('');
});
test("compound pipelines retain multiline quoted command operands", async () => {
  for (const first of ["(printf 'hello\\n')", "case x in x) printf 'hello\\n';; esac", "{ printf 'hello\\n'; }"]) {
    for (const separator of [" ", "\n"]) {
    const r=await run(`${first} |${separator}sed '\n s/hello/world/\n '\necho after`);
    expect(r.status).toBe(0);expect(r.stdout).toBe('world\nafter\n');expect(r.stderr).toBe('');
    }
  }
});

test("heredoc bodies do not terminate a pending logical connector", async () => {
  const r=await run("cat <<EOF ||\nhello\nEOF\necho BAD\ncat <<EOF &&\nworld\nEOF\necho after");
  expect(r.status).toBe(0);expect(r.stdout).toBe('hello\nworld\nafter\n');expect(r.stderr).toBe('');
});
test("ASCII control characters survive quoted expansion and heredocs", async () => {
  const literal=String.fromCharCode(1,2,3,4,5,6,7);
  const r=await run(`x='${literal}'\nprintf '%s' "$x"\ncat <<EOF\n${literal}\nEOF`);
  expect(r.stdout).toBe(literal+literal+'\n');expect(r.stderr).toBe('');
});

test("pipelines preserve redirected compound operands and logical suffixes", async () => {
  const dir=mkdtempSync(join(tmpdir(),'bunmsh-compound-source-'));
  try {
    const file=join(dir,'out');
    const r=await run(`printf 'hello\\n' |\nif true; then\n cat\nelse\n echo BAD\nfi >'${file}' || echo ERROR\ncat '${file}'`);
    expect(r.status).toBe(0);expect(r.stdout).toBe('hello\n');expect(r.stderr).toBe('');
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test("compound parsing preserves quoted backslash newlines", async () => {
  const value="a\\\nb";
  const r=await run(`if true; then\n printf '%s\\n' '${value}'\n cat <<'EOF'\n${value}\nEOF\n echo a\\\nb\nfi`);
  expect(r.status).toBe(0);expect(r.stdout).toBe(value+'\n'+value+'\nab\n');expect(r.stderr).toBe('');
});

test("case terminators remain intact after nested groups", async () => {
  const r=await run(`x='none needed'
case $x in #(
 'cannot detect') { { echo BAD; }; echo BAD; } ;; #(
 'none needed') x='' ;; #(
 *) x=BAD ;;
esac
printf '<%s>\\n' "$x"`);
  expect(r.status).toBe(0);expect(r.stdout).toBe('<>\n');expect(r.stderr).toBe('');
});

test("parameter trimming uses shell bracket patterns and quoted literals", async () => {
  const source="w='$(am_make_OBJECTS)'\nw=${w#\\$[\\(\\{]}\nprintf '%s\\n' \"${w%[\\)\\}]}\"\nlo='${LIBOBJDIR}alloca.o'\nprintf '%s\\n' \"${lo#'${LIBOBJDIR}'}\"\nx='*abc123'\nprintf '%s\\n' \"${x#'*'}\" \"${x%%[0-9]*}\" \"${x%[0-9]*}\"\nx=abc\nprintf '%s\\n' \"${x##[a-c]*}\"";
  const r=await run(source);
  expect(r.status).toBe(0);expect(r.stderr).toBe('');
  expect(r.stdout).toBe('am_make_OBJECTS\nalloca.o\nabc123\n*abc\n*abc12\n\n');
});

test("subshell state is captured after preceding commands in the same list", async () => {
  const r=await run("x=old; x=new; (printf '%s\\n' \"$x\"); printf '%s\\n' \"$x\"");
  expect(r.status).toBe(0);expect(r.stdout).toBe('new\nnew\n');expect(r.stderr).toBe('');
});

test("subshell transport does not leak into later external shells", async () => {
  const r=await run("(true); printf '<%s>\\n' \"${BUNMSH_INTERNAL_PIPELINE_STATE-unset}\"");
  expect(r.status).toBe(0);expect(r.stdout).toBe('<unset>\n');expect(r.stderr).toBe('');
});

test("continued recipe lists retain compound keyword boundaries", async () => {
  const r=await run("fail=; \\\nif (target_option=k; test \"$target_option\" = k); then \\\n  echo yes; \\\nelse \\\n  echo no; \\\nfi\n");
  expect(r.status).toBe(0);expect(r.stdout).toBe("yes\n");expect(r.stderr).toBe("");
});

test("continued recipe function headers start a separate compound node", async () => {
  const r=await run("x=old; \\\nf () \\\n{ \\\n  x=new; echo \"$x\"; \\\n}; \\\nf\n");
  expect(r.status).toBe(0);expect(r.stdout).toBe("new\n");expect(r.stderr).toBe("");
});

test("print accepts Autoconf combined raw/no-newline flags", async () => {
  const r=await run("print -rn -- 'a\\nb'; print -r -- end");
  expect(r.status).toBe(0);expect(r.stdout).toBe('a\\nbend\n');expect(r.stderr).toBe('');
});

test("compound bodies preserve multiline parameter expansion words", async () => {
  const r = await run('if true; then { echo "${missing-first\nsecond}"; }; fi');
  expect(r.status).toBe(0); expect(r.stderr).toBe('');
  expect(r.stdout).toBe('first\nsecond\n');
});

test("legacy egrep and fgrep names use builtin grep modes", async () => {
  const r = await run("printf 'alpha\\nbeta\\na+b\\n' | builtin egrep 'alpha|beta'; printf 'ab\\na+b\\n' | builtin fgrep 'a+b'");
  expect(r.status).toBe(0); expect(r.stderr).toBe('');
  expect(r.stdout).toBe('alpha\nbeta\na+b\n');
});

test("mv option delimiter protects filenames beginning with hyphens", async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'bunmsh-mv-'));
  try {
    writeFileSync(join(cwd, '-f'), 'kept');
    const r = await execute('builtin mv -f -- -f --target', createState({cwd}), {capture:true});
    expect(r.status).toBe(0); expect(decode(r.stderr)).toBe('');
    expect(readFileSync(join(cwd, '--target'), 'utf8')).toBe('kept');
  } finally { rmSync(cwd, {recursive:true, force:true}); }
});

test("rm option delimiter removes option-looking filenames and preserves force with no operands", async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'bunmsh-rm-'));
  try {
    for (const name of ['-f', '--', 'unchanged']) writeFileSync(join(cwd, name), 'data');
    const r = await execute('builtin rm -f -- -f -- unchanged; builtin rm -f --', createState({cwd}), {capture:true});
    expect(r.status).toBe(0); expect(decode(r.stderr)).toBe('');
    for (const name of ['-f', '--', 'unchanged']) expect(existsSync(join(cwd, name))).toBe(false);
  } finally { rmSync(cwd, {recursive:true, force:true}); }
});

test("read preserves a persistent input descriptor and its shared offset", async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'bunmsh-read-fd-'));
  try {
    writeFileSync(join(cwd, 'input'), 'first\nsecond\n第三\ntail');
    const r = await execute('exec 5<&0 <input; read a; exec 6<&0; builtin read b; command read c <&6; read d; last=$?; exec 0<&5 5<&- 6<&-; printf "%s|%s|%s|%s|%s\\n" "$a" "$b" "$c" "$d" "$last"', createState({cwd}), {capture:true});
    expect(r.status).toBe(0); expect(decode(r.stderr)).toBe('');
    expect(decode(r.stdout)).toBe('first|second|第三|tail|1\n');
  } finally { rmSync(cwd, {recursive:true, force:true}); }
});

test("parameter lengths include positional parameters used by libtool", async () => {
  const r = await run('set -- abc "" 3 4 5 6 7 8 9 tenth; printf "%s %s %s %s\\n" "${#1}" "${#2}" "${#10}" "${##}"');
  expect(r.status).toBe(0); expect(r.stderr).toBe('');
  expect(r.stdout).toBe('3 0 5 2\n');
});

test("comments between logical operators and compounds preserve short circuiting", async () => {
  const r = await run('true ||\n\n# fallback\n{ echo BAD; }\nfalse &&\n# skipped\n{ echo BAD; }\nfalse ||\n# needed\n{ echo fallback; }\ntrue &&\n# needed\n{ echo success; }');
  expect(r.status).toBe(0); expect(r.stderr).toBe('');
  expect(r.stdout).toBe('fallback\nsuccess\n');
});

test("compound pipelines can include simple stages before a trailing loop", async () => {
  const r = await run('for x in one two; do echo "$x"; done | builtin cat | while read x; do echo "<$x>"; done');
  expect(r.status).toBe(0); expect(r.stderr).toBe('');
  expect(r.stdout).toBe('<one>\n<two>\n');
});

test("compound AND and OR lists retain left associativity", async () => {
  const r = await run('{ false; } && true || { echo fallback; }\n{ true; } || false && { echo success; }');
  expect(r.status).toBe(0); expect(r.stderr).toBe('');
  expect(r.stdout).toBe('fallback\nsuccess\n');
});

test("backquotes remove their escape layer before inner shell quoting", async () => {
  const source = 'paths="/lib /usr/lib"; value=`' + String.raw`echo $paths | builtin sed -e 's/\([^ ][^ ]*\)/SEARCH_DIR(\\"\1\\");/g'` + '`; printf "%s\\n" "$value"';
  const r = await run(source);
  expect(r.status).toBe(0); expect(r.stderr).toBe('');
  expect(r.stdout).toBe('SEARCH_DIR("/lib"); SEARCH_DIR("/usr/lib");\n');
});

test("backquote escaping respects enclosing double quotes and unrelated escapes", async () => {
  const body = String.raw`printf '%s' '\"'`;
  const unquoted = await run('value=`' + body + '`; printf "%s\\n" "$value"');
  const quoted = await run('value="`' + body + '`"; printf "%s\\n" "$value"');
  expect(unquoted.status).toBe(0); expect(unquoted.stderr).toBe('');
  expect(unquoted.stdout).toBe('\\' + '"\n');
  expect(quoted.status).toBe(0); expect(quoted.stderr).toBe('');
  expect(quoted.stdout).toBe('"\n');
  const special = await run('value=`' + String.raw`printf '%s' '\$name|\q'` + '`; printf "%s\\n" "$value"');
  expect(special.status).toBe(0); expect(special.stderr).toBe('');
  expect(special.stdout).toBe('$name|\\q\n');
});

test("compound producer pipelines honor enclosing descriptor redirects", async () => {
  const cwd=mkdtempSync(join(tmpdir(),'bunmsh-compound-fd-'));
  try {
    const r=await execute('exec 5>log; { for x in b a; do echo "$x"; done | sort; } >&5; exec 5>&-',createState({cwd}),{capture:true});
    expect(r.status).toBe(0); expect(decode(r.stdout)).toBe(''); expect(decode(r.stderr)).toBe('');
    expect(readFileSync(join(cwd,'log'),'utf8')).toBe('a\nb\n');
  } finally {rmSync(cwd,{recursive:true,force:true});}
});

test("else comments remain branch syntax rather than commands", async () => {
  const r=await run('if true; then echo yes; else # all_targets is true\n echo BAD; fi\nif false; then echo BAD; else # other branch\n echo no; fi');
  expect(r.status).toBe(0); expect(r.stderr).toBe('');
  expect(r.stdout).toBe('yes\nno\n');
});

test("while and until accept comments after done", async () => {
  const r=await run('while true; do echo while; break; done # argument parsing loop\nuntil false; do echo until; break; done # another loop\necho after');
  expect(r.status).toBe(0); expect(r.stderr).toBe('');
  expect(r.stdout).toBe('while\nuntil\nafter\n');
});


test("subshell case clauses do not close at the first pattern parenthesis", async () => {
  const r = await run(String.raw`ac_try='./conftest'
(case "(($ac_try" in
  *\"* | *\`* | *\\*) ac_try_echo=\$ac_try;;
  *) ac_try_echo=$ac_try;;
esac
printf '%s\n' "$ac_try_echo")
( case x in x) echo spaced;; esac )
((case x in x) echo nested;; esac))`);
  expect(r.stderr).toBe('');
  expect(r.status).toBe(0);
  expect(r.stdout).toBe('./conftest\nspaced\nnested\n');
});


test("uniq supports output files and rejects unsupported options", async () => {
  const dir = mkdtempSync(join(tmpdir(),'bunmsh-uniq-'));
  try {
    writeFileSync(join(dir,'input'),'a\na\nb');
    const r=await run(`uniq '${dir}/input' '${dir}/output'`);
    expect(r.status).toBe(0); expect(r.stdout).toBe('');
    expect(readFileSync(join(dir,'output'),'utf8')).toBe('a\nb\n');
    expect((await run('uniq -z')).status).toBe(1);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
test("rm force ignores empty filenames while still deleting real operands", async () => {
  const dir = mkdtempSync(join(tmpdir(),'bunmsh-rm-empty-'));
  try {
    writeFileSync(join(dir,'file'),'delete');
    const r=await run(`rm -f ''\nrm -f -- '' '${dir}/file'`);
    expect(r.status).toBe(0); expect(r.stderr).toBe('');
    expect(existsSync(dir)).toBe(true); expect(existsSync(join(dir,'file'))).toBe(false);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});


test("set minus consumes the delimiter, ends options and preserves bare-call args", async () => {
  const r=await run(`set -- kept two
set -
printf '%s:%s:%s\\n' "$#" "$1" "$2"
set - first -e
printf '%s:%s:%s\\n' "$#" "$1" "$2"
IFS='%'
set - /one%two%three
IFS=' '
printf '%s:%s:%s:%s\\n' "$#" "$1" "$2" "$3"`);
  expect(r.status).toBe(0); expect(r.stderr).toBe('');
  expect(r.stdout).toBe('2:kept:two\n2:first:-e\n1:/one%two%three::\n');
  const state=createState({shellOptions:{x:true,v:true,e:true}});
  await execute('set -',state,{capture:true});
  expect(state.shellOptions.x).toBe(false);expect(state.shellOptions.v).toBe(false);
  expect(state.shellOptions.e).toBe(true);
  const split=await run(`dstdir='/one/two/three'
IFS='%'
set - $(echo "$dstdir" | sed 's@/@%@g;s@^%@/@')
IFS=' '
printf '%s:%s:%s:%s\\n' "$#" "$1" "$2" "$3"`);
  expect(split.stdout).toBe('3:/one:two:three\n'); expect(split.status).toBe(0);
});


test("backquoted brace groups are not parsed as parameter expansions", async () => {
  const tick=String.fromCharCode(96);
  const r=await run('if false; then echo BAD; elif test "X'+tick+'{ echo ok; }'+tick+'" = Xok; then echo yes; fi\nx='+tick+'{ echo assigned; }'+tick+'\necho "$x"');
  expect(r.status).toBe(0); expect(r.stderr).toBe('');
  expect(r.stdout).toBe('yes\nassigned\n');
});


test("logical connectors retain heredoc bodies before compound operands", async () => {
  const dir=mkdtempSync(join(tmpdir(),'bunmsh-heredoc-chain-'));
  try {
    const r=await run(`if true; then
 echo 'BEGIN {' >'${dir}/script' &&
 cat >>'${dir}/script' <<'ONE' &&
S["name"]="value"
ONE
 cat >>'${dir}/script' <<TWO &&
}
TWO
 if true; then cat '${dir}/script'; fi
fi`);
    expect(r.status).toBe(0); expect(r.stderr).toBe('');
    expect(r.stdout).toBe('BEGIN {\nS["name"]="value"\n}\n');
    const piped=await run(`{ echo first; } | cat <<END &&
second
END
{ echo last; }`);
    expect(piped.status).toBe(0); expect(piped.stderr).toBe('');
    expect(piped.stdout).toBe('second\nlast\n');
  } finally { rmSync(dir,{recursive:true,force:true}); }
});


test("mkdir processes parent and child operands in order", async () => {
  const cwd=mkdtempSync(join(tmpdir(),'bunmsh-mkdir-order-'));
  try {
    for(let i=0;i<8;i++) {
      const r=await execute(`builtin mkdir p${i} p${i}/child p${i}/child/grandchild`,createState({cwd}),{capture:true});
      expect(r.status).toBe(0); expect(decode(r.stderr)).toBe('');
      expect(existsSync(join(cwd,`p${i}/child/grandchild`))).toBe(true);
    }
  } finally { rmSync(cwd,{recursive:true,force:true}); }
});
