# Reconnect mode tests

No extra dependencies are needed. Use an already installed Chromium:

```sh
node --test tests/client-modes.test.mjs tests/client-exit.test.mjs tests/reconnect-modes.test.js
bun test tests/nested-cli-pty.test.mjs
CHROMIUM_HEADLESS=/usr/local/bin/chromium-headless-shell node --test tests/reconnect-modes-browser.test.js tests/kitty-keyboard-browser.test.js
```

- `reconnect-modes-browser.test.js` runs the shipped xterm in real Chromium. It simulates browser → CLI → CLI output routing using the production mode trackers and transition code. It drops the browser, middle, and inner connections independently, changes modes while disconnected, and reconnects. Each dropped session is also attached directly to a newly constructed, clean xterm. It checks queued old output, new output after restoration, idempotent snapshots, mouse protocol/encoding, DEC flags, both screens' Kitty stacks, and the private reply.
- `nested-cli-pty.test.mjs` runs two actual `client.mjs` processes using Bun PTYs and WebSockets. Minimal server fixtures implement attach/output/detach with production mode trackers. It checks inner and middle disconnects, direct attachments from clean terminal models, changes while detached, parent restoration, and Super-X forwarding through both clients. The outer terminal model's reply is independently checked against real xterm by the browser test.
- `client-modes.test.mjs` checks fragmented replies, unknown modes, fallback, raw-mode restoration, transparent ordinary input/large pastes, foreign nonces, and that startup reply filtering does not consume later application queries indefinitely.

These are mode/input-state tests, not screen-content replay tests. The minimal servers are not a replacement for testing the full GoTTY server's session lifecycle. Forced process death (SIGKILL), without a chance to execute cleanup, cannot restore the local terminal.

## Private query and native terminal compatibility

The query is `ESC ] 777 ; jsgotty-modes ; <32 hex nonce> BEL`. The browser replies once with `ESC ] 777 ; jsgotty-modes ; <same nonce> ; <base64 JSON snapshot> BEL`. A new nonce prevents replies intended for a nested client from being consumed by a different layer. Only the browser extension implements this query; it is not a standard terminal query.

Upstream source inspection (not GUI runtime testing):

- Ghostty, revision `8ef0ec1238220a5a714be452ed2844f0691fcf83`: [OSC dispatch](https://github.com/ghostty-org/ghostty/blob/8ef0ec1238220a5a714be452ed2844f0691fcf83/src/terminal/osc.zig), [rxvt extension parser](https://github.com/ghostty-org/ghostty/blob/8ef0ec1238220a5a714be452ed2844f0691fcf83/src/terminal/osc/parsers/rxvt_extension.zig). OSC 777 accepts `notify`; `jsgotty-modes` takes the unknown-extension branch, logs `unknown rxvt extension: jsgotty-modes`, returns null, and produces no terminal reply or notification. Thus this probe is not silent in Ghostty's diagnostic log.
- Konsole, revision `a25cd724d5790fbe9cda01db63d478ff7eba8d7b`: [Vt102Emulation](https://github.com/KDE/konsole/blob/a25cd724d5790fbe9cda01db63d478ff7eba8d7b/src/Vt102Emulation.cpp), [Session](https://github.com/KDE/konsole/blob/a25cd724d5790fbe9cda01db63d478ff7eba8d7b/src/session/Session.cpp), [ContainerRegistry](https://github.com/KDE/konsole/blob/a25cd724d5790fbe9cda01db63d478ff7eba8d7b/src/containers/ContainerRegistry.cpp). OSC 777 emits an internal Qt signal; its built-in handlers accept `notify` or `container`. `jsgotty-modes` matches neither, so no terminal reply, notification, or container change results.

OSC 777 is already used for rxvt-style extensions; the jsgotty subcommand avoids `notify` and `container`, but future or third-party terminal handlers are not covered by this review.

After 200 ms without the private reply, the CLI requests standard DECRQM and Kitty flags, with a total startup timeout of 1 second. Unsupported/unanswered fields remain unknown rather than becoming guessed defaults. Standard Kitty queries report current flags, not the hidden stack. Full stack restoration is therefore available between updated jsgotty clients/browser; native terminals cannot promise restoration of pre-existing hidden entries if the remote application itself pops them. The CLI never clears an arbitrary 100 entries.

Startup standard replies are consumed at most once per requested mode, with a bounded late-reply window. Standard replies have no nonce: a reply to an application's identical query during that short outstanding window cannot be distinguished perfectly from a delayed startup reply.

## Native mouse switches and exit ordering

Standard probing also retains optional `mouseModeBits` and `mouseEncodingBits`, with boolean values for answered switches and null for silence. For multiple active replies, the effective priority is explicitly ANY > DRAG > VT200 > X10 and SGR_PIXELS > SGR. This is a compatibility policy for the represented modes, not a claim that larger DEC numbers universally win. Cleanup restores the recorded switches (known disabled first, enabled in increasing priority); partial replies do not invent values for unanswered switches. CLI attachment to a known session normalizes the whole represented group before enabling its effective mode, even when the local aggregate name matches, because native terminals may retain independent hidden switches. Server tracking continues to follow xterm's exclusive-mode semantics.

The tests exercise both independent-switch and exclusive-mode terminal models, downgrade from stronger modes, unchanged aggregates with conflicting underlying switches, and partial replies. `client-exit.test.mjs` executes the production exit handlers with delayed stdout callbacks: the first exit request wins, subsequent bytes/signals do not schedule a second exit, and exit still waits for stdout to flush.

## Preserve screen contents during hidden Kitty restoration

A private snapshot reply now advertises `kittyRestore: 1`. Only after receiving that capability may the CLI emit `OSC 777 ; jsgotty-kitty-v1 ; normal|alternate ; flags ; comma-separated-stack BEL` (an empty stack has an empty last field). This updates the named Kitty state in place; it never activates either screen. The browser masks unsupported flags as usual. Intermediate session trackers recognize bounded, validated BEL/ST-terminated commands so reconnect snapshots continue to match the terminal.

Without this capability, a mode-only transition leaves the inactive stack unchanged. It must not use a temporary `?1047l`/`?1047h` roundtrip: xterm clears the alternate buffer when leaving it, destroying the visible fullscreen contents even if the final active screen is unchanged. A requested screen change can still restore each stack while that screen is naturally active. Native/older terminals therefore retain a limitation on restoring inactive Kitty state; preserving visible contents takes precedence.

The real Chromium test now checks visible rows and cursor coordinates on both normal and alternate screens, with negotiated restoration and without the capability. It also checks that the advertised extension restores the hidden stack, alongside the existing nested-disconnect/direct-fresh-attach scenarios. Tracker tests cover byte-split commands, BEL/ST termination, cancellation, malformed values, oversized stacks, and unrelated DCS strings.
