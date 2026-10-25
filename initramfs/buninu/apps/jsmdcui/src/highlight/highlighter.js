export class Highlighter {
  constructor(definition, definitions = []) {
    this.definition = definition;
    this.definitions = definitions;
    this.rules = resolveRules(definition?.rules ?? [], definitions, new Set());
  }

  highlightLine(line, state = null, progress = null) {
    const text = String(line);
    const changes = new Map([[0, state?.group ?? "default"]]);
    const nextState = scanLine(changes, text, state, this.rules, progress);
    return {
      changes: normalizeChanges(changes, text.length),
      state: nextState,
    };
  }

  highlightString(input) {
    const matches = [];
    let state = null;
    for (const line of String(input).split("\n")) {
      const result = this.highlightLine(line, state);
      matches.push(result.changes);
      state = result.state;
    }
    return matches;
  }
}

export function resolveRules(rules, definitions, seen, ancestors = new Set()) {
  if (ancestors.has(rules) || ancestors.size >= 128) return [];
  const path = new Set(ancestors); path.add(rules);
  const out = [];
  for (const rule of rules) {
    if (rule.type === "include") {
      if (seen.has(rule.include)) continue;
      seen.add(rule.include);
      const def = definitions.find((candidate) => candidate.filetype === rule.include);
      if (def) out.push(...resolveRules(def.rules, definitions, seen, path));
    } else if (rule.type === "region") {
      out.push({ ...rule, rules: resolveRules(rule.rules ?? [], definitions, new Set(seen), path) });
    } else {
      out.push(rule);
    }
  }
  return out;
}

export function flattenRules(rules, definitions, seen) {
  return resolveRules(rules, definitions, seen).flatMap((rule) => {
    if (rule.type === "region") return flattenRules(rule.rules ?? [], definitions, new Set(seen));
    return rule.type === "pattern" ? [rule] : [];
  });
}

// Iterative state machine: adjacent tokens on a minified line must not consume
// call-stack depth. A state repeated at an unchanged position steps forward.
function scanLine(changes, line, region, rootRules, progress) {
  let cursor = 0, previous = -1;
  const visited = new Set();
  const parents = new Set();
  for (let r = region; r; r = r.parent) {
    if (parents.has(r) || parents.size >= 128) { region = null; changes.set(0, "default"); break; }
    parents.add(r);
  }
  while (cursor <= line.length) {
    if (cursor !== previous) { visited.clear(); previous = cursor; }
    if (visited.has(region)) {
      // A zero-width child can end and reopen forever at the same position.
      // Skip one character in the current region, like a zero-width match.
      cursor = advanceIndex(line, cursor);
      continue;
    }
    if (visited.size >= 256) {
      // Fresh object states from malformed externally supplied trees.
      // Discard this line's unfinished region; do not poison subsequent lines.
      changes.set(cursor, "default"); changes.set(line.length, "default");
      return null;
    }
    visited.add(region);
    progress?.(cursor);
    const rules = region?.rules ?? rootRules;
    const end = region ? findMatch(region.end, line, cursor, region.skip, progress) : null;
    const nested = findFirstRegion(rules, line, cursor, progress);
    if (end && (!nested || end.start <= nested.start)) {
      applyPatterns(changes, line, cursor, end.start, rules, region.group, progress);
      changes.set(end.start, region.limitGroup ?? region.group);
      changes.set(end.end, parentGroup(region));
      progress?.(end.end);
      const parent = region.parent ?? null;
      cursor = parent ? end.end : Math.max(end.end, advanceIndex(line, end.start));
      region = parent;
      continue;
    }
    if (nested) {
      applyPatterns(changes, line, cursor, nested.start, rules, region?.group ?? "default", progress);
      changes.set(nested.start, nested.region.limitGroup ?? nested.region.group);
      region = region ? { ...nested.region, parent: region } : nested.region;
      changes.set(nested.end, region.group);
      progress?.(nested.end);
      cursor = nested.end;
      continue;
    }
    applyPatterns(changes, line, cursor, line.length, rules, region?.group ?? "default", progress);
    changes.set(line.length, region?.group ?? "default");
    progress?.(line.length);
    return region;
  }
  return region;
}

// AdvanceStringIndex for Unicode regexps, including isolated surrogate units.
function advanceIndex(text, index) {
  return index + (text.codePointAt(index) > 0xFFFF ? 2 : 1);
}

