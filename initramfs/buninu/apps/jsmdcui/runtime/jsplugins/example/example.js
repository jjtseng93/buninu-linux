// example.js — demonstrates the micro JS plugin API
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
  micro.MakeCommand("showpath", (bp, args) =>
  {
    //micro.TermMessage("Hello from JS plugin! Args: " + args.join(", "));

    //micro.alert(micro.getLine())
    const path = bp?.Buf?.Path || "(no path)";
    const moduleSource =
      micro.CurPane()?.Buf?.MdcuiModuleSource || "external";
    const loc = bp?.CursorLocation?.() || "+1.0:1";
    micro.alert(`${path}\nMdcuiModuleSource: ${moduleSource}\n${loc}`)
    
  });
  

  micro.MakeCommand("js", async (bp, args) =>
  {
    // args.raw is the full original input string, e.g. "js console.log('hi')"
    // slice(3) skips the "js " prefix (2-char name + 1 space)
    const scriptText = args.raw?.slice(3) ?? args.join(" ");
    micro.alert(await eval(scriptText));
  });
  

  // greet: shows a message via micro.alert (leaves editor, shows text, Enter returns)
  micro.MakeCommand("greet", (bp, args) =>
  {
    const name = args.length ? 
               args.join(" ") : "world";
               
    let s=Bun.markdown.ansi(
      '# Hello\n- '+name
    );
    
    micro.alert(s);
  });

  // Register a custom action (can be bound to a key in keybindings.json)
  micro.RegisterAction("ExampleDuplicateAndComment", async () => 
  {
    await micro.action.DuplicateLine();
    await micro.action.ToggleComment();
  });
});

micro.on("onSave", (bp) => 
{
  // bp is the BufPane adapter 
  // (same as Lua's bp arg)
  
  const path = bp?.Buf?.Path || "(no path)";
  //micro.Log("[example] saved:", path);
});
