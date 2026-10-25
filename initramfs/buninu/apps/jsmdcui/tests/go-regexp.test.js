import {test, expect} from 'bun:test';
import {convertGoRegexp} from '../src/highlight/go-regexp.js';
import {SyntaxDefinition,parseHeaderYaml} from '../src/highlight/parser.js';
const regex = s => new RegExp(convertGoRegexp(s), 'u');
test('Go flags apply to the remaining alternatives, preserving precedence', () => {
  const r = regex('^a(?i)b$|^c$');
  expect(r.test('aB')).toBe(true);
  expect(r.test('AB')).toBe(false);
  expect(r.test('C')).toBe(true);
  expect(r.test('aC')).toBe(false);
});
test('flag changes stay inside groups and can be disabled', () => {
  const r = regex('^(a(?i)b|c)d$');
  expect(r.test('aBd')).toBe(true);
  expect(r.test('Cd')).toBe(true);
  expect(r.test('CD')).toBe(false);
  expect(regex('^(?i)a(?-i)b$').test('Ab')).toBe(true);
  expect(regex('^(?i)a(?-i)b$').test('AB')).toBe(false);
  expect(regex('^(?i:a(?-i:b))c$').test('Abc')).toBe(true);
  expect(regex('^(?i:a(?-i:b))c$').test('ABC')).toBe(false);
});
test('capture numbers, scoped flags, escaped literals and class brackets survive', () => {
  expect(regex('^(?i)(a)(b)$').exec('AB').slice(1)).toEqual(['A','B']);
  expect(regex('(?i:a)+').test('AAA')).toBe(true);
  expect(regex('\\(\\?i\\)').test('(?i)')).toBe(true);
  const url = regex('(https?|ftp|ssh)://\\S*[^])>\\s,.]');
  expect(url.exec('https://example.com)')[0]).toBe('https://example.com');
  expect(regex('(?s)^a.b$').test('a\nb')).toBe(true);
  expect(regex('(?m)^b$').test('a\nb\nc')).toBe(true);
  expect(convertGoRegexp('\\bword\\b')).toBe('\\bword\\b');
});
test('all bundled syntax regexes compile, and Dockerfile keywords match', async () => {
  const root = new URL('../runtime/syntax/', import.meta.url).pathname;
  const failures = [];
  function walk(rules, file) {
    for (const r of rules) {
      if (r.type === 'pattern' && !r.regex) failures.push(file+': '+r.source);
      if (r.type === 'region') {
        for (const k of ['start','end','skip']) if (r.source[k] && !r[k]) failures.push(file+': '+r.source[k]);
        walk(r.rules,file);
      }
    }
  }
  for await (const file of new Bun.Glob('*.yaml').scan(root)) {
    const source = Bun.YAML.parse(await Bun.file(root+'/'+file).text());
    const header = parseHeaderYaml(source);
    for (const [key,re] of [['filename','fileNameRegex'],['header','headerRegex'],['signature','signatureRegex']])
      if (header[key] && !header[re]) failures.push(file+': '+key);
    const def = new SyntaxDefinition(header,source);
    walk(def.rules,file);
    if (file === 'dockerfile.yaml') {
      expect(header.matchFileName('/tmp/Dockerfile')).toBe(true);
      const keyword = def.rules.find(r=>r.group==='type.keyword').regex;
      for (const line of ['FROM debian','run echo hi','COPY . /app']) expect(keyword.test(line)).toBe(true);
      expect(keyword.test('FROMAGE debian')).toBe(false);
    }
  }
  expect(failures).toEqual([]);
});
test('mixed and negated POSIX classes retain ASCII Go semantics',()=>{
 expect(regex('^[[:alnum:].%_+-]+@[[:alnum:].-]+$').test('a.b+tag@example.com')).toBe(true);
 expect(regex('^[^[:space:]]+:$').test('Subject:')).toBe(true);
 expect(regex('^[^[:space:]]+:$').test('Bad Header:')).toBe(false);
 expect(regex('^[{[:space:]]-block([[:space:]{}]|$)').test(' -block ')).toBe(true);
 expect(regex('^[x[:space:]]$').test('\t')).toBe(true);
 expect(regex('^[x[:space:]]$').test('\u00a0')).toBe(false);
 expect(regex('^[x[:punct:]]$').test('[')).toBe(true);
 expect(regex('^[x[:punct:]]$').test('A')).toBe(false);
});
test('modifiers are emitted only where flags change',()=>{
 expect(convertGoRegexp('[]a]')).toBe('[\\]a]');
 expect(convertGoRegexp('(?P<x>a)')).toBe('(?<x>a)');
 expect(convertGoRegexp('[[:alpha:]_]')).toBe('[A-Za-z_]');
 expect(convertGoRegexp('(?i)\\b(select|from)\\b')).toBe('(?i:\\b(select|from)\\b)');
 expect(regex('^(?i)a(?-i:b)$').test('Ab')).toBe(true);
 expect(regex('^(?i)a(?-i:b)$').test('AB')).toBe(false);
});

test('converter bounds nested groups without limiting adjacent groups',()=>{
 expect(()=>convertGoRegexp('(?i)'+'('.repeat(50000)+'x'+')'.repeat(50000))).toThrow('nesting exceeds');
 expect(regex('(?i)'+'('.repeat(256)+'x'+')'.repeat(256)).test('X')).toBe(true);
 expect(()=>convertGoRegexp('(?i)'+'(x)'.repeat(50000))).not.toThrow();
});

test('conversion failure disables only its rule and preserves the loaded syntax',async()=>{
 const {loadSyntaxDefinitions}=await import('../src/highlight/parser.js');
 const {Highlighter}=await import('../src/highlight/highlighter.js');
 const deep='(?i)'+'('.repeat(50000)+'x'+')'.repeat(50000);
 const source={filetype:'guarded',detect:{filename:'\\.guarded$'},rules:[{bad:deep},{keyword:'(?i)hello'},{invalid:'['}]};
 const def=new SyntaxDefinition(parseHeaderYaml(source),source);
 expect(def.rules[0].regex).toBeNull();expect(def.rules[2].regex).toBeNull();
 expect(def.rules[1].regex.test('HELLO')).toBe(true);
 const runtime={list:type=>type===1?[{name:'guarded',text:async()=>JSON.stringify(source)}]:[]};
 const defs=await loadSyntaxDefinitions(runtime);
 expect(defs.map(d=>d.filetype)).toEqual(['guarded']);
 expect(defs[0].header.matchFileName('example.guarded')).toBe(true);
 expect(new Highlighter(defs[0],defs).highlightLine('HELLO').changes.get(0)).toBe('keyword');
});
