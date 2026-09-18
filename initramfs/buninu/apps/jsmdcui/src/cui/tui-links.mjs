function oscTerminator(input, start) {
  for (let index = start; index < input.length; index++) {
    if (input.charCodeAt(index) === 0x07 || input.charCodeAt(index) === 0x9c)
      return { start: index, end: index + 1 };
    if (input[index] === "\x1b" && input[index + 1] === "\\")
      return { start: index, end: index + 2 };
  }
  return null;
}

function csiEnd(input, start) {
  for (let index = start; index < input.length; index++) {
    const code = input.charCodeAt(index);
    if (code >= 0x40 && code <= 0x7e) return index + 1;
    if (code < 0x20) return index;
  }
  return input.length;
}

function osc8Uri(payload) {
  if (!payload.startsWith("8;")) return undefined;
  const separator = payload.indexOf(";", 2);
  if (separator < 0) return undefined;
  return payload.slice(separator + 1);
}

function addVisibleLinkUnit(link, row, start, text) {
  let rowText = link.rowTexts.at(-1);
  if (!rowText || rowText.row !== row) {
    rowText = { row, text: "" };
    link.rowTexts.push(rowText);
  }
  rowText.text += text;

  const end = start + text.length;
  const segment = link.segments.at(-1);
  if (segment && segment.row === row && segment.end === start)
    segment.end = end;
  else
    link.segments.push({ row, start, end });
}

function finishAnsiLink(link, input, end) {
  if (!link) return;
  link.textContent = link.rowTexts.map(item => item.text).join("\n");
  link.presentation = input.slice(link.rawStart, end);
  delete link.rowTexts;
  delete link.rawStart;
}

function parseAnsiLinks(ansiText) {
  const input = String(ansiText ?? "");
  const links = [];
  let active = null;
  let row = 0;
  // Buffer cursor x is a JavaScript string index, so link ranges deliberately
  // use UTF-16 code units rather than terminal cell widths.
  let column = 0;

  for (let index = 0; index < input.length;) {
    const code = input.charCodeAt(index);

    if (input[index] === "\x1b" && input[index + 1] === "]") {
      const terminator = oscTerminator(input, index + 2);
      if (!terminator) break;
      const uri = osc8Uri(input.slice(index + 2, terminator.start));
      if (uri !== undefined) {
        finishAnsiLink(active, input, index);
        active = null;
        if (uri) {
          active = {
            href: uri,
            textContent: "",
            innerHTML: null,
            segments: [],
            rowTexts: [],
            rawStart: terminator.end,
          };
          links.push(active);
        }
      }
      index = terminator.end;
      continue;
    }

    if (code === 0x9d) {
      const terminator = oscTerminator(input, index + 1);
      if (!terminator) break;
      const uri = osc8Uri(input.slice(index + 1, terminator.start));
      if (uri !== undefined) {
        finishAnsiLink(active, input, index);
        active = null;
        if (uri) {
          active = {
            href: uri,
            textContent: "",
            innerHTML: null,
            segments: [],
            rowTexts: [],
            rawStart: terminator.end,
          };
          links.push(active);
        }
      }
      index = terminator.end;
      continue;
    }

    if (input[index] === "\x1b" && input[index + 1] === "[") {
      index = csiEnd(input, index + 2);
      continue;
    }
    if (code === 0x9b) {
      index = csiEnd(input, index + 1);
      continue;
    }
    if (
      input[index] === "\x1b"
      && ["P", "^", "_"].includes(input[index + 1])
    ) {
      const terminator = oscTerminator(input, index + 2);
      index = terminator?.end ?? input.length;
      continue;
    }
    if (input[index] === "\x1b") {
      index += Math.min(2, input.length - index);
      continue;
    }

    if (input[index] === "\n") {
      row++;
      column = 0;
      index++;
      continue;
    }
    if (input[index] === "\r") {
      column = 0;
      index++;
      continue;
    }
    if (code < 0x20 && input[index] !== "\t") {
      index++;
      continue;
    }

    const point = input.codePointAt(index);
    const length = point > 0xffff ? 2 : 1;
    const text = input.slice(index, index + length);
    if (active) addVisibleLinkUnit(active, row, column, text);
    column += length;
    index += length;
  }

  finishAnsiLink(active, input, input.length);
  return links.filter(link => link.segments.length > 0);
}

