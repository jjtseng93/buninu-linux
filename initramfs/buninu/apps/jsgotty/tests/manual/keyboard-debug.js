// Manually loaded diagnostic helper. Never loaded by the production frontend.
window.startGottyKeyboardDebug = ({ endpoint, term } = {}) => {
  window.stopGottyKeyboardDebug?.();
  term ??= Array.from(document.querySelectorAll("*")).find(el => el.__gottyXterm)?.__gottyXterm;
  if (!term) throw new Error("No jsgotty xterm found; connect the terminal first.");
  const listeners = [];
  let stopped = false;
  const records = [];
  const started = Date.now();
  const session = Math.random().toString(36).slice(2);
  window.__gottyKeyboardRecords = records;
  window.__gottyKeyboardDebug = (stage, details = {}) => {
    if (stopped || records.length >= 2000 || Date.now() - started > 600000) return;
    const record = { session, sequence: records.length, time: new Date().toISOString(), stage, ...details };
    records.push(record);
    console.log("[gotty-keyboard]", record);
    if (endpoint) fetch(endpoint, {
      method: "POST", headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(record),
    }).catch(error => { window.__gottyKeyboardDeliveryError = String(error); });
  };
  window.__gottyKeyboardDebug("ready", {
    userAgent: navigator.userAgent, platform: navigator.platform,
    userAgentData: navigator.userAgentData?.platform,
  });
  for (const type of ["keydown", "keypress", "keyup", "beforeinput", "input",
    "compositionstart", "compositionupdate", "compositionend"]) {
    const listener = event => {
      const details = {
        type, key: event.key, code: event.code, keyCode: event.keyCode,
        charCode: event.charCode, which: event.which, altKey: event.altKey,
        ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey,
        altGraph: event.getModifierState?.("AltGraph"),
        isComposing: event.isComposing, repeat: event.repeat,
        cancelable: event.cancelable, defaultPrevented: event.defaultPrevented,
        inputType: event.inputType, data: event.data?.slice(0, 64),
        target: event.target?.tagName, trusted: event.isTrusted,
      };
      window.__gottyKeyboardDebug("capture", details);
      setTimeout(() => window.__gottyKeyboardDebug("after-dispatch", {
        ...details, defaultPrevented: event.defaultPrevented,
      }));
    };
    window.addEventListener(type, listener, true);
    listeners.push([type, listener]);
  }
  // Preserve the existing Android handler, including its return value.
  const previousHandler = term._core?._customKeyEventHandler;
  if (!term._core) throw new Error("Unsupported xterm internals");
  const handler = event => {
    const result = previousHandler ? previousHandler.call(term._core, event) : true;
    window.__gottyKeyboardDebug("alt-handler", {
      type: event.type, key: event.key, code: event.code,
      result, defaultPrevented: event.defaultPrevented,
    });
    return result;
  };
  term.attachCustomKeyEventHandler(handler);
  const subscription = term.onData(text => {
    const bytes = new TextEncoder().encode(text);
    window.__gottyKeyboardDebug("terminal-data", {
      length: bytes.length, bytes: Array.from(bytes.slice(0, 64)),
    });
  });
  window.stopGottyKeyboardDebug = () => {
    stopped = true;
    for (const [type, listener] of listeners) window.removeEventListener(type, listener, true);
    subscription.dispose();
    if (term._core._customKeyEventHandler === handler)
      term.attachCustomKeyEventHandler(previousHandler);
  };
  return { records, stop: window.stopGottyKeyboardDebug };
};

