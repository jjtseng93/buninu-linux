const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { TerminalModeTracker, modeTransition } = require('../terminal-modes.js');

const source = fs.readFileSync(path.join(__dirname, '../static/js/gotty.js'), 'utf8');
const methods = source.slice(source.indexOf('          enqueueTerminal(task)'), source.indexOf('          setDisconnected(e)'));

function feed(tracker, ...chunks) {
  for (const chunk of chunks) tracker.consume(Buffer.from(chunk, 'latin1'));
  return tracker.snapshot();
}

function client({ alternate = false, dec = {}, mouse = 'NONE', encoding = 'DEFAULT', cursorHidden = false } = {}) {
  const Wrapper = vm.runInNewContext(`(class {${methods}})`);
  const w = new Wrapper();
  const writes = [];
  const defaults = { applicationCursorKeys: false, applicationKeypad: false, bracketedPasteMode: false,
    origin: false, reverseWraparound: false, sendFocus: false, wraparound: true };
  w.term = {
    _core: { coreService: { decPrivateModes: { ...defaults, ...dec }, isCursorHidden: cursorHidden },
      coreMouseService: { activeProtocol: mouse, activeEncoding: encoding } },
    buffer: { active: { type: alternate ? 'alternate' : 'normal' } },
    write: (s, callback) => { if (s) writes.push(s); callback?.(); },
  };
  w.kittyKeyboard = { states: { normal: { flags: 0, stack: [] }, alternate: { flags: 0, stack: [] } } };
  return { w, writes };
}

test('tracker follows DEC, mouse, alternate screen and kitty keyboard modes', () => {
  const state = feed(new TerminalModeTracker(),
    'hi\x1b[?1049h\x1b[?1;2004h\x1b=\x1b[?25l',
    '\x1b[?1002h\x1b[?10', '06h', // split across chunks
    '\x1b[>1u\x1b[>11u\x1b]0;title \x1b[?2004l\x07');
  assert.equal(state.alternate, true);
  assert.equal(state.dec.applicationCursorKeys, true);
  assert.equal(state.dec.bracketedPasteMode, true, 'OSC payload is not parsed as CSI');
  assert.equal(state.dec.applicationKeypad, true);
  assert.equal(state.cursorHidden, true);
  assert.equal(state.mouse, 'DRAG');
  assert.equal(state.encoding, 'SGR');
  assert.deepEqual(state.kitty.alternate, { flags: 11, stack: [0, 1] });
  assert.deepEqual(state.kitty.normal, { flags: 0, stack: [] });
});

test('tracker handles mode resets, kitty pop/set and RIS', () => {
  const tracker = new TerminalModeTracker();
  let state = feed(tracker, '\x1b[?1003h\x1b[?1006h\x1b[?1000l\x1b[?1006l\x1b[>1u\x1b[=8;2u\x1b[<u');
  assert.equal(state.mouse, 'NONE');
  assert.equal(state.encoding, 'DEFAULT');
  assert.equal(state.kitty.normal.flags, 0);
  state = feed(tracker, '\x1b[?1049h\x1b[?2004h\x1b[?1002h\x1b[!p');
  assert.equal(state.dec.bracketedPasteMode, false, 'DECSTR resets DEC modes');
  assert.equal(state.alternate, true, 'DECSTR keeps the active screen');
  assert.equal(state.mouse, 'DRAG', 'DECSTR keeps mouse reporting');
  state = feed(tracker, '\x1bc');
  assert.deepEqual(state, new TerminalModeTracker().snapshot());
});

test('fresh client gets the full state restored', () => {
  const state = feed(new TerminalModeTracker(), '\x1b[?1049h\x1b[?2004h\x1b[?1002h\x1b[?1006h\x1b[?25l\x1b[>11u');
  const { w, writes } = client();
  w.applySessionModes(state);
  assert.equal(writes.length, 1);
  for (const seq of ['\x1b[?1049h', '\x1b[?2004h', '\x1b[?1002h', '\x1b[?1006h', '\x1b[?25l'])
    assert.ok(writes[0].includes(seq), JSON.stringify(seq));
  assert.equal(w.kittyKeyboard.states.alternate.flags, 11);
});

test('browser masks kitty flags it does not implement', () => {
  const { w } = client();
  w.applySessionModes(feed(new TerminalModeTracker(), '\x1b[>31u\x1b[>31u'));
  assert.equal(JSON.stringify(w.kittyKeyboard.states.normal), JSON.stringify({ flags: 11, stack: [0, 11] }));
});

test('socket-only reconnect with matching xterm state writes nothing', () => {
  const state = feed(new TerminalModeTracker(), '\x1b[?1049h\x1b[?6h\x1b[?2004h\x1b[?1002h\x1b[?1006h\x1b[>1u\x1b[>11u');
  const { w, writes } = client({ alternate: true, dec: { origin: true, bracketedPasteMode: true }, mouse: 'DRAG', encoding: 'SGR' });
  w.applySessionModes(state);
  assert.equal(writes.length, 0, 'no DECOM cursor homing or 1049 cursor save');
  w.applySessionModes(state);
  assert.deepEqual(JSON.parse(JSON.stringify(w.kittyKeyboard.states.alternate)), { flags: 11, stack: [0, 1] }, 'push stack does not grow');
});

