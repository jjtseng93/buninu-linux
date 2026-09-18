import { mkdirSync } from "node:fs";
import { appendFile, rename, stat } from "node:fs/promises";
import { dirname } from "node:path";

function importEnabled(env) {
  return !/^(?:0|false|off|no)$/i.test(env.BUNMSH_IMPORT_HISTORY ?? "");
}

// History is rendered directly beside the prompt. Reject the entire entry
// instead of stripping bytes and accidentally turning it into another command.
export function safeHistoryEntry(entry) {
  return typeof entry === "string" && entry.length > 0 &&
    !/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/u.test(entry);
}

// node:readline stores its history newest-first, while bunmsh keeps history in
// chronological order for saving and ghost completion.
export function readlineHistory(history) {
  return history.filter(safeHistoryEntry).toReversed();
}

export function bunmshHistoryPath(env = process.env, platform = process.platform) {
  const trim = (value) => value?.replace(/[\\/]+$/, "");
  if (platform === "win32") {
    const base = trim(env.LOCALAPPDATA || env.APPDATA ||
      (env.USERPROFILE ? `${trim(env.USERPROFILE)}/AppData/Local` : ""));
    return base ? `${base}/bunmsh/history` : null;
  }
  const base = trim(env.XDG_DATA_HOME || (env.HOME ? `${trim(env.HOME)}/.local/share` : ""));
  return base ? `${base}/bunmsh/history` : null;
}

async function readableText(path) {
  const file = Bun.file(path);
  return await file.exists() ? file.text() : null;
}

async function statSafe(path) {
  try { return await stat(path); } catch { return null; }
}

export function parseBashHistory(source) {
  return source
    .split(/\r?\n/)
    .filter((line) => !/^#[0-9]+$/.test(line) && safeHistoryEntry(line));
}

export function parseFishHistory(source) {
  const records = source.split(/\r?\n/)
    .map((line) => /^- cmd:\s?(.*)$/.exec(line)?.[1] ?? null)
    .filter((entry) => entry !== null);
  // Fish documents this as "YAML-style", not YAML. Command scalars use Fish's
  // own escaping and can be rejected or only partially consumed by YAML
  // parsers. The stable record boundary is the unindented `- cmd:` prefix.
  return records
    .map((entry) => entry.replace(/\\(\\|n)/g, (_match, escaped) => escaped === "n" ? "\n" : "\\"))
    .filter(safeHistoryEntry);
}

// bunmsh saved its own history as a single JSON array before switching to
// one-JSON-value-per-line (JSONL). Detecting and reading that old format
// keeps existing history files working; see saveBunmshHistory for where the
// on-disk file actually gets converted.
function isLegacyArrayFormat(source) {
  return source.trimStart().startsWith("[");
}

function parseLegacyArrayFormat(source) {
  const parsed = JSON.parse(source);
  return Array.isArray(parsed) ? parsed.filter(safeHistoryEntry) : [];
}

// Bun.JSONL.parse stops at the first line it can't parse instead of skipping
// it, which would silently discard every entry after one corrupted line (for
// example from a write torn by a crash). Detect that by comparing against the
// non-empty line count, and fall back to a per-line parse that only skips the
// bad lines when it looks like that happened.
function parseJsonlFormat(source) {
  const lines = source.split(/\r?\n/).filter((line) => line.trim() !== "");
  let parsed;
  try { parsed = Bun.JSONL.parse(source); } catch { parsed = []; }
  if (parsed.length < lines.length) {
    parsed = [];
    for (const line of lines) {
      try { parsed.push(JSON.parse(line)); } catch {}
    }
  }
  return parsed.filter(safeHistoryEntry);
}

function parseBunmshHistoryContent(source) {
  if (source.trim() === "") return [];
  return isLegacyArrayFormat(source) ? parseLegacyArrayFormat(source) : parseJsonlFormat(source);
}

function encodeJsonlLines(entries) {
  return entries.map((entry) => `${JSON.stringify(entry)}\n`).join("");
}

// Writes the whole file in one shot via a temp file plus atomic rename, so a
// crash or interruption mid-write can never leave a half-written, unreadable
// history file behind — only ever the old content or the new content.
async function writeHistoryFileAtomic(path, entries) {
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await Bun.write(tmpPath, encodeJsonlLines(entries));
  await rename(tmpPath, path);
}

function dedupeEntries(entries) {
  const seen = new Set();
  const unique = [];
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (!safeHistoryEntry(entry) || seen.has(entry)) continue;
    seen.add(entry);
    unique.push(entry);
  }
  return unique.reverse();
}

