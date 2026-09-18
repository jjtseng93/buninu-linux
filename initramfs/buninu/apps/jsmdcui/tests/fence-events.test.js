import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fenceEventMap, inlineFenceEventCode, parseFenceDeclarations } from "../src/cui/fence-events.mjs";
import { evalFront, installWebDollar, runWebMdcuiLoad } from "../src/cui/rpc.mjs";
import { buildTuiBlockIndex, createTuiSelector, findTuiBlockAtLine, findTuiBlockInIndex, insertTuiTextareaNewline, mergeTuiTextareaBackward, mergeTuiTextareaForward } from "../src/plugins/js-bridge.js";
import { convertWuiTextareas, wrapWuiHeadingSections } from "../runmd.mjs";

const tui = join(import.meta.dir, "..", "tui");
const bunBin = Bun.which("bun") || process.argv0;

async function waitFor(check, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (check()) return;
    await Bun.sleep(20);
  }
  throw new Error("timed out waiting for PTY output");
}

test("fenced text controls retain quoted inline keydown code after the identity", () => {
  const markdown = '```text#myid.field @keydown="first(); second(event); show(\\"done\\")"\nvalue\n```\n';
  const declarations = parseFenceDeclarations(markdown);
  expect(declarations).toHaveLength(1);
  expect(declarations[0]).toMatchObject({
    tag: "text",
    id: "myid",
    classes: ["field"],
  });
  expect(declarations[0].events.get("keydown")).toEqual({
    code: 'first(); second(event); show("done")',
    modifiers: [],
  });
});

test("fence discovery follows Markdown container and raw HTML boundaries", () => {
  const markdown = `> \`\`\`text#quote
> value
> \`\`\`

- \`\`\`textarea#list
  value
  \`\`\`

<div>
\`\`\`text#raw-div
value
\`\`\`
</div>

<!--
\`\`\`text#comment
value
\`\`\`
-->
`;
  expect(
    parseFenceDeclarations(markdown).map(({ id, line }) => ({ id, line })),
  ).toEqual([
    { id: "quote", line: 1 },
    { id: "list", line: 5 },
  ]);
});

test("Unicode fenced-control IDs work in declarations, WUI output, and TUI selectors", () => {
  const markdown = '```text#中文-欄位.field @keydown.prevent="guard(event)"\nvalue\n```\n';
  const declarations = parseFenceDeclarations(markdown);
  expect(declarations).toHaveLength(1);
  expect(declarations[0]).toMatchObject({
    tag: "text",
    id: "中文-欄位",
    classes: ["field"],
  });
  expect(declarations[0].events.get("keydown")).toEqual({
    code: "guard(event)",
    modifiers: ["prevent"],
  });

  const html = convertWuiTextareas(
    Bun.markdown.html(markdown),
    fenceEventMap(markdown),
  );
  expect(html).toContain('id="中文-欄位"');
  expect(html).toContain("event.preventDefault();guard(event)");

  const buffer = {
    lines: ["┌─ text#中文-欄位.field", "│ value", "└─"],
  };
  const $ = createTuiSelector(() => buffer);
  expect($("#中文-欄位").id).toBe("中文-欄位");
  expect($("#中文-欄位").val()).toBe("value");
  expect($({ id: "中文-欄位" }).val()).toBe("value");
});

test("prevent modifier prepends preventDefault to inline event code", () => {
  const markdown = '```text#myid @keydown.prevent="submit(event)"\nvalue\n```\n';
  const handler = fenceEventMap(markdown).get("myid").events.get("keydown");
  expect(handler).toEqual({ code: "submit(event)", modifiers: ["prevent"] });
  expect(inlineFenceEventCode(handler)).toBe("event.preventDefault();submit(event)");
});

test("WUI writes keyboard code as native inline handlers with a mobile beforeinput fallback", () => {
  const markdown = '```text#myid.field @keydown.prevent="guard(event)"\nvalue\n```\n';
  const html = convertWuiTextareas(Bun.markdown.html(markdown), fenceEventMap(markdown));
  expect(html).toContain('id="myid"');
  expect(html).toContain('const __mdcuiKeyCode=Number(event.keyCode||event.which||0);');
  expect(html).toContain('if(event.key!==&quot;Unidentified&quot;){\nObject.defineProperty(event,&quot;toJSON&quot;');
  expect(html).toContain('event.preventDefault();guard(event)\n}"');
  expect(html).toContain('onbeforeinput="if(!this.__mdcuiIdentifiedKeydown&amp;&amp;event.data!=null');
  expect(html).toContain('ctrlKey:{configurable:true,value:!!m.ctrlKey}');
  expect(html).toContain('metaKey:{configurable:true,value:!!m.metaKey}');
  expect(html).not.toContain("onkeyup=");
  expect(html).not.toContain("addEventListener");
});

test("input handlers are added without changing keydown or mobile beforeinput", () => {
  const markdown = '```text#myid @keydown="guard(event)" @input="changed(event)"\nvalue\n```\n';
  const declaration = fenceEventMap(markdown).get("myid");
  const html = convertWuiTextareas(Bun.markdown.html(markdown), fenceEventMap(markdown));
  expect(declaration.events.get("input")).toEqual({
    code: "changed(event)",
    modifiers: [],
  });
  expect(html).toContain("onkeydown=");
  expect(html).toContain("onbeforeinput=");
  expect(html).toContain('oninput="changed(event)"');
});

