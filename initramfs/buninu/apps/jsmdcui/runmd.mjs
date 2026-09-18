#!/usr/bin/env bun

import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { readAssetText, readInternalAssetText } from './single-exe/assetsHelper.js'
import { fenceEventMap, inlineFenceEventCode } from './src/cui/fence-events.mjs'
import {
  readLeadingHtmlCharacterReference,
  renderMarkdownWithHeadingIds,
} from './src/cui/heading-ids.mjs'
import { parseMdcuiIdentity } from './src/cui/identity.mjs'
import { renderAnsiWithDataImages } from './src/cui/kitty-images.mjs'
import {
  addTuiTableRowSeparators,
  convertTuiTableCheckboxes,
  markHeadingTableRows,
} from './src/cui/table-render.mjs'
import {
  renderMarkdownTemplateComponents,
  wrapWuiTemplateComponents,
} from './src/cui/template-components.mjs'
import { REPO_ROOT } from './single-exe/compiled.js'

const csl=console.log
const cse=console.error
const mda=Bun.markdown.ansi
const mdh=Bun.markdown.html
const jss=JSON.stringify


const TEST_ROW=9
const TEST_COL=5


function logWroteFile(label,path)
{
  if(!process.stdin.isRaw)
  cse(mda(`- Wrote to ${label} file: ${path}`))
}

export async function readMarkdownInput(mdpath, overwriteDemo = false)
{
  const file = Bun.file(mdpath);
  if (!overwriteDemo && await file.exists()) return await file.text();
  const assetName = path.basename(mdpath);
  const internalText = readInternalAssetText(assetName);
  if (internalText != null) {
    await Bun.write(mdpath, internalText);
    return internalText;
  }
  const fallbackPath = path.join(REPO_ROOT, assetName);
  const fallback = Bun.file(fallbackPath);
  if (await fallback.exists()) {
    const fallbackText = await fallback.text();
    await Bun.write(mdpath, fallbackText);
    return fallbackText;
  }
  throw new Error(`md file not found: ${mdpath}`);
}


export async function main(tuiWidth=30, {
  mdpath: requestedMdpath = null,
  overwriteDemo = process.argv.includes("--overwrite-demo"),
  printUi = process.argv.includes("--print-ui"),
  useBundledMdcuiServer = false,
} = {})
{
    const explicitMdpath = process.argv.find(i=>i.endsWith('.md'))
    const mdpath = requestedMdpath || explicitMdpath || 'testapp.md'


	// 1. Read markdown file
	console.error('Reading:',mdpath)
	let md = await readMarkdownInput(mdpath, overwriteDemo && !requestedMdpath && !explicitMdpath)

    // 2. Extract js files
    md = await extractJs(md,mdpath);

	// 3. Create Terminal UI
	let tui = createTui(md,tuiWidth)
	if (printUi) {
	  cse(mda("\n# TUI"))
	  cse(tui)
	  cse(mda('## TUI raw'))
	  cse(jss(tui))
	}


	// 4. Create Web UI
	let wui = await createWui(md,mdpath)
	if (printUi) {
	  cse(mda('\n# HTML'))
	  cse(wui)
	}


    /*
	// 5. Get character from point for TUI
	let ch = charFromPoint(tui,TEST_ROW,TEST_COL)

	cse(mda(
	  '# Slicing row,col: '+TEST_ROW+','+TEST_COL
	))

	cse(jss(ch))
	
	*/


    const serverPath = mdpath + "-server.js"
    const useEmbeddedMdcuiServer = Boolean(
      global.MDCUI_MAIN && useBundledMdcuiServer
    )
    cse(
      `[mdcui] Starting ${useEmbeddedMdcuiServer ? "embedded" : "external"} `
      + `WUI server: ${
        useEmbeddedMdcuiServer
          ? String(global.MDCUI_MAIN)
          : path.resolve(serverPath)
      }`
    )
    const svmod = useEmbeddedMdcuiServer
      ? await import(global.MDCUI_MAIN + "-server.js")
      : await import(pathToFileURL(path.resolve(serverPath)).href)

    cse("\n\n"+mda('# Server'))
    svmod.main();
}


//  Exports


