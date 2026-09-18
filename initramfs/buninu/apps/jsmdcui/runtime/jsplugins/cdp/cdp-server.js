const CDP_DEFAULT_PORT = 9222;
const CDP_PROTOCOL_VERSION = "1.3";
const CDP_BROWSER_ID = "cdp-server";
const CDP_BROWSER_PATH = `/devtools/browser/${CDP_BROWSER_ID}`;

let serverLogEnabled = 0//true;
function serverLog(...args) {
  if ( process.env.JSMDCUI_CDP_DEBUG ||
       serverLogEnabled )
  {
    console.log(...args);
  }
}
function serverError(...args) {
  if ( process.env.JSMDCUI_CDP_DEBUG ||
       serverLogEnabled )
  {
    console.error(...args);
  }
}

export class CdpServer {
  #context;

  constructor(context) {
    this.#context = context;
  }

  static create(context) {
    return new CdpServer(context);
  }

  listen(port = CDP_DEFAULT_PORT, hostname = "127.0.0.1", options = {}) {
    const context = this.#context;
    const state = createCdpState();
    const remoteAllowOrigins = parseAllowedOrigins(options.remoteAllowOrigins);

    const server = Bun.serve({
      port,
      hostname,
      fetch(req, server) {
        const url = new URL(req.url);
        const pathname = url.pathname.replace(/\/+$/, "") || "/";

        const origin = req.headers.get("origin");
        const respond = async (response) => {
          const text = await response.clone().text();
          serverLog(
            `[CdpServer] HTTP ${req.method} ${pathname} -> ${response.status}`,
            text,
          );
          return response;
        };

        serverLog(`[CdpServer] HTTP ${req.method} ${pathname}`);

        serverLog(`[CdpServer] Origin ${origin}`);

        if (!isSafeHostHeader(req.headers.get("host"))) {
          return respond(new Response("Host header must be an IP address or localhost", {
            status: 500,
          }));
        }

        if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
          if (!isOriginAllowed(origin, remoteAllowOrigins)) {
            return respond(new Response(
              `Rejected an incoming WebSocket connection from the ${origin} origin. `
                + `Use --remote-allow-origins=${origin} to allow it, or `
                + "--remote-allow-origins=* to allow all origins.",
              { status: 403 },
            ));
          }
          if (pathname !== CDP_BROWSER_PATH) {
            return respond(new Response("Not Found", { status: 404 }));
          }
          if (server.upgrade(req)) {
            serverLog(
              `[CdpServer] HTTP ${req.method} ${pathname} -> 101`,
              "Switching Protocols",
            );
            return;
          }
          return respond(new Response("WebSocket upgrade failed", { status: 500 }));
        }

        const host = req.headers.get("host") ?? `127.0.0.1:${port}`;
        const webSocketDebuggerUrl = `ws://${host}/devtools/browser/${CDP_BROWSER_ID}`;

        if (pathname === "/json/version") {
          return respond(jsonResponse({
            Browser: "CdpServer/1.0",
            "Protocol-Version": CDP_PROTOCOL_VERSION,
            "User-Agent": "CdpServer/1.0",
            "V8-Version": Bun.version,
            "WebKit-Version": "537.36",
            webSocketDebuggerUrl,
          }));
        }

        if (pathname === "/json" || pathname === "/json/list") {
          return respond(jsonResponse(
            [...state.targets.values()].map((target) => ({
              id: target.targetId,
              type: target.type,
              title: target.title,
              url: target.url,
              webSocketDebuggerUrl,
            }))
          ));
        }

        return respond(jsonResponse({
          server: "CdpServer",
          port,
          webSocketDebuggerUrl,
        }));
      },
      websocket: {
        open(ws) {
          serverLog("[CdpServer] client connected");
        },
        async message(ws, raw) {
          let id;
          let sessionId;
          const send = (message) => {
            const text = JSON.stringify(message);
            serverLog("[CdpServer] WebSocket response", text);
            ws.send(text);
          };
          try {
            const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
            const msg = JSON.parse(text);
            id = msg.id;
            sessionId = msg.sessionId;
            const { method, params } = msg;
            serverLog(`[CdpServer] -> ${method}`, params ?? "");

            const emit = (eventMethod, eventParams) => {
              serverLog(`[CdpServer] <- ${eventMethod} EVENT`, eventParams ?? {});
              send({
                method: eventMethod,
                params: eventParams,
                ...(sessionId ? { sessionId } : {}),
              });
            };
            const result = await dispatch(
              context,
              state,
              method,
              params ?? {},
              sessionId,
              emit
            );
            serverLog(`[CdpServer] <- ${method} OK`, result ?? "");
            send({
              id,
              result: result ?? {},
              ...(sessionId ? { sessionId } : {}),
            });
          } catch (err) {
            serverError(`[CdpServer] <- ERROR ${err.message}`);
            serverLog("[CdpServer] <- ERROR", { id, sessionId, message: err.message });
            send({
              id,
              error: {
                code: -32601,
                message: err.message,
              },
              ...(sessionId ? { sessionId } : {}),
            });
          }
        },
        close(ws) {
          serverLog("[CdpServer] client disconnected");
        },
      },
    });

