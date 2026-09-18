import {
  collectMarkdownHeadingDeclarations,
} from "./heading-ids.mjs";
import {
  addTuiTableRowSeparators,
  convertTuiTableCheckboxes,
  markHeadingTableRows,
} from "./table-render.mjs";
import { renderAnsiWithDataImages } from "./kitty-images.mjs";

function headingRecord(store, id) {
  let record = store.get(id);
  if (!record || typeof record !== "object") {
    record = {};
    store.set(id, record);
  }
  if (!record.data || typeof record.data !== "object")
    record.data = Object.create(null);
  if (!Array.isArray(record.components)) record.components = [];
  return record;
}

function fenceOpening(line) {
  const match = /^( {0,3})(`{3,}|~{3,})([^\r\n]*)$/u.exec(String(line ?? ""));
  if (!match) return null;
  return {
    character: match[2][0],
    length: match[2].length,
    info: match[3].trim(),
  };
}

function fenceClosing(line, opening) {
  const character = opening.character === "`" ? "`" : "~";
  const match = /^( {0,3})(`{3,}|~{3,})[ \t]*$/u.exec(String(line ?? ""));
  return Boolean(
    match
    && match[2][0] === character
    && match[2].length >= opening.length
  );
}

function headingAtLine(headings, line) {
  let current = null;
  for (const heading of headings) {
    if (heading.line >= line) break;
    current = heading;
  }
  return current;
}

function invisibleOrdinal(ordinal) {
  return Math.max(0, Number(ordinal) || 0).toString(4)
    .replaceAll("0", "\u200b")
    .replaceAll("1", "\u200c")
    .replaceAll("2", "\u2062")
    .replaceAll("3", "\u2063");
}

function tuiComponentMarkers(ordinal) {
  const encoded = invisibleOrdinal(ordinal);
  return {
    start: `\u2060\u2061${encoded}\u2060`,
    end: `\u2060\u2062${encoded}\u2060`,
  };
}

function templateOutput(component, mode, ordinal) {
  if (mode === "wui") {
    component.marker = { ordinal };
    return `<!--mdcui-template-start:${ordinal}-->\n${component.last}`
      + `\n<!--mdcui-template-end:${ordinal}-->`;
  }
  component.marker = tuiComponentMarkers(ordinal);
  return `\n${component.marker.start}\n\n${component.last}`
    + `\n\n${component.marker.end}\n`;
}

export function compileTemplateComponentRender(source, templateType = "md") {
  return new Function(
    "data = {}",
    templateType === "js"
      ? String(source ?? "")
      : `return \`${String(source ?? "")}\`;`,
  );
}

function extractTemplateFrontMatter(source) {
  const lines = String(source ?? "").split("\n");
  if (lines[0] !== "---") return { source: String(source ?? ""), data: null };
  const closing = lines.findIndex((line, index) => index > 0 && line === "---");
  if (closing < 0) return { source: String(source ?? ""), data: null };
  const parsed = Bun.YAML.parse(lines.slice(1, closing).join("\n"));
  const data = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed
    : null;
  return {
    source: lines.slice(closing + 1).join("\n"),
    data,
  };
}

export function renderMarkdownTemplateComponents(markdown, { mode = "tui" } = {}) {
  const source = String(markdown ?? "");
  const lines = source.split(/\r\n?|\n/u);
  const headings = collectMarkdownHeadingDeclarations(source, {
    includeLevel: true,
  });
  const idStore = new Map();
  const output = [];
  let componentOrdinal = 0;

  for (let index = 0; index < lines.length;) {
    const opening = fenceOpening(lines[index]);
    if (!opening) {
      output.push(lines[index++]);
      continue;
    }

    let closing = index + 1;
    while (closing < lines.length && !fenceClosing(lines[closing], opening))
      closing++;

    const templateMatch = opening.info.match(/^(md|js)[ \t]+template$/iu);
    const isTemplate = opening.character === "`"
      && opening.length === 4
      && templateMatch;
    const heading = isTemplate ? headingAtLine(headings, index + 1) : null;
    if (!heading || closing >= lines.length) {
      output.push(...lines.slice(index, Math.min(closing + 1, lines.length)));
      index = Math.min(closing + 1, lines.length);
      continue;
    }

    const record = headingRecord(idStore, heading.id);
    const componentIndex = record.components.length;
    const rawSource = lines.slice(index + 1, closing).join("\n");
    const frontMatter = extractTemplateFrontMatter(rawSource);
    if (frontMatter.data) Object.assign(record.data, frontMatter.data);
    const componentSource = frontMatter.source;
    const templateType = templateMatch[1].toLowerCase();
    const component = {
      source: componentSource,
      templateType,
      initialData: frontMatter.data,
      last: null,
      data: record.data,
      id: heading.id,
      index: componentIndex,
      render: compileTemplateComponentRender(componentSource, templateType),
    };
    record.components.push(component);
    output.push({ component, mode, ordinal: componentOrdinal++ });
    index = closing + 1;
  }

  for (const record of idStore.values()) {
    for (const component of record.components)
      component.last = String(component.render.call(component, component.data) ?? "");
  }
  return {
    markdown: output.map(item => typeof item === "string"
      ? item
      : templateOutput(item.component, item.mode, item.ordinal)
    ).join("\n"),
    idStore,
  };
}

