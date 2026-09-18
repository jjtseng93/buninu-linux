




const crlf="\r\n"

let apilist = new Map()

//  Endpoint every frontend rpc fetch posts to. Returns the previous one.
let rpcBackend = "rpc"

export function switchBackend( endpoint )
{
  const previous = rpcBackend ;

  rpcBackend = ( endpoint || "rpc" ) + "" ;

  return previous ;
}

//  rpcBackend starting with "unix"/"UNIX" (e.g. "unix:/path/to/sock") names a
//  Bun unix socket instead of an http path. fetch() rejects the unix: scheme
//  outright, so the request goes to a fixed dummy URL and the real path comes
//  from fetch's `unix` option instead; routing here is by func name in the
//  JSON body, not by HTTP path, so the dummy URL costs nothing.
const rpcFetchUrl = () =>
  ( rpcBackend.slice(0,4) === "unix" || rpcBackend.slice(0,4) === "UNIX" )
    ? "http://unix/rpc" : rpcBackend ;

// decodeURIComponent undoes new URL()'s percent-encoding of the path, which
// otherwise turns a leading NUL byte (a Linux abstract-namespace socket name,
// e.g. "unix:\0name") into the three literal characters "%00" instead of the
// single byte 0x00 Bun's `unix` option needs to actually reach it.
const rpcFetchOpt = () =>
  ( rpcBackend.slice(0,4) === "unix" || rpcBackend.slice(0,4) === "UNIX" )
    ? { unix: decodeURIComponent(new URL(rpcBackend).pathname) } : {} ;

export const jss = JSON.stringify

const webMdcuiIdSource = String.raw`[_\p{L}\p{N}][_\p{L}\p{M}\p{N}:-]*`;
const webMdcuiIdPattern = new RegExp(`^${webMdcuiIdSource}$`, "u");
const webDollarIdentityPattern = new RegExp(
  `^([A-Za-z_][\\w:-]*)?(?:#(${webMdcuiIdSource}))?((?:\\.[A-Za-z_][\\w:-]*)*)$`,
  "u",
);

function parseDollarIdentity(input, { selector = false } = {})
{
  const text = String(input ?? "").trim();
  const match = text.match(webDollarIdentityPattern);
  if (!match || (!match[1] && !match[2] && !match[3])) return null;
  if (!selector && !match[1]) return null;
  return {
    tag: match[1] || null,
    id: match[2] || null,
    classes: match[3] ? match[3].slice(1).split(".") : [],
  };
}

function webDollarObjectId(input)
{
  if (input === null || typeof input !== "object") return null;
  const id = String(input.id ?? "");
  return webMdcuiIdPattern.test(id) ? id : null;
}

function matchesDollarIdentity(identity, selector)
{
  if (selector.tag && identity.tag !== selector.tag) return false;
  if (selector.id && identity.id !== selector.id) return false;
  return selector.classes.every(name => identity.classes.includes(name));
}

function findMarkdownCodeElement(documentObject, selector)
{
  for (const code of documentObject?.querySelectorAll?.("pre > code") ?? []) {
    for (const className of code.classList ?? []) {
      if (!className.startsWith("language-")) continue;
      const identity = parseDollarIdentity(className.slice("language-".length));
      if (identity && matchesDollarIdentity(identity, selector)) return code;
    }
  }
  return null;
}

function findWebDollarElement(documentObject, selectorText, selector)
{
  if (selector?.id) {
    const byId = documentObject?.getElementById?.(selector.id);
    if (byId) {
      const identity = {
        tag: byId.getAttribute?.("data-mdcui-tag")
          || String(byId.tagName ?? "").toLowerCase()
          || null,
        id: byId.id || null,
        classes: [...(byId.classList ?? [])],
      };
      if (matchesDollarIdentity(identity, selector)) return byId;
    }
  }

  if (!selector?.id) {
    try {
      const direct = documentObject?.querySelector?.(String(selectorText));
      if (direct) return direct;
    } catch {}
  }

  for (const element of documentObject?.querySelectorAll?.("[data-mdcui-tag]") ?? []) {
    const identity = {
      tag: element.getAttribute?.("data-mdcui-tag") || null,
      id: element.id || null,
      classes: [...(element.classList ?? [])],
    };
    if (matchesDollarIdentity(identity, selector)) return element;
  }

  return findMarkdownCodeElement(documentObject, selector);
}

function webDollarValue(element)
{
  if (element && "value" in element) return String(element.value ?? "");
  return String(element?.textContent ?? "").replace(/\n$/, "");
}

function isWebHeading(element)
{
  return /^h[1-6]$/i.test(String(element?.tagName ?? ""));
}

function semanticWebHeadingHtml(heading)
{
  const copy = heading?.cloneNode?.(true);
  if (!copy) return String(heading?.innerHTML ?? "");
  for (const toggle of copy.querySelectorAll?.(".mdcui-heading-toggle") ?? [])
    toggle.replaceWith?.(...toggle.childNodes);
  return String(copy.innerHTML ?? "");
}

function firstWebHeadingTextNode(root)
{
  for (const child of root?.childNodes ?? []) {
    if (child.nodeType === 3 && /\S/u.test(String(child.textContent ?? "")))
      return child;
    const nested = firstWebHeadingTextNode(child);
    if (nested) return nested;
  }
  return null;
}

