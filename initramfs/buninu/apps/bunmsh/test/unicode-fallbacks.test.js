// Chinese and emoji through the fallback builtins: no character is cut in half, no byte is
// changed on the way through, and lengths and positions count characters (code points). The
// expected values are written out here rather than taken from host tools, so they hold
// everywhere. Emoji outside the BMP are two UTF-16 units in JavaScript, which is what most of
// these guard against: "." or substr() taking half of one prints U+FFFD instead.
import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const main = fileURLToPath(new URL("../src/main.js", import.meta.url));
const directory = mkdtempSync(join(tmpdir(), "bunmsh-unicode-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));

// 👍🏽 is a thumb and a skin tone (two code points); 👨‍👩‍👧 is three people joined by ZWJs.
const TEXT = "你好世界\n表情😀👍🏽\n家👨‍👩‍👧\n你好世界\nascii\n";
writeFileSync(join(directory, "文字😀.txt"), TEXT);
writeFileSync(join(directory, "改後🎉.txt"), TEXT.replace("👍🏽", "👍🏿").replace("ascii", "ascii🐉"));
// "m" and a byte that is not UTF-8, then Chinese: it must come out exactly as it went in.
const BAD = Buffer.concat([Buffer.from("m"), Buffer.from([0xff]), Buffer.from("\n中文\n")]);
writeFileSync(join(directory, "bad1.txt"), BAD);
writeFileSync(join(directory, "bad2.txt"), Buffer.concat([Buffer.from("m"), Buffer.from([0xfe]), Buffer.from("\n中文\n")]));
mkdirSync(join(directory, "資料夾🎉"));
writeFileSync(join(directory, "資料夾🎉", "檔案👍.txt"), "內容😀\n");

async function run(script) {
  const child = Bun.spawn([process.execPath, main, "-c", script], {
    cwd: directory, stdin: "ignore", stdout: "pipe", stderr: "pipe",
    env: { ...process.env, LC_ALL: "C", NO_COLOR: "1", FORCE_COLOR: "0" },
  });
  const [status, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).arrayBuffer().then((data) => Buffer.from(data)),
    new Response(child.stderr).text(),
  ]);
  return { status, bytes: stdout, stdout: stdout.toString(), stderr };
}
const REPLACEMENT = "�";
async function expectOutput(script, expected) {
  const result = await run(script);
  expect(result.stderr).toBe("");
  expect(result.stdout).toBe(expected);
  expect(result.stdout).not.toContain(REPLACEMENT);
}

describe("file text passes through unchanged", () => {
  test("cat, tac, head, tail and tee", async () => {
    await expectOutput("builtin cat 文字😀.txt", TEXT);
    await expectOutput("builtin tac 文字😀.txt", TEXT.trimEnd().split("\n").reverse().join("\n") + "\n");
    await expectOutput("builtin head -n 2 文字😀.txt", "你好世界\n表情😀👍🏽\n");
    await expectOutput("builtin tail -n 2 文字😀.txt", "你好世界\nascii\n");
    await expectOutput("builtin cat 文字😀.txt | builtin tee 副本🎉.txt > /dev/null; builtin cat 副本🎉.txt", TEXT);
  });

  test("wc counts bytes and lines, uniq and sort keep the characters", async () => {
    await expectOutput("builtin wc -c < 文字😀.txt", `${Buffer.byteLength(TEXT)}\n`);
    await expectOutput("builtin wc -l < 文字😀.txt", "5\n");
    await expectOutput("printf '甲😀\\n甲😀\\n乙🎉\\n' | builtin uniq -c", "      2 甲😀\n      1 乙🎉\n");
    await expectOutput("printf '甲3😀\\n甲1🎉\\n甲2👍🏽\\n' | builtin sort", "甲1🎉\n甲2👍🏽\n甲3😀\n");
  });

  test("tr maps ASCII and leaves Chinese and emoji alone", async () => {
    await expectOutput("printf 'ab中😀cd\\n' | builtin tr a-z A-Z", "AB中😀CD\n");
  });

  test("cut -c counts characters, an emoji being one", async () => {
    await expectOutput("printf '表情😀👍\\n' | builtin cut -c 3", "😀\n");
    await expectOutput("printf '表情😀👍\\n' | builtin cut -c 2-3", "情😀\n");
  });

  test("md5sum and sha256sum hash the UTF-8 bytes", async () => {
    const md5 = createHash("md5").update(TEXT).digest("hex");
    const sha = createHash("sha256").update(TEXT).digest("hex");
    await expectOutput("builtin md5sum 文字😀.txt", `${md5}  文字😀.txt\n`);
    await expectOutput("builtin sha256sum 文字😀.txt", `${sha}  文字😀.txt\n`);
  });
});