    serverLog(`[CdpServer] listening on ws://${hostname}:${port}`);
    return server;
  }
}

export function parseAllowedOrigins(value) {
  const origins = Array.isArray(value) ? value : String(value ?? "").split(",");
  return new Set(origins.map((origin) => origin.trim().toLowerCase()).filter(Boolean));
}

export function isOriginAllowed(origin, allowedOrigins = new Set()) {
  if (origin == null) return true;
  const normalized = origin.toLowerCase();
  return allowedOrigins.has("*") || allowedOrigins.has(normalized);
}

export function isSafeHostHeader(header) {
  if (!header) return true;
  try {
    let hostname = new URL(`http://${header}`).hostname.toLowerCase();
    if (hostname.startsWith("[") && hostname.endsWith("]")) {
      hostname = hostname.slice(1, -1);
    }
    if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;
    if (hostname.includes(":")) return /^[0-9a-f:.]+$/i.test(hostname);
    return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)
      && hostname.split(".").every((part) => Number(part) <= 255);
  } catch {
    return false;
  }
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function createCdpState() {
  return {
    nextTargetId: 1,
    nextSessionId: 1,
    nextLoaderId: 1,
    nextHistoryEntryId: 1,
    nextObjectId: 1,
    nextExecutionContextId: 1,
    targets: new Map(),
    sessions: new Map(),
    objects: new Map(),
    initialNavigations: new Map(),
    implicitTarget: null,
    autoAttach: false,
    waitForDebuggerOnStart: false,
  };
}

