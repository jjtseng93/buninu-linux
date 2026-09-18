#!/usr/bin/env bun
/**
 * Visual PTY demo for bunmicro.
 *
 * Child terminal output is forwarded directly to the current TTY.
 * stdin is not forwarded; press q, Ctrl-Q, or Esc to stop the demo.
 *
 * Usage:
 *   bun tests/pty-demo.js
 *   bun tests/pty-demo.js --delay 700 --type-delay 45 --term-delay 1800
 */

import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { join, resolve,dirname,basename } from "node:path";
import { tmpdir } from "node:os";

const isAnci = Bun.env.TMPK_HOME && Bun.which('ldcustom')

const ROOT = resolve(import.meta.dir, "..");
const BUNMICRO = join(ROOT, "src", "index.js");

const DEMO_ONE_TEXT = `

# BUNMICRO PTY DEMO
"Use q, Ctrl-Q, or Esc to stop this demo."
`;

const DEMO_TWO_LONG_LINE = "This deliberately long line demonstrates soft wrapping across the editor viewport without real newline characters. 中文段落用來測試寬字元、游標移動與自動換行是否正確，並確認每一個漢字都能完整顯示。日本語の文章では、ひらがな、カタカナ、漢字を混ぜて、表示幅と折り返し位置を確認します。さらに長い一行を維持したまま、画面端で自然に折り返される動作を丁寧に実演します。中文日本語🚀✨🧪確認。";
const DEMO_TWO_TEXT = [
  "SECOND TAB",
  DEMO_TWO_LONG_LINE,
  "",
].join("\n");
if ([...DEMO_TWO_LONG_LINE].length !== 250) throw new Error("demo two long line must be exactly 250 characters");
const options = {
  delay: numberArg("--delay", 500),
  typeDelay: numberArg("--type-delay", 100),
  startupDelay: numberArg("--startup-delay", 5000),
  termDelay: numberArg("--term-delay", 1400),
  cols: numberArg("--cols", process.stdout.columns || 100),
  rows: numberArg("--rows", process.stdout.rows || 30),
};

if (process.argv.includes("--help")) {
  console.log(`Usage: bun tests/pty-demo.js [options]

Options:
  --delay MS          Delay after each action (default: ${options.delay})
  --type-delay MS     Delay between typed characters (default: ${options.typeDelay})
  --startup-delay MS  Initial editor startup delay (default: ${options.startupDelay})
  --term-delay MS     Extra delay for terminal pane startup (default: ${options.termDelay})
  --cols N            PTY columns (default: current TTY width)
  --rows N            PTY rows (default: current TTY height)

stdin is not forwarded to bunmicro. Press q, Ctrl-Q, or Esc to stop.`);
  process.exit(0);
}

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error("pty-demo requires stdin and stdout to be TTYs.");
  process.exit(1);
}

let stopped = false;
let resolveStopped;
const stoppedPromise = new Promise((resolve) => { resolveStopped = resolve; });
let terminal = null;
let proc = null;
let temp = "";
let originalRaw = false;

function requestStop() {
  if (stopped) return;
  stopped = true;
  resolveStopped();
}

function onInput(data) {
  const bytes = Buffer.from(data);
  if (bytes.includes(0x71) || bytes.includes(0x11) || bytes.includes(0x1b)) requestStop();
}

function onResize() {
  if (!terminal || terminal.closed) return;
  terminal.resize(process.stdout.columns || options.cols, process.stdout.rows || options.rows);
}

async function pause(ms = options.delay) {
  if (stopped) throw new Error("demo stopped");
  await Promise.race([Bun.sleep(ms), stoppedPromise]);
  if (stopped) throw new Error("demo stopped");
}

function setTitle(title) {
  process.stdout.write(`\x1b]0;bunmicro demo: ${title}\x07`);
}

async function send(data, wait = options.delay) {
  if (stopped) throw new Error("demo stopped");
  terminal.write(data);
  await pause(wait);
}

async function type(text, wait = options.delay) {
  for (const ch of text) {
    if (stopped) throw new Error("demo stopped");
    terminal.write(ch);
    await pause(options.typeDelay);
  }
  await pause(wait);
}