test("WUI onMdcuiLoad waits for window load and runs once", async () => {
  let loadListener = null;
  let calls = 0;
  const target = {
    document: {
      readyState: "loading",
      getElementById() { return null; },
      querySelectorAll() { return []; },
      addEventListener() {},
    },
    addEventListener(name, listener) {
      if (name === "load") loadListener = listener;
    },
    console,
  };
  const frontMod = {
    onMdcuiLoad() { calls++; },
  };

  const pending = runWebMdcuiLoad(target, frontMod);
  await Bun.sleep(0);
  expect(calls).toBe(0);
  loadListener();
  await pending;
  expect(calls).toBe(1);
  await runWebMdcuiLoad(target, frontMod);
  expect(calls).toBe(1);
});

test("WUI $.tts resolves after browser speech ends with pitch and speed", async () => {
  const spoken = [];
  let cancellations = 0;
  class Utterance {
    constructor(text) { this.text = text; }
  }
  const target = {
    document: {
      getElementById() { return null; },
      querySelectorAll() { return []; },
      addEventListener() {},
    },
    addEventListener() {},
    SpeechSynthesisUtterance: Utterance,
    speechSynthesis: {
      cancel() { cancellations++; },
      speak(utterance) {
        spoken.push(utterance);
        queueMicrotask(() => utterance.onend());
      },
    },
  };
  installWebDollar(target);
  await target.$.tts("Hello world", 1.4, 0.7);
  expect(spoken).toHaveLength(1);
  expect(spoken[0]).toMatchObject({
    text: "Hello world",
    pitch: 1.4,
    rate: 0.7,
    lang: "en-US",
  });
  expect(target.$.tts.stop()).toBe(true);
  expect(cancellations).toBe(2);
});

test("WUI $.tts resolves error reasons instead of rejecting", async () => {
  const document = {
    getElementById() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
  };
  const unavailable = { document, addEventListener() {} };
  installWebDollar(unavailable);
  expect(await unavailable.$.tts("hello")).toBe(
    "Web Speech synthesis is unavailable",
  );

  class Utterance {
    constructor(text) { this.text = text; }
  }
  const failed = {
    document,
    addEventListener() {},
    SpeechSynthesisUtterance: Utterance,
    speechSynthesis: {
      cancel() {},
      speak(utterance) {
        queueMicrotask(() => utterance.onerror({ error: "not-allowed" }));
      },
    },
  };
  installWebDollar(failed);
  expect(await failed.$.tts("hello")).toBe(
    "Speech synthesis failed: not-allowed",
  );
});

test("keyup declarations are unsupported in both interfaces", () => {
  const markdown = '```text#myid @keyup="update(event)"\nvalue\n```\n';
  const declarations = parseFenceDeclarations(markdown);
  const html = convertWuiTextareas(Bun.markdown.html(markdown), fenceEventMap(markdown));
  expect(declarations[0].events.size).toBe(0);
  expect(fenceEventMap(markdown).has("myid")).toBeFalse();
  expect(html).not.toContain("onkeyup=");
  expect(html).not.toContain("onkeydown=");
});

test("WUI keeps a trailing line comment inside the generated keydown block", () => {
  const markdown = '```text#myid @keydown="guard(event); // trailing comment"\nvalue\n```\n';
  const html = convertWuiTextareas(Bun.markdown.html(markdown), fenceEventMap(markdown));
  const code = (html.match(/onkeydown="([^"]*)"/)?.[1] ?? "")
    .replaceAll("&quot;", '"')
    .replaceAll("&gt;", ">")
    .replaceAll("&lt;", "<")
    .replaceAll("&amp;", "&");
  expect(() => new Function("event", "guard", code)).not.toThrow();
});

test("WUI restores modifier letters from keyCode or code during keydown", () => {
  const markdown = '```text#myid @keydown.prevent="guard(event)"\nvalue\n```\n';
  const html = convertWuiTextareas(Bun.markdown.html(markdown), fenceEventMap(markdown));
  const decodeAttribute = (value) => value
    .replaceAll("&quot;", '"')
    .replaceAll("&gt;", ">")
    .replaceAll("&lt;", "<")
    .replaceAll("&amp;", "&");
  const keydownCode = decodeAttribute(html.match(/onkeydown="([^"]*)"/)?.[1] ?? "");
  const beforeInputCode = decodeAttribute(html.match(/onbeforeinput="([^"]*)"/)?.[1] ?? "");
  const seen = [];
  const element = {};
  const runKeydown = new Function("event", "guard", keydownCode);
  element.onkeydown = (event) => runKeydown.call(element, event, (current) => seen.push({
    key: current.key,
    ctrlKey: current.ctrlKey,
    shiftKey: current.shiftKey,
    altKey: current.altKey,
    metaKey: current.metaKey,
    json: JSON.parse(JSON.stringify(current)),
    toJSONEnumerable: Object.keys(current).includes("toJSON"),
  }));

  const unidentified = {
    key: "ß",
    keyCode: 0,
    code: "KeyS",
    ctrlKey: true,
    shiftKey: false,
    altKey: true,
    metaKey: true,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
  };
  element.onkeydown(unidentified);
  expect(unidentified.defaultPrevented).toBeTrue();
  expect(unidentified.key).toBe("s");

  const beforeInput = {
    data: "β",
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
  };
  new Function("event", beforeInputCode).call(element, beforeInput);
  expect(seen).toEqual([{
    key: "s",
    ctrlKey: true,
    shiftKey: false,
    altKey: true,
    metaKey: true,
    json: {
      type: "",
      key: "s",
      code: "KeyS",
      raw: "",
      ctrlKey: true,
      shiftKey: false,
      altKey: true,
      metaKey: true,
      repeat: false,
      defaultPrevented: true,
      target: { id: "", tagName: "", className: "", value: "" },
    },
    toJSONEnumerable: false,
  }]);
  expect(beforeInput.key).toBeUndefined();
  expect(beforeInput.defaultPrevented).toBeFalse();
  clearTimeout(element.__mdcuiKeydownReset);
});

