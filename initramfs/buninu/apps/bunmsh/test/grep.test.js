import { expect, test } from "bun:test";
import { runGrep as runGrepBytes } from "../src/grep.js";

// stdout comes back as the bytes read; these tests compare it as text.
const runGrep = async (...args) => {
  const result = await runGrepBytes(...args);
  return { ...result, stdout: Buffer.from(result.stdout).toString() };
};

function input(parts) {
  return () => new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(Buffer.from(part));
      controller.close();
    },
  });
}

test("-I classifies the first available chunk before publishing matches", async () => {
  for (const parts of [["match\nlater\0data\n"], ["", "match\nlater\0data\n"]]) {
    for (const options of [[], ["-c"], ["-l"], ["-q"]]) {
      const result = await runGrep(["grep", "-I", ...options, "match"], { input: input(parts) });
      expect(result).toEqual({ status: 1, stdout: options.includes("-c") ? "0\n" : "", stderr: "" });
    }
  }
});

test("-I stays streaming after a bounded binary probe", async () => {
  const prefix = "x".repeat(32767) + "\n";
  const result = await runGrep(["grep", "-Ic", "match"], { input: input([prefix, "match\n", "\0"]) });
  expect(result).toEqual({ status: 0, stdout: "1\n", stderr: "" });
});

test("-c -m0 prints zero and preserves requested labels without reading input", async () => {
  expect(await runGrep(["grep", "-c", "-m0", "match"], { input: input([]) }))
    .toEqual({ status: 1, stdout: "0\n", stderr: "" });
  expect(await runGrep(["grep", "-Hc", "-m0", "match"], { input: input([]) }))
    .toEqual({ status: 1, stdout: "(standard input):0\n", stderr: "" });
  expect(await runGrep(["grep", "-lc", "-m0", "match"], { input: input([]) }))
    .toEqual({ status: 1, stdout: "", stderr: "" });
});


test("-I preserves published matches when later chunks contain NUL", async () => {
  expect(await runGrep(["grep", "-Ic", "match"], { input: input(["match\n", "\0"]) }))
    .toEqual({ status: 0, stdout: "1\n", stderr: "" });
});

test("-q suppresses counts and filenames even without matches", async () => {
  for (const flags of ["-qc", "-qL", "-qIc", "-qIL"]) {
    for (const text of ["other\n", "other\0data\n", ""]) {
      expect(await runGrep(["grep", flags, "match"], { input: input([text]) }))
        .toEqual({ status: 1, stdout: "", stderr: "" });
    }
  }
});

test("binary options use their argument order, including combined switches", async () => {
  for (const [options, matches] of [
    [["-Ia"], true], [["-aI"], false],
    [["-I", "--binary-files=text"], true],
    [["-a", "--binary-files=without-match"], false],
    [["--binary-files=without-match", "--text"], true],
    [["--text", "-I"], false],
    [["-I", "--binary-files=binary", "-a"], true],
  ]) {
    expect(await runGrep(["grep", ...options, "match"], { input: input(["match\0x\n"]) }))
      .toEqual({ status: matches ? 0 : 1, stdout: matches ? "match\0x\n" : "", stderr: "" });
  }
});

test("-I processes a complete line while the producer remains open", async () => {
  for (const options of [["-q"], ["-m1"], ["--line-buffered"]]) {
    let controller, timer, finished = false, output = "";
    let signal;
    const written = new Promise(resolve => { signal = resolve; });
    const stream = new ReadableStream({ start(c) { controller = c; c.enqueue(Buffer.from("match\n")); } });
    const running = runGrep(["grep", "-I", ...options, "match"], {
      input: () => stream,
      write: data => { output += Buffer.from(data).toString(); signal(); },
    }).then(result => { finished = true; return result; });
    try {
      const outcome = await Promise.race([
        (options.includes("--line-buffered") ? written : running).then(() => "ready"),
        new Promise(resolve => { timer = setTimeout(() => resolve("timeout"), 1000); }),
      ]);
      expect(outcome).toBe("ready");
      if (!options.includes("-q")) expect(output).toBe("match\n");
    } finally {
      clearTimeout(timer);
      if (!finished) { try { controller.close(); } catch {} }
      await running;
    }
  }
});

test("bytes that are not UTF-8 come out as they went in", async () => {
  const data = Buffer.from([0x6d, 0xff, 0x0a, 0xe4, 0xb8, 0xad, 0x80, 0x6d, 0x0a, 0x6e, 0x0a]);
  const lines = await runGrepBytes(["grep", "m"], { input: () => new ReadableStream({
    start(controller) { controller.enqueue(data); controller.close(); },
  }) });
  expect(Buffer.from(lines.stdout)).toEqual(data.subarray(0, 9));
  const only = await runGrepBytes(["grep", "-o", "中."], { input: () => new ReadableStream({
    start(controller) { controller.enqueue(data); controller.close(); },
  }) });
  expect(Buffer.from(only.stdout)).toEqual(Buffer.from([0xe4, 0xb8, 0xad, 0x80, 0x0a]));
});

test("a UTF-8 character split across chunks still matches", async () => {
  const data = Buffer.from("前中後\n");
  expect(await runGrep(["grep", "中"], { input: input([data.subarray(0, 4), data.subarray(4)]) }))
    .toEqual({ status: 0, stdout: "前中後\n", stderr: "" });
});

test("messages stream between the output around them", async () => {
  const events = [];
  const result = await runGrep(["grep", "m", "-", "/nonexistent/bunmsh-grep", "-"], {
    input: input(["m\n"]),
    write: (data) => { events.push(["out", Buffer.from(data).toString()]); },
    writeError: (text) => { events.push(["err", text]); },
  });
  expect(events[0]).toEqual(["out", "(standard input):m\n"]);
  expect(events[1]).toEqual(["err", "bunmsh: grep: /nonexistent/bunmsh-grep: No such file or directory\n"]);
  expect(result).toMatchObject({ status: 2, stderr: "" });
});

test("an emoji is one character to . and [...], not half a surrogate pair", async () => {
  const text = ["表情😀👍\n"];
  expect((await runGrep(["grep", "-o", "情."], { input: input(text) })).stdout).toBe("情😀\n");
  expect((await runGrep(["grep", "-o", "[😀]"], { input: input(text) })).stdout).toBe("😀\n");
  expect((await runGrep(["grep", "-o", "情..$"], { input: input(text) })).stdout).toBe("情😀👍\n");
});

test("a bare --color means always, as bunmsh has always taken it", async () => {
  for (const option of ["--color", "--colour"]) {
    expect((await runGrep(["grep", option, "b"], { input: input(["abc\n"]), tty: false })).stdout)
      .toBe("a\x1b[01;31mb\x1b[mc\n");
  }
  expect((await runGrep(["grep", "--color=auto", "b"], { input: input(["abc\n"]), tty: false })).stdout).toBe("abc\n");
});

test("byte-preserving decoding retains BOMs, including beside invalid UTF-8", async () => {
  for (const data of [
    Buffer.from("\ufeffmatch\n"),
    Buffer.concat([Buffer.from([0xff]), Buffer.from("\ufeffmatch\n")]),
    Buffer.from("match\n\ufeffmatch\n"),
  ]) {
    const result = await runGrepBytes(["grep", "match"], { input: input([data]) });
    expect(result.stdout).toEqual(data);
  }
});