describe("grep, egrep and fgrep", () => {
  test(". and [...] take a whole emoji", async () => {
    await expectOutput("builtin grep -o '情.' 文字😀.txt", "情😀\n");
    await expectOutput("builtin grep -o '情..' 文字😀.txt", "情😀👍\n");
    await expectOutput("builtin grep -o '[😀]' 文字😀.txt", "😀\n");
    await expectOutput("builtin egrep -o '👍.?' 文字😀.txt", "👍🏽\n");
  });

  test("lines, counts, line numbers and ZWJ sequences", async () => {
    await expectOutput("builtin grep 世界 文字😀.txt", "你好世界\n你好世界\n");
    await expectOutput("builtin grep -c 你好 文字😀.txt", "2\n");
    await expectOutput("builtin fgrep -n '👨‍👩‍👧' 文字😀.txt", "3:家👨‍👩‍👧\n");
    await expectOutput("builtin grep -w 你好世界 文字😀.txt", "你好世界\n你好世界\n");
    await expectOutput("builtin grep -v -e 你 -e 家 文字😀.txt", "表情😀👍🏽\nascii\n");
  });

  test("--color wraps the emoji whole", async () => {
    await expectOutput("builtin grep --color=always 😀 文字😀.txt", "表情\x1b[01;31m😀\x1b[m👍🏽\n");
  });

  test("names in Chinese and emoji, from -r and from several operands", async () => {
    await expectOutput("builtin grep -r 😀 資料夾🎉", "資料夾🎉/檔案👍.txt:內容😀\n");
    await expectOutput("builtin grep -l 家 文字😀.txt 改後🎉.txt", "文字😀.txt\n改後🎉.txt\n");
  });

  test("bytes that are not UTF-8 come out as they went in", async () => {
    const result = await run("builtin grep m bad1.txt");
    expect(result.bytes).toEqual(BAD.subarray(0, 3));
    const captured = await run("builtin grep 中 bad1.txt | builtin cat");
    expect(captured.stdout).toBe("中文\n");
  });
});

describe("sed and awk", () => {
  test("sed: . takes a whole emoji; addresses and substitutions keep the text", async () => {
    await expectOutput("builtin sed 's/情./X/' 文字😀.txt | builtin head -n 2", "你好世界\n表X👍🏽\n");
    await expectOutput("builtin sed 's/世./天地/' 文字😀.txt | builtin head -n 1", "你好天地\n");
    await expectOutput("builtin sed -n '/😀/p' 文字😀.txt", "表情😀👍🏽\n");
    await expectOutput("builtin sed 's/👨‍👩‍👧/一家/' 文字😀.txt | builtin sed -n 3p", "家一家\n");
  });

  test("awk: length, substr, index and match count characters, as gawk does", async () => {
    await expectOutput("builtin awk 'NR==2{print length($0), length, length()}' 文字😀.txt", "5 5 5\n");
    await expectOutput("builtin awk 'NR==2{print substr($0,2,2) \"|\" substr($0,3)}' 文字😀.txt", "情😀|😀👍🏽\n");
    await expectOutput("builtin awk 'NR==2{print index($0,\"👍\")}' 文字😀.txt", "4\n");
    await expectOutput("builtin awk 'NR==2{match($0,/😀./); print RSTART, RLENGTH}' 文字😀.txt", "3 2\n");
    await expectOutput("builtin awk 'NR==2{n=split($0,c,\"\"); print n, c[3]}' 文字😀.txt", "5 😀\n");
  });

  // gawk pads and cuts by characters, not by display columns (Bun.stringWidth) or UTF-16 units.
  test("awk: printf widths, precisions and %c count characters, as gawk does", async () => {
    await expectOutput(`builtin awk 'BEGIN{printf "[%-6s][%3s][%.2s][%c][%c]\\n", "表情😀", "中", "😀👍🎉", "😀x", 128512}'`,
      "[表情😀   ][  中][😀👍][😀][😀]\n");
  });

  test("awk: numeric %c truncates fractions before converting code points", async () => {
    await expectOutput(`builtin awk 'BEGIN{printf "[%c][%c]\\n", 65.9, 128512.9}'`, "[A][😀]\n");
  });

  test("awk: separators, gsub and . in Chinese and emoji", async () => {
    await expectOutput("builtin awk -F好 'NR==1{print $2}' 文字😀.txt", "世界\n");
    await expectOutput("builtin awk 'NR==2{gsub(/😀/,\"笑\"); print}' 文字😀.txt", "表情笑👍🏽\n");
    await expectOutput("builtin awk 'NR==2{sub(/情./,\"X\"); print}' 文字😀.txt", "表X👍🏽\n");
    await expectOutput("builtin awk '/👨‍👩‍👧/{print NR\": \"$0}' 文字😀.txt", "3: 家👨‍👩‍👧\n");
  });
});