test("WUI beforeinput keeps composed text for AltGraph and unmodified input", () => {
  const markdown = '```text#myid @keydown="guard(event)"\nvalue\n```\n';
  const html = convertWuiTextareas(Bun.markdown.html(markdown), fenceEventMap(markdown));
  const decodeAttribute = (value) => value
    .replaceAll("&quot;", '"')
    .replaceAll("&gt;", ">")
    .replaceAll("&lt;", "<")
    .replaceAll("&amp;", "&");
  const keydownCode = decodeAttribute(html.match(/onkeydown="([^"]*)"/)?.[1] ?? "");
  const beforeInputCode = decodeAttribute(html.match(/onbeforeinput="([^"]*)"/)?.[1] ?? "");
  const seen = [];
  const element = {};
  const runKeydown = new Function("event", "guard", keydownCode);
  element.onkeydown = (event) => runKeydown.call(element, event, current => seen.push(current.key));
  const retry = (keydown, data) => {
    element.onkeydown({ key: "Unidentified", ...keydown });
    new Function("event", beforeInputCode).call(element, { data });
  };

  retry({ keyCode: 83, altKey: true, getModifierState: name => name === "AltGraph" }, "β");
  retry({ keyCode: 83 }, "絲");

  expect(seen).toEqual(["β", "絲"]);
  clearTimeout(element.__mdcuiKeydownReset);
});

test("TUI finds the event target only while the cursor is inside the framed body", () => {
  const lines = ["┌─ text#myid.field", "│ value", "└─"];
  expect(findTuiBlockAtLine(lines, 0)).toBeNull();
  expect(findTuiBlockAtLine(lines, 1)?.header).toMatchObject({ tag: "text", id: "myid" });
  expect(findTuiBlockAtLine(lines, 2)).toBeNull();
});

test("TUI textarea val changes participate in undo and redo", () => {
  const buffer = {
    lines: ["┌─ textarea#field", "│ old", "└─"],
    cursor: { x: 2, y: 1 },
    undoStack: [],
    redoStack: [],
    pushUndo(force) {
      expect(force).toBeTrue();
      this.undoStack.push(this.lines.slice());
      this.redoStack = [];
    },
    undo() {
      this.redoStack.push(this.lines.slice());
      this.lines = this.undoStack.pop();
    },
    redo() {
      this.undoStack.push(this.lines.slice());
      this.lines = this.redoStack.pop();
    },
    invalidateHighlightFrom() {},
    ensureCursor() {},
  };
  const $ = createTuiSelector(() => buffer);

  $("textarea#field").val("new\nrow");
  expect($("textarea#field").val()).toBe("new\nrow");
  buffer.undo();
  expect($("textarea#field").val()).toBe("old");
  buffer.redo();
  expect($("textarea#field").val()).toBe("new\nrow");
});

test("TUI textarea Enter splits a body row and Backspace joins it", () => {
  const buffer = {
    lines: ["┌─ textarea#field", "│ abcd", "└─", "after"],
    cursor: { x: 4, y: 1 },
    _mdcuiFenceBlockIndex: { stale: true },
    invalidateHighlightFrom() {},
    ensureCursor() {},
  };
  const block = findTuiBlockAtLine(buffer.lines, buffer.cursor.y);

  expect(insertTuiTextareaNewline(buffer, block)).toBeTrue();
  expect(buffer.lines).toEqual([
    "┌─ textarea#field",
    "│ ab",
    "│ cd",
    "└─",
    "after",
  ]);
  expect(buffer.cursor).toEqual({ x: 2, y: 2 });
  expect(buffer._mdcuiFenceBlockIndex).toBeNull();

  expect(mergeTuiTextareaBackward(buffer, findTuiBlockAtLine(buffer.lines, buffer.cursor.y))).toBeTrue();
  expect(buffer.lines).toEqual(["┌─ textarea#field", "│ abcd", "└─", "after"]);
  expect(buffer.cursor).toEqual({ x: 4, y: 1 });
});

test("TUI textarea Delete at line end joins the next body row", () => {
  const buffer = {
    lines: ["┌─ textarea#field", "│ ab", "│ cd", "└─", "after"],
    cursor: { x: 4, y: 1 },
    _mdcuiFenceBlockIndex: { stale: true },
    _mdcuiControlBlockIndex: { stale: true },
    invalidateHighlightFrom() {},
    ensureCursor() {},
  };
  const block = findTuiBlockAtLine(buffer.lines, buffer.cursor.y);

  expect(mergeTuiTextareaForward(buffer, block)).toBeTrue();
  expect(buffer.lines).toEqual(["┌─ textarea#field", "│ abcd", "└─", "after"]);
  expect(buffer.cursor).toEqual({ x: 4, y: 1 });
  expect(buffer._mdcuiFenceBlockIndex).toBeNull();
  expect(buffer._mdcuiControlBlockIndex).toBeNull();
  expect(mergeTuiTextareaForward(buffer, findTuiBlockAtLine(buffer.lines, buffer.cursor.y))).toBeFalse();
});

