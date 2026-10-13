// A tree-walking AWK interpreter. Shell input is data, never JavaScript source.
class InputString {
  constructor(text) { this.text=String(text); this.numeric=/^[ \t]*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?[ \t]*$/.test(this.text); }
}
const str=v=>v instanceof InputString?v.text:v==null?'':String(v);
const num=v=>parseFloat(str(v))||0;
const numeric=v=>typeof v==='number'||v instanceof InputString&&v.numeric;
const truth=v=>numeric(v)?num(v)!==0:str(v)!=='';
const unset=new InputString(''); unset.numeric=true;
const failure=m=>{throw new Error(`awk: ${m}`);};
function regex(s,flags='') {
  s=str(s).replaceAll('[[:space:]]','[\\s]').replaceAll('[[:digit:]]','[0-9]').replaceAll('[[:alnum:]]','[A-Za-z0-9]').replaceAll('[[:alpha:]]','[A-Za-z]').replaceAll('[[:blank:]]','[ \t]');
  try {return new RegExp(s,flags);}catch(error){failure(`invalid regular expression ${JSON.stringify(s)}: ${error.message}`);}
}
function lex(source) {
  const out=[];let i=0,operand=true;
  const push=(kind,value)=>{out.push({kind,value});operand=!(kind==='number'||kind==='string'||kind==='regex'||kind==='name'&&!['print','printf','return','exit','getline','in','delete'].includes(value)||[')',']','++','--'].includes(value));};
  while(i<source.length) {
    const c=source[i];
    if(c==='\\'&&source[i+1]==='\n'){i+=2;continue;}
    if(/[ \t\r]/.test(c)){i++;continue;}
    if(c==='#'){while(i<source.length&&source[i]!=='\n')i++;continue;}
    if(c==='\n'){if(!(out.at(-1)?.kind==='op'&&[',','&&','||'].includes(out.at(-1).value)))push('op',';');i++;continue;}
    if(c==='"'||c==='/'&&operand){
      const delim=c;let value='';i++;let closed=false;
      while(i<source.length){const ch=source[i++];if(ch===delim){closed=true;break;}
        if(ch==='\\') {if(i>=source.length)break;const n=source[i++];
          if(n==='\n')continue;
          if(delim==='/'){value+=n==='/'?'/':'\\'+n;continue;}
          if(/[0-7]/.test(n)){let oct=n;while(oct.length<3&&/[0-7]/.test(source[i]??''))oct+=source[i++];value+=String.fromCharCode(parseInt(oct,8));}
          else value+=({n:'\n',t:'\t',r:'\r',b:'\b',f:'\f',v:'\v',a:'\x07','\\':'\\','"':'"','/':'/'})[n]??n;
        }else value+=ch;
      }
      if(!closed)failure('unterminated '+(delim==='/'?'regular expression':'string'));
      push(delim==='/'?'regex':'string',value);continue;
    }
    const number=/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(source.slice(i));
    if(number){push('number',Number(number[0]));i+=number[0].length;continue;}
    const name=/^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(i));
    if(name){push('name',name[0]);i+=name[0].length;continue;}
    const op=/^(?:\+\+|--|\+=|-=|\*=|\/=|%=|\^=|==|!=|<=|>=|!~|&&|\|\||>>|[{}()[\],;?:$+*\/%^<>=!~|\-])/.exec(source.slice(i));
    if(!op)failure(`unexpected character ${JSON.stringify(c)}`);
    push('op',op[0]);i+=op[0].length;
  }
  out.push({kind:'eof',value:'<eof>'});return out;
}
export function compileAwk(source) {
  const tokens=lex(source);let i=0;
  // Quoted strings and regex literals are operands even when their contents
  // happen to spell an operator, separator, or keyword.
  const peek=()=>['string','regex'].includes(tokens[i].kind)?null:tokens[i].value, take=()=>tokens[i++], eat=v=>peek()===v?(i++,true):false;
  const need=v=>{if(!eat(v))failure(`expected ${v}, got ${peek()}`);};
  const separators=()=>{while(eat(';'));};
  const prec={'=':1,'+=':1,'-=':1,'*=':1,'/=':1,'%=':1,'^=':1,'?':2,'||':3,'&&':4,'in':5,'~':5,'!~':5,'==':6,'!=':6,'<':6,'>':6,'<=':6,'>=':6,'concat':7,'+':8,'-':8,'*':9,'/':9,'%':9,'^':11};
  const begins=t=>['number','string','regex'].includes(t.kind)||t.kind==='name'&&!['in','else'].includes(t.value)||['(','$'].includes(t.value);
  function expr(min=0,stopRedirect=false) {
    let t=take(),node;
    if(t.kind==='number'||t.kind==='string')node={type:'literal',value:t.value};
    else if(t.kind==='regex')node={type:'regex',value:t.value};
    else if(t.value==='('){const values=[expr()];while(eat(','))values.push(expr());need(')');node=values.length===1?values[0]:{type:'list',values};}
    else if(['!','+','-','++','--','$'].includes(t.value))node={type:t.value==='$'?'field':'unary',op:t.value,value:expr(t.value==='$'?13:10)};
    else if(t.value==='getline'){
      let target=null;if(tokens[i].kind==='name'||peek()==='$')target=expr(12);
      let file=null;if(eat('<'))file=expr(7);
      node={type:'getline',target,file};
    }
    else if(t.kind==='name'){
      node={type:'variable',name:t.value};
      if(eat('(')){const args=[];if(peek()!==')')do{args.push(expr());}while(eat(','));need(')');node={type:'call',name:t.value,args};}
      else if(eat('[')){const keys=[];do{keys.push(expr());}while(eat(','));need(']');node={type:'index',name:t.value,keys};}
    }else failure(`expected expression, got ${t.value}`);
    while(true){let op=peek();
      if(['++','--'].includes(op)){if(12<min)break;i++;node={type:'postfix',op,value:node};continue;}
      if(stopRedirect&&['>','>>','|'].includes(op))break;
      let implicit=false;if(prec[op]===undefined&&begins(tokens[i])){op='concat';implicit=true;}
      const p=prec[op];if(p===undefined||p<min)break;
      if(!implicit)i++;
      if(op==='?'){const yes=expr();need(':');node={type:'conditional',condition:node,yes,no:expr(p)};continue;}
      const right=expr(p+(p===1||op==='^'?0:1),stopRedirect);node={type:p===1?'assign':'binary',op,left:node,right};
    }
    return node;
  }
  function statement(){separators();
    if(eat('{')){const body=[];separators();while(peek()!=='}'){if(tokens[i].kind==='eof')failure('unterminated block');body.push(statement());separators();}need('}');return {type:'block',body};}
    if(eat('if')){need('(');const condition=expr();need(')');const yes=statement();separators();return {type:'if',condition,yes,no:eat('else')?statement():null};}
    if(eat('while')){need('(');const condition=expr();need(')');return {type:'while',condition,body:statement()};}
    if(eat('do')){const body=statement();separators();need('while');need('(');const condition=expr();need(')');return {type:'do',body,condition};}
    if(eat('for')){need('(');const initial=peek()===';'?null:expr();
      if(initial?.type==='binary'&&initial.op==='in'&&eat(')'))return {type:'forin',initial,body:statement()};
      need(';');const condition=peek()===';'?null:expr();need(';');const increment=peek()===')'?null:expr();need(')');return {type:'for',initial,condition,increment,body:statement()};}
    if(['break','continue','next','nextfile','exit','return'].includes(peek())){const op=take().value;const value=['exit','return'].includes(op)&&![';','}','<eof>'].includes(peek())?expr():null;return {type:'flow',op,value};}
    if(eat('delete'))return {type:'delete',value:expr(12)};
    if(peek()==='print'||peek()==='printf'){
      const op=take().value,args=[];
      if(![';','}','<eof>','>','>>','|'].includes(peek()))do{const value=expr(0,true);args.push(...(value.type==='list'?value.values:[value]));}while(eat(','));
      let redirect=null;if(['>','>>','|'].includes(peek()))redirect={op:take().value,file:expr()};
      return {type:'print',op,args,redirect};
    }
    return {type:'expression',value:expr()};
  }
  const program={begin:[],end:[],rules:[],functions:new Map()};separators();
  while(tokens[i].kind!=='eof'){
    if(eat('function')){const name=take();if(name.kind!=='name')failure('expected function name');need('(');const params=[];if(peek()!==')')do{const p=take();if(p.kind!=='name')failure('expected parameter');params.push(p.value);}while(eat(','));need(')');program.functions.set(name.value,{params,body:statement()});}
    else if(peek()==='BEGIN'||peek()==='END'){const kind=take().value.toLowerCase();separators();if(peek()!=='{')failure(`${kind} requires a block`);program[kind].push(statement());}
    else {let pattern=null,until=null;if(peek()!=='{'){pattern=expr();if(eat(','))until=expr();}
      const action=peek()==='{'?statement():{type:'print',op:'print',args:[]};program.rules.push({pattern,until,action});}
    separators();
  }
  return program;
}