export async function extractJs(md,mdpath,{ bundling = false } = {})
{
  const mdb = path.basename(mdpath)

  let sctagsp = mdpath + ".front.js"
  let sctags = ""
  // Gather frontend script tags
  let reJs = /```js front[^]+?```/g  //  
  md = md.replace( reJs,
    i=>{
      sctags+=i.slice(11,-3)+'\n\n'
    
      return '';
      return i
        .replace('```js front',"<scr"+"ipt>")
        .slice(0,-3)+"</scr"+"ipt>"
    }
  )
  
  const frontSource = sctags
  sctags = "#!/usr/bin/env bun" + `
  
    import { rpc as wuiRpcClient, runWebMdcuiLoad } from "./${mdb}-rpc.js";
    let rpc = null
    if(globalThis.process)
    {
      rpc = await import(
        "./" +
        (global.MDCUI_MAIN_BASE||"${mdb}") +
        ".back.js"
      ) ;
    }
    else
      rpc = wuiRpcClient ;
    
  ` + frontSource + `
  
    if (typeof window !== "undefined") 
    {
      // Browser
      setTimeout( () => {
        import("./${mdb}.front.js").then(mod=>{
          Object.assign(window,mod);
          window.__mdcuiFrontModule = mod;
          return runWebMdcuiLoad(window, mod);
        })
      }, 0 ) ;
    }
  ` ;
  
  await Bun.write(sctagsp,sctags);
  logWroteFile("front", sctagsp)

  if (bundling) {
    const bundledFrontSource = "#!/usr/bin/env bun" + `

      import { rpc as wuiRpcClient } from "./${mdb}-rpc.js";
      const rpc = wuiRpcClient;

    ` + frontSource
    const bundledFrontPath = mdpath + ".tmpfs.js"
    await Bun.write(bundledFrontPath, bundledFrontSource)
    logWroteFile("bundling front", bundledFrontPath)

    const bundledImportPath = mdpath + ".tmpfi.js"
    await Bun.write(
      bundledImportPath,
      `import * as frontMod from "./${mdb}.tmpfs.js";
import { runWebMdcuiLoad } from "./${mdb}-rpc.js";

Object.assign(window, frontMod);
window.__mdcuiFrontModule = frontMod;
await runWebMdcuiLoad(window, frontMod);
`,
    )
    logWroteFile("bundling import", bundledImportPath)
  }
  
  sctagsp = mdpath + ".back.js"
  sctags = "#!/usr/bin/env bun\n\n"
  // Gather backend script tags
  reJs = /```js back[^]+?```/g  //  
  md = md.replace( reJs,
    i=>{
      sctags+=i.slice(10,-3)+'\n\n'
    
      return '';
    }
  )
  
  await Bun.write(sctagsp,sctags);
  logWroteFile("back", sctagsp)
  
  await writeRuntimeFiles(mdpath)
  
  return md
}

export async function writeRuntimeFiles(mdpath)
{
  const mdb = path.basename(mdpath)
  const rpcPath = mdpath + "-rpc.js"
  const serverPath = mdpath + "-server.js"
  const rpcSource = await readAssetText("src/cui/rpc.mjs")
  const serverSource = (await readAssetText("src/cui/server.mjs"))
    .replaceAll("./rpc.mjs", `./${mdb}-rpc.js`)
    .replaceAll("testapp.md", mdb)

  await Bun.write(rpcPath, rpcSource)
  logWroteFile("rpc", rpcPath)
  await Bun.write(serverPath, serverSource)
  logWroteFile("server", serverPath)

  return serverPath
}


export function createTui(md,TERMINAL_WIDTH=30, context = null) // ANSI Colors
{
  const templates = renderMarkdownTemplateComponents(md);
  if (context && typeof context === "object")
    context.preRenderHeadingData = templates.idStore;
  md = templates.markdown;
  const tablePlan = markHeadingTableRows(md);
  md = (  renderAnsiWithDataImages(
            tablePlan.markdown,{
              hyperlinks:true,
              columns:TERMINAL_WIDTH
            }
          )
       || md  )+'' ;
  md = addTuiTableRowSeparators(md, tablePlan);
  md = convertTuiTableCheckboxes(md);
       
  return md ;
       
  return Bun.wrapAnsi(
    md,
    TERMINAL_WIDTH
  )
}

