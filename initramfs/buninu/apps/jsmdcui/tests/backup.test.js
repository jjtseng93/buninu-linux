import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  BACKUP_SUFFIX,
  applyBackup,
  determineBackupPath,
  removeBackup,
  writeBackup,
} from "../src/buffer/backup.js";

const cleanup = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function tempDir() {
  const path = await mkdtemp(join(tmpdir(), "bunmicro-backup-"));
  cleanup.push(path);
  return path;
}

function buffer(path, text = "changed") {
  return {
    path,
    AbsPath: path,
    type: "default",
    lines: text.split("\n"),
    Settings: { backup: true, backupdir: "", permbackup: false },
    _savedSerial: 0,
    setModified(value) { this.modified = Boolean(value); },
  };
}

describe("go-micro compatible backup paths", () => {
  test("uses Go url.QueryEscape-compatible names", async () => {
    const dir = await tempDir();
    const result = determineBackupPath(dir, "/tmp/a b%~!'()*.txt");
    expect(result).toEqual({
      name: join(dir, "%2Ftmp%2Fa+b%25~%21%27%28%29%2A.txt"),
      resolveName: null,
    });
  });

  test("prefers an existing legacy name", async () => {
    const dir = await tempDir();
    const legacy = join(dir, "%tmp%legacy.txt");
    await writeFile(legacy, "legacy");
    expect(determineBackupPath(dir, "/tmp/legacy.txt").name).toBe(legacy);
  });

  test("uses Go's full MD5 hash and .path sidecar for long names", async () => {
    const dir = await tempDir();
    const path = "/" + "x".repeat(300);
    const hash = createHash("md5").update(path).digest("hex");
    expect(determineBackupPath(dir, path)).toEqual({
      name: join(dir, hash),
      resolveName: join(dir, hash + ".path"),
    });
  });
});

describe("backup lifecycle", () => {
  test("writes atomically using the Go backup suffix", async () => {
    const root = await tempDir();
    const backupDir = join(root, "backups");
    const buf = buffer("/tmp/file.txt", "one\ntwo");
    buf.Settings.backupdir = backupDir;
    const target = determineBackupPath(backupDir, buf.AbsPath);

    expect(await writeBackup(buf, root)).toBe(true);
    expect(await readFile(target.name, "utf8")).toBe("one\ntwo");
    expect(existsSync(target.name + BACKUP_SUFFIX)).toBe(false);
  });

  test("recover keeps the backup and marks a distinct dirty baseline", async () => {
    const root = await tempDir();
    const backupDir = join(root, "backups");
    await mkdir(backupDir);
    const buf = buffer("/tmp/file.txt", "disk");
    buf.Settings.backupdir = backupDir;
    const target = determineBackupPath(backupDir, buf.AbsPath);
    await writeFile(target.name, "recovered");

    expect(await applyBackup(buf, root, async () => "recover")).toEqual({ recovered: true, abort: false });
    expect(buf.lines).toEqual(["recovered"]);
    expect(buf.modified).toBe(true);
    expect(buf._savedSerial).toBe(-1);
    expect(existsSync(target.name)).toBe(true);
  });

  test("ignore removes the backup", async () => {
    const root = await tempDir();
    const backupDir = join(root, "backups");
    await mkdir(backupDir);
    const buf = buffer("/tmp/file.txt");
    buf.Settings.backupdir = backupDir;
    const target = determineBackupPath(backupDir, buf.AbsPath);
    await writeFile(target.name, "ignored");

    expect(await applyBackup(buf, root, async () => "ignore")).toEqual({ recovered: false, abort: false });
    expect(existsSync(target.name)).toBe(false);
  });

  test("permanent backups survive removal", async () => {
    const root = await tempDir();
    const backupDir = join(root, "backups");
    const buf = buffer("/tmp/file.txt");
    buf.Settings.backupdir = backupDir;
    buf.Settings.permbackup = true;
    await writeBackup(buf, root);
    const target = determineBackupPath(backupDir, buf.AbsPath);

    removeBackup(buf, root);
    expect(existsSync(target.name)).toBe(true);
  });

  test("forced safe-write backups work when periodic backups are disabled", async () => {
    const root = await tempDir();
    const backupDir = join(root, "backups");
    const buf = buffer("/tmp/file.txt");
    buf.Settings.backupdir = backupDir;
    buf.Settings.backup = false;

    expect(await writeBackup(buf, root)).toBe(false);
    expect(await writeBackup(buf, root, buf.AbsPath, { force: true })).toBe(true);
    expect(existsSync(determineBackupPath(backupDir, buf.AbsPath).name)).toBe(true);
  });

  test("mdcui buffers never write, recover, or remove backups", async () => {
    const root = await tempDir();
    const backupDir = join(root, "backups");
    await mkdir(backupDir);
    const buf = buffer("/tmp/file.md", "rendered markdown");
    buf.Settings.backupdir = backupDir;
    buf.encoding = "mdcui";
    buf.Settings.encoding = "mdcui";
    const target = determineBackupPath(backupDir, buf.AbsPath);

    expect(await writeBackup(buf, root)).toBe(false);
    expect(await writeBackup(buf, root, buf.AbsPath, { force: true })).toBe(false);
    expect(existsSync(target.name)).toBe(false);

    await writeFile(target.name, "utf8 editor recovery");
    let prompted = false;
    expect(await applyBackup(buf, root, async () => { prompted = true; return "recover"; }))
      .toEqual({ recovered: false, abort: false });
    expect(prompted).toBe(false);
    expect(buf.lines).toEqual(["rendered markdown"]);

    removeBackup(buf, root);
    expect(existsSync(target.name)).toBe(true);
  });
});