async function paste(text, wait = options.delay) {
  await send(`\x1b[200~${text}\x1b[201~`, wait);
}

async function action(title, fn, waitBefore = Math.min(250, options.delay)) {
  setTitle(title);
  await pause(waitBefore);
  await fn();
}

async function command(value, wait = options.delay) {
  await send("\x05", Math.min(350, options.delay)); // Ctrl-E
  await type(`${value}\r`, wait);
}

function click(x, y, button = 0) {
  return `\x1b[<${button};${x + 1};${y + 1}M\x1b[<${button};${x + 1};${y + 1}m`;
}

async function runDemo({ file2, unknownFile, redetectedFile, crlfShell, themeCount }) {
  await action("bracketed paste JavaScript sample", async () => {
    await send("\x1b[F", 150);
    await paste([
      "",
      "alpha one",
      "alpha two",
      "foo bar foo",
      "",
      "async function loadProfile(userId) {",
      "  const enabled = true;",
      "  const retries = 3;",
      '  const greeting = "hello from bunmicro";',
      "  const tags = [\"editor\", \"javascript\", \"demo\"];",
      "  const profile = { userId, enabled, retries, tags };",
      "  await new Promise((resolve) => setTimeout(resolve, 250));",
      "  if (!profile.enabled) throw new Error(\"disabled profile\");",
      "  return { ...profile, greeting };",
      "}",
      "",
      "loadProfile(42).then(console.log).catch(console.error);",
      "mouse target",
    ].join("\n"), 1000);
  });

  await action("cursor movement and edit", async () => {
    await send("\x1b[A\x1b[A\x1b[H", 200);
    await type("[edited] ");
    await send("\x1b[F", 150);
    await type(" !");
  });

  await action("undo and redo", async () => {
    await send("\x1a", 350);
    await send("\x19", 500);
  });

  await action("set filetype applies syntax instantly", async () => {
    await command("set filetype javascript", 1100);
  });

  await action("theme picker: preview every theme with Down", async () => {
    await send("\x05", 250); // Ctrl-E
    await type("theme");
    setTitle("theme picker: Space opens theme completions");
    await send(" ", 350);
    setTitle("theme picker: Tab previews first theme");
    await send("\t", 850);
    for (let i = 1; i < themeCount; i++) {
      setTitle(`theme picker: Down ${i}/${themeCount - 1}`);
      await send("\x1b[B", 650);
    }
    setTitle("theme picker: reached final theme");
    await pause(1000);
    await send("\x1b", 500); // Cancel preview and restore original theme
  });

  await action("select fixed theme: dracula-tc", async () => {
    await command("theme darcula", 1000);
  });

  await action("find alpha", async () => {
    await send("\x06", 300);
    await type("alpha");
    await send("\r", 500);
    await send("\x0e", 500);
  });

  await action("interactive replace foo", async () => {
    await send("\x1bh", 300);
    await type("foo FIRST");
    await send("\r", 700);
    setTitle("interactive replace: accept first match");
    await send("y", 700);
    setTitle("interactive replace: skip second match");
    await send("n", 700);
  });

  await action("replace all alpha", async () => {
    await command("replaceall alpha 阿爾法", 650);
  });

  await action("show whitespace and trailing spaces", async () => {
    await command("set showchars tab=>,space=.", 450);
    await command("set hltrailingws true", 450);
    await command("set colorcolumn 30", 600);
    await command("set hltaberrors true", 450);
    await command("set tabstospaces true", 850);
    await send("\x1b[F", 120);
    await type("   ");
  });

  await action("save", async () => {
    await send("\x13", 650);
  });

  await action("unknown filetype saves as .js and redetects", async () => {
    await command(`open ${unknownFile}`, 850);
    await command(`save ${redetectedFile}`, 1200);
  });

  await action("select all and eval js", async () => {
    await send("\x01", 900); // Ctrl-A

    if(isAnci)
      await command("js Object.getOwnPropertyNames(''.__proto__)", 2500);      
    else
      await command("eval js", 2500);
    setTitle("eval js result: press Enter to continue");
    await send("\r", 1000);
  });

  await action("DOS CRLF shell script warning", async () => {
    await command(`open ${crlfShell}`, 1200);
  });

  await action("open second file in another tab", async () => {
    await command(`open ${file2}`, 800);
  });

  await action("enable softwrap for long line", async () => {
    await command("set softwrap on", 1200);
  });

  await action("previous and next tab", async () => {
    await send("\x1bp", 650);
    await send("\x1bt", 650);
  });

  await action("new scratch tab", async () => {
    await send("\x14", 600);
    await type("scratch tab\ncreated by PTY demo");
  });

  await action("mouse click unsaved star opens save command", async () => {
    await send(click(9, options.rows - 1), 750);
    await send("\x1b", 500);
  });

  await action("mouse command and shell icons toggle prompts", async () => {
    await send(click(25, options.rows - 1), 650); // € opens command prompt
    await send(click(25, options.rows - 2), 650); // € closes command prompt
    await send(click(32, options.rows - 1), 650); // $ opens shell prompt
    await send(click(32, options.rows - 2), 650); // $ closes shell prompt
  });

  await action("mouse click first tab", async () => {
    await send(click(2, 0), 800);
  });

  await action("vertical split and pane switch", async () => {
    await command("vsplit", 800);
    await send("\x17", 650);
  });

  await action("mouse click editor pane", async () => {
    await send(click(Math.floor(options.cols * 0.75), 5), 700);
  });

  await action("horizontal split and pane switch", async () => {
    await command("hsplit", 800);
    await send("\x17", 650);
  });

  await action("Ctrl-B interactive shell", async () => {
    await send("\x02", 350); // Ctrl-B
    await type("echo BUNMICRO_CTRL_B_SHELL");
    await send("\r", options.termDelay);
    setTitle("Ctrl-B shell: press Enter to return");
    await send("\r", 900);
  });

  await action("open terminal pane", async () => {
    await command("term", options.termDelay);
    await type("printf 'BUNMICRO_TERM_DEMO\\n'\r", options.termDelay);
    await send("\x1b", 800);
  });

  await action("mouse wheel and editor click", async () => {
    await send(click(10, 8, 65), 500);
    await send(click(10, 8, 64), 500);
    await send(click(12, 6), 700);
  });

  await action("final tab switching", async () => {
    await send("\x1bp", 600);
    await send("\x1bt", 900);
  });
}