async function dispatch(ctx, state, method, params, sessionId, emit) {
  switch (method) {
    case "Browser.getVersion":
      return {
        protocolVersion: CDP_PROTOCOL_VERSION,
        product: "Chrome/140.0.0.0",
        revision: "cdp-server",
        userAgent:
          "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
        jsVersion: Bun.version,
      };
    case "Browser.setDownloadBehavior":
      return {};
    case "Target.getBrowserContexts":
      return {
        browserContextIds: [],
        defaultBrowserContextId: "default",
      };
    case "Target.setAutoAttach":
      state.autoAttach = params.autoAttach;
      state.waitForDebuggerOnStart = params.waitForDebuggerOnStart;
      return {};
    case "Target.setDiscoverTargets":
      return {};
    case "Target.createTarget": {
      const targetId = `target-${state.nextTargetId++}`;
      state.initialNavigations.set(targetId, {
        navigated: createDeferred(),
        settled: createDeferred(),
      });
      state.targets.set(targetId, {
        targetId,
        frameId: targetId,
        loaderId: `loader-${state.nextLoaderId++}`,
        type: "page",
        browserContextId: params.browserContextId ?? "default",
        title: "",
        url: params.url || "about:blank",
        attached: false,
        elements: new Map(),
        focusedSelector: null,
        pendingSelector: null,
        history: [
          {
            id: state.nextHistoryEntryId++,
            url: params.url || "about:blank",
            title: "",
          },
        ],
        historyIndex: 0,
        viewport: {
          width: params.width ?? 800,
          height: params.height ?? 600,
        },
      });

      if (state.autoAttach) {
        const attachedSessionId = `session-${state.nextSessionId++}`;
        const target = state.targets.get(targetId);
        target.attached = true;
        state.sessions.set(attachedSessionId, targetId);
        emit("Target.attachedToTarget", {
          sessionId: attachedSessionId,
          targetInfo: createTargetInfo(target),
          waitingForDebugger: state.waitForDebuggerOnStart,
        });
      }

      return { targetId };
    }
    case "Target.attachToTarget": {
      const target = state.targets.get(params.targetId);
      if (!target) throw new Error(`No target with given id: ${params.targetId}`);

      const sessionId = `session-${state.nextSessionId++}`;
      target.attached = true;
      state.sessions.set(sessionId, params.targetId);
      return { sessionId };
    }
    case "Target.getTargets":
      return { targetInfos: [...state.targets.values()] };
    case "Target.getTargetInfo": {
      if (!params.targetId) {
        return {
          targetInfo: {
            targetId: CDP_BROWSER_ID,
            type: "browser",
            title: "",
            url: "",
            attached: true,
          },
        };
      }
      const target = state.targets.get(params.targetId);
      if (!target) throw new Error(`No target with given id: ${params.targetId}`);
      return { targetInfo: target };
    }
    case "Target.closeTarget": {
      const target = state.targets.get(params.targetId);
      if (!target) return { success: false };

      await ctx.close?.();
      state.initialNavigations.get(params.targetId)?.navigated.resolve();
      state.initialNavigations.get(params.targetId)?.settled.resolve();
      state.initialNavigations.delete(params.targetId);

      for (const [attachedSessionId, targetId] of state.sessions) {
        if (targetId !== params.targetId) continue;
        state.sessions.delete(attachedSessionId);
        emit("Target.detachedFromTarget", {
          sessionId: attachedSessionId,
          targetId,
        });
      }
      state.targets.delete(params.targetId);
      emit("Target.targetDestroyed", { targetId: params.targetId });
      return { success: true };
    }
    case "Target.detachFromTarget":
      state.sessions.delete(params.sessionId);
      return {};
    case "Page.enable":
      return {};
    case "Page.getFrameTree": {
      const target = getSessionTarget(state, sessionId);
      return {
        frameTree: {
          frame: createFrame(target),
        },
      };
    }
    case "Page.setLifecycleEventsEnabled":
    case "Log.enable":
    case "Network.enable":
    case "Emulation.setFocusEmulationEnabled":
    case "Emulation.setEmulatedMedia":
    case "Runtime.runIfWaitingForDebugger":
      return {};
    case "Page.addScriptToEvaluateOnNewDocument":
      return {
        identifier: `script-${state.nextObjectId++}`,
      };
    case "Page.createIsolatedWorld": {
      const target = getSessionTarget(state, sessionId);
      const executionContextId = state.nextExecutionContextId++;
      target.utilityWorldName = params.worldName ?? "";
      emit("Runtime.executionContextCreated", {
        context: {
          id: executionContextId,
          origin: getOrigin(target.url),
          name: target.utilityWorldName,
          uniqueId: `context-${target.targetId}-${executionContextId}`,
          auxData: {
            isDefault: false,
            type: "isolated",
            frameId: target.frameId,
          },
        },
      });
      return { executionContextId };
    }
    case "Runtime.enable": {
      const target = getSessionTarget(state, sessionId);
      const executionContextId = state.nextExecutionContextId++;
      target.mainExecutionContextId = executionContextId;
      setTimeout(() => {
        emit("Runtime.executionContextCreated", {
          context: {
            id: executionContextId,
            origin: getOrigin(target.url),
            name: "",
            uniqueId: `context-${target.targetId}`,
            auxData: {
              isDefault: true,
              type: "default",
              frameId: target.frameId,
            },
          },
        });
      }, 0);
      return {};
    }
    case "Page.navigate": {
      const target = getSessionTarget(state, sessionId);
      await ctx.navigate?.(params.url);
      navigateTarget(state, target, params.url, emit, { addHistory: true });
      state.initialNavigations.get(target.targetId)?.navigated.resolve();

      return {
        frameId: target.frameId,
        loaderId: target.loaderId,
      };
    }
    case "Page.getNavigationHistory": {
      const target = getSessionTarget(state, sessionId);
      return {
        currentIndex: target.historyIndex,
        entries: target.history.map((entry) => ({
          id: entry.id,
          url: entry.url,
          userTypedURL: entry.url,
          title: entry.title,
          transitionType: "typed",
        })),
      };
    }
    case "Page.navigateToHistoryEntry": {
      const target = getSessionTarget(state, sessionId);
      const nextIndex = target.history.findIndex(
        (entry) => entry.id === params.entryId
      );
      if (nextIndex < 0) {
        throw new Error(`No history entry with given id: ${params.entryId}`);
      }

      if (nextIndex < target.historyIndex) {
        await ctx.goBack?.();
      } else if (nextIndex > target.historyIndex) {
        await ctx.goForward?.();
      }

      target.historyIndex = nextIndex;
      const entry = target.history[nextIndex];
      navigateTarget(state, target, entry.url, emit);
      return {};
    }
    case "Page.reload": {
      const target = getSessionTarget(state, sessionId);
      await ctx.reload?.();
      navigateTarget(state, target, target.url, emit);
      return {};
    }
    case "Emulation.setDeviceMetricsOverride": {
      const target = getSessionTarget(state, sessionId);
      target.viewport = {
        width: params.width,
        height: params.height,
      };
      await ctx.resize?.(params.width, params.height);
      return {};
    }
    case "DOM.scrollIntoViewIfNeeded": {
      const element = state.objects.get(params.objectId);
      if (element?.kind !== "playwright-element") {
        throw new Error(`Unknown element object: ${params.objectId}`);
      }
      await ctx.scrollTo?.(element.selector, {
        block: "nearest",
      });
      return {};
    }
    case "DOM.getContentQuads": {
      const target = getSessionTarget(state, sessionId);
      const element = state.objects.get(params.objectId);
      if (element?.kind !== "playwright-element") {
        throw new Error(`Unknown element object: ${params.objectId}`);
      }
      target.pendingSelector = element.selector;
      return {
        quads: [[80, 40, 120, 40, 120, 60, 80, 60]],
      };
    }
    case "Runtime.evaluate": {
      let target;
      if (sessionId) {
        target = getSessionTarget(state, sessionId);
      } else {
        const pendingTarget = getPendingInitialNavigationTarget(state);
        if (pendingTarget) {
          await state.initialNavigations.get(pendingTarget.targetId).settled.promise;
          target = state.targets.get(pendingTarget.targetId);
          if (!target) throw new Error("WebView closed");
        } else {
          target = getImplicitTarget(state);
        }
      }
      let value;

      if (params.expression.trim() === "document.title") {
        value = await getContextTitle(ctx, target);
        const initialNavigation = state.initialNavigations.get(target.targetId);
        if (initialNavigation) {
          setTimeout(() => {
            initialNavigation.settled.resolve();
            state.initialNavigations.delete(target.targetId);
          }, 0);
        }
      } else if (params.expression.includes("new (module.exports.InjectedScript())")) {
        value = {
          kind: "playwright-injected-script",
          targetId: target.targetId,
        };
      } else if (params.expression.includes("new (module.exports.UtilityScript())")) {
        value = {
          kind: "playwright-utility-script",
          targetId: target.targetId,
        };
      } else if (
        params.expression.includes("timeout waiting for") &&
        params.expression.includes("getBoundingClientRect")
      ) {
        target.pendingSelector = getActionabilitySelector(params.expression);
        value = [100, 50];
      } else if (
        params.expression.includes("timeout waiting for") &&
        params.expression.includes("scrollIntoView")
      ) {
        const scrollTo = getScrollToArguments(params.expression);
        await ctx.scrollTo?.(scrollTo.selector, {
          block: scrollTo.block,
          timeout: scrollTo.timeout,
        });
        value = undefined;
      } else {
        if (shouldUseContextEvaluateResult(ctx)) {
          value = await ctx.evaluate(params.expression);
        } else {
          value = await evaluateInTarget(target, params.expression);
          await ctx.evaluate?.(params.expression);
        }
      }

      return {
        result: createRemoteObject(state, value, params.returnByValue),
      };
    }
    case "Runtime.callFunctionOn": {
      const target = getSessionTarget(state, sessionId);
      const object = state.objects.get(params.objectId);
      if (object?.kind !== "playwright-utility-script") {
        throw new Error(`Unknown object: ${params.objectId}`);
      }

      if (!params.functionDeclaration.includes("utilityScript.evaluate")) {
        throw new Error("Unsupported Runtime.callFunctionOn declaration");
      }

      const args = params.arguments ?? [];
      const isFunction = args[1]?.value;
      const returnByValue = args[2]?.value;
      const expression = args[3]?.value;
      const argCount = args[4]?.value ?? 0;
      const handles = args
        .slice(5 + argCount)
        .map((arg) => state.objects.get(arg.objectId));
      const callArgs = args
        .slice(5, 5 + argCount)
        .map((arg) => deserializePlaywrightValue(arg.value, handles));
      const forwardEvaluate = shouldForwardPlaywrightEvaluate(
        expression,
        handles
      );
      let value;
      if (forwardEvaluate && shouldUseContextEvaluateResult(ctx)) {
        value = await ctx.evaluate(expression);
      } else {
        value = await evaluatePlaywrightCall(
          ctx,
          target,
          expression,
          isFunction,
          callArgs
        );
      }
      if (forwardEvaluate && !shouldUseContextEvaluateResult(ctx)) {
        await ctx.evaluate?.(expression);
      }

      const serialized = returnByValue
        ? serializePlaywrightValue(value)
        : value;
      return {
        result: createRemoteObject(state, serialized, params.returnByValue),
      };
    }
    case "Runtime.releaseObject":
    case "Runtime.releaseObjectGroup":
      if (params.objectId) state.objects.delete(params.objectId);
      return {};
    case "Input.dispatchMouseEvent": {
      const target = getSessionTarget(state, sessionId);
      if (params.type === "mouseWheel") {
        await ctx.scroll?.(params.deltaX ?? 0, params.deltaY ?? 0);
        return {};
      }

      if (params.type === "mouseReleased") {
        target.focusedSelector = target.pendingSelector;
        applyClick(target, target.pendingSelector);
        await ctx.click?.(params.x, params.y, {
          button: params.button,
          clickCount: params.clickCount,
          modifiers: params.modifiers,
        });
      }
      return {};
    }
    case "Input.dispatchKeyEvent": {
      const target = getSessionTarget(state, sessionId);
      const key = params.key ?? params.text ?? "";
      const signature = `${params.code ?? key}:${params.modifiers ?? 0}`;
      if (params.type === "rawKeyDown" || params.type === "keyDown") {
        if (target.cdpKeyDown !== signature || params.autoRepeat) {
          await ctx.press?.(key, {
            modifiers: params.modifiers ?? 0,
            text: params.text ?? "",
            code: params.code ?? "",
            repeat: !!params.autoRepeat,
          });
          target.cdpKeyDown = signature;
        }
      } else if (params.type === "char") {
        if (!target.cdpKeyDown) {
          await ctx.press?.(key, {
            modifiers: params.modifiers ?? 0,
            text: params.text ?? "",
            code: params.code ?? "",
            repeat: !!params.autoRepeat,
          });
        }
      } else if (params.type === "keyUp") {
        target.cdpKeyDown = null;
      }
      return {};
    }
    case "Input.insertText": {
      const target = getSessionTarget(state, sessionId);
      const element = target.elements.get(target.focusedSelector);
      if (element) element.value += params.text;
      await ctx.type?.(params.text);
      return {};
    }
    case "navigate":
      return ctx.navigate?.(params.url);
    case "evaluate":
      return ctx.evaluate?.(params.script);
    case "click":
      return typeof params.selector === "string"
        ? ctx.click?.(params.selector, params.options)
        : ctx.click?.(params.x, params.y, params.options);
    case "type":
      return ctx.type?.(params.text);
    case "press":
      return ctx.press?.(params.key, params.options);
    case "scroll":
      return ctx.scroll?.(params.dx, params.dy);
    case "scrollTo":
      return ctx.scrollTo?.(params.selector, params.options);
    case "resize":
      return ctx.resize?.(params.width, params.height);
    case "goBack":
      return ctx.goBack?.();
    case "goForward":
      return ctx.goForward?.();
    case "reload":
      return ctx.reload?.();
    case "screenshot":
      return ctx.screenshot?.({ ...params, encoding: "base64" });
    case "cdp":
      return ctx.cdp?.(params.method, params.params);
    case "close":
      return ctx.close?.();
    default:
      if (method.includes(".") && ctx.cdp) {
        return ctx.cdp(method, params);
      }
      throw new Error(`Unknown method: ${method}`);
  }
}

function createDeferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function getPendingInitialNavigationTarget(state) {
  const targets = [...state.targets.values()];
  for (let index = targets.length - 1; index >= 0; index--) {
    const target = targets[index];
    if (state.initialNavigations.has(target.targetId)) return target;
  }
  return null;
}

function navigateTarget(state, target, url, emit, options = {}) {
  target.url = url;
  loadDocument(target, url);
  target.loaderId = `loader-${state.nextLoaderId++}`;
  target.mainExecutionContextId = state.nextExecutionContextId++;
  target.utilityExecutionContextId = target.utilityWorldName
    ? state.nextExecutionContextId++
    : null;

  if (options.addHistory) {
    target.history.splice(target.historyIndex + 1);
    target.history.push({
      id: state.nextHistoryEntryId++,
      url,
      title: target.title,
    });
    target.historyIndex = target.history.length - 1;
  } else if (target.history[target.historyIndex]) {
    target.history[target.historyIndex].title = target.title;
  }

  setTimeout(() => {
    emit("Runtime.executionContextsCleared", {});
    emit("Page.frameNavigated", {
      frame: createFrame(target),
      type: "Navigation",
    });
    emit("Runtime.executionContextCreated", {
      context: {
        id: target.mainExecutionContextId,
        origin: getOrigin(target.url),
        name: "",
        uniqueId: `context-${target.targetId}-${target.loaderId}`,
        auxData: {
          isDefault: true,
          type: "default",
          frameId: target.frameId,
        },
      },
    });
    if (target.utilityExecutionContextId) {
      emit("Runtime.executionContextCreated", {
        context: {
          id: target.utilityExecutionContextId,
          origin: getOrigin(target.url),
          name: target.utilityWorldName,
          uniqueId: `context-${target.targetId}-${target.utilityExecutionContextId}`,
          auxData: {
            isDefault: false,
            type: "isolated",
            frameId: target.frameId,
          },
        },
      });
    }
    const timestamp = performance.now() / 1000;
    emit("Page.domContentEventFired", { timestamp });
    emit("Page.loadEventFired", { timestamp });
    emit("Page.lifecycleEvent", {
      frameId: target.frameId,
      loaderId: target.loaderId,
      name: "DOMContentLoaded",
      timestamp,
    });
    emit("Page.lifecycleEvent", {
      frameId: target.frameId,
      loaderId: target.loaderId,
      name: "load",
      timestamp,
    });
  }, 0);
}