describe("diff and du", () => {
  test("diff, normal and unified, with emoji in names, labels and lines", async () => {
    await expectOutput("builtin diff 文字😀.txt 改後🎉.txt",
      "2c2\n< 表情😀👍🏽\n---\n> 表情😀👍🏿\n5c5\n< ascii\n---\n> ascii🐉\n");
    await expectOutput("builtin diff -U1 --label 舊版😀 --label 新版👨‍👩‍👧 文字😀.txt 改後🎉.txt",
      // Two unchanged lines apart is within 2 × 1 of context, so GNU makes it one hunk.
      "--- 舊版😀\n+++ 新版👨‍👩‍👧\n@@ -1,5 +1,5 @@\n 你好世界\n-表情😀👍🏽\n+表情😀👍🏿\n 家👨‍👩‍👧\n" +
      " 你好世界\n-ascii\n+ascii🐉\n");
    const header = await run("builtin diff -u 文字😀.txt 改後🎉.txt");
    expect(header.stdout).toStartWith("--- 文字😀.txt\t");
    expect(header.stdout).toContain("\n+++ 改後🎉.txt\t");
  });

  test("diff keeps bytes that are not UTF-8", async () => {
    for (const script of ["builtin diff bad1.txt bad2.txt", "builtin diff -u --label a --label b bad1.txt bad2.txt"]) {
      const result = await run(script);
      expect(result.status).toBe(1);
      expect(result.bytes.includes(Buffer.from([0x6d, 0xff, 0x0a]))).toBe(true);
      expect(result.bytes.includes(Buffer.from([0x6d, 0xfe, 0x0a]))).toBe(true);
    }
  });

  test("du names Chinese and emoji paths", async () => {
    await expectOutput("builtin du -ab 資料夾🎉", `${Buffer.byteLength("內容😀\n")}\t資料夾🎉/檔案👍.txt\n${Buffer.byteLength("內容😀\n")}\t資料夾🎉\n`);
    await expectOutput("builtin du -sb --exclude='檔案*' 資料夾🎉", "0\t資料夾🎉\n");
  });
});

describe("files and paths", () => {
  test("basename, dirname and ls", async () => {
    await expectOutput("builtin basename /路徑/檔案😀.txt .txt", "檔案😀\n");
    await expectOutput("builtin dirname /路徑😀/檔案.txt", "/路徑😀\n");
    const listing = await run("builtin ls 資料夾🎉");
    expect(listing.stdout).toContain("檔案👍.txt");
    expect(listing.stdout).not.toContain(REPLACEMENT);
  });

  test("mkdir, touch, cp, mv and rm with Chinese and emoji names", async () => {
    const result = await run("builtin mkdir 新夾😀 && builtin touch 新夾😀/空👍 && builtin cp 文字😀.txt 新夾😀/複製🎉.txt" +
      " && builtin mv 新夾😀/複製🎉.txt 新夾😀/改名👨‍👩‍👧.txt && builtin rm 新夾😀/空👍");
    expect(result).toMatchObject({ status: 0, stderr: "" });
    expect(readFileSync(join(directory, "新夾😀", "改名👨‍👩‍👧.txt"), "utf8")).toBe(TEXT);
    expect(existsSync(join(directory, "新夾😀", "空👍"))).toBe(false);
    expect(existsSync(join(directory, "新夾😀", "複製🎉.txt"))).toBe(false);
  });
});