function parseWuiControlIdentity(info)
{
  const identity = parseMdcuiIdentity(info);
  return ["text", "textarea"].includes(identity?.tag)
    ? { ...identity, id: identity.id ?? "" }
    : null;
}

function escapeHtmlAttribute(value)
{
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function convertWuiTextareas(html, eventsById = new Map())
{
  return String(html).replace(
    /<pre><code class="language-([^"]+)">([^]*?)<\/code><\/pre>/g,
    (whole, info, content) => {
      const identity = parseWuiControlIdentity(info);
      if (!identity) return whole;
      const value = content.replace(/\n$/, "");
      const contentLines = value.split("\n");
      const cols = Math.max(1, ...contentLines.map(line => [...line].length));
      const declaration = identity.id && eventsById.get(identity.id)?.tag === identity.tag
        ? eventsById.get(identity.id)
        : null;
      const keydownHandler = declaration?.events.get("keydown");
      const inputHandler = declaration?.events.get("input");
      const keydownCode = keydownHandler
        ? [
            "const __mdcuiKeyCode=Number(event.keyCode||event.which||0);",
            "const __mdcuiCodeLetter=/^Key[A-Z]$/.test(event.code||\"\")?event.code.charCodeAt(3):0;",
            "const __mdcuiLetterCode=__mdcuiKeyCode>=65&&__mdcuiKeyCode<=90?__mdcuiKeyCode:__mdcuiCodeLetter;",
            "const __mdcuiAltGraph=!!event.getModifierState&&event.getModifierState(\"AltGraph\");",
            "const __mdcuiLetter=!__mdcuiAltGraph&&(event.ctrlKey||event.altKey||event.metaKey)&&__mdcuiLetterCode>=65&&__mdcuiLetterCode<=90;",
            "if(__mdcuiLetter)Object.defineProperty(event,\"key\",{configurable:true,value:String.fromCharCode(__mdcuiLetterCode+(event.shiftKey?0:32))});",
            "this.__mdcuiIdentifiedKeydown=!!event.key&&event.key!==\"Unidentified\";",
            "this.__mdcuiUnidentifiedKeydown=event.key===\"Unidentified\"?{keyCode:__mdcuiKeyCode,ctrlKey:!!event.ctrlKey,shiftKey:!!event.shiftKey,altKey:!!event.altKey,metaKey:!!event.metaKey,altGraph:__mdcuiAltGraph}:null;",
            "clearTimeout(this.__mdcuiKeydownReset);",
            "this.__mdcuiKeydownReset=setTimeout(()=>{this.__mdcuiIdentifiedKeydown=false;this.__mdcuiUnidentifiedKeydown=null},0);",
            "if(event.key!==\"Unidentified\"){\n",
            "Object.defineProperty(event,\"toJSON\",{configurable:true,value:function(){const t=this.target||{};return{type:String(this.type||\"\"),key:String(this.key||\"\"),code:String(this.code||\"\"),raw:String(this.raw||\"\"),ctrlKey:!!this.ctrlKey,shiftKey:!!this.shiftKey,altKey:!!this.altKey,metaKey:!!this.metaKey,repeat:!!this.repeat,defaultPrevented:!!this.defaultPrevented,target:{id:String(t.id||\"\"),tagName:String(t.tagName||\"\"),className:String(t.className||\"\"),value:String(t.value??\"\")}}}});",
            keydownHandler.modifiers.includes("prevent")
              ? "event.preventDefault();"
              : "",
            keydownHandler.code,
            "\n}",
          ].join("")
        : "";
      const beforeInputCode = keydownHandler
        ? [
            "if(!this.__mdcuiIdentifiedKeydown&&event.data!=null&&event.data!==\"\"){",
            "const m=this.__mdcuiUnidentifiedKeydown||{};",
            "const letter=!m.altGraph&&(m.ctrlKey||m.altKey||m.metaKey)&&m.keyCode>=65&&m.keyCode<=90?String.fromCharCode(m.keyCode+(m.shiftKey?0:32)):String(event.data);",
            "Object.defineProperties(event,{key:{configurable:true,value:letter},ctrlKey:{configurable:true,value:!!m.ctrlKey},shiftKey:{configurable:true,value:!!m.shiftKey},altKey:{configurable:true,value:!!m.altKey},metaKey:{configurable:true,value:!!m.metaKey}});",
            "this.onkeydown(event)",
            "}",
          ].join("")
        : "";
      const inlineEventAttrs = [
        keydownCode ? `onkeydown="${escapeHtmlAttribute(keydownCode)}"` : "",
        beforeInputCode ? `onbeforeinput="${escapeHtmlAttribute(beforeInputCode)}"` : "",
        inputHandler
          ? `oninput="${escapeHtmlAttribute(inlineFenceEventCode(inputHandler))}"`
          : "",
      ];
      const attrs = [
        `data-mdcui-tag="${identity.tag}"`,
        `data-mdcui-language="${escapeHtmlAttribute(info)}"`,
        identity.id ? `id="${escapeHtmlAttribute(identity.id)}"` : "",
        ...inlineEventAttrs,
        `class="${escapeHtmlAttribute([
          `language-${info}`,
          ...identity.classes,
        ].join(" "))}"`,
        `rows="${Math.max(1, contentLines.length)}"`,
        `cols="${cols}"`,
        'wrap="soft"',
        'style="box-sizing:border-box;max-width:100%;width:100%;resize:vertical;overflow-y:hidden"',
      ].filter(Boolean).join(" ");
      return `<textarea ${attrs}>${value}</textarea>`;
    },
  );
}

