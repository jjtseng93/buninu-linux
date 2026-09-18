// diff.js — JS port of the Lua diff plugin (Go parity)
// When diffgutter is enabled, fetches git HEAD content and sets it as the
// diff base so the editor can show added/modified/removed gutter markers.
//
// Go behavior (diff.lua):
//   1. Skip scratch buffers or buffers with no path.
//   2. Check the file exists on disk; skip if not.
//   3. Run: git -C <dir> show HEAD:./<file>
//   4. On git failure (not tracked / no commits): set diffBase = current file
//      content — this produces no gutter markers (base == current).
//   5. On success: set diffBase = git HEAD content.

import { dirname, basename } from "node:path";
import { existsSync } from "node:fs";

const _hasGit = await Bun.which("git") !== null;

micro.on("onBufferOpen", async (buffer) => {
  if (!_hasGit) return;
  if (!buffer.Settings?.diffgutter) return;
  if (buffer.Type?.Scratch) return;
  const absPath = buffer.AbsPath || buffer.Path;
  if (!absPath) return;

  // Go: os.Stat check — only proceed if the file exists on disk
  try { if (!existsSync(absPath)) return; } catch { return; }

  const dir = dirname(absPath);
  const file = basename(absPath);
  try {
    const proc = Bun.spawn(["git", "-C", dir, "show", `HEAD:./${file}`], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const exitCode = await proc.exited;
    if (exitCode === 0) {
      const text = await new Response(proc.stdout).text();
      buffer.SetDiffBase(text);
    } else {
      // Go: on git failure set diffBase = current content (no markers shown)
      buffer.SetDiffBase(buffer.Bytes ? buffer.Bytes() : "");
    }
  } catch (e) {
    // Go: on error set diffBase = current content (no markers shown)
    buffer.SetDiffBase(buffer.Bytes ? buffer.Bytes() : "");
  }
});