let webGraphemeSegmenter;
function firstWebGraphemeCluster(value)
{
  const input = String(value ?? "");
  if (!input) return "";

  if (webGraphemeSegmenter === undefined) {
    try {
      webGraphemeSegmenter = typeof Intl === "object"
        && typeof Intl.Segmenter === "function"
        ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
        : null;
    } catch {
      webGraphemeSegmenter = null;
    }
  }
  const segmented = webGraphemeSegmenter
    ?.segment(input)?.[Symbol.iterator]?.().next?.().value?.segment;
  if (segmented) return segmented;

  const points = [...input];
  let result = points[0] ?? "";
  let index = 1;
  const isExtend = character => {
    const point = character.codePointAt(0);
    return /\p{Mark}/u.test(character)
      || (point >= 0xFE00 && point <= 0xFE0F)
      || (point >= 0xE0100 && point <= 0xE01EF)
      || (point >= 0x1F3FB && point <= 0x1F3FF)
      || (point >= 0xE0020 && point <= 0xE007F);
  };
  const isRegionalIndicator = character => {
    const point = character?.codePointAt?.(0);
    return point >= 0x1F1E6 && point <= 0x1F1FF;
  };

  if (isRegionalIndicator(points[0]) && isRegionalIndicator(points[1])) {
    result += points[1];
    index = 2;
  }
  while (index < points.length) {
    if (isExtend(points[index])) {
      result += points[index++];
      continue;
    }
    if (points[index] === "\u200D" && index + 1 < points.length) {
      result += points[index] + points[index + 1];
      index += 2;
      continue;
    }
    break;
  }
  return result;
}

function ensureWebHeadingToggle(heading)
{
  if (!isWebHeading(heading) || !heading.id) return null;
  const existing = heading.querySelector?.(".mdcui-heading-toggle");
  if (existing) {
    if (existing.style) existing.style.cursor = "pointer";
    return existing;
  }

  const textNode = firstWebHeadingTextNode(heading);
  const text = String(textNode?.textContent ?? "");
  const start = text.search(/\S/u);
  if (!textNode || start < 0) return null;
  const character = firstWebGraphemeCluster(text.slice(start));
  const documentObject = heading.ownerDocument;
  const range = documentObject?.createRange?.();
  const toggle = documentObject?.createElement?.("span");
  if (!range || !toggle) return null;

  toggle.className = "mdcui-heading-toggle";
  toggle.setAttribute?.("role", "button");
  toggle.setAttribute?.("tabindex", "0");
  toggle.setAttribute?.("aria-expanded", "true");
  if (toggle.style) toggle.style.cursor = "pointer";
  range.setStart(textNode, start);
  range.setEnd(textNode, start + character.length);
  range.surroundContents(toggle);
  return toggle;
}

function webIdStore(documentObject)
{
  if (!(documentObject?._mdcuiIdStore instanceof Map))
    documentObject._mdcuiIdStore = new Map();
  return documentObject._mdcuiIdStore;
}

function webIdRecord(documentObject, id)
{
  const store = webIdStore(documentObject);
  let record = store.get(id);
  if (!record) {
    record = {};
    store.set(id, record);
  }
  return record;
}

function compileWebTemplateComponentRender(source, templateType = "md")
{
  return new Function(
    "data = {}",
    templateType === "js"
      ? String(source ?? "")
      : `return \`${String(source ?? "")}\`;`,
  );
}

export function installWebTemplateComponents(documentObject = globalThis.document)
{
  const payload = documentObject?.getElementById?.("mdcui-template-components");
  if (!payload || payload.__mdcuiInstalled) return webIdStore(documentObject);
  payload.__mdcuiInstalled = true;

  let headings;
  try {
    headings = JSON.parse(String(payload.textContent ?? "[]"));
  } catch {
    return webIdStore(documentObject);
  }
  if (!Array.isArray(headings)) return webIdStore(documentObject);

  for (const item of headings) {
    const id = String(item?.id ?? "");
    if (!id) continue;
    const record = webIdRecord(documentObject, id);
    if (!record.data || typeof record.data !== "object")
      record.data = Object.create(null);
    if (item.data && typeof item.data === "object")
      Object.assign(record.data, item.data);

    record.components = Array.isArray(item.components)
      ? item.components.map(serialized => {
        const source = String(serialized?.source ?? "");
        const templateType = serialized?.templateType === "js" ? "js" : "md";
        return {
        source,
        templateType,
        initialData: serialized?.initialData ?? null,
        last: String(serialized?.last ?? ""),
        data: record.data,
        id,
        index: Number(serialized?.index) || 0,
        render: compileWebTemplateComponentRender(source, templateType),
      }})
      : [];
  }
  return webIdStore(documentObject);
}

function webUserData(documentObject, id, element)
{
  if (!documentObject || !id) return undefined;
  const record = webIdRecord(documentObject, id);
  if (!record.data || typeof record.data !== "object")
    record.data = Object.create(null);
  if (element) element.mdcuiData = record.data;
  return record.data;
}

function removeWebUserData(documentObject, id, element, keys)
{
  if (!documentObject || !id) return;
  const store = webIdStore(documentObject);
  const record = store.get(id);
  if (!record?.data) return;
  if (keys.length === 0) {
    delete record.data;
    if (element) delete element.mdcuiData;
  } else {
    for (const key of keys) delete record.data[key];
  }
  if (Object.keys(record).length === 0) store.delete(id);
}

const renderingWebComponentRecords = new WeakSet();
const webComponentRenderRevisions = new WeakMap();

function webComponentMarkdownHtml(markdown)
{
  const source = String(markdown ?? "");
  if (typeof Bun !== "undefined" && Bun?.markdown?.html)
    return renderWebComponentMarkdownOnServer(source);
  return fetch(rpcFetchUrl(), { ...rpcFetchOpt(),
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(["_mdcui_render_markdown", [source]]),
  }).then(response => response.json()).then(result => String(result ?? ""));
}