let wuiGraphemeSegmenter;
function firstWuiGraphemeCluster(value)
{
  const input = String(value ?? "");
  if (!input) return "";

  if (wuiGraphemeSegmenter === undefined) {
    try {
      wuiGraphemeSegmenter = typeof Intl === "object"
        && typeof Intl.Segmenter === "function"
        ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
        : null;
    } catch {
      wuiGraphemeSegmenter = null;
    }
  }
  const segmented = wuiGraphemeSegmenter
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

function wuiHtmlTagAt(input, start)
{
  if (input[start] !== "<") return null;
  if (input.startsWith("<!--", start)) {
    const commentEnd = input.indexOf("-->", start + 4);
    return {
      kind: "comment",
      start,
      end: commentEnd < 0 ? input.length : commentEnd + 3,
      name: null,
      closing: false,
      selfClosing: false,
      source: input.slice(start, commentEnd < 0 ? input.length : commentEnd + 3),
    };
  }
  if (input.startsWith("<![CDATA[", start)) {
    const close = input.indexOf("]]>", start + 9);
    const end = close < 0 ? input.length : close + 3;
    return {
      kind: "comment",
      start,
      end,
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
      kind: "comment",
      start,
      end,
      name: null,
      closing: false,
      selfClosing: false,
      source: input.slice(start, end),
    };
  }

  let quote = null;
  let end = -1;
  for (let index = start + 1; index < input.length; index++) {
    const character = input[index];
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === ">") {
      end = index + 1;
      break;
    }
  }
  if (end < 0) return null;

  const source = input.slice(start, end);
  const closingMatch = source.match(
    /^<\/([A-Za-z][A-Za-z0-9:-]*)(?=[\s>])/,
  );
  const openingMatch = closingMatch
    ? null
    : source.match(/^<([A-Za-z][A-Za-z0-9:-]*)(?=[\s/>])/);
  return {
    kind: closingMatch || openingMatch ? "tag" : "other",
    start,
    end,
    name: String(closingMatch?.[1] ?? openingMatch?.[1] ?? "").toLowerCase() || null,
    closing: Boolean(closingMatch),
    selfClosing: Boolean(openingMatch && /\/\s*>$/.test(source)),
    source,
  };
}

function nextWuiHtmlTag(input, from)
{
  let start = input.indexOf("<", from);
  while (start >= 0) {
    const token = wuiHtmlTagAt(input, start);
    if (token?.kind !== "other") return token;
    start = input.indexOf("<", start + 1);
  }
  return null;
}

