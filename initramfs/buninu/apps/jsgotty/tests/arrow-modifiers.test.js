const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the keyboard encoder shipped in the frontend bundle.
const bundle = fs.readFileSync(path.join(__dirname, '../static/js/gotty.js'), 'utf8');
const marker = 't.evaluateKeyboardEvent = function (e, t, i, n) {';
const start = bundle.indexOf(marker);
assert.ok(start >= 0);
const end = bundle.indexOf('\n                  },\n                  482:', start);
assert.ok(end > start);
const source = bundle.slice(start + 't.evaluateKeyboardEvent = '.length, end).trim().replace(/;$/, '');
const evaluate = vm.runInNewContext(`(${source})`, { r: { C0: { ESC: '\x1b', US: '\x1f' } }, s: {} });
const arrows = [[37, 'D'], [38, 'A'], [39, 'C'], [40, 'B']];

for (const isMac of [false, true]) {
  test(`arrow modifiers stay distinct (isMac=${isMac})`, () => {
    for (const [keyCode, suffix] of arrows) {
      for (const applicationCursorMode of [false, true]) {
        const sequences = new Set();
        for (let mask = 0; mask < 8; mask++) {
          const result = evaluate({
            keyCode, metaKey: false,
            shiftKey: Boolean(mask & 1), altKey: Boolean(mask & 2), ctrlKey: Boolean(mask & 4),
          }, applicationCursorMode, isMac, false);
          const expected = mask
            ? `\x1b[1;${mask + 1}${suffix}`
            : `\x1b${applicationCursorMode ? 'O' : '['}${suffix}`;
          assert.equal(result.key, expected);
          sequences.add(result.key);
        }
        assert.equal(sequences.size, 8);
      }
    }
  });
}

test('Alt Insert/PageUp/PageDown keep Alt while preserving existing shortcuts', () => {
  for (const isMac of [false, true]) {
    const encode = (keyCode, modifiers = {}) => evaluate({
      keyCode, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false,
      ...modifiers,
    }, false, isMac, false);
    for (const [keyCode, parameter] of [[45, 2], [33, 5], [34, 6]]) {
      assert.equal(encode(keyCode).key, `\x1b[${parameter}~`);
      assert.equal(encode(keyCode, { altKey: true }).key, `\x1b[${parameter};3~`);
    }
    for (const [keyCode, parameter, scrollType] of [[33, 5, 2], [34, 6, 3]]) {
      assert.equal(encode(keyCode, { ctrlKey: true }).key, `\x1b[${parameter};5~`);
      assert.equal(encode(keyCode, { ctrlKey: true, altKey: true }).key, `\x1b[${parameter};7~`);
      for (const ctrlKey of [false, true]) {
        for (const altKey of [false, true]) {
          const result = encode(keyCode, { shiftKey: true, ctrlKey, altKey });
          assert.equal(result.type, scrollType);
          assert.equal(result.key, undefined);
        }
      }
    }
    for (const modifiers of [
      { ctrlKey: true }, { shiftKey: true }, { ctrlKey: true, shiftKey: true },
      { ctrlKey: true, altKey: true }, { shiftKey: true, altKey: true },
    ]) assert.equal(encode(45, modifiers).key, undefined);
  }
});


test('Ctrl slash sends US like Ctrl underscore, including alternate layout keyCodes', () => {
  for (const isMac of [false, true]) {
    for (const keyCode of [191, 226]) {
      const result = evaluate({ key: '/', keyCode, ctrlKey: true,
        shiftKey: false, altKey: false, metaKey: false }, false, isMac, false);
      assert.equal(result.key, '\x1f');
    }
    const plain = evaluate({ key: '/', keyCode: 191, ctrlKey: false,
      shiftKey: false, altKey: false, metaKey: false }, false, isMac, false);
    assert.equal(plain.key, '/');
  }
});
