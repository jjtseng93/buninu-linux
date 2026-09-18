// No imports needed: `micro` is available as a global.

/*

# JS Plugin Documentation

Available hooks (register with micro.on(hookName, fn)):

  Lifecycle (no args):
    "preinit"           — before plugins load
    "init"              — main plugin setup, register commands/actions here
    "postinit"          — after all plugins loaded

  Buffer events:
    "onBufferOpen"  (buffer)      — buffer opened (raw BufferModel, not pane adapter)
    "onBufferClose" (buffer)      — buffer closed (raw BufferModel)
    "onSetActive"   (bp)          — pane became active (tab switch, close, etc.)
    "onSave"        (bp)          — buffer saved

  Input events:
    "onRune"           (bp, ch)   — printable character inserted (ch is the string)

  Cancellable hooks (return false to cancel the action):
    "preBackspace"     (bp)       — before backspace; return false to block
    "preInsertNewline" (bp)       — before Enter/newline; return false to block

bp is a pane adapter with:
  bp.Buf.Line(n)  bp.Buf.LinesNum()  bp.Buf.FileType()
  bp.Buf.Insert(loc, text)  bp.Buf.Replace(s, e, text)
  bp.Cursor.X  bp.Cursor.Y  bp.Cursor.Loc  bp.Cursor.HasSelection()
  bp.Save()  bp.Backspace()  bp.CursorLeft/Right()  bp.InsertNewline()

Flat buffer helpers (all 1-based line numbers, omit → cursor line):
  micro.getLine(n?)            micro.putLine(text, n?)     micro.delLine(n?)
  micro.getLines(from?, to?)   micro.getLinesCount()
  micro.getAllText()           — entire buffer as one string (lines joined by "\n")
  micro.getAllAnsiText()       — rendered ANSI document, or plain text when unavailable
  micro.clickBufferCell(x, y)  — activate a 1-based MDCUI cell, or goto in other buffers
  micro.putAllText(text)       — replace entire buffer content; pushes undo
  micro.getSelection()         micro.putSelection(text)

Other micro APIs:
  micro.CurPane()              — returns pane adapter for active pane
  micro.MakeCommand(name, fn)  — register Ctrl+E command; fn(bp, args[])
                                 args.raw = full original input string (bypass shellSplit)
                                 e.g. for command "js 1+1": args.raw = "js 1+1", args.raw.slice(3) = "1+1"
  micro.RegisterAction(name, fn) — register bindable action
  micro.TermMessage(msg)       — show msg in editor status row
  micro.alert(msg)             — synchronous; suspend editor, print msg, wait for Enter
                                 e.g. micro.alert("Done") (do not await)
  micro.confirm(msg)           — synchronous boolean result
  micro.prompt(msg, default?)  — synchronous string or null result
  micro.Log(...args)           — console.log passthrough
  micro.GetOption(name)        micro.SetOption(name, value)
  micro.cmd.save()             — call any editor command via proxy
  micro.action.CursorUp()      — run any registered action via proxy
  micro.shell.CMD(...args)     — run CMD interactively (same as Ctrl-B); async
                                 e.g. await micro.shell.ls('-l')
                                      await micro.shell.git('diff', '--stat')

*/