test('stale client modes are turned off when the program disabled them while disconnected', () => {
  const state = new TerminalModeTracker().snapshot();
  const { w, writes } = client({ alternate: true, dec: { bracketedPasteMode: true }, mouse: 'ANY', encoding: 'SGR' });
  w.applySessionModes(state);
  assert.equal(writes.length, 1);
  for (const seq of ['\x1b[?1049l', '\x1b[?2004l', '\x1b[?1000l', '\x1b[?1006l'])
    assert.ok(writes[0].includes(seq), JSON.stringify(seq));
});

test('transport disconnect and reconnect clear held keys without resetting negotiation', () => {
  const start = source.indexOf('          reset() {\n            // Reconnecting');
  const reset = source.slice(start, source.indexOf('          close() {', start));
  assert.match(reset, /clearHeld\(false\)/);
  assert.doesNotMatch(reset, /kittyKeyboard.reset/);
  assert.match(source, /setDisconnected\(e\) \{\s*if \(e\) this.kittyKeyboard.clearHeld\(false\)/);
});

const sessions = {
  vim: '\x1b[?1049h\x1b[?1h\x1b=\x1b[?2004h\x1b[?1002h\x1b[?1006h\x1b[?25l',
  kittyBothScreens: '\x1b[>1u\x1b[?1049h\x1b[>31u\x1b[>3u\x1b[?1003h\x1b[?1016h',
  kittySetThenPush: '\x1b[=5;1u\x1b[>8u\x1b[?1004h\x1b[?6h',
};

for (const [name, output] of Object.entries(sessions)) {
  test(`CLI resume and cleanup round-trip: ${name}`, () => {
    const target = feed(new TerminalModeTracker(), output);
    const local = new TerminalModeTracker();
    assert.deepEqual(feed(local, modeTransition(local.snapshot(), target)), target, 'fresh terminal reaches PTY state');
    assert.equal(modeTransition(local.snapshot(), target), '', 'nothing left to send once in sync');
    assert.deepEqual(feed(local, modeTransition(local.snapshot())), new TerminalModeTracker().snapshot(), 'cleanup returns to defaults');
  });
}

test('kitty flags are kept unmasked for terminals that support all of them', () => {
  assert.equal(feed(new TerminalModeTracker(), '\x1b[>31u').kitty.normal.flags, 31);
});

test('incremental Kitty restoration preserves a non-default parent stack', () => {
  const local = new TerminalModeTracker();
  feed(local, '\x1b[=1u\x1b[>11u');
  const parent = local.snapshot();
  const remote = feed(new TerminalModeTracker(), '\x1b[>3u\x1b[>9u');
  const attach = modeTransition(parent, remote);
  assert.doesNotMatch(attach, /<100u/);
  assert.deepEqual(feed(local, attach), remote);
  assert.deepEqual(feed(local, modeTransition(local.snapshot(), parent)), parent);
});

test('unknown original modes are not replaced with guessed defaults on cleanup', () => {
  const unknown = new TerminalModeTracker().snapshot();
  for (const key of Object.keys(unknown.dec)) unknown.dec[key] = null;
  for (const key of ['alternate','cursorHidden','mouse','encoding']) unknown[key] = null;
  unknown.kitty.normal.flags = unknown.kitty.alternate.flags = null;
  assert.equal(modeTransition(feed(new TerminalModeTracker(), '\x1b[?1049h\x1b[>11u'), unknown), '');
});

test('hidden Kitty restoration is negotiated and never toggles the screen',()=>{
 for(const alternate of [false,true]){
  const local=new TerminalModeTracker();if(alternate)feed(local,'\x1b[?1049h');
  const target=local.snapshot(),hidden=alternate?'normal':'alternate';
  target.kitty[hidden]={flags:9,stack:[0,1]};
  assert.equal(modeTransition(local.snapshot(),target),'');
  const sequence=modeTransition(local.snapshot(),target,{kittyRestore:true});
  assert.doesNotMatch(sequence,/\[\?(?:47|1047|1049)[hl]/);
  // Every-byte fragmentation must be handled by intermediate server trackers.
  for(const byte of Buffer.from(sequence))local.consume(Buffer.from([byte]));
  assert.deepEqual(local.snapshot(),target);
 }
});
test('Kitty restore tracker rejects malformed or unrelated string commands',()=>{
 const t=new TerminalModeTracker(),before=t.snapshot();
 for(const payload of [
  '\x1b]777;jsgotty-kitty-v1;normal;32;0\x07',
  '\x1b]777;jsgotty-kitty-v1;normal;1;'+Array(33).fill('0').join(',')+'\x07',
  '\x1bP777;jsgotty-kitty-v1;normal;1;0\x1b\\',
  '\x1b]777;jsgotty-kitty-v1;normal;1;0\x18',
 ]){feed(t,payload);assert.deepEqual(t.snapshot(),before);}
 feed(t,'\x1b]777;jsgotty-kitty-v1;normal;1;0\x1b\\');
 assert.deepEqual(t.kitty.normal,{flags:1,stack:[0]});
});
