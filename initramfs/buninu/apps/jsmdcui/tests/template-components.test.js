import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyPreRenderHeadingData,
  renderTuiComponentMarkdown,
  renderMarkdownTemplateComponents,
} from "../src/cui/template-components.mjs";
import {
  createWebDollar,
  evalBack,
  installWebTemplateComponents,
} from "../src/cui/rpc.mjs";
import { createWui } from "../runmd.mjs";
import { createTui } from "../runmd.mjs";
import { createTuiSelector, markdownImageSignature } from "../src/plugins/js-bridge.js";

test("four-backtick md template fences create heading components", () => {
  const result = renderMarkdownTemplateComponents(`# Users

before

\`\`\`\`md template
| Name | Active |
| --- | --- |
| Ada | yes |
\`\`\`\`

# Next
`);
  const record = result.idStore.get("users");
  const component = record.components[0];

  expect(component.id).toBe("users");
  expect(component.templateType).toBe("md");
  expect(component.source).toBe(`| Name | Active |
| --- | --- |
| Ada | yes |`);
  expect(component.render(component.data)).toBe(component.source);
  expect(component.last).toBe(component.source);
  expect(component.data).toBe(record.data);
  expect(component.index).toBe(0);
  expect(component.marker.start).toMatch(/^\u2060/u);
  expect(component.marker.end).toMatch(/^\u2060/u);
  expect(result.markdown).toContain(
    `\n${component.marker.start}\n\n${component.source}\n\n${component.marker.end}\n`,
  );
  expect(result.markdown).toContain(component.source);
  expect(result.markdown).not.toContain("````md template");
});

test("four-backtick js template uses its source as a synchronous function body", () => {
  const result = renderMarkdownTemplateComponents(`# Profile

\`\`\`\`js template
---
name: Ada
---
return \`Hello **\${data.name}** from \${this.id}\`
\`\`\`\`
`);
  const record = result.idStore.get("profile");
  const component = record.components[0];

  expect(component.templateType).toBe("js");
  expect(component.initialData).toEqual({ name: "Ada" });
  expect(component.source).toBe(
    "return `Hello **${data.name}** from ${this.id}`",
  );
  expect(component.data).toBe(record.data);
  expect(component.last).toBe("Hello **Ada** from profile");
  expect(result.markdown).toContain("Hello **Ada** from profile");
  expect(result.markdown).not.toContain("````js template");
});

test("components use the closest preceding heading and share its data", () => {
  const result = renderMarkdownTemplateComponents(`# Parent

\`\`\`\`md template
parent
\`\`\`\`

## Child

\`\`\`\`md template
one
\`\`\`\`

\`\`\`\`md template
two
\`\`\`\`
`);
  const parent = result.idStore.get("parent");
  const child = result.idStore.get("child");

  expect(parent.components).toHaveLength(1);
  expect(child.components).toHaveLength(2);
  expect(child.components[0].data).toBe(child.data);
  expect(child.components[1].data).toBe(child.data);
});

test("pre-render heading records merge without replacing existing data", () => {
  const existingData = Object.assign(Object.create(null), { count: 2 });
  const buffer = {
    _mdcuiIdStore: new Map([["users", {
      data: existingData,
      components: [{ last: "previous" }],
      headingVisibility: { hidden: true },
    }]]),
  };
  const scanned = renderMarkdownTemplateComponents(`# Users

\`\`\`\`md template
hello
\`\`\`\`
`);
  scanned.idStore.get("users").data.ready = true;

  applyPreRenderHeadingData(buffer, scanned.idStore);

  const record = buffer._mdcuiIdStore.get("users");
  expect(record.data).toBe(existingData);
  expect(record.data).toEqual({ count: 2, ready: true });
  expect(record.headingVisibility.hidden).toBe(true);
  expect(record.components[0].data).toBe(existingData);
  expect(record.components[0].last).toBe("hello");
});

test("ordinary and unclosed fences are left untouched", () => {
  const markdown = `# Demo

\`\`\`md template
ordinary
\`\`\`

\`\`\`\`md template
unclosed`;
  const result = renderMarkdownTemplateComponents(markdown);
  expect(result.markdown).toBe(markdown);
  expect(result.idStore.size).toBe(0);
});