micro.on("init", () => {
  // Register a custom Ctrl+E command
  micro.MakeCommand("cdp", async (bp, args) =>
  {
    const addrFlag = args.find(a => a.startsWith("--address="))?.slice("--address=".length);
    const allowOrigins = args.find(a => a.startsWith("--remote-allow-origins="))
      ?.slice("--remote-allow-origins=".length);
    const isPublic = args.includes("--public");
    const port = parseInt(args.find(a => /^\d+$/.test(a))) || parseInt(Bun.env.CDP_PORT) || 9222;
    const hostname = addrFlag ?? (isPublic ? "0.0.0.0" : "127.0.0.1");
    const path = bp?.Buf?.Path || "(no path)";
    
    if(!micro.cdpContext)
    {
      micro.cdpContext={
        title(){
          return path;
        },
        async evaluate(txt){
          return await eval(txt);
        },
        async navigate(url){
          await micro.cmd.open('-f', url);
        },
        async click(x,y,opt){
          x=x||1 ; y=y||1 ;
          await micro.clickBufferCell(x, y);
        },
        async scroll(dx,dy){
          const pane = micro.CurPane();
          if (!pane) return;

          dx = toInteger(dx);
          dy = toInteger(dy);

          const line = Math.max(1, pane.Cursor.Y + dy + 1);
          const column = Math.max(1, pane.Cursor.X + dx + 1);
          await micro.cmd.goto(`${line}:${column}`);
        },
        async scrollTo(selector){
          const pattern = selectorToSearchPattern(selector);
          await micro.cmd.find(pattern);
        },
        goBack(){
          micro.action.PrevTab();
        },
        goForward(){
          micro.action.NextTab();
        },
        async type(text){
          const bp = micro.CurPane();
          if (!bp) return;
          bp.Insert(text);
        },
        async press(key, options){
          const raw = cdpKeyToTerminalInput(key, options);
          if (raw) await micro._dispatchRawInput(raw);
        },
      }
    
      let {CdpServer}=await import('./cdp-server.js');
      
      micro.cdpPort = port;
      CdpServer
        .create(micro.cdpContext)
        .listen(port, hostname, { remoteAllowOrigins: allowOrigins });

      const addr = isPublic ? `0.0.0.0:${port}` : `127.0.0.1:${port}`;
      micro.TermMessage(`CDP@${addr} server running 伺服器啟動了`)

      //micro.alert(CdpServer)
    }  //  server not running
    else
    {
      micro.TermMessage(`CDP@${micro.cdpPort} already running a server 已有伺服器啟動`)
    }

    
  });
  
})

function selectorToSearchPattern(selector) {
  const value = String(selector ?? "");
  return value.startsWith("#") ? value.slice(1) : value;
}

function toInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : 0;
}

function cdpKeyToTerminalInput(key, options = {}) {
  const modifiers = Number(options.modifiers) || 0;
  const alt = !!(modifiers & 1);
  const ctrl = !!(modifiers & 2);
  const meta = !!(modifiers & 4);
  const shift = !!(modifiers & 8);
  const modifierCode = 1 + (shift ? 1 : 0) + (alt || meta ? 2 : 0) + (ctrl ? 4 : 0);
  const value = String(key ?? options.text ?? "");

  const cursorFinal = {
    ArrowUp: "A",
    ArrowDown: "B",
    ArrowRight: "C",
    ArrowLeft: "D",
    Home: "H",
    End: "F",
  }[value];
  if (cursorFinal) {
    return modifierCode === 1
      ? `\x1b[${cursorFinal}`
      : `\x1b[1;${modifierCode}${cursorFinal}`;
  }

  if (value === "PageUp" || value === "PageDown" || value === "Delete") {
    const number = value === "PageUp" ? 5 : value === "PageDown" ? 6 : 3;
    return modifierCode === 1
      ? `\x1b[${number}~`
      : `\x1b[${number};${modifierCode}~`;
  }

  if (value === "Tab") return shift ? "\x1b[Z" : "\t";
  if (value === "Enter") return alt || meta ? "\x1b\r" : "\r";
  if (value === "Backspace") return "\x7f";
  if (value === "Escape") return "\x1b";

  let text = typeof options.text === "string" && options.text
    ? options.text
    : value === "Space" ? " " : value;
  if ([...text].length !== 1) return "";

  if (ctrl) {
    const code = text.toUpperCase().charCodeAt(0);
    if (code >= 64 && code <= 95) text = String.fromCharCode(code & 31);
  } else if (shift && /^[a-z]$/.test(text)) {
    text = text.toUpperCase();
  }

  return alt || meta ? `\x1b${text}` : text;
}
