#!/usr/bin/env bun

// Smallest end-to-end demo of the WebView bridge: serve one fixed page on a
// port nobody picked in advance, then have xdg-open put it in the host app's
// app WebView and switch to it. Run it from a Buninu shell inside minapk's
// APK:
//
//   bun demo-server.js
//
// Outside such an APK it still runs and still serves; xdg-open just falls
// back to whatever that platform's default handler is (see apps/xdg-open).

const BODY = "Hello 你好 こんにちは"

// port: 0 asks the OS for a free port instead of guessing one and racing
// whatever already has it -- Buninu's own launcher picks jsgotty's port the
// same way. The real number is only knowable after the listener exists, so
// the URL is built from server.port, never from a constant.
// hostname stays on loopback: this is a demo page for the WebView on this
// device, not something other machines on the network should reach.
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch() {
    // charset is not optional here: without it the WebView guesses an
    // encoding for the response, and the CJK half of BODY is what shows up
    // as mojibake when it guesses wrong.
    return new Response(BODY, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    })
  },
})

// 127.0.0.1 rather than localhost: the listener is bound to the v4 loopback
// address specifically, while "localhost" can resolve to ::1 first and give
// the WebView a connection refused before it ever tries v4.
const url = `http://127.0.0.1:${server.port}`
console.log(`demo-server: serving ${JSON.stringify(BODY)} at ${url}`)

// Buninu puts its own bin/ on PATH, so "xdg-open" normally resolves to
// apps/xdg-open through the shloader. Fall back to running the script
// directly for the case where this file is run outside a Buninu shell (a bare
// `bun demo-server.js` in a checkout), where that PATH entry is not there.
const xdgOpen = Bun.which("xdg-open")
const command = xdgOpen
  ? [xdgOpen, url]
  : [process.execPath, `${import.meta.dir}/apps/xdg-open/xdg-open.js`, url]

// MINAPK_WEBVIEW is read by xdg-open itself, not by the host app -- it names
// which WebView to load into (1 is the app WebView) and brings it to the
// front. Passed to this one child rather than exported, so it changes nothing
// for the rest of the session.
const child = Bun.spawn(command, {
  env: { ...process.env, MINAPK_WEBVIEW: "1" },
  stdout: "inherit",
  stderr: "inherit",
})

if (await child.exited !== 0)
  console.error(`demo-server: ${command[0]} exited with ${child.exitCode}; page is still served at ${url}`)

// The server has to outlive the open: the WebView fetches the page after
// xdg-open has already returned. Ctrl-C to stop.
console.log("demo-server: Ctrl-C to stop")