const htmlEntities = new Map([
  ["amp", "&"],
  ["apos", "'"],
  ["gt", ">"],
  ["lt", "<"],
  ["nbsp", "\u00a0"],
  ["quot", '"'],
]);

function decodeHtmlEntities(value) {
  return String(value ?? "").replace(
    /&(?:#(\d+)|#x([\da-f]+)|([a-z][\da-z]+));/gi,
    (whole, decimal, hexadecimal, name) => {
      if (decimal != null || hexadecimal != null) {
        const point = Number.parseInt(decimal ?? hexadecimal, hexadecimal == null ? 10 : 16);
        if (Number.isInteger(point) && point >= 0 && point <= 0x10ffff) {
          try { return String.fromCodePoint(point); }
          catch {}
        }
        return "\ufffd";
      }
      return htmlEntities.get(String(name).toLowerCase()) ?? whole;
    },
  );
}

function htmlTagAt(input, start) {
  if (input[start] !== "<") return null;
  if (input.startsWith("<!--", start)) {
    const end = input.indexOf("-->", start + 4);
    return {
      kind: "comment",
      start,
      end: end < 0 ? input.length : end + 3,
      source: input.slice(start, end < 0 ? input.length : end + 3),
    };
  }

  let index = start + 1;
  let quote = null;
  for (; index < input.length; index++) {
    const character = input[index];
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === ">") break;
  }
  if (index >= input.length) return null;

  const source = input.slice(start, index + 1);
  const match = source.match(/^<\s*(\/?)\s*([A-Za-z][\w:-]*)/);
  if (!match) return {
    kind: "other",
    start,
    end: index + 1,
    source,
  };
  return {
    kind: "tag",
    start,
    end: index + 1,
    source,
    closing: Boolean(match[1]),
    name: match[2].toLowerCase(),
    selfClosing: /\/\s*>$/.test(source),
  };
}

function htmlAttribute(token, expectedName) {
  if (token?.kind !== "tag" || token.closing) return undefined;
  const input = token.source;
  const opening = input.match(/^<\s*[^\s/>]+/);
  if (!opening) return undefined;
  let index = opening[0].length;
  const wanted = expectedName.toLowerCase();

  while (index < input.length) {
    while (/\s/u.test(input[index] ?? "")) index++;
    if (input[index] === ">" || input[index] === "/" || index >= input.length)
      return undefined;

    const nameStart = index;
    while (index < input.length && !/[\s=/>]/u.test(input[index])) index++;
    const name = input.slice(nameStart, index).toLowerCase();
    while (/\s/u.test(input[index] ?? "")) index++;

    if (input[index] !== "=") {
      if (name === wanted) return "";
      continue;
    }
    index++;
    while (/\s/u.test(input[index] ?? "")) index++;
    const quote = input[index] === '"' || input[index] === "'"
      ? input[index++]
      : null;
    const valueStart = index;
    if (quote) {
      while (index < input.length && input[index] !== quote) index++;
    } else {
      while (index < input.length && !/[\s>]/u.test(input[index])) index++;
    }
    const value = input.slice(valueStart, index);
    if (quote && input[index] === quote) index++;
    if (name === wanted) return decodeHtmlEntities(value);
  }
  return undefined;
}

function visibleHtmlFragmentText(fragment) {
  const input = String(fragment ?? "");
  let output = "";
  let cursor = 0;
  let index = 0;

  while (index < input.length) {
    const start = input.indexOf("<", index);
    if (start < 0) break;
    const token = htmlTagAt(input, start);
    if (!token) {
      index = start + 1;
      continue;
    }
    output += decodeHtmlEntities(input.slice(cursor, start));
    if (token.kind === "tag" && !token.closing) {
      if (token.name === "br") output += "\n";
      else if (token.name === "img") {
        const alt = htmlAttribute(token, "alt") ?? "";
        output += `📷${alt ? ` ${alt}` : ""}`;
      }
    }
    cursor = token.end;
    index = token.end;
  }
  output += decodeHtmlEntities(input.slice(cursor));
  return output;
}

