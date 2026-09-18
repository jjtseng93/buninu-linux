import { existsSync, mkdirSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { dirname, join, basename, extname } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { assetPath, hasInternalAssets, listInternalAssetDirs, listInternalAssetPaths, readInternalAssetBytes } from "../../single-exe/assetsHelper.js";
import { isMdcuiEncoding } from "../runtime/encodings.js";
import { newMessage, newMessageAtLine, MTError, MTWarning, MTInfo } from "../buffer/message.js";
import { Loc } from "../buffer/loc.js";
import { renderMarkdownWithHeadingIds } from "../cui/heading-ids.mjs";
import { isMdcuiId, parseMdcuiIdentity, parseMdcuiIdSelector } from "../cui/identity.mjs";
import { updateAnsiTaskCheckbox } from "../cui/task-checkbox.mjs";
import {
  colorAnsiPlainRange,
  replaceAnsiPlainRange,
  replaceAnsiPlainRangePreservingControls,
} from "../cui/table-row-edit.mjs";
import { renderTuiComponentMarkdown } from "../cui/template-components.mjs";
import { markTuiTableStripeStyles } from "../cui/table-render.mjs";
import { refreshTuiLinkIndex } from "../cui/tui-links.mjs";

// ── Action registry ──────────────────────────────────────────────────────────

const ACTIONS = new Map();
const INTERNAL_JSPLUGIN_STAGE_ROOT = join(tmpdir(), "bunmicro-jsplugins");
let internalJsPluginStagePromise = null;

function reg(name, fn) { ACTIONS.set(name, fn); }

function stageInternalJsPlugins() {
  if (!internalJsPluginStagePromise) {
    internalJsPluginStagePromise = _stageInternalJsPlugins().catch((error) => {
      console.error("# failed to stage internal JS plugins");
      console.error(error);
      return null;
    });
  }
  return internalJsPluginStagePromise;
}

async function _stageInternalJsPlugins() {
  const prefix = assetPath("runtime", "jsplugins");
  const paths = listInternalAssetPaths(prefix);
  if (paths.length === 0) return null;

  mkdirSync(INTERNAL_JSPLUGIN_STAGE_ROOT, { recursive: true });
  await Bun.write(join(INTERNAL_JSPLUGIN_STAGE_ROOT, "package.json"), JSON.stringify({ type: "module" }));

  for (const assetPathName of paths) {
    const bytes = readInternalAssetBytes(assetPathName);
    if (!bytes) continue;
    const stagedPath = join(INTERNAL_JSPLUGIN_STAGE_ROOT, ...assetPathName.split("/"));
    mkdirSync(dirname(stagedPath), { recursive: true });
    await Bun.write(stagedPath, bytes);
  }

  return INTERNAL_JSPLUGIN_STAGE_ROOT;
}

function _actIndentStr(buf) {
  if (buf?.Settings?.tabstospaces) return " ".repeat(buf?.Settings?.tabsize ?? 4);
  return "\t";
}

function _actExtendSel(app, moveFn) {
  const pane = app.pane;
  const buf = app.buffer;
  if (!pane || !buf) return;
  const anchor = pane.selection?.start ?? { ...buf.cursor };
  moveFn(buf);
  const end = { ...buf.cursor };
  const same = anchor?.x === end?.x && anchor?.y === end?.y;
  pane.selection = same ? null : { start: anchor, end };
}

function _actSelBounds(sel) {
  const a = sel.start, b = sel.end;
  const first = (a.y < b.y || (a.y === b.y && a.x <= b.x)) ? a : b;
  const last = first === a ? b : a;
  return { first, last };
}

function registerBuiltinActions() {
  // Cursor movement
  reg("CursorUp",              (app) => { app.pane && (app.pane.selection = null); app.buffer?._moveUpVisual?.() ?? app.buffer?.moveUp(); });
  reg("CursorDown",            (app) => { app.pane && (app.pane.selection = null); app.buffer?._moveDownVisual?.() ?? app.buffer?.moveDown(); });
  reg("CursorLeft",            (app) => { app.pane && (app.pane.selection = null); app.buffer?.moveLeft(); });
  reg("CursorRight",           (app) => { app.pane && (app.pane.selection = null); app.buffer?.moveRight(); });
  reg("WordRight",             (app) => { app.pane && (app.pane.selection = null); app.buffer?.moveWordRight(); });
  reg("WordLeft",              (app) => { app.pane && (app.pane.selection = null); app.buffer?.moveWordLeft(); });
  reg("CursorWordRight",       (app) => { app.pane && (app.pane.selection = null); app.buffer?.moveWordRight(); });
  reg("CursorWordLeft",        (app) => { app.pane && (app.pane.selection = null); app.buffer?.moveWordLeft(); });
  reg("StartOfLine",           (app) => { app.pane && (app.pane.selection = null); app.buffer?.moveHome(); });
  reg("StartOfText",           (app) => { app.pane && (app.pane.selection = null); app.buffer?.moveStartOfText(); });
  reg("StartOfTextToggle",     (app) => { app.pane && (app.pane.selection = null); app.buffer?.moveStartOfTextToggle(); });
  reg("EndOfLine",             (app) => { app.pane && (app.pane.selection = null); app.buffer?.moveEnd(); });
  reg("CursorStart",           (app) => { app.pane && (app.pane.selection = null); app.buffer?.moveStartOfBuffer(); app.scrollCursorToBoundary?.(app.pane, "start"); });
  reg("CursorEnd",             (app) => { app.pane && (app.pane.selection = null); app.buffer?.moveEndOfBuffer();   app.scrollCursorToBoundary?.(app.pane, "end");   });
  reg("ParagraphPrevious",     (app) => { app.pane && (app.pane.selection = null); app.buffer?.paragraphPrevious(); });
  reg("ParagraphNext",         (app) => { app.pane && (app.pane.selection = null); app.buffer?.paragraphNext(); });
  reg("PageUp",                (app) => { app.pane && (app.pane.selection = null); app.pageScroll?.(app.pane, -1); });
  reg("PageDown",              (app) => { app.pane && (app.pane.selection = null); app.pageScroll?.(app.pane, 1); });

  // Selection — extend
  reg("SelectUp",              (app) => _actExtendSel(app, (buf) => buf._moveUpVisual?.() ?? buf.moveUp?.()));
  reg("SelectDown",            (app) => _actExtendSel(app, (buf) => buf._moveDownVisual?.() ?? buf.moveDown?.()));
  reg("SelectLeft",            (app) => _actExtendSel(app, (buf) => buf.moveLeft?.()));
  reg("SelectRight",           (app) => _actExtendSel(app, (buf) => buf.moveRight?.()));
  reg("SelectWordRight",       (app) => _actExtendSel(app, (buf) => buf.moveWordRight?.()));
  reg("SelectWordLeft",        (app) => _actExtendSel(app, (buf) => buf.moveWordLeft?.()));
  reg("SelectToStartOfText",   (app) => _actExtendSel(app, (buf) => buf.moveStartOfText?.()));
  reg("SelectToStartOfTextToggle", (app) => _actExtendSel(app, (buf) => buf.moveStartOfTextToggle?.()));
  reg("SelectToStartOfLine",   (app) => _actExtendSel(app, (buf) => buf.moveHome?.()));
  reg("SelectToEndOfLine",     (app) => _actExtendSel(app, (buf) => buf.moveEnd?.()));
  reg("SelectToStart",         (app) => _actExtendSel(app, (buf) => buf.moveStartOfBuffer?.()));
  reg("SelectToEnd",           (app) => _actExtendSel(app, (buf) => buf.moveEndOfBuffer?.()));
  reg("SelectPageUp",          (app) => app.cursorPage?.(app.pane, -1, { select: true }));
  reg("SelectPageDown",        (app) => app.cursorPage?.(app.pane, 1, { select: true }));
  reg("SelectToParagraphPrevious", (app) => _actExtendSel(app, (buf) => buf.paragraphPrevious?.()));
  reg("SelectToParagraphNext",     (app) => _actExtendSel(app, (buf) => buf.paragraphNext?.()));

  // Selection — whole-range
  reg("SelectAll", (app) => {
    const buf = app.buffer;
    const pane = app.pane;
    if (!buf || !pane) return;
    const end = { x: buf.lines.at(-1)?.length ?? 0, y: buf.lines.length - 1 };
    pane.selection = { start: { x: 0, y: 0 }, end };
    buf.cursor = { ...end };
  });
  reg("SelectLine", (app) => {
    const buf = app.buffer;
    const pane = app.pane;
    if (!buf || !pane) return;
    const y = buf.cursor.y;
    pane.selection = { start: { x: 0, y }, end: { x: buf.lines[y]?.length ?? 0, y } };
    buf.cursor = { ...pane.selection.end };
  });
  reg("Deselect", (app) => { if (app.pane) app.pane.selection = null; });

  // Indent/Outdent with selection support
  reg("IndentSelection", (app) => {
    const buf = app.buffer;
    const pane = app.pane;
    if (!buf) return;
    if (!pane?.selection) { buf.insertTab?.(); return; }
    buf.pushUndo?.();
    const indent = _actIndentStr(buf);
    const { first, last } = _actSelBounds(pane.selection);
    for (let y = first.y; y <= last.y; y++) {
      if ((buf.lines[y] ?? "").length > 0) buf.lines[y] = indent + (buf.lines[y] ?? "");
    }
    buf.invalidateHighlightFrom?.(first.y, { force: first.y !== last.y });
    pane.selection = {
      start: { ...pane.selection.start, x: pane.selection.start.x > 0 ? pane.selection.start.x + indent.length : pane.selection.start.x },
      end: { ...pane.selection.end, x: pane.selection.end.x + indent.length },
    };
    buf.cursor = { ...buf.cursor, x: buf.cursor.x + indent.length };
    buf.ensureCursor?.();
    buf.modified = true;
  });
  reg("OutdentSelection", (app) => {
    const buf = app.buffer;
    const pane = app.pane;
    if (!buf) return;
    if (!pane?.selection) {
      // outdent current line
      const indent = _actIndentStr(buf);
      const line = buf.lines[buf.cursor.y] ?? "";
      buf.pushUndo?.();
      let n = 0;
      if (line.startsWith(indent)) n = indent.length;
      else if (line.startsWith("\t")) n = 1;
      else { while (n < indent.length && line[n] === ' ') n++; }
      if (n > 0) {
        buf.lines[buf.cursor.y] = line.slice(n);
        buf.cursor.x = Math.max(0, buf.cursor.x - n);
        buf.invalidateHighlightFrom?.(buf.cursor.y);
        buf.modified = true;
      }
      return;
    }
    buf.pushUndo?.();
    const indent = _actIndentStr(buf);
    const { first, last } = _actSelBounds(pane.selection);
    for (let y = first.y; y <= last.y; y++) {
      const line = buf.lines[y] ?? "";
      let n = 0;
      if (line.startsWith(indent)) n = indent.length;
      else if (line.startsWith("\t")) n = 1;
      else { while (n < indent.length && line[n] === ' ') n++; }
      if (n > 0) buf.lines[y] = line.slice(n);
    }
    buf.invalidateHighlightFrom?.(first.y, { force: first.y !== last.y });
    pane.selection = {
      start: { ...pane.selection.start, x: Math.max(0, pane.selection.start.x - indent.length) },
      end: { ...pane.selection.end, x: Math.max(0, pane.selection.end.x - indent.length) },
    };
    buf.cursor = { ...buf.cursor, x: Math.max(0, buf.cursor.x - indent.length) };
    buf.ensureCursor?.();
    buf.modified = true;
  });
  reg("IndentLine", (app) => {
    const buf = app.buffer;
    if (!buf || app.pane?.selection) return;
    buf.pushUndo?.();
    const indent = _actIndentStr(buf);
    buf.lines[buf.cursor.y] = indent + (buf.lines[buf.cursor.y] ?? "");
    buf.cursor.x += indent.length;
    buf.invalidateHighlightFrom?.(buf.cursor.y);
    buf.modified = true;
  });
  reg("OutdentLine", (app) => {
    const buf = app.buffer;
    if (!buf || app.pane?.selection) return;
    const indent = _actIndentStr(buf);
    const line = buf.lines[buf.cursor.y] ?? "";
    buf.pushUndo?.();
    let n = 0;
    if (line.startsWith(indent)) n = indent.length;
    else if (line.startsWith("\t")) n = 1;
    else { while (n < indent.length && line[n] === ' ') n++; }
    if (n > 0) {
      buf.lines[buf.cursor.y] = line.slice(n);
      buf.cursor.x = Math.max(0, buf.cursor.x - n);
      buf.invalidateHighlightFrom?.(buf.cursor.y);
      buf.modified = true;
    }
  });
  // Aliases for OutdentSelection / OutdentLine
  reg("DedentSelection",   (app) => ACTIONS.get("OutdentSelection")(app));
  reg("UnindentSelection", (app) => ACTIONS.get("OutdentSelection")(app));
  reg("DedentLine",        (app) => ACTIONS.get("OutdentLine")(app));
  reg("UnindentLine",      (app) => ACTIONS.get("OutdentLine")(app));

  // Editing
  reg("Backspace",          (app) => app.buffer?.backspace());
  reg("Delete",             (app) => app.buffer?.deleteForward());
  reg("InsertNewline",      (app) => app.buffer?.newline());
  reg("InsertTab",          (app) => app.buffer?.insertTab());
  reg("Undo",               (app) => app.buffer?.undo());
  reg("Redo",               (app) => app.buffer?.redo());
  reg("DeleteWordLeft",     (app) => { app.buffer?.pushUndo?.(); app.buffer?.moveWordLeft && (() => { const start = {...app.buffer.cursor}; app.buffer.moveWordLeft(); const end = {...app.buffer.cursor}; if (start.y !== end.y || start.x !== end.x) { app.buffer.lines[end.y] = (app.buffer.lines[end.y] ?? "").slice(0, end.x) + (app.buffer.lines[start.y] ?? "").slice(start.x); app.buffer.invalidateHighlightFrom?.(end.y); app.buffer.modified = true; } })(); });
  reg("DeleteWordRight",    (app) => { app.buffer?.pushUndo?.(); if (app.buffer?.moveWordRight) { const start = {...app.buffer.cursor}; app.buffer.moveWordRight(); const end = {...app.buffer.cursor}; if (start.y !== end.y || start.x !== end.x) { app.buffer.lines[start.y] = (app.buffer.lines[start.y] ?? "").slice(0, start.x) + (app.buffer.lines[end.y] ?? "").slice(end.x); app.buffer.cursor = {...start}; app.buffer.invalidateHighlightFrom?.(start.y); app.buffer.modified = true; } } });

  // Line operations
  reg("MoveLinesUp", (app) => {
    const buf = app.buffer;
    const pane = app.pane;
    if (!buf) return;
    buf.pushUndo?.();
    if (pane?.selection) {
      const { first, last } = _actSelBounds(pane.selection);
      if (first.y === 0) return;
      const moved = buf.lines.splice(first.y - 1, 1)[0];
      buf.lines.splice(last.y, 0, moved);
      pane.selection = {
        start: { ...pane.selection.start, y: pane.selection.start.y - 1 },
        end: { ...pane.selection.end, y: pane.selection.end.y - 1 },
      };
      buf.cursor = { ...buf.cursor, y: buf.cursor.y - 1 };
      buf.invalidateHighlightFrom?.(first.y - 1, { force: true });
    } else {
      if (buf.cursor.y === 0) return;
      const y = buf.cursor.y;
      [buf.lines[y - 1], buf.lines[y]] = [buf.lines[y], buf.lines[y - 1]];
      buf.cursor.y--;
      buf.invalidateHighlightFrom?.(y - 1, { force: true });
    }
    buf.modified = true;
  });
  reg("MoveLinesDown", (app) => {
    const buf = app.buffer;
    const pane = app.pane;
    if (!buf) return;
    buf.pushUndo?.();
    if (pane?.selection) {
      const { first, last } = _actSelBounds(pane.selection);
      if (last.y >= buf.lines.length - 1) return;
      const moved = buf.lines.splice(last.y + 1, 1)[0];
      buf.lines.splice(first.y, 0, moved);
      pane.selection = {
        start: { ...pane.selection.start, y: pane.selection.start.y + 1 },
        end: { ...pane.selection.end, y: pane.selection.end.y + 1 },
      };
      buf.cursor = { ...buf.cursor, y: buf.cursor.y + 1 };
      buf.invalidateHighlightFrom?.(first.y, { force: true });
    } else {
      if (buf.cursor.y >= buf.lines.length - 1) return;
      const y = buf.cursor.y;
      [buf.lines[y], buf.lines[y + 1]] = [buf.lines[y + 1], buf.lines[y]];
      buf.cursor.y++;
      buf.invalidateHighlightFrom?.(y, { force: true });
    }
    buf.modified = true;
  });
  reg("DuplicateLine", (app) => {
    const buf = app.buffer;
    if (!buf) return;
    const line = buf.lines[buf.cursor.y];
    buf.lines.splice(buf.cursor.y + 1, 0, line);
    buf.cursor.y++;
    buf.invalidateHighlightFrom?.(buf.cursor.y, { force: true });
    buf.modified = true;
  });
  reg("DeleteLine", (app) => app.buffer?.cutLine());

  // Clipboard — delegate to handleCommand so clipboard manager is used
  reg("Copy",    (app) => app.handleCommand?.("copy"));
  reg("CopyLine",(app) => app.handleCommand?.("copy"));
  reg("Cut",     (app) => app.handleCommand?.("cut"));
  reg("Paste",   (app) => app.handleCommand?.("paste"));
  reg("CutLine", (app) => app.handleCommand?.("cutline"));

  // Comment
  reg("ToggleComment", (app) => app.toggleComment?.());

  // File / tab
  reg("Save",        async (app) => app.save?.());
  reg("SaveAs",      (app) => app.openCommandMode?.());
  reg("Quit",        async (app) => app.quit?.());
  reg("AddTab",      async (app) => app.addTab?.());
  reg("NextTab",     (app) => app.nextTab?.());
  reg("PrevTab",     (app) => app.previousTab?.());
  reg("PreviousTab", (app) => app.previousTab?.());

  // View / search
  reg("Find",        (app) => app.handleCommand?.("find"));
  reg("CommandMode", (app) => app.openCommandMode?.());
  reg("ShellMode",   (app) => app.openShellMode?.());
  reg("ToggleHelp",  (app) => app.toggleHelp?.());
  reg("ToggleRuler", (app) => {
    const buf = app.buffer; if (!buf) return;
    buf.Settings = buf.Settings ?? {};
    buf.Settings.ruler = !(buf.Settings.ruler ?? true);
    app.message = buf.Settings.ruler ? "Enabled ruler" : "Disabled ruler";
  });

  // Scroll without moving cursor
  reg("ScrollUp",    (app) => { if (app.buffer) app.buffer.scroll.y = Math.max(0, (app.buffer.scroll.y ?? 0) - 3); });
  reg("ScrollDown",  (app) => { if (app.buffer) app.buffer.scroll.y = (app.buffer.scroll.y ?? 0) + 3; });

  // Start / End — move cursor + scroll to buffer boundary
  reg("Start", (app) => { app.pane && (app.pane.selection = null); app.buffer?._lastVisX != null && (app.buffer._lastVisX = null); app.buffer?.moveStartOfBuffer(); app.scrollCursorToBoundary?.(app.pane, "start"); });
  reg("End",   (app) => { app.pane && (app.pane.selection = null); app.buffer?._lastVisX != null && (app.buffer._lastVisX = null); app.buffer?.moveEndOfBuffer();   app.scrollCursorToBoundary?.(app.pane, "end");   });

  // Page aliases
  reg("CursorPageUp",    (app) => app.cursorPage?.(app.pane, -1));
  reg("CursorPageDown",  (app) => app.cursorPage?.(app.pane, 1));
  reg("HalfPageUp",      (app) => app.cursorPage?.(app.pane, -1, { amount: Math.max(1, Math.floor((app.pane?.h ?? 24) / 2)) }));
  reg("HalfPageDown",    (app) => app.cursorPage?.(app.pane, 1, { amount: Math.max(1, Math.floor((app.pane?.h ?? 24) / 2)) }));

  // Cursor-to-view-boundary
  reg("CursorToViewTop", (app) => {
    const buf = app.buffer; if (!buf) return;
    app.pane && (app.pane.selection = null);
    buf.cursor.y = Math.min(buf.lines.length - 1, Math.max(0, buf.scroll.y ?? 0));
    buf.ensureCursor?.();
  });
  reg("CursorToViewCenter", (app) => {
    const buf = app.buffer; if (!buf) return;
    app.pane && (app.pane.selection = null);
    buf.cursor.y = Math.min(buf.lines.length - 1, Math.max(0, (buf.scroll.y ?? 0) + Math.floor((app.pane?.h ?? 24) / 2)));
    buf.ensureCursor?.();
  });
  reg("CursorToViewBottom", (app) => {
    const buf = app.buffer; if (!buf) return;
    app.pane && (app.pane.selection = null);
    buf.cursor.y = Math.min(buf.lines.length - 1, Math.max(0, (buf.scroll.y ?? 0) + (app.pane?.h ?? 24) - 1));
    buf.ensureCursor?.();
  });

  // Center — scroll so cursor is vertically centered
  reg("Center", (app) => {
    const buf = app.buffer; if (!buf) return;
    buf.scroll.y = Math.max(0, buf.cursor.y - Math.floor((app.pane?.h ?? 24) / 2));
    buf.scroll.row = 0;
  });

  // Search
  reg("FindNext",     (app) => { app.buffer?.searchNext?.(); });
  reg("FindPrevious", (app) => { app.buffer?.searchPrev?.(); });
  reg("FindLiteral",  (app) => { app.buffer?.searchNext?.(); });
  reg("ToggleHighlightSearch", (app) => {
    const buf = app.buffer; if (!buf) return;
    buf.Settings = buf.Settings ?? {};
    buf.Settings.hlsearch = !(buf.Settings.hlsearch ?? false);
    app.message = buf.Settings.hlsearch ? "Enabled search highlight" : "Disabled search highlight";
  });
  reg("UnhighlightSearch", (app) => { if (app.buffer) { app.buffer.searchPattern = ""; } });
  reg("ResetSearch",       (app) => { if (app.buffer) { app.buffer.searchPattern = ""; } });

  // Diff navigation (requires app.diffNext/diffPrevious added to App class)
  reg("DiffNext",     (app) => app.diffNext?.());
  reg("DiffPrevious", (app) => app.diffPrevious?.());

  // Duplicate selection or line
  reg("Duplicate", (app) => {
    const buf = app.buffer; const pane = app.pane; if (!buf) return;
    buf.pushUndo?.();
    if (pane?.selection) {
      const { first, last } = _actSelBounds(pane.selection);
      const selLines = buf.lines;
      const getText = () => {
        if (first.y === last.y) return (selLines[first.y] ?? "").slice(first.x, last.x);
        const parts = [(selLines[first.y] ?? "").slice(first.x)];
        for (let i = first.y + 1; i < last.y; i++) parts.push(selLines[i] ?? "");
        parts.push((selLines[last.y] ?? "").slice(0, last.x));
        return parts.join("\n");
      };
      const selText = getText();
      const parts = selText.split("\n");
      const line = buf.lines[last.y] ?? "";
      const right = line.slice(last.x);
      if (parts.length === 1) {
        buf.lines[last.y] = line.slice(0, last.x) + parts[0] + right;
        buf.cursor = { y: last.y, x: last.x + parts[0].length };
        buf.invalidateHighlightFrom?.(last.y);
      } else {
        buf.lines[last.y] = line.slice(0, last.x) + parts[0];
        buf.lines.splice(last.y + 1, 0, ...parts.slice(1, -1), parts.at(-1) + right);
        buf.cursor = { y: last.y + parts.length - 1, x: parts.at(-1).length };
        buf.invalidateHighlightFrom?.(last.y, { force: true });
      }
      pane.selection = null;
      buf.modified = true;
    } else {
      const lineText = buf.lines[buf.cursor.y] ?? "";
      buf.lines.splice(buf.cursor.y + 1, 0, lineText);
      buf.invalidateHighlightFrom?.(buf.cursor.y, { force: true });
      buf.cursor = { y: buf.cursor.y + 1, x: lineText.length };
      buf.modified = true;
    }
  });

  // Retab — re-indent all lines to match tabstospaces/tabsize setting
  reg("Retab", (app) => {
    const buf = app.buffer; if (!buf) return;
    const tabsize = Math.max(1, buf.Settings?.tabsize ?? 4);
    const toSpaces = buf.Settings?.tabstospaces ?? false;
    buf.pushUndo?.();
    for (let y = 0; y < buf.lines.length; y++) {
      const line = buf.lines[y];
      let i = 0; let col = 0;
      while (i < line.length && (line[i] === " " || line[i] === "\t")) {
        if (line[i] === "\t") col = Math.floor(col / tabsize) * tabsize + tabsize;
        else col++;
        i++;
      }
      if (i === 0) continue;
      const newIndent = toSpaces ? " ".repeat(col) : "\t".repeat(Math.floor(col / tabsize)) + " ".repeat(col % tabsize);
      if (newIndent !== line.slice(0, i)) {
        buf.lines[y] = newIndent + line.slice(i);
        buf.invalidateHighlightFrom?.(y);
      }
    }
    buf.modified = true;
    buf.ensureCursor?.();
    app.message = `Retabbed (${toSpaces ? "spaces" : "tabs"}, size ${tabsize})`;
  });

  // Autocomplete
  reg("Autocomplete",          (app) => { if (app.buffer?.acHas) app.buffer.cycleAutocomplete?.(true); else app.buffer?.startBufferComplete?.(); });
  reg("CycleAutocompleteBack", (app) => { app.buffer?.cycleAutocomplete?.(false); });

  // Tab navigation
  reg("FirstTab", (app) => app.setActiveTab?.(0));
  reg("LastTab",  (app) => app.setActiveTab?.((app.tabs?.length ?? 1) - 1));

  // Split pane navigation
  reg("NextSplit",     (app) => { const panes = app.tab?.panes(); if (panes?.length > 1) app.tab.activePane = panes[(panes.indexOf(app.tab.activePane) + 1) % panes.length]; });
  reg("PreviousSplit", (app) => { const panes = app.tab?.panes(); if (panes?.length > 1) app.tab.activePane = panes[(panes.indexOf(app.tab.activePane) - 1 + panes.length) % panes.length]; });
  reg("FirstSplit",    (app) => { const panes = app.tab?.panes(); if (panes?.length) app.tab.activePane = panes[0]; });
  reg("LastSplit",     (app) => { const panes = app.tab?.panes(); if (panes?.length) app.tab.activePane = panes[panes.length - 1]; });

  // Split actions (delegate to handleCommand for buffer opening)
  reg("VSplitAction", async (app) => app.handleCommand?.("vsplit"));
  reg("HSplitAction", async (app) => app.handleCommand?.("hsplit"));
  reg("Unsplit", async (app) => {
    if ((app.tab?.panes().length ?? 0) > 1)
      await app.closePane?.(app.pane);
  });

  // File operations
  reg("OpenFile",  (app) => app.openCommandMode?.("open "));
  reg("SaveAll",   async (app) => {
    let saved = 0;
    for (const tab of (app.tabs ?? [])) {
      for (const pane of (tab.panes?.() ?? [])) {
        if (pane?.buffer?.modified) {
          try { await pane.buffer.save?.(); saved++; } catch {}
        }
      }
    }
    app.message = saved > 0 ? `Saved ${saved} file${saved === 1 ? "" : "s"}` : "Nothing to save";
  });
  reg("JumpLine",            (app) => app.openCommandMode?.("goto "));
  reg("JumpToMatchingBrace", (app) => app.jumpToMatchingBrace?.());

  // Quit actions
  reg("ForceQuit", async (app) => app.stop?.(0));
  reg("QuitAll",   async (app) => {
    for (const tab of (app.tabs ?? []))
      for (const pane of (tab.panes?.() ?? []))
        if (pane?.buffer?.modified) try { await pane.buffer.save?.(); } catch {}
    await app.stop?.(0);
  });
  reg("Escape", (app) => app._dispatchInput?.(new TextEncoder().encode("\x1b")));

  // Toggle settings
  reg("ToggleDiffGutter", (app) => {
    const buf = app.buffer; if (!buf) return;
    buf.Settings = buf.Settings ?? {};
    buf.Settings.diffgutter = !(buf.Settings.diffgutter ?? false);
    app.message = buf.Settings.diffgutter ? "Enabled diff gutter" : "Disabled diff gutter";
  });
  reg("ToggleKeyMenu", (app) => { app.keymenu = !(app.keymenu ?? false); });
  reg("ToggleOverwriteMode", (app) => {
    const buf = app.buffer; if (!buf) return;
    buf._overwrite = !buf._overwrite;
    app.message = buf._overwrite ? "Overwrite mode on" : "Overwrite mode off";
  });

  // Paste from primary selection (X11/Wayland middle-click clipboard)
  reg("PastePrimary", (app) => {
    const pasted = app.clipboard?.read?.("primary");
    if (!pasted) return;
    const buf = app.buffer; if (!buf) return;
    buf.pushUndo?.();
    if (app.pane?.selection) _deleteSel(buf, app.pane);
    buf.insert?.(pasted);
    app.message = "Pasted from primary selection";
  });

  // Status/info
  reg("ClearInfo",   (app) => { app.message = ""; if (app.buffer) app.buffer.message = ""; });
  reg("ClearStatus", (app) => { app.message = ""; if (app.buffer) app.buffer.message = ""; });
  reg("None",        () => {});

  // SubWord — stub: treated as word movement (no sub-word segmentation implemented)
  reg("SubWordLeft",         (app) => { app.pane && (app.pane.selection = null); app.buffer?.moveWordLeft?.(); });
  reg("SubWordRight",        (app) => { app.pane && (app.pane.selection = null); app.buffer?.moveWordRight?.(); });
  reg("SelectSubWordLeft",   (app) => _actExtendSel(app, (buf) => buf.moveWordLeft?.()));
  reg("SelectSubWordRight",  (app) => _actExtendSel(app, (buf) => buf.moveWordRight?.()));
}

// Register all built-in actions at module load time
registerBuiltinActions();

// ── Public action API ────────────────────────────────────────────────────────

const EDIT_LOCKED_ACTIONS = new Set([
  "IndentSelection", "OutdentSelection", "IndentLine", "OutdentLine",
  "DedentSelection", "UnindentSelection", "DedentLine", "UnindentLine",
  "Backspace", "Delete", "InsertNewline", "InsertTab", "Undo", "Redo",
  "DeleteWordLeft", "DeleteWordRight",
  "MoveLinesUp", "MoveLinesDown", "DuplicateLine", "DeleteLine",
  "Cut", "Paste", "CutLine", "ToggleComment", "Duplicate", "Retab", "PastePrimary",
]);

export async function runAction(name, app) {
  const fn = ACTIONS.get(name);
  if (!fn) return false;
  if (app?.buffer?.isEditLocked?.() && EDIT_LOCKED_ACTIONS.has(name)) return true;
  await fn(app);
  return true;
}

export function listActions() {
  return [...ACTIONS.keys()].sort();
}

// ── JsPluginManager ──────────────────────────────────────────────────────────

export class JsPluginManager {
  constructor() {
    this._hooks  = new Map();   // hookName → fn[]
    this.commands = new Map();
    this._loaded = [];          // { path, name, error? }
    this._app    = null;
    this._ctx    = null;
    // registerBuiltinActions() already called at module load time
  }

  setApp(app)     { this._app = app; }
  setContext(ctx) { this._ctx = ctx; }

  // Register a hook handler from a JS plugin
  on(hookName, fn) {
    if (!this._hooks.has(hookName)) this._hooks.set(hookName, []);
    this._hooks.get(hookName).push(fn);
  }

  // Dispatch a hook to all JS handlers (fire-and-forget style like Lua run)
  async run(hookName, ...args) {
    for (const fn of (this._hooks.get(hookName) ?? [])) {
      try { await fn(...args); } catch (e) { console.error(`[jsplugin] ${hookName}:`, e.message); }
    }
  }

  async runBool(hookName, ...args) {
    let ok = true;
    for (const fn of (this._hooks.get(hookName) ?? [])) {
      try {
        if (await fn(...args) === false) ok = false;
      } catch (e) { console.error(`[jsplugin] ${hookName}:`, e.message); }
    }
    return ok;
  }

  // Scan and load all JS plugins from given directories
  async loadFrom(dirs) {
    for (const { dir, builtin } of dirs) {
      if (builtin && hasInternalAssets()) {
        const loadedFromAssets = await this._loadFromInternalAssets(dir, builtin);
        if (loadedFromAssets) continue;
      }
      if (!existsSync(dir)) continue;
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const plugDir = join(dir, entry.name);
        const mainJs = join(plugDir, `${entry.name}.js`);
        if (!existsSync(mainJs)) continue;
        await this._loadFile(mainJs, entry.name, builtin);
      }
    }
  }

  async _loadFromInternalAssets(dir, builtin) {
    const prefix = assetPath("runtime", "jsplugins");
    const stageRoot = await stageInternalJsPlugins();
    if (!stageRoot) return false;

    const pluginNames = listInternalAssetDirs(prefix);
    if (pluginNames.length === 0) return false;

    let loadedAny = false;
    for (const pluginName of pluginNames) {
      const stagedMainPath = join(stageRoot, prefix, pluginName, `${pluginName}.js`);
      if (!existsSync(stagedMainPath)) continue;
      try {
        await import(pathToFileURL(stagedMainPath).href);
        this._loaded.push({ path: assetPath(prefix, pluginName, `${pluginName}.js`), name: pluginName, builtin, loaded: true });
        loadedAny = true;
      } catch (e) {
        this._loaded.push({ path: assetPath(prefix, pluginName, `${pluginName}.js`), name: pluginName, builtin, loaded: false, error: e.message });
        console.error(`[jsplugin] failed to load ${pluginName}: ${e.message}`);
      }
    }
    return loadedAny;
  }

  async _loadFile(path, name, builtin) {
    try {
      await import(path);
      this._loaded.push({ path, name, builtin, loaded: true });
    } catch (e) {
      this._loaded.push({ path, name, builtin, loaded: false, error: e.message });
      console.error(`[jsplugin] failed to load ${name}: ${e.message}`);
    }
  }

  list() { return this._loaded; }
}

