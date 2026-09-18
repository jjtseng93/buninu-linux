const EMPTY_BUN_HEADING_ID = /^-\d+$/;
const HTML_ENTITY =
  /&(?:#(\d+);?|#x([\da-f]+);?|([a-z][\da-z]*)(;?))/gi;
const HTML_NUMERIC_REPLACEMENTS = new Map([
  [0x80, 0x20ac],
  [0x82, 0x201a],
  [0x83, 0x0192],
  [0x84, 0x201e],
  [0x85, 0x2026],
  [0x86, 0x2020],
  [0x87, 0x2021],
  [0x88, 0x02c6],
  [0x89, 0x2030],
  [0x8a, 0x0160],
  [0x8b, 0x2039],
  [0x8c, 0x0152],
  [0x8e, 0x017d],
  [0x91, 0x2018],
  [0x92, 0x2019],
  [0x93, 0x201c],
  [0x94, 0x201d],
  [0x95, 0x2022],
  [0x96, 0x2013],
  [0x97, 0x2014],
  [0x98, 0x02dc],
  [0x99, 0x2122],
  [0x9a, 0x0161],
  [0x9b, 0x203a],
  [0x9c, 0x0153],
  [0x9e, 0x017e],
  [0x9f, 0x0178],
]);
const NAMED_HTML_ENTITIES = new Map([
  ["amp", "&"],
  ["apos", "'"],
  ["gt", ">"],
  ["lt", "<"],
  ["nbsp", "\u00a0"],
  ["quot", '"'],
]);
const LEGACY_HTML_ENTITIES = new Set([
  "AElig", "AMP", "Aacute", "Acirc", "Agrave", "Aring", "Atilde",
  "Auml", "COPY", "Ccedil", "ETH", "Eacute", "Ecirc", "Egrave",
  "Euml", "GT", "Iacute", "Icirc", "Igrave", "Iuml", "LT",
  "Ntilde", "Oacute", "Ocirc", "Ograve", "Oslash", "Otilde",
  "Ouml", "QUOT", "REG", "THORN", "Uacute", "Ucirc", "Ugrave",
  "Uuml", "Yacute", "aacute", "acirc", "acute", "aelig", "agrave",
  "amp", "aring", "atilde", "auml", "brvbar", "ccedil", "cedil",
  "cent", "copy", "curren", "deg", "divide", "eacute", "ecirc",
  "egrave", "eth", "euml", "frac12", "frac14", "frac34", "gt",
  "iacute", "icirc", "iexcl", "igrave", "iquest", "iuml", "laquo",
  "lt", "macr", "micro", "middot", "nbsp", "not", "ntilde",
  "oacute", "ocirc", "ograve", "ordf", "ordm", "oslash", "otilde",
  "ouml", "para", "plusmn", "pound", "quot", "raquo", "reg", "sect",
  "shy", "sup1", "sup2", "sup3", "szlig", "thorn", "times",
  "uacute", "ucirc", "ugrave", "uml", "uuml", "yacute", "yen",
  "yuml",
]);
const DECODED_HTML_ENTITIES = new Map();

function decodeNamedHtmlEntity(whole, name) {
  const known = NAMED_HTML_ENTITIES.get(String(name));
  if (known != null) return known;
  if (DECODED_HTML_ENTITIES.has(whole))
    return DECODED_HTML_ENTITIES.get(whole);

  let decoded = "";
  try {
    Bun.markdown.render(
      whole,
      {
        text(value) {
          decoded += String(value);
          return "";
        },
        paragraph(children) {
          return children;
        },
      },
    );
  } catch {
    decoded = whole;
  }
  if (!decoded) decoded = whole;
  DECODED_HTML_ENTITIES.set(whole, decoded);
  return decoded;
}

function decodeHtmlEntities(value, { attribute = false } = {}) {
  const input = String(value ?? "");
  return input.replace(
    HTML_ENTITY,
    (whole, decimal, hexadecimal, name, semicolon, offset) => {
      if (decimal != null || hexadecimal != null) {
        const point = Number.parseInt(
          decimal ?? hexadecimal,
          hexadecimal == null ? 10 : 16,
        );
        if (
          !Number.isInteger(point)
          || point === 0
          || point > 0x10ffff
          || (point >= 0xd800 && point <= 0xdfff)
        ) return "\ufffd";
        return String.fromCodePoint(
          HTML_NUMERIC_REPLACEMENTS.get(point) ?? point,
        );
      }
      if (semicolon) return decodeNamedHtmlEntity(whole, name);

      for (let end = name.length; end > 0; end--) {
        const candidate = name.slice(0, end);
        if (!LEGACY_HTML_ENTITIES.has(candidate)) continue;
        const remainder = name.slice(end);
        const following = remainder[0] ?? input[offset + whole.length] ?? "";
        if (attribute && /[=A-Za-z0-9]/u.test(following)) return whole;
        return decodeNamedHtmlEntity(`&${candidate};`, candidate) + remainder;
      }
      return whole;
    },
  );
}

export function readLeadingHtmlCharacterReference(value) {
  const input = String(value ?? "");
  if (!input.startsWith("&")) return null;

  const numeric = input.match(/^&#(?:[xX][\da-fA-F]+|\d+);?/u);
  if (numeric) {
    return {
      source: numeric[0],
      decoded: decodeHtmlEntities(numeric[0]),
    };
  }

  const terminated = input.match(/^&([A-Za-z][A-Za-z0-9]*);/u);
  if (terminated) {
    const decoded = decodeHtmlEntities(terminated[0]);
    if (decoded !== terminated[0])
      return { source: terminated[0], decoded };
  }

  const unterminated = input.match(/^&([A-Za-z][A-Za-z0-9]*)/u);
  const name = unterminated?.[1] ?? "";
  for (let end = name.length; end > 0; end--) {
    const candidate = name.slice(0, end);
    if (!LEGACY_HTML_ENTITIES.has(candidate)) continue;
    const source = `&${candidate}`;
    return {
      source,
      decoded: decodeNamedHtmlEntity(
        `&${candidate};`,
        candidate,
      ),
    };
  }
  return null;
}

function htmlTokenAt(input, start) {
  if (input[start] !== "<") return null;
  if (input.startsWith("<!--", start)) {
    const close = input.indexOf("-->", start + 4);
    return {
      start,
      end: close < 0 ? input.length : close + 3,
      kind: "comment",
      name: null,
      closing: false,
      selfClosing: false,
      source: input.slice(start, close < 0 ? input.length : close + 3),
    };
  }
  if (input.startsWith("<![CDATA[", start)) {
    const close = input.indexOf("]]>", start + 9);
    const end = close < 0 ? input.length : close + 3;
    return {
      start,
      end,
      kind: "comment",
      name: null,
      closing: false,
      selfClosing: false,
      source: input.slice(start, end),
    };
  }
  if (input.startsWith("<?", start)) {
    const close = input.indexOf("?>", start + 2);
    const end = close < 0 ? input.length : close + 2;
    return {
      start,
      end,
      kind: "comment",
      name: null,
      closing: false,
      selfClosing: false,
      source: input.slice(start, end),
    };
  }

  const match = input.slice(start).match(
    /^<\s*(\/?)\s*([A-Za-z][\w:-]*)(?=[\t\n\f\r />])/,
  );
  if (!match) {
    const close = input.indexOf(">", start + 1);
    if (close < 0) return null;
    return {
      start,
      end: close + 1,
      kind: "other",
      name: null,
      closing: false,
      selfClosing: false,
      source: input.slice(start, close + 1),
    };
  }

  const isWhitespace = character =>
    character === "\t"
    || character === "\n"
    || character === "\f"
    || character === "\r"
    || character === " ";
  let index = start + match[0].length;
  let state = "before-attribute";
  let quote = null;
  for (; index < input.length; index++) {
    const character = input[index];
    if (state === "quoted-value") {
      if (character === quote) {
        quote = null;
        state = "before-attribute";
      }
      continue;
    }
    if (character === "<") break;
    if (character === ">") {
      index++;
      break;
    }

    if (state === "before-attribute") {
      if (isWhitespace(character) || character === "/") continue;
      state = "attribute-name";
      continue;
    }
    if (state === "attribute-name") {
      if (character === "=") state = "before-value";
      else if (isWhitespace(character)) state = "after-attribute-name";
      continue;
    }
    if (state === "after-attribute-name") {
      if (isWhitespace(character)) continue;
      if (character === "=") state = "before-value";
      else if (character === "/") state = "before-attribute";
      else state = "attribute-name";
      continue;
    }
    if (state === "before-value") {
      if (isWhitespace(character)) continue;
      if (character === '"' || character === "'") {
        quote = character;
        state = "quoted-value";
      } else {
        state = "unquoted-value";
      }
      continue;
    }
    if (state === "unquoted-value" && isWhitespace(character))
      state = "before-attribute";
  }
  if (index >= input.length && input.at(-1) !== ">") return null;

  const source = input.slice(start, index);
  return {
    start,
    end: index,
    kind: "tag",
    name: match[2].toLowerCase(),
    closing: Boolean(match[1]),
    selfClosing: !match[1] && /\/[\t\n\f\r ]*>$/.test(source),
    source,
  };
}

function nextHtmlToken(input, from) {
  let start = input.indexOf("<", from);
  while (start >= 0) {
    const token = htmlTokenAt(input, start);
    if (token) return token;
    start = input.indexOf("<", start + 1);
  }
  return null;
}

const HEADING_OPAQUE_TAGS = new Set([
  "iframe",
  "noembed",
  "noframes",
  "noscript",
  "plaintext",
  "script",
  "style",
  "template",
  "textarea",
  "title",
  "xmp",
]);
const HEADING_RAW_TEXT_TAGS = new Set([
  "iframe",
  "noembed",
  "noframes",
  "noscript",
  "script",
  "style",
  "textarea",
  "title",
  "xmp",
]);

function matchingHtmlClose(input, opening) {
  if (
    opening?.kind !== "tag"
    || opening.closing
    || opening.selfClosing
  ) return null;

  let depth = 1;
  let scan = opening.end;
  let token;
  while ((token = nextHtmlToken(input, scan))) {
    scan = token.end;
    if (
      token.kind === "tag"
      && !token.closing
      && !token.selfClosing
      && token.name !== opening.name
      && HEADING_OPAQUE_TAGS.has(token.name)
    ) {
      const closing = closingOpaqueTag(input, token);
      scan = closing?.end ?? input.length;
      continue;
    }
    if (token.kind !== "tag" || token.name !== opening.name) continue;
    if (token.closing) {
      depth--;
      if (depth === 0) return token;
    } else if (!token.selfClosing) {
      depth++;
    }
  }
  return null;
}

function closingOpaqueTag(input, opening) {
  if (opening?.name === "plaintext") return null;
  if (!HEADING_RAW_TEXT_TAGS.has(opening?.name))
    return matchingHtmlClose(input, opening);

  const closingPattern = new RegExp(
    `</${opening.name}(?=[\\s>])`,
    "ig",
  );
  closingPattern.lastIndex = opening.end;
  let match;
  while ((match = closingPattern.exec(input)) !== null) {
    const token = htmlTokenAt(input, match.index);
    if (token?.kind === "tag" && token.closing)
      return token;
    closingPattern.lastIndex = match.index + 2;
  }
  return null;
}

function htmlAttribute(source, expectedName) {
  const input = String(source ?? "");
  const opening = input.match(/^<\s*\/?\s*[^\s/>]+/);
  if (!opening) return undefined;
  const wanted = String(expectedName).toLowerCase();
  let index = opening[0].length;

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
    if (name === wanted)
      return decodeHtmlEntities(value, { attribute: true });
  }
  return undefined;
}

function visibleHeadingText(value) {
  const input = String(value ?? "");
  let output = "";
  let cursor = 0;
  for (let index = 0; index < input.length;) {
    const start = input.indexOf("<", index);
    if (start < 0) break;
    const token = htmlTokenAt(input, start);
    if (!token) {
      index = start + 1;
      continue;
    }
    output += decodeHtmlEntities(input.slice(cursor, start));
    if (!token.closing) {
      if (token.name === "br") output += " ";
      else if (token.name === "img")
        output += htmlAttribute(token.source, "alt") ?? "";
      else if (
        !token.selfClosing
        && HEADING_OPAQUE_TAGS.has(token.name)
      ) {
        const closing = closingOpaqueTag(input, token);
        cursor = closing?.end ?? input.length;
        index = cursor;
        continue;
      }
    }
    cursor = token.end;
    index = token.end;
  }
  output += decodeHtmlEntities(input.slice(cursor));
  return output;
}

function comparableHeadingText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim();
}

