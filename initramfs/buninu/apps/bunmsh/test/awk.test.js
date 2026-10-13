import {test,expect} from 'bun:test';
import {compileAwk,executeAwk} from '../src/awk.js';
import {createState,execute,decode} from '../src/shell.js';
const run=(s,text='',options={})=>executeAwk(compileAwk(s),[{name:'-',text}],options);
test('awk parenthesized print lists and continued argument lists',()=>{
 expect(run('BEGIN {printf("%s:%d\\n",\n "x", 7); print (2,\n 3); print (2+3)*4, (4>3)}').stdout).toBe('x:7\n2 3\n20 1\n');
});
test('awk scalar parameters shadow global arrays and callers do not supply scope',()=>{
 expect(run('function inner(x) {return x} function outer(flags) {return inner(flags)} function global() {return x} function caller(x) {return global()} BEGIN {flags[0]="global"; x=9; print outer("local"), caller(2)}').stdout).toBe('local 9\n');
});
test('awk substitution preserves backslashes before ordinary replacement characters',()=>{
 expect(run(String.raw`BEGIN {x="C++"; gsub("\\+", "\\+", x); print x; print ("C++" ~ x)}`).stdout).toBe('C\\+\\+\n1\n');
});
test('awk output pipes share input until close, return status and can reopen',async()=>{
 const r=await execute(`builtin awk 'BEGIN {print "a" | "builtin cat 1>&2"; print "b" | "builtin cat 1>&2"; print close("builtin cat 1>&2"); print "c" | "builtin cat 1>&2"; print close("exit 7")}'`,createState(),{capture:true});
 expect(r.status).toBe(0);expect(decode(r.stdout)).toBe('0\n0\n');expect(decode(r.stderr)).toBe('a\nb\nc\n');
 const p=await execute(`builtin awk 'BEGIN {print "x" | "builtin cat >/dev/null; exit 7"; print close("builtin cat >/dev/null; exit 7")}'`,createState(),{capture:true});
 expect(p.status).toBe(0);expect(decode(p.stdout)).toBe('7\n');
});
test('awk fields, counters, arithmetic and END',()=>{
 expect(run('{sum += $2; print NR, $1} END {print sum}', 'apple 2\npear 3\n').stdout).toBe('1 apple\n2 pear\n5\n');
});
test('awk arrays, numeric loops, for-in, membership and deletion',()=>{
 expect(run('BEGIN {a["x"]=4; a["y"]=5; for(k in a) sum+=a[k]; delete a["x"]; for(i=0;i<3;i++) sum++; print sum, ("x" in a), ("y" in a)}').stdout).toBe('12 0 1\n');
});
test('awk regex, substitutions, split, fields and printf',()=>{
 expect(run('/yes/ {gsub(/yes/,"Y"); n=split($0,a,":"); printf "%s:%d\\n", a[1], n}', 'no\nyes:yes\n').stdout).toBe('Y:2\n');
 expect(run('BEGIN {print substr("abcdef",2,3), index("abc","b"), length("abc")}').stdout).toBe('bcd 2 3\n');
});
test('awk functions, conditionals and flow',()=>{
 expect(run('function twice(x) {return x*2} {if ($1=="skip") next; print twice($1)} END {print "end"}', '3\nskip\n4\n').stdout).toBe('6\n8\nend\n');
});
test('awk Autoconf substitutions preserve inserted values',()=>{
 const source=`BEGIN {S["CC"]="tcc"; S["FLAGS"]="-O2"; for(key in S) S_is_set[key]=1; FS="\\007"}
 {line=$0; nfields=split(line,field,"@"); len=length(field[1]); for(i=2;i<nfields;i++){key=field[i]; keylen=length(key); if(S_is_set[key]){value=S[key]; line=substr(line,1,len) "" value "" substr(line,len+keylen+3); len+=length(value)+length(field[++i]);}else len+=1+keylen;} print line}`;
 expect(run(source,'cc=@CC@ flags=@FLAGS@ keep=@UNKNOWN@\n').stdout).toBe('cc=tcc flags=-O2 keep=@UNKNOWN@\n');
});
test('awk getline from a file and file output',()=>{
 const writes=[];
 const r=run('BEGIN {while((getline x < "file")>0) print x > "out"; close("file"); print "done"}', '',{readFile:()=> 'a\nb\n',writeFile:(...a)=>writes.push(a)});
 expect(r.stdout).toBe('done\n');expect(writes).toEqual([['out','a\n',false],['out','b\n',true]]);
});
test('awk builtin handles piped input without a native awk',async()=>{
 const r=await execute("printf 'a 2\\nb 3\\n' | builtin awk '{sum += $2} END {print sum}'",createState(),{capture:true});
 expect(r.status).toBe(0);expect(decode(r.stdout)).toBe('5\n');expect(decode(r.stderr)).toBe('');
});

test('awk exponentiation is right associative (mawk reference)',()=>{
 // Host mawk 1.3.4 returns 512. BusyBox 1.36.1 returns 64 for this case.
 expect(run('BEGIN {print 2^3^2}').stdout).toBe('512\n');
});
test('awk builtin parses field separators and numeric -v assignments',async()=>{
 const r=await execute("printf 'a:3\n' | builtin awk -F: -v limit=10 '{print $2, (limit < 2)}'",createState(),{capture:true});
 expect(r.status).toBe(0);expect(decode(r.stdout)).toBe('3 0\n');expect(decode(r.stderr)).toBe('');
});

test('awk quoted operator strings remain concatenation operands',()=>{
 expect(run('BEGIN {print "x" "/" "y", "a" "+" "b", 3/2, "in", "}", ";", "(", "++"}').stdout)
  .toBe('x/y a+b 1.5 in } ; ( ++\n');
 const install='BEGIN {files["."]=""; dirs["."]=1} {d=$3; if(dirs[d]!=1){print "d",d; dirs[d]=1} if($2==$4) files[d]=files[d] " " $1; else {print "f",$3 "/" $4,$1}} END {for(d in files) print "f",d,files[d]}';
 expect(run(install,'ld-new ld-new . ld.bfd\n').stdout).toBe('f ./ld.bfd ld-new\nf . \n');
});
