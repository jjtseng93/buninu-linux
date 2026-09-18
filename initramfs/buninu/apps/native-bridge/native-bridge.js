// Called from a jsmdcui `js back` block (a Bun process), never from `js front`:
// the `unix` fetch option native-bridge relies on only works under Bun, not
// inside the Android WebView that renders front code.
// rpc.mjs's rpc.* Proxy exists so a caller can dial an RPC by a name it only
// knows at runtime; every call here uses a fixed, known-in-advance name, so
// there is nothing that sugar buys us. Going straight to rpcraw also gets us
// a real envp slot -- rpc.foo(...) always sends envp as {} (it is fed by the
// Proxy's own internal `this`, not anything a caller supplies).
import { rpcraw, switchBackend } from "../jsmdcui/src/cui/rpc.mjs"

// PKG_BRIDGE_SOCK carries whatever rpc.mjs's rpcFetchOpt() needs after
// decodeURIComponent(new URL("unix:"+sock).pathname): percent-encoded
// (e.g. "%00native-bridge") for a Linux abstract-namespace socket -- an env
// var cannot carry a literal NUL byte, but it can carry the three ASCII
// characters "%00" -- or a plain path for a real filesystem socket, which
// has nothing that needs encoding and passes through unchanged. Either way,
// native-bridge.js does not decide which; it forwards the value as-is.
const sock = process.env.PKG_BRIDGE_SOCK

if (sock) switchBackend(`unix:${sock}`)

// rpc.mjs never throws for a call the far side does not implement; it
// resolves to a string starting with "Unknown func" instead (evalBack/rpcraw
// in rpc.mjs both use this exact prefix). Default here is the same silent
// behavior; call nothrow(false) to make native-bridge throw in that case
// instead, so a missing PKG_BRIDGE_SOCK or an unimplemented host method fails
// loudly rather than being mistaken for a successful result. Any value other
// than an explicit `false` (including calling nothrow() with no argument)
// restores the default silent behavior.
let noThrowUnknownFunc = true

export function nothrow(bool)
{
  noThrowUnknownFunc = bool !== false
}

// fetch() never times out on its own: if the host never answers (main thread
// wedged, bridge crashed mid-request, anything), the await below would hang
// forever without this race. The abandoned rpcraw() call keeps running in
// the background after the race settles -- Bun's event loop treats a
// pending fetch as a reason to stay alive, so it is not enough for this
// function to merely return; whatever ultimately calls call() must still
// process.exit() once it is done, or the process itself will not exit even
// though every await has resolved.
const DEFAULT_TIMEOUT_MS = 5000

export async function call(name, args = [], envp, timeoutMs = DEFAULT_TIMEOUT_MS)
{
  if (!sock)
    throw new Error(`native-bridge: PKG_BRIDGE_SOCK is not set (not running inside minapk's APK)`)

  const result = await Promise.race([
    rpcraw(name, args, envp),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(
        `native-bridge: "${name}" timed out after ${timeoutMs}ms`)), timeoutMs)),
  ])

  if (!noThrowUnknownFunc && typeof result === "string" && result.startsWith("Unknown func"))
    throw new Error(`native-bridge: host does not implement "${name}"`)

  return result
}

export const available = () => !!sock

// clipboardRead/clipboardWrite are long enough to want a short alias; toast
// already is one. The Java dispatcher accepts either spelling over the wire
// and lists both in its _discover response, so calling the alias directly
// (e.g. from the CLI below, or another rpcraw caller) works too, not just
// through these.
export const toast = (text, long = false) => call("toast", [text, long])

export const clipboardRead = () => call("clipboardRead")
export const getcb = clipboardRead

export const clipboardWrite = (text) => call("clipboardWrite", [text])
export const setcb = clipboardWrite

// TTS has no push/callback path over this protocol -- speak() only waits for
// the host to accept the utterance, not for it to finish speaking, and
// returns a handle immediately. Poll ttsStatus(handle) yourself ("speaking",
// "done", "error", or "unknown" once a terminal state has already been
// consumed) until it leaves "speaking"; apps/tts wraps that loop for the
// common case instead of every caller writing its own.
// Only text is required. 1.0 is normal for both speed and pitch, same
// convention as termux-tts-speak's -p/-r; native-bridge does not assume any
// particular caller's own default (jsmdcui's TTS_PITCH/TTS_SPEED, for
// instance, default to 1/1.5 -- that is jsmdcui's own choice, read
// TTS_PITCH/TTS_SPEED yourself if you want to honor it).
export const speak = (text, speed = 1, pitch = 1, flush = false) =>
  call("speak", [text, speed, pitch, flush])