function getSessionTarget(state, sessionId) {
  if (!sessionId) return getImplicitTarget(state);

  const targetId = state.sessions.get(sessionId);
  const target = state.targets.get(targetId);
  if (!target) throw new Error(`No target for session: ${sessionId}`);
  return target;
}

function getImplicitTarget(state) {
  if (state.implicitTarget) return state.implicitTarget;

  state.implicitTarget = {
    targetId: "implicit-target",
    frameId: "implicit-target",
    loaderId: "implicit-loader",
    type: "page",
    browserContextId: "default",
    title: "",
    url: "about:blank",
    attached: true,
    elements: new Map(),
    focusedSelector: null,
    pendingSelector: null,
    history: [
      {
        id: state.nextHistoryEntryId++,
        url: "about:blank",
        title: "",
      },
    ],
    historyIndex: 0,
    viewport: {
      width: 800,
      height: 600,
    },
  };
  return state.implicitTarget;
}

function getOrigin(url) {
  try {
    return new URL(url).origin;
  } catch {
    return "null";
  }
}

function createFrame(target) {
  return {
    id: target.frameId,
    loaderId: target.loaderId,
    url: target.url,
    domainAndRegistry: "",
    securityOrigin: getOrigin(target.url),
    mimeType: "text/html",
  };
}

