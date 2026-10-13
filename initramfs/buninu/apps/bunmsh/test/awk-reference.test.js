import {test,expect} from 'bun:test';
import {compileAwk,executeAwk} from '../src/awk.js';
const reference=process.env.BUNMSH_AWK_REFERENCE;
const cases=[
 ['fields','{print NF, $1, $2, NR, FNR}','a 2\nb 3\n'],
 ['sum','{sum+=$2} END {print sum}','a 2\nb 3\n'],
 ['precedence','BEGIN {print 1+2*3, -2^2, (2^3)^2, (2+3)*4}',''],
 ['division','BEGIN {x=10; print x/2, x%3; x/=2; print x}',''],
 ['postfix fields','{i=1; print $i++; print i, $0}','4 5\n'],
 ['scalar type','BEGIN {print (x==0), (x==""), ("0" ? 1 : 2), ("10" < 2)}',''],
 ['input type','{print ($1 ? 1 : 2), ($1 < 2)}','0\n10\n'],
 ['array','BEGIN {a["x"]=3; a["y"]=4; for(k in a)s+=a[k]; delete a["x"]; print s, ("x" in a), ("y" in a)}',''],
 ['subscript','BEGIN {a[1,2]=7; print a[1,2]}',''],
 ['loop','BEGIN {for(i=0;i<4;i++){if(i==2)continue;s+=i;} print s; while(s>2)s--; do s++; while(s<5); print s}',''],
 ['function','function f(x) {if(x<=1)return 1;return x*f(x-1)} BEGIN {print f(5)}',''],
 ['regex','/yes/ {print} !/yes/ {print "no:" $0}','yes\nother\n'],
 ['range','/start/,/end/ {print}','omit\nstart\ninside\nend\nomit\n'],
 ['sub and gsub','{n=gsub(/a/,"[&]");sub(/b/,"B");print n, $0}','aaba\n'],
 ['split','BEGIN {n=split("a:b:c",a,":");print n,a[2];n=split(" ab  cd ",a," ");print n,a[1],a[2]}',''],
 ['match','BEGIN {print match("abc123",/[0-9]+/),RSTART,RLENGTH; print match("abc",/z/),RSTART,RLENGTH}',''],
 ['strings','BEGIN {print substr("abcdef",2,3), index("abc","b"), length("abc"), toupper("Ab"), tolower("Ab")}',''],
 ['format','BEGIN {printf "%s:%03d:%.2f:%x\\n", "x", 4, 2.5, 255}',''],
 ['change fields','{OFS=":";$2="X";print $0;NF=4;print $0;NF=1;print $0}','a b c\n'],
 ['change record','{$0="new fields";print NF,$1,$2}','old\n'],
 ['flow','{if(NR==2)next;print; if(NR==3)exit 4} END {print "end"}','a\nb\nc\nd\n'],
 ['escaped regex','/a\\/b/ {print}','a/b\na b\n'],
 ['BEGIN END','BEGIN {print "begin"} END {print "end"}',''],
];
if(!reference)test.skip('awk reference (set BUNMSH_AWK_REFERENCE)',()=>{});
for(const [name,source,input] of reference?cases:[])test(`awk reference: ${name}`,async()=>{
 const p=Bun.spawn([reference,source],{stdin:Buffer.from(input),stdout:'pipe',stderr:'pipe',env:{...process.env,LC_ALL:'C'}});
 const [status,stdout,stderr]=await Promise.all([p.exited,new Response(p.stdout).text(),new Response(p.stderr).text()]);
 const actual=executeAwk(compileAwk(source),[{name:'-',text:input}]);
 expect({...actual,stderr:''}).toEqual({status,stdout,stderr});
});