export const ttsStatus = (handle) => call("ttsStatus", [handle])
export const tts = ttsStatus

// target is either a URL (any scheme:// prefix, opened via ACTION_VIEW same
// as a WebView link tap) or a path under Buninu's home -- served back out
// through a read-only content:// provider, since the home directory is
// otherwise private to this app and a raw file:// Uri would be rejected by
// the receiving app on modern Android.
export const xdgOpen = (target) => call("xdgOpen", [target])

// The host has exactly two WebViews, both alive from startup and neither ever
// created nor closed at runtime: WEBVIEW_CONSOLE (0) is the jsgotty terminal
// this shell is being rendered in, WEBVIEW_APP (1) is the app WebView, which
// simply starts out blank and behind. WEBVIEW_CURRENT (-1) means whichever
// one is in front right now, and is the default wherever an id is optional.
// All four functions also go by openwv/evalwv/showwv/currwv, both here and
// over the wire (the Java dispatcher answers to either spelling and lists
// both in _discover), on the same grounds as getcb/setcb above.
export const WEBVIEW_CURRENT = -1
export const WEBVIEW_CONSOLE = 0
export const WEBVIEW_APP = 1

// Loads url into a WebView *without* bringing it to the front, so
// openWebView(WEBVIEW_APP, url) while the user is looking at the terminal is
// a plain background load -- showWebView is the only thing that changes what
// is on screen. Omitting url loads nothing and just reports the id back,
// which is how -1 gets resolved to a real id. Returns the id loaded into.
export const openWebView = (id = WEBVIEW_CURRENT, url = "") =>
  call("openWebView", [id, url])
export const openwv = openWebView

// Resolves to the value the expression produced -- a real number/string/
// object, not a string containing one -- because the host sends
// evaluateJavascript's own JSON text straight back as the response body.
// undefined, a function, and a thrown exception all arrive as null: WebView
// itself does not distinguish them, so return something JSON can carry when
// you need to tell them apart. A page that never answers is given up on by
// the host (inside this module's own call timeout) and comes back as an
// "error: ..." string rather than hanging.
export const evalWebView = (id, js) => call("evalWebView", [id, js])
export const evalwv = evalWebView

// Brings a WebView to the front. The bottom key bar (Ctrl/Alt/Shift and
// friends), the volume-key menu and the back key all act on whatever is in
// front, so this is also what re-points them. An id of -1 -- the default --
// switches to the next WebView rather than being a no-op, which with two of
// them is simply a toggle. Returns the id now in front.
export const showWebView = (id = WEBVIEW_CURRENT) => call("showWebView", [id])
export const showwv = showWebView

// The id of the WebView in front, for code that wants to put something back
// the way it found it.
export const currWebView = () => call("currWebView")
export const currwv = currWebView

// `bun native-bridge.js <func> [args...]`, dispatched straight to call(func,
// args) -- not restricted to toast/clipboardRead/clipboardWrite, exactly like
// calling rpcraw(func, args) would be. This is a raw RPC, equivalent to a
// native function call on the host side: the result can be any JSON value
// (string, number, boolean, null, array, object), not just a plain object,
// so it is printed as-is rather than assumed to have any particular shape.
// Each arg is JSON.parse'd when it parses cleanly (so `42`, `true`, `[1,2]`,
// `{"a":1}` arrive as their real types) and kept as a plain string otherwise
// (so `hi` stays "hi" rather than failing to parse as JSON). No func given at
// all defaults to `_discover`, so a bare `bun native-bridge.js` lists what
// the far side implements instead of erroring.
export async function main()
{
  const [name = "_discover", ...rawArgs] = process.argv.slice(2)

  const args = rawArgs.map(arg => {
    try { return JSON.parse(arg) } catch { return arg }
  })

  try
  {
    const result = await call(name, args)

    // Display-only: _discover's real value (an object, relied on as-is by
    // rpc.mjs's own dispatch gate -- see FrontendDiscoverApi/rpcraw) is
    // never touched. This only changes what gets printed here, one
    // function per line instead of JSON.stringify's single-line output, so
    // the list is easy to grep.
    if (name === "_discover" && result && typeof result === "object")
    {
      const lines = Object.entries(result).map(([k, v]) => `"${k}":${JSON.stringify(v)}`)
      console.log("{\n" + lines.join(",\n") + "\n}")
    }
    else
    {
      console.log(JSON.stringify(result))
    }
  }
  catch (e)
  {
    console.error(e.message)
    process.exit(1)
  }

  // Explicit exit even on success: see the note above call()'s timeout race
  // -- an abandoned rpcraw() from a prior timeout can keep the process alive
  // on its own otherwise.
  process.exit(0)
}

if (import.meta.main) main()