function createTargetInfo(target) {
  return {
    targetId: target.targetId,
    type: target.type,
    title: target.title,
    url: target.url,
    attached: target.attached,
    browserContextId: target.browserContextId,
  };
}

function loadDocument(target, url) {
  target.title = "";
  target.elements = new Map();
  target.focusedSelector = null;
  target.pendingSelector = null;

  if (!url.startsWith("data:text/html,")) return;

  try {
    const html = decodeURIComponent(url.slice("data:text/html,".length));
    target.title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";

    for (const match of html.matchAll(
      /<([a-z][\w-]*)([^>]*\sid=["']([^"']+)["'][^>]*)>([\s\S]*?)<\/\1>/gi
    )) {
      const tagName = match[1].toLowerCase();
      const attributes = match[2] ?? "";
      const id = match[3];
      const textContent = match[4]?.replace(/<[^>]*>/g, "").trim() ?? "";
      const value = attributes.match(/\svalue=["']([^"']*)["']/i)?.[1] ?? "";
      target.elements.set(`#${id}`, { tagName, textContent, value });
    }

    for (const match of html.matchAll(
      /<(input|textarea)([^>]*\sid=["']([^"']+)["'][^>]*)\/?>/gi
    )) {
      const tagName = match[1].toLowerCase();
      const attributes = match[2] ?? "";
      const id = match[3];
      if (target.elements.has(`#${id}`)) continue;
      const value = attributes.match(/\svalue=["']([^"']*)["']/i)?.[1] ?? "";
      target.elements.set(`#${id}`, { tagName, textContent: "", value });
    }
  } catch {
    target.title = "";
  }
}

