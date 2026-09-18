#!/usr/bin/env bun

// ─── CDP (Chrome DevTools Protocol) ────────────────────────────────────────
//
// bunmicro can act as a CDP target, letting external scripts control it
// the same way Playwright or Bun.WebView controls a browser.
//
// ── Starting the server ────────────────────────────────────────────────────
//
//   Inside the editor:
//     Ctrl-E  cdp                              → 127.0.0.1:9222
//     Ctrl-E  cdp 9000                         → 127.0.0.1:9000
//     Ctrl-E  cdp --public                     → 0.0.0.0:9222
//     Ctrl-E  cdp 9000 --public                → 0.0.0.0:9000
//     Ctrl-E  cdp --address=192.168.1.1        → 192.168.1.1:9222
//     Ctrl-E  cdp 9000 --address=192.168.1.1   → 192.168.1.1:9000
//
//   From the command line (Chrome-style):
//     bunmicro --remote-debugging-port=9222 file.txt
//     bunmicro --remote-debugging-port=9222 --remote-debugging-address=0.0.0.0 file.txt
//     bunmicro --remote-debugging-port=9222 --remote-allow-origins=http://localhost:8000 file.txt
//
//   Browser WebSocket origins are rejected by default, as in Chromium.
//   --remote-allow-origins accepts a comma-separated allowlist; `*` allows all
//   origins and disables this protection. Non-browser clients omit Origin and
//   continue to work without this flag.
//
//   Once running, status bar shows:  CDP@<port> server running
//   Running cdp again shows:         CDP@<port> already running
//
// ── Maze demo from the source tree ─────────────────────────────────────────
//
//   Start the maze, local CDP server, and automatic solver together:
//     bun src/index.js --cdp-maze
//
// ── Connecting ─────────────────────────────────────────────────────────────
//
//   Bun.WebView:
//     const view = new Bun.WebView({
//       backend: { type: "chrome", url: "ws://127.0.0.1:9222" }
//     });
//
//   Playwright (Node/Bun):
//     const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
//
// ── Available methods ───────────────────────────────────────────────────────
//
//   view.navigate(url)          open file or URL in editor (Ctrl-E open)
//   view.type(text)             insert text at cursor
//   view.press(key, opts?)      send a key press
//                                 key: "Enter","Backspace","Tab","Escape",
//                                      "ArrowUp/Down/Left/Right",
//                                      "Home","End","PageUp","PageDown",
//                                      or single char "a"
//                                 opts: { modifiers: bitmask }
//                                   Alt=1  Ctrl=2  Meta=4  Shift=8
//   view.click(x, y)            move cursor to column x, line y (1-based)
//   view.scroll(dx, dy)         move cursor by dx cols and dy lines
//   view.scrollTo(selector)     find text or #anchor and jump to it
//   view.evaluate(jsCode)       run JS inside bunmicro's plugin context
//                                 e.g. "micro.cmd.save()"
//   view.goBack()               switch to previous tab (PrevTab)
//   view.goForward()            switch to next tab (NextTab)
//   view.resize(w, h)           accepted by protocol but not yet implemented
//
// ── Example script below ───────────────────────────────────────────────────
//   ctrl-a ctrl-c = select+copy all
//   ctrl-t = new tab
//   ctrl-v = paste
//   ctrl-s filename.js enter
//   run with bun filename.js

const cdpUrl = "ws://127.0.0.1:9222";

const view = new Bun.WebView({
  backend: {
    type: "chrome",
    url: cdpUrl,
  },
});

view.onNavigated = (url, title) => {
  console.log(`[navigated] ${title || "(no title)"} — ${url.slice(0, 80)}`);
};

const delay = Bun.sleep
const startInterval = 1000
const interval = 500

try {

  await delay(startInterval);

  await view.navigate("https://raw.githubusercontent.com/jjtseng93/bunmicro/refs/heads/main/hlw.md");
  await delay(interval);

  await view.evaluate(
    "micro.cmd.tab()"
  );
  await delay(interval);
  
  await view.goBack();
  await delay(interval);

  //await view.goForward();
  //await delay(interval);

  await view.scrollTo("#hello");
  await view.evaluate('micro.action.StartOfLine()');
  await delay(interval);

  await view.type("# Bun is great");
  await delay(interval);
  
  await view.press("Enter");
  await delay(interval);
  
  await view.click(3,3);
  await delay(interval);
  await view.scroll(4,3);

  await view.resize(1280, 720);
  await delay(interval);

  console.log(
    Bun.markdown.ansi('### All done')
  )
} finally {
  view.close();
}