function renderedLinkMetadata(markdownSource) {
  if (
    typeof markdownSource !== "string"
    || typeof globalThis.Bun?.markdown?.html !== "function"
  ) return [];

  let html;
  try { html = String(Bun.markdown.html(markdownSource)); }
  catch { return []; }

  const items = [];
  const anchors = [];
  for (let index = 0; index < html.length;) {
    const start = html.indexOf("<", index);
    if (start < 0) break;
    const token = htmlTagAt(html, start);
    if (!token) {
      index = start + 1;
      continue;
    }
    index = token.end;
    if (token.kind !== "tag") continue;

    if (!token.closing && token.name === "a") {
      const href = htmlAttribute(token, "href");
      anchors.push({
        href,
        innerStart: token.end,
        order: token.start,
      });
      continue;
    }

    if (token.closing && token.name === "a") {
      const anchor = anchors.pop();
      if (!anchor || anchor.href == null) continue;
      const innerHTML = html.slice(anchor.innerStart, token.start);
      items.push({
        kind: "anchor",
        href: anchor.href,
        innerHTML,
        textContent: visibleHtmlFragmentText(innerHTML),
        order: anchor.order,
      });
      continue;
    }

    if (!token.closing && token.name === "img" && anchors.length === 0) {
      const href = htmlAttribute(token, "src");
      if (href == null) continue;
      const alt = htmlAttribute(token, "alt") ?? "";
      items.push({
        kind: "image",
        href,
        innerHTML: null,
        textContent: `📷${alt ? ` ${alt}` : ""}`,
        order: token.start,
      });
    }
  }

  return items.sort((left, right) => left.order - right.order);
}

function htmlSerializedHref(value) {
  try {
    return String(value).split(/(%[\da-f]{2})/gi)
      .map(part => /^%[\da-f]{2}$/i.test(part) ? part : encodeURI(part))
      .join("");
  } catch {
    return null;
  }
}

function equivalentHref(renderedHref, metadataHref) {
  if (renderedHref === metadataHref) return true;
  return htmlSerializedHref(renderedHref) === metadataHref;
}

function visibleTextFingerprint(value, rendered = false) {
  const text = String(value ?? "").replace(/\s/gu, "");
  return rendered ? text.replaceAll("│", "") : text;
}

function attachLinkMetadata(links, metadata) {
  let metadataIndex = 0;
  for (const link of links) {
    if (link.metadataMatched && Number.isInteger(link.metadataOrder)) {
      metadataIndex = Math.max(metadataIndex, link.metadataOrder + 1);
      continue;
    }
    const visibleFingerprint = visibleTextFingerprint(link.textContent, true);
    for (let index = metadataIndex; index < metadata.length; index++) {
      const candidate = metadata[index];
      if (!equivalentHref(link.href, candidate.href)) continue;
      metadataIndex = index + 1;
      if (
        visibleFingerprint
        && visibleTextFingerprint(candidate.textContent) !== visibleFingerprint
      ) {
        // Source order disambiguates repeated hrefs. Once a same-href item has
        // been claimed, do not let this link borrow a later item's rich label
        // or leave the rejected item available to the next rendered link.
        link.metadataOrder = index;
        link.metadataMatched = true;
        break;
      }

      if (candidate.textContent) link.textContent = candidate.textContent;
      if (candidate.kind === "anchor") link.innerHTML = candidate.innerHTML;
      link.metadataOrder = index;
      link.metadataMatched = true;
      break;
    }
  }
}

function attachPreviousLinkMetadata(links, previousLinks) {
  let previousIndex = 0;
  for (const link of links) {
    for (let index = previousIndex; index < previousLinks.length; index++) {
      const candidate = previousLinks[index];
      if (!equivalentHref(link.href, candidate.href)) continue;
      if (link.presentation !== candidate.presentation) continue;
      previousIndex = index + 1;
      link.textContent = candidate.textContent;
      link.innerHTML = candidate.innerHTML;
      link.metadataOrder = candidate.metadataOrder;
      link.metadataMatched = true;
      break;
    }
  }
}