// The routine, frequent save path (manual `tab s`/`tab save`, the periodic
// autosave, and the on-exit flush all call this). It only appends the
// entries this session hasn't persisted yet — tracked on `state` via
// historySaved, a count into state.history — instead of rewriting the whole
// file, so it stays safe to call from multiple bunmsh sessions at once:
// each one only ever adds its own new lines to the end, never touching (or
// needing to know about) what any other session already wrote.
export async function saveBunmshHistory(state, env = process.env, platform = process.platform) {
  const path = bunmshHistoryPath(env, platform);
  if (!path) throw new Error("cannot determine bunmsh history path");
  mkdirSync(dirname(path), { recursive: true });
  if (!state.historyMigrated) {
    // One-time upgrade for a pre-existing legacy (JSON-array) file. Like the
    // explicit dedupe below, this rewrites the whole file, so it carries the
    // same small risk of racing another session's concurrent write — but it
    // happens at most once per history file, ever.
    const source = await readableText(path);
    if (source !== null && isLegacyArrayFormat(source))
      await writeHistoryFileAtomic(path, parseLegacyArrayFormat(source));
    state.historyMigrated = true;
  }
  const saved = state.historySaved ?? 0;
  const pending = (state.history ?? []).slice(saved).filter(safeHistoryEntry);
  if (pending.length) await appendFile(path, encodeJsonlLines(pending));
  state.historySaved = (state.history ?? []).length;
  return path;
}

// The explicit, occasional maintenance path (`tab s d` / `tab save dedupe`):
// rewrites the whole file with only the most recent occurrence of each
// command kept. Unlike saveBunmshHistory, this can race a concurrent save
// from another session — that's the trade-off for being able to shrink the
// file at all, since dropping duplicates means looking at (and replacing)
// entries this session didn't itself write. `raced` reports whether the
// file's mtime/size changed while this ran, as a best-effort heads-up (not a
// guarantee) that another session's write may have been overwritten by it.
export async function dedupeBunmshHistory(state, env = process.env, platform = process.platform) {
  // Flush this session's own pending entries through the safe path first, so
  // the dedupe/rewrite below is never the reason they'd be lost.
  const path = await saveBunmshHistory(state, env, platform);
  const before = await statSafe(path);
  const source = await readableText(path);
  const deduped = dedupeEntries(source === null ? [] : parseBunmshHistoryContent(source));
  const after = await statSafe(path);
  const raced = Boolean(before && after &&
    (before.mtimeMs !== after.mtimeMs || before.size !== after.size));
  await writeHistoryFileAtomic(path, deduped);
  return { path, raced, count: deduped.length };
}

export async function importedHistory(env = process.env, platform = process.platform) {
  const home = env.HOME?.replace(/\/+$/, "");
  const paths = [];
  if (importEnabled(env) && home) paths.push(
    { type: "bash", path: env.HISTFILE || `${home}/.bash_history` },
    { type: "fish", path: `${home}/.local/share/fish/fish_history` },
  );
  const ownPath = bunmshHistoryPath(env, platform);
  if (ownPath) paths.push({ type: "bunmsh", path: ownPath });
  const history = [];
  for (const item of paths) {
    try {
      const source = await readableText(item.path);
      if (source === null) continue;
      history.push(...(item.type === "fish" ? parseFishHistory(source) :
        item.type === "bunmsh" ? parseBunmshHistoryContent(source) : parseBashHistory(source)));
    } catch {}
  }
  // Keep the most recent occurrence, matching historyGhost's reverse lookup.
  const seen = new Set();
  const unique = [];
  for (let index = history.length - 1; index >= 0; index--) {
    if (seen.has(history[index])) continue;
    seen.add(history[index]);
    unique.push(history[index]);
  }
  return unique.reverse();
}
