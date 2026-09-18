#!/usr/bin/env bun

// Ported from ../tmpk/bin/xclip.sh (the DroidScript-era xclip). That version
// bridged to native only through DroidScript's dsapi.pipe; this one uses
// native-bridge instead. The core semantics are unchanged: "primary" is
// local-file-only (matches X11's mouse-selection clipboard, which xclip also
// keeps separate from the real clipboard), and only "-selection clipboard"
// (or its "-clip"/"-clipboard" shorthand) touches the real system clipboard.
import { getcb, setcb, available } from "../native-bridge/native-bridge.js"
import { ClipboardManager } from "../jsmdcui/src/platform/clipboard.js"

// Buninu is cross-OS, not just Android, so the "clipboard" register falls
// back through: native-bridge (Android) -> jsmdcui's own ClipboardManager
// (win32/darwin only, see below) -> wl-copy/wl-paste (Linux, Wayland).
//
// ClipboardManager is deliberately NOT used on Linux-like platforms
// (including Android): its own backend detection searches PATH for a binary
// literally named "xclip" there, and this script is itself registered as
// Buninu's "xclip" command, ahead of any real system xclip on PATH -- using
// it here would make this script shell out to itself. Its win32/darwin
// branches never search for "xclip" at all, so those two are safe.
let desktopClipboard = null
function getDesktopClipboard() {
  if (process.platform !== "win32" && process.platform !== "darwin") return null
  if (!desktopClipboard) desktopClipboard = new ClipboardManager()
  return desktopClipboard
}

const wlAvailable = () => !!(Bun.which("wl-copy") && Bun.which("wl-paste"))
const wlRead = () => {
  const proc = Bun.spawnSync(["wl-paste", "--no-newline"])
  return proc.success ? new TextDecoder().decode(proc.stdout) : null
}
const wlWrite = (text) => Bun.spawnSync(["wl-copy"], { stdin: Buffer.from(text) }).success

const argv = process.argv.slice(2)

if (argv.includes("--help") || argv.includes("-h")) {
  console.log(`
 Usage: Paste/Copy
  xclip -o [-selection clipboard]
  xclip -o [-clip]
  echo hello | xclip [-selection clipboard]
  echo hello | xclip [-clip]

 Uses primary by default(mouse selection)
`)
  process.exit(0)
}

const selMatch = argv.join(" ").match(/-selection\s+(\S+)/)
const cb = selMatch ? selMatch[1]
  : argv.some(a => a.includes("-clip")) ? "clipboard"
  : "primary"

process.stderr.write(`\x1b[35mClipboard 剪貼板📋 ： ${cb} \n\x1b[0m`)

const cbf = `${process.env.HOME}/.xclip.${cb}`
const useNative = cb !== "primary"
const desktop = useNative ? getDesktopClipboard() : null

if (useNative && !available() && !desktop && !wlAvailable())
  process.stderr.write(`no system clipboard found (no native bridge, no ClipboardManager backend, no wl-copy/wl-paste)\nNo native clipboard now!\n`)

const isPaste = argv.some(a => a.toLowerCase() === "-o")

if (isPaste) {
  process.stderr.write(`\x1b[33mPaste 貼上 📋 \n\x1b[0m`)

  if (useNative) {
    if (available()) {
      try {
        await Bun.write(cbf, (await getcb()) ?? "")
      } catch (e) {
        process.stderr.write(`getcb failed: ${e.message}\n`)
      }
    } else if (desktop) {
      try {
        await Bun.write(cbf, desktop.read("clipboard") ?? "")
      } catch (e) {
        process.stderr.write(`clipboard read failed: ${e.message}\n`)
      }
    } else if (wlAvailable()) {
      const text = wlRead()
      if (text != null) await Bun.write(cbf, text)
    }
  }

  const file = Bun.file(cbf)
  if (await file.exists()) process.stdout.write(new Uint8Array(await file.arrayBuffer()))
} else {
  process.stderr.write(`\x1b[33mCopy 複製 ✂️ \n\x1b[0m`)

  const input = await Bun.stdin.arrayBuffer()
  await Bun.write(cbf, input)

  if (useNative) {
    if (available()) {
      try {
        await setcb(new TextDecoder().decode(input))
      } catch (e) {
        process.stderr.write(`setcb failed: ${e.message}\n`)
      }
    } else if (desktop) {
      try {
        desktop.write(new TextDecoder().decode(input), "clipboard")
      } catch (e) {
        process.stderr.write(`clipboard write failed: ${e.message}\n`)
      }
    } else if (wlAvailable()) {
      wlWrite(new TextDecoder().decode(input))
    }
  }
}

// Explicit exit: call()'s own timeout race means every await above is
// guaranteed to settle, but a getcb()/setcb() that hit that timeout leaves
// an abandoned fetch running, which keeps Bun's event loop alive on its own.
// Without this, xclip could still hang after printing everything it needs
// to -- the shell would just never get its prompt back.
process.exit(0)
