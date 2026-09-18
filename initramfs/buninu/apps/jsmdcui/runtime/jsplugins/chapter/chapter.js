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

  
  micro.MakeCommand("nextchapter", async (bp, args) =>
  {
     let fp=bp?.Buf?.Path
     let i1=fp.lastIndexOf('/')- -1
     let i2=fp.lastIndexOf('.')
     let nb=fp.slice(i1,i2)
     let nfp=fp.slice(0,i1)+(nb- -1)+fp.slice(i2)

     await micro.cmd.open('-f',nfp)
     
     /*
     await micro.cmd.replaceall('曰','日')
     await micro.cmd.replaceall('修土','修士')
     await micro.cmd.replaceall('<p>','\n')
     await micro.cmd.replaceall('</p>','\n')
     await micro.cmd.goto(48)
     

     micro.cmd.tts()
     */

  });

  micro.MakeCommand("prevchapter", async (bp, args) =>
  {
     let fp=bp?.Buf?.Path
     let i1=fp.lastIndexOf('/')- -1
     let i2=fp.lastIndexOf('.')
     let nb=fp.slice(i1,i2)
     let nfp=fp.slice(0,i1)+(nb-1)+fp.slice(i2)

     await micro.cmd.open('-f',nfp)
     
     /*
     await micro.cmd.replaceall('曰','日')
     await micro.cmd.replaceall('修土','修士')
     await micro.cmd.replaceall('<p>','\n')
     await micro.cmd.replaceall('</p>','\n')
     await micro.cmd.goto(48)

     micro.cmd.tts()
     */

  });

});
