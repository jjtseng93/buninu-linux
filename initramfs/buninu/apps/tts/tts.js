#!/usr/bin/env bun

// Wraps native-bridge's raw speak()/ttsStatus() -- which never block, since
// TextToSpeech's completion signal is a callback the far side has no way to
// push to us over this protocol -- in the polling loop most callers actually
// want. Invoked as a subprocess this necessarily blocks the caller until
// speech finishes (or --async is given): that is expected, the same as any
// other CLI tool that waits for the thing it started.
import { speak, ttsStatus, available } from "../native-bridge/native-bridge.js"

// Buninu is cross-OS, not just Android: when native-bridge isn't available,
// fall back to a locally-spawned platform TTS command instead of just
// failing. This block is copied verbatim from jsmdcui's own
// src/index.js detectTtsCmd() (same pitch/speed/lang math, same command
// construction) rather than reimplemented, since the PowerShell quoting in
// the win32 branch is exactly the kind of thing that is easy to silently
// break by hand-retyping and hard to verify without a real Windows machine.
//
// One deliberate omission from the original: it ends with an
// `if (Bun.which("tts")) return {cmd:['tts'],via:'arg'}` fallback. Calling
// that from inside this exact script (also registered as Buninu's "tts"
// command, ahead of anything else named "tts" on PATH) would just be this
// script invoking itself -- the same self-reference risk xclip.js avoids
// around ClipboardManager's own "xclip" search, so it is left out here.
function detectTtsCmd(speed, pitch) {
  const platform = process.platform;

  const lang = process.env.TTS_LANG || 'zh-TW'
  process.env.TTS_LANG = lang ;

  if (platform === "android") {
    if (Bun.which("termux-tts-speak"))
      return { cmd: ["termux-tts-speak", "-p", String(pitch), "-r", String(speed)], via: "arg" };
  }

  if (platform === "darwin") {
    // say -r <wpm>; pitch via [[pbas n]] embedded TTS command (0-127, 48 = normal)
    const rate = Math.round(175 * speed);
    const pitchN = Math.max(0, Math.min(127, Math.round(48 * pitch)));
    return {
      cmd: ["say", "-r", String(rate)],
      via: "arg",
      textTransform: pitchN !== 48 ? (t) => `[[pbas ${pitchN}]] ${t}` : null,
    };
  }

  if (platform === "win32") {
    // Rate property: -10 to 10 (0 = normal); pitch via SSML <prosody>
    const rate = Math.max(-10, Math.min(10, Math.round((speed - 1) * 10)));
    const pitchPct = Math.round((pitch - 1) * 100);
    const pitchAttr = (pitchPct >= 0 ? "+" : "") + pitchPct + "%";
    for (const shell of ["pwsh.exe", "powershell.exe"]) {
      if (Bun.which(shell)) {
        const psCmd =
          "Add-Type -AssemblyName System.Speech; " +
          `$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Rate = ${rate}; ` +
          `$t = [Console]::In.ReadToEnd(); ` +
          `$x = [System.Security.SecurityElement]::Escape($t); ` +
          `$s.SpeakSsml('<speak xml:lang="${lang}" version="1.0" xmlns="http://www.w3.org/2001/10/synthesis"><prosody pitch="${pitchAttr}">' + $x + '</prosody></speak>')`;
        return { cmd: [shell, "-NoProfile", "-Command", psCmd], via: "stdin" };
      }
    }
  }

  // Linux / Android fallback: espeak-ng / espeak
  // Speed: -s <wpm> (175 = normal), Pitch: -p <n> (0-99, 50 = normal)
  for (const bin of ["espeak-ng", "espeak"]) {
    if (Bun.which(bin)) {
      const spd = Math.round(175 * speed);
      const pit = Math.max(0, Math.min(99, Math.round(50 * pitch)));
      return { cmd: [bin, '-s', spd, '-p', pit], via: "arg" };
    }
  }

  return null;
}

// Also copied verbatim (as the spawn side of the same jsmdcui code path,
// runTts) other than operating on the whole text at once instead of
// per-sentence, since a CLI invocation has no buffer/cursor to highlight
// against sentence by sentence the way the jsmdcui TUI does.
async function speakViaPlatformCommand(text, cmd) {
  const spawnOpts = { stdout: "ignore", stderr: "ignore", env: process.env };
  spawnOpts.stdin = cmd.via === "stdin" ? new Blob([text]) : "ignore";

  if (cmd.via === "arg") {
    text = (text + "")
      .replace(/^-+/, "")
      .replaceAll("`", "")
      .replaceAll("$", "");
    if (cmd.textTransform) text = cmd.textTransform(text);
  }
  const args = cmd.via === "arg" ? [...cmd.cmd, text] : cmd.cmd;
  const proc = Bun.spawn(args, spawnOpts);
  return await proc.exited;
}