// ── Selection helpers (used by micro.getSelection / micro.putSelection) ──────

function _selBounds(sel) {
  const a = sel.start, b = sel.end;
  const first = (a.y < b.y || (a.y === b.y && a.x <= b.x)) ? a : b;
  const last  = first === a ? b : a;
  return { first, last };
}

function _selText(buf, sel) {
  const { first, last } = _selBounds(sel);
  if (first.y === last.y) return buf.lines[first.y]?.slice(first.x, last.x) ?? "";
  const parts = [buf.lines[first.y]?.slice(first.x) ?? ""];
  for (let i = first.y + 1; i < last.y; i++) parts.push(buf.lines[i] ?? "");
  parts.push(buf.lines[last.y]?.slice(0, last.x) ?? "");
  return parts.join("\n");
}

function _deleteSel(buf, pane) {
  const sel = pane.selection;
  if (!sel) return;
  const { first, last } = _selBounds(sel);
  if (first.y === last.y) {
    buf.lines[first.y] = (buf.lines[first.y] ?? "").slice(0, first.x) + (buf.lines[first.y] ?? "").slice(last.x);
  } else {
    const a = (buf.lines[first.y] ?? "").slice(0, first.x);
    const b = (buf.lines[last.y]  ?? "").slice(last.x);
    buf.lines.splice(first.y, last.y - first.y + 1, a + b);
  }
  buf.invalidateHighlightFrom?.(first.y, { force: first.y !== last.y });
  buf.cursor = { x: first.x, y: first.y };
  pane.selection = null;
  buf.modified = true;
  buf.ensureCursor?.();
}

