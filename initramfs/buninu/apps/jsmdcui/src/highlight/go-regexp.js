// Adapt Go regexp syntax without changing the upstream syntax definitions.
// Scoped JS modifiers preserve flag changes across alternatives, but not out
// of their enclosing group. They add no capturing groups. Modifiers are only
// emitted where flags differ from those in effect, so flag-free patterns
// do not depend on engine support for them.
export function convertGoRegexp(pattern) {
  const source = String(pattern);
  if (!/\(\?[ims-]|\[\^?\]|\(\?P<|\[:[a-z]+:\]/.test(source)) return source;
  let i = 0;
  function expression(inherited, active, nested = false, depth = 0) {
    // Bound syntax-rule recursion, not the length of text being highlighted.
    if (depth > 256) throw new RangeError('Go regexp nesting exceeds 256 groups');
    const flags = new Set(inherited);
    let output = '', wrapped = false;
    function open() {
      const on = 'ims'.split('').filter(f => flags.has(f) && !active.has(f)).join('');
      const off = 'ims'.split('').filter(f => !flags.has(f) && active.has(f)).join('');
      if (!on && !off) return;
      output += `(?${on}${off ? '-' + off : ''}:`;
      wrapped = true;
    }
    function close() { if (wrapped) output += ')'; wrapped = false; }
    while (i < source.length) {
      const ch = source[i];
      if (ch === ')' && nested) { i++; close(); return output; }
      if (ch === '|') { close(); output += '|'; i++; continue; }
      const directive = ch === '(' && source.slice(i).match(/^\(\?([ims]*)(?:-([ims]+))?\)/);
      if (directive && (directive[1] || directive[2])) {
        close();
        for (const f of directive[1]) flags.add(f);
        for (const f of directive[2] || '') flags.delete(f);
        i += directive[0].length;
        continue;
      }
      if (!wrapped) open();
      if (ch === '\\') { output += source.slice(i, i + 2); i += 2; continue; }
      if (ch === '[') {
        output += source[i++];
        if (source[i] === '^') output += source[i++];
        // Go permits a literal ] as the first member of a character class.
        if (source[i] === ']') { output += '\\]'; i++; }
        while (i < source.length) {
          const posix = source.slice(i).match(/^\[:([a-z]+):\]/);
          if (posix && POSIX_CLASSES[posix[1]] !== undefined) {
            output += POSIX_CLASSES[posix[1]]; i += posix[0].length; continue;
          }
          const c = source[i++]; output += c;
          if (c === '\\' && i < source.length) output += source[i++];
          else if (c === ']') break;
        }
        continue;
      }
      if (ch === '(') {
        const scoped = source.slice(i).match(/^\(\?([ims]*)(?:-([ims]+))?:/);
        const childFlags = new Set(flags);
        if (scoped) {
          for (const f of scoped[1]) childFlags.add(f);
          for (const f of scoped[2] || '') childFlags.delete(f);
          output += '(?:'; i += scoped[0].length;
        } else {
          const prefix = source.slice(i).match(/^\(\?(?:[:=!]|<[=!]|<[^>]+>|P<[^>]+>)/);
          output += prefix ? prefix[0].replace('(?P<', '(?<') : '(';
          i += prefix ? prefix[0].length : 1;
        }
        output += expression(childFlags, flags, true, depth + 1) + ')';
        continue;
      }
      output += ch; i++;
    }
    close();
    return output;
  }
  return expression(new Set(), new Set());
}

// Class contents, not nested [...] expressions: e.g. [[:alnum:]._-].
const POSIX_CLASSES = {
  alnum: 'A-Za-z0-9', alpha: 'A-Za-z', ascii: '\\x00-\\x7F',
  blank: ' \\t', cntrl: '\\x00-\\x1F\\x7F', digit: '0-9',
  graph: '!-~', lower: 'a-z', print: ' -~',
  punct: '!-/:-@\\[-`{-~', space: '\\t\\n\\v\\f\\r ',
  upper: 'A-Z', word: 'A-Za-z0-9_', xdigit: 'A-Fa-f0-9',
};