test("TUI keyboard lookup indexes event blocks once and uses binary lookup", () => {
  const lines = [
    "heading",
    "┌─ text#plain",
    "│ no event",
    "└─",
    ...Array.from({ length: 5_000 }, (_, index) => `line ${index}`),
    "┌─ text#target",
    "│ event body",
    "└─",
  ];
  const declarations = new Map([
    ["target", { tag: "text", events: new Map([["keydown", { code: "hit()" }]]) }],
  ]);
  const blocks = buildTuiBlockIndex(lines, declarations);

  expect(blocks).toHaveLength(1);
  expect(blocks[0].header).toMatchObject({ tag: "text", id: "target" });
  expect(findTuiBlockInIndex(blocks, lines.length - 2)).toBe(blocks[0]);
  expect(findTuiBlockInIndex(blocks, 2)).toBeNull();
});

test("front evaluation exposes the TUI event scope to inline statements", async () => {
  const seen = [];
  const event = { key: "Enter" };
  const result = await evalFront(
    { record(value) { seen.push(value); } },
    "record(event.key)",
    { event },
  );
  expect(result).toBeUndefined();
  expect(seen).toEqual(["Enter"]);
});

test("front evaluation binds link this and event targets to the same object", async () => {
  const $ = createTuiSelector(() => null);
  const target = {
    tagName: "A",
    href: "javascript:inspect(event)",
    textContent: "Save",
  };
  const event = { target, currentTarget: target };
  const result = await evalFront(
    {
      inspect(current) {
        return {
          thisText: this?.textContent,
          eventText: current.target.textContent,
          sameTarget: current.target === current.currentTarget,
        };
      },
    },
    "javascript:({ direct: $(this).text(), called: inspect.call(this, event) })",
    { event, target, $ },
    target,
  );

  expect(result).toEqual({
    direct: "Save",
    called: {
      thisText: "Save",
      eventText: "Save",
      sameTarget: true,
    },
  });
});

test("front evaluation ignores module exports that cannot be local bindings", async () => {
  const result = await evalFront(
    {
      default: "ignored",
      "not-valid": "ignored",
      await: "ignored",
      inspect() { return "called"; },
    },
    "javascript:inspect()",
  );

  expect(result).toBe("called");
});

test("front evaluation preserves raw percent sequences outside the WUI href boundary", async () => {
  const inspect = value => value;

  expect(await evalFront(
    { inspect },
    'javascript:inspect("hello%20world")',
  )).toBe("hello%20world");
  expect(await evalFront(
    { inspect },
    "javascript:inspect(100%25)",
  )).toBe(0);
});