export function buildTuiLinkIndex(
  ansiText,
  markdownSource = null,
  previousLinks = [],
) {
  const links = parseAnsiLinks(ansiText);
  if (links.length > 0 && Array.isArray(previousLinks))
    attachPreviousLinkMetadata(links, previousLinks);
  if (links.some(link => !link.metadataMatched))
    attachLinkMetadata(links, renderedLinkMetadata(markdownSource));
  for (const link of links) delete link.metadataMatched;

  const rows = new Map();
  for (const link of links) {
    for (const segment of link.segments) {
      let row = rows.get(segment.row);
      if (!row) {
        row = [];
        rows.set(segment.row, row);
      }
      row.push({
        start: segment.start,
        end: segment.end,
        href: link.href,
        textContent: link.textContent,
        innerHTML: link.innerHTML,
      });
    }
  }
  return { links, rows };
}

function bufferLinkSource(buffer) {
  return typeof buffer?._mdcuiTuiSourceText === "string"
    ? buffer._mdcuiTuiSourceText
    : typeof buffer?._mdcuiSourceText === "string"
      ? buffer._mdcuiSourceText
      : null;
}

export function refreshTuiLinkIndex(buffer, { resetCatalog = false } = {}) {
  if (!buffer || typeof buffer._mdcuiAnsiText !== "string") return null;
  const ansiText = buffer._mdcuiAnsiText;
  const sourceText = bufferLinkSource(buffer);
  const catalog = !resetCatalog
    && buffer._mdcuiLinkCatalog?.sourceText === sourceText
    ? buffer._mdcuiLinkCatalog
    : null;
  const index = buildTuiLinkIndex(
    ansiText,
    sourceText,
    catalog?.links ?? [],
  );
  buffer._mdcuiLinkIndex = {
    ansiText,
    sourceText,
    lines: buffer.lines,
    lineCount: buffer.lines?.length,
    index,
  };
  if (resetCatalog || !catalog) {
    // Keep the complete render's source ordinals while hide/show edits the
    // current ANSI. This disambiguates repeated href/label pairs.
    buffer._mdcuiLinkCatalog = {
      sourceText,
      links: index.links,
    };
  }
  return index;
}

export function indexedTuiLinkAtPosition(buffer, row, characterIndex) {
  if (!buffer || typeof buffer._mdcuiAnsiText !== "string") return null;
  const ansiText = buffer._mdcuiAnsiText;
  const sourceText = bufferLinkSource(buffer);
  let cache = buffer._mdcuiLinkIndex;
  if (
    !cache
    || cache.ansiText !== ansiText
    || cache.sourceText !== sourceText
    || cache.lines !== buffer.lines
    || cache.lineCount !== buffer.lines?.length
  ) {
    refreshTuiLinkIndex(buffer);
    cache = buffer._mdcuiLinkIndex;
  }

  const line = cache.index.rows.get(Math.trunc(Number(row)));
  const column = Math.trunc(Number(characterIndex));
  if (!line || !Number.isFinite(column) || column < 0) return null;
  for (const link of line) {
    if (column < link.start) break;
    if (column < link.end) return link;
  }
  return null;
}

export function tuiLinkActivationContext(payload) {
  const textContent = String(payload?.linkText ?? "");
  const parent = payload?.linkParent ?? null;
  const target = {
    tagName: "A",
    href: payload?.link,
    textContent,
    innerHTML: payload?.linkHtml ?? textContent,
    parent() {
      return parent;
    },
  };
  let defaultPrevented = false;
  let propagationStopped = false;
  const event = {
    type: payload?.trigger === "mouse" ? "click" : "keydown",
    key: payload?.trigger === "enter"
      ? "Enter"
      : payload?.trigger === "space"
        ? " "
        : undefined,
    target,
    currentTarget: target,
    get defaultPrevented() { return defaultPrevented; },
    get propagationStopped() { return propagationStopped; },
    preventDefault() { defaultPrevented = true; },
    stopPropagation() { propagationStopped = true; },
  };
  return { event, target };
}
