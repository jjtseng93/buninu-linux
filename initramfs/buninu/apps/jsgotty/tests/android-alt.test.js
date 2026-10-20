const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

// Exercise the shipped bundle's wrapper method, without a DOM or new dependencies.
const bundle = fs.readFileSync(path.join(__dirname, '../static/js/gotty.js'), 'utf8');
const start = bundle.indexOf('          handleAndroidAltKey(event) {');
assert.ok(start >= 0);
const end = bundle.indexOf('          info() {', start);
assert.ok(end > start);
const method = bundle.slice(start, end);
function setup(userAgent = 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 wv') {
  const handler = vm.runInNewContext(`({${method}}).handleAndroidAltKey`, {
    navigator: { userAgent },
  });
  const sent = [];
  const target = { term: { input: (text, userInput) => sent.push([text, userInput]) } };
  function dispatch(overrides = {}) {
    const event = {
      type: 'keydown', code: 'KeyE', key: 'Dead', keyCode: 69,
      altKey: true, ctrlKey: false, metaKey: false, shiftKey: false,
      isComposing: false, getModifierState: () => false,
      prevented: false, stopped: false,
      preventDefault() { this.prevented = true; },
      stopPropagation() { this.stopped = true; },
      ...overrides,
    };
    return { result: handler.call(target, event), event };
  }
  return { sent, dispatch };
}

test('Android accent shortcuts emit one ESC sequence; keypress/keyup do not duplicate it', () => {
  for (const letter of ['E', 'I', 'N', 'U']) {
    for (const keyCode of [letter.charCodeAt(0), 229]) {
      const { sent, dispatch } = setup();
      const { event, result } = dispatch({ code: `Key${letter}`, keyCode });
      assert.equal(result, false);
      assert.equal(event.prevented, true);
      assert.equal(event.stopped, true);
      dispatch({ type: 'keypress', code: `Key${letter}`, keyCode });
      dispatch({ type: 'keyup', code: `Key${letter}`, keyCode });
      assert.deepEqual(sent, [[`\x1b${letter.toLowerCase()}`, true]]);
      // No dead-key state is retained in this handler for the next ordinary key.
      assert.equal(dispatch({ altKey: false, key: 'e' }).result, true);
      assert.equal(sent.length, 1);
    }
  }
});

test('all printable physical Alt keys bypass dead-key handling, including Shift and repeat', () => {
  const { sent, dispatch } = setup();
  for (const [code, shiftKey, expected] of [
    ['KeyA', false, 'a'], ['KeyE', true, 'E'], ['Digit0', false, '0'],
    ['Digit1', true, '!'], ['Digit0', true, ')'], ['Quote', false, "'"],
    ['Backquote', true, '~'], ['Backslash', false, '\\'], ['Space', false, ' '],
  ]) {
    dispatch({ code, shiftKey, key: 'Dead' });
    assert.deepEqual(sent.at(-1), [`\x1b${expected}`, true]);
  }
  dispatch({ code: 'KeyE', key: 'é', repeat: true });
  assert.deepEqual(sent.at(-1), ['\x1be', true]);
});

test('composition, AltGr, other modifiers, and unmapped keys retain existing handling', () => {
  for (const overrides of [
    { isComposing: true, keyCode: 229 }, { getModifierState: key => key === 'AltGraph' },
    { altKey: false }, { ctrlKey: true }, { metaKey: true },
    { code: '', keyCode: 229 }, { code: 'ArrowLeft' }, { code: 'Enter' },
    { code: 'Unidentified', keyCode: 229 }, { code: 'toString' },
    { type: 'keyup', key: 'e' },
  ]) {
    const { sent, dispatch } = setup();
    const { result, event } = dispatch(overrides);
    assert.equal(result, true);
    assert.equal(event.prevented, false);
    assert.deepEqual(sent, []);
  }
});

test('non-Android browsers retain existing Alt/dead-key handling', () => {
  for (const ua of ['Mozilla/5.0 (X11; Linux x86_64)', 'Mozilla/5.0 (Macintosh)', 'Windows']) {
    const { sent, dispatch } = setup(ua);
    assert.equal(dispatch().result, true);
    assert.deepEqual(sent, []);
  }
});

// Replay the actual Android 16 WebView trace: no letter keydown and empty code.
test('Android keyup-only dead keys use legacy keyCode, and ordinary IME input stays untouched', () => {
  const { sent, dispatch } = setup();
  for (const keyCode of [69, 78, 85, 73]) {
    dispatch({ type: 'keydown', code: '', key: 'Alt', keyCode: 18 });
    assert.equal(dispatch({ type: 'keyup', code: '', key: 'Dead', keyCode }).result, false);
    dispatch({ type: 'keyup', code: '', key: 'Alt', keyCode: 18 });
  }
  assert.deepEqual(sent, ['e', 'n', 'u', 'i'].map(c => ['\x1b' + c, true]));
  assert.equal(dispatch({ code: '', key: 'Unidentified', keyCode: 229, altKey: false }).result, true);
  assert.equal(sent.length, 4);
});

test('legacy keydown plus dead keyup emits once, even with different code availability', () => {
  for (const [downCode, upCode] of [['', ''], ['KeyE', ''], ['', 'KeyE']]) {
    const { sent, dispatch } = setup();
    dispatch({ code: downCode, keyCode: 69 });
    dispatch({ type: 'keypress', code: downCode, keyCode: 69 });
    dispatch({ type: 'keyup', code: upCode, keyCode: 69 });
    assert.deepEqual(sent, [['\x1be', true]]);
    // The next keyup-only shortcut must not be suppressed by the preceding press.
    dispatch({ type: 'keyup', code: '', keyCode: 69 });
    assert.equal(sent.length, 2);
  }
});