test("WUI javascript href interception injects the registered front module, this, and event", async () => {
  let clickListener;
  let seen;
  let preventDefaultCalls = 0;
  const anchor = {
    tagName: "A",
    href: "javascript:inspect(this,event)",
    getAttribute(name) {
      return name === "href" ? this.href : null;
    },
    closest(selector) {
      return selector === "a[href]" ? this : null;
    },
  };
  const documentObject = {
    readyState: "complete",
    addEventListener(name, listener) {
      if (name === "click") clickListener = listener;
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
  const target = {
    document: documentObject,
    addEventListener() {},
    __mdcuiFrontModule: {
      inspect(targetArg, eventArg) {
        seen = {
          initialDefaultPrevented: eventArg.defaultPrevented,
          targetArg,
          eventArg,
          target: eventArg.target,
          currentTarget: eventArg.currentTarget,
          type: eventArg.type,
        };
        eventArg.preventDefault();
        seen.afterPreventDefault = eventArg.defaultPrevented;
      },
    },
  };
  installWebDollar(target);
  const nativeEvent = {
    type: "click",
    target: anchor,
    defaultPrevented: false,
    preventDefault() {
      preventDefaultCalls++;
      this.defaultPrevented = true;
    },
  };

  await clickListener(nativeEvent);

  expect(seen).toEqual({
    initialDefaultPrevented: false,
    targetArg: anchor,
    eventArg: expect.any(Object),
    target: anchor,
    currentTarget: anchor,
    type: "click",
    afterPreventDefault: true,
  });
  expect(nativeEvent.defaultPrevented).toBeTrue();
  expect(preventDefaultCalls).toBe(2);
});

test("WUI decodes Bun-encoded quotes but preserves valid raw modulo source", async () => {
  const html = Bun.markdown.html('[Inspect](javascript:inspect("hello"))');
  const href = html.match(/href="([^"]+)"/)?.[1] ?? "";
  expect(href).toBe("javascript:inspect(%22hello%22)");
  const moduloHtml = Bun.markdown.html("[Inspect](javascript:inspect(100%25))");
  const moduloHref = moduloHtml.match(/href="([^"]+)"/)?.[1] ?? "";
  expect(moduloHref).toBe("javascript:inspect(100%25)");

  let clickListener;
  const seen = [];
  const anchor = {
    href,
    getAttribute(name) {
      return name === "href" ? this.href : null;
    },
    closest(selector) {
      return selector === "a[href]" ? this : null;
    },
  };
  const documentObject = {
    readyState: "complete",
    addEventListener(name, listener) {
      if (name === "click") clickListener = listener;
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
  installWebDollar({
    document: documentObject,
    addEventListener() {},
    __mdcuiFrontModule: {
      inspect(value) { seen.push(value); },
    },
  });
  const nativeEvent = {
    type: "click",
    target: anchor,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  };

  await clickListener(nativeEvent);
  anchor.href = moduloHref;
  nativeEvent.defaultPrevented = false;
  await clickListener(nativeEvent);

  expect(seen).toEqual(["hello", 0]);
  expect(nativeEvent.defaultPrevented).toBeTrue();
});

test("WUI reports javascript link evaluation failures to its console", async () => {
  let clickListener;
  const errors = [];
  const anchor = {
    href: "javascript:fail()",
    getAttribute(name) {
      return name === "href" ? this.href : null;
    },
    closest(selector) {
      return selector === "a[href]" ? this : null;
    },
  };
  const documentObject = {
    readyState: "complete",
    addEventListener(name, listener) {
      if (name === "click") clickListener = listener;
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
  installWebDollar({
    document: documentObject,
    addEventListener() {},
    console: {
      error(...args) { errors.push(args); },
    },
    __mdcuiFrontModule: {
      fail() { throw new Error("link failed"); },
    },
  });
  const nativeEvent = {
    type: "click",
    target: anchor,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  };

  await clickListener(nativeEvent);

  expect(nativeEvent.defaultPrevented).toBeTrue();
  expect(errors).toHaveLength(1);
  expect(errors[0].join(" ")).toContain("[mdcui] javascript link: Error: link failed");
});

test("WUI reports exported function failures discarded by statement handlers", async () => {
  let clickListener;
  const errors = [];
  const anchor = {
    href: "javascript:fail();",
    getAttribute(name) {
      return name === "href" ? this.href : null;
    },
    closest(selector) {
      return selector === "a[href]" ? this : null;
    },
  };
  const documentObject = {
    readyState: "complete",
    addEventListener(name, listener) {
      if (name === "click") clickListener = listener;
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
  installWebDollar({
    document: documentObject,
    addEventListener() {},
    console: {
      error(...args) { errors.push(args); },
    },
    __mdcuiFrontModule: {
      fail() { throw new Error("sync statement failed"); },
      async failAsync() {
        await Promise.resolve();
        throw new Error("async statement failed");
      },
    },
  });
  const nativeEvent = {
    type: "click",
    target: anchor,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  };

  await clickListener(nativeEvent);
  anchor.href = "javascript:failAsync();";
  nativeEvent.defaultPrevented = false;
  await clickListener(nativeEvent);
  await Promise.resolve();

  expect(nativeEvent.defaultPrevented).toBeTrue();
  expect(errors).toHaveLength(2);
  expect(errors[0].join(" ")).toContain("sync statement failed");
  expect(errors[1].join(" ")).toContain("async statement failed");
});

test("WUI javascript href interception honors an earlier preventDefault", async () => {
  let clickListener;
  let calls = 0;
  const anchor = {
    href: "javascript:inspect()",
    getAttribute(name) {
      return name === "href" ? this.href : null;
    },
    closest(selector) {
      return selector === "a[href]" ? this : null;
    },
  };
  const documentObject = {
    readyState: "complete",
    addEventListener(name, listener) {
      if (name === "click") clickListener = listener;
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
  installWebDollar({
    document: documentObject,
    addEventListener() {},
    __mdcuiFrontModule: {
      inspect() { calls++; },
    },
  });
  const nativeEvent = {
    type: "click",
    target: anchor,
    defaultPrevented: true,
    preventDefault() {
      throw new Error("interceptor must not prevent an already-cancelled event");
    },
  };

  await clickListener(nativeEvent);

  expect(calls).toBe(0);
});

test("WUI wraps only the first visible heading character as a toggle target", () => {
  const html = wrapWuiHeadingSections(
    '<h2 id="title"><em>Title</em></h2><p>Body</p><h2 id="next">&amp; next</h2>',
  );

  expect(html).toContain(
    '<em><span class="mdcui-heading-toggle" role="button" tabindex="0" aria-expanded="true">T</span>itle</em>',
  );
  expect(html).toContain(
    '<span class="mdcui-heading-toggle" role="button" tabindex="0" aria-expanded="true">&amp;</span> next',
  );
});

test("WUI heading toggles preserve complete HTML character references", () => {
  for (const reference of [
    "&copy",
    "&copy;",
    "&#169",
    "&#xA9",
  ]) {
    const html = wrapWuiHeadingSections(
      `<h2 id="entity">${reference} raw</h2>`,
    );
    expect(html).toContain(
      '<span class="mdcui-heading-toggle" role="button" tabindex="0" '
      + `aria-expanded="true">${reference}</span> raw`,
    );
  }

  const bogus = wrapWuiHeadingSections(
    '<h2 id="bogus">&bogus <em>x;</em> rest</h2>',
  );
  expect(bogus).toContain(
    '<span class="mdcui-heading-toggle" role="button" tabindex="0" '
    + 'aria-expanded="true">&</span>bogus <em>x;</em> rest',
  );
  expect(bogus).not.toContain("</span></em>");

  for (const whitespace of ["&nbsp;", "&#x20;"]) {
    const html = wrapWuiHeadingSections(
      `<h2 id="space">${whitespace}A</h2>`,
    );
    expect(html).toContain(
      `${whitespace}<span class="mdcui-heading-toggle" role="button" `
      + 'tabindex="0" aria-expanded="true">A</span>',
    );
  }
});

test("WUI closes nested heading sections inside their Markdown containers", () => {
  const rendered = Bun.markdown.html(`> ## Quoted
>
> Body

- ## Listed

  Body

# Top
`, { headings: { ids: true } });
  const html = wrapWuiHeadingSections(rendered);

  expect(html).toContain(
    "<blockquote>\n<section>\n<h2 id=\"quoted\">",
  );
  expect(html).toContain("</section>\n</blockquote>");
  expect(html).toContain("<li>\n<section>\n<h2 id=\"listed\">");
  expect(html).toContain("</section>\n</li>");
  expect(html).not.toContain("</blockquote>\n</section>");
  expect(html).not.toContain("</li>\n</section>");
});

test("raw empty-ID WUI headings fail closed before Markdown normalization", () => {
  const rendered = Bun.markdown.html("# 中文\n", {
    headings: { ids: true },
  });
  expect(rendered).toContain('<h1 id="">中文</h1>');

  const html = wrapWuiHeadingSections(rendered);
  expect(html).toContain('<h1 id="">中文</h1>');
  expect(html).not.toContain("mdcui-heading-toggle");
  expect(html).not.toContain('role="button"');
  expect(html).not.toContain('tabindex="0"');
});

test("WUI heading toggles preserve quoted greater-than signs in HTML attributes", () => {
  const html = wrapWuiHeadingSections(
    '<!doctype html><body title="body > value">'
    + '<h2 id="quoted" title="heading > value">'
    + "<em data-note='inline > value'>Title</em></h2><p>Body</p>"
    + "</body>",
  );

  expect(html).toContain('<body title="body > value">');
  expect(html).toContain('<h2 id="quoted" title="heading > value">');
  expect(html).toContain("<em data-note='inline > value'>"
    + '<span class="mdcui-heading-toggle" role="button" tabindex="0" '
    + 'aria-expanded="true">T</span>itle</em>');
  expect(html).not.toContain('heading > <span class="mdcui-heading-toggle"');
  expect(html).not.toContain("inline > <span class=\"mdcui-heading-toggle\"");
});

test("WUI heading sections ignore body-like text inside opaque elements", () => {
  const html = wrapWuiHeadingSections(
    '<!doctype html><html><head><script>'
    + 'const opening = "<body>"; const closing = "</body>";'
    + "</script></head><body>"
    + '<h2 id="real">Real</h2><p>Body</p>'
    + "</body></html>",
  );

  expect(html).toContain(
    '<script>const opening = "<body>"; const closing = "</body>";</script>',
  );
  expect(html.match(/<section>/g)).toHaveLength(1);
  expect(html.indexOf("</section>")).toBeLessThan(html.lastIndexOf("</body>"));
});

test("WUI heading toggles preserve inline code and opaque block markers", () => {
  const inlineCode = wrapWuiHeadingSections(
    '<h2 id="code"><code>foo</code></h2><p>Body</p>',
  );
  expect(inlineCode).toContain(
    '<code><span class="mdcui-heading-toggle" role="button" tabindex="0" aria-expanded="true">f</span>oo</code>',
  );
  expect(inlineCode).not.toContain("MDCUI_HEADING_OPAQUE_");

  const protectedBlock = wrapWuiHeadingSections(
    '<pre><code><h2 id="fake">Fake</h2></code></pre><h2 id="real">Real</h2>',
  );
  expect(protectedBlock).toContain('<pre><code><h2 id="fake">Fake</h2></code></pre>');
  expect(protectedBlock).not.toContain("MDCUI_HEADING_OPAQUE_");
  expect(protectedBlock.match(/<section>/g)).toHaveLength(1);

  const rawPreHeading = wrapWuiHeadingSections(
    '<pre><h2 id="inside-pre">Inside pre</h2></pre>',
  );
  expect(rawPreHeading).toContain(
    '<h2 id="inside-pre"><span class="mdcui-heading-toggle" '
    + 'role="button" tabindex="0" aria-expanded="true">I</span>nside pre</h2>',
  );
  expect(rawPreHeading.match(/<section>/g)).toHaveLength(1);

  const standaloneCode = wrapWuiHeadingSections(
    '<CODE data-note="standalone > code"><h2 id="fake">Fake</h2></CODE>'
    + '<h2 id="real">Real</h2><p>Body</p>',
  );
  expect(standaloneCode).toContain(
    '<CODE data-note="standalone > code"><h2 id="fake">Fake</h2></CODE>',
  );
  expect(standaloneCode).not.toContain(
    '<h2 id="fake"><span class="mdcui-heading-toggle"',
  );
  expect(standaloneCode.match(/<section>/g)).toHaveLength(1);
  expect(standaloneCode).toContain(
    '<h2 id="real"><span class="mdcui-heading-toggle"',
  );

  const quotedScript = wrapWuiHeadingSections(
    '<script data-note="> </script>"><h2 id="fake">Fake</h2></script>'
    + '<h2 id="real">Real</h2>',
  );
  expect(quotedScript).toContain(
    '<script data-note="> </script>"><h2 id="fake">Fake</h2></script>',
  );
  expect(quotedScript.match(/<section>/g)).toHaveLength(1);

  const nestedTemplate = wrapWuiHeadingSections(
    '<template><template>Inner</template><h2 id="fake">Fake</h2></template>'
    + '<h2 id="real">Real</h2>',
  );
  expect(nestedTemplate).toContain(
    '<template><template>Inner</template><h2 id="fake">Fake</h2></template>',
  );
  expect(nestedTemplate.match(/<section>/g)).toHaveLength(1);

  for (const tag of ["template", "title", "textarea", "script", "style"]) {
    const foreignOpaque = wrapWuiHeadingSections(
      `<svg><${tag}><h2 id="foreign">Foreign</h2></${tag}></svg>`
      + '<h2 id="real">Real</h2>',
    );
    expect(foreignOpaque).toContain(
      `<${tag}><section>\n<h2 id="foreign">`
      + '<span class="mdcui-heading-toggle"',
    );
    expect(foreignOpaque.match(/<section>/g)).toHaveLength(2);
  }

  const htmlIntegrationTemplate = wrapWuiHeadingSections(
    '<svg><foreignObject><template><h2 id="inert">Inert</h2></template>'
    + '</foreignObject></svg><h2 id="real">Real</h2>',
  );
  expect(htmlIntegrationTemplate).toContain(
    '<template><h2 id="inert">Inert</h2></template>',
  );
  expect(htmlIntegrationTemplate).not.toContain(
    '<h2 id="inert"><span class="mdcui-heading-toggle"',
  );
  expect(htmlIntegrationTemplate.match(/<section>/g)).toHaveLength(1);

  const unclosedScript = wrapWuiHeadingSections(
    '<script><h2 id="fake">Fake</h2>',
  );
  expect(unclosedScript).toBe('<script><h2 id="fake">Fake</h2>');
  expect(unclosedScript).not.toContain("<section>");

  const rawLessThan = wrapWuiHeadingSections(
    'One < two <h2 id="real">Real</h2>',
  );
  expect(rawLessThan.match(/<section>/g)).toHaveLength(1);
});

test("WUI heading toggles wrap complete grapheme clusters", () => {
  const graphemes = [
    "e\u0301",
    "👨‍👩‍👧‍👦",
    "👍🏽",
    "🇹🇼",
  ];

  for (const [index, grapheme] of graphemes.entries()) {
    const html = wrapWuiHeadingSections(
      `<h2 id="grapheme-${index}"><code>${grapheme} rest</code></h2>`,
    );
    expect(html).toContain(
      '<span class="mdcui-heading-toggle" role="button" tabindex="0" '
      + `aria-expanded="true">${grapheme}</span> rest`,
    );
  }
});

test("WUI runtime decoration wraps a complete grapheme cluster", async () => {
  const graphemes = [
    "e\u0301",
    "👨‍👩‍👧‍👦",
    "👍🏽",
    "🇹🇼",
  ];

  for (const [caseIndex, grapheme] of graphemes.entries()) {
    const textNode = {
      nodeType: 3,
      textContent: `  ${grapheme} heading`,
    };
    let rangeStart = -1;
    let rangeEnd = -1;
    let wrapped = "";
    let toggle;
    const heading = {
      tagName: "H2",
      id: `dynamic-${caseIndex}`,
      childNodes: [textNode],
      ownerDocument: null,
      querySelector() { return null; },
    };
    const documentObject = {
      readyState: "complete",
      addEventListener() {},
      querySelector() { return null; },
      querySelectorAll(selector) {
        return selector === "h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]"
          ? [heading]
          : [];
      },
      createRange() {
        return {
          setStart(node, index) {
            expect(node).toBe(textNode);
            rangeStart = index;
          },
          setEnd(node, index) {
            expect(node).toBe(textNode);
            rangeEnd = index;
          },
          surroundContents(node) {
            toggle = node;
            wrapped = textNode.textContent.slice(rangeStart, rangeEnd);
          },
        };
      },
      createElement(tagName) {
        return {
          tagName: String(tagName).toUpperCase(),
          style: {},
          attributes: new Map(),
          setAttribute(name, value) { this.attributes.set(name, value); },
        };
      },
    };
    heading.ownerDocument = documentObject;

    installWebDollar({
      document: documentObject,
      addEventListener() {},
    });
    await Promise.resolve();

    expect(rangeStart).toBe(2);
    expect(rangeEnd).toBe(2 + grapheme.length);
    expect(wrapped).toBe(grapheme);
    expect(toggle.className).toBe("mdcui-heading-toggle");
  }
});

test("TUI keydown.prevent runs before editing and blocks text input", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jsmdcui-keydown-"));
  const markdownPath = join(dir, "app.md");
  const markdown = [
    '```text#field @keydown.prevent="record(this,event)"',
    "a",
    "```",
    "",
    "```text#status",
    "waiting",
    "```",
    "",
    "```js front",
    "export function record(target, event) {",
    "  const data = JSON.parse(JSON.stringify(event));",
    "  $('#status').val(`${data.key}:${data.target.id}:${data.target.value}:${data.defaultPrevented}:${Object.keys(event).includes('toJSON')}:${target === event.target}`);",
    "}",
    "```",
    "",
  ].join("\n");
  let output = "";
  let proc;
  let terminal;
  try {
    await writeFile(markdownPath, markdown);
    terminal = new Bun.Terminal({
      cols: 60,
      rows: 16,
      data(_terminal, data) {
        output += Buffer.from(data).toString();
      },
    });
    proc = Bun.spawn({
      cmd: [bunBin, tui, "+2:4", markdownPath],
      cwd: dir,
      terminal,
      env: { ...process.env, TERM: "xterm-256color", COLUMNS: "60", LINES: "16" },
    });
    await waitFor(() => Bun.stripANSI(output).includes("waiting"));
    terminal.write("x");
    await waitFor(() => Bun.stripANSI(output).includes("x:field:a:true:false:true"));
    terminal.write("\x11");
    await Promise.race([proc.exited, Bun.sleep(2000)]);
    expect(Bun.stripANSI(output)).toContain("x:field:a:true:false:true");
  } finally {
    if (proc && proc.exitCode == null) proc.kill();
    terminal?.close();
    await rm(dir, { recursive: true, force: true });
  }
}, 10000);

test("TUI input runs after insertion with the updated value", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jsmdcui-input-"));
  const markdownPath = join(dir, "app.md");
  const markdown = [
    '```text#field @input="changed(event)"',
    "a",
    "```",
    "",
    "```text#status",
    "waiting",
    "```",
    "",
    "```js front",
    "export function changed(event) {",
    "  $('#status').val(`input:<${event.target.value}>`);",
    "}",
    "```",
    "",
  ].join("\n");
  let output = "";
  let proc;
  let terminal;
  try {
    await writeFile(markdownPath, markdown);
    terminal = new Bun.Terminal({
      cols: 60,
      rows: 16,
      data(_terminal, data) {
        output += Buffer.from(data).toString();
      },
    });
    proc = Bun.spawn({
      cmd: [bunBin, tui, "+2:4", markdownPath],
      cwd: dir,
      terminal,
      env: { ...process.env, TERM: "xterm-256color", COLUMNS: "60", LINES: "16" },
    });
    await waitFor(() => Bun.stripANSI(output).includes("waiting"));
    terminal.write("x");
    await waitFor(() => Bun.stripANSI(output).includes("input:<ax>"));
    terminal.write("\x11");
    await Promise.race([proc.exited, Bun.sleep(2000)]);
    expect(Bun.stripANSI(output)).toContain("input:<ax>");
  } finally {
    if (proc && proc.exitCode == null) proc.kill();
    terminal?.close();
    await rm(dir, { recursive: true, force: true });
  }
}, 10000);

test("TUI onMdcuiLoad runs after startup resources are ready", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jsmdcui-load-"));
  const markdownPath = join(dir, "app.md");
  const markdown = [
    "# Ready",
    "",
    "```text#status",
    "waiting",
    "```",
    "",
    "```js front",
    "export function onMdcuiLoad() {",
    "  $('#status').val('loaded');",
    "}",
    "```",
    "",
  ].join("\n");
  let output = "";
  let proc;
  let terminal;
  try {
    await writeFile(markdownPath, markdown);
    terminal = new Bun.Terminal({
      cols: 60,
      rows: 12,
      data(_terminal, data) {
        output += Buffer.from(data).toString();
      },
    });
    proc = Bun.spawn({
      cmd: [bunBin, tui, markdownPath],
      cwd: dir,
      terminal,
      env: { ...process.env, TERM: "xterm-256color", COLUMNS: "60", LINES: "12" },
    });
    await waitFor(() => Bun.stripANSI(output).includes("loaded"));
    terminal.write("\x11");
    await Promise.race([proc.exited, Bun.sleep(2000)]);
    expect(Bun.stripANSI(output)).toContain("loaded");
  } finally {
    if (proc && proc.exitCode == null) proc.kill();
    terminal?.close();
    await rm(dir, { recursive: true, force: true });
  }
}, 10000);

test("TUI keydown alert releases and restores terminal input", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jsmdcui-keydown-alert-"));
  const markdownPath = join(dir, "app.md");
  const markdown = [
    '```text#field @keydown.prevent="celebrate(event)"',
    "focus here",
    "```",
    "",
    "```text#status",
    "waiting",
    "```",
    "",
    "```js front",
    "export function celebrate(event) {",
    "  if (event.key === 'x') {",
    "    alert('KEYDOWN ALERT');",
    "    $('#status').val('alert closed');",
    "    return;",
    "  }",
    "  $('#status').val(`second input: ${event.key}`);",
    "}",
    "```",
    "",
  ].join("\n");
  let output = "";
  let proc;
  let terminal;
  try {
    await writeFile(markdownPath, markdown);
    terminal = new Bun.Terminal({
      cols: 60,
      rows: 16,
      data(_terminal, data) {
        output += Buffer.from(data).toString();
      },
    });
    proc = Bun.spawn({
      cmd: [bunBin, tui, "+2:4", markdownPath],
      cwd: dir,
      terminal,
      env: { ...process.env, TERM: "xterm-256color", COLUMNS: "60", LINES: "16" },
    });
    await waitFor(() => Bun.stripANSI(output).includes("waiting"));
    terminal.write("x");
    await waitFor(() => Bun.stripANSI(output).includes("KEYDOWN ALERT"));
    terminal.write("\r");
    await waitFor(() => Bun.stripANSI(output).includes("alert closed"));
    terminal.write("z");
    await waitFor(() => Bun.stripANSI(output).includes("second input:z"));
    terminal.write("\x11");
    const exitCode = await Promise.race([
      proc.exited,
      Bun.sleep(2000).then(() => null),
    ]);
    expect(exitCode).toBe(0);
    expect(Bun.stripANSI(output)).toContain("second input:z");
  } finally {
    if (proc && proc.exitCode == null) proc.kill();
    terminal?.close();
    await rm(dir, { recursive: true, force: true });
  }
}, 10000);
