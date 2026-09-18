#!/usr/bin/env bun

// Android goes through native-bridge's xdgOpen (MainActivity.java validates
// the path stays under Buninu's home and serves it back out through a
// read-only content:// provider; a bare URL just goes to ACTION_VIEW). The
// other platforms each have their own "open with whatever the OS thinks is
// the default handler" mechanism -- macOS/Windows are real OS
// commands/APIs, but Linux's is conventionally *also* a command named
// xdg-open, so this script has to be careful not to find itself on PATH.
import {
  xdgOpen as bridgeOpen, available, openWebView, showWebView,
} from "../native-bridge/native-bridge.js"
const fs = require("fs")

// MINAPK_WEBVIEW names *which* of the host app's WebViews to open into (0 is
// the console, 1 the app WebView, -1 whichever is in front); unset means the
// unchanged behavior of handing the target to the system's default handler.
// It is read here rather than being detected by the host, because it is an
// environment variable of this Bun process tree -- the host app's own process
// cannot see a value exported in this shell a moment ago, and the whole point
// of the variable is that it can be.
//
// Deliberately never Number()/parseInt(): Number("") is 0, and 0 is a
// perfectly valid WebView id, so an exported-but-empty MINAPK_WEBVIEW= (the
// usual way to switch something off) would come out meaning "open in the
// console" -- i.e. navigate the terminal away. parseInt would likewise turn
// "1x" into 1. Only a bare optionally-signed integer counts; anything else is
// reported and treated as unset.
function webViewIdFromEnv() {
  const raw = (process.env.MINAPK_WEBVIEW ?? "").trim()
  if (raw === "") return null
  if (!/^-?\d+$/.test(raw)) {
    process.stderr.write(
      `xdg-open: ignoring MINAPK_WEBVIEW=${raw} (not an integer WebView id)\n`)
    return null
  }
  return Number(raw)
}

// Only URLs. A filesystem path stays on the bridgeOpen path even when
// MINAPK_WEBVIEW is set: WebView's setAllowFileAccess defaults to false from
// API 30 on, so a file:// URL under Buninu's home would load as a blank page,
// whereas the host's xdgOpen already serves that file properly through its
// read-only content:// provider.
const isUrl = (target) => /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(target)

// The host answers with the id it actually used -- a JSON number -- and with
// a string when something went wrong: "error: no such WebView: 9" from the
// dispatcher, or rpc.mjs's own "Unknown func ..." when the APK is older than
// these functions and does not list them in _discover. rpc.mjs also *resolves*
// to an Error object instead of throwing when the fetch itself fails. So
// success is checked as "is genuinely a number", never by parsing the result:
// see webViewIdFromEnv above for why a coercing parse is dangerous here.
//
// showWebView(-1) means "switch to the next one", not "the one just loaded",
// so the switch uses the id openWebView resolved and handed back, not the id
// that was asked for.
async function openInWebView(id, url) {
  const opened = await openWebView(id, url)
  if (typeof opened !== "number" || !Number.isInteger(opened)) {
    process.stderr.write(
      `xdg-open: MINAPK_WEBVIEW=${id}: ${opened?.message ?? opened}\n`)
    return false
  }

  const shown = await showWebView(opened)
  if (typeof shown !== "number" || !Number.isInteger(shown)) {
    // Loaded but not brought to the front: say so rather than reporting
    // success for something the user cannot see, but do not fall back to the
    // system handler either -- the page really is loaded in that WebView.
    process.stderr.write(
      `xdg-open: loaded in WebView ${opened} but could not switch to it: ` +
      `${shown?.message ?? shown}\n`)
  }
  return true
}

// Buninu's own bin/ is prepended to PATH ahead of any real system binary of
// the same name (same concern as xclip.js/tts.js), and this script is
// itself registered as Buninu's "xdg-open" command -- a naive PATH search
// would just find this file. Skip Buninu's own bin dir and keep looking
// further down PATH for wherever a real xdg-open actually lives.
function findSystemXdgOpen() {
  const ownBinDir = process.env.BUNINU_HOME ? `${process.env.BUNINU_HOME}/bin` : null
  for (const dir of (process.env.PATH || "").split(":").filter(Boolean)) {
    if (dir === ownBinDir) continue
    const candidate = `${dir}/xdg-open`
    try {
      fs.accessSync(candidate, fs.constants.X_OK)
      return candidate
    } catch {}
  }
  return null
}

async function runCommand(args) {
  const proc = Bun.spawn(args, { stdout: "ignore", stderr: "ignore" })
  return (await proc.exited) === 0
}

const argv = process.argv.slice(2)

if (argv.length === 0 || argv.includes("-h") || argv.includes("--help")) {
  console.log("usage: xdg-open <file-or-url>")
  process.exit(argv.length === 0 ? 1 : 0)
}

const target = argv[0]
let ok = false

try {
  if (process.platform === "android") {
    if (available()) {
      const webViewId = webViewIdFromEnv()
      // A failed WebView open falls back to the system handler rather than
      // failing outright: the request was "open this", and MINAPK_WEBVIEW
      // only says where it would be preferred. openInWebView has already
      // explained on stderr why it could not.
      ok = webViewId !== null && isUrl(target)
        ? (await openInWebView(webViewId, target)) || (await bridgeOpen(target))
        : await bridgeOpen(target)
    } else if (Bun.which("termux-open")) {
      // Plain Termux (no minapk) still reports platform "android" but has
      // no PKG_BRIDGE_SOCK -- termux-open (Termux:API) does the same
      // ACTION_VIEW-based open, same fallback relationship as tts.js's
      // termux-tts-speak branch when native-bridge isn't available.
      ok = await runCommand(["termux-open", target])
    } else {
      throw new Error("no native bridge and no termux-open (install termux-api, or run inside minapk's APK)")
    }
  } else if (process.platform === "darwin") {
    ok = await runCommand(["open", target])
  } else if (process.platform === "win32") {
    // start is a cmd builtin, not a real executable, and needs an empty ""
    // title argument first or it treats a quoted target as the title.
    ok = await runCommand(["cmd", "/c", "start", "", target])
  } else {
    const real = findSystemXdgOpen()
    if (!real) throw new Error("no system xdg-open found on PATH")
    ok = await runCommand([real, target])
  }
} catch (e) {
  process.stderr.write(`xdg-open: ${e.message}\n`)
  process.exit(1)
}

// Explicit exit: bridgeOpen() goes through native-bridge's call(), whose own
// timeout race leaves an abandoned fetch running the event loop on a
// timeout -- without this, xdg-open could hang after printing everything it
// needs to.
process.exit(ok ? 0 : 1)