function stableHeadingHash(value) {
  const bytes = new TextEncoder().encode(
    comparableHeadingText(value).toLowerCase(),
  );
  let hash = 0xcbf29ce484222325n;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

export function normalizeUnicodeHeadingId(value) {
  const normalized = comparableHeadingText(value).toLowerCase();
  const tokens = normalized.match(
    /[_\p{L}\p{N}][_\p{L}\p{M}\p{N}]*/gu,
  );
  return tokens?.join("-") || `mdcui-h-${stableHeadingHash(normalized)}`;
}

const TEXT_TOKEN_PATTERN = /\ue000([0-9a-z]+)\ue001/giu;
const HEADING_STRUCTURE_PATTERN = /\ue100h([0-9a-z]+)\ue101/giu;

function escapeHtmlText(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function markdownHeadingEvents(markdown) {
  const source = String(markdown ?? "");
  const textValues = [];
  const records = [];
  const headings = [];
  let containerOrdinal = 0;

  const storedTextToken = (
    value,
    literal = false,
    explicitSlugValue,
  ) => {
    const ordinal = textValues.length;
    const text = String(value ?? "");
    const token = literal ? null : htmlTokenAt(text, 0);
    textValues.push({
      value: text,
      literal,
      slugValue: explicitSlugValue ?? (
        token && token.end === text.length ? "" : text
      ),
    });
    return `\ue000${ordinal.toString(36)}\ue001`;
  };
  const textToken = value => storedTextToken(value);
  const expandTextTokens = (children) =>
    String(children ?? "").replace(
      TEXT_TOKEN_PATTERN,
      (whole, encoded) =>
        textValues[Number.parseInt(encoded, 36)]?.value ?? whole,
    );
  const expandSlugTokens = (children) =>
    String(children ?? "").replace(
      TEXT_TOKEN_PATTERN,
      (whole, encoded) =>
        textValues[Number.parseInt(encoded, 36)]?.slugValue ?? whole,
    ).replace(/\r\n?|\n/gu, " ");
  const inlineHtmlFromTokens = (children) => {
    const input = String(children ?? "");
    let output = "";
    let cursor = 0;
    TEXT_TOKEN_PATTERN.lastIndex = 0;
    let match;
    while ((match = TEXT_TOKEN_PATTERN.exec(input)) !== null) {
      output += escapeHtmlText(input.slice(cursor, match.index));
      const stored = textValues[Number.parseInt(match[1], 36)];
      const value = stored?.value ?? match[0];
      const token = htmlTokenAt(value, 0);
      output += !stored?.literal && token && token.end === value.length
        ? value
        : escapeHtmlText(value);
      cursor = match.index + match[0].length;
    }
    return output + escapeHtmlText(input.slice(cursor));
  };
  const recordInlineHtml = (children) => {
    const html = inlineHtmlFromTokens(children);
    if (html.includes("<")) records.push({ type: "raw", html });
    return "";
  };
  const headingStructure = (children) => {
    const input = String(children ?? "");
    HEADING_STRUCTURE_PATTERN.lastIndex = 0;
    return Array.from(input.matchAll(HEADING_STRUCTURE_PATTERN), match =>
      match[0]
    ).join("");
  };
  const markHeadingContainer = (children, type) => {
    const structure = headingStructure(children);
    if (!structure) return "";
    const container = `${type}:${containerOrdinal++}`;
    HEADING_STRUCTURE_PATTERN.lastIndex = 0;
    for (const match of structure.matchAll(HEADING_STRUCTURE_PATTERN)) {
      const heading = headings[Number.parseInt(match[1], 36)];
      if (heading) heading.containerPath.unshift(container);
    }
    return structure;
  };
  const passthrough = (children) => children;

  Bun.markdown.render(
    source,
    {
      text: textToken,
      strong: passthrough,
      emphasis: passthrough,
      link: passthrough,
      image(children) {
        const slugValue = expandSlugTokens(children);
        return storedTextToken(
          visibleHeadingText(inlineHtmlFromTokens(children)),
          true,
          slugValue,
        );
      },
      codespan(children) {
        const value = expandTextTokens(children);
        return storedTextToken(
          value,
          true,
          value.replace(/\r\n?|\n/gu, ""),
        );
      },
      strikethrough: passthrough,
      heading(children, meta) {
        const inlineHtml = inlineHtmlFromTokens(children);
        const text = visibleHeadingText(inlineHtml);
        const bunId = String(meta?.id ?? "");
        const ordinal = headings.length;
        const heading = {
          bunId,
          containerPath: [],
          fallback: bunId === "" || EMPTY_BUN_HEADING_ID.test(bunId),
          inlineHtml,
          level: Number(meta?.level),
          ordinal,
          slugText: expandSlugTokens(children),
          text,
        };
        headings.push(heading);
        records.push({ type: "markdown", heading });
        return `\ue100h${ordinal.toString(36)}\ue101`;
      },
      html(children) {
        records.push({
          type: "raw",
          html: expandTextTokens(children),
        });
        return "";
      },
      paragraph: recordInlineHtml,
      listItem(children) {
        recordInlineHtml(children);
        return markHeadingContainer(children, "list-item");
      },
      th: recordInlineHtml,
      td: recordInlineHtml,
      code() {
        return "";
      },
      blockquote(children) {
        return markHeadingContainer(children, "blockquote");
      },
      list(children) {
        return markHeadingContainer(children, "list");
      },
      hr() {
        return "";
      },
      table() {
        return "";
      },
      thead() {
        return "";
      },
      tbody() {
        return "";
      },
      tr() {
        return "";
      },
    },
    { headings: { ids: true } },
  );

  const events = [];
  const rawHeadings = [];
  for (const record of records) {
    if (record.type === "markdown") {
      events.push(record);
      continue;
    }
    for (const heading of htmlHeadings(record.html)) {
      const rawHeading = { ...heading, blockSource: record.html };
      rawHeadings.push(rawHeading);
      events.push({ type: "raw", heading: rawHeading });
    }
  }
  return { events, headings, rawHeadings };
}

function htmlHeadings(html) {
  const input = String(html ?? "");
  const headings = [];
  let scan = 0;
  let opening;
  while ((opening = nextHtmlToken(input, scan))) {
    scan = opening.end;
    if (
      opening.kind !== "tag"
      || opening.closing
      || opening.selfClosing
    ) continue;
    if (HEADING_OPAQUE_TAGS.has(opening.name)) {
      const closing = closingOpaqueTag(input, opening);
      scan = closing?.end ?? input.length;
      continue;
    }
    const headingMatch = opening.name?.match(/^h([1-6])$/);
    if (!headingMatch) continue;

    const closing = matchingHtmlClose(input, opening);
    if (!closing) continue;
    const innerHTML = input.slice(opening.end, closing.start);
    headings.push({
      start: opening.start,
      end: closing.end,
      source: input.slice(opening.start, closing.end),
      openingSource: opening.source,
      level: Number(headingMatch[1]),
      innerHTML,
      id: htmlAttribute(opening.source, "id"),
      text: visibleHeadingText(innerHTML),
    });
    scan = closing.end;
  }
  return headings;
}

function legacyHtmlHeadings(html) {
  return htmlHeadings(html).map((heading, ordinal) => ({
    id: heading.id ?? null,
    html: heading.innerHTML,
    text: heading.text,
    level: heading.level,
    ordinal,
  }));
}

function matchedMarkdownHeadings(
  markdownHeadings,
  renderedHeadings,
  events,
) {
  if (events.length !== renderedHeadings.length) return null;

  const matched = Array(markdownHeadings.length);
  let markdownOrdinal = 0;
  for (let index = 0; index < events.length; index++) {
    const event = events[index];
    const rendered = renderedHeadings[index];
    if (event.type === "raw") {
      const raw = event.heading;
      if (
        !raw
        || rendered.level !== raw.level
        || rendered.id !== raw.id
        || comparableHeadingText(rendered.text)
          !== comparableHeadingText(raw.text)
      ) return null;
      continue;
    }

    const heading = event.heading;
    const ordinal = markdownOrdinal++;
    if (
      !heading
      || heading !== markdownHeadings[ordinal]
      || rendered.level !== heading.level
      || rendered.id !== heading.bunId
      || comparableHeadingText(rendered.text)
        !== comparableHeadingText(heading.text)
    ) return null;
    matched[ordinal] = { ...heading, rendered };
  }
  return matched.every(Boolean) ? matched : null;
}

function escapeHtmlAttribute(value, quote) {
  let output = String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  output = quote === "'"
    ? output.replaceAll("'", "&#x27;")
    : output.replaceAll('"', "&quot;");
  return output;
}

function replaceHeadingId(source, id) {
  const input = String(source);
  const opening = htmlTokenAt(input, 0);
  if (opening?.kind !== "tag" || opening.closing) return input;
  const replacement = opening.source.replace(
    /(\bid\s*=\s*)(["'])(.*?)\2/i,
    (whole, prefix, quote) =>
      `${prefix}${quote}${escapeHtmlAttribute(id, quote)}${quote}`,
  );
  return replacement + input.slice(opening.end);
}

function sourceLineMarkerName(source) {
  let marker = "mdcui-heading-source-line";
  let suffix = 0;
  while (source.toLowerCase().includes(`<${marker}`))
    marker = `mdcui-heading-source-line-${++suffix}`;
  return marker;
}

function sourceLineContentOffset(line) {
  const input = String(line ?? "");
  let index = 0;
  const skipWhitespace = () => {
    while (input[index] === " " || input[index] === "\t") index++;
  };
  skipWhitespace();

  while (index < input.length) {
    if (input[index] === ">") {
      index++;
      skipWhitespace();
      continue;
    }
    const listMarker = input.slice(index).match(
      /^(?:[-+*]|\d{1,9}[.)])(?=[ \t])/u,
    );
    if (!listMarker) break;
    index += listMarker[0].length;
    skipWhitespace();
  }
  return index;
}

function sourceLineHasAtxCandidate(line) {
  const input = String(line ?? "");
  return /^#{1,6}(?=[ \t]|$)/u.test(
    input.slice(sourceLineContentOffset(input)),
  );
}

function sourceLineHasSetextCandidate(line) {
  const input = String(line ?? "");
  const content = input.slice(sourceLineContentOffset(input)).trim();
  return /^(?:=+|-+)$/u.test(content);
}

const REFERENCE_DEFINITION_START =
  /^\[(?:\\[^\r\n]|[^\[\]\\]){1,999}\]:/u;

function setextHeadingStart(lines, contentIndex) {
  let start = contentIndex;
  while (start > 0) {
    const previous = String(lines[start - 1] ?? "");
    const content = previous.slice(
      sourceLineContentOffset(previous),
    ).trim();
    if (!content) break;
    if (sourceLineHasAtxCandidate(previous)) break;
    if (/^(?:`{3,}|~{3,})/u.test(content)) break;
    if (REFERENCE_DEFINITION_START.test(content)) break;
    if (/^<\/?[A-Za-z][^>]*>$/u.test(content)) break;
    if (sourceLineHasSetextCandidate(previous)) break;
    start--;
  }
  return start;
}

const SETEXT_HTML_BLOCK_START = new RegExp(
  "^(?:"
    + "<!--|<\\?|<!\\[CDATA\\[|<![A-Z]"
    + "|</?(?:script|pre|style|textarea)(?=[\\t\\n\\f\\r />])"
    + "|</?(?:address|article|aside|base|basefont|blockquote|body|caption"
    + "|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset"
    + "|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header"
    + "|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes"
    + "|ol|optgroup|option|p|param|search|section|summary|table|tbody"
    + "|td|tfoot|th|thead|title|tr|track|ul)(?=[\\t\\n\\f\\r />])"
    + ")",
  "iu",
);

function setextMarkerDelimiters(source) {
  let open = "\ue200MDCUI_SETEXT";
  let close = "\ue201";
  while (source.includes(open)) open += "X";
  while (source.includes(close)) close += "\ue201";
  return { open, close };
}

function sourceLineBelongsToReferenceDefinition(
  lines,
  lineIndex,
  possibleStart,
) {
  if (!Number.isInteger(possibleStart)) return false;
  let hasContent = false;
  Bun.markdown.render(
    lines.slice(possibleStart, lineIndex + 1).join("\n"),
    {
      text() {
        hasContent = true;
        return "";
      },
      html() {
        hasContent = true;
        return "";
      },
      code() {
        hasContent = true;
        return "";
      },
      image() {
        hasContent = true;
        return "";
      },
      heading() {
        hasContent = true;
        return "";
      },
      hr() {
        hasContent = true;
        return "";
      },
    },
  );
  return !hasContent;
}

function sameMarkdownHeadingContent(left, right) {
  return (
    left?.level === right?.level
    && left?.inlineHtml === right?.inlineHtml
    && left?.slugText === right?.slugText
    && left?.text === right?.text
  );
}

function locateSetextHeadingStart(lines, underline, expected) {
  const content = underline - 1;
  if (content < 0) return 0;
  const probes = new Map();
  const matches = (start) => {
    if (!probes.has(start)) {
      const heading = markdownHeadingEvents(
        lines.slice(start, underline + 1).join("\n"),
      ).headings.at(-1);
      probes.set(start, sameMarkdownHeadingContent(heading, expected));
    }
    return probes.get(start);
  };

  if (matches(content)) return content;

  let higher = content;
  let lower = null;
  for (let distance = 1; lower == null;) {
    const candidate = Math.max(0, content - distance);
    if (matches(candidate)) lower = candidate;
    else higher = candidate;
    if (candidate === 0) break;
    distance *= 2;
  }
  if (lower == null)
    return setextHeadingStart(lines, content);

  while (higher - lower > 1) {
    const middle = Math.floor((lower + higher) / 2);
    if (matches(middle)) lower = middle;
    else higher = middle;
  }
  return lower;
}

function baseMarkdownHeadingId(heading) {
  if (!heading) return "";
  if (heading.fallback) return normalizeUnicodeHeadingId(heading.text);

  const encoded = Array.from(heading.slugText ?? "", character =>
    `&#x${character.codePointAt(0).toString(16)};`
  ).join("");
  let bunId = "";
  Bun.markdown.render(
    `# ${encoded}\n`,
    {
      heading(children, meta) {
        bunId = String(meta?.id ?? "");
        return "";
      },
    },
    { headings: { ids: true } },
  );
  return bunId || heading.bunId;
}

export function collectMarkdownHeadingDeclarations(
  markdown,
  { includeLevel = false, includeEndLine = false } = {},
) {
  const source = String(markdown ?? "");
  const lines = source.split(/\r\n?|\n/);
  const marker = sourceLineMarkerName(source);
  const setextMarker = setextMarkerDelimiters(source);
  const atxCandidates = new Map();
  const setextCandidates = [];
  const possibleReferenceStarts = [];
  let possibleReferenceStart = null;

  for (let index = 0; index < lines.length; index++) {
    const content = lines[index].slice(
      sourceLineContentOffset(lines[index]),
    );
    if (!content.trim()) possibleReferenceStart = null;
    if (REFERENCE_DEFINITION_START.test(content))
      possibleReferenceStart = index;
    possibleReferenceStarts[index] = possibleReferenceStart;

    if (sourceLineHasAtxCandidate(lines[index])) {
      atxCandidates.set(index, {
        line: index + 1,
        source: lines[index].trim(),
      });
    }
    if (
      index > 0
      && lines[index - 1].trim()
      && sourceLineHasSetextCandidate(lines[index])
    ) {
      const start = setextHeadingStart(lines, index - 1);
      setextCandidates.push({
        ordinal: setextCandidates.length,
        start,
        content: index - 1,
        underline: index,
      });
    }
    if (
      sourceLineHasAtxCandidate(lines[index])
      || sourceLineHasSetextCandidate(lines[index])
      || /^(?:`{3,}|~{3,})/u.test(content)
      || SETEXT_HTML_BLOCK_START.test(content)
    ) possibleReferenceStart = null;
  }

  const markerPattern = new RegExp(
    `<${marker} data-mdcui-line="(\\d+)"></${marker}>`,
    "g",
  );
  const setextMarkerPattern = new RegExp(
    `${setextMarker.open}([0-9a-z]+)${setextMarker.close}[ ]?`,
    "giu",
  );

  const markedLines = lines.slice();
  for (const [index] of atxCandidates) {
    const markerHtml =
      `<${marker} data-mdcui-line="${index}"></${marker}>`;
    const closingHashes =
      markedLines[index].match(/[ \t]+#+[ \t]*$/u);
    if (closingHashes?.index != null) {
      markedLines[index] =
        markedLines[index].slice(0, closingHashes.index)
        + ` ${markerHtml}`
        + markedLines[index].slice(closingHashes.index);
    } else {
      markedLines[index] += ` ${markerHtml}`;
    }
  }

  const markedSetextLines = new Set();
  const setextByMarker = new Map();
  for (const candidate of setextCandidates) {
    const content = lines[candidate.content].slice(
      sourceLineContentOffset(lines[candidate.content]),
    );
    if (
      markedSetextLines.has(candidate.content)
      || sourceLineHasAtxCandidate(lines[candidate.content])
      || sourceLineHasSetextCandidate(lines[candidate.content])
      || /^(?:`{3,}|~{3,})/u.test(content)
      || sourceLineBelongsToReferenceDefinition(
        lines,
        candidate.content,
        possibleReferenceStarts[candidate.content],
      )
      || SETEXT_HTML_BLOCK_START.test(content)
    ) continue;

    const markerOrdinal = setextByMarker.size;
    const token =
      `${setextMarker.open}${markerOrdinal.toString(36)}`
      + setextMarker.close;
    const offset = sourceLineContentOffset(markedLines[candidate.content]);
    markedLines[candidate.content] =
      markedLines[candidate.content].slice(0, offset)
      + `${token} `
      + markedLines[candidate.content].slice(offset);
    markedSetextLines.add(candidate.content);
    setextByMarker.set(markerOrdinal, {
      setextUnderline: candidate.underline,
    });
  }

  const discovered = [];
  const markedHeadings = markdownHeadingEvents(
    markedLines.join("\n"),
  ).headings;
  for (const [headingOrdinal, heading] of markedHeadings.entries()) {
    markerPattern.lastIndex = 0;
    setextMarkerPattern.lastIndex = 0;
    const atxMatch = markerPattern.exec(heading.inlineHtml);
    const setextMatch = setextMarkerPattern.exec(heading.inlineHtml);
    const candidate = atxMatch
      ? atxCandidates.get(Number(atxMatch[1]))
      : setextByMarker.get(
        Number.parseInt(setextMatch?.[1] ?? "", 36),
      );
    if (!candidate) continue;
    markerPattern.lastIndex = 0;
    setextMarkerPattern.lastIndex = 0;
    discovered.push({
      ...candidate,
      headingOrdinal,
      level: heading.level,
      text: visibleHeadingText(
        heading.inlineHtml
          .replace(markerPattern, "")
          .replace(setextMarkerPattern, ""),
      ),
    });
  }
  discovered.sort((left, right) => left.line - right.line);

  const actual = markdownHeadingEvents(source).headings;
  const discoveredByOrdinal = new Map(
    discovered.map(item => [item.headingOrdinal, item]),
  );
  const aligned = [];
  for (const heading of actual) {
    const found = discoveredByOrdinal.get(heading.ordinal);
    if (!found || found.level !== heading.level) {
      aligned.push({
        line: 1,
        source: heading.text || "(empty heading)",
        heading,
      });
    } else if (Number.isInteger(found.setextUnderline)) {
      const start = locateSetextHeadingStart(
        lines,
        found.setextUnderline,
        heading,
      );
      aligned.push({
        ...found,
        line: start + 1,
        source:
          `${lines.slice(start, found.setextUnderline)
            .map(line => line.trim()).join(" ")} / `
          + lines[found.setextUnderline].trim(),
        heading,
      });
    } else {
      aligned.push({ ...found, heading });
    }
  }

  return aligned.map((heading) => ({
    id: baseMarkdownHeadingId(heading.heading),
    kind: "heading",
    ...(includeLevel ? { level: heading.heading.level } : {}),
    line: heading.line,
    ...(includeEndLine
      ? {
        endLine: Number.isInteger(heading.setextUnderline)
          ? heading.setextUnderline + 1
          : heading.line,
      }
      : {}),
    source: heading.source,
  })).filter(heading => heading.id);
}

function markRawHeadingCandidates(markdown) {
  const source = String(markdown ?? "");
  let marker = "data-mdcui-raw-heading-source";
  let suffix = 0;
  while (source.toLowerCase().includes(marker))
    marker = `data-mdcui-raw-heading-source-${++suffix}`;

  const lineStarts = [0];
  const lineEnds = [];
  const lineBreakPattern = /\r\n?|\n/g;
  let lineBreak;
  while ((lineBreak = lineBreakPattern.exec(source)) !== null) {
    lineEnds.push(lineBreak.index);
    lineStarts.push(lineBreak.index + lineBreak[0].length);
  }
  lineEnds.push(source.length);

  const candidates = [];
  let lineIndex = 0;
  for (let index = 0; index < source.length;) {
    const openingName = source.slice(index).match(
      /^<([A-Za-z][\w:-]*)([\t\n\f\r />])/u,
    );
    if (
      !openingName
      || !/^h[1-6]$/iu.test(openingName[1])
    ) {
      index++;
      continue;
    }

    const boundary = openingName[2];
    const afterBoundary = index + openingName[0].length;
    const selfClosing = boundary === "/"
      && /^[\t\n\f\r ]*>/u.test(source.slice(afterBoundary));
    const insertAt = afterBoundary
      - (boundary === ">" || selfClosing ? 1 : 0);
    while (
      lineIndex + 1 < lineStarts.length
      && lineStarts[lineIndex + 1] <= index
    ) lineIndex++;
    candidates.push({
      index,
      insertAt,
      line: lineIndex + 1,
      source: source.slice(
        lineStarts[lineIndex],
        lineEnds[lineIndex],
      ).trim(),
    });
    index = insertAt;
  }

  const pieces = [];
  let cursor = 0;
  for (let ordinal = 0; ordinal < candidates.length; ordinal++) {
    const candidate = candidates[ordinal];
    pieces.push(
      source.slice(cursor, candidate.insertAt),
      ` ${marker}=${ordinal} `,
    );
    cursor = candidate.insertAt;
  }
  pieces.push(source.slice(cursor));
  return {
    candidates,
    marker,
    source: pieces.join(""),
  };
}

function transformHtmlSynchronously(html, configure) {
  let rewriter = new HTMLRewriter();
  rewriter = configure(rewriter);
  const promise = rewriter.transform(new Response(String(html))).text();
  const result = Bun.peek(promise);
  if (typeof result !== "string")
    throw new Error("HTMLRewriter did not complete synchronously");
  return result;
}

function browserHeadingRecords(html, rawMarker) {
  const records = [];
  let templateDepth = 0;
  const templateHandler = {
    element(element) {
      if (
        element.namespaceURI
          !== "http://www.w3.org/1999/xhtml"
      ) return;
      templateDepth++;
      element.onEndTag(() => {
        templateDepth = Math.max(0, templateDepth - 1);
      });
    },
  };
  const headingHandler = {
    element(element) {
      const rawOrdinal = element.getAttribute(rawMarker);
      const hasId = element.hasAttribute("id");
      records.push({
        id: hasId
          ? decodeHtmlEntities(
            element.getAttribute("id") ?? "",
            { attribute: true },
          )
          : undefined,
        level: Number(String(element.tagName).slice(1)),
        namespace: element.namespaceURI,
        rawOrdinal: /^\d+$/u.test(rawOrdinal ?? "")
          ? Number(rawOrdinal)
          : null,
        template: templateDepth > 0,
      });
    },
  };
  transformHtmlSynchronously(html, (rewriter) => {
    rewriter = rewriter.on("template", templateHandler);
    for (let level = 1; level <= 6; level++)
      rewriter = rewriter.on(`h${level}`, headingHandler);
    return rewriter;
  });
  return records;
}

function equivalentHeadingRecords(original, marked) {
  return (
    original.length === marked.length
    && original.every((record, ordinal) => {
      const candidate = marked[ordinal];
      return (
        record.level === candidate.level
        && record.namespace === candidate.namespace
        && record.template === candidate.template
        && (
          candidate.rawOrdinal == null
          || String(record.id ?? "") === String(candidate.id ?? "")
        )
      );
    })
  );
}

export function collectRawHtmlHeadingDeclarations(
  markdown,
  { strict = false, includeLevel = false } = {},
) {
  const marked = markRawHeadingCandidates(markdown);
  if (marked.candidates.length === 0) return [];

  const original = Bun.markdown.html(
    String(markdown ?? ""),
    { headings: { ids: true } },
  );
  const rendered = Bun.markdown.html(
    marked.source,
    { headings: { ids: true } },
  );
  const originalRecords = browserHeadingRecords(original, marked.marker);
  const markedRecords = browserHeadingRecords(rendered, marked.marker);
  if (!equivalentHeadingRecords(originalRecords, markedRecords)) {
    if (strict)
      throw new Error("Raw HTML headings could not be classified safely");
    return [];
  }

  const declarations = [];
  for (const heading of markedRecords) {
    if (
      heading.template
      || heading.rawOrdinal == null
      || !heading.id
    ) continue;
    const candidate = marked.candidates[heading.rawOrdinal];
    if (!candidate) continue;
    declarations.push({
      ordinal: heading.rawOrdinal,
      id: heading.id,
      kind: "raw HTML heading",
      ...(includeLevel ? { level: heading.level } : {}),
      line: candidate.line,
      source: candidate.source,
    });
  }
  declarations.sort((left, right) => left.ordinal - right.ordinal);
  return declarations.map(({ ordinal, ...declaration }) => declaration);
}

function rewriteBrowserMarkdownHeadings(
  originalHtml,
  markedHtml,
  rawMarker,
  markdownHeadings,
) {
  const records = browserHeadingRecords(markedHtml, rawMarker);
  const originalRecords = browserHeadingRecords(originalHtml, rawMarker);
  if (!equivalentHeadingRecords(originalRecords, records))
    throw new Error("Raw heading markers changed the rendered structure");

  const mainRecords = records
    .map((record, ordinal) => ({
      marked: record,
      original: originalRecords[ordinal],
    }))
    .filter(({ marked }) => !marked.template);
  const renderedMarkdown = mainRecords.filter(
    ({ marked }) => marked.rawOrdinal == null,
  );
  const normalized = (
    renderedMarkdown.length === markdownHeadings.length
    && renderedMarkdown.every(({ original }, ordinal) => {
      const heading = markdownHeadings[ordinal];
      return (
        original.level === heading.level
        && String(original.id ?? "") === heading.bunId
      );
    })
  );
  if (!normalized)
    throw new Error("Rendered Markdown headings could not be aligned");

  const usedIds = new Set(
    mainRecords
      .filter(({ marked }) => marked.rawOrdinal != null)
      .map(({ original }) => original.id)
      .filter(Boolean),
  );
  for (const heading of markdownHeadings) {
    if (!heading.fallback && heading.bunId) usedIds.add(heading.bunId);
  }
  for (const heading of markdownHeadings) {
    if (!heading.fallback) {
      heading.id = heading.bunId;
      continue;
    }
    const base = normalizeUnicodeHeadingId(heading.text);
    let id = base;
    let suffix = 1;
    while (usedIds.has(id)) id = `${base}-${suffix++}`;
    heading.id = id;
    usedIds.add(id);
  }

  let boundary = "MDCUI_HEADING_CONTENT";
  let boundarySuffix = 0;
  while (String(originalHtml).includes(boundary))
    boundary = `MDCUI_HEADING_CONTENT_${++boundarySuffix}`;
  let markdownOrdinal = 0;
  let recordOrdinal = 0;
  const headingHandler = {
    element(element) {
      const record = records[recordOrdinal++];
      if (record?.template || record?.rawOrdinal != null) return;

      const ordinal = markdownOrdinal++;
      const heading = markdownHeadings[ordinal];
      if (!heading) return;
      element.setAttribute("id", heading.id);
      element.prepend(
        `<!--${boundary}:s:${ordinal.toString(36)}-->`,
        { html: true },
      );
      element.append(
        `<!--${boundary}:e:${ordinal.toString(36)}-->`,
        { html: true },
      );
    },
  };
  const rewritten = transformHtmlSynchronously(originalHtml, (rewriter) => {
    for (let level = 1; level <= 6; level++)
      rewriter = rewriter.on(`h${level}`, headingHandler);
    return rewriter;
  });

  const innerHtml = new Map();
  const starts = new Map();
  const boundaryPattern = new RegExp(
    `<!--${boundary}:([se]):([0-9a-z]+)-->`,
    "g",
  );
  let match;
  while ((match = boundaryPattern.exec(rewritten)) !== null) {
    const ordinal = Number.parseInt(match[2], 36);
    if (match[1] === "s") {
      starts.set(ordinal, match.index + match[0].length);
    } else if (starts.has(ordinal)) {
      innerHtml.set(
        ordinal,
        rewritten.slice(starts.get(ordinal), match.index),
      );
    }
  }
  boundaryPattern.lastIndex = 0;
  const cleanHtml = rewritten.replace(boundaryPattern, "");

  return {
    html: cleanHtml,
    normalized,
    headings: markdownHeadings.map((heading, ordinal) => ({
      id: heading.id,
      html: innerHtml.get(ordinal) ?? heading.inlineHtml,
      text: heading.text,
      level: heading.level,
      containerPath: heading.containerPath,
      ordinal,
    })),
  };
}

export function renderMarkdownWithHeadingIds(markdown) {
  const source = String(markdown ?? "");
  const headingEvents = markdownHeadingEvents(source);
  const markdownHeadings = headingEvents.headings;
  const html = String(Bun.markdown.html(
    source,
    { headings: { ids: true } },
  ));
  if (markdownHeadings.length === 0)
    return { html, headings: [], normalized: true };

  const marked = markRawHeadingCandidates(source);
  if (
    typeof HTMLRewriter === "function"
    && typeof Bun.peek === "function"
  ) {
    try {
      const markedHtml = String(Bun.markdown.html(
        marked.source,
        { headings: { ids: true } },
      ));
      return rewriteBrowserMarkdownHeadings(
        html,
        markedHtml,
        marked.marker,
        markdownHeadings,
      );
    } catch {
      return {
        html,
        headings: [],
        normalized: false,
      };
    }
  }

  const renderedHeadings = htmlHeadings(html);
  const matched = matchedMarkdownHeadings(
    markdownHeadings,
    renderedHeadings,
    headingEvents.events,
  );
  if (!matched) {
    return {
      html,
      headings: legacyHtmlHeadings(html),
      normalized: false,
    };
  }

  const matchedRendered = new Set(matched.map(item => item.rendered));
  const usedIds = new Set(
    renderedHeadings
      .filter(heading => !matchedRendered.has(heading))
      .map(heading => heading.id)
      .filter(Boolean),
  );
  for (const heading of matched) {
    if (!heading.fallback && heading.bunId) usedIds.add(heading.bunId);
  }

  for (const heading of matched) {
    if (!heading.fallback) {
      heading.id = heading.bunId;
      continue;
    }
    const base = normalizeUnicodeHeadingId(heading.text);
    let id = base;
    let suffix = 1;
    while (usedIds.has(id)) id = `${base}-${suffix++}`;
    heading.id = id;
    usedIds.add(id);
  }

  const replacementByStart = new Map(
    matched.map(heading => [
      heading.rendered.start,
      replaceHeadingId(heading.rendered.source, heading.id),
    ]),
  );
  let rewritten = "";
  let cursor = 0;
  for (const rendered of renderedHeadings) {
    const replacement = replacementByStart.get(rendered.start);
    if (replacement == null) continue;
    rewritten += html.slice(cursor, rendered.start) + replacement;
    cursor = rendered.end;
  }
  rewritten += html.slice(cursor);

  return {
    html: rewritten,
    normalized: true,
    headings: matched.map((heading, ordinal) => ({
      id: heading.id,
      html: heading.rendered.innerHTML,
      text: heading.text,
      level: heading.level,
      containerPath: heading.containerPath,
      ordinal,
    })),
  };
}