// Not too short: each tick is a full unix-socket round trip, and TTS
// utterances run several seconds at minimum, so polling faster just burns
// cycles without getting the answer any sooner.
const POLL_MS = 500

// No wall-clock cap by default. Real TTS tooling doesn't invent one: espeak-ng
// has no timeout concept at all (its man page documents speed/pitch/gaps but
// nothing about how long it may block), and Windows SAPI's WaitUntilDone
// treats -1 ("wait forever") as the documented default -- a fixed cap here
// would just mean this tool gives up early on long text, which has nothing
// to do with the host actually being broken. The loop below still can't hang
// on a genuinely dead host: each poll has call()'s own 5s timeout (throws,
// caught below), and the loop condition itself already exits the moment
// status leaves "speaking" -- "unknown"/"error" are the real failure signal,
// not a timer. Pass --timeout to opt into a bounded wait instead.
const argv = process.argv.slice(2)

if (argv.includes("--help") || argv.includes("-h")) {
  console.log(`
 Usage: tts <text>
  tts "hello world"
  tts -f "interrupt and say this instead"
  tts -a "say this, don't wait for it to finish"
  tts --timeout 30000 "give up after 30s if still speaking"
  tts --pitch 1.2 --speed 0.8 "slower and higher-pitched"

 -f, --flush       interrupt whatever is currently speaking
 -a, --async       print the handle and exit immediately instead of polling
 --timeout <ms>    give up and exit non-zero after this long (default: none,
                    wait as long as it takes -- matches espeak-ng/SAPI)
 --pitch <n>       1.0 is normal (default: $TTS_PITCH, or 1 if unset)
 --speed <n>       1.0 is normal (default: $TTS_SPEED, or 1 if unset)
`)
  process.exit(0)
}

const flush = argv.includes("-f") || argv.includes("--flush")
const isAsync = argv.includes("-a") || argv.includes("--async")

const optValue = (flag, envFallback) => {
  const i = argv.indexOf(flag)
  const raw = i !== -1 ? argv[i + 1] : process.env[envFallback]
  const n = Number(raw)
  return Number.isFinite(n) ? n : 1
}
const timeoutIdx = argv.indexOf("--timeout")
const maxWaitMs = timeoutIdx !== -1 ? Number(argv[timeoutIdx + 1]) : null
const pitch = optValue("--pitch", "TTS_PITCH")
const speed = optValue("--speed", "TTS_SPEED")

const valueFlags = new Set(["--timeout", "--pitch", "--speed"])
const text = argv.find((a, i) => !a.startsWith("-") && !valueFlags.has(argv[i - 1])) ?? ""

if (!available()) {
  // No Android native bridge -- fall back to a local platform TTS command
  // (see detectTtsCmd() above). flush/polling/handles are all native-bridge
  // concepts specific to Android's async TextToSpeech callback; there is no
  // equivalent "interrupt what's currently speaking" here, so -f/--flush is
  // silently a no-op on this path.
  const cmd = detectTtsCmd(speed, pitch)
  if (!cmd) {
    console.error("no TTS backend found: no native bridge, and no termux-tts-speak/say/PowerShell/espeak-ng/espeak on PATH")
    process.exit(1)
  }

  if (isAsync) {
    speakViaPlatformCommand(text, cmd)
    process.exit(0)
  }

  const code = await speakViaPlatformCommand(text, cmd)
  process.exit(code === 0 ? 0 : 1)
}

let handle
try {
  handle = await speak(text, speed, pitch, flush)
} catch (e) {
  console.error(`speak failed: ${e.message}`)
  process.exit(1)
}

if (isAsync) {
  console.log(handle)
  process.exit(0)
}

const start = Date.now()
let status = "speaking"

while (status === "speaking") {
  if (maxWaitMs != null && Date.now() - start > maxWaitMs) {
    console.error(`tts: gave up waiting for "${handle}" after ${maxWaitMs}ms`)
    process.exit(1)
  }

  await new Promise(resolve => setTimeout(resolve, POLL_MS))

  try {
    status = await ttsStatus(handle)
  } catch (e) {
    console.error(`ttsStatus failed: ${e.message}`)
    process.exit(1)
  }
}

if (status === "error") {
  console.error(`tts: "${handle}" reported an error`)
  process.exit(1)
}

if (status === "unknown") {
  console.error(`tts: "${handle}" went unknown before finishing`)
  process.exit(1)
}

process.exit(0)