// ── mdcui block selector ────────────────────────────────────────────────────

function _parseBlockIdentity(input, { selector = false } = {}) {
  return parseMdcuiIdentity(input, { selector });
}

function _blockHeader(line) {
  const text = String(line ?? "");
  const framed = text.match(/^(\s*)(┌─|╭─|\+-)\s*(\S+)\s*$/);
  if (framed) {
    const identity = _parseBlockIdentity(framed[3]);
    return identity
      ? { kind: "framed", indent: framed[1], bodyMarker: framed[2] === "+-" ? "|" : "│", ...identity }
      : null;
  }

  const fenced = text.match(/^(\s*)(`{3,})\s*(\S+)\s*$/);
  if (fenced) {
    const identity = _parseBlockIdentity(fenced[3]);
    return identity
      ? { kind: "fenced", indent: fenced[1], fenceLength: fenced[2].length, ...identity }
      : null;
  }

  return null;
}

function _matchesBlock(header, selector) {
  if (selector.tag && header.tag !== selector.tag) return false;
  if (selector.id && header.id !== selector.id) return false;
  return selector.classes.every((name) => header.classes.includes(name));
}

function _findBlock(lines, selector) {
  for (let start = 0; start < lines.length; start++) {
    const header = _blockHeader(lines[start]);
    if (!header || !_matchesBlock(header, selector)) continue;

    for (let y = start + 1; y < lines.length; y++) {
      const line = String(lines[y] ?? "");
      const rest = line.startsWith(header.indent)
        ? line.slice(header.indent.length)
        : line;

      if (header.kind === "fenced") {
        const closing = rest.match(/^(`{3,})\s*$/);
        if (closing && closing[1].length >= header.fenceLength)
          return { start, end: y, header };
        continue;
      }

      if (/^(?:└─|╰─|\+-)\s*$/.test(rest))
        return { start, end: y, header };
    }
    return { start, end: lines.length, header };
  }
  return null;
}

export function findTuiBlockAtLine(lines, lineIndex) {
  return findTuiBlockInIndex(buildTuiBlockIndex(lines), lineIndex);
}