async function cleanup() {
  process.stdin.off("data", onInput);
  process.stdout.off("resize", onResize);

  if (proc?.exitCode === null) {
    // Let bunmicro restore the terminal itself first. Escape closes a possible
    // terminal pane; repeated Ctrl-Q/n handles panes, tabs, and save prompts.
    terminal?.write("\x1b");
    await Bun.sleep(250);
    for (let i = 0; i < 12 && proc.exitCode === null; i++) {
      terminal?.write("\x11"); // Ctrl-Q
      await Bun.sleep(180);
      terminal?.write("n");
      await Bun.sleep(120);
    }
    await Promise.race([proc.exited, Bun.sleep(700)]);
  }
  if (proc?.exitCode === null) {
    proc.kill();
    await Promise.race([proc.exited, Bun.sleep(500)]);
  }
  if (terminal && !terminal.closed) terminal.close();
  
  
  let udroot="";
  
  if(isAnci)
  {
    udroot=join(Bun.env.HOME,'.udocker/containers/alpine-toolbox/ROOT')
  }

  if (temp) await rm(udroot+temp, { recursive: true, force: true });


  // Defensive reset in case the child was killed before emitting its teardown.
  process.stdout.write([
    "\x1b[?1000l", // normal mouse tracking
    "\x1b[?1001l", // highlight mouse tracking
    "\x1b[?1002l", // button-event mouse tracking
    "\x1b[?1003l", // any-event mouse tracking
    "\x1b[?1004l", // focus events
    "\x1b[?1005l", // UTF-8 mouse encoding
    "\x1b[?1006l", // SGR mouse encoding
    "\x1b[?1007l", // alternate scroll mode
    "\x1b[?1015l", // urxvt mouse encoding
    "\x1b[?1016l", // SGR pixel mouse encoding
    "\x1b[?2004l", // bracketed paste
    "\x1b[?2026l", // synchronized output
    "\x1b[>4;0m",  // xterm modifyOtherKeys
    "\x1b[<u",     // pop kitty keyboard protocol
    "\x1b[0m",
    "\x1b[?25h",
    "\x1b[?1049l", // leave alternate screen last
  ].join(""));
  if (process.stdin.isTTY) process.stdin.setRawMode(originalRaw);
  process.stdin.pause();
  setTitle(stopped ? "stopped" : "complete");
  process.stdout.write("\n");
}

