/*
Adapted from jsmdcui/src/index.js diffgutter (Myers bisect and merge cleanup).

MIT License

Copyright (c) 2016-2020: Zachary Yedidia, et al.
Copyright (c) 2026 Dr. John (醫者小智)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

const _DIFF_DELETE = -1, _DIFF_INSERT = 1, _DIFF_EQUAL = 0;

function _arrEq(a, b) { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; }
function _commonPrefix(a, b) { const n = Math.min(a.length, b.length); let i = 0; while (i < n && a[i] === b[i]) i++; return i; }
function _commonSuffix(a, b) { const n = Math.min(a.length, b.length); let i = 0; while (i < n && a[a.length-1-i] === b[b.length-1-i]) i++; return i; }
function _indexOfSub(longArr, shortArr) { const L = longArr.length, S = shortArr.length; if (S === 0) return 0; outer: for (let i = 0; i + S <= L; i++) { for (let j = 0; j < S; j++) if (longArr[i+j] !== shortArr[j]) continue outer; return i; } return -1; }
function _hasSuffix(seq, suf) { if (suf.length > seq.length) return false; for (let i = 0; i < suf.length; i++) if (seq[seq.length-suf.length+i] !== suf[i]) return false; return true; }
function _hasPrefix(seq, pre) { if (pre.length > seq.length) return false; for (let i = 0; i < pre.length; i++) if (seq[i] !== pre[i]) return false; return true; }

function _diffMain(a, b) {
  if (_arrEq(a, b)) return a.length ? [{ op: _DIFF_EQUAL, seq: a.slice() }] : [];
  const pre = _commonPrefix(a, b);
  const commonprefix = a.slice(0, pre);
  a = a.slice(pre); b = b.slice(pre);
  const suf = _commonSuffix(a, b);
  const commonsuffix = a.slice(a.length - suf);
  a = a.slice(0, a.length - suf); b = b.slice(0, b.length - suf);
  const diffs = _diffCompute(a, b);
  if (commonprefix.length) diffs.unshift({ op: _DIFF_EQUAL, seq: commonprefix });
  if (commonsuffix.length) diffs.push({ op: _DIFF_EQUAL, seq: commonsuffix });
  return _diffCleanupMerge(diffs);
}

function _diffCompute(a, b) {
  if (a.length === 0) return [{ op: _DIFF_INSERT, seq: b.slice() }];
  if (b.length === 0) return [{ op: _DIFF_DELETE, seq: a.slice() }];
  const aLonger = a.length > b.length;
  const long = aLonger ? a : b, short = aLonger ? b : a;
  const idx = _indexOfSub(long, short);
  if (idx !== -1) {
    const op = aLonger ? _DIFF_DELETE : _DIFF_INSERT;
    return [
      { op, seq: long.slice(0, idx) },
      { op: _DIFF_EQUAL, seq: short.slice() },
      { op, seq: long.slice(idx + short.length) },
    ];
  }
  if (short.length === 1) return [{ op: _DIFF_DELETE, seq: a.slice() }, { op: _DIFF_INSERT, seq: b.slice() }];
  return _diffBisect(a, b);
}

function _diffBisect(a, b) {
  const n = a.length, m = b.length;
  const maxD = Math.ceil((n + m) / 2);
  const vOffset = maxD, vLength = 2 * maxD;
  const v1 = new Int32Array(vLength).fill(-1);
  const v2 = new Int32Array(vLength).fill(-1);
  v1[vOffset + 1] = 0; v2[vOffset + 1] = 0;
  const delta = n - m;
  const front = (delta % 2 !== 0);
  let k1start = 0, k1end = 0, k2start = 0, k2end = 0;
  for (let d = 0; d < maxD; d++) {
    for (let k1 = -d + k1start; k1 <= d - k1end; k1 += 2) {
      const k1Offset = vOffset + k1;
      let x1;
      if (k1 === -d || (k1 !== d && v1[k1Offset-1] < v1[k1Offset+1])) x1 = v1[k1Offset+1];
      else x1 = v1[k1Offset-1] + 1;
      let y1 = x1 - k1;
      while (x1 < n && y1 < m && a[x1] === b[y1]) { x1++; y1++; }
      v1[k1Offset] = x1;
      if (x1 > n) k1end += 2;
      else if (y1 > m) k1start += 2;
      else if (front) {
        const k2Offset = vOffset + delta - k1;
        if (k2Offset >= 0 && k2Offset < vLength && v2[k2Offset] !== -1) {
          const x2 = n - v2[k2Offset];
          if (x1 >= x2) return _diffBisectSplit(a, b, x1, y1);
        }
      }
    }
    for (let k2 = -d + k2start; k2 <= d - k2end; k2 += 2) {
      const k2Offset = vOffset + k2;
      let x2;
      if (k2 === -d || (k2 !== d && v2[k2Offset-1] < v2[k2Offset+1])) x2 = v2[k2Offset+1];
      else x2 = v2[k2Offset-1] + 1;
      let y2 = x2 - k2;
      while (x2 < n && y2 < m && a[n-x2-1] === b[m-y2-1]) { x2++; y2++; }
      v2[k2Offset] = x2;
      if (x2 > n) k2end += 2;
      else if (y2 > m) k2start += 2;
      else if (!front) {
        const k1Offset = vOffset + delta - k2;
        if (k1Offset >= 0 && k1Offset < vLength && v1[k1Offset] !== -1) {
          const x1 = v1[k1Offset];
          const y1 = vOffset + x1 - k1Offset;
          const x2real = n - x2;
          if (x1 >= x2real) return _diffBisectSplit(a, b, x1, y1);
        }
      }
    }
  }
  return [{ op: _DIFF_DELETE, seq: a.slice() }, { op: _DIFF_INSERT, seq: b.slice() }];
}

function _diffBisectSplit(a, b, x, y) {
  return _diffMain(a.slice(0, x), b.slice(0, y)).concat(_diffMain(a.slice(x), b.slice(y)));
}

function _diffCleanupMerge(diffs) {
  diffs.push({ op: _DIFF_EQUAL, seq: [] });
  let pointer = 0, countDelete = 0, countInsert = 0, textDelete = [], textInsert = [];
  while (pointer < diffs.length) {
    const d = diffs[pointer];
    if (d.op === _DIFF_INSERT) { countInsert++; textInsert = textInsert.concat(d.seq); pointer++; }
    else if (d.op === _DIFF_DELETE) { countDelete++; textDelete = textDelete.concat(d.seq); pointer++; }
    else {
      if (countDelete + countInsert > 1) {
        if (countDelete !== 0 && countInsert !== 0) {
          let cl = _commonPrefix(textInsert, textDelete);
          if (cl !== 0) {
            const x = pointer - countDelete - countInsert;
            if (x > 0 && diffs[x-1].op === _DIFF_EQUAL) diffs[x-1].seq = diffs[x-1].seq.concat(textInsert.slice(0, cl));
            else { diffs.unshift({ op: _DIFF_EQUAL, seq: textInsert.slice(0, cl) }); pointer++; }
            textInsert = textInsert.slice(cl); textDelete = textDelete.slice(cl);
          }
          cl = _commonSuffix(textInsert, textDelete);
          if (cl !== 0) {
            const insIdx = textInsert.length - cl;
            diffs[pointer].seq = textInsert.slice(insIdx).concat(diffs[pointer].seq);
            textInsert = textInsert.slice(0, insIdx); textDelete = textDelete.slice(0, textDelete.length - cl);
          }
        }
        const repl = [];
        if (textDelete.length) repl.push({ op: _DIFF_DELETE, seq: textDelete });
        if (textInsert.length) repl.push({ op: _DIFF_INSERT, seq: textInsert });
        const start = pointer - countDelete - countInsert;
        diffs.splice(start, countDelete + countInsert, ...repl);
        pointer = start + repl.length + 1;
      } else if (pointer !== 0 && diffs[pointer-1].op === _DIFF_EQUAL) {
        diffs[pointer-1].seq = diffs[pointer-1].seq.concat(d.seq);
        diffs.splice(pointer, 1);
      } else pointer++;
      countInsert = 0; countDelete = 0; textDelete = []; textInsert = [];
    }
  }
  if (diffs[diffs.length-1].seq.length === 0) diffs.pop();

  // Second pass: shift a single edit sandwiched between two equalities sideways.
  let changes = false;
  pointer = 1;
  while (pointer < diffs.length - 1) {
    const prev = diffs[pointer-1], cur = diffs[pointer], next = diffs[pointer+1];
    if (prev.op === _DIFF_EQUAL && next.op === _DIFF_EQUAL) {
      if (_hasSuffix(cur.seq, prev.seq)) {
        if (prev.seq.length) {
          cur.seq = prev.seq.concat(cur.seq.slice(0, cur.seq.length - prev.seq.length));
          next.seq = prev.seq.concat(next.seq);
        }
        diffs.splice(pointer-1, 1); changes = true;
      } else if (_hasPrefix(cur.seq, next.seq)) {
        prev.seq = prev.seq.concat(next.seq);
        cur.seq = cur.seq.slice(next.seq.length).concat(next.seq);
        diffs.splice(pointer+1, 1); changes = true;
      }
    }
    pointer++;
  }
  if (changes) return _diffCleanupMerge(diffs);
  return diffs;
}

export function normalFileDiff(left, right) {
  // Keep the terminator as part of line identity, including a missing final LF.
  const lines = text => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const a = lines(left), b = lines(right);
  const operations = _diffMain(a, b);
  const range = (first, last) => first === last ? String(first) : `${first},${last}`;
  const render = (values, prefix) => values.map(line =>
    `${prefix} ${line}${line.endsWith("\n") ? "" : "\n\\ No newline at end of file\n"}`
  ).join("");
  let oldLine = 0, newLine = 0, output = "";
  for (let i = 0; i < operations.length;) {
    if (operations[i].op === _DIFF_EQUAL) {
      oldLine += operations[i].seq.length;
      newLine += operations[i++].seq.length;
      continue;
    }
    const oldStart = oldLine, newStart = newLine;
    let removed = [], added = [];
    while (i < operations.length && operations[i].op !== _DIFF_EQUAL) {
      const change = operations[i++];
      if (change.op === _DIFF_DELETE) {
        removed = removed.concat(change.seq);
        oldLine += change.seq.length;
      } else {
        added = added.concat(change.seq);
        newLine += change.seq.length;
      }
    }
    if (!removed.length) output += `${oldStart}a${range(newStart + 1, newLine)}\n${render(added, ">")}`;
    else if (!added.length) output += `${range(oldStart + 1, oldLine)}d${newStart}\n${render(removed, "<")}`;
    else output += `${range(oldStart + 1, oldLine)}c${range(newStart + 1, newLine)}\n${render(removed, "<")}---\n${render(added, ">")}`;
  }
  return output;
}