test("WUI template payload hydrates the document id store", () => {
  const payload = {
    textContent: JSON.stringify([{
      id: "users",
      data: { count: 2 },
      components: [{ id: "users", source: "hello", last: "hello" }],
    }]),
  };
  const heading = { id: "users", tagName: "H1" };
  const documentObject = {
    getElementById(id) {
      return id === "mdcui-template-components" ? payload : heading;
    },
  };

  installWebTemplateComponents(documentObject);
  const data = createWebDollar(documentObject)("#users").data();
  const record = documentObject._mdcuiIdStore.get("users");

  expect(data).toBe(record.data);
  expect(data.count).toBe(2);
  expect(record.components[0].data).toBe(data);
  expect(record.components[0].render(data)).toBe("hello");
  expect(record.components[0].index).toBe(0);
});

test("WUI hydrates js template render bodies with component this", () => {
  const payload = {
    textContent: JSON.stringify([{
      id: "profile",
      data: { name: "Ada" },
      components: [{
        id: "profile",
        index: 0,
        templateType: "js",
        source: "return `${this.id}: ${data.name}`",
        last: "profile: Ada",
      }],
    }]),
  };
  const heading = { id: "profile", tagName: "H1" };
  const documentObject = {
    getElementById(id) {
      return id === "mdcui-template-components" ? payload : heading;
    },
  };

  installWebTemplateComponents(documentObject);
  const component = documentObject._mdcuiIdStore.get("profile").components[0];
  expect(component.templateType).toBe("js");
  expect(component.render.call(component, component.data)).toBe("profile: Ada");
});

test("createWui expands templates and embeds their component payload", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jsmdcui-template-wui-"));
  const html = await createWui(`# Users

\`\`\`\`md template
| A | B |
| --- | --- |
| one | two |
\`\`\`\`
`, join(directory, "app.md"));

  expect(html).toContain("<table");
  expect(html).not.toContain("````md template");
  expect(html).toContain('<div class="mdcui-template" data-mdcui-heading-id="users" data-mdcui-component-index="0">');
  expect(html).toContain('id="mdcui-template-components"');
  expect(html).toContain('"id":"users"');
  expect(html).toContain('"source":"| A | B |\\n| --- | --- |\\n| one | two |"');
});

test("TUI data setters rerender every component between invisible markers", () => {
  const context = {};
  const ansi = String(createTui(`# Users

\`\`\`\`md template
Hello **\${data.name ?? "Guest"}**
\`\`\`\`
`, 40, context));
  const buffer = {
    lines: Bun.stripANSI(ansi).split("\n"),
    _mdcuiAnsiText: ansi,
    _mdcuiRenderWidth: 40,
    cursor: { x: 0, y: 0 },
    modified: false,
    invalidateHighlightFrom() {},
    ensureCursor() {},
  };
  applyPreRenderHeadingData(buffer, context.preRenderHeadingData);
  const component = buffer._mdcuiIdStore.get("users").components[0];
  let renderRequests = 0;

  createTuiSelector(() => buffer, () => renderRequests++)("#users").data("name", "Ada");

  const plain = buffer.lines.join("\n");
  expect(plain).toContain("Hello Ada");
  expect(plain).not.toContain("Guest");
  expect(plain).toContain(component.marker.start);
  expect(plain).toContain(component.marker.end);
  expect(component.last).toBe("Hello **Ada**");
  expect(buffer.modified).toBe(false);
  expect(renderRequests).toBe(1);
});

test("TUI reactive templates dirty Kitty images when an image component changes", () => {
  const context = {};
  const ansi = String(createTui(`# Gallery

\`\`\`\`md template
![demo](\${data.image ?? "one.png"})

\${data.caption ?? "First"}
\`\`\`\`
`, 40, context));
  const buffer = {
    lines: Bun.stripANSI(ansi).split("\n"),
    _mdcuiAnsiText: ansi,
    _mdcuiRenderWidth: 40,
    cursor: { x: 0, y: 0 },
    modified: false,
    invalidateHighlightFrom() {},
    ensureCursor() {},
  };
  applyPreRenderHeadingData(buffer, context.preRenderHeadingData);
  const requests = [];
  const gallery = createTuiSelector(() => buffer, (request) => requests.push(request))("#gallery");

  gallery.data("caption", "Second");
  expect(buffer._mdcuiImagesDirty).toBe(true);
  expect(requests.at(-1)).toEqual({ imagesDirty: true });

  gallery.data("image", "two.png");
  expect(buffer._mdcuiImagesDirty).toBe(true);
  expect(buffer._mdcuiImagesRevision).toBe(2);
  expect(requests.at(-1)).toEqual({ imagesDirty: true });
});

