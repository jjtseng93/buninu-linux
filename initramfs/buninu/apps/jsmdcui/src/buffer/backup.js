// Crash recovery backup system compatible with Go micro's internal/buffer/backup.go.

import { join } from "node:path";
import { existsSync, statSync, unlinkSync } from "node:fs";
import { mkdir, writeFile, readFile, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { isMdcuiEncoding } from "../runtime/encodings.js";

export const BACKUP_SUFFIX = ".micro-backup";

function isMdcuiBuffer(buf) {
  return isMdcuiEncoding(buf?.encoding ?? buf?.Settings?.encoding);
}

export function getBackupDir(buf, configDir) {
  const raw = String(buf?.Settings?.backupdir ?? "");
  if (!raw) return join(configDir, "backups");
  if (raw === "~" || raw.startsWith("~/") || raw.startsWith("~\\")) {
    return raw.replace(/^~/, homedir());
  }
  // Node has no portable equivalent of Go's user.Lookup for ~otheruser.
  if (raw.startsWith("~")) return join(configDir, "backups");
  return raw;
}

function queryEscapePath(path) {
  return encodeURIComponent(String(path).replaceAll("\\", "/"))
    .replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%20/g, "+"); 
} // '

function legacyEscapePath(path) {
  let escaped = String(path).replaceAll("\\", "/");
  if (process.platform === "win32") escaped = escaped.replaceAll(":", "%");
  return escaped.replaceAll("/", "%");
}

export function determineBackupPath(backupDirPath, absPath) {
  const urlName = join(backupDirPath, queryEscapePath(absPath));
  if (existsSync(urlName)) return { name: urlName, resolveName: null };

  const legacyName = join(backupDirPath, legacyEscapePath(absPath));
  if (existsSync(legacyName)) return { name: legacyName, resolveName: null };

  if (Buffer.byteLength(urlName + BACKUP_SUFFIX) > 255) {
    const hash = createHash("md5").update(absPath).digest("hex");
    return {
      name: join(backupDirPath, hash),
      resolveName: join(backupDirPath, hash + ".path"),
    };
  }
  return { name: urlName, resolveName: null };
}

export async function writeBackup(buf, configDir, path = buf?.AbsPath ?? buf?.path, { force = false } = {}) {
  if (isMdcuiBuffer(buf) || (!force && !buf?.Settings?.backup) || !path || buf.type !== "default") return false;
  const dir = getBackupDir(buf, configDir);
  await mkdir(dir, { recursive: true });
  const { name, resolveName } = determineBackupPath(dir, path);
  const tmp = name + BACKUP_SUFFIX;
  try {
    await writeFile(tmp, buf.lines.join("\n"), "utf8");
    await rename(tmp, name);
    if (resolveName) await writeFile(resolveName, path, "utf8");
    return true;
  } catch (error) {
    try { unlinkSync(tmp); } catch {}
    throw error;
  }
}

export function removeBackup(buf, configDir, path = buf?.AbsPath ?? buf?.path) {
  if (isMdcuiBuffer(buf) || buf?.Settings?.permbackup || buf?._forceKeepBackup) return;
  if (!path || buf.type !== "default") return;
  const dir = getBackupDir(buf, configDir);
  const { name, resolveName } = determineBackupPath(dir, path);
  try { unlinkSync(name); } catch {}
  if (resolveName) try { unlinkSync(resolveName); } catch {}
}

// promptFn(msg) -> Promise<string>
// Returns { recovered: bool, abort: bool }
export async function applyBackup(buf, configDir, promptFn) {
  if (isMdcuiBuffer(buf) || !buf?.Settings?.backup || buf?.Settings?.permbackup) return { recovered: false, abort: false };
  if (!buf.path || buf.type !== "default") return { recovered: false, abort: false };

  const dir = getBackupDir(buf, configDir);
  const { name: backupFile, resolveName } = determineBackupPath(dir, buf.AbsPath ?? buf.path);
  if (!existsSync(backupFile)) return { recovered: false, abort: false };

  let info;
  try { info = statSync(backupFile); } catch { return { recovered: false, abort: false }; }

  const t = info.mtime;
  const dateStr =
    t.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) +
    " at " +
    t.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }) +
    ", " + t.getFullYear();

  const ticcc='```';

  const msg = `
# Backup detected! ⚠️
- File path/url:
${ticcc}
${buf.path}
${ticcc}
- either micro crashed
- or another micro is running
- or an error occurred while saving
- The file may be corrupted
# Date of backup 🕰
- ${dateStr}
# Path of backup 
${ticcc}
${backupFile}
${ticcc}
# Recovery options
## r = 'recover'
- Apply the backup 
- as unsaved changes to the current buffer
- When the buffer is closed, the backup will be removed.
## i = 'ignore'
- Ignore & remove the backup
## a = 'abort' 
- Abort the open operation
- Open an empty buffer
- Keep the backup
### Your choice
- [r]ecover, [i]gnore, [a]bort
`;

  const options = ["r", "i", "a", "recover", "ignore", "abort"];
  let choice = -1;
  let prompt = msg;
  while (choice === -1) {
    const resp = await promptFn(prompt);
    const idx = options.indexOf(resp.trim().toLowerCase());
    if (idx !== -1) choice = idx % 3;
    else prompt = "\n#### Invalid choice!";
  }

  if (choice === 0) {
    try {
      const text = await readFile(backupFile, "utf8");
      buf.lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
      if (!buf.lines.length) buf.lines = [""];
      buf._recovered = true;
      buf._savedSerial = -1;
      buf.setModified?.(true);
      if (!buf.setModified) buf.modified = true;
      return { recovered: true, abort: false };
    } catch {
      return { recovered: false, abort: false };
    }
  }
  if (choice === 1) {
    try { unlinkSync(backupFile); } catch {}
    if (resolveName) try { unlinkSync(resolveName); } catch {}
    return { recovered: false, abort: false };
  }
  return { recovered: false, abort: true };
}
