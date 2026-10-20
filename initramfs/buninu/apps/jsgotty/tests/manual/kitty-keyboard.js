#!/usr/bin/env node
// Run inside jsgotty. Exits after 60 seconds or unmodified Escape/q/Ctrl-C.
// Uses only built-ins and restores the prior Kitty mode and raw mode on exit.
const input=process.stdin, output=process.stdout;
const cyan = '\x1b[96m', reset = '\x1b[0m';
const keyNames = {
  9: 'tab', 13: 'enter', 27: 'esc', 32: 'space', 127: 'backspace',
  57358: 'caps-lock', 57359: 'scroll-lock', 57360: 'num-lock',
  57361: 'print-screen', 57362: 'pause', 57363: 'menu',
  57409: 'kp-decimal', 57410: 'kp-divide', 57411: 'kp-multiply',
  57412: 'kp-subtract', 57413: 'kp-add', 57414: 'kp-enter',
  57415: 'kp-equal', 57416: 'kp-separator',
  57417: 'kp-left', 57418: 'kp-right', 57419: 'kp-up', 57420: 'kp-down',
  57421: 'kp-page-up', 57422: 'kp-page-down', 57423: 'kp-home',
  57424: 'kp-end', 57425: 'kp-insert', 57426: 'kp-delete', 57427: 'kp-begin',
  57428: 'media-play', 57429: 'media-pause', 57430: 'media-play-pause',
  57431: 'media-reverse', 57432: 'media-stop', 57433: 'media-fast-forward',
  57434: 'media-rewind', 57435: 'media-next', 57436: 'media-previous',
  57437: 'media-record', 57438: 'volume-down', 57439: 'volume-up',
  57440: 'volume-mute', 57453: 'altgr', 57454: 'iso-level5-shift',
};
for (let n=13; n<=35; n++) keyNames[57376+n-13] = 'f'+n;
for (let n=0; n<=9; n++) keyNames[57399+n] = 'kp-'+n;
const modifierKeys = ['shift', 'ctrl', 'alt', 'super', 'hyper', 'meta'];
const modifierBits = [1, 4, 2, 8, 16, 32];
function readableChord(key, suffix, bits) {
  const number = Number(key.split(':')[0] || 1);
  let name;
  if (suffix === 'u') {
    if (number >= 57441 && number <= 57452) {
      const index = (number-57441)%6;
      name = modifierKeys[index] + (number >= 57447 ? '-right' : '-left');
      bits &= ~modifierBits[index]; // "super-left", not "super-super-left".
    } else {
      name = keyNames[number];
      if (!name) name = number >= 33 && number <= 0x10ffff &&
        !(number >= 0x7f && number <= 0x9f) &&
        !(number >= 0xd800 && number <= 0xf8ff)
        ? String.fromCodePoint(number) : 'key-'+number;
    }
  } else if (suffix === '~') {
    name = {2:'insert', 3:'delete', 5:'page-up', 6:'page-down', 7:'home', 8:'end',
      11:'f1', 12:'f2', 13:'f3', 14:'f4', 15:'f5', 17:'f6',
      18:'f7', 19:'f8', 20:'f9', 21:'f10', 23:'f11', 24:'f12'}[number];
  } else {
    name = {A:'up', B:'down', C:'right', D:'left', E:'begin',
      F:'end', H:'home', P:'f1', Q:'f2', S:'f4'}[suffix];
  }
  const modifiers = [[4,'ctrl'], [2,'alt'], [1,'shift'], [8,'super'],
    [16,'hyper'], [32,'meta'], [64,'caps-lock'], [128,'num-lock']]
    .filter(([bit]) => bits & bit).map(([,label]) => label);
  return [...modifiers, name || `key-${number}${suffix}`].join('-');
}
if(!input.isTTY || !output.isTTY) {console.error('Run this inside an interactive jsgotty terminal.');process.exit(1);}
const wasRaw=Boolean(input.isRaw);let closed=false,buffer='';
const finish=()=>{if(closed)return;closed=true;clearTimeout(timer);output.write('\x1b[<u\r\nKeyboard mode restored.\r\n');input.setRawMode(wasRaw);input.pause();};
const timer=setTimeout(finish,60000);
process.on('SIGINT',finish);process.on('SIGTERM',finish);process.on('exit',finish);
input.setRawMode(true);input.setEncoding('utf8');input.resume();
output.write('Kitty keyboard test: try SUP, CTRL, ALT, SHFT + letters/arrows.\r\nEscape, q or Ctrl-C exits; automatic exit in 60 seconds.\r\n\x1b[>11u\x1b[?u');
input.on('data',data=>{
 if(closed)return;
 buffer+=data;
 while(buffer) {
  const match=/^\x1b\[([?]?)([0-9:;]*)([u~A-Z])/.exec(buffer);
  if(!match) {
   if(buffer==='\x1b' || /^\x1b\[[?0-9:;]*$/.test(buffer))break;
   const ch=[...buffer][0];buffer=buffer.slice(ch.length);output.write('legacy '+JSON.stringify(ch)+'\r\n');
   if(ch==='q'||ch==='\x03') {finish();return;}continue;
  }
  buffer=buffer.slice(match[0].length);
  if(match[1]==='?'){output.write('negotiated flags='+match[2]+' (expected 11)\r\n');continue;}
  const [key,mod='1']=match[2].split(';');const [encoded,type='1']=mod.split(':');const bits=Number(encoded)-1;
  const names=[[1,'Shift'],[2,'Alt'],[4,'Ctrl'],[8,'Super'],[16,'Hyper'],[32,'Meta'],[64,'CapsLock'],[128,'NumLock']].filter(([bit])=>bits&bit).map(([,name])=>name);
  const chord = readableChord(key, match[3], bits);
  output.write(`${cyan}${chord}${reset}  ${{1:'press',2:'repeat',3:'release'}[type]||type}  raw=${JSON.stringify(match[0])} key=${key}${match[3]} modifiers=${names.join('+')||'none'}\r\n`);
  if(match[3]==='u' && type==='1' && ((!(bits&63)&&['27','113'].includes(key)) || ((bits&63)===4 && key==='99'))) {finish();return;}
 }
 if(buffer.length>4096)buffer='';
});
