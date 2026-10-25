// Read the terminal before attaching. No reset and no guessed default modes.
import { randomBytes } from 'node:crypto';
import modes from './terminal-modes.js';
const {TerminalModeTracker, validateSnapshot, TRACKED_DEC_FLAGS, MOUSE_PROTOCOLS, MOUSE_ENCODINGS} = modes;
const ESC = '\x1b';
export class ModeProbe {
  constructor(nonce = randomBytes(16).toString('hex')) {
    this.nonce = nonce;
    this.pending = Buffer.alloc(0);
    this.complete = false;
    this.kittyRestore = false;
    this.state = new TerminalModeTracker().snapshot();
    for (const key of Object.keys(this.state.dec)) this.state.dec[key] = null;
    for (const key of ['alternate','cursorHidden','mouse','encoding']) this.state[key] = null;
    this.state.kitty.normal.flags = this.state.kitty.alternate.flags = null;
    this.state.mouseModeBits = Object.fromEntries(Object.keys(MOUSE_PROTOCOLS).map(n=>[n,null]));
    this.state.mouseEncodingBits = Object.fromEntries(Object.keys(MOUSE_ENCODINGS).map(n=>[n,null]));
    this.replies = new Map();
    this.outstanding = new Set();
    this.kittyOutstanding = false;
    this.privatePrefix = `${ESC}]777;jsgotty-modes;${nonce};`;
  }
  privateQuery() { return `${ESC}]777;jsgotty-modes;${this.nonce}\x07`; }
  standardQuery() {
    this.outstanding = new Set([...Object.keys(TRACKED_DEC_FLAGS),25,1049,...Object.keys(MOUSE_PROTOCOLS),...Object.keys(MOUSE_ENCODINGS)].map(Number));
    this.kittyOutstanding = true;
    this.replyDeadline = Date.now() + 1500;
    return [...this.outstanding]
      .map(n => `${ESC}[?${n}$p`).join('') + `${ESC}[?u`;
  }
  reply(mode, value) {
    if (this.complete) return;
    const yes = value === 1 || value === 3;
    // An unsupported mode cannot be active, but unlike silence it is a reply.
    // Still aggregate below when 0 is the last answer in a mouse-mode group.
    this.replies.set(mode, yes);
    if (MOUSE_PROTOCOLS[mode]) this.state.mouseModeBits[mode] = yes;
    if (MOUSE_ENCODINGS[mode]) this.state.mouseEncodingBits[mode] = yes;
    if (value !== 0) {
      if (TRACKED_DEC_FLAGS[mode]) this.state.dec[TRACKED_DEC_FLAGS[mode]] = yes;
      else if (mode === 25) this.state.cursorHidden = !yes;
      else if (mode === 1049) this.state.alternate = yes;
    }
    for (const [name, table, fallback, priority] of [
      ['mouse',MOUSE_PROTOCOLS,'NONE',[1003,1002,1000,9]],
      ['encoding',MOUSE_ENCODINGS,'DEFAULT',[1016,1006]],
    ]) {
      const active = priority.find(key => this.replies.get(key) === true);
      if (active) this.state[name] = table[active];
      else if (Object.keys(table).every(key => this.replies.has(+key))) this.state[name] = fallback;
    }
  }
  consume(chunk) {
    if ((this.complete && !this.outstanding.size && !this.kittyOutstanding) ||
        (this.replyDeadline && Date.now() > this.replyDeadline)) {
      this.outstanding.clear(); this.kittyOutstanding = false;
      return Buffer.concat([this.flush(), Buffer.from(chunk)]);
    }
    this.pending = Buffer.concat([this.pending, Buffer.from(chunk)]);
    const out = [];
    while (this.pending.length) {
      const text = this.pending.toString('latin1');
      if (text.startsWith(this.privatePrefix)) {
        const end = text.indexOf('\x07', this.privatePrefix.length);
        if (end < 0 && text.length < 16384) break;
        if (end >= 0) {
          try {
            const reply = JSON.parse(Buffer.from(text.slice(this.privatePrefix.length,end),'base64').toString());
            this.state = validateSnapshot(reply);
            this.kittyRestore = reply.kittyRestore === 1;
            this.complete = true;
          } catch {}
          this.pending = this.pending.subarray(end+1); continue;
        }
      }
      const dec = /^\x1b\[\?(\d+);([0-4])\$y/.exec(text);
      const kitty = /^\x1b\[\?(\d+)u/.exec(text);
      if ((dec && this.outstanding.delete(+dec[1])) || (kitty && this.kittyOutstanding)) {
        if (dec) this.reply(+dec[1],+dec[2]);
        else {
          this.kittyOutstanding = false;
          if (!this.complete && this.state.alternate != null)
            this.state.kitty[this.state.alternate?'alternate':'normal'].flags = +kitty[1] & 31;
        }
        this.pending = this.pending.subarray((dec||kitty)[0].length); continue;
      }
      // Hold only possible query replies; normal keystrokes and mouse packets pass unchanged.
      if (this.privatePrefix.startsWith(text) || (text.length < 64 && /^\x1b\[\?[0-9;\$]*$/.test(text)) || text === ESC+'[') break;
      // Forward ordinary input in spans; large pastes must not become quadratic.
      const next = this.pending.indexOf(0x1b, 1);
      const count = next < 0 ? this.pending.length : next;
      out.push(this.pending.subarray(0,count));this.pending=this.pending.subarray(count);
    }
    return Buffer.concat(out);
  }
  flush() { const data=this.pending;this.pending=Buffer.alloc(0);return data; }
}
export async function captureTerminalModes(input, output, {timeout=1000, probe=new ModeProbe()}={}) {
  const buffered=[];
  if (!input.isTTY || !output.isTTY) {
    probe.replyDeadline = 1;
    return {state:probe.state, probe, buffered:Buffer.alloc(0)};
  }
  const raw=!!input.isRaw;
  input.setRawMode(true);
  await new Promise(resolve=>{
    let finished=false;
    const finish=()=>{if(finished)return;finished=true;clearTimeout(fallback);clearTimeout(end);input.off('data',data);resolve();};
    const data=chunk=>{const rest=probe.consume(chunk);if(rest.length)buffered.push(rest);if(probe.complete)finish();};
    const fallback=setTimeout(()=>output.write(probe.standardQuery()),Math.min(200,timeout/2));
    const end=setTimeout(finish,timeout);
    input.on('data',data);input.resume();output.write(probe.privateQuery());
  });
  input.pause();input.setRawMode(raw);
  buffered.push(probe.flush());
  return {state:validateSnapshot(probe.state),probe,buffered:Buffer.concat(buffered)};
}