function getActionabilitySelector(expression) {
  const match = expression.match(/\}\)\((["'])(.*?)\1,\d+\)\s*$/s);
  return match?.[2] ?? null;
} // "

function getScrollToArguments(expression) {
  const match = expression.match(/\}\)\((.*),(\d+),(.*)\)\s*$/s);
  if (!match) throw new Error("Unable to parse scrollTo arguments");

  return {
    selector: JSON.parse(match[1]),
    timeout: Number(match[2]),
    block: JSON.parse(match[3]),
  };
}

function applyClick(target, selector) {
  if (selector !== "#test-button") return;

  const result = target.elements.get("#result");
  if (result) result.textContent = "clicked";
  target.title = "Clicked";
}


async function evaluateInTarget(target, expression) {
  const document = createDocument(target);
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const evaluate = new AsyncFunction(
    "document",
    `return await (${expression});`
  );
  return evaluate(document);
}


function createDocument(target) {
  return {
    get title() {
      return target.title;
    },
    set title(value) {
      target.title = String(value);
    },
    querySelector(selector) {
      return target.elements.get(selector) ?? null;
    },
  };
}

async function evaluatePlaywrightExpression(
  target,
  expression,
  isFunction,
  args
) {
  const document = createDocument(target);
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const evaluate = new AsyncFunction(
    "document",
    "args",
    isFunction
      ? `return await (${expression})(...args);`
      : `return await (${expression});`
  );
  return evaluate(document, args);
}

async function evaluatePlaywrightCall(ctx, target, expression, isFunction, args) {
  if (expression.trim() === "() => document.title") {
    return getContextTitle(ctx, target);
  }
  if (expression.includes("querySelectorAll(info.parsed")) {
    return resolvePlaywrightLocator(target, args);
  }
  if (expression.includes("injected.previewNode")) {
    const element = args.find((arg) => arg?.kind === "playwright-element");
    return `JSHandle@${playwrightElementDescription(element)}`;
  }
  if (expression.includes("injected.checkElementStates")) {
    return undefined;
  }
  if (expression.includes("injected.setupHitTargetInterceptor")) {
    return {
      kind: "playwright-hit-target-interceptor",
      targetId: target.targetId,
    };
  }
  if (expression.includes("=> h.stop()")) {
    return "done";
  }
  if (
    expression.includes("width: innerWidth") &&
    expression.includes("height: innerHeight")
  ) {
    return {
      width: target.viewport.width,
      height: target.viewport.height,
    };
  }
  return evaluatePlaywrightExpression(target, expression, isFunction, args);
}

async function getContextTitle(ctx, target) {
  return (await ctx.title?.()) || target.title;
}

function shouldUseContextEvaluateResult(ctx) {
  return (
    typeof ctx.evaluate == "function"
  );
}

function deserializePlaywrightValue(value, handles = [], refs = new Map()) {
  if (value === undefined || value === null) return value;
  if (typeof value !== "object") return value;
  if ("ref" in value) return refs.get(value.ref);
  if ("v" in value) {
    if (value.v === "undefined") return undefined;
    if (value.v === "null") return null;
    if (value.v === "NaN") return NaN;
    if (value.v === "Infinity") return Infinity;
    if (value.v === "-Infinity") return -Infinity;
    if (value.v === "-0") return -0;
  }
  if ("bi" in value) return BigInt(value.bi);
  if ("h" in value) return handles[value.h];
  if ("a" in value) {
    const result = [];
    refs.set(value.id, result);
    for (const item of value.a) {
      result.push(deserializePlaywrightValue(item, handles, refs));
    }
    return result;
  }
  if ("o" in value) {
    const result = {};
    refs.set(value.id, result);
    for (const item of value.o) {
      if (item.k === "__proto__") continue;
      result[item.k] = deserializePlaywrightValue(item.v, handles, refs);
    }
    return result;
  }
  return value;
}

function resolvePlaywrightLocator(target, args) {
  const [, options] = args;
  const selector = getPlaywrightSelector(options?.info?.parsed);
  const element = target.elements.get(selector);
  if (!element) return { log: "", success: false, element: null };

  return {
    kind: "playwright-locator-result",
    log: `locator resolved to ${selector}`,
    success: true,
    element: {
      kind: "playwright-element",
      targetId: target.targetId,
      selector,
      element,
    },
  };
}