export function buildTuiBlockIndex(lines, declarations = null) {
  const blocks = [];
  for (let start = 0; start < lines.length; start++) {
    const header = _blockHeader(lines[start]);
    if (!header) continue;
    let end = lines.length;
    for (let y = start + 1; y < lines.length; y++) {
      const line = String(lines[y] ?? "");
      const rest = line.startsWith(header.indent)
        ? line.slice(header.indent.length)
        : line;
      if (header.kind === "fenced") {
        const closing = rest.match(/^(`{3,})\s*$/);
        if (!closing || closing[1].length < header.fenceLength) continue;
      } else if (!/^(?:└─|╰─|\+-)\s*$/.test(rest)) {
        continue;
      }
      end = y;
      break;
    }
    const declaration = header.id ? declarations?.get(header.id) : null;
    if (
      declarations == null
      || (
        declaration?.tag === header.tag
        && declaration.events?.size > 0
      )
    ) blocks.push({ start, end, header });
    start = Math.max(start, end);
  }
  return blocks;
}

export function findTuiBlockInIndex(blocks, lineIndex) {
  let low = 0;
  let high = blocks.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const block = blocks[middle];
    if (lineIndex <= block.start) high = middle - 1;
    else if (lineIndex >= block.end) low = middle + 1;
    else return block;
  }
  return null;
}

function _blockValue(lines, selector) {
  const block = _findBlock(lines, selector);
  if (!block) return undefined;
  const value = [];
  for (let y = block.start + 1; y < block.end; y++) {
    const line = String(lines[y] ?? "");
    const rest = line.startsWith(block.header.indent)
      ? line.slice(block.header.indent.length)
      : line;
    if (block.header.kind === "fenced") value.push(rest);
    else {
      const body = rest.match(/^(?:│|\|)(?: ?)(.*)$/);
      value.push(body ? body[1] : rest);
    }
  }
  return value.join("\n");
}

function _headingSelectorId(input) {
  if (input !== null && typeof input === "object") {
    const id = String(input.id ?? "");
    return isMdcuiId(id) ? id : null;
  }
  return parseMdcuiIdSelector(input);
}

function _sameHeadingContainer(left, right) {
  const leftPath = left?.containerPath ?? [];
  const rightPath = right?.containerPath ?? [];
  return (
    leftPath.length === rightPath.length
    && leftPath.every((container, index) => container === rightPath[index])
  );
}

function _headingContainerContains(containerHeading, candidate) {
  const containerPath = containerHeading?.containerPath ?? [];
  const candidatePath = candidate?.containerPath ?? [];
  return (
    candidatePath.length >= containerPath.length
    && containerPath.every(
      (container, index) => container === candidatePath[index],
    )
  );
}

function _tuiSourceHeadings(buffer) {
  const markdown = buffer?._mdcuiTuiSourceText;
  if (markdown == null || typeof Bun?.markdown?.html !== "function") return [];
  const cached = buffer?._mdcuiSourceHeadingIndex;
  if (cached?.source === markdown) return cached.headings;

  const result = renderMarkdownWithHeadingIds(markdown).headings.map(
    heading => ({ ...heading }),
  );

  for (const heading of result) {
    heading.endOrdinal = result.length;
    for (
      let ordinal = heading.ordinal + 1;
      ordinal < result.length;
      ordinal++
    ) {
      const candidate = result[ordinal];
      if (
        !_headingContainerContains(heading, candidate)
        || (
          _sameHeadingContainer(heading, candidate)
          && candidate.level <= heading.level
        )
      ) {
        heading.endOrdinal = ordinal;
        break;
      }
    }
  }

  if (buffer && typeof buffer === "object") {
    buffer._mdcuiSourceHeadingIndex = {
      source: markdown,
      headings: result,
    };
  }
  return result;
}

function _findHeading(buffer, selector) {
  const id = _headingSelectorId(selector);
  if (!id) return undefined;
  return _tuiSourceHeadings(buffer).find(heading => heading.id === id);
}

let _headingAnsiPrefixes;
function _tuiHeadingAnsiPrefixes() {
  if (_headingAnsiPrefixes) return _headingAnsiPrefixes;
  const marker = "MDCUI_HEADING_LINE_PROBE";
  _headingAnsiPrefixes = new Map();
  for (let level = 1; level <= 6; level++) {
    const rendered = String(Bun.markdown.ansi(
      `${"#".repeat(level)} ${marker}`,
      { hyperlinks: true, columns: 80 },
    ));
    const line = rendered.split("\n").find((item) => item.includes(marker));
    if (line) _headingAnsiPrefixes.set(level, line.slice(0, line.indexOf(marker)));
  }
  return _headingAnsiPrefixes;
}

function _headingTuiLine(buffer, heading) {
  if (!heading) return 0;
  const exact = _tuiHeadingRowIndex(buffer).byOrdinal.get(heading.ordinal);
  return exact?.id === heading.id && exact.level === heading.level
    ? exact.row + 1
    : 0;
}

function _hiddenTuiHeadingAncestors(buffer, heading) {
  if (!heading || !(buffer?._mdcuiIdStore instanceof Map)) return [];

  const hiddenAncestors = [];
  for (const [id, record] of buffer._mdcuiIdStore) {
    const state = record?.headingVisibility;
    if (
      state?.hidden &&
      Number.isInteger(state.ordinal) &&
      state.ordinal < heading.ordinal
    ) hiddenAncestors.push({ id, ordinal: state.ordinal });
  }
  if (hiddenAncestors.length === 0) return [];

  const sourceHeadings = _tuiSourceHeadings(buffer);
  const result = [];
  for (const hidden of hiddenAncestors) {
    const ancestor = sourceHeadings[hidden.ordinal];
    if (!ancestor || ancestor.id !== hidden.id) continue;

    if (heading.ordinal < ancestor.endOrdinal)
      result.push({ id: hidden.id, heading: ancestor });
  }
  return result.sort((a, b) => a.heading.ordinal - b.heading.ordinal);
}

function _headingHasHiddenTuiAncestor(buffer, heading) {
  return _hiddenTuiHeadingAncestors(buffer, heading).length > 0;
}

function _tuiHeadingLines(buffer) {
  const ansiText = buffer?._mdcuiAnsiText;
  if (typeof ansiText !== "string") return [];
  const prefixes = _tuiHeadingAnsiPrefixes();
  const tuiHeadings = [];
  for (const [lineIndex, line] of ansiText.split("\n").entries()) {
    for (const [level, prefix] of prefixes) {
      const prefixIndex = line.indexOf(prefix);
      if (prefixIndex < 0) continue;
      const visiblePrefix = Bun.stripANSI(line.slice(0, prefixIndex));
      if (!/^[\s│|]*$/u.test(visiblePrefix)) continue;
      tuiHeadings.push({
        level,
        line: lineIndex + 1,
        column: visiblePrefix.length,
        prefix: visiblePrefix,
      });
      break;
    }
  }
  return tuiHeadings;
}

function _visibleTuiSourceHeadings(buffer, sourceHeadings) {
  const hidden = new Set();
  if (buffer?._mdcuiIdStore instanceof Map) {
    for (const [id, record] of buffer._mdcuiIdStore) {
      const state = record?.headingVisibility;
      const heading = sourceHeadings[state?.ordinal];
      if (
        state?.hidden
        && Number.isInteger(state.ordinal)
        && heading?.id === id
      ) hidden.add(state.ordinal);
    }
  }

  const visible = [];
  let concealedUntil = 0;
  for (const heading of sourceHeadings) {
    if (heading.ordinal < concealedUntil) continue;
    visible.push(heading);
    if (hidden.has(heading.ordinal))
      concealedUntil = heading.endOrdinal;
  }
  return visible;
}

function _replaceTuiHeadingRowEntries(buffer, index, entries) {
  entries.sort((a, b) => a.row - b.row);
  index.entries = entries;
  index.byRow.clear();
  index.byOrdinal.clear();
  for (const [position, entry] of entries.entries()) {
    entry.position = position;
    index.byRow.set(entry.row, entry);
    index.byOrdinal.set(entry.ordinal, entry);
  }
  index.ansiText = buffer?._mdcuiAnsiText;
  index.lines = buffer?.lines;
  index.lineCount = buffer?.lines?.length ?? 0;
  return index;
}

function _buildTuiHeadingRowIndex(buffer) {
  const sourceHeadings = _tuiSourceHeadings(buffer);
  const renderedHeadings = _tuiHeadingLines(buffer);
  const visibleHeadings = _visibleTuiSourceHeadings(buffer, sourceHeadings);
  const valid = (
    visibleHeadings.length === renderedHeadings.length
    && visibleHeadings.every((heading, index) =>
      heading.level === renderedHeadings[index].level
    )
  );
  const index = {
    source: buffer?._mdcuiTuiSourceText,
    ansiText: buffer?._mdcuiAnsiText,
    lines: buffer?.lines,
    lineCount: buffer?.lines?.length ?? 0,
    valid,
    entries: [],
    byRow: new Map(),
    byOrdinal: new Map(),
  };
  if (valid) {
    _replaceTuiHeadingRowEntries(
      buffer,
      index,
      visibleHeadings.map((heading, position) => ({
        ...heading,
        row: renderedHeadings[position].line - 1,
        column: renderedHeadings[position].column,
        prefix: renderedHeadings[position].prefix,
      })),
    );
  }
  if (buffer && typeof buffer === "object")
    buffer._mdcuiHeadingRowIndex = index;
  return index;
}

function _tuiHeadingRowIndex(buffer) {
  const cached = buffer?._mdcuiHeadingRowIndex;
  if (
    cached
    && cached.source === buffer?._mdcuiTuiSourceText
    && cached.ansiText === buffer?._mdcuiAnsiText
    && cached.lines === buffer?.lines
    && cached.lineCount === (buffer?.lines?.length ?? 0)
  ) return cached;
  return _buildTuiHeadingRowIndex(buffer);
}

export function indexTuiHeadingRows(buffer) {
  return _tuiHeadingRowIndex(buffer);
}

export function navigateTuiHeadingFragment(buffer, href) {
  const value = String(href ?? "");
  if (!value.startsWith("#") || value.length === 1) return false;

  let id;
  try {
    id = decodeURIComponent(value.slice(1));
  } catch {
    return false;
  }
  if (!id) return false;

  const heading = _tuiSourceHeadings(buffer).find(item => item.id === id);
  if (!heading) return false;
  const rendered = _tuiHeadingRowIndex(buffer).byOrdinal.get(heading.ordinal);
  if (
    !rendered
    || rendered.id !== heading.id
    || rendered.level !== heading.level
  ) return false;

  buffer.cursor = {
    x: rendered.column,
    y: rendered.row,
  };
  buffer.allowCursorOffscreen = false;
  buffer.ensureCursor?.();
  return true;
}

function _cachedTuiHeadingRowIndex(buffer) {
  const cached = buffer?._mdcuiHeadingRowIndex;
  return (
    cached?.valid
    && cached.source === buffer?._mdcuiTuiSourceText
    && cached.ansiText === buffer?._mdcuiAnsiText
    && cached.lines === buffer?.lines
    && cached.lineCount === (buffer?.lines?.length ?? 0)
  ) ? cached : null;
}

function _tuiRenderedContainerPrefix(line) {
  const text = String(line ?? "");
  const prefix = text.match(/^[ \t│|]*/u)?.[0] ?? "";
  let quoteDepth = 0;
  for (const character of prefix) {
    if (character === "│" || character === "|") quoteDepth++;
  }
  return {
    contentColumn: prefix.length,
    empty: prefix.length === text.length,
    quoteDepth,
  };
}

function _tuiRenderedTaskCheckbox(line, expectedQuoteDepth = null) {
  // Matching the heading's quote depth keeps table-cell borders from looking
  // like task-list container markers.
  const match = String(line ?? "").match(
    /^((?:[ \t]*[│|])*[ \t]*)([☐☒])(?:[ \t]+|$)(.*)$/u,
  );
  if (!match) return null;
  const quoteDepth = [...match[1]]
    .filter(character => character === "│" || character === "|")
    .length;
  if (
    Number.isInteger(expectedQuoteDepth)
    && quoteDepth !== expectedQuoteDepth
  ) return null;
  return {
    checked: match[2] === "☒",
    column: match[1].length,
    prefix: match[1],
    quoteDepth,
    value: match[3],
  };
}

function _headingCheckboxValue(buffer, heading, id) {
  const list = _tuiHeadingTaskList(buffer, heading);
  if (!list) return id.startsWith("select") ? null : [];
  const selected = [];
  for (const item of list.items) {
    const checkbox = _tuiRenderedTaskCheckbox(
      buffer.lines[item.start],
      list.quoteDepth,
    );
    if (!checkbox?.checked) continue;
    if (id.startsWith("select")) return item.value;
    selected.push(item.value);
  }
  return id.startsWith("select") ? null : selected;
}

function _tuiIdStore(buffer) {
  if (!(buffer?._mdcuiIdStore instanceof Map))
    buffer._mdcuiIdStore = new Map();
  return buffer._mdcuiIdStore;
}

function _tuiIdRecord(buffer, id) {
  const store = _tuiIdStore(buffer);
  let record = store.get(id);
  if (!record) {
    record = {};
    store.set(id, record);
  }
  return record;
}

function _tuiUserData(buffer, id) {
  if (!buffer || !id) return undefined;
  const record = _tuiIdRecord(buffer, id);
  if (!record.data || typeof record.data !== "object")
    record.data = Object.create(null);
  return record.data;
}

function _removeTuiUserData(buffer, id, keys) {
  if (!buffer || !id) return;
  const store = _tuiIdStore(buffer);
  const record = store.get(id);
  if (!record?.data) return;
  if (keys.length === 0) delete record.data;
  else {
    for (const key of keys) delete record.data[key];
  }
  if (Object.keys(record).length === 0) store.delete(id);
}

const _renderingTuiComponentRecords = new WeakSet();

export function markdownImageSignature(markdown) {
  return [...String(markdown ?? "").matchAll(/!\[[^\]]*\]\(([^)]+)\)/gu)]
    .map((match) => match[1].trim())
    .join("\0");
}

function _renderTuiHeadingComponents(buffer, id) {
  const record = buffer?._mdcuiIdStore?.get(id);
  if (!record || _renderingTuiComponentRecords.has(record) || !Array.isArray(record.components))
    return false;
  let changed = false;
  _renderingTuiComponentRecords.add(record);
  try {
    for (const component of record.components) {
      if (!component || typeof component.render !== "function") continue;
      const rendered = String(component.render.call(component, record.data) ?? "");
      if (rendered === component.last) continue;
      const oldImageSignature = markdownImageSignature(component.last);
      const newImageSignature = markdownImageSignature(rendered);
      // Replacing a component removes its old per-line Kitty metadata. Even if
      // the destinations are unchanged, prepare the frame again whenever the
      // changed component contains an image.
      const imagesAffected = oldImageSignature !== newImageSignature
        || oldImageSignature !== "";
      const start = buffer.lines.findIndex(line =>
        String(line ?? "").includes(component.marker?.start)
      );
      const end = buffer.lines.findIndex((line, index) =>
        index > start && String(line ?? "").includes(component.marker?.end)
      );
      if (start < 0 || end < 0) continue;
      const replacement = renderTuiComponentMarkdown(
        component,
        rendered,
        buffer._mdcuiRenderWidth || 80,
      );
      if (!replacement) continue;
      const styled = buffer._parseAnsiStyledText?.(replacement.ansi.join("\n"));
      if (styled?.styleLines)
        markTuiTableStripeStyles(styled.styleLines, replacement.lines);
      spliceTuiBufferLines(buffer, start + 1, end - start - 1, replacement.lines, {
        ansi: replacement.ansi,
        styles: styled?.styleLines,
        markModified: false,
      });
      component.last = rendered;
      if (imagesAffected) {
        buffer._mdcuiImagesDirty = true;
        buffer._mdcuiImagesRevision = (buffer._mdcuiImagesRevision ?? 0) + 1;
      }
      changed = true;
    }
    if (changed) refreshTuiLinkIndex(buffer);
  } finally {
    _renderingTuiComponentRecords.delete(record);
  }
  return changed;
}

function _takeTuiTaskListAnchors(buffer, start, end) {
  const anchors = [];
  const stored = buffer?._mdcuiHeadingTaskListAnchors;
  if (!(stored instanceof Map)) return anchors;

  for (const [ordinal, anchor] of stored) {
    if (!anchor || anchor.index < start || anchor.index >= end) continue;
    anchors.push({
      ordinal,
      anchor: { ...anchor, index: anchor.index - start },
    });
    stored.delete(ordinal);
  }
  return anchors;
}

function _restoreTuiTaskListAnchors(buffer, start, anchors) {
  if (!Array.isArray(anchors) || anchors.length === 0) return;
  if (!(buffer._mdcuiHeadingTaskListAnchors instanceof Map))
    buffer._mdcuiHeadingTaskListAnchors = new Map();

  for (const entry of anchors) {
    if (!entry?.anchor || !Number.isInteger(entry.anchor.index)) continue;
    buffer._mdcuiHeadingTaskListAnchors.set(entry.ordinal, {
      ...entry.anchor,
      index: start + entry.anchor.index,
    });
  }
}

export function clearTuiSourceDependentState(buffer) {
  if (!buffer || typeof buffer !== "object") return;

  if (buffer._mdcuiIdStore instanceof Map) {
    for (const [id, record] of buffer._mdcuiIdStore) {
      if (!record || typeof record !== "object") {
        buffer._mdcuiIdStore.delete(id);
        continue;
      }
      delete record.headingVisibility;
      if (Object.keys(record).length === 0)
        buffer._mdcuiIdStore.delete(id);
    }
  }

  delete buffer._mdcuiMutationMacros;
  delete buffer._mdcuiDirtyTableCells;
  buffer._mdcuiReplayingMutations = false;
  buffer._mdcuiHeadingTaskListAnchors = null;
  buffer._mdcuiRerenderMismatch = null;
  buffer._mdcuiFenceBlockIndex = null;
  buffer._mdcuiControlBlockIndex = null;
  buffer._mdcuiSourceHeadingIndex = null;
  buffer._mdcuiHeadingRowIndex = null;
}

function _tuiHeadingContainerEndRow(buffer, heading) {
  const lines = buffer?.lines;
  if (
    !Array.isArray(lines)
    || !Array.isArray(heading?.containerPath)
    || heading.containerPath.length === 0
  ) return lines?.length ?? 0;

  const prefix = String(heading.prefix ?? "");
  if (!prefix) return lines.length;
  const required = _tuiRenderedContainerPrefix(prefix);

  for (let row = heading.row + 1; row < lines.length; row++) {
    const candidate = _tuiRenderedContainerPrefix(lines[row]);
    if (candidate.quoteDepth < required.quoteDepth) return row;
    if (candidate.empty) continue;
    if (candidate.contentColumn < required.contentColumn) return row;
  }
  return lines.length;
}

function _hideTuiHeadingSection(buffer, heading, id) {
  if (!buffer || !heading || !id || !Array.isArray(buffer.lines)) return false;
  const store = _tuiIdStore(buffer);
  if (store.get(id)?.headingVisibility?.hidden) return true;

  const headingIndex = _tuiHeadingRowIndex(buffer);
  const renderedHeading = headingIndex.byOrdinal.get(heading.ordinal);
  if (
    !headingIndex.valid
    || renderedHeading?.id !== id
    || renderedHeading.level !== heading.level
  ) return false;

  let next = null;
  const sectionHeadings = [];
  for (
    let position = renderedHeading.position + 1;
    position < headingIndex.entries.length;
    position++
  ) {
    const candidate = headingIndex.entries[position];
    if (
      !_headingContainerContains(renderedHeading, candidate)
      || (
        _sameHeadingContainer(renderedHeading, candidate)
        && candidate.level <= heading.level
      )
    ) {
      next = candidate;
      break;
    }
    sectionHeadings.push(candidate);
  }

  // Starting after the zero-based heading row keeps the heading itself and
  // removes only its generated section body.
  const start = renderedHeading.row + 1;
  const end = Math.min(
    next ? next.row : buffer.lines.length,
    _tuiHeadingContainerEndRow(buffer, renderedHeading),
  );
  const deleteCount = Math.max(0, end - start);
  const ansiLines = typeof buffer._mdcuiAnsiText === "string"
    ? buffer._mdcuiAnsiText.split("\n")
    : null;
  const segment = {
    lines: buffer.lines.slice(start, end),
    styles: Array.isArray(buffer._ansiStyleLines)
      ? buffer._ansiStyleLines.slice(start, end)
      : null,
    ansi: ansiLines?.slice(start, end) ?? null,
    images: Array.isArray(buffer._mdcuiImages)
      ? buffer._mdcuiImages
        .filter(image => image.line >= start && image.line < end)
        .map(image => ({ ...image, line: image.line - start }))
      : [],
    anchors: _takeTuiTaskListAnchors(buffer, start, end),
    headings: sectionHeadings
      .filter(candidate => candidate.row < end)
      .map((candidate) => ({
        ...candidate,
        row: candidate.row - start,
      })),
  };

  const modified = buffer.modified;
  spliceTuiBufferLines(buffer, start, deleteCount, []);
  buffer.modified = modified;
  _tuiIdRecord(buffer, id).headingVisibility = {
    hidden: true,
    ordinal: heading.ordinal,
    segment,
  };
  return true;
}

function _showTuiHeadingSection(buffer, heading, id) {
  if (!buffer || !heading || !id || !Array.isArray(buffer.lines)) return false;
  const store = _tuiIdStore(buffer);
  const record = store.get(id);
  const state = record?.headingVisibility;
  if (!state?.hidden) return true;

  const headingLine = _headingTuiLine(buffer, heading);
  if (!headingLine) return false;
  const segment = state.segment;
  const modified = buffer.modified;
  spliceTuiBufferLines(buffer, headingLine, 0, segment.lines, {
    styles: segment.styles ?? undefined,
    ansi: segment.ansi ?? undefined,
    headings: segment.headings ?? undefined,
  });
  if (Array.isArray(buffer._mdcuiImages) && segment.images.length > 0) {
    buffer._mdcuiImages.push(
      ...segment.images.map(image => ({ ...image, line: headingLine + image.line })),
    );
    buffer._mdcuiImages.sort((a, b) => a.line - b.line);
  }
  _restoreTuiTaskListAnchors(buffer, headingLine, segment.anchors);
  buffer.modified = modified;
  delete record.headingVisibility;
  if (Object.keys(record).length === 0) store.delete(id);
  return true;
}

function _changeTuiHeadingSectionVisibility(buffer, heading, id, action) {
  if (!buffer || !heading || !id) return false;
  const expandedAncestors = [];
  try {
    for (const ancestor of _hiddenTuiHeadingAncestors(buffer, heading)) {
      if (!_showTuiHeadingSection(buffer, ancestor.heading, ancestor.id))
        return false;
      expandedAncestors.push(ancestor);
    }

    if (action === "show")
      return _showTuiHeadingSection(buffer, heading, id);
    if (action === "hide")
      return _hideTuiHeadingSection(buffer, heading, id);
    if (action === "toggle") {
      const hidden = _tuiIdStore(buffer).get(id)?.headingVisibility?.hidden;
      return hidden
        ? _showTuiHeadingSection(buffer, heading, id)
        : _hideTuiHeadingSection(buffer, heading, id);
    }
    return false;
  } finally {
    for (const ancestor of expandedAncestors.reverse())
      _hideTuiHeadingSection(buffer, ancestor.heading, ancestor.id);
  }
}

export function toggleTuiHeadingAt(buffer, y, x) {
  if (!buffer || !Array.isArray(buffer.lines)) return false;
  const row = Math.trunc(Number(y));
  const column = Math.trunc(Number(x));
  if (row < 0 || row >= buffer.lines.length) return false;
  const heading = _tuiHeadingRowIndex(buffer).byRow.get(row);
  if (!heading?.id || column !== heading.column) return false;

  const state = _tuiIdStore(buffer).get(heading.id)?.headingVisibility;
  return state?.hidden
    ? _showTuiHeadingSection(buffer, heading, heading.id)
    : _hideTuiHeadingSection(buffer, heading, heading.id);
}

function _tuiHeadingTaskList(buffer, heading) {
  if (!heading || _headingHasHiddenTuiAncestor(buffer, heading)) return null;
  const savedAnchor = buffer?._mdcuiHeadingTaskListAnchors?.get(heading.ordinal);
  if (savedAnchor) {
    return {
      first: savedAnchor.index,
      end: savedAnchor.index,
      indent: savedAnchor.indent,
      items: [],
      quoteDepth: _tuiRenderedContainerPrefix(savedAnchor.indent).quoteDepth,
    };
  }
  const headingIndex = _tuiHeadingRowIndex(buffer);
  const renderedHeading = headingIndex.byOrdinal.get(heading.ordinal);
  if (
    !renderedHeading
    || renderedHeading.id !== heading.id
    || !Array.isArray(buffer?.lines)
  ) return null;

  const headingLine = renderedHeading.row + 1;
  const nextHeading = headingIndex.entries[renderedHeading.position + 1];
  const endLine = Math.min(
    nextHeading?.row ?? buffer.lines.length,
    _tuiHeadingContainerEndRow(buffer, renderedHeading),
  );
  const quoteDepth = _tuiRenderedContainerPrefix(
    renderedHeading.prefix,
  ).quoteDepth;
  let first = -1;
  let indent = "";

  for (let y = headingLine; y < endLine; y++) {
    const checkbox = _tuiRenderedTaskCheckbox(buffer.lines[y], quoteDepth);
    if (!checkbox) continue;
    first = y;
    indent = checkbox.prefix;
    break;
  }
  if (first < 0) return null;

  let end = endLine;
  let pendingBlank = -1;
  for (let y = first + 1; y < endLine; y++) {
    const line = String(buffer.lines[y] ?? "");
    const containerPrefix = _tuiRenderedContainerPrefix(line);
    if (containerPrefix.empty) {
      if (pendingBlank < 0) pendingBlank = y;
      continue;
    }
    const checkbox = _tuiRenderedTaskCheckbox(line, quoteDepth);
    if (checkbox || containerPrefix.contentColumn > indent.length) {
      pendingBlank = -1;
      continue;
    }
    end = pendingBlank >= 0 ? pendingBlank : y;
    break;
  }
  if (end === endLine && pendingBlank >= 0) end = pendingBlank;

  const items = [];
  for (let y = first; y < end; y++) {
    const checkbox = _tuiRenderedTaskCheckbox(buffer.lines[y], quoteDepth);
    if (checkbox?.prefix === indent) {
      items.push({
        start: y,
        end,
        value: checkbox.value.trim(),
      });
    }
  }
  for (let index = 0; index < items.length - 1; index++)
    items[index].end = items[index + 1].start;

  return { first, end, indent, items, quoteDepth };
}

function _tuiHeadingImageSources(buffer, heading) {
  if (!heading || _headingHasHiddenTuiAncestor(buffer, heading)) return [];
  const headingIndex = _tuiHeadingRowIndex(buffer);
  const renderedHeading = headingIndex.byOrdinal.get(heading.ordinal);
  if (!renderedHeading || renderedHeading.id !== heading.id) return [];
  const ansiLines = String(buffer?._mdcuiAnsiText ?? "").split("\n");
  const nextHeading = headingIndex.entries[renderedHeading.position + 1];
  const endLine = Math.min(
    nextHeading?.row ?? ansiLines.length,
    _tuiHeadingContainerEndRow(buffer, renderedHeading),
  );
  const sources = [];
  const oscImage = /\x1b\]8;;([^\x1b]*)\x1b\\(?=[^\n]*📷)/gu;
  for (let line = renderedHeading.row + 1; line < endLine; line++) {
    for (const match of String(ansiLines[line] ?? "").matchAll(oscImage))
      sources.push(match[1]);
  }
  return sources;
}

function _tuiHeadingTable(buffer, heading) {
  if (!heading || _headingHasHiddenTuiAncestor(buffer, heading)) return null;
  const headingIndex = _tuiHeadingRowIndex(buffer);
  const renderedHeading = headingIndex.byOrdinal.get(heading.ordinal);
  if (
    !renderedHeading
    || renderedHeading.id !== heading.id
    || !Array.isArray(buffer?.lines)
  ) return null;

  const nextHeading = headingIndex.entries[renderedHeading.position + 1];
  const endLine = Math.min(
    nextHeading?.row ?? buffer.lines.length,
    _tuiHeadingContainerEndRow(buffer, renderedHeading),
  );
  let top = -1;
  let opening = -1;
  let closing = -1;
  for (let y = renderedHeading.row + 1; y < endLine; y++) {
    const line = String(buffer.lines[y] ?? "");
    const start = line.indexOf("┌");
    const end = line.lastIndexOf("┐");
    if (
      start >= 0
      && end > start
      && /^┌─+(?:┬─+)*┐$/u.test(line.slice(start, end + 1))
    ) {
      top = y;
      opening = start;
      closing = end;
      break;
    }
  }
  if (top < 0) return null;

  const rows = [];
  let visualLines = [];
  for (let y = top + 1; y < endLine; y++) {
    const line = String(buffer.lines[y] ?? "");
    const frame = line.slice(opening, closing + 1);
    if (/^└─+(?:┴─+)*┘$/u.test(frame)) {
      if (visualLines.length) rows.push(visualLines);
      return { top, bottom: y, opening, closing, rows };
    }
    if (/^├─+(?:┼─+)*┤$/u.test(frame)) {
      if (visualLines.length) rows.push(visualLines);
      visualLines = [];
      continue;
    }
    if (/^│ .* │$/u.test(frame)) {
      const separators = [];
      for (let index = opening; index <= closing; index++) {
        if (line[index] === "│") separators.push(index);
      }
      if (separators.length >= 2) visualLines.push({ y, separators });
    }
  }
  return null;
}

function _tuiTableCell(table, row, col) {
  const rowIndex = Number(row);
  const columnIndex = Number(col);
  if (
    !Number.isInteger(rowIndex)
    || !Number.isInteger(columnIndex)
    || rowIndex < 0
    || columnIndex < 0
  ) return null;
  const visualLines = table?.rows?.[rowIndex];
  if (
    !Array.isArray(visualLines)
    || visualLines.length === 0
    || visualLines.some(line => columnIndex + 1 >= line.separators.length)
  ) return null;
  return { visualLines, columnIndex };
}

function _tuiTableCellText(buffer, table, row, col) {
  const cell = _tuiTableCell(table, row, col);
  if (!cell) return "";
  return cell.visualLines.map(({ y, separators }) => {
    const start = separators[cell.columnIndex] + 2;
    const end = separators[cell.columnIndex + 1] - 1;
    return String(buffer.lines[y] ?? "").slice(start, end).trimEnd();
  }).join("");
}

function _setTuiTableCellCheckbox(buffer, heading, row, col, checked) {
  const table = _tuiHeadingTable(buffer, heading);
  const cell = _tuiTableCell(table, row, col);
  if (!cell) return false;
  let target = null;
  for (const { y, separators } of cell.visualLines) {
    const start = separators[cell.columnIndex] + 2;
    const end = separators[cell.columnIndex + 1] - 1;
    const line = String(buffer.lines[y] ?? "");
    const offset = line.slice(start, end).search(/[☐☒]/u);
    if (offset >= 0) {
      target = { y, x: start + offset };
      break;
    }
  }
  if (!target) return false;
  const glyph = checked ? "☒" : "☐";
  if (buffer.lines[target.y][target.x] === glyph) return true;
  if (!buffer._mdcuiReplayingMutations) buffer.pushUndo?.(true);
  buffer.lines[target.y] =
    buffer.lines[target.y].slice(0, target.x)
    + glyph
    + buffer.lines[target.y].slice(target.x + 1);
  if (typeof buffer._mdcuiAnsiText === "string") {
    const ansiLines = buffer._mdcuiAnsiText.split("\n");
    ansiLines[target.y] = updateAnsiTaskCheckbox(
      ansiLines[target.y] ?? "",
      target.x,
      checked,
    );
    if (checked) {
      ansiLines[target.y] = colorAnsiPlainRange(
        ansiLines[target.y],
        target.x,
        target.x + 1,
        "☒",
      );
    }
    buffer._mdcuiAnsiText = ansiLines.join("\n");
  }
  const styles = buffer._ansiStyleLines?.[target.y];
  if (Array.isArray(styles)) {
    const base = styles[target.x + 1] ?? styles[target.x - 1] ?? null;
    styles[target.x] = checked
      ? { ...(base ?? {}), fg: "green" }
      : (base ? { ...base } : null);
  }
  if (!(buffer._mdcuiDirtyTableCells instanceof Set))
    buffer._mdcuiDirtyTableCells = new Set();
  buffer._mdcuiDirtyTableCells.add(`${heading.id}\0${row}\0${col}`);
  buffer._mdcuiLinkIndex = null;
  buffer.invalidateHighlightFrom?.(target.y);
  buffer.modified = true;
  return true;
}

const _tableCellSegmenter = typeof Intl.Segmenter === "function"
  ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
  : null;

function _tuiCellGraphemes(value) {
  const text = String(value ?? "").replace(/\r\n?|\n/gu, "");
  return _tableCellSegmenter
    ? [..._tableCellSegmenter.segment(text)].map(item => item.segment)
    : Array.from(text);
}

function _tuiStringWidth(value) {
  return typeof globalThis.Bun?.stringWidth === "function"
    ? Bun.stringWidth(String(value ?? ""))
    : Array.from(String(value ?? "")).length;
}

function _tuiReplacementStyles(line, styles, start, end, replacement) {
  const source = String(line ?? "").slice(start, end);
  const sourceStyles = Array.isArray(styles) ? styles.slice(start, end) : [];
  const sourceGraphemes = _tableCellSegmenter
    ? [..._tableCellSegmenter.segment(source)].map(item => ({
      text: item.segment,
      index: item.index,
    }))
    : Array.from(source).map((text, index) => ({ text, index }));
  const styleByColumn = [];
  for (const item of sourceGraphemes) {
    const style = sourceStyles[item.index] ?? null;
    const width = Math.max(1, _tuiStringWidth(item.text));
    for (let column = 0; column < width; column++) styleByColumn.push(style);
  }

  const result = [];
  let column = 0;
  const replacementGraphemes = _tableCellSegmenter
    ? [..._tableCellSegmenter.segment(replacement)].map(item => item.segment)
    : Array.from(replacement);
  for (const grapheme of replacementGraphemes) {
    const style = styleByColumn[
      Math.min(column, Math.max(0, styleByColumn.length - 1))
    ] ?? null;
    for (let index = 0; index < grapheme.length; index++) result.push(style);
    column += Math.max(1, _tuiStringWidth(grapheme));
  }
  return result;
}

function _setTuiTableCell(buffer, heading, row, col, value) {
  const table = _tuiHeadingTable(buffer, heading);
  const cell = _tuiTableCell(table, row, col);
  if (!cell) return false;

  const graphemes = _tuiCellGraphemes(value);
  let grapheme = 0;
  const replacements = [];
  for (const { y, separators } of cell.visualLines) {
    const start = separators[cell.columnIndex] + 2;
    const end = separators[cell.columnIndex + 1] - 1;
    const capacity = _tuiStringWidth(
      String(buffer.lines[y] ?? "").slice(start, end),
    );
    let text = "";
    let width = 0;
    while (grapheme < graphemes.length) {
      const next = graphemes[grapheme];
      const nextWidth = _tuiStringWidth(next);
      if (nextWidth <= 0) {
        text += next;
        grapheme++;
        continue;
      }
      if (width + nextWidth > capacity) break;
      text += next;
      width += nextWidth;
      grapheme++;
    }
    replacements.push({
      y,
      start,
      end,
      text: text + " ".repeat(Math.max(0, capacity - width)),
    });
  }

  const before = _tuiTableCellText(buffer, table, row, col);
  if (before === replacements.map(item => item.text.trimEnd()).join(""))
    return true;
  if (!buffer._mdcuiReplayingMutations) buffer.pushUndo?.(true);
  const ansiLines = typeof buffer._mdcuiAnsiText === "string"
    ? buffer._mdcuiAnsiText.split("\n")
    : null;
  for (const replacement of replacements) {
    const oldLine = String(buffer.lines[replacement.y] ?? "");
    const styleLine = buffer._ansiStyleLines?.[replacement.y];
    if (Array.isArray(styleLine)) {
      styleLine.splice(
        replacement.start,
        replacement.end - replacement.start,
        ..._tuiReplacementStyles(
          oldLine,
          styleLine,
          replacement.start,
          replacement.end,
          replacement.text,
        ),
      );
    }
    if (ansiLines) {
      ansiLines[replacement.y] = replaceAnsiPlainRangePreservingControls(
        ansiLines[replacement.y] ?? "",
        replacement.start,
        replacement.end,
        replacement.text,
      );
    }
    buffer.lines[replacement.y] =
      oldLine.slice(0, replacement.start)
      + replacement.text
      + oldLine.slice(replacement.end);
    buffer.invalidateHighlightFrom?.(replacement.y);
  }
  if (ansiLines) buffer._mdcuiAnsiText = ansiLines.join("\n");
  buffer._mdcuiLinkIndex = null;
  if (!buffer._mdcuiReplayingMutations) {
    if (!(buffer._mdcuiDirtyTableCells instanceof Set))
      buffer._mdcuiDirtyTableCells = new Set();
    buffer._mdcuiDirtyTableCells.add(`${heading.id}\0${row}\0${col}`);
  }
  buffer.modified = true;
  return true;
}

function _normalizedSpliceRange(length, argumentCount, start, deleteCount) {
  if (argumentCount === 0) return { start: 0, deleteCount: 0 };
  let relativeStart = Number(start);
  if (Number.isNaN(relativeStart)) relativeStart = 0;
  relativeStart = Math.trunc(relativeStart);
  const actualStart = relativeStart < 0
    ? Math.max(length + relativeStart, 0)
    : Math.min(relativeStart, length);
  if (argumentCount === 1) return { start: actualStart, deleteCount: length - actualStart };
  let requestedDelete = Number(deleteCount);
  if (Number.isNaN(requestedDelete)) requestedDelete = 0;
  requestedDelete = Math.max(0, Math.trunc(requestedDelete));
  return {
    start: actualStart,
    deleteCount: Math.min(requestedDelete, length - actualStart),
  };
}

function _normalizedTuiTaskItem(input) {
  const item = input && typeof input === "object"
    ? { value: input.value ?? input.label ?? "", checked: Boolean(input.checked) }
    : { value: input ?? "", checked: false };
  return {
    value: String(item.value).replace(/\r?\n/g, " "),
    checked: item.checked,
  };
}

function _snapshotTuiHeadingListMutationArgs(method, args) {
  let snapshot;
  if (method === "splice") {
    snapshot = [];
    if (args.length > 0) snapshot.push(Number(args[0]));
    if (args.length > 1) snapshot.push(Number(args[1]));
    snapshot.push(...args.slice(2).map(_normalizedTuiTaskItem));
  } else if (method === "push" || method === "unshift") {
    snapshot = args.map(_normalizedTuiTaskItem);
  } else {
    snapshot = [];
  }
  for (const item of snapshot) {
    if (item && typeof item === "object") Object.freeze(item);
  }
  return Object.freeze(snapshot);
}

function _tuiTaskItemReplacement(indent, inputs) {
  const normalized = inputs.map(_normalizedTuiTaskItem);
  return {
    lines: normalized.map((item) =>
      `${indent}${item.checked ? "☒" : "☐"} ${item.value}`,
    ),
    styles: normalized.map((item) => {
      const styles = [];
      if (item.checked) {
        styles[indent.length] = { fg: "green" };
        styles[indent.length + 1] = { fg: "green" };
      }
      return styles;
    }),
    ansi: normalized.map((item) =>
      `${indent}\x1b[${item.checked ? "32" : "2"}m${item.checked ? "☒" : "☐"} \x1b[0m${item.value}`,
    ),
  };
}

function _mutateTuiHeadingList(buffer, heading, method, args, resolvedList = null) {
  const list = resolvedList ?? _tuiHeadingTaskList(buffer, heading);
  if (!list) {
    if (method === "push" || method === "unshift") return 0;
    if (method === "splice") return [];
    return undefined;
  }

  if (method === "splice") {
    const range = _normalizedSpliceRange(list.items.length, args.length, args[0], args[1]);
    const removedItems = list.items.slice(range.start, range.start + range.deleteCount);
    const removed = removedItems.map((item) => item.value);
    const replacement = _tuiTaskItemReplacement(list.indent, args.slice(2));
    if (range.deleteCount === 0 && replacement.lines.length === 0) return [];
    const start = list.items[range.start]?.start ?? list.end;
    const end = removedItems.at(-1)?.end ?? start;
    if (range.deleteCount === list.items.length && replacement.lines.length === 0 && list.items.length > 0) {
      if (!(buffer._mdcuiHeadingTaskListAnchors instanceof Map))
        buffer._mdcuiHeadingTaskListAnchors = new Map();
      buffer._mdcuiHeadingTaskListAnchors.set(heading.ordinal, { index: start, indent: list.indent });
    }
    spliceTuiBufferLines(buffer, start, end - start, replacement.lines, {
      styles: replacement.styles,
      ansi: replacement.ansi,
    });
    if (replacement.lines.length > 0)
      buffer._mdcuiHeadingTaskListAnchors?.delete(heading.ordinal);
    return removed;
  }

  if (method === "pop" || method === "shift") {
    const item = method === "pop" ? list.items.at(-1) : list.items[0];
    if (!item) return undefined;
    if (list.items.length === 1) {
      if (!(buffer._mdcuiHeadingTaskListAnchors instanceof Map))
        buffer._mdcuiHeadingTaskListAnchors = new Map();
      buffer._mdcuiHeadingTaskListAnchors.set(heading.ordinal, {
        index: item.start,
        indent: list.indent,
      });
    }
    spliceTuiBufferLines(buffer, item.start, item.end - item.start, []);
    return item.value;
  }

  const replacement = _tuiTaskItemReplacement(list.indent, args);
  if (replacement.lines.length === 0) return list.items.length;
  const start = method === "push" ? list.end : list.first;
  spliceTuiBufferLines(buffer, start, 0, replacement.lines, {
    styles: replacement.styles,
    ansi: replacement.ansi,
  });
  if (replacement.lines.length > 0) buffer._mdcuiHeadingTaskListAnchors?.delete(heading.ordinal);
  return list.items.length + replacement.lines.length;
}

function _recordTuiHeadingListMutation(buffer, selector, method, args) {
  if (!buffer || buffer._mdcuiReplayingMutations) return;
  if (!Array.isArray(args)) return;
  if (!Array.isArray(buffer._mdcuiMutationMacros))
    buffer._mdcuiMutationMacros = [];
  buffer._mdcuiMutationMacros.push({
    selector: String(selector),
    method,
    args,
  });
}

function _mutateAndRecordTuiHeadingList(buffer, heading, selector, method, args, failureValue) {
  if (!buffer || !heading) return failureValue;
  if (
    _headingHasHiddenTuiAncestor(buffer, heading) ||
    _tuiIdStore(buffer).get(heading.id)?.headingVisibility?.hidden
  )
    return failureValue;
  const list = _tuiHeadingTaskList(buffer, heading);
  if (!list) return failureValue;
  const snapshotArgs = _snapshotTuiHeadingListMutationArgs(method, args);
  const before = Array.isArray(buffer.lines) ? buffer.lines.join("\n") : "";
  const result = _mutateTuiHeadingList(buffer, heading, method, snapshotArgs, list);
  const after = Array.isArray(buffer.lines) ? buffer.lines.join("\n") : "";
  if (after !== before)
    _recordTuiHeadingListMutation(buffer, selector, method, snapshotArgs);
  return result;
}

export function replayTuiMutationMacros(buffer) {
  if (!buffer || !Array.isArray(buffer._mdcuiMutationMacros)) return;
  buffer._mdcuiReplayingMutations = true;
  try {
    for (const macro of buffer._mdcuiMutationMacros) {
      if (
        !macro
        || !["push", "pop", "shift", "unshift", "splice"].includes(macro.method)
      ) continue;
      let args;
      if (Array.isArray(macro.args)) args = macro.args;
      else {
        try {
          args = JSON.parse(macro.argsJson);
        } catch {
          continue;
        }
      }
      if (!Array.isArray(args)) continue;
      const heading = _findHeading(buffer, macro.selector);
      if (heading) _mutateTuiHeadingList(buffer, heading, macro.method, args);
    }
  } finally {
    buffer._mdcuiReplayingMutations = false;
  }
}

function _tuiBlockSignature(block) {
  const header = block.header;
  return JSON.stringify([
    header.kind,
    header.tag,
    header.id,
    header.classes,
  ]);
}

function _captureTuiFenceBlocks(buffer) {
  const ansiLines = typeof buffer?._mdcuiAnsiText === "string"
    ? buffer._mdcuiAnsiText.split("\n")
    : null;
  return buildTuiBlockIndex(buffer?.lines ?? []).map((block) => ({
    signature: _tuiBlockSignature(block),
    lines: buffer.lines.slice(block.start + 1, block.end),
    styles: Array.isArray(buffer._ansiStyleLines)
      ? buffer._ansiStyleLines.slice(block.start + 1, block.end)
      : null,
    ansi: ansiLines?.slice(block.start + 1, block.end) ?? null,
  }));
}

function _restoreTuiFenceBlocks(buffer, snapshots) {
  if (!Array.isArray(snapshots) || snapshots.length === 0) return;
  const blocks = buildTuiBlockIndex(buffer?.lines ?? []);
  if (
    blocks.length !== snapshots.length
    || blocks.some((block, index) => _tuiBlockSignature(block) !== snapshots[index].signature)
  ) {
    buffer._mdcuiRerenderMismatch = {
      ...(buffer._mdcuiRerenderMismatch ?? {}),
      fenceBlocks: { before: snapshots.length, after: blocks.length },
    };
    return;
  }
  for (let index = blocks.length - 1; index >= 0; index--) {
    const block = blocks[index];
    const snapshot = snapshots[index];
    spliceTuiBufferLines(
      buffer,
      block.start + 1,
      Math.max(0, block.end - block.start - 1),
      snapshot.lines,
      {
        styles: snapshot.styles ?? undefined,
        ansi: snapshot.ansi ?? undefined,
      },
    );
  }
}

function _tuiCheckboxRows(buffer) {
  const rows = [];
  const ansiLines = typeof buffer?._mdcuiAnsiText === "string"
    ? buffer._mdcuiAnsiText.split("\n")
    : null;
  for (let y = 0; y < (buffer?.lines?.length ?? 0); y++) {
    const line = String(buffer.lines[y] ?? "");
    for (const match of line.matchAll(/[☐☒]/gu)) {
      const style = buffer._ansiStyleLines?.[y]?.[match.index] ?? null;
      const column = globalThis.Bun?.stringWidth
        ? Bun.stringWidth(line.slice(0, match.index))
        : match.index;
      rows.push({
        y,
        x: match.index,
        checked: match[0] === "☒",
        style: style ? { ...style } : null,
        ansi: ansiLines && globalThis.Bun?.sliceAnsi
          ? Bun.sliceAnsi(ansiLines[y] ?? "", column, column + 1)
          : null,
      });
    }
  }
  return rows;
}

function _restoreTuiCheckboxStates(buffer, states) {
  const rows = _tuiCheckboxRows(buffer);
  if (rows.length !== states.length) {
    buffer._mdcuiRerenderMismatch = {
      ...(buffer._mdcuiRerenderMismatch ?? {}),
      checkboxes: { before: states.length, after: rows.length },
    };
    return;
  }
  const ansiLines = typeof buffer._mdcuiAnsiText === "string"
    ? buffer._mdcuiAnsiText.split("\n")
    : null;
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const state = states[index];
    const checked = typeof state === "object" && state !== null
      ? Boolean(state.checked)
      : Boolean(state);
    const glyph = checked ? "☒" : "☐";
    const styleLine = buffer._ansiStyleLines?.[row.y];
    if (Array.isArray(styleLine)) {
      const style = typeof state === "object" && state !== null
        ? state.style
        : (checked ? { fg: "green" } : null);
      styleLine[row.x] = style ? { ...style } : null;
    }
    if (ansiLines) {
      if (
        typeof state === "object"
        && state !== null
        && typeof state.ansi === "string"
        && globalThis.Bun?.sliceAnsi
      ) {
        const line = String(buffer.lines[row.y] ?? "");
        const column = globalThis.Bun?.stringWidth
          ? Bun.stringWidth(line.slice(0, row.x))
          : row.x;
        ansiLines[row.y] =
          Bun.sliceAnsi(ansiLines[row.y], 0, column)
          + state.ansi
          + Bun.sliceAnsi(ansiLines[row.y], column + 1);
      } else {
        ansiLines[row.y] = updateAnsiTaskCheckbox(ansiLines[row.y], row.x, checked);
      }
    }
    if (buffer.lines[row.y][row.x] !== glyph) {
      buffer.lines[row.y] =
        buffer.lines[row.y].slice(0, row.x) + glyph + buffer.lines[row.y].slice(row.x + 1);
    }
  }
  if (ansiLines) buffer._mdcuiAnsiText = ansiLines.join("\n");
}

export function tuiCheckboxRerenderMismatchMessage(buffer) {
  const mismatch = buffer?._mdcuiRerenderMismatch?.checkboxes;
  if (!mismatch) return "";
  const name = String(buffer?.name ?? "").trim();
  const location = name ? ` in ${name}` : "";
  return `Checkbox state restore skipped${location}: count changed from ${mismatch.before} to ${mismatch.after}`;
}

function _captureTuiTables(buffer) {
  const snapshots = [];
  const dirty = buffer?._mdcuiDirtyTableCells;
  if (!(dirty instanceof Set) || dirty.size === 0) return snapshots;
  const ansiLines = typeof buffer?._mdcuiAnsiText === "string"
    ? buffer._mdcuiAnsiText.split("\n")
    : null;
  for (const heading of _tuiSourceHeadings(buffer)) {
    const table = _tuiHeadingTable(buffer, heading);
    if (!table) continue;
    snapshots.push({
      id: heading.id,
      cells: table.rows.map((visualLines, row) => {
        const columns = visualLines[0]?.separators?.length - 1;
        return Array.from(
          { length: Math.max(0, columns) },
          (_, col) => {
            if (!dirty.has(`${heading.id}\0${row}\0${col}`)) return null;
            const ansi = [];
            const styles = [];
            for (const { y, separators } of visualLines) {
              const start = separators[col] + 2;
              const end = separators[col + 1] - 1;
              const content = String(buffer.lines[y] ?? "")
                .slice(start, end).trimEnd();
              const width = _tuiStringWidth(content);
              if (
                width > 0
                && ansiLines
                && typeof globalThis.Bun?.sliceAnsi === "function"
              ) {
                const displayStart = _tuiStringWidth(
                  String(buffer.lines[y] ?? "").slice(0, start),
                );
                ansi.push(Bun.sliceAnsi(
                  ansiLines[y] ?? "",
                  displayStart,
                  displayStart + width,
                ));
              } else {
                ansi.push(content);
              }
              if (Array.isArray(buffer._ansiStyleLines?.[y])) {
                styles.push(
                  ...buffer._ansiStyleLines[y]
                    .slice(start, start + content.length)
                    .map(style => style ? { ...style } : null),
                );
              } else {
                styles.push(...Array.from(
                  { length: content.length },
                  () => null,
                ));
              }
            }
            return {
              text: _tuiTableCellText(buffer, table, row, col),
              ansi: ansi.join(""),
              styles,
            };
          },
        );
      }),
    });
  }
  return snapshots;
}

function _restoreTuiTableCellAnsi(buffer, table, row, col, state) {
  if (!state || typeof state !== "object") return;
  const cell = _tuiTableCell(table, row, col);
  if (!cell) return;
  const ansiLines = typeof buffer._mdcuiAnsiText === "string"
    ? buffer._mdcuiAnsiText.split("\n")
    : null;
  let displayOffset = 0;
  let characterOffset = 0;

  for (const { y, separators } of cell.visualLines) {
    const start = separators[col] + 2;
    const end = separators[col + 1] - 1;
    const content = String(buffer.lines[y] ?? "")
      .slice(start, end).trimEnd();
    const width = _tuiStringWidth(content);
    if (
      ansiLines
      && typeof state.ansi === "string"
      && typeof globalThis.Bun?.sliceAnsi === "function"
    ) {
      ansiLines[y] = replaceAnsiPlainRange(
        ansiLines[y] ?? "",
        start,
        start + content.length,
        Bun.sliceAnsi(
          state.ansi,
          displayOffset,
          displayOffset + width,
        ),
      );
    }
    const styleLine = buffer._ansiStyleLines?.[y];
    if (Array.isArray(styleLine) && Array.isArray(state.styles)) {
      styleLine.splice(
        start,
        content.length,
        ...state.styles
          .slice(characterOffset, characterOffset + content.length)
          .map(style => style ? { ...style } : null),
      );
    }
    displayOffset += width;
    characterOffset += content.length;
  }
  if (ansiLines) buffer._mdcuiAnsiText = ansiLines.join("\n");
}

function _restoreTuiTables(buffer, snapshots) {
  if (!Array.isArray(snapshots)) return;
  const headings = new Map(
    _tuiSourceHeadings(buffer).map(heading => [heading.id, heading]),
  );
  const resolved = snapshots.map((snapshot) => {
    const heading = headings.get(snapshot.id);
    const table = _tuiHeadingTable(buffer, heading);
    return { snapshot, heading, table };
  });
  const mismatch = resolved.some(({ snapshot, table }) =>
    !table
    || table.rows.length !== snapshot.cells.length
    || snapshot.cells.some((cells, row) =>
      (table.rows[row]?.[0]?.separators?.length - 1) !== cells.length
    )
  );
  if (mismatch) {
    buffer._mdcuiRerenderMismatch = {
      ...(buffer._mdcuiRerenderMismatch ?? {}),
      tableCells: {
        before: snapshots.length,
        after: resolved.filter(item => item.table).length,
      },
    };
    return;
  }

  const replaying = buffer._mdcuiReplayingMutations;
  buffer._mdcuiReplayingMutations = true;
  try {
    for (const { snapshot, heading } of resolved) {
      for (let row = 0; row < snapshot.cells.length; row++) {
        for (let col = 0; col < snapshot.cells[row].length; col++) {
          const state = snapshot.cells[row][col];
          if (state == null) continue;
          _setTuiTableCell(
            buffer,
            heading,
            row,
            col,
            typeof state === "object" && state !== null
              ? state.text
              : state,
          );
          const table = _tuiHeadingTable(buffer, heading);
          _restoreTuiTableCellAnsi(buffer, table, row, col, state);
        }
      }
    }
  } finally {
    buffer._mdcuiReplayingMutations = replaying;
  }
}

export function captureTuiRerenderState(buffer) {
  const headings = new Map(_tuiSourceHeadings(buffer).map((heading) => [heading.id, heading]));
  const hiddenHeadings = [];
  if (buffer?._mdcuiIdStore instanceof Map) {
    for (const [id, record] of buffer._mdcuiIdStore) {
      if (!record?.headingVisibility?.hidden) continue;
      const heading = headings.get(id);
      if (heading) hiddenHeadings.push({ id, level: heading.level, ordinal: heading.ordinal });
    }
  }

  // Outer sections must be shown first so nested heading handles become visible.
  for (const item of hiddenHeadings.slice().sort((a, b) =>
    a.level - b.level || a.ordinal - b.ordinal
  )) {
    _showTuiHeadingSection(buffer, headings.get(item.id), item.id);
  }

  return {
    hiddenHeadings,
    tableCells: _captureTuiTables(buffer),
    checkboxStates: _tuiCheckboxRows(buffer).map(({ checked, style, ansi }) => ({
      checked,
      style,
      ansi,
    })),
    fenceBlocks: _captureTuiFenceBlocks(buffer),
  };
}

export function restoreTuiRerenderState(buffer, snapshot) {
  if (!buffer || !snapshot) return;
  buffer._mdcuiRerenderMismatch = null;
  replayTuiMutationMacros(buffer);
  _restoreTuiTables(buffer, snapshot.tableCells);
  _restoreTuiFenceBlocks(buffer, snapshot.fenceBlocks);
  _restoreTuiCheckboxStates(buffer, snapshot.checkboxStates ?? []);

  restoreTuiHiddenHeadings(buffer, snapshot.hiddenHeadings);
}

export function restoreTuiHiddenHeadings(buffer, hiddenHeadings) {
  const headings = new Map(_tuiSourceHeadings(buffer).map((heading) => [heading.id, heading]));
  // Nested sections are hidden first; an outer hide may then safely contain them.
  for (const item of (hiddenHeadings ?? []).slice().sort((a, b) =>
    b.level - a.level || b.ordinal - a.ordinal
  )) {
    _hideTuiHeadingSection(buffer, headings.get(item.id), item.id);
  }
}

export function spliceTuiBufferLines(buffer, start, deleteCount, replacement, replacementMeta = {}) {
  const oldCursor = buffer.cursor ? { ...buffer.cursor } : null;
  const headingIndex = _cachedTuiHeadingRowIndex(buffer);
  const oldEnd = start + deleteCount;
  const delta = replacement.length - deleteCount;
  buffer._mdcuiFenceBlockIndex = null;
  buffer._mdcuiControlBlockIndex = null;
  buffer.lines.splice(start, deleteCount, ...replacement);

  if (Array.isArray(buffer._ansiStyleLines)) {
    const template = buffer._ansiStyleLines[start] ?? null;
    buffer._ansiStyleLines.splice(
      start,
      deleteCount,
      ...(replacementMeta.styles ?? replacement.map(() => template)),
    );
  }

  if (typeof buffer._mdcuiAnsiText === "string") {
    const ansiLines = buffer._mdcuiAnsiText.split("\n");
    ansiLines.splice(start, deleteCount, ...(replacementMeta.ansi ?? replacement));
    buffer._mdcuiAnsiText = ansiLines.join("\n");
  }
  if (Array.isArray(buffer._mdcuiImages)) {
    buffer._mdcuiImages = buffer._mdcuiImages
      .filter((image) => image.line < start || image.line >= start + deleteCount)
      .map((image) => image.line >= start + deleteCount ? { ...image, line: image.line + delta } : image);
  }
  if (buffer._mdcuiHeadingTaskListAnchors instanceof Map) {
    for (const anchor of buffer._mdcuiHeadingTaskListAnchors.values()) {
      if (anchor.index >= oldEnd) anchor.index += delta;
      else if (anchor.index >= start) anchor.index = start;
    }
  }
  if (headingIndex) {
    const entries = headingIndex.entries
      .filter((heading) => heading.row < start || heading.row >= oldEnd)
      .map((heading) => heading.row >= oldEnd
        ? { ...heading, row: heading.row + delta }
        : heading
      );
    for (const heading of replacementMeta.headings ?? []) {
      if (
        !heading
        || !Number.isInteger(heading.row)
        || heading.row < 0
        || heading.row >= replacement.length
      ) continue;
      entries.push({ ...heading, row: start + heading.row });
    }
    _replaceTuiHeadingRowEntries(buffer, headingIndex, entries);
  }

  buffer.invalidateHighlightFrom?.(start, { force: replacement.length !== deleteCount });
  if (oldCursor) {
    if (oldCursor.y >= oldEnd) {
      buffer.cursor.y = oldCursor.y + replacement.length - deleteCount;
    } else if (oldCursor.y >= start) {
      const relativeY = Math.min(oldCursor.y - start, Math.max(0, replacement.length - 1));
      buffer.cursor.y = start + relativeY;
    }
  }
  if (replacementMeta.markModified !== false) buffer.modified = true;
  buffer.ensureCursor?.();
}

export function insertTuiTextareaNewline(buffer, block) {
  if (!buffer || block?.header?.tag !== "textarea") return false;
  const prefix = block.header.indent + block.header.bodyMarker + " ";
  const line = String(buffer.lines?.[buffer.cursor.y] ?? "");
  const left = line.slice(0, buffer.cursor.x);
  const right = line.slice(buffer.cursor.x);
  buffer.lines[buffer.cursor.y] = left;
  spliceTuiBufferLines(buffer, buffer.cursor.y + 1, 0, [prefix + right]);
  buffer.cursor.y++;
  buffer.cursor.x = prefix.length;
  buffer.ensureCursor?.();
  return true;
}

export function mergeTuiTextareaBackward(buffer, block) {
  if (!buffer || block?.header?.tag !== "textarea") return false;
  const prefix = block.header.indent + block.header.bodyMarker + " ";
  if (buffer.cursor.x > prefix.length || buffer.cursor.y <= block.start + 1) return false;
  const previousY = buffer.cursor.y - 1;
  const previousLength = String(buffer.lines?.[previousY] ?? "").length;
  const line = String(buffer.lines?.[buffer.cursor.y] ?? "");
  const body = line.startsWith(prefix) ? line.slice(prefix.length) : line;
  buffer.lines[previousY] += body;
  spliceTuiBufferLines(buffer, buffer.cursor.y, 1, []);
  buffer.cursor.y = previousY;
  buffer.cursor.x = previousLength;
  buffer.ensureCursor?.();
  return true;
}

export function mergeTuiTextareaForward(buffer, block) {
  if (!buffer || block?.header?.tag !== "textarea") return false;
  const line = String(buffer.lines?.[buffer.cursor.y] ?? "");
  if (buffer.cursor.x < line.length || buffer.cursor.y >= block.end - 1) return false;
  const prefix = block.header.indent + block.header.bodyMarker + " ";
  const nextLine = String(buffer.lines?.[buffer.cursor.y + 1] ?? "");
  const body = nextLine.startsWith(prefix) ? nextLine.slice(prefix.length) : nextLine;
  buffer.lines[buffer.cursor.y] += body;
  spliceTuiBufferLines(buffer, buffer.cursor.y + 1, 1, []);
  buffer.ensureCursor?.();
  return true;
}

function _setBlockValue(buffer, selector, value) {
  const lines = buffer.lines;
  const block = _findBlock(lines, selector);
  if (!block) return false;

  const normalizedValue = String(value ?? "").replace(/\r\n?/g, "\n");
  if ((_blockValue(lines, selector) ?? "") === normalizedValue) return true;
  buffer.pushUndo?.(true);
  const values = normalizedValue.split("\n");
  const contentStart = block.start + 1;
  const capacity = Math.max(0, block.end - contentStart);

  if (block.header.kind === "fenced") {
    const replacement = values.map((line) => block.header.indent + line);
    spliceTuiBufferLines(buffer, contentStart, capacity, replacement);
    return true;
  }

  const rowPrefix = block.header.indent + block.header.bodyMarker + " ";
  const replacement = values.map((line) => rowPrefix + line);
  spliceTuiBufferLines(buffer, contentStart, capacity, replacement);
  return true;
}

export function createTuiSelector(getBuffer, requestRender = null, requestScroll = null) {
  return function $(selectorInput) {
    const objectSelectorId = selectorInput !== null && typeof selectorInput === "object"
      ? _headingSelectorId(selectorInput)
      : null;
    const selector = objectSelectorId ? `#${objectSelectorId}` : selectorInput;
    const objectTarget = !objectSelectorId
      && selectorInput !== null
      && typeof selectorInput === "object"
      ? selectorInput
      : null;
    const parsedSelector = objectTarget
      ? null
      : _parseBlockIdentity(selector, { selector: true });
    const selectorId = _headingSelectorId(selector) ?? parsedSelector?.id ?? null;
    const selection = {
      id: selectorId ?? "",
      html() {
        try {
          if (objectTarget && "innerHTML" in objectTarget)
            return String(objectTarget.innerHTML ?? "");
          return _findHeading(getBuffer?.(), selector)?.html ?? "";
        } catch {
          return "";
        }
      },
      line() {
        try {
          const buffer = getBuffer?.();
          return _headingTuiLine(buffer, _findHeading(buffer, selector));
        } catch {
          return 0;
        }
      },
      scrollIntoView(...args) {
        const value = args[0];
        const buffer = getBuffer?.();
        const heading = _findHeading(buffer, selector);
        if (!buffer || !heading?.id) return undefined;
        if (!navigateTuiHeadingFragment(buffer, `#${encodeURIComponent(heading.id)}`))
          return undefined;
        const block = args.length === 0 || value === true || value === -1
          ? "start"
          : value === false || value === 1
            ? "end"
            : "center";
        requestScroll?.({ buffer, block });
        return undefined;
      },
      text(...args) {
        try {
          const buffer = getBuffer?.();
          const heading = _findHeading(buffer, selector);
          if (!objectTarget || (heading && !("textContent" in objectTarget))) {
            if (args.length > 0) return selection;
            const line = _headingTuiLine(buffer, heading);
            return line > 0 ? String(buffer.lines?.[line - 1] ?? "").trim() : "";
          }
          if (args.length > 0) {
            objectTarget.textContent = String(args[0] ?? "");
            return selection;
          }
          return String(objectTarget.textContent ?? "");
        } catch {
          return args.length > 0 ? selection : "";
        }
      },
      parent() {
        try {
          return objectTarget && typeof objectTarget.parent === "function"
            ? objectTarget.parent()
            : null;
        } catch {
          return null;
        }
      },
      cell(row, col) {
        const makeCellSelection = (cellRow, cellCol) => {
          const normalizedRow = Number(cellRow);
          const normalizedCol = Number(cellCol);
          const cellSelection = {
            get row() {
              return normalizedRow;
            },
            get col() {
              return normalizedCol;
            },
            text(...args) {
              try {
                const buffer = getBuffer?.();
                const heading = _findHeading(buffer, selector);
                const table = _tuiHeadingTable(buffer, heading);
                if (args.length === 0) {
                  return _tuiTableCellText(
                    buffer,
                    table,
                    normalizedRow,
                    normalizedCol,
                  );
                }
                _setTuiTableCell(
                  buffer,
                  heading,
                  normalizedRow,
                  normalizedCol,
                  args[0],
                );
                requestRender?.();
              } catch {}
              return args.length > 0 ? cellSelection : "";
            },
            val(...args) {
              try {
                const buffer = getBuffer?.();
                const heading = _findHeading(buffer, selector);
                if (args.length > 0) {
                  _setTuiTableCellCheckbox(
                    buffer,
                    heading,
                    normalizedRow,
                    normalizedCol,
                    Boolean(args[0]),
                  );
                  requestRender?.();
                  return cellSelection;
                }
                const table = _tuiHeadingTable(buffer, heading);
                const text = _tuiTableCellText(
                  buffer,
                  table,
                  normalizedRow,
                  normalizedCol,
                );
                const checkbox = /[☐☒]/u.exec(text)?.[0];
                return checkbox ? checkbox === "☒" : text;
              } catch {
                return args.length > 0 ? cellSelection : "";
              }
            },
            left() {
              return neighborCell(0, -1);
            },
            lt() {
              return neighborCell(0, -1);
            },
            right() {
              return neighborCell(0, 1);
            },
            rt() {
              return neighborCell(0, 1);
            },
            up() {
              return neighborCell(-1, 0);
            },
            down() {
              return neighborCell(1, 0);
            },
            dn() {
              return neighborCell(1, 0);
            },
          };
          const neighborCell = (rowDelta, colDelta) => {
            try {
              const buffer = getBuffer?.();
              const heading = _findHeading(buffer, selector);
              const table = _tuiHeadingTable(buffer, heading);
              if (
                !_tuiTableCell(
                  table,
                  normalizedRow,
                  normalizedCol,
                )
              ) return null;
              const nextRow = normalizedRow + rowDelta;
              if (nextRow < 0 || nextRow >= table.rows.length) return null;
              const columnCount =
                table.rows[nextRow]?.[0]?.separators?.length - 1;
              if (!Number.isInteger(columnCount) || columnCount < 1)
                return null;
              const nextCol = normalizedCol + colDelta;
              if (nextCol < 0 || nextCol >= columnCount) return null;
              return makeCellSelection(nextRow, nextCol);
            } catch {
              return null;
            }
          };
          return cellSelection;
        };
        return makeCellSelection(row, col);
      },
      img(index = 0) {
        const normalizedIndex = Math.trunc(Number(index));
        return {
          get src() {
            try {
              if (!Number.isInteger(normalizedIndex) || normalizedIndex < 0) return "";
              const buffer = getBuffer?.();
              return _tuiHeadingImageSources(
                buffer,
                _findHeading(buffer, selector),
              )[normalizedIndex] ?? "";
            } catch {
              return "";
            }
          },
        };
      },
      show() {
        try {
          const buffer = getBuffer?.();
          const id = _headingSelectorId(selector);
          if (_changeTuiHeadingSectionVisibility(
            buffer, _findHeading(buffer, selector), id, "show",
          )) requestRender?.();
        } catch {}
        return selection;
      },
      hide() {
        try {
          const buffer = getBuffer?.();
          const id = _headingSelectorId(selector);
          if (_changeTuiHeadingSectionVisibility(
            buffer, _findHeading(buffer, selector), id, "hide",
          )) requestRender?.();
        } catch {}
        return selection;
      },
      toggle() {
        try {
          const buffer = getBuffer?.();
          const id = _headingSelectorId(selector);
          const heading = _findHeading(buffer, selector);
          if (_changeTuiHeadingSectionVisibility(buffer, heading, id, "toggle"))
            requestRender?.();
        } catch {}
        return selection;
      },
      data(...args) {
        try {
          const buffer = getBuffer?.();
          const data = _tuiUserData(buffer, selectorId);
          if (!data) return args.length === 0 ? undefined : selection;
          if (args.length === 0) return data;
          if (args.length === 1) {
            if (args[0] && typeof args[0] === "object") {
              Object.assign(data, args[0]);
              if (_renderTuiHeadingComponents(buffer, selectorId))
                requestRender?.({ imagesDirty: buffer._mdcuiImagesDirty === true });
              return selection;
            }
            return data[String(args[0])];
          }
          data[String(args[0])] = args[1];
          if (_renderTuiHeadingComponents(buffer, selectorId))
            requestRender?.({ imagesDirty: buffer._mdcuiImagesDirty === true });
          return selection;
        } catch {
          return args.length <= 1 ? undefined : selection;
        }
      },
      removeData(...keys) {
        try {
          const buffer = getBuffer?.();
          const normalized = keys
            .flatMap(key => Array.isArray(key) ? key : String(key).split(/\s+/))
            .filter(Boolean)
            .map(String);
          _removeTuiUserData(buffer, selectorId, normalized);
        } catch {}
        return selection;
      },
      val(...args) {
        try {
          const buffer = getBuffer?.();
          const heading = _findHeading(buffer, selector);
          if (objectTarget && (!heading || "value" in objectTarget || "textContent" in objectTarget)) {
            if (args.length > 0) {
              const value = String(args[0] ?? "");
              if ("value" in objectTarget) objectTarget.value = value;
              else objectTarget.textContent = value;
              return selection;
            }
            return "value" in objectTarget
              ? String(objectTarget.value ?? "")
              : String(objectTarget.textContent ?? "");
          }
          if (!buffer) return args.length > 0 ? selection : "";
          const headingId = _headingSelectorId(selector);
          if (heading && headingId) {
            if (args.length > 0) return selection;
            return _headingCheckboxValue(buffer, heading, headingId);
          }
          if (!parsedSelector) return args.length > 0 ? selection : "";
          const lines = Array.isArray(buffer.lines)
            ? buffer.lines
            : String(buffer).replace(/\r\n?/g, "\n").split("\n");
          if (args.length > 0) {
            if (Array.isArray(buffer.lines))
              _setBlockValue(buffer, parsedSelector, args[0]);
            // 跟 .data() 一樣主動要求重繪；不然從 setInterval／Promise
            // 之類非按鍵觸發的情境呼叫 .val(value)，畫面只會靜靜地在
            // buffer 裡更新，要等下一次真正觸發 render() 的操作才會補上。
            requestRender?.();
            return selection;
          }
          return _blockValue(lines, parsedSelector) ?? "";
        } catch {
          return args.length > 0 ? selection : "";
        }
      },
      push(...items) {
        try {
          const buffer = getBuffer?.();
          const heading = _findHeading(buffer, selector);
          const result = _mutateAndRecordTuiHeadingList(
            buffer, heading, selector, "push", items, 0,
          );
          requestRender?.();
          return result;
        } catch {
          return 0;
        }
      },
      pop() {
        try {
          const buffer = getBuffer?.();
          const heading = _findHeading(buffer, selector);
          const result = _mutateAndRecordTuiHeadingList(
            buffer, heading, selector, "pop", [], undefined,
          );
          requestRender?.();
          return result;
        } catch {
          return undefined;
        }
      },
      shift() {
        try {
          const buffer = getBuffer?.();
          const heading = _findHeading(buffer, selector);
          const result = _mutateAndRecordTuiHeadingList(
            buffer, heading, selector, "shift", [], undefined,
          );
          requestRender?.();
          return result;
        } catch {
          return undefined;
        }
      },
      unshift(...items) {
        try {
          const buffer = getBuffer?.();
          const heading = _findHeading(buffer, selector);
          const result = _mutateAndRecordTuiHeadingList(
            buffer, heading, selector, "unshift", items, 0,
          );
          requestRender?.();
          return result;
        } catch {
          return 0;
        }
      },
      splice(...args) {
        try {
          const buffer = getBuffer?.();
          const heading = _findHeading(buffer, selector);
          const result = _mutateAndRecordTuiHeadingList(
            buffer, heading, selector, "splice", args, [],
          );
          requestRender?.();
          return result;
        } catch {
          return [];
        }
      },
      slice(...args) {
        try {
          const buffer = getBuffer?.();
          const heading = _findHeading(buffer, selector);
          const list = heading ? _tuiHeadingTaskList(buffer, heading) : null;
          if (!list) return [];
          return list.items.map((item) => ({
            value: item.value,
            checked: Boolean(
              _tuiRenderedTaskCheckbox(
                buffer.lines[item.start],
                list.quoteDepth,
              )?.checked,
            ),
          })).slice(...args);
        } catch {
          return [];
        }
      },
    };
    return selection;
  };
}

export function tuiTableCellAtPosition(buffer, lineIndex, characterIndex) {
  const row = Math.trunc(Number(lineIndex));
  const column = Math.trunc(Number(characterIndex));
  if (
    !Array.isArray(buffer?.lines)
    || !Number.isInteger(row)
    || !Number.isInteger(column)
    || row < 0
    || row >= buffer.lines.length
    || column < 0
  ) return null;

  for (const heading of _tuiSourceHeadings(buffer)) {
    const table = _tuiHeadingTable(buffer, heading);
    if (!table || row <= table.top || row >= table.bottom) continue;
    for (let rowIndex = 0; rowIndex < table.rows.length; rowIndex++) {
      const visual = table.rows[rowIndex].find(item => item.y === row);
      if (!visual) continue;
      for (
        let colIndex = 0;
        colIndex + 1 < visual.separators.length;
        colIndex++
      ) {
        if (
          column > visual.separators[colIndex]
          && column < visual.separators[colIndex + 1]
        ) {
          return createTuiSelector(() => buffer)({ id: heading.id })
            .cell(rowIndex, colIndex);
        }
      }
      return null;
    }
  }
  return null;
}

export function markTuiTableCellDirtyAtPosition(buffer, lineIndex, characterIndex) {
  const row = Math.trunc(Number(lineIndex));
  const column = Math.trunc(Number(characterIndex));
  if (!Array.isArray(buffer?.lines) || row < 0 || column < 0) return false;
  for (const heading of _tuiSourceHeadings(buffer)) {
    const table = _tuiHeadingTable(buffer, heading);
    if (!table || row <= table.top || row >= table.bottom) continue;
    for (let rowIndex = 0; rowIndex < table.rows.length; rowIndex++) {
      const visual = table.rows[rowIndex].find(item => item.y === row);
      if (!visual) continue;
      for (let colIndex = 0; colIndex + 1 < visual.separators.length; colIndex++) {
        if (column <= visual.separators[colIndex] || column >= visual.separators[colIndex + 1])
          continue;
        if (!(buffer._mdcuiDirtyTableCells instanceof Set))
          buffer._mdcuiDirtyTableCells = new Set();
        buffer._mdcuiDirtyTableCells.add(`${heading.id}\0${rowIndex}\0${colIndex}`);
        return true;
      }
    }
  }
  return false;
}

// ── micro global object ───────────────────────────────────────────────────────

export function buildMicroGlobal(jsManager) {
  const getApp = () => jsManager._app;
  const getCtx = () => jsManager._ctx;
  const $ = createTuiSelector(
    () => getApp()?.buffer,
    ({ imagesDirty = false } = {}) => {
      const app = getApp();
      if (!app?._started) return;
      if (imagesDirty) void app.refreshMdcuiKittyImages?.(app.buffer);
      else app.render?.();
    },
    ({ buffer, block }) => {
      const app = getApp();
      const pane = app?.pane;
      if (!app?._started || pane?.buffer !== buffer) return;
      app.scrollCursorToAlignment?.(pane, block);
      app.render?.();
    },
  );
  $.tts = async (text, pitch, speed) => {
    const app = getApp();
    if (!app?.runTts) return;
    const parsedPitch = Number(pitch);
    const parsedSpeed = Number(speed);
    if (Number.isFinite(parsedPitch) && parsedPitch > 0)
      Bun.env.TTS_PITCH = String(parsedPitch);
    if (Number.isFinite(parsedSpeed) && parsedSpeed > 0)
      Bun.env.TTS_SPEED = String(parsedSpeed);
    return app.runTts(String(text ?? ""), {
      trackBuffer: false,
    });
  };
  $.tts.stop = () => getApp()?.stopTts?.() ?? false;

  // Converts cmd args to a safe command string for handleCommand
  function buildCmdString(name, args) {
    if (args.length === 0) return String(name);
    const parts = args.map(a => {
      const s = String(a);
      return /[\s"'\\]/.test(s) || s === "" ? JSON.stringify(s) : s;
    });
    return `${name} ${parts.join(" ")}`;
  }

  const micro = {
    // ── Hook registration ──────────────────────────────────────────
    on(hookName, fn) {
      jsManager.on(hookName, fn);
    },

    // ── Current pane access ───────────────────────────────────────
    CurPane() {
      const app = getApp();
      return app?.buffer ? _makePaneAPI(app.buffer, app) : null;
    },

    // ── Option access ─────────────────────────────────────────────
    GetOption:   (name)        => getCtx()?.config?.getGlobalOption(name),
    SetOption:   (name, value) => getCtx()?.config?.setGlobalOptionNative(name, value),

    // ── Messaging ─────────────────────────────────────────────────
    Log:         (...args) => console.log(...args),
    TermMessage: (msg) => { const app = getApp(); if (app) { app.message = String(msg); if (app._started) app.render?.(); } },
    alert: (msg) => { const app = getApp(); return app ? app.protectedAlert(msg) : console.log(String(msg)); },
    confirm: (msg) => { const app = getApp(); return app ? app.protectedConfirm(msg) : false; },
    prompt: (msg, defaultValue = "") => {
      const app = getApp();
      return app ? app.protectedPrompt(msg, defaultValue) : defaultValue;
    },

    // ── Buffer line access (1-based line numbers; omit → cursor line) ─

    // Returns text of line n (1-based). Omit n to use cursor line.
    getLine(lineNumber) {
      const app = getApp();
      if (!app?.buffer) return "";
      const buf = app.buffer;
      const y = lineNumber != null ? Number(lineNumber) - 1 : buf.cursor.y;
      return buf.lines[y] ?? "";
    },

    // Replaces line n (1-based) with text. Text may contain newlines → line expands.
    putLine(text, lineNumber) {
      const app = getApp();
      if (!app?.buffer) return;
      const buf = app.buffer;
      const y = lineNumber != null ? Number(lineNumber) - 1 : buf.cursor.y;
      if (y < 0 || y >= buf.lines.length) return;
      buf.pushUndo?.();
      buf._mdcuiFenceBlockIndex = null;
      const parts = String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
      buf.lines.splice(y, 1, ...parts);
      buf.invalidateHighlightFrom?.(y, { force: parts.length > 1 });
      buf.modified = true;
      buf.ensureCursor?.();
      app.render?.();
    },

    // Deletes line n (1-based). If the buffer has only one line, clears it instead.
    delLine(lineNumber) {
      const app = getApp();
      if (!app?.buffer) return;
      const buf = app.buffer;
      const y = lineNumber != null ? Number(lineNumber) - 1 : buf.cursor.y;
      if (y < 0 || y >= buf.lines.length) return;
      buf.pushUndo?.();
      buf._mdcuiFenceBlockIndex = null;
      if (buf.lines.length === 1) {
        buf.lines[0] = "";
      } else {
        buf.lines.splice(y, 1);
      }
      buf.invalidateHighlightFrom?.(y, { force: true });
      buf.modified = true;
      buf.ensureCursor?.();
      app.render?.();
    },

    // Returns an array of line strings from line `from` to `to` (1-based, inclusive).
    // Omit both to return all lines.
    getLines(from, to) {
      const app = getApp();
      if (!app?.buffer) return [];
      const buf = app.buffer;
      const start = from != null ? Number(from) - 1 : 0;
      const end   = to   != null ? Number(to)   - 1 : buf.lines.length - 1;
      return buf.lines.slice(Math.max(0, start), Math.min(buf.lines.length, end + 1));
    },

    // Returns total number of lines.
    getLinesCount() {
      const app = getApp();
      return app?.buffer?.lines.length ?? 0;
    },

    // Returns the entire buffer content as a single string (lines joined by "\n").
    getAllText() {
      const app = getApp();
      return app?.buffer?.lines.join("\n") ?? "";
    },

    // Returns the rendered ANSI document when available, otherwise plain text.
    getAllAnsiText() {
      const buffer = getApp()?.buffer;
      return typeof buffer?._mdcuiAnsiText === "string"
        ? buffer._mdcuiAnsiText
        : buffer?.lines.join("\n") ?? "";
    },

    // Activates a 1-based rendered-buffer cell in MDCUI; otherwise falls back to goto.
    async clickBufferCell(column = 1, line = 1) {
      const app = getApp();
      const buffer = app?.buffer;
      if (!app || !buffer) return false;

      const targetLine = Math.max(1, Math.trunc(Number(line)) || 1);
      const targetColumn = Math.max(1, Math.trunc(Number(column)) || 1);
      if (!isMdcuiEncoding(buffer.encoding ?? buffer.Settings?.encoding)) {
        await app.handleCommand(`goto ${targetLine}:${targetColumn}`);
        app.render?.();
        return true;
      }

      const y = Math.min(targetLine - 1, Math.max(0, buffer.lines.length - 1));
      const x = Math.min(targetColumn - 1, String(buffer.lines[y] ?? "").length);
      buffer.cursor = { x, y };
      const handled = await app.handleMdcuiCellCallback(buffer, y, x, "mouse");
      app.render?.();
      return handled;
    },

    // Sends terminal input through the App's normal parser and event pipeline.
    async _dispatchRawInput(raw) {
      const app = getApp();
      if (!app) return false;
      const bytes = typeof raw === "string"
        ? new TextEncoder().encode(raw)
        : raw;
      await app._dispatchInput(bytes);
      app.render?.();
      return true;
    },

    // Replaces the entire buffer content with text (may contain newlines).
    putAllText(text) {
      const app = getApp();
      if (!app?.buffer) return;
      const buf = app.buffer;
      buf.pushUndo?.();
      buf._mdcuiFenceBlockIndex = null;
      buf.lines = String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
      if (buf.lines.length === 0) buf.lines = [""];
      buf.invalidateHighlightFrom?.(0, { force: true });
      buf.modified = true;
      buf.ensureCursor?.();
      app.render?.();
    },

    // ── Selection access ──────────────────────────────────────────────

    // Returns the currently selected text, or "" if nothing is selected.
    getSelection() {
      const app = getApp();
      if (!app?.buffer || !app.pane?.selection) return "";
      return _selText(app.buffer, app.pane.selection);
    },

    // Replaces the active selection with text; if nothing selected, inserts at cursor.
    putSelection(text) {
      const app = getApp();
      if (!app?.buffer) return;
      const buf = app.buffer;
      buf.pushUndo?.();
      if (app.pane?.selection) _deleteSel(buf, app.pane);
      buf.insert(String(text));
      app.render?.();
    },

    // ── Register custom command (shows up in Ctrl+E Tab completion) ──
    MakeCommand(name, fn) {
      if (!name || typeof fn !== "function") return;
      jsManager.commands.set(String(name), fn);
    },

    // ── cmd proxy: micro.cmd.save("file.txt") ─────────────────────
    // Each property is a function that calls handleCommand on the current pane.
    cmd: new Proxy({}, {
      get(_, name) {
        if (typeof name !== "string") return undefined;
        return async (...args) => {
          const app = getApp();
          if (!app) return;
          const result = await app.handleCommand(buildCmdString(name, args));
          app.render?.();
          return result;
        };
      },
    }),

    // ── action proxy: micro.action.MoveLinesUp() ──────────────────
    // Each property is an async function that runs a named editor action.
    // micro.shell.COMMAND(...args) — runs COMMAND with args via Ctrl-B interactive shell
    // e.g. micro.shell.ls('-l')  →  runInteractiveShell("ls -l")
    shell: new Proxy({}, {
      get(_, cmd) {
        if (typeof cmd !== "string") return undefined;
        return (...args) => {
          const app = getApp();
          if (!app?.runInteractiveShell) return;
          return app.runInteractiveShell([cmd, ...args.map(String)]);
        };
      },
    }),

    action: new Proxy({}, {
      get(_, name) {
        if (typeof name !== "string") return undefined;
        return async (...args) => {
          const app = getApp();
          if (!app) return;
          const fn = ACTIONS.get(name);
          if (fn) {
            await fn(app, ...args);
          } else {
            // Fallback: try as a method on the current buffer
            const buf = app.buffer;
            if (buf && typeof buf[name] === "function") {
              await buf[name](...args);
            } else {
              console.warn(`[micro.action] unknown action: ${name}`);
              return;
            }
          }
          app.render?.();
        };
      },
    }),

    // ── Runtime info ──────────────────────────────────────────────
    OS:      process.platform,
    Version: "0.1.0-bun",

    // ── Internal: register an action from a JS plugin ─────────────
    RegisterAction(name, fn) {
      ACTIONS.set(name, fn);
    },

    // ── Trigger editor re-render ──────────────────────────────────
    render() {
      getApp()?.render?.();
    },

    // ── Append to lintLog (displayed via :lintlog command) ────────
    pushLintLog(msg) {
      const plugins = getCtx()?.plugins;
      if (plugins) { plugins.lintLog ??= []; plugins.lintLog.push(String(msg)); }
    },

    // ── Buffer message factories ──────────────────────────────────
    // micro.buffer.newMessage(owner, msg, {x,y}, {x,y}, severity)
    // micro.buffer.newMessageAtLine(owner, msg, lineNum, severity)
    // micro.buffer.MTError / MTWarning / MTInfo
    // micro.buffer.Loc(x, y)
    buffer: {
      newMessage,
      newMessageAtLine,
      Loc: (x, y) => new Loc(x, y),
      MTError,
      MTWarning,
      MTInfo,
    },
  };

  globalThis.micro = micro;
  globalThis.$ = $;
  return micro;
}

// ── Pane / Buffer API returned by CurPane() ──────────────────────────────────

function _makePaneAPI(buffer, app) {
  return {
    get Buf()    { return _makeBufAPI(buffer); },
    get Cursor() { return _makeCursorAPI(buffer); },
    CursorLocation: () => app?.formatCursorLocation?.(buffer) ?? "+1.0:1",
    AbsoluteCursorLocation: () => app?.formatAbsoluteCursorLocation?.(buffer) ?? "+1:1",

    Save:        async () => app?.save?.(),
    Quit:        async () => app?.quit?.(),
    Backspace:   () => buffer.backspace(),
    Delete:      () => buffer.deleteForward(),
    CursorLeft:  () => buffer.moveLeft(),
    CursorRight: () => buffer.moveRight(),
    CursorUp:    () => buffer.moveUp(),
    CursorDown:  () => buffer.moveDown(),
    StartOfLine: () => buffer.moveHome(),
    EndOfLine:   () => buffer.moveEnd(),
    InsertNewline: () => buffer.newline(),
    InsertTab:   () => buffer.insertTab(),
    Insert:      (text) => { buffer.pushUndo?.(); buffer.insert(text); app?.render?.(); },
    HandleCommand: (cmd) => app?.handleCommand?.(cmd),

    // Run a named action on this pane
    RunAction: async (name, ...args) => {
      const fn = ACTIONS.get(name);
      if (fn) { await fn(app, ...args); app.render?.(); }
    },
  };
}

function _makeBufAPI(buffer) {
  return {
    get Path()     { return buffer.path ?? ""; },
    get AbsPath()  { return buffer.AbsPath ?? buffer.path ?? ""; },
    get Type()     { return buffer.Type; },
    get Settings() { return buffer.Settings; },
    get Modified() { return buffer.modified; },
    get MdcuiModuleSource() {
      return global.MDCUI_MAIN && buffer._useBundledMdcuiModules
        ? "embedded"
        : "external";
    },

    Line:      (n) => buffer.Line(n),
    LinesNum:  ()  => buffer.LinesNum(),
    FileType:  ()  => buffer.FileType(),
    SetOption: (opt, val) => buffer.SetOption(opt, val),
    Insert:    (loc, text) => buffer.Insert(loc, text),
    GetActiveCursor: () => _makeCursorAPI(buffer),
  };
}

function _makeCursorAPI(buffer) {
  return {
    get X() { return buffer.cursor.x; },
    set X(v) { buffer.cursor.x = v; buffer.ensureCursor?.(); },
    get Y() { return buffer.cursor.y; },
    set Y(v) { buffer.cursor.y = v; buffer.ensureCursor?.(); },
  };
}