export function executeAwk(program, inputs, options={}) {
  const vars=new Map(Object.entries({FS:' ',OFS:' ',ORS:'\n',RS:'\n',SUBSEP:'\x1c',CONVFMT:'%.6g',OFMT:'%.6g',NR:0,FNR:0,NF:0,FILENAME:'',RSTART:0,RLENGTH:-1,...Object.fromEntries(Object.entries(options.variables??{}).map(([k,v])=>[k,new InputString(v)]))}));
  const arrays=new Map(),locals=[];let record='',fields=[],output='',flow=null,status=0,seed=1,inputIndex=0,recordIndex=0,records=[];
  const readers=new Map(),written=new Set(),ranges=new Map(),pipes=new Map();
  let stderr='';
  function closePipe(command) {
    if(!pipes.has(command))return 0;
    const text=pipes.get(command);pipes.delete(command);
    if(!options.runPipe)failure('output pipes require a shell adapter');
    const p=options.runPipe(command,text);output+=p.stdout??'';stderr+=p.stderr??'';
    return p.status;
  }
  const array=name=>{if(locals.at(-1)?.get(name) instanceof Map)return locals.at(-1).get(name);if(!arrays.has(name))arrays.set(name,new Map());return arrays.get(name);};
  array('ARGV').set('0','awk');(options.argv??[]).forEach((v,i)=>array('ARGV').set(String(i+1),v));vars.set('ARGC',(options.argv??[]).length+1);
  for(const [k,v] of Object.entries(options.env??{}))array('ENVIRON').set(k,new InputString(v));
  const get=name=>{if(locals.at(-1)?.has(name))return locals.at(-1).get(name);return vars.get(name)??unset;};
  const set=(name,value)=>{if(name==='NF'){const n=Math.trunc(num(value));if(n<0)failure('negative NF');fields.length=n;for(let i=0;i<n;i++)fields[i]??=new InputString('');record=fields.map(str).join(str(get('OFS')));}
    if(locals.at(-1)?.has(name)){locals.at(-1).set(name,value);return value;}vars.set(name,value);return value;};
  function split(text,sep){text=str(text);sep=str(sep);if(sep===' ')return text.trim()?text.trim().split(/\s+/):[];if(sep==='')return [...text];return text===''?[]:text.split(sep.length===1?sep:regex(sep));}
  function setRecord(text){record=str(text);fields=split(record,get('FS')).map(x=>new InputString(x));vars.set('NF',fields.length);}
  function ref(node){if(node.type==='variable')return {get:()=>get(node.name),set:v=>set(node.name,v)};
    if(node.type==='index'){const a=array(node.name),k=node.keys.map(x=>str(evaluate(x))).join(str(get('SUBSEP')));return {get:()=>a.get(k)??unset,set:v=>(a.set(k,v),v),remove:()=>a.delete(k)};}
    if(node.type==='field'){const n=Math.trunc(num(evaluate(node.value)));if(n<0)failure('negative field');return {get:()=>n===0?new InputString(record):fields[n-1]??new InputString(''),set:v=>{if(n===0)setRecord(v);else{while(fields.length<n)fields.push(new InputString(''));fields[n-1]=v;vars.set('NF',fields.length);record=fields.map(str).join(str(get('OFS')));}return v;}};}
    failure('expression is not assignable');}
  const pattern=node=>node.type==='regex'?node.value:str(evaluate(node));
  function sprintf(format,args){let at=0;return str(format).replace(/%([-+ #0]*)(\d*)(?:\.(\d+))?([%csdiouxXeEfFgG])/g,(all,flags,width,precision,kind)=>{
    if(kind==='%')return '%';const value=args[at++];let s;
    if(kind==='s')s=str(value).slice(0,precision===undefined?undefined:Number(precision));
    else if(kind==='c')s=numeric(value)?String.fromCharCode(num(value)):str(value).slice(0,1);
    else if(/[diouxX]/.test(kind)){let n=Math.trunc(num(value));if(kind==='u')n>>>=0;s=n.toString(kind==='o'?8:/[xX]/.test(kind)?16:10);if(kind==='X')s=s.toUpperCase();}
    else {const n=num(value),p=precision===undefined?6:Number(precision);s=/f/i.test(kind)?n.toFixed(p):/e/i.test(kind)?n.toExponential(p):String(Number(n.toPrecision(p||1)));if(kind===kind.toUpperCase())s=s.toUpperCase();}
    if(flags.includes('+')&&num(value)>=0&&kind!=='s')s='+'+s;
    return flags.includes('-')?s.padEnd(Number(width),' '):s.padStart(Number(width),flags.includes('0')?'0':' ');
  });}
  function nextRecord(){while(recordIndex>=records.length){if(inputIndex>=inputs.length)return null;const entry=inputs[inputIndex++];if(entry.assignment){set(entry.assignment[0],new InputString(entry.assignment[1]));continue;}vars.set('FILENAME',entry.name);vars.set('FNR',0);const text=entry.text;const rs=str(get('RS'));records=rs===''?text.replace(/^\n+|\n+$/g,'').split(/\n\n+/):text.split(rs.length===1?rs:regex(rs));if(records.at(-1)==='')records.pop();recordIndex=0;}
    vars.set('NR',num(get('NR'))+1);vars.set('FNR',num(get('FNR'))+1);return records[recordIndex++];}
  function call(node){const {name,args}=node;
    if(name==='split'){const values=split(evaluate(args[0]),args[2]?pattern(args[2]):get('FS'));if(args[1]?.type!=='variable')failure('split requires array name');const a=array(args[1].name);a.clear();values.forEach((v,i)=>a.set(String(i+1),new InputString(v)));return values.length;}
    if(name==='sub'||name==='gsub'){const re=regex(pattern(args[0]),name==='gsub'?'g':'');const replacement=str(evaluate(args[1]));const target=args[2]?ref(args[2]):{get:()=>record,set:setRecord};let count=0;
      const text=str(target.get()).replace(re,match=>{count++;let s='';for(let i=0;i<replacement.length;i++){if(replacement[i]==='\\'&&i+1<replacement.length&&['&','\\'].includes(replacement[i+1]))s+=replacement[++i];else s+=replacement[i]==='&'?match:replacement[i];}return s;});target.set(text);return count;}
    if(name==='match'){const s=str(evaluate(args[0])),m=regex(pattern(args[1])).exec(s);set('RSTART',m?m.index+1:0);set('RLENGTH',m?m[0].length:-1);return get('RSTART');}
    if(program.functions.has(name)){const fn=program.functions.get(name),scope=new Map();fn.params.forEach((p,i)=>scope.set(p,args[i]?.type==='variable'&&!locals.at(-1)?.has(args[i].name)&&arrays.has(args[i].name)?array(args[i].name):args[i]?evaluate(args[i]):unset));locals.push(scope);let value='';try{run(fn.body);if(flow?.op==='return'){value=flow.value;flow=null;}}finally{locals.pop();}return value;}
    if(name==='length'&&args[0]?.type==='variable'&&arrays.has(args[0].name))return array(args[0].name).size;
    const a=args.map(evaluate);
    switch(name){
      case 'length':return str(a.length?a[0]:record).length;
      case 'substr':return str(a[0]).substr(Math.max(0,num(a[1])-1),a.length>2?Math.max(0,num(a[2])):undefined);
      case 'index':return str(a[0]).indexOf(str(a[1]))+1;
      case 'sprintf':return sprintf(a[0],a.slice(1));
      case 'tolower':return str(a[0]).toLowerCase();case 'toupper':return str(a[0]).toUpperCase();
      case 'int':return Math.trunc(num(a[0]));case 'sqrt':return Math.sqrt(num(a[0]));case 'log':return Math.log(num(a[0]));case 'exp':return Math.exp(num(a[0]));case 'sin':return Math.sin(num(a[0]));case 'cos':return Math.cos(num(a[0]));case 'atan2':return Math.atan2(num(a[0]),num(a[1]));
      case 'srand':{const old=seed;seed=a.length?num(a[0]):Date.now();return old;}case 'rand':seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;
      case 'close':{const name=str(a[0]);readers.delete(name);written.delete(name);return closePipe(name);}
      default:failure(`unsupported function ${name}`);
    }
  }
  function evaluate(n){switch(n.type){
    case 'literal':return n.value;case 'regex':return Number(regex(n.value).test(record));
    case 'variable':if(n.name==='length')return record.length;return get(n.name);
    case 'index':case 'field':return ref(n).get();case 'call':return call(n);
    case 'conditional':return evaluate(truth(evaluate(n.condition))?n.yes:n.no);
    case 'getline':{let text;if(n.file){const path=str(evaluate(n.file));try{if(!readers.has(path))readers.set(path,{lines:options.readFile(path).split('\n'),i:0});const r=readers.get(path);if(r.lines.at(-1)==='')r.lines.pop();text=r.i<r.lines.length?r.lines[r.i++]:null;}catch{return -1;}}else text=nextRecord();if(text===null)return 0;if(n.target)ref(n.target).set(new InputString(text));else setRecord(text);return 1;}
    case 'unary':case 'postfix':{if(n.op==='++'||n.op==='--'){const r=ref(n.value),v=num(r.get()),next=v+(n.op==='++'?1:-1);r.set(next);return n.type==='postfix'?v:next;}const v=evaluate(n.value);return n.op==='!'?Number(!truth(v)):n.op==='-'?-num(v):num(v);}
    case 'assign':{const r=ref(n.left),v=evaluate(n.right);return r.set(n.op==='='?v:arithmetic(n.op[0],r.get(),v));}
    case 'binary':{const a=evaluate(n.left);if(n.op==='&&')return Number(truth(a)&&truth(evaluate(n.right)));if(n.op==='||')return Number(truth(a)||truth(evaluate(n.right)));if(n.op==='in'){if(n.right.type!=='variable')failure('in requires an array');return Number(array(n.right.name).has(str(a)));}
      if(n.op==='~'||n.op==='!~'){const match=regex(pattern(n.right)).test(str(a));return Number(n.op==='~'?match:!match);}
      const b=evaluate(n.right);if(n.op==='concat')return str(a)+str(b);
      if(['==','!=','<','>','<=','>='].includes(n.op)){const x=numeric(a)&&numeric(b)?num(a):str(a),y=numeric(a)&&numeric(b)?num(b):str(b);return Number(n.op==='=='?x===y:n.op==='!='?x!==y:n.op==='<'?x<y:n.op==='>'?x>y:n.op==='<='?x<=y:x>=y);}
      return arithmetic(n.op,a,b);}
  }failure(`unsupported expression ${n.type}`);}
  function arithmetic(op,a,b){a=num(a);b=num(b);if((op==='/'||op==='%')&&b===0)failure('division by zero');return op==='+'?a+b:op==='-'?a-b:op==='*'?a*b:op==='/'?a/b:op==='%'?a%b:op==='^'?a**b:failure(`unsupported operator ${op}`);}
  function run(n){if(flow)return;switch(n.type){
    case 'block':for(const child of n.body){run(child);if(flow)break;}break;
    case 'expression':evaluate(n.value);break;
    case 'if':if(truth(evaluate(n.condition)))run(n.yes);else if(n.no)run(n.no);break;
    case 'print':{const values=n.args.map(evaluate);const text=n.op==='printf'?sprintf(values[0],values.slice(1)):(values.length?values.map(str).join(str(get('OFS'))):record)+str(get('ORS'));
      if(n.redirect){const file=str(evaluate(n.redirect.file));if(n.redirect.op==='|')pipes.set(file,(pipes.get(file)??'')+text);else {options.writeFile(file,text,n.redirect.op==='>>'||written.has(file));written.add(file);}}else output+=text;break;}
    case 'delete':if(n.value.type==='variable')array(n.value.name).clear();else {const r=ref(n.value);if(!r.remove)failure('delete requires an array');r.remove();}break;
    case 'flow':flow={op:n.op,value:n.value?evaluate(n.value):0};if(n.op==='exit')status=num(flow.value);break;
    case 'while':case 'do':case 'for':case 'forin':{
      if(n.type==='for'&&n.initial)evaluate(n.initial);
      let keys;if(n.type==='forin'){if(n.initial.right.type!=='variable')failure('for-in requires array');keys=[...array(n.initial.right.name).keys()];}
      let first=true,j=0;while(n.type==='forin'?j<keys.length:n.type==='do'&&first||!n.condition||truth(evaluate(n.condition))){first=false;if(keys)ref(n.initial.left).set(new InputString(keys[j++]));run(n.body);if(flow){if(flow.op==='break'){flow=null;break;}if(flow.op==='continue')flow=null;else break;}if(n.type==='for'&&n.increment)evaluate(n.increment);}break;}
    default:failure(`unsupported statement ${n.type}`);
  }}
  for(const b of program.begin){run(b);if(flow)break;}
  if(flow&&flow.op!=='exit')failure(`${flow.op} outside a record`);
  if(!flow&&program.rules.length){let text;while((text=nextRecord())!==null){setRecord(text);for(const rule of program.rules){let yes=!rule.pattern||truth(evaluate(rule.pattern));if(rule.until){yes=ranges.get(rule)||yes;if(yes)ranges.set(rule,!truth(evaluate(rule.until)));}if(yes)run(rule.action);if(flow)break;}if(flow?.op==='exit')break;if(flow&& !['next','nextfile'].includes(flow.op))failure(`${flow.op} outside its context`);if(flow?.op==='nextfile')recordIndex=records.length;flow=null;}}
  flow=null;for(const b of program.end){run(b);if(flow)break;}
  for(const command of pipes.keys())closePipe(command);
  return stderr?{status,stdout:output,stderr}:{status,stdout:output};
}