function escapeHtmlAttribute(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function wrapWuiTemplateComponents(html, store) {
  let output = String(html ?? "");
  if (!(store instanceof Map)) return output;
  for (const [id, record] of store) {
    for (const component of record?.components ?? []) {
      const ordinal = component?.marker?.ordinal;
      if (!Number.isInteger(ordinal)) continue;
      const start = `<!--mdcui-template-start:${ordinal}-->`;
      const end = `<!--mdcui-template-end:${ordinal}-->`;
      const startAt = output.indexOf(start);
      const endAt = startAt < 0 ? -1 : output.indexOf(end, startAt + start.length);
      if (startAt < 0 || endAt < 0) continue;
      const body = output.slice(startAt + start.length, endAt);
      const opening = `<div class="mdcui-template"`
        + ` data-mdcui-heading-id="${escapeHtmlAttribute(id)}"`
        + ` data-mdcui-component-index="${component.index}">`;
      output = output.slice(0, startAt) + opening + body + "</div>"
        + output.slice(endAt + end.length);
    }
  }
  return output;
}

export function renderTuiComponentMarkdown(component, markdown, columns = 80) {
  const start = String(component?.marker?.start ?? "");
  const end = String(component?.marker?.end ?? "");
  if (!start || !end) return null;
  const source = `# MDCUI reactive template\n\n${start}\n\n${String(markdown ?? "")}`
    + `\n\n${end}\n`;
  const plan = markHeadingTableRows(source);
  let ansi = renderAnsiWithDataImages(plan.markdown, {
    hyperlinks: true,
    columns: Math.max(1, Math.trunc(Number(columns) || 80)),
  });
  ansi = addTuiTableRowSeparators(ansi, plan);
  ansi = convertTuiTableCheckboxes(ansi);
  const ansiLines = ansi.split("\n");
  const plainLines = Bun.stripANSI(ansi).split("\n");
  const startLine = plainLines.findIndex(line => line.includes(start));
  const endLine = plainLines.findIndex(
    (line, index) => index > startLine && line.includes(end),
  );
  if (startLine < 0 || endLine < 0) return null;
  return {
    ansi: ansiLines.slice(startLine + 1, endLine),
    lines: plainLines.slice(startLine + 1, endLine),
  };
}

export function applyPreRenderHeadingData(buffer, preRenderStore) {
  if (!buffer || !(preRenderStore instanceof Map)) return buffer;
  if (!(buffer._mdcuiIdStore instanceof Map)) buffer._mdcuiIdStore = new Map();

  for (const [id, preRecord] of preRenderStore) {
    if (!preRecord || typeof preRecord !== "object") continue;
    let record = buffer._mdcuiIdStore.get(id);
    if (!record || typeof record !== "object") {
      buffer._mdcuiIdStore.set(id, preRecord);
      continue;
    }

    if (!record.data || typeof record.data !== "object") {
      record.data = preRecord.data;
    } else if (preRecord.data && record.data !== preRecord.data) {
      Object.assign(record.data, preRecord.data);
    }

    record.components = Array.isArray(preRecord.components)
      ? preRecord.components
      : [];
    for (const component of record.components) {
      component.data = record.data;
    }
  }
  return buffer;
}
