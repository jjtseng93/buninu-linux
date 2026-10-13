// Record system-tool results separately from the isolated bootstrap runtime:
// node test/utility-reference-cases.mjs OUTPUT.json
// BUNMSH_UTILITY_REFERENCE=/guest/OUTPUT.json bun test test/utility-reference.test.js
import {mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const diff = (name, before, after, args=[]) => ({name, tool:'diff', files:{before,after}, args:[...args,'before','after']});
const sed = (name, script, input, args=[]) => ({name, tool:'sed', files:{script}, args:[...args,'-f','script'], input});
export const cases = [
  ...[
    ['adjacent only', [], 'a\na\nb\na\n'],
    ['count', ['-c'], 'a\na\nb\n'],
    ['repeated', ['-d'], 'a\na\nb\na\n'],
    ['single', ['-u'], 'a\na\nb\na\n'],
    ['count repeated', ['-cd'], 'a\na\nb\n'],
    ['no repeated singles', ['-du'], 'a\na\nb\n'],
    ['empty input', [], ''],
    ['blank lines', [], '\n\nfirst\n\n'],
    ['unterminated duplicate', [], 'a\na'],
    ['unterminated distinct', [], 'a\nb'],
    ['binary NUL', [], 'a\0b\na\0b\na\0c\n'],
    ['file operand', ['--','input'], null],
  ].map(([name,args,input])=>({name,tool:'uniq',args,files:input===null?{input:'a\na\nb\n'}:{},input:input??''})),
  ...[
    ['remove all write bits',0o666,'a-w'],
    ['add user read and write',0o004,'u+rw'],
    ['assign group and other permissions',0o770,'go=rx'],
    ['sequential classes',0o777,'u=rw,g=r,o='],
    ['conditional execute on plain file',0o644,'a+X'],
    ['conditional execute on executable',0o744,'a+X'],
    ['conditional execute after removal',0o755,'a-x,a+X'],
    ['assignment clears file special bits',0o4766,'a=rw'],
    ['multiple operations for one class',0o777,'u+rw-x'],
  ].map(([name,mode,spec])=>({name,tool:'chmod',files:{file:'content'},modes:{file:mode},args:[spec,'--','file']})),
  ...[
    ['identical bytes', 'abc\n', 'abc\n', []],
    ['first differing byte', 'same\nabc\n', 'same\nabX\n', []],
    ['quiet difference', 'abc', 'ab', ['-s']],
    ['shorter file', 'abc', 'abcd', []],
    ['empty file', '', 'abc', []],
    ['binary difference', 'a\0b', 'a\0c', []],
  ].map(([name,before,after,args])=>({name,tool:'cmp',files:{before,after},args:[...args,'--','before','after']})),
  {name:'squeeze spaces without translating s',tool:'tr',files:{},args:['-s',' '],input:'size_t   inbytesleft\n'},
  {name:'translate then squeeze',tool:'tr',files:{},args:['-s','ab','x'],input:'aabbbcaa\n'},
  {name:'delete then squeeze',tool:'tr',files:{},args:['-ds','x','a'],input:'axaxa bbb\n'},
  {name:'delete only',tool:'tr',files:{},args:['-d','x'],input:'axxbbb\n'},
  {name:'squeeze repeated newlines',tool:'tr',files:{},args:['-s','\\n'],input:'a\n\n\nb\n'},
  {name:'literal hyphen set',tool:'tr',files:{},args:['--','-s','XY'],input:'-s-size_t\n'},
  sed("make object extension","s=$[\\(\\{]OBJEXT[\\)\\}]=o=g\n","file.$(OBJEXT) file.${OBJEXT}\n"),
  sed("BRE interior anchors","s/a^b/X/;s/c$d/Y/;s/^z$/Z/\n","a^b c$d\nz\n"),
  {name:'read file after address',tool:'sed',files:{extra:'inserted\n'},args:['/mark/r extra'],input:'before\nmark\nafter\n'},
  {name:'read missing file',tool:'sed',files:{},args:['r missing'],input:'kept\n'},
  {name:'read file with deleted pattern',tool:'sed',files:{extra:'inserted\n'},args:['-n','-e','r extra','-e','d'],input:'one\ntwo\n'},
  diff('identical','a\nb\n','a\nb\n'),
  diff('middle insertion','a\nb\nc\n','a\nx\nb\nc\n'),
  diff('separated insertions','a\nb\nc\nd\n','a\nx\nb\nc\ny\nd\n'),
  diff('separated deletions','a\nx\nb\nc\ny\nd\n','a\nb\nc\nd\n'),
  diff('insertion then replacement','a\nb\nc\nd\ne\n','a\nx\nb\nc\nD\ne\n'),
  diff('repeated lines','a\nsame\nsame\nz\n','a\nsame\nnew\nsame\nz\n'),
  diff('empty left','','added\n'), diff('empty right','deleted\n',''),
  diff('missing final newline','a\n','a'), diff('both missing final newline','old','new'),
  diff('Chinese','前\n後\n','前\n中\n後\n'),
  diff('CRLF','a\r\nb\r\n','a\r\nx\r\nb\r\n'),
  diff('brief difference','a\n','b\n',['-q']),
  sed('file script and branch','s/a/b/\nt done\n:done\np\n','a\n',['-n']),
  sed('address range','2,3p\n','one\ntwo\nthree\nfour\n',['-n']),
  sed('inverted address','/skip/!p\n','keep\nskip\nkeep again\n',['-n']),
  sed('hold exchange','1h\n2{x;p;}\n','first\nsecond\n',['-n']),
  sed('hold append','1h\n2{H;g;p;}\n','first\nsecond\n',['-n']),
  sed('multiline N','N;s/\n/:/;p\n'.replace('s/\n','s/\\n'),'first\nsecond\n',['-n']),
  sed('branch loop',':again\ns/aa/a/\nt again\np\n','aaaa\n',['-n']),
  sed('translation','y/abc/ABC/\n','abc cab\n'),
  sed('escaped delimiter','s|a\\|b|X|g\n','a|b a|b\n'),
  sed('backreference','s/\\(ab\\)/[\\1]/g\n','abab\n'),
  sed('missing input newline','s/a/b/\n','a'),
  {name:'attached -f',tool:'sed',files:{script:'s/a/b/\n'},args:['-fscript'],input:'a\n'},
];
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Output JSON path required');
  const root=mkdtempSync(join(tmpdir(),'bunmsh-system-reference-'));
  try {
    const results=cases.map((c,index) => {
      const cwd=join(root,String(index)); mkdirSync(cwd);
      for (const [name,content] of Object.entries(c.files)) {
        mkdirSync(dirname(join(cwd,name)),{recursive:true});writeFileSync(join(cwd,name),content);
      }
      for (const [name,mode] of Object.entries(c.modes??{})) chmodSync(join(cwd,name),mode);
      const r=spawnSync(`/usr/bin/${c.tool}`,c.args,{cwd,input:c.input??'',encoding:'utf8',env:{...process.env,LC_ALL:'C'}});
      if (r.error || r.signal || r.status===null) throw r.error??new Error(`Reference failed: ${c.name}`);
      return {...c,expected:{status:r.status,stdout:r.stdout,stderr:r.stderr,...(c.modes?{modes:Object.fromEntries(Object.keys(c.modes).map(name=>[name,statSync(join(cwd,name)).mode&0o7777]))}:{})}};
    });
    const versions=Object.fromEntries(['diff','sed','tr','cmp','chmod','uniq'].map(tool=>[tool,spawnSync(`/usr/bin/${tool}`,['--version'],{encoding:'utf8'}).stdout.split('\n')[0]]));
    writeFileSync(process.argv[2],JSON.stringify({versions,cases:results},null,2)+'\n');
    console.log(JSON.stringify({versions,cases:results.length}));
  } finally {rmSync(root,{recursive:true,force:true});}
}
