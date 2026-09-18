#!/usr/bin/env jsmdcui

# File List Reader / 檔案列表閱讀器

Enter a local directory or web page URL, then press Enter or choose **List**.
Tab completes local directories. 輸入本機目錄或網頁網址後按 Enter 或選擇
「列出」；Tab 可補全本機目錄。

```text#directory @keydown="directoryKey(event)"
.
```

- [List files or links / 列出檔案或連結](javascript:listDirectory())

## File List / 檔案列表

````js template
---
filelist: []
listPage: 0
---
const size = 10
const files = Array.isArray(data.filelist) ? data.filelist : []
const pages = Math.max(1, Math.ceil(files.length / size))
const page = Math.max(0, Math.min(Number(data.listPage) || 0, pages - 1))
let markdown = `Page ${page + 1} / ${pages} · ${files.length} files\n\n`
for (const file of files.slice(page * size, page * size + size)) {
  const label = String(file.name).replaceAll('\\', '\\\\').replaceAll('[', '\\[').replaceAll(']', '\\]')
  const value = encodeURIComponent(String(file.value))
  markdown += `- [${label}](javascript:selectFile(decodeURIComponent('${value}')))\n`
}
if (!files.length) markdown += '- *(No files / 沒有檔案)*\n'
return markdown
````

## Selected File/URL 已選檔案/網址

```text#selected

```

## Controls / 控制

| Previous page | Page | Go | Next page | Clear selection |
| --- | --- | --- | --- | --- |
| [上一頁](javascript:changeListPage(-1)) | 1 | [跳轉](javascript:jumpListPage(this)) | [下一頁](javascript:changeListPage(1)) | [清除已選](javascript:clearSelection()) |
| [🚀載入](javascript:loadSelected()) | [⏮上一章](javascript:loadRelative(-1)) | [⏭下一章](javascript:loadRelative(1)) | [⏹停止朗讀](javascript:stopReading()) | [📢朗讀](javascript:readFromCurrentPage()) |

## Document Reader / 文件閱讀器
- asdf = prev page
- hjkl = next page

### More info click 'M' 更多說明按'M'

Focus the reader and use the left half of QWERTY, Left/Up, or PageUp for the
previous page. Use the right half of QWERTY, Right/Down, or PageDown for the
next page.

將遊標放在閱讀框；QWERTY 左半邊、左／上方向鍵或 PageUp 切到上一頁，右半邊、
右／下方向鍵或 PageDown 切到下一頁。

To replace text while loading, use `replace.json`. For a local file, place it
beside that file; for a URL, place it in `process.cwd()`. It is parsed as JSON5
and must contain an array of two-item arrays. The first item is passed to
`new RegExp(target, "g")`; the second item is inserted as literal replacement
text. Invalid or unparseable rules are ignored.

載入本機檔案時，可在檔案同一目錄放置 `replace.json`；載入 URL 時則使用
`process.cwd()` 下的 `replace.json`。檔案會以 JSON5 解析，格式為二項陣列所組成
的陣列；第一項會傳給 `new RegExp(target, "g")`，第二項是純文字取代結果。
無效或無法解析時會忽略規則並正常載入原文。

```json5
[
  ["old\\s+name", "new name"],
  ["第[零〇]章", "序章"],
]
```

Button translations / 按鈕翻譯:

- `上一頁` — Previous page
- `跳轉` — Go to the entered page
- `下一頁` — Next page
- `清除已選` — Clear selection
- `🚀載入` — Load the selected file or URL
- `⏮上一章` — Previous chapter
- `⏭下一章` — Next chapter
- `⏹停止朗讀` — Stop reading aloud
- `📢朗讀` — Start reading aloud from the current page
- `速度` — Speech speed
- `音高` — Speech pitch
- `套用` — Apply

### Document content

```textarea#reader @keydown.prevent="readerKey(event)"












```

### Reader controls / 閱讀控制

| Prev page / Speed | Page | Go / Pitch | Next page |
| --- | --- | --- | --- |
| [上一頁](javascript:previousReaderPage()) | 1 | [跳轉](javascript:jumpReaderPage(this)) | [下一頁](javascript:nextReaderPage()) |
| 速度: [1.5](javascript:applySpeechSetting(this,'speed',false)) | [套用 / Apply](javascript:applySpeechSetting(this,'speed')) | 音高: [1.0](javascript:applySpeechSetting(this,'pitch',false)) | [套用 / Apply](javascript:applySpeechSetting(this,'pitch')) |