function applyPatterns(changes, line, start, end, rules, fallbackGroup, progress = null) {
  if (end < start) return;
  const length = end - start;
  if (length === 0) {
    if (!changes.has(start)) changes.set(start, fallbackGroup);
    return;
  }
  // Mirror Go's fullHighlights approach: later rules overwrite all positions in their match range,
  // preventing earlier rules (e.g. symbol.operator matching "!") from leaking into spans that a
  // later rule (e.g. the shebang comment pattern) should own entirely.
  const fullHighlights = new Array(length).fill(null);
  for (const rule of rules) {
    if (rule.type !== "pattern" || !rule.regex) continue;
    for (const match of findAllMatches(rule.regex, line, start, end, progress)) {
      if (match.start === match.end) continue;
      const lo = Math.max(match.start, start) - start;
      const hi = Math.min(match.end, end) - start;
      for (let i = lo; i < hi; i++) fullHighlights[i] = rule.group;
    }
    progress?.(end);
  }
  // Emit only color-change boundaries into the changes map (same as Go's transition loop).
  let prev = changes.get(start) ?? fallbackGroup;
  for (let i = 0; i < length; i++) {
    const g = fullHighlights[i] ?? fallbackGroup;
    if (g !== prev) { changes.set(start + i, g); prev = g; }
  }
  if (!changes.has(start)) changes.set(start, fullHighlights[0] ?? fallbackGroup);
  if (!changes.has(end)) changes.set(end, fallbackGroup);
}

function findFirstRegion(rules, line, pos, progress = null) {
  let best = null;
  for (const region of rules.filter((rule) => rule.type === "region" && rule.start)) {
    const match = findMatch(region.start, line, pos, region.skip, progress);
    if (!match) continue;
    if (!best || match.start < best.start) best = { ...match, region };
  }
  return best;
}

function findMatch(regex, line, pos, skip, progress = null) {
  if (!regex) return null;
  const masked = skip ? maskSkipped(line, skip) : line;
  const global = globalize(regex);
  global.lastIndex = pos;
  let match;
  while ((match = global.exec(masked)) !== null) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    progress?.(start);
    if (start >= pos) return { start, end };
    global.lastIndex = Math.max(global.lastIndex, advanceIndex(masked, start));
  }
  progress?.(line.length);
  return null;
}

function findAllMatches(regex, line, start, end, progress = null) {
  const out = [];
  const global = globalize(regex);
  global.lastIndex = start;
  let match;
  if (!progress) {
    while ((match = global.exec(line)) !== null) {
      const matchStart = match.index ?? 0;
      if (matchStart >= end) break;
      const matchEnd = matchStart + match[0].length;
      if (match[0].length === 0) {
        global.lastIndex = advanceIndex(line, matchStart);
        continue;
      }
      if (matchEnd > start) out.push({ start: Math.max(matchStart, start), end: Math.min(matchEnd, end) });
    }
    return out;
  }
  while ((match = global.exec(line)) !== null) {
    const matchStart = match.index ?? 0;
    const matchEnd = matchStart + match[0].length;
    if (matchStart >= end) break;
    progress?.(matchStart);
    if (match[0].length === 0) {
      global.lastIndex = advanceIndex(line, matchStart);
      continue;
    }
    if (matchEnd <= start || matchStart >= end) continue;
    out.push({ start: Math.max(matchStart, start), end: Math.min(matchEnd, end) });
  }
  progress?.(end);
  return out;
}

function maskSkipped(line, skip) {
  return line.replace(globalize(skip), (value) => "\0".repeat(value.length));
}

function normalizeChanges(changes, lineLength) {
  const normalized = new Map([...changes.entries()]
    .filter(([index]) => index >= 0 && index <= lineLength)
    .sort(([a], [b]) => a - b));
  if (!normalized.has(0)) normalized.set(0, "default");
  if (!normalized.has(lineLength)) normalized.set(lineLength, normalized.get([...normalized.keys()].at(-1)) ?? "default");
  return new Map([...normalized.entries()].sort(([a], [b]) => a - b));
}

function parentGroup(region) {
  return region.parent?.group ?? "default";
}

function globalize(regex) {
  const flags = new Set(regex.flags.split(""));
  flags.add("g");
  return new RegExp(regex.source, [...flags].join(""));
}
