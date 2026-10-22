import {afterAll, expect, test} from 'bun:test';
import {mkdtempSync,writeFileSync,symlinkSync,rmSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {browserTarget,parseOpenArgs} from '../initramfs/lib/xdg-open.js';
const dir=mkdtempSync(join(tmpdir(),'buninu-xdg-open-'));
afterAll(()=>rmSync(dir,{recursive:true,force:true}));
const file=join(dir,'中文 # %.html');writeFileSync(file,'<p>test</p>');
symlinkSync(file,join(dir,'alias.html'));
test('HTTP and HTTPS remain browser URLs',()=>{
 expect(browserTarget('https://buninu.org/path?q=one#two')).toBe('https://buninu.org/path?q=one#two');
 expect(browserTarget('http://localhost:8080')).toBe('http://localhost:8080/');
 expect(()=>browserTarget('http://')).toThrow();
});
test('local files resolve symlinks and escape URL-special characters',()=>{
 expect(browserTarget('alias.html',dir)).toBe(pathToFileURL(file).href);
 expect(browserTarget(pathToFileURL(file).href)).toBe(pathToFileURL(file).href);
 expect(()=>browserTarget('missing',dir)).toThrow();
 expect(()=>browserTarget(dir)).toThrow('regular file');
 expect(()=>browserTarget('javascript:alert(1)')).toThrow('Unsupported');
 expect(()=>browserTarget('mailto:test@example.com')).toThrow('Unsupported');
});
test('argument validation',()=>{
 expect(parseOpenArgs(['--help'])).toEqual({help:true});
 expect(()=>parseOpenArgs([])).toThrow('Usage');
 expect(()=>parseOpenArgs(['a','b'])).toThrow('Usage');
});
test('launcher passes a single URL argument to a new bunterm and maps launch failure to status 4',async()=>{
 const stub=join(dir,'bunterm');writeFileSync(stub,`#!${process.execPath}\nconsole.log(JSON.stringify(process.argv.slice(2)));process.exit(7);`);chmodSync(stub,0o755);
 const browser=join(dir,'buninu-browser');writeFileSync(browser,'#!/bin/sh\nexit 0');chmodSync(browser,0o755);
 const url='https://example.test/?q=$(touch%20bad)&x=1';
 const p=Bun.spawn([process.execPath,new URL('../initramfs/bin/xdg-open',import.meta.url).pathname,url],{env:{...process.env,PATH:dir+':'+process.env.PATH},stdout:'pipe',stderr:'pipe'});
 expect(await p.exited).toBe(4);
 expect(JSON.parse(await new Response(p.stdout).text())).toEqual(['-e','buninu-browser',url]);
 expect(await new Response(p.stderr).text()).toBe('');
});

test('about URLs pass through; Markdown remains a browser file URL',()=>{
 for(const url of ['about:blank','about:audio','about:custom?x=1#part'])
  expect(browserTarget(url)).toBe(url);
 const markdown=join(dir,'note.md');writeFileSync(markdown,'# Note');
 expect(browserTarget(markdown)).toBe(pathToFileURL(markdown).href);
});

test('manual aliases, version and standard failure codes work through the command',async()=>{
 const run=async args=>{const p=Bun.spawn([process.execPath,new URL('../initramfs/bin/xdg-open',import.meta.url).pathname,...args],{env:{...process.env,PATH:'/nonexistent'},stdout:'pipe',stderr:'pipe'});return {code:await p.exited,out:await new Response(p.stdout).text()}};
 for(const flag of ['-h','--help','--manual']){const r=await run([flag]);expect(r.code).toBe(0);expect(r.out).toContain('Exit codes');}
 const v=await run(['--version']);expect(v.code).toBe(0);expect(v.out).toContain('xdg-open (Buninu Linux)');
 expect((await run([])).code).toBe(1);
 expect((await run(['http://'])).code).toBe(1);
 expect((await run([join(dir,'absent')])).code).toBe(2);
 expect((await run(['https://buninu.org'])).code).toBe(3);
 expect((await run(['mailto:a@example.com'])).code).toBe(4);
});