async function main() {

  let udroot="";
  if(isAnci)
  {
    await Bun.spawn(['fish','-c echo Using fish shell!'],{env:Bun.env}).exited

    temp = '/tmp/bunmicro-pty-demo-'+Bun.randomUUIDv7().slice(0,8);
    udroot=join(Bun.env.HOME,'.udocker/containers/alpine-toolbox/ROOT')
  }
  else
    temp = await mkdtemp(join(tmpdir(), "bunmicro-pty-demo-"));
    
  const configDir = join(temp, "config");
  const file1 = join(temp, "pty-demo-one.txt");
  const file2 = join(temp, "pty-demo-two.txt");
  const unknownFile = join(temp, "pty-demo-redetect");
  const redetectedFile = join(temp, "pty-demo-redetected.js");
  const crlfShell = join(temp, "pty-demo-crlf.sh");
  const syntaxDir = join(configDir, "syntax");
  const themeCount = (await readdir(join(ROOT, "runtime", "colorschemes")))
    .filter((name) => name.endsWith(".micro")).length;
  await mkdir(udroot+configDir, { recursive: true });
  await mkdir(udroot+syntaxDir, { recursive: true });
  await Bun.write(join(udroot,configDir, "settings.json"), JSON.stringify({
    colorscheme: "default",
    mouse: true,
    savecursor: false,
    savehistory: false,
  }, null, 2)); 

  await Bun.write(udroot+file1, DEMO_ONE_TEXT);
  await Bun.write(udroot+file2, DEMO_TWO_TEXT);
  await Bun.write(udroot+unknownFile, `
async function hello(){
  const redetected = 'yes';
  console.log(
    Object.getOwnPropertyNames(
    	  redetected.__proto__
    )
  );
}

await hello();
`);
  await Bun.write(udroot+crlfShell, "#!/bin/sh\r\necho CRLF_SHELL_WARNING\r\n");
  await Bun.write(join(udroot,syntaxDir, "javascript.yaml"), "filetype: javascript\nrules: [invalid yaml");

  console.log([
    "NOTE: The upcoming JavaScript YAML parse failure is intentional.",
    "It demonstrates fallback to bunmicro's built-in JavaScript syntax.",
  ].join("\n"));

  originalRaw = process.stdin.isRaw ?? false;
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on("data", onInput);
  process.stdout.on("resize", onResize);

  terminal = new Bun.Terminal({
    cols: options.cols,
    rows: options.rows,
    data(_terminal, data) {
      process.stdout.write(data);
    },
  });

  let bunArr
  if(isAnci)
  {
    bunArr=['fish','-c',`/android/bin/ldcustom --library-path /android/glibc:/android/bun /android/bun/bun-linux-aarch64 $argv`,'--']
  }
  else
    bunArr=['bun'];
  
  proc = Bun.spawn({
    cmd: [...bunArr, BUNMICRO, "-config-dir", configDir, file1],
    cwd: ROOT,
    terminal,
    env: {
      ...process.env,
      TERM: process.env.TERM || "xterm-256color",
      COLORTERM: process.env.COLORTERM || "truecolor",
      COLUMNS: String(options.cols),
      LINES: String(options.rows),
    },
  });

  setTitle("startup - press q to stop");
  await pause(options.startupDelay);
  await runDemo({ file2, unknownFile, redetectedFile, crlfShell, themeCount });
  await pause(1000);
}

try {
  await main();
} catch (error) {
  if (!stopped) throw error;
} finally {
  await cleanup();
}

function numberArg(name, fallback) {
  const eqArg = process.argv.find((arg) => arg.startsWith(`${name}=`));
  const index = process.argv.indexOf(name);
  const raw = eqArg?.slice(name.length + 1) ?? (index >= 0 ? process.argv[index + 1] : undefined);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number`);
  return Math.floor(value);
}