function renderWebComponentMarkdownOnServer(markdown)
{
  let html = String(Bun.markdown.html(String(markdown ?? "")));
  html = html.replaceAll(
    'class="task-list-item-checkbox" disabled',
    'class="task-list-item-checkbox"',
  );
  return html.replace(
    /<table\b[^>]*>[\s\S]*?<\/table>/giu,
    table => table
      .replace(
        /^<table\b([^>]*)>/iu,
        (opening, attributes) => /\bcontenteditable\s*=/iu.test(attributes)
          ? opening
          : `<table${attributes} contenteditable="true">`,
      )
      .replace(
        /(<t[dh]\b[^>]*>)(\s*)\[( |x|X)\]/giu,
        (whole, opening, whitespace, state) =>
          `${opening}${whitespace}<input type="checkbox"`
          + `${state === " " ? "" : " checked"}>`,
      ),
  );
}

function replaceWebComponentMarkdown(wrapper, component, markdown)
{
  const revision = (webComponentRenderRevisions.get(component) ?? 0) + 1;
  webComponentRenderRevisions.set(component, revision);
  const converted = webComponentMarkdownHtml(markdown);
  const apply = html => {
    if (webComponentRenderRevisions.get(component) !== revision) return;
    wrapper.innerHTML = String(html ?? "");
    component.last = markdown;
  };
  if (converted && typeof converted.then === "function")
    converted.then(apply).catch(() => {});
  else apply(converted);
}

function renderWebHeadingComponents(documentObject, id)
{
  const record = webIdStore(documentObject).get(id);
  if (!record || renderingWebComponentRecords.has(record) || !Array.isArray(record.components))
    return;
  renderingWebComponentRecords.add(record);
  try {
    const wrappers = [...(documentObject.querySelectorAll?.(".mdcui-template") ?? [])];
    for (const component of record.components) {
      if (!component || typeof component.render !== "function") continue;
      const rendered = String(component.render.call(component, record.data) ?? "");
      if (rendered === component.last) continue;
      const wrapper = wrappers.find(element =>
        String(element.getAttribute?.("data-mdcui-heading-id") ?? "") === id
        && Number(element.getAttribute?.("data-mdcui-component-index"))
          === component.index
      );
      if (!wrapper) continue;
      replaceWebComponentMarkdown(wrapper, component, rendered);
    }
  } finally {
    renderingWebComponentRecords.delete(record);
  }
}

function hideWebHeadingSection(documentObject, heading)
{
  if (!isWebHeading(heading) || !heading.id) return false;
  const store = webIdStore(documentObject);
  if (store.get(heading.id)?.headingVisibility?.hidden) return true;

  const section = heading.parentElement;
  const parent = section?.parentElement;
  if (String(section?.tagName ?? "").toLowerCase() !== "section" || !parent) return false;

  heading.remove?.();
  parent.insertBefore?.(heading, section);
  section.hidden = true;
  heading.querySelector?.(".mdcui-heading-toggle")
    ?.setAttribute?.("aria-expanded", "false");
  webIdRecord(documentObject, heading.id).headingVisibility = {
    hidden: true,
    section,
  };
  return true;
}

function showWebHeadingSection(documentObject, heading)
{
  if (!isWebHeading(heading) || !heading.id) return false;
  const store = webIdStore(documentObject);
  const record = store.get(heading.id);
  const state = record?.headingVisibility;
  if (!state?.hidden) return true;

  const section = state.section;
  section.hidden = false;
  heading.remove?.();
  section.insertBefore?.(heading, section.firstChild ?? null);
  heading.querySelector?.(".mdcui-heading-toggle")
    ?.setAttribute?.("aria-expanded", "true");
  delete record.headingVisibility;
  if (Object.keys(record).length === 0) store.delete(heading.id);
  return true;
}

function firstHeadingList(heading)
{
  for (let sibling = heading?.nextElementSibling; sibling; sibling = sibling.nextElementSibling) {
    if (isWebHeading(sibling) || String(sibling.tagName ?? "").toLowerCase() === "section")
      break;
    if (sibling.matches?.("ul, ol")) return sibling;
    const list = sibling.querySelector?.("ul, ol");
    if (list) return list;
  }
  return null;
}

function webHeadingImages(heading)
{
  const images = [];
  for (let sibling = heading?.nextElementSibling; sibling; sibling = sibling.nextElementSibling) {
    if (isWebHeading(sibling) || String(sibling.tagName ?? "").toLowerCase() === "section")
      break;
    if (String(sibling.tagName ?? "").toLowerCase() === "img") images.push(sibling);
    images.push(...(sibling.querySelectorAll?.("img") ?? []));
  }
  return images;
}

function directTaskCheckbox(item)
{
  for (const checkbox of item?.querySelectorAll?.('input[type="checkbox"]') ?? []) {
    if (checkbox.closest?.("li.task-list-item") === item) return checkbox;
  }
  return null;
}

function webTaskItemValue(item, checkbox)
{
  const label = checkbox?.closest?.("label");
  if (label && label.closest?.("li.task-list-item") === item)
    return String(label.textContent ?? "").trim();

  const copy = item.cloneNode?.(true);
  for (const nested of copy?.querySelectorAll?.("ul, ol") ?? []) nested.remove?.();
  for (const input of copy?.querySelectorAll?.('input[type="checkbox"]') ?? []) input.remove?.();
  return String(copy?.textContent ?? "").trim();
}

function webHeadingValue(heading)
{
  const single = String(heading?.id ?? "").startsWith("select");
  const list = firstHeadingList(heading);
  if (!list) return single ? null : [];

  const selected = [];
  for (const item of list.children ?? []) {
    if (!item.matches?.("li.task-list-item")) continue;
    const checkbox = directTaskCheckbox(item);
    if (!checkbox?.checked) continue;
    const value = webTaskItemValue(item, checkbox);
    if (single) return value;
    selected.push(value);
  }
  return single ? null : selected;
}

function directWebTaskItems(list)
{
  const items = [];
  for (const item of list?.children ?? []) {
    if (!item.matches?.("li.task-list-item")) continue;
    if (directTaskCheckbox(item)) items.push(item);
  }
  return items;
}