test("Markdown image signatures are empty for null and track image destinations", () => {
  expect(markdownImageSignature(null)).toBe("");
  expect(markdownImageSignature("plain text")).toBe("");
  expect(markdownImageSignature("![one](a.png) ![two](b.jpg)"))
    .toBe("a.png\0b.jpg");
});

test("TUI component Markdown renderer retains heading-associated tables", () => {
  const scanned = renderMarkdownTemplateComponents(`# Users

\`\`\`\`md template
before
\`\`\`\`
`);
  const component = scanned.idStore.get("users").components[0];
  const rendered = renderTuiComponentMarkdown(component, `| A | B |
| --- | --- |
| one | two |`, 40);
  expect(rendered.lines.join("\n")).toContain("┌");
  expect(rendered.lines.join("\n")).toContain("│ one │ two │");
});

test("WUI data setters rerender every matching template wrapper", () => {
  const payload = {
    textContent: JSON.stringify([{
      id: "users",
      data: {},
      components: [{
        id: "users",
        index: 0,
        source: 'Hello **${data.name ?? "Guest"}**',
        last: 'Hello **Guest**',
      }],
    }]),
  };
  const heading = { id: "users", tagName: "H1" };
  const wrapper = {
    innerHTML: "<p>Hello <strong>Guest</strong></p>",
    getAttribute(name) {
      if (name === "data-mdcui-heading-id") return "users";
      if (name === "data-mdcui-component-index") return "0";
      return null;
    },
  };
  const documentObject = {
    getElementById(id) {
      return id === "mdcui-template-components" ? payload : heading;
    },
    querySelectorAll(selector) {
      return selector === ".mdcui-template" ? [wrapper] : [];
    },
  };
  installWebTemplateComponents(documentObject);
  const component = documentObject._mdcuiIdStore.get("users").components[0];

  createWebDollar(documentObject)("#users").data({ name: "Ada" });

  expect(wrapper.innerHTML).toContain("Hello <strong>Ada</strong>");
  expect(component.last).toBe("Hello **Ada**");
});

test("WUI internal RPC renders component Markdown without writing files", async () => {
  const html = await evalBack({}, ["_mdcui_render_markdown", [`| Done |
| --- |
| [x] yes |`]]);
  expect(html).toContain('<table contenteditable="true">');
  expect(html).toContain('<input type="checkbox" checked>');
});

test("component source is a reactive JavaScript template literal", () => {
  const result = renderMarkdownTemplateComponents(`# Greeting

\`\`\`\`md template
Hello **\${data.name ?? "Guest"}** from \${this.id}.
\`\`\`\`
`);
  const component = result.idStore.get("greeting").components[0];
  expect(component.last).toBe("Hello **Guest** from greeting.");
  expect(component.render.call(component))
    .toBe("Hello **Guest** from greeting.");
  component.data.name = "Ada";
  expect(component.render.call(component, component.data))
    .toBe("Hello **Ada** from greeting.");
});

test("template front matter initializes heading data before first render", () => {
  const result = renderMarkdownTemplateComponents(`# Profile

\`\`\`\`md template
---
name: Ada
count: 3
enabled: true
---
Hello **\${data.name}** (\${data.count}) \${data.enabled}
\`\`\`\`
`);
  const record = result.idStore.get("profile");
  const component = record.components[0];

  expect(record.data).toEqual({ name: "Ada", count: 3, enabled: true });
  expect(component.data).toBe(record.data);
  expect(component.initialData).toEqual({ name: "Ada", count: 3, enabled: true });
  expect(component.source).toBe(
    "Hello **${data.name}** (${data.count}) ${data.enabled}",
  );
  expect(component.last).toBe("Hello **Ada** (3) true");
  expect(result.markdown).not.toContain("name: Ada");
});

test("all heading front matter is merged before any component first render", () => {
  const result = renderMarkdownTemplateComponents(`# Shared

\`\`\`\`md template
First sees \${data.later}
\`\`\`\`

\`\`\`\`md template
---
later: ready
---
Second sees \${data.later}
\`\`\`\`
`);
  const components = result.idStore.get("shared").components;
  expect(components[0].last).toBe("First sees ready");
  expect(components[1].last).toBe("Second sees ready");
});

test("an unmatched opening front matter delimiter remains template source", () => {
  const result = renderMarkdownTemplateComponents(`# Demo

\`\`\`\`md template
---
not: closed
\`\`\`\`
`);
  const component = result.idStore.get("demo").components[0];
  expect(component.initialData).toBeNull();
  expect(component.source).toBe("---\nnot: closed");
});
