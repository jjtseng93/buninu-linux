// /lib/bunterm/clipboard.js — OSC 52 clipboard for bunterm, backed by xclip.
//
//   program ── ESC ] 52 ; c ; <base64> BEL ──▶ xclip -selection clipboard
//   program ── ESC ] 52 ; c ; ? BEL ─────────▶ xclip -selection clipboard -o
//           ◀── ESC ] 52 ; c ; <base64> BEL ──
//
// bunterm keeps nothing itself: every copy and paste goes through xclip, so
// all bunterm sessions (and anything else using xclip) share one clipboard.
// Buninu's xclip prints status lines on stderr, which must not reach the
// console under the framebuffer, so stderr is discarded.

const runXclip = async (args, input) => {
  const command = ["xclip", "-selection", "clipboard", ...args];
  const proc = Bun.spawn(command, {
    stdin: input === undefined ? "ignore" : input,
    stdout: input === undefined ? "pipe" : "ignore",
    stderr: "ignore",
  });
  const [output, exitCode] = await Promise.all([
    input === undefined ? new Response(proc.stdout).arrayBuffer() : null,
    proc.exited,
  ]);
  if (exitCode !== 0) throw new Error(`${command.join(" ")} exited with ${exitCode}`);
  return output;
};

// Registers the OSC 52 handler on an xterm.js terminal. `reply` sends bytes
// back to the program, as the terminal's other replies do. A read the xclip
// call cannot answer is still answered, with empty contents, so the program
// does not wait out its own timeout.
export const attachClipboard = ({ term, reply, onError = () => {} }) =>
  term.parser.registerOscHandler(52, (data) => {
    const separator = data.indexOf(";");
    if (separator < 0) return true;
    const target = data.slice(0, separator);
    const payload = data.slice(separator + 1);

    if (payload === "?") {
      runXclip(["-o"])
        .catch((error) => { onError(error); return new ArrayBuffer(0); })
        .then((bytes) => reply(`\u001b]52;${target};${Buffer.from(bytes).toString("base64")}\u0007`));
      return true;
    }

    runXclip([], Buffer.from(payload, "base64")).catch(onError);
    return true;
  });