function webTaskItemSnapshot(item)
{
  const checkbox = directTaskCheckbox(item);
  return {
    value: webTaskItemValue(item, checkbox),
    checked: Boolean(checkbox?.checked),
  };
}

function normalizedTaskItem(input)
{
  if (input && typeof input === "object") {
    return {
      value: String(input.value ?? input.label ?? "").replace(/\r?\n/g, " "),
      checked: Boolean(input.checked),
    };
  }
  return {
    value: String(input ?? "").replace(/\r?\n/g, " "),
    checked: false,
  };
}

function normalizedSpliceRange(length, argumentCount, start, deleteCount)
{
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

function appendWebTaskItem(list, input, before = null)
{
  const documentObject = list?.ownerDocument;
  if (!documentObject?.createElement || !documentObject?.createTextNode) return false;

  const itemValue = normalizedTaskItem(input);
  const item = documentObject.createElement("li");
  item.classList?.add("task-list-item");
  const label = documentObject.createElement("label");
  const checkbox = documentObject.createElement("input");
  checkbox.type = "checkbox";
  checkbox.classList?.add("task-list-item-checkbox");
  checkbox.checked = itemValue.checked;
  label.append(checkbox, documentObject.createTextNode(itemValue.value));
  item.append(label);
  list.insertBefore(item, before);
  return true;
}

function mutateWebHeadingList(heading, method, args)
{
  const list = firstHeadingList(heading);
  if (!list) {
    if (method === "push" || method === "unshift") return 0;
    if (method === "splice") return [];
    return undefined;
  }

  const items = directWebTaskItems(list);
  if (method === "splice") {
    const range = normalizedSpliceRange(items.length, args.length, args[0], args[1]);
    const removed = items
      .slice(range.start, range.start + range.deleteCount)
      .map((item) => webTaskItemValue(item, directTaskCheckbox(item)));
    const before = items[range.start] ?? null;
    for (const input of args.slice(2)) appendWebTaskItem(list, input, before);
    for (const item of items.slice(range.start, range.start + range.deleteCount)) item.remove?.();
    return removed;
  }
  if (method === "pop" || method === "shift") {
    const item = method === "pop" ? items.at(-1) : items[0];
    if (!item) return undefined;
    const value = webTaskItemValue(item, directTaskCheckbox(item));
    item.remove?.();
    return value;
  }

  if (method === "push") {
    for (const input of args) appendWebTaskItem(list, input);
  } else {
    const before = items[0] ?? list.firstChild ?? null;
    for (const input of args) appendWebTaskItem(list, input, before);
  }
  return directWebTaskItems(list).length;
}

function resizeWebTextarea(element)
{
  if (!element || String(element.tagName ?? "").toLowerCase() !== "textarea") return;
  try {
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
    const lineHeight = Number.parseFloat(
      element.ownerDocument?.defaultView?.getComputedStyle?.(element)?.lineHeight,
    );
    if (Number.isFinite(lineHeight) && lineHeight > 0)
      element.rows = Math.max(1, Math.ceil(element.scrollHeight / lineHeight));
  } catch {}
}

function installWebTextareaResize(target)
{
  const documentObject = target?.document;
  if (!documentObject || documentObject.__mdcuiTextareaResizeInstalled) return;
  documentObject.__mdcuiTextareaResizeInstalled = true;
  const resizeAll = () => {
    for (const element of documentObject.querySelectorAll?.("textarea[data-mdcui-tag]") ?? [])
      resizeWebTextarea(element);
  };
  documentObject.addEventListener?.("input", event => {
    if (event.target?.matches?.("textarea[data-mdcui-tag]"))
      resizeWebTextarea(event.target);
  });
  target.addEventListener?.("resize", resizeAll);
  if (documentObject.readyState === "loading")
    documentObject.addEventListener?.("DOMContentLoaded", resizeAll, { once: true });
  else
    queueMicrotask(resizeAll);
}

function webLinkActivationEvent(nativeEvent, anchor)
{
  let defaultPrevented = Boolean(nativeEvent?.defaultPrevented);
  return {
    type: String(nativeEvent?.type ?? "click"),
    target: anchor,
    currentTarget: anchor,
    originalEvent: nativeEvent,
    ctrlKey: Boolean(nativeEvent?.ctrlKey),
    altKey: Boolean(nativeEvent?.altKey),
    shiftKey: Boolean(nativeEvent?.shiftKey),
    metaKey: Boolean(nativeEvent?.metaKey),
    get defaultPrevented() { return defaultPrevented; },
    preventDefault() {
      defaultPrevented = true;
      nativeEvent?.preventDefault?.();
    },
    stopPropagation() { nativeEvent?.stopPropagation?.(); },
  };
}

function reportWebLinkEvaluationError(target, result)
{
  const message = String(result?.error ?? "Unknown error");
  try {
    (target?.console ?? globalThis.console)?.error?.(
      `[mdcui] javascript link: ${message}`,
    );
  } catch {}
}

function installWebLinkContext(target)
{
  const documentObject = target?.document;
  if (!documentObject || documentObject.__mdcuiLinkContextInstalled) return;
  documentObject.__mdcuiLinkContextInstalled = true;
  documentObject.addEventListener?.("click", async nativeEvent => {
    if (nativeEvent.defaultPrevented) return;
    const anchor = nativeEvent.target?.closest?.("a[href]");
    const href = anchor?.getAttribute?.("href") ?? "";
    if (!/^javascript:/i.test(href)) return;
    const event = webLinkActivationEvent(nativeEvent, anchor);
    nativeEvent.preventDefault?.();
    const reportedFailures = new Set();
    const reportFailure = result => {
      if (!result || typeof result !== "object" || result.ok !== false) return;
      if (reportedFailures.has(result)) return;
      reportedFailures.add(result);
      reportWebLinkEvaluationError(target, result);
    };
    const result = await evalFront(
      target.__mdcuiFrontModule ?? {},
      decodeJavascriptUrlSource(href),
      { event, target: anchor },
      anchor,
      reportFailure,
    );
    reportFailure(result);
  });
}

function installWebHeadingToggle(target)
{
  const documentObject = target?.document;
  if (!documentObject || documentObject.__mdcuiHeadingToggleInstalled) return;
  documentObject.__mdcuiHeadingToggleInstalled = true;

  const decorateAll = () => {
    for (const heading of documentObject.querySelectorAll?.(
      "h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]",
    ) ?? []) ensureWebHeadingToggle(heading);
  };
  if (documentObject.readyState === "loading")
    documentObject.addEventListener?.("DOMContentLoaded", decorateAll, { once: true });
  else
    queueMicrotask(decorateAll);

  const activate = event => {
    const toggle = event.target?.closest?.(".mdcui-heading-toggle");
    const heading = toggle?.closest?.("h1, h2, h3, h4, h5, h6");
    if (!heading?.id) return;
    event.preventDefault?.();
    event.stopPropagation?.();
    event.stopImmediatePropagation?.();
    createWebDollar(documentObject)(heading).toggle();
  };
  documentObject.addEventListener?.("click", activate, { capture: true });
  documentObject.addEventListener?.("keydown", event => {
    if (event.key === "Enter" || event.key === " ") activate(event);
  }, { capture: true });
}

function webElementChildren(element) {
  return Array.from(element?.children ?? []);
}

function firstWebTableAfterHeading(heading) {
  for (
    let sibling = heading?.nextElementSibling;
    sibling;
    sibling = sibling.nextElementSibling
  ) {
    if (String(sibling.tagName ?? "").toUpperCase() === "TABLE")
      return sibling;
    if (String(sibling.tagName ?? "").toUpperCase() === "SECTION")
      return null;
    const nested = sibling.querySelector?.("table");
    if (nested) return nested;
  }
  return null;
}

function webTableRows(table) {
  if (table?.rows) return Array.from(table.rows);
  const rows = [];
  const visit = (element) => {
    for (const child of webElementChildren(element)) {
      if (String(child.tagName ?? "").toUpperCase() === "TR") rows.push(child);
      else visit(child);
    }
  };
  visit(table);
  return rows;
}

function webRowCells(row) {
  if (row?.cells) return Array.from(row.cells);
  return webElementChildren(row).filter(element =>
    ["TH", "TD"].includes(String(element.tagName ?? "").toUpperCase())
  );
}

function webClosestCell(element) {
  for (let current = element; current; current = current.parentElement) {
    if (["TH", "TD"].includes(String(current.tagName ?? "").toUpperCase()))
      return current;
  }
  return null;
}

function webClosestTable(element) {
  for (let current = element; current; current = current.parentElement) {
    if (String(current.tagName ?? "").toUpperCase() === "TABLE") return current;
  }
  return null;
}

function replaceWebTextNodes(element, value) {
  const textNodes = [];
  const visit = (node) => {
    for (const child of node?.childNodes ?? []) {
      if (child?.nodeType === 3 || (!child?.tagName && "textContent" in child))
        textNodes.push(child);
      else visit(child);
    }
  };
  visit(element);
  if (textNodes.length === 0) {
    element?.append?.(
      element.ownerDocument?.createTextNode?.(String(value ?? "")),
    );
    return;
  }
  textNodes[0].textContent = String(value ?? "");
  for (const node of textNodes.slice(1)) node.textContent = "";
}

function createWebCellSelection(table, row, col) {
  const normalizedRow = Number(row);
  const normalizedCol = Number(col);
  const resolveCell = () => {
    if (
      !Number.isInteger(normalizedRow)
      || !Number.isInteger(normalizedCol)
      || normalizedRow < 0
      || normalizedCol < 0
    ) return null;
    return webRowCells(webTableRows(table)[normalizedRow])[
      normalizedCol
    ] ?? null;
  };
  const neighbor = (rowDelta, colDelta) => {
    if (!resolveCell()) return null;
    const nextRow = normalizedRow + rowDelta;
    const rows = webTableRows(table);
    if (nextRow < 0 || nextRow >= rows.length) return null;
    const nextCol = normalizedCol + colDelta;
    if (nextCol < 0 || nextCol >= webRowCells(rows[nextRow]).length)
      return null;
    return createWebCellSelection(table, nextRow, nextCol);
  };
  const selection = {
    get row() { return normalizedRow; },
    get col() { return normalizedCol; },
    text(...args) {
      const cell = resolveCell();
      if (!cell) return args.length > 0 ? selection : "";
      if (args.length === 0) return String(cell.textContent ?? "");
      replaceWebTextNodes(cell, args[0]);
      return selection;
    },
    val(...args) {
      const cell = resolveCell();
      if (!cell) return args.length > 0 ? selection : "";
      const checkbox = cell.querySelector?.('input[type="checkbox"]');
      if (args.length > 0) {
        if (checkbox) checkbox.checked = Boolean(args[0]);
        return selection;
      }
      return checkbox ? Boolean(checkbox.checked) : String(cell.textContent ?? "");
    },
    left() { return neighbor(0, -1); },
    lt() { return neighbor(0, -1); },
    right() { return neighbor(0, 1); },
    rt() { return neighbor(0, 1); },
    up() { return neighbor(-1, 0); },
    down() { return neighbor(1, 0); },
    dn() { return neighbor(1, 0); },
  };
  return selection;
}

function webCellSelectionFromElement(element) {
  const cell = webClosestCell(element);
  const table = webClosestTable(cell);
  if (!cell || !table) return null;
  const rows = webTableRows(table);
  const row = rows.findIndex(candidate => candidate === cell.parentElement);
  const col = row >= 0
    ? webRowCells(rows[row]).findIndex(candidate => candidate === cell)
    : -1;
  return row >= 0 && col >= 0
    ? createWebCellSelection(table, row, col)
    : null;
}

export function createWebDollar(documentObject = globalThis.document)
{
  return function $(selectorInput) {
    const objectSelectorId = webDollarObjectId(selectorInput);
    const selectorText = objectSelectorId ? `#${objectSelectorId}` : selectorInput;
    const objectTarget = !objectSelectorId
      && selectorInput !== null
      && typeof selectorInput === "object"
      ? selectorInput
      : null;
    const selector = objectTarget
      ? null
      : parseDollarIdentity(selectorText, { selector: true });
    const selectorId = String(selector?.id ?? "");
    const resolveElement = () =>
      objectTarget ?? findWebDollarElement(documentObject, selectorText, selector);
    const selection = {
      id: selectorId,
      _mdcuiDollarSelection: true,
      html() {
        try {
          const element = resolveElement();
          if (!element) return "";
          return isWebHeading(element)
            ? semanticWebHeadingHtml(element)
            : String(element.innerHTML ?? "");
        } catch {
          return "";
        }
      },
      text(...args) {
        try {
          const element = resolveElement();
          if (!element) return args.length > 0 ? selection : "";
          if (args.length > 0) {
            element.textContent = String(args[0] ?? "");
            if (isWebHeading(element)) ensureWebHeadingToggle(element);
            return selection;
          }
          return String(element.textContent ?? "");
        } catch {
          return args.length > 0 ? selection : "";
        }
      },
      scrollIntoView(...args) {
        const value = args[0];
        const element = resolveElement();
        if (!isWebHeading(element) || typeof element.scrollIntoView !== "function")
          return undefined;
        if (args.length === 0) return element.scrollIntoView();
        if (value === true || value === -1) return element.scrollIntoView(true);
        if (value === false || value === 1) return element.scrollIntoView(false);
        return element.scrollIntoView({
          block: "center",
          inline: "nearest",
        });
      },
      parent() {
        try {
          return webCellSelectionFromElement(resolveElement());
        } catch {
          return null;
        }
      },
      cell(row, col) {
        try {
          const element = resolveElement();
          const table = isWebHeading(element)
            ? firstWebTableAfterHeading(element)
            : null;
          return createWebCellSelection(table, row, col);
        } catch {
          return createWebCellSelection(null, row, col);
        }
      },
      img(index = 0) {
        const normalizedIndex = Math.trunc(Number(index));
        return {
          get src() {
            try {
              if (!Number.isInteger(normalizedIndex) || normalizedIndex < 0) return "";
              const element = resolveElement();
              if (!isWebHeading(element)) return "";
              return String(webHeadingImages(element)[normalizedIndex]?.src ?? "");
            } catch {
              return "";
            }
          },
        };
      },
      show() {
        try {
          const element = resolveElement();
          showWebHeadingSection(documentObject, element);
        } catch {}
        return selection;
      },
      hide() {
        try {
          const element = resolveElement();
          hideWebHeadingSection(documentObject, element);
        } catch {}
        return selection;
      },
      toggle() {
        try {
          const element = resolveElement();
          const hidden = webIdStore(documentObject)
            .get(element?.id)?.headingVisibility?.hidden;
          if (hidden) showWebHeadingSection(documentObject, element);
          else hideWebHeadingSection(documentObject, element);
        } catch {}
        return selection;
      },
      data(...args) {
        try {
          const element = resolveElement();
          const id = element?.id || selector?.id || selectorId;
          const data = webUserData(documentObject, id, element);
          if (!data) return args.length === 0 ? undefined : selection;
          if (args.length === 0) return data;
          if (args.length === 1) {
            if (args[0] && typeof args[0] === "object") {
              Object.assign(data, args[0]);
              renderWebHeadingComponents(documentObject, id);
              return selection;
            }
            return data[String(args[0])];
          }
          data[String(args[0])] = args[1];
          renderWebHeadingComponents(documentObject, id);
          return selection;
        } catch {
          return args.length <= 1 ? undefined : selection;
        }
      },
      removeData(...keys) {
        try {
          const element = resolveElement();
          const id = element?.id || selector?.id || selectorId;
          const normalized = keys
            .flatMap(key => Array.isArray(key) ? key : String(key).split(/\s+/))
            .filter(Boolean)
            .map(String);
          removeWebUserData(documentObject, id, element, normalized);
        } catch {}
        return selection;
      },
      val(...args) {
        try {
          const element = resolveElement();
          if (!element) return args.length > 0 ? selection : "";
          if (objectTarget) {
            if (args.length > 0) {
              const value = String(args[0] ?? "");
              if ("value" in element) {
                element.value = value;
                resizeWebTextarea(element);
              } else element.textContent = value;
              return selection;
            }
            return webDollarValue(element);
          }
          if (isWebHeading(element)) {
            if (args.length > 0) return selection;
            return webHeadingValue(element);
          }
          if (!selector) return args.length > 0 ? selection : "";
          if (args.length > 0) {
            const value = String(args[0] ?? "");
            if ("value" in element) {
              element.value = value;
              resizeWebTextarea(element);
            }
            else element.textContent = value;
            return selection;
          }
          return webDollarValue(element);
        } catch {
          return args.length > 0 ? selection : "";
        }
      },
      push(...items) {
        try {
          const element = resolveElement();
          return isWebHeading(element) ? mutateWebHeadingList(element, "push", items) : 0;
        } catch {
          return 0;
        }
      },
      pop() {
        try {
          const element = resolveElement();
          return isWebHeading(element) ? mutateWebHeadingList(element, "pop", []) : undefined;
        } catch {
          return undefined;
        }
      },
      shift() {
        try {
          const element = resolveElement();
          return isWebHeading(element) ? mutateWebHeadingList(element, "shift", []) : undefined;
        } catch {
          return undefined;
        }
      },
      unshift(...items) {
        try {
          const element = resolveElement();
          return isWebHeading(element) ? mutateWebHeadingList(element, "unshift", items) : 0;
        } catch {
          return 0;
        }
      },
      splice(...args) {
        try {
          const element = resolveElement();
          return isWebHeading(element) ? mutateWebHeadingList(element, "splice", args) : [];
        } catch {
          return [];
        }
      },
      slice(...args) {
        try {
          const element = resolveElement();
          if (!isWebHeading(element)) return [];
          const list = firstHeadingList(element);
          if (!list) return [];
          return directWebTaskItems(list).map(webTaskItemSnapshot).slice(...args);
        } catch {
          return [];
        }
      },
    };
    return selection;
  };
}

export function installWebDollar(target = globalThis)
{
  if (!target?.document) return target?.$;
  installWebTemplateComponents(target.document);
  const $ = createWebDollar(target.document);
  $.tts = async (text, pitch = 1, speed = 1) => {
    try {
      const Utterance = target.SpeechSynthesisUtterance;
      const synthesis = target.speechSynthesis;
      if (typeof Utterance !== "function" || !synthesis?.speak)
        return "Web Speech synthesis is unavailable";
      const spokenText = String(text ?? "");
      if (!spokenText) return;
      const utterance = new Utterance(spokenText);
      const parsedPitch = Number(pitch);
      const parsedSpeed = Number(speed);
      utterance.pitch = Number.isFinite(parsedPitch) && parsedPitch > 0 ? parsedPitch : 1;
      utterance.rate = Number.isFinite(parsedSpeed) && parsedSpeed > 0 ? parsedSpeed : 1;
      const characters = [...spokenText];
      const ascii = characters.filter(character => character.codePointAt(0) < 128).length;
      utterance.lang = ascii / characters.length > 0.5 ? "en-US" : "zh-TW";
      return await new Promise(resolve => {
        utterance.onend = () => resolve();
        utterance.onerror = event => resolve(
          event?.error instanceof Error
            ? event.error.message
            : `Speech synthesis failed: ${event?.error ?? "unknown error"}`,
        );
        synthesis.cancel?.();
        synthesis.speak(utterance);
      });
    } catch (error) {
      return String(error?.message || error);
    }
  };
  $.tts.stop = () => {
    try {
      target.speechSynthesis?.cancel?.();
      return true;
    } catch {
      return false;
    }
  };
  target.$ = $;
  installWebTextareaResize(target);
  installWebHeadingToggle(target);
  installWebLinkContext(target);
  return $;
}

const loadedWebFrontModules = new WeakSet();

export async function runWebMdcuiLoad(target = globalThis, frontMod = {})
{
  if (!target?.document || !frontMod || typeof frontMod !== "object") return;
  if (loadedWebFrontModules.has(frontMod)) return;
  loadedWebFrontModules.add(frontMod);

  if (target.document.readyState !== "complete") {
    await new Promise(resolve => {
      if (typeof target.addEventListener === "function")
        target.addEventListener("load", resolve, { once: true });
      else resolve();
    });
  }
  installWebDollar(target);
  return evalFront(
    frontMod,
    "typeof onMdcuiLoad === 'function' ? onMdcuiLoad() : undefined",
    {},
    target,
    result => {
      if (result?.ok === false)
        target.console?.error?.(`[mdcui] onMdcuiLoad: ${result.error}`);
    },
  );
}

if (typeof globalThis.document !== "undefined")
  installWebDollar(globalThis);


export async function evalBack(backmod, qjson)
{

try{

if(qjson?.[0] === "_mdcui_render_markdown")
  return renderWebComponentMarkdownOnServer(qjson?.[1]?.[0]);



/* Contract of requestJson(qjson)
type RpcPacket = [
  func: string,
  argv: unknown[],
  envp?: Record<string, unknown>,
];
*/

//  DiscoverApi ApiCaller


let [ func, argv, envp ] = qjson

func = (func || '')+'' ;

if(process.env.RPC_DEBUG)
  console.log(func);

if(!apilist.get(backmod))
  apilist.set(backmod,DiscoverApi(backmod));

const apilistMod = apilist.get(backmod)

if(func=="_discover")
{
  return apilistMod ;
}
else if(apilistMod[func])
{
  if(Array.isArray(argv))
   return await backmod[func]?.apply?.(envp,argv);
  else
   return await ApiCaller(backmod,func,argv,envp);
}
else
{
  return "Unknown func 未知函式: "+func+
         crlf+JSON.stringify(argv);
}



}catch(e)
{
  console.log(e);
  return (e.stack);
}

}  //  end of evalBack


const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const frontBindingNamePattern = /^[$_\p{ID_Start}][$\u200C\u200D_\p{ID_Continue}]*$/u;
const frontBindingNameValidity = new Map();

function safeFrontError(e)
{
  return {
    ok: false,
    error: e?.stack || String(e),
  };
}

function isValidFrontBindingName(name)
{
  if (frontBindingNameValidity.has(name))
    return frontBindingNameValidity.get(name);
  let valid = frontBindingNamePattern.test(name);
  if (valid) {
    try {
      new AsyncFunction(name, "");
    } catch {
      valid = false;
    }
  }
  frontBindingNameValidity.set(name, valid);
  return valid;
}

function isValidFrontSourceSyntax(source)
{
  try {
    new AsyncFunction(`return await (${source})`);
    return true;
  } catch(error) {
    if (!(error instanceof SyntaxError)) return false;
  }
  try {
    new AsyncFunction(source);
    return true;
  } catch {
    return false;
  }
}

function decodeJavascriptUrlSource(text)
{
  const input = String(text ?? "");
  const scheme = input.match(/^javascript:/i);
  if (!scheme) return input;

  const source = input.slice(scheme[0].length);
  const encoded = new TextEncoder().encode(source);
  const decoded = [];
  const hexValue = value => {
    if (value >= 48 && value <= 57) return value - 48;
    if (value >= 65 && value <= 70) return value - 55;
    if (value >= 97 && value <= 102) return value - 87;
    return -1;
  };
  for (let index = 0; index < encoded.length; index++) {
    if (encoded[index] === 37 && index + 2 < encoded.length) {
      const high = hexValue(encoded[index + 1]);
      const low = hexValue(encoded[index + 2]);
      if (high >= 0 && low >= 0) {
        decoded.push(high * 16 + low);
        index += 2;
        continue;
      }
    }
    decoded.push(encoded[index]);
  }
  const decodedSource = new TextDecoder().decode(Uint8Array.from(decoded));
  if (decodedSource === source || isValidFrontSourceSyntax(source))
    return source;
  return isValidFrontSourceSyntax(decodedSource) ? decodedSource : source;
}

function reportSafeFrontError(error, reportError)
{
  const result = safeFrontError(error);
  try {
    reportError?.(result);
  } catch {}
  return result;
}

function safeFrontValue(value, reportError)
{
  if (typeof value !== "function") return value;
  return function(...args) {
    try {
      const result = value.apply(this, args);
      if (result && typeof result.then === "function")
        return Promise.resolve(result).catch(error => reportSafeFrontError(error, reportError));
      return result;
    } catch(e) {
      return reportSafeFrontError(e, reportError);
    }
  };
}

export async function evalFront(
  mod,
  text,
  scope = {},
  thisArg = undefined,
  reportError = undefined,
)
{
try{

    text = String(text ?? "").replace(/^javascript:/i, "");

    const entryMap = new Map(
      Object.entries(mod).filter(([name]) => name !== "$" && isValidFrontBindingName(name)),
    );
    if (typeof globalThis.$ === "function")
      entryMap.set("$", globalThis.$);
    for (const [name, value] of Object.entries(scope))
      if (isValidFrontBindingName(name))
        entryMap.set(name, value);
    const entries = [...entryMap];
    const names = entries.map(([name]) => name);
    const values = entries.map(([, value]) => safeFrontValue(value, reportError));

    try {
      return await new AsyncFunction(...names, `return await (${text})`).call(thisArg, ...values);
    } catch(e) {
      if (e instanceof SyntaxError)
        return await new AsyncFunction(...names, text).call(thisArg, ...values);
      throw e;
    }

}catch(e)
{
  return reportSafeFrontError(e, reportError);
}
    
}


export const rpcraw = async (func,argv,envp)=>{
    
  const apilistMod = await FrontendDiscoverApi()
  
  if(apilistMod[func])
    return await fetch(rpcFetchUrl(), { ...rpcFetchOpt(),
      method: "POST",
      body: JSON.stringify([
        func,argv,envp
      ])
    }).then(r=>r.json()).catch(e=>e) ;
  else if(func=="_discover")
  {
    if(argv[0])
      return jss(apilistMod,null,1) ;
    else
      return apilistMod ;
  }
  else
    return "Unknown func 未知函式: "+func+
           crlf+JSON.stringify(argv);
}

export const rpcproxy = new Proxy(rpcraw,{
  get(target, prop, receiver) {
    if (prop in target) {
      return Reflect.get(target, prop, receiver);
    }

    if (typeof prop !== "string") {
      return undefined;
    }

    target[prop] = async function(...argv) {
      await FrontendDiscoverApi()
      return await target(prop, argv, this);
    };

    return target[prop];
  },
  ownKeys() {
    return Object.keys(apilist.get(0)||{});
  },
  getOwnPropertyDescriptor(target, prop) {
    const apilistMod = apilist.get(0)||{};

    if(prop in apilistMod) {
      return {
        enumerable: true,
        configurable: true,
      };
    }

    return Reflect.getOwnPropertyDescriptor(target, prop);
  }
});

export var rpc = rpcproxy



// functions cannot contain ( ) , 
export function getfuncparams( func )
{
	if( typeof(func) != "function" )
	  return [];
	
	let rs = func.toString();
	let m = rs.match( /\(([\s\S]*?)\)/ );
	if( !m ) return [];
	rs = m[1] ;
	
	return rs.split(",").map(i=>i.trim()) ;
}


export async function FrontendDiscoverApi()
{
  if(!apilist.get(0))
    apilist.set(0, await fetch(rpcFetchUrl(), { ...rpcFetchOpt(),
      method: "POST",
      body: JSON.stringify(["_discover"])
    }).then(r=>r.json()).catch(e=>e) ) ;
    
  return apilist.get(0);
}


// filters out _ starting functions
export function DiscoverApi( obj ) // module_obj
{
	let karr = Object.keys( obj );
	karr = karr
	  .filter( i=>( !i.startsWith('_') && 
	                typeof(obj[i]) == "function" ) )
	  .map(i=>{
          const fname = obj[i].name || obj[i].Name ;
          
          if( fname && fname != i )
            return [ i, [[ fname ]] ];
            
          return [ i, getfuncparams(obj[i]) ];
      });
	
	return Object.fromEntries( karr ) ;
}



/*
 * Module object from import * as modobj from 'mod.mjs'
 * Parameters object
 */
export async function ApiCaller( modobj, cmd, pobj,envp )
{
  const func = modobj[cmd] ;

  if(!pobj) pobj = {} ;

  if( func && typeof(func) == "function" )
  {
    if(!func.args)
    {
      func.args = getfuncparams( func ) ;
      func.args = func.args.map(i=>{
        let ret = i.split("=")[0]
        ret=(ret||"")+""
        return ret.trim();
      });
    }
    
    let parr = func.args.map(i=>pobj[i]) ;

    return await func.apply(envp,parr) ;
  }
  else
    return "Failed: No such function as" +
           crlf + cmd ;
}