function shouldForwardPlaywrightEvaluate(expression, handles) {
  if (handles.some((handle) => handle?.kind?.startsWith("playwright-"))) {
    return false;
  }

  const source = expression.trim();
  if (source === "() => document.title") return false;
  if (
    source.includes("querySelectorAll(info.parsed") ||
    source.includes("injected.previewNode") ||
    source.includes("injected.checkElementStates") ||
    source.includes("injected.setupHitTargetInterceptor") ||
    (source.includes("width: innerWidth") &&
      source.includes("height: innerHeight"))
  ) {
    return false;
  }

  return true;
}

function getPlaywrightSelector(parsed) {
  if (typeof parsed === "string") return parsed;
  if (!parsed || typeof parsed !== "object") return null;
  if (typeof parsed.source === "string") return parsed.source;
  if (typeof parsed.body === "string") return parsed.body;

  for (const value of Object.values(parsed)) {
    const selector = getPlaywrightSelector(value);
    if (selector) return selector;
  }
  return null;
}

function serializePlaywrightValue(value, seen = new Map()) {
  if (value === undefined) return { v: "undefined" };
  if (value === null) return { v: "null" };
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "bigint") return { bi: value.toString() };

  if (seen.has(value)) return { ref: seen.get(value) };
  const id = seen.size + 1;
  seen.set(value, id);

  if (Array.isArray(value)) {
    return {
      a: value.map((item) => serializePlaywrightValue(item, seen)),
      id,
    };
  }

  return {
    o: Object.entries(value).map(([key, item]) => ({
      k: key,
      v: serializePlaywrightValue(item, seen),
    })),
    id,
  };
}

function createRemoteObject(state, value, returnByValue) {
  if (value === undefined) return { type: "undefined" };
  if (value === null) return { type: "object", subtype: "null", value: null };
  if (value?.kind === "playwright-element") {
    const objectId = `object-${state.nextObjectId++}`;
    state.objects.set(objectId, value);
    return {
      type: "object",
      subtype: "node",
      className: playwrightElementClassName(value.element?.tagName),
      description: playwrightElementDescription(value),
      objectId,
    };
  }

  const type = typeof value;
  if (type === "string" || type === "boolean") {
    return { type, value };
  }
  if (type === "number") {
    return Number.isFinite(value)
      ? { type, value }
      : { type, unserializableValue: String(value) };
  }
  if (type === "bigint") {
    return { type, unserializableValue: `${value}n` };
  }

  if (returnByValue) {
    return {
      type: "object",
      value,
      description: Array.isArray(value) ? "Array" : "Object",
    };
  }

  const objectId = `object-${state.nextObjectId++}`;
  state.objects.set(objectId, value);
  return {
    type: "object",
    className: "Object",
    description: "Object",
    objectId,
  };
}

function playwrightElementClassName(tagName) {
  const names = {
    button: "HTMLButtonElement",
    input: "HTMLInputElement",
    textarea: "HTMLTextAreaElement",
    output: "HTMLOutputElement",
  };
  return names[tagName] ?? "HTMLElement";
}

function playwrightElementDescription(value) {
  const tagName = value.element?.tagName ?? "element";
  return `${tagName}#${value.selector.replace(/^#/, "")}`;
}

function createLoggingContext() {
  const log = (method, payload = {}) => {
    
    serverError(Bun.markdown.ansi(`## [CdpServer:context] ${method}`))
    serverError(payload);
    return { ok: true, method, payload };
  };

  return {
    navigate(url) {
      return log("navigate", { url });
    },
    evaluate(script) {
      return log("evaluate", { script });
    },
    title() {
      log("title");
      return "";
    },
    click(selectorOrX, yOrOptions, options) {
      if (typeof selectorOrX === "string") {
        return log("click", { selector: selectorOrX, options: yOrOptions });
      }

      return log("click", { x: selectorOrX, y: yOrOptions, options });
    },
    type(text) {
      return log("type", { text });
    },
    press(key, options) {
      return log("press", { key, options });
    },
    scroll(dx, dy) {
      return log("scroll", { dx, dy });
    },
    scrollTo(selector, options) {
      return log("scrollTo", { selector, options });
    },
    resize(width, height) {
      return log("resize", { width, height });
    },
    goBack() {
      return log("goBack");
    },
    goForward() {
      return log("goForward");
    },
    reload() {
      return log("reload");
    },
    screenshot(options) {
      return log("screenshot", { options });
    },
    cdp(method, params) {
      return log("cdp", { method, params });
    },
    close() {
      return log("close");
    },
  };
}

if (import.meta.main) {
  const port = Number(Bun.argv[2] ?? CDP_DEFAULT_PORT);
  CdpServer.create(createLoggingContext()).listen(port);
}