```text#reader-status
Not loaded / 尚未載入
```

```js front
const PAGE_ROWS = 12;
const PAGE_COLUMNS = 64;
const LEFT_KEYS = new Set([
  ...'`12345qwerasdfgzxcvb',
  'escape', 'tab',
]);
const RIGHT_KEYS = new Set([
  ...'67890-=uiop[]\\hjkl;\'nm,./',
  'backspace', 'enter', 'delete', 'home', 'end',
]);

let pages = [''];
let pageIndex = 0;
let selectedIndex = -1;
let readingRevision = 0;
let loadedSource = '';
let speechSpeed = 1.5;
let speechPitch = 1.0;

function message(text) {
  $('#reader-status').val(String(text));
}

function fileState() {
  return $('#file-list').data();
}

function pageCount() {
  return Math.max(1, Math.ceil((fileState().filelist?.length || 0) / 10));
}

function selectedValue() {
  return $('#selected').val().trim();
}

function wrapText(text) {
  const rows = [];
  for (const rawLine of String(text ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const characters = [...rawLine];
    if (!characters.length) {
      rows.push('');
      continue;
    }
    for (let offset = 0; offset < characters.length; offset += PAGE_COLUMNS)
      rows.push(characters.slice(offset, offset + PAGE_COLUMNS).join(''));
  }
  if (!rows.length) rows.push('');
  const result = [];
  for (let offset = 0; offset < rows.length; offset += PAGE_ROWS)
    result.push(rows.slice(offset, offset + PAGE_ROWS).join('\n'));
  return result.length ? result : [''];
}

function showReaderPage(nextPage = pageIndex) {
  pageIndex = Math.max(0, Math.min(Number(nextPage) || 0, pages.length - 1));
  const rows = String(pages[pageIndex] ?? '').split('\n');
  while (rows.length < PAGE_ROWS) rows.push('');
  $('#reader').val(rows.slice(0, PAGE_ROWS).join('\n'));
  $('#reader-controls').cell(1, 1).text(String(pageIndex + 1));
  message(`${loadedSource || 'Reader'} · Page ${pageIndex + 1} / ${pages.length}`);
}

function trailingNumber(text) {
  const match = String(text ?? '').trim().match(/(-?(?:\d+(?:\.\d*)?|\.\d+))\s*$/u);
  return match ? Number(match[1]) : NaN;
}

export function jumpReaderPage(link) {
  const value = trailingNumber($(link).parent()?.left()?.text());
  if (!Number.isFinite(value)) {
    message('Invalid page number / 頁碼無效');
    return;
  }
  showReaderPage(Math.trunc(value) - 1);
}

export function applySpeechSetting(link, kind, fromLeft = true) {
  const cell = $(link).parent();
  const value = trailingNumber((fromLeft ? cell?.left() : cell)?.text());
  if (!Number.isFinite(value) || value <= 0) {
    message(`Invalid ${kind} / ${kind === 'speed' ? '速度' : '音高'}無效`);
    return;
  }
  if (kind === 'speed') speechSpeed = value;
  else speechPitch = value;
  message(`${kind === 'speed' ? 'Speed / 速度' : 'Pitch / 音高'}: ${value}`);
}

function sentences(text) {
  return String(text ?? '')
    .split(/(?<=[.!?。！？…；;])\s*|[\r\n]+/u)
    .map(value => value.trim())
    .filter(Boolean);
}

export async function onMdcuiLoad() {
  $("#more-info-click-m-m").hide();
  await listDirectory();
  showReaderPage(0);
}

export function directoryKey(event) {
  if (event.key === 'Tab') {
    event.preventDefault();
    return completeDirectory();
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    return listDirectory();
  }
}

export async function completeDirectory() {
  try {
    const result = await rpc.completeReaderDirectory($('#directory').val());
    if (result.matches > 0) $('#directory').val(result.directory);
    message(result.matches > 0
      ? `Directory completion: ${result.matches} match${result.matches === 1 ? '' : 'es'}`
      : 'No matching directory / 找不到符合的目錄');
  } catch (error) {
    message(`Completion failed: ${error?.message || error}`);
  }
}

export async function listDirectory() {
  try {
    const result = await rpc.listReaderDirectory($('#directory').val().trim());
    $('#directory').val(result.directory);
    selectedIndex = -1;
    $('#file-list').data({ filelist: result.files, listPage: 0 });
    $('#controls').cell(1, 1).text('1');
    message(`Listed ${result.files.length} files from ${result.directory}`);
  } catch (error) {
    message(`List failed: ${error?.message || error}`);
  }
}

export function selectFile(value) {
  const files = fileState().filelist || [];
  selectedIndex = files.findIndex(file => file.value === value);
  $('#selected').val(value);
  if (selectedIndex >= 0) setListPage(Math.floor(selectedIndex / 10));
  message(`Selected: ${value}`);
}

function setListPage(nextPage) {
  const data = fileState();
  const next = Math.max(0, Math.min(Number(nextPage) || 0, pageCount() - 1));
  $('#file-list').data('listPage', next);
  $('#controls').cell(1, 1).text(String(next + 1));
}

export function changeListPage(delta) {
  setListPage((Number(fileState().listPage) || 0) + delta);
}

export function jumpListPage(link) {
  const value = trailingNumber($(link).parent()?.left()?.text());
  if (!Number.isFinite(value)) {
    message('Invalid list page number / 檔案列表頁碼無效');
    return;
  }
  setListPage(Math.trunc(value) - 1);
}

export function selectRelative(delta) {
  const files = fileState().filelist || [];
  if (!files.length) return;
  if (selectedIndex < 0) {
    const current = selectedValue();
    selectedIndex = files.findIndex(file => file.value === current);
  }
  selectedIndex = Math.max(0, Math.min(
    selectedIndex < 0 ? (delta > 0 ? 0 : files.length - 1) : selectedIndex + delta,
    files.length - 1,
  ));
  selectFile(files[selectedIndex].value);
}

export function clearSelection() {
  selectedIndex = -1;
  $('#selected').val('');
  message('Selection cleared / 已清除選取');
}

function numberedSibling(value, delta) {
  const source = String(value ?? '');
  const suffixAt = source.search(/[?#]/u);
  const path = suffixAt < 0 ? source : source.slice(0, suffixAt);
  const suffix = suffixAt < 0 ? '' : source.slice(suffixAt);
  const separatorAt = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  const directory = path.slice(0, separatorAt + 1);
  const filename = path.slice(separatorAt + 1);
  const matches = [...filename.matchAll(/\d+/gu)];
  const match = matches.at(-1);
  if (!match) return null;
  const current = BigInt(match[0]);
  const next = current + BigInt(delta);
  if (next < 0n) return null;
  const replacement = String(next).padStart(match[0].length, '0');
  return directory
    + filename.slice(0, match.index)
    + replacement
    + filename.slice(match.index + match[0].length)
    + suffix;
}

export async function loadSelected() {
  const value = selectedValue();
  if (!value) {
    message('Load failed: select a file or enter a URL first');
    return;
  }
  stopReading();
  try {
    const result = await rpc.loadReaderResource(value);
    loadedSource = result.source;
    pages = wrapText(result.text);
    pageIndex = 0;
    showReaderPage(0);
  } catch (error) {
    message(`Load failed: ${error?.message || error}`);
  }
}

export async function loadRelative(delta) {
  const numbered = numberedSibling(selectedValue(), delta);
  if (numbered) selectFile(numbered);
  else selectRelative(delta);
  await loadSelected();
}

export function previousReaderPage() {
  showReaderPage(pageIndex - 1);
}

export function nextReaderPage() {
  showReaderPage(pageIndex + 1);
}

export function readerKey(event) {
  const key = String(event.key ?? '').toLowerCase();
  if (key === 'pageup' || key === 'arrowleft' || key === 'arrowup' || LEFT_KEYS.has(key)) {
    previousReaderPage();
  } else if (
    key === 'pagedown' || key === 'arrowright' || key === 'arrowdown' || RIGHT_KEYS.has(key)
  ) {
    nextReaderPage();
  }
}

export function stopReading() {
  readingRevision++;
  $.tts.stop?.();
  message('Reading stopped / 已停止朗讀');
}

export function readFromCurrentPage() {
  const revision = ++readingRevision;
  void runReading(revision);
}

async function runReading(revision) {
  for (let current = pageIndex; current < pages.length; current++) {
    if (revision !== readingRevision) return;
    showReaderPage(current);
    for (const sentence of sentences(pages[current])) {
      if (revision !== readingRevision) return;
      const error = await $.tts(sentence, speechPitch, speechSpeed);
      if (error) {
        message(error);
        return;
      }
    }
  }
  if (revision === readingRevision)
    message(`Reading complete: ${loadedSource}`);
}
```

```js back
import { readdir } from 'node:fs/promises';
import { basename, dirname, resolve, sep } from 'node:path';

export async function completeReaderDirectory(input) {
  const raw = String(input ?? '').trim();
  if (/^https?:\/\//iu.test(raw)) return { directory: raw, matches: 0 };
  const resolved = resolve(raw || process.cwd());
  const endsWithSeparator = /[\\/]$/u.test(raw);
  const parent = endsWithSeparator ? resolved : dirname(resolved);
  const prefix = endsWithSeparator ? '' : basename(resolved);
  const entries = await readdir(parent, { withFileTypes: true });
  const matches = entries
    .filter(entry => entry.isDirectory() && entry.name.startsWith(prefix))
    .map(entry => entry.name)
    .sort((left, right) => left.localeCompare(right));
  if (!matches.length) return { directory: raw, matches: 0 };
  let common = matches[0];
  for (const name of matches.slice(1)) {
    let length = 0;
    while (length < common.length && common[length] === name[length]) length++;
    common = common.slice(0, length);
  }
  let directory = common ? resolve(parent, common) : `${resolved}${sep}`;
  if (matches.length === 1) directory += sep;
  return { directory, matches: matches.length };
}

export async function listReaderDirectory(input) {
  const value = String(input ?? '').trim();
  if (/^https?:\/\//iu.test(value)) {
    const response = await fetch(value);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    const directory = response.url || value;
    const links = [];
    let currentLink = null;
    await new HTMLRewriter()
      .on('a[href]', {
        element(element) {
          const href = element.getAttribute('href')?.trim();
          currentLink = href ? { href, text: '' } : null;
          if (currentLink) links.push(currentLink);
        },
        text(chunk) {
          if (currentLink) currentLink.text += chunk.text;
        },
      })
      .transform(response)
      .text();
    const seen = new Set();
    const files = [];
    for (const link of links) {
      let url;
      try { url = new URL(link.href, directory); } catch { continue; }
      if (!/^https?:$/iu.test(url.protocol) || seen.has(url.href)) continue;
      seen.add(url.href);
      files.push({ name: link.text.trim() || link.href, value: url.href });
    }
    return { directory, files };
  }
  const directory = resolve(value || process.cwd());
  const entries = await readdir(directory, { withFileTypes: true });
  const files = entries
    .filter(entry => entry.isFile())
    .map(entry => ({
      name: entry.name,
      value: resolve(directory, entry.name),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  return { directory, files };
}

async function applyReaderReplacements(text, directory) {
  const replacementFile = Bun.file(resolve(directory, 'replace.json'));
  if (!await replacementFile.exists()) return text;
  try {
    const rules = Bun.JSON5.parse(await replacementFile.text());
    if (!Array.isArray(rules)) return text;
    for (const rule of rules) {
      if (!Array.isArray(rule) || rule.length !== 2) continue;
      try {
        const pattern = new RegExp(String(rule[0]), 'g');
        const replacement = String(rule[1]);
        text = text.replace(pattern, () => replacement);
      } catch {}
    }
  } catch {}
  return text;
}

export async function loadReaderResource(input) {
  const value = String(input ?? '').trim();
  if (!value) throw new Error('Select a file or enter a URL first');
  if (/^https?:\/\//iu.test(value)) {
    const response = await fetch(value);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    return {
      source: response.url || value,
      text: await applyReaderReplacements(await response.text(), process.cwd()),
    };
  }
  const source = resolve(value);
  const file = Bun.file(source);
  if (!await file.exists()) throw new Error(`File not found: ${source}`);
  return {
    source,
    text: await applyReaderReplacements(await file.text(), dirname(source)),
  };
}
```