function matchingWuiHtmlClose(input, opening)
{
  if (opening?.kind !== "tag" || opening.closing || opening.selfClosing)
    return null;
  let depth = 1;
  let scan = opening.end;
  let token;
  while ((token = nextWuiHtmlTag(input, scan))) {
    scan = token.end;
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

const WUI_HEADING_OPAQUE_TAGS = new Set([
  "iframe",
  "noembed",
  "noframes",
  "noscript",
  "plaintext",
  "script",
  "style",
  "textarea",
  "template",
  "title",
  "xmp",
]);
const WUI_RAW_TEXT_TAGS = new Set([
  "iframe",
  "noembed",
  "noframes",
  "noscript",
  "plaintext",
  "script",
  "style",
  "textarea",
  "title",
  "xmp",
]);
const WUI_HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

function analyzeWuiHeadingHtml(value)
{
  const input = String(value);
  let headingAttribute = "data-mdcui-active-heading";
  while (input.toLowerCase().includes(headingAttribute))
    headingAttribute = "_" + headingAttribute;
  let foreignAttribute = "data-mdcui-foreign-opaque";
  while (
    input.toLowerCase().includes(foreignAttribute)
    || foreignAttribute === headingAttribute
  ) foreignAttribute = "_" + foreignAttribute;

  try {
    let rewriter = new HTMLRewriter();
    for (let level = 1; level <= 6; level++) {
      rewriter = rewriter.on(`h${level}`, {
        element(element) {
          element.setAttribute(headingAttribute, "");
        },
      });
    }
    for (const tag of WUI_HEADING_OPAQUE_TAGS) {
      rewriter = rewriter.on(tag, {
        element(element) {
          if (element.namespaceURI !== WUI_HTML_NAMESPACE)
            element.setAttribute(foreignAttribute, "");
        },
      });
    }
    const transformed = rewriter.transform(new Response(input)).text();
    const html = Bun.peek(transformed);
    if (typeof html === "string") {
      return {
        html,
        headingAttribute,
        foreignAttribute,
        ok: true,
      };
    }
  } catch {}
  return {
    html: input,
    headingAttribute,
    foreignAttribute,
    ok: false,
  };
}

function stripWuiAnalysisAttributes(value, analysis)
{
  let output = String(value);
  if (!analysis?.ok) return output;
  for (const attribute of [
    analysis.headingAttribute,
    analysis.foreignAttribute,
  ]) {
    output = output.replace(
      new RegExp(`[\\t\\n\\f\\r ]+${attribute}=""`, "giu"),
      "",
    );
  }
  return output;
}

function wuiTokenHasAnalysisAttribute(token, attribute)
{
  return Boolean(
    token?.kind === "tag"
    && token.source.toLowerCase().includes(` ${attribute.toLowerCase()}=""`),
  );
}

function closingWuiOpaqueTag(input, opening)
{
  if (opening?.name === "plaintext") return null;
  if (!WUI_RAW_TEXT_TAGS.has(opening?.name))
    return matchingWuiHtmlClose(input, opening);

  const closingPattern = new RegExp(
    `</${opening.name}(?=[\\s>])`,
    "ig",
  );
  closingPattern.lastIndex = opening.end;
  let match;
  while ((match = closingPattern.exec(input)) !== null) {
    const token = wuiHtmlTagAt(input, match.index);
    if (token?.kind === "tag" && token.closing)
      return token;
    closingPattern.lastIndex = match.index + 2;
  }
  return null;
}

function wuiOpaqueRange(input, token, analysis)
{
  const closing = token.selfClosing
    ? token
    : closingWuiOpaqueTag(input, token);
  const end = closing?.end ?? input.length;
  const foreign = wuiTokenHasAnalysisAttribute(
    token,
    analysis?.foreignAttribute,
  );
  const containsActiveHeading = analysis?.ok
    && input.slice(token.end, end).toLowerCase().includes(
      ` ${analysis.headingAttribute.toLowerCase()}=""`,
    );
  return {
    end,
    protect: token.name === "template"
      ? !foreign
      : !foreign && !containsActiveHeading,
  };
}

function wuiDocumentBodyBoundary(input, analysis)
{
  const bodyOpaqueTags = new Set([...WUI_HEADING_OPAQUE_TAGS, "code"]);
  let opening = null;
  let scan = 0;
  let token;
  while ((token = nextWuiHtmlTag(input, scan))) {
    scan = token.end;
    if (token.kind !== "tag") continue;

    if (
      !token.closing
      && bodyOpaqueTags.has(token.name)
    ) {
      if (!WUI_HEADING_OPAQUE_TAGS.has(token.name)) {
        if (!token.selfClosing) {
          const closing = closingWuiOpaqueTag(input, token);
          scan = closing?.end ?? input.length;
        }
        continue;
      }
      const opaque = wuiOpaqueRange(input, token, analysis);
      if (opaque.protect) {
        scan = opaque.end;
        continue;
      }
    }
    if (!opening && !token.closing && token.name === "body") {
      opening = token;
      continue;
    }
    if (opening && token.closing && token.name === "body")
      return { opening, closing: token };
  }
  return null;
}

function protectWuiHeadingOpaqueHtml(
  input,
  markerPrefix,
  analysis,
)
{
  const opaqueHtml = [];
  let searchable = "";
  let cursor = 0;
  let scan = 0;
  let token;

  while ((token = nextWuiHtmlTag(input, scan))) {
    scan = token.end;
    let end = null;
    if (token.kind === "comment") {
      end = token.end;
    } else if (
      token.kind === "tag"
      && !token.closing
      && WUI_HEADING_OPAQUE_TAGS.has(token.name)
    ) {
      const opaque = wuiOpaqueRange(input, token, analysis);
      if (opaque.protect) end = opaque.end;
    }
    if (end == null) continue;

    const marker = `\0${markerPrefix}${opaqueHtml.length}\0`;
    searchable += input.slice(cursor, token.start) + marker;
    opaqueHtml.push({ marker, html: input.slice(token.start, end) });
    cursor = end;
    scan = end;
  }

  searchable += input.slice(cursor);
  return { searchable, opaqueHtml };
}

function wuiHtmlTagAttributeValue(token, expectedName)
{
  if (token?.kind !== "tag" || token.closing) return undefined;
  const input = token.source;
  const opening = input.match(/^<[^\s/>]+/);
  if (!opening) return undefined;
  let index = opening[0].length;

  while (index < input.length) {
    while (/\s/u.test(input[index] ?? "")) index++;
    if (input[index] === ">" || input[index] === "/" || index >= input.length)
      return undefined;

    const start = index;
    while (index < input.length && !/[\s=/>]/u.test(input[index])) index++;
    const name = input.slice(start, index).toLowerCase();
    while (/\s/u.test(input[index] ?? "")) index++;

    if (input[index] !== "=") {
      if (name === expectedName.toLowerCase()) return "";
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
      const value = input.slice(valueStart, index);
      if (input[index] === quote) index++;
      if (name === expectedName.toLowerCase()) return value;
    } else {
      while (index < input.length && !/[\s>]/u.test(input[index])) index++;
      if (name === expectedName.toLowerCase())
        return input.slice(valueStart, index);
    }
  }
  return undefined;
}

function wrapWuiHeadingToggleCharacter(headingHtml)
{
  const input = String(headingHtml);
  const opening = wuiHtmlTagAt(input, 0);
  if (
    opening?.kind !== "tag"
    || opening.closing
    || !/^h[1-6]$/.test(opening.name ?? "")
    || !wuiHtmlTagAttributeValue(opening, "id")
  ) return input;

  let index = opening.end;
  while (index < input.length) {
    if (input[index] === "\0") {
      const markerEnd = input.indexOf("\0", index + 1);
      if (markerEnd < 0) return input;
      index = markerEnd + 1;
      continue;
    }
    if (input[index] === "<") {
      const tag = wuiHtmlTagAt(input, index);
      if (!tag) return input;
      if (tag.kind === "other") {
        index++;
        continue;
      }
      index = tag.end;
      continue;
    }
    if (/\s/u.test(input[index])) {
      index++;
      continue;
    }

    let end;
    if (input[index] === "&") {
      const reference = readLeadingHtmlCharacterReference(
        input.slice(index),
      );
      if (reference && /^\s+$/u.test(reference.decoded)) {
        index += reference.source.length;
        continue;
      }
      end = index + (reference?.source.length ?? 1);
    } else {
      const grapheme = firstWuiGraphemeCluster(input.slice(index));
      end = index + grapheme.length;
    }
    return input.slice(0, index) +
      '<span class="mdcui-heading-toggle" role="button" tabindex="0" aria-expanded="true">' +
      input.slice(index, end) +
      "</span>" +
      input.slice(end);
  }
  return input;
}

export function wrapWuiHeadingSections(html)
{
  const analysis = analyzeWuiHeadingHtml(html);
  const input = analysis.html;
  const body = wuiDocumentBodyBoundary(input, analysis);
  if (body) {
    const contentStart = body.opening.end;
    const contentEnd = body.closing.start;
    return stripWuiAnalysisAttributes(
      input.slice(0, contentStart) +
      wrapWuiHeadingSections(input.slice(contentStart, contentEnd)) +
      input.slice(contentEnd),
      analysis,
    );
  }

  let markerPrefix = "MDCUI_HEADING_OPAQUE_";
  while (input.includes(markerPrefix)) markerPrefix = "_" + markerPrefix;
  const { searchable, opaqueHtml } =
    protectWuiHeadingOpaqueHtml(
      input,
      markerPrefix,
      analysis,
    );

  const voidTags = new Set([
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "param",
    "source",
    "track",
    "wbr",
  ]);
  const containers = [{ name: null, openLevels: [] }];
  let output = "";
  let cursor = 0;
  let scan = 0;
  let codeDepth = 0;
  let token;

  const closeContainerSections = (container, position) => {
    if (!container?.openLevels.length) return;
    output += searchable.slice(cursor, position);
    cursor = position;
    while (container.openLevels.length) {
      output += "</section>\n";
      container.openLevels.pop();
    }
  };

  while ((token = nextWuiHtmlTag(searchable, scan))) {
    scan = token.end;
    if (token.kind !== "tag") continue;

    if (token.closing) {
      let match = -1;
      for (let index = containers.length - 1; index > 0; index--) {
        if (containers[index].name === token.name) {
          match = index;
          break;
        }
      }
      if (match >= 0) {
        for (let index = containers.length - 1; index >= match; index--)
          closeContainerSections(containers[index], token.start);
        containers.length = match;
      }
      if (token.name === "code")
        codeDepth = Math.max(0, codeDepth - 1);
      continue;
    }

    const headingMatch = (
      codeDepth === 0
      && (
        !analysis.ok
        || wuiTokenHasAnalysisAttribute(
          token,
          analysis.headingAttribute,
        )
      )
    )
      ? token.name?.match(/^h([1-6])$/)
      : null;
    if (headingMatch) {
      const closing = matchingWuiHtmlClose(searchable, token);
      if (!closing) continue;

      const level = Number(headingMatch[1]);
      const headingHtml = wrapWuiHeadingToggleCharacter(
        searchable.slice(token.start, closing.end),
      );
      const container = containers.at(-1);
      output += searchable.slice(cursor, token.start);
      while (
        container.openLevels.length
        && container.openLevels.at(-1) >= level
      ) {
        output += "</section>\n";
        container.openLevels.pop();
      }
      output += `<section>\n${headingHtml}`;
      container.openLevels.push(level);
      cursor = closing.end;
      scan = closing.end;
      continue;
    }

    if (token.name === "code" && !token.selfClosing) codeDepth++;
    if (!token.selfClosing && !voidTags.has(token.name)) {
      containers.push({ name: token.name, openLevels: [] });
    }
  }

  for (let index = containers.length - 1; index >= 0; index--)
    closeContainerSections(containers[index], searchable.length);
  output += searchable.slice(cursor);
  for (const opaque of opaqueHtml) {
    output = output.replace(opaque.marker, opaque.html);
  }
  return stripWuiAnalysisAttributes(output, analysis);
}

export function convertWuiTableCheckboxes(html)
{
  return String(html ?? "").replace(
    /<table\b[^>]*>[\s\S]*?<\/table>/giu,
    table => table
      .replace(
        /^<table\b([^>]*)>/iu,
        (opening, attributes) =>
          /\bcontenteditable\s*=/iu.test(attributes)
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

export async function createWui(md,mdpath,{ bundling = false } = {}) // HTML
{
  const templates = renderMarkdownTemplateComponents(md, { mode: "wui" })
  md = templates.markdown
  const eventsById = fenceEventMap(md)
  
  md = renderMarkdownWithHeadingIds(md).html;
  md = wrapWuiTemplateComponents(md, templates.idStore)
  
  // Restore single quotes
  let reHrefs = /href="[^"]*?"/g  //  "
  md = md.replace( reHrefs,
    i=>i.replaceAll('&#x27;',"'")
  )
  
  
  md = md.replaceAll(
    'class="task-list-item-checkbox" disabled',
    'class="task-list-item-checkbox"'
  )
  md = convertWuiTableCheckboxes(md)

  const taskItemStart = '(<li\\b(?=[^>]*\\bclass="[^"]*\\btask-list-item\\b[^"]*")[^>]*>\\s*)'
  const taskCheckbox = '(<input\\b(?=[^>]*\\btype="checkbox")[^>]*>)'
  md = md.replace(
    new RegExp(taskItemStart + taskCheckbox + '([^<]*(?:<p>[^]*?<\\/p>[^<]*)*)', 'g'),
    (whole, itemStart, checkbox, content) => {
      if (!content.trim()) return whole
      return `${itemStart}<label>${checkbox}${content}</label>`
    }
  )

  md = convertWuiTextareas(md, eventsById)
  md = wrapWuiHeadingSections(md)
  
  const mdb = path.basename(mdpath);
  
  const responsiveImageStyle = `<style>
img {
  max-width: 100%;
  height: auto;
}

table {
  border-collapse: collapse;
}

th, td {
  border: 1px solid black;
  padding: 4px 8px;
}

th {
  background: #ddd;
}

tr:nth-child(even) {
  background: #ddd;
}

tr:hover {
  background: #ddddee;
}
</style>`;
  const moduleEntry = bundling ? `${mdb}.tmpfi.js` : `${mdb}.front.js`;
  const templatePayload = JSON.stringify(
    [...templates.idStore].map(([id, record]) => ({
      id,
      data: record.data,
      components: record.components.map(component => ({
        source: component.source,
        templateType: component.templateType,
        last: component.last,
        id: component.id,
        index: component.index,
        initialData: component.initialData,
      })),
    })),
  ).replaceAll("<", "\\u003c");
  const templateScript = `<scr`+`ipt type="application/json" id="mdcui-template-components">${templatePayload}</scr`+`ipt>`;
  const moduleScript = `<scr`+`ipt type="module" src="./${moduleEntry}"></scr`+`ipt>`;
  const isFullHtmlDocument = /^\s*<!doctype html>/i.test(md);
  if (!isFullHtmlDocument) {
    md = `<!doctype html>
<html lang="zh-TW">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtmlAttribute(mdb)}</title>
  ${responsiveImageStyle}
</head>
<body>
${md}
${templateScript}
${moduleScript}
</body>
</html>
`;
  } else {
    if (/<\/head\s*>/i.test(md)) {
      md = md.replace(/<\/head\s*>/i, `${responsiveImageStyle}\n</head>`);
    } else {
      md = `${responsiveImageStyle}\n${md}`;
    }
    if (/<\/body\s*>/i.test(md)) {
      md = md.replace(/<\/body\s*>/i, `${templateScript}\n${moduleScript}\n</body>`);
    } else {
      md += `\n${templateScript}\n${moduleScript}\n`;
    }
  }

  md = annotateWuiImageSources(md)
  
  await Bun.write(mdpath+".html",md)
  logWroteFile("html", mdpath+".html")

  return md;
}

function annotateWuiImageSources(html)
{
  return String(html).replace(/<img\b[^>]*>/gi, tag => {
    if (/\bdata-mdcui-src\s*=/i.test(tag)) return tag
    const src = tag.match(/\bsrc\s*=\s*(["'])(.*?)\1/i)
    if (!src) return tag
    const attribute = ` data-mdcui-src=${src[1]}${src[2]}${src[1]}`
    return tag.replace(/\s*\/?>$/, ending => `${attribute}${ending}`)
  })
}

export function charFromPoint(tui,row,col)
{
  tui = tui.split('\n')[row-1] || ""
  return Bun.sliceAnsi(tui,col-1,col)
}


if(import.meta.main)
  main().catch(e=>{
    console.error(e?.message || e)
    process.exit(127)
  });
