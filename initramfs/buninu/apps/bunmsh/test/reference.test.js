import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createState, decode, execute } from "../src/shell.js";

const root = new URL("..", import.meta.url).pathname;
const bunmsh = [process.execPath, "src/main.js", "-c"];

async function invoke(argv, source, env = process.env, args = []) {
  const proc = Bun.spawn([...argv, source, ...args], {
    cwd: root,
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [status, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { status, stdout, stderr };
}

async function expectLikeSh(source, env, args) {
  const [actual, reference] = await Promise.all([
    invoke(bunmsh, source, env, args),
    invoke(["/bin/sh", "-c"], source, env, args),
  ]);
  expect(actual).toEqual(reference);
}

async function expectLikeShInTemp(source) {
  const directory = mkdtempSync(join(tmpdir(), "bunmsh-reference-"));
  try {
    await expectLikeSh(source, {
      ...process.env,
      BUNMSH_TEST_TMPDIR: directory,
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

async function invokeInternal(source, options = {}) {
  const state = createState(options);
  const output = await execute(source, state, { capture: true });
  return {
    status: output.status,
    stdout: decode(output.stdout),
    stderr: decode(output.stderr),
  };
}

async function invokeArgvWithInput(argv, input, cwd = root) {
  const proc = Bun.spawn({
    cmd: argv,
    cwd,
    env: process.env,
    stdin: Buffer.from(input),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [status, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { status, stdout, stderr };
}

async function expectBuiltinGrepLike(args, input, cwd = root) {
  const [actual, reference] = await Promise.all([
    invokeArgvWithInput([process.execPath, join(root, "src/main.js"), "-cc", "builtin", "grep", ...args], input, cwd),
    invokeArgvWithInput(["/usr/bin/grep", ...args], input, cwd),
  ]);
  expect(actual).toEqual(reference);
}

async function expectBuiltinSedLike(args, input, cwd = root) {
  const [actual, reference] = await Promise.all([
    invokeArgvWithInput([process.execPath, join(root, "src/main.js"), "-cc", "builtin", "sed", ...args], input, cwd),
    invokeArgvWithInput(["/usr/bin/sed", ...args], input, cwd),
  ]);
  expect(actual).toEqual(reference);
}

describe("/bin/sh reference", () => {
  describe("quote and word expansion", () => {
    test("removes LF and CRLF backslash continuations before tokenization", async () => {
      const lf = "/usr/bin/printf '<%s>\\n' one \\\n  two \\\n  three";
      await expectLikeSh(lf);
      const crlf = lf.replaceAll("\n", "\r\n");
      const output = await invoke(bunmsh, crlf);
      expect(output).toEqual({ status: 0, stdout: "<one>\n<two>\n<three>\n", stderr: "" });
    });

    test("preserves quoted fields and removes quote syntax", async () => {
      await expectLikeSh("value='a b'; /usr/bin/printf '<%s>\\n' \"$value\" '$value' a\\ b");
    });

    test("splits unquoted expansions using IFS", async () => {
      await expectLikeSh("value='one two  three'; /usr/bin/printf '<%s>\\n' $value");
    });

    test("does not apply IFS splitting to literal parts of a word", async () => {
      await expectLikeSh(
        "IFS=:; value='one:two'; /usr/bin/printf '<%s>\\n' $value literal:field",
      );
    });

    test("preserves empty fields from non-whitespace IFS delimiters", async () => {
      await expectLikeSh("IFS=:; value=':a::b:'; /usr/bin/printf '<%s>\\n' $value");
    });

    test("supports parameter defaults, alternatives, lengths, and trimming", async () => {
      await expectLikeSh(
        "value=abc.txt; empty=; /usr/bin/printf '%s\\n' ${missing:-fallback} ${empty:-fallback} " +
          "${value:+present} ${#value} ${value%.txt}",
      );
    });

    test("keeps spaces and nested expansions inside parameter operands", async () => {
      await expectLikeSh(
        "fallback=inside; /usr/bin/printf '<%s>\\n' \"${missing:-two words}\" " +
          "\"${missing:-${fallback}}\"",
      );
    });

    test("performs command substitution and strips trailing newlines", async () => {
      await expectLikeSh("/usr/bin/printf '<%s>\\n' \"$(printf 'a b\\n\\n')\"");
    });

    test("supports legacy backtick substitution", async () => {
      await expectLikeSh("/usr/bin/printf '<%s>\\n' \"`echo legacy`\"");
    });

    test("uses command substitution status for assignment-only commands", async () => {
      await expectLikeSh("value=$(false); echo $?");
    });

    test("performs arithmetic expansion with shell variables", async () => {
      await expectLikeSh("number=6; /usr/bin/printf '%s\\n' $((number * 7 + 1))");
    });

    test("expands quoted and unquoted positional parameters", async () => {
      await expectLikeSh(
        "/usr/bin/printf '<%s>\\n' \"$@\"; /usr/bin/printf '[%s]\\n' $@",
        process.env,
        ["reference", "a b", "c"],
      );
    });

    test("performs pathname generation but preserves quoted patterns", async () => {
      await expectLikeSh(
        "/usr/bin/printf '<%s>\\n' test/reference-*.sh 'test/reference-*.sh' test/no-match-*.none",
      );
    });

    test("expands tilde in words and assignment values", async () => {
      await expectLikeSh("path=~/folder; /usr/bin/printf '%s\\n' ~ \"$path\"");
    });
  });

  describe("here documents", () => {
    test("feeds a heredoc body to a command's stdin", async () => {
      await expectLikeSh("cat <<EOF\nhello world\nEOF");
    });

    test("expands parameters and command substitution in an unquoted delimiter", async () => {
      await expectLikeSh("name=world; cat <<EOF\nhi $name, today is $(echo Tuesday)\nEOF");
    });

    test("leaves a quoted or escaped delimiter's body literal", async () => {
      await expectLikeSh("name=world; cat <<'EOF'\nhi $name\nEOF");
      await expectLikeSh("name=world; cat <<\\EOF\nhi $name\nEOF");
    });

    test("<<- strips leading tabs from the body and the terminator", async () => {
      await expectLikeSh("cat <<-EOF\n\thello\n\tEOF");
    });

    test("feeds a pipeline stage and composes with other redirects", async () => {
      await expectLikeSh("cat <<EOF | tr a-z A-Z\nhi there\nEOF");
    });

    test("supports multiple heredocs on one command, last one wins", async () => {
      await expectLikeSh("cat <<A <<B\nfirst\nA\nsecond\nB");
    });

    test("works inside while and if compound bodies", async () => {
      await expectLikeSh(
        "i=0\nwhile [ $i -lt 2 ]; do\n  cat <<EOF\nline $i\nEOF\n  i=$((i + 1))\ndone",
      );
      await expectLikeSh("if true; then\n  cat <<EOF\nyes branch\nEOF\nfi");
    });

    test("leniently uses whatever was read when the terminator never appears", async () => {
      await expectLikeSh("cat <<EOF\nno terminator here");
    });
  });

  // /bin/sh here is dash, which does not implement <<<; these compare
  // against bunmsh's own output instead of expectLikeSh's dash reference.
  describe("here strings (mksh extension)", () => {
    test("feeds the expanded word plus a trailing newline to stdin", async () => {
      const output = await invoke(bunmsh, "cat <<< hello");
      expect(output).toEqual({ status: 0, stdout: "hello\n", stderr: "" });
    });

    test("expands parameters and command substitution", async () => {
      const output = await invoke(bunmsh, 'x=world; cat <<< "hi $x, $(echo there)"');
      expect(output).toEqual({ status: 0, stdout: "hi world, there\n", stderr: "" });
    });

    test("does not field-split an unquoted expansion", async () => {
      const output = await invoke(bunmsh, 'x="a  b   c"; cat <<< $x');
      expect(output).toEqual({ status: 0, stdout: "a  b   c\n", stderr: "" });
    });

    test("leaves a single-quoted word literal", async () => {
      const output = await invoke(bunmsh, "x=world; cat <<< 'hi $x'");
      expect(output).toEqual({ status: 0, stdout: "hi $x\n", stderr: "" });
    });

    test("does not tilde-expand, unlike a file redirect target", async () => {
      const output = await invoke(bunmsh, "cat <<< ~");
      expect(output).toEqual({ status: 0, stdout: "~\n", stderr: "" });
    });
  });

  describe("command", () => {
    test("executes a utility and preserves its status", async () => {
      await expectLikeSh(
        "command echo hello; command false || echo fallback; command true && echo success",
      );
    });

    test("with no operand succeeds without output", async () => {
      await expectLikeSh("command");
    });

    test("-v reports successful and failed lookup through its status", async () => {
      await expectLikeSh(
        "command -v command >/dev/null && echo found; " +
          "command -v bunmsh-command-that-does-not-exist >/dev/null || echo missing",
      );
    });

    test("-p executes through the default utility PATH", async () => {
      await expectLikeSh("PATH=/no/such/path command -p sh -c 'printf default-path'");
    });
  });

  describe("state and evaluation builtins", () => {
    test("alias definitions expand and unalias removes them", async () => {
      await expectLikeSh(
        "alias greeting='echo hello'\ngreeting\nunalias greeting\n" +
          "alias greeting >/dev/null 2>/dev/null || echo removed",
      );
    });

    test("readonly defines values and lists marked names", async () => {
      await expectLikeSh(
        "readonly BUNMSH_REFERENCE_VALUE=locked; echo $BUNMSH_REFERENCE_VALUE; " +
          "readonly -p | grep BUNMSH_REFERENCE_VALUE >/dev/null && echo readonly",
      );
    });

    test("eval parses and executes its joined arguments", async () => {
      await expectLikeSh("word=works; eval 'echo eval-$word'");
    });

    test("dot sources a file in the current shell", async () => {
      await expectLikeSh(
        "BUNMSH_REFERENCE_SOURCE=value; . ./test/reference-source.sh; echo after:$?",
      );
    });

    test("shift updates positional parameters", async () => {
      await expectLikeSh("shift 2; echo $#:$1", process.env, ["reference", "a", "b", "c"]);
    });

    test("read assigns fields, with the last name receiving the remainder", async () => {
      await expectLikeSh("IFS=' '; read first rest < test/reference-source.sh; printf '<%s>|<%s>\\n' \"$first\" \"$rest\"");
    });

    test("executes case, while, until, and for compound commands", async () => {
      await expectLikeSh(`
value=archive.tgz
case "$value" in
  *.zip)
    printf wrong
    ;;
  *.tgz|*.tar)
    printf case
    ;;
esac
i=0
while [ "$i" -lt 2 ]; do
  printf w%s "$i"
  i=$((i + 1))
done
until [ "$i" -ge 4 ]; do
  printf u%s "$i"
  i=$((i + 1))
done
for item in alpha "two words"; do
  printf 'f<%s>' "$item"
done
`);
    });

    test("executes a complete if command on one physical line", async () => {
      await expectLikeSh("if true ; then echo hello ; fi");
      await expectLikeSh("if false; then echo wrong; elif true; then echo elif; else echo wrong; fi");
      await expectLikeSh("if true; then echo then fi else; fi");
      await expectLikeSh("i=0; while [ \"$i\" -lt 2 ]; do echo loop:$i; i=$((i + 1)); done");
      await expectLikeSh("for item in one two; do echo item:$item; done");
    });

    test("redirects a file into a while-read loop", async () => {
      const directory = mkdtempSync(join(tmpdir(), "bunmsh-read-loop-"));
      try {
        const file = join(directory, "items.txt");
        await Bun.write(file, "one\ntwo words\nthree\n");
        await expectLikeSh(`
set --
while IFS= read -r item; do
  set -- "$@" "$item"
done < "${file}"
for value in "$@"; do
  printf '<%s>\\n' "$value"
done
`);
      } finally { rmSync(directory, { recursive: true, force: true }); }
    });

    test("runs parenthesized commands in an isolated subshell", async () => {
      await expectLikeSh(`
(cd test && basename "$PWD")
basename "$PWD"
`);
      await expectLikeSh(`
(printf left && printf right)
printf ':%s' $?
`);
    });
  });

  describe("query and system builtins", () => {
    test("basename handles an optional suffix", async () => {
      await expectLikeSh("basename /usr/src/shell.js .js");
    });

    test("dirname returns the containing path", async () => {
      await expectLikeSh("dirname /usr/src/shell.js");
    });

    test("which searches PATH using Bun.which semantics", async () => {
      const output = await invoke(bunmsh, "which sh; which bunmsh-command-that-does-not-exist");
      expect(output).toEqual({
        status: 1,
        stdout: `${Bun.which("sh", { PATH: process.env.PATH, cwd: root })}\n`,
        stderr: "",
      });
    });

    test("test and [ evaluate files, strings, and integers", async () => {
      await expectLikeSh(
        "test -d . && echo directory; test -n value && echo string; " +
          "[ 7 -ge 3 ] && echo integer; [ missing = present ] || echo unequal",
      );
    });

    test("type reports lookup success through status", async () => {
      await expectLikeSh(
        "type echo >/dev/null && echo builtin; " +
          "type bunmsh-command-that-does-not-exist >/dev/null 2>/dev/null || echo missing",
      );
    });

    test("realpath resolves existing paths", async () => {
      await expectLikeSh("realpath .");
    });

    test("umask reads and changes the process mask", async () => {
      await expectLikeSh("umask 027; umask");
    });

    test("getopts consumes options and option arguments", async () => {
      await expectLikeSh(
        "OPTIND=1; getopts ab: option -a -b value; echo $option:$OPTIND; " +
          "getopts ab: option -a -b value; echo $option:$OPTARG:$OPTIND",
      );
    });

    test("kill -0 checks the current process without sending a signal", async () => {
      await expectLikeSh("kill -0 $$; echo $?");
    });
  });
});

describe("system tail reference", () => {
  test("supports -n +N and compact -n+N from-start modes", async () => {
    const input = "one\ntwo\nthree\nfour\n";
    for (const args of [["-n", "+2"], ["-n+3"], ["-n", "+1"], ["-n", "+0"]]) {
      const [actual, reference] = await Promise.all([
        invokeArgvWithInput(
          [process.execPath, join(root, "src/main.js"), "-cc", "builtin", "tail", ...args],
          input,
        ),
        invokeArgvWithInput([Bun.which("tail"), ...args], input),
      ]);
      expect(actual).toEqual(reference);
    }
  });
});

describe("system grep reference", () => {
  test("matches basic and extended regular-expression semantics", async () => {
    await expectBuiltinGrepLike(["a+b"], "a+b\naaab\n");
    await expectBuiltinGrepLike(["a\\+b"], "a+b\naaab\n");
    await expectBuiltinGrepLike(["-E", "a+b"], "a+b\naaab\n");
    await expectBuiltinGrepLike(["-E", "[[:digit:]]+"], "word\nnumber42\n");
  });

  test("matches fixed, whole-line, case, number, invert, and quiet modes", async () => {
    await expectBuiltinGrepLike(["-Finx", "alpha.beta"], "Alpha.Beta\nalphaXbeta\n");
    await expectBuiltinGrepLike(["-v", "drop"], "keep\ndrop\n");
    await expectBuiltinGrepLike(["-q", "found"], "found\nlater\n");
    await expectBuiltinGrepLike(["-q", "missing"], "found\nlater\n");
  });

  test("suppresses zero-length -o matches and output for -v -o", async () => {
    await expectBuiltinGrepLike(["-oE", "[0-9]*"], "uid=10234(name)\nnone\n");
    await expectBuiltinGrepLike(["-oE", "[0-9a-zA-Z.]*"], "package:com.example 10234\n");
    await expectBuiltinGrepLike(["-vo", "drop"], "keep\ndrop\n");
    await expectBuiltinGrepLike(["-onE", "[0-9]+"], "a12b34\nnone\n");
  });

  test("matches recursive filename and line-number output", async () => {
    const directory = mkdtempSync(join(tmpdir(), "bunmsh-grep-reference-"));
    try {
      mkdirSync(join(directory, "tree", "nested"), { recursive: true });
      await Bun.write(join(directory, "tree", "a.txt"), "needle one\nnone\n");
      await Bun.write(join(directory, "tree", "nested", "b.txt"), "needle two\n");
      await expectBuiltinGrepLike(["-rn", "needle", "tree"], "", directory);
      await expectBuiltinGrepLike(["-n", "needle", "tree/a.txt", "tree/nested/b.txt"], "", directory);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});

describe("system sed reference", () => {
  test("selects the package path fields used by tmpk", async () => {
    await expectBuiltinSedLike(["-n", "3p"], "data\ndata\ncom.example\n");
    await expectBuiltinSedLike(["-n", "4p"], "data\nuser\n0\ncom.example\n");
  });

  test("trims whitespace and applies build.sh substitutions", async () => {
    await expectBuiltinSedLike(["s/^[[:space:]]*//;s/[[:space:]]*$//"], "  package.name \t\n");
    await expectBuiltinSedLike(["-e", "s/com.drjohn.test1/com.example.app/"], "package=com.drjohn.test1\n");
    await expectBuiltinSedLike(["s/Hello1/My App/"], "<string>Hello1</string>\n");
  });

  test("supports global replacements, extended expressions, and backreferences", async () => {
    await expectBuiltinSedLike(["s/a/A/g"], "banana\n");
    await expectBuiltinSedLike(["-E", "s/(name)=([^ ]+)/\\1:[\\2]/"], "name=value rest\n");
  });
});

describe("command mksh extensions", () => {
  test("PATH overrides fallback builtins, while builtin selects them explicitly", async () => {
    const directory = mkdtempSync(join(tmpdir(), "bunmsh-fallback-"));
    const executable = join(directory, "basename");
    await Bun.write(executable, "#!/bin/sh\necho external-basename\n");
    chmodSync(executable, 0o755);
    const output = await invoke(
      bunmsh,
      "basename /a/b/file.txt; builtin basename /a/b/file.txt",
      { ...process.env, PATH: directory },
    );
    expect(output).toEqual({
      status: 0,
      stdout: "external-basename\nfile.txt\n",
      stderr: "",
    });
  });

  test("fallback builtins run when PATH has no matching executable", async () => {
    const output = await invoke(
      bunmsh,
      "basename /a/b/file.txt; dirname /a/b/file.txt",
      { ...process.env, PATH: "/no/such/path" },
    );
    expect(output).toEqual({ status: 0, stdout: "file.txt\n/a/b\n", stderr: "" });
  });

  test("time reports elapsed nanosecond timing and preserves command results", async () => {
    const output = await invoke(bunmsh, "time echo timed");
    expect(output.status).toBe(0);
    expect(output.stdout).toBe("timed\n");
    expect(output.stderr).toMatch(/^real \d+\.\d{6} ms\n$/);

    const failure = await invoke(bunmsh, "time false");
    expect(failure.status).toBe(1);
    expect(failure.stdout).toBe("");
    expect(failure.stderr).toMatch(/^real \d+\.\d{6} ms\n$/);
  });

  test("performs mksh brace expansion", async () => {
    const output = await invoke(bunmsh, "/usr/bin/printf '<%s>\\n' pre{one,two}post");
    expect(output).toEqual({
      status: 0,
      stdout: "<preonepost>\n<pretwopost>\n",
      stderr: "",
    });
  });

  test("performs mksh parameter replacement", async () => {
    const output = await invoke(
      bunmsh,
      "value=one-two-two; echo ${value/two/2}; echo ${value//two/2}",
    );
    expect(output).toEqual({
      status: 0,
      stdout: "one-2-two\none-2-2\n",
      stderr: "",
    });
  });

  test("quoted command names suppress alias expansion", async () => {
    const output = await invokeInternal("'echo' hello", { aliases: { echo: ["false"] } });
    expect(output).toEqual({ status: 0, stdout: "hello\n", stderr: "" });
  });

  test("bypasses aliases while retaining builtins", async () => {
    const output = await invokeInternal("command echo hello", {
      aliases: { echo: ["false"] },
    });
    expect(output).toEqual({ status: 0, stdout: "hello\n", stderr: "" });
  });

  test("-V describes aliases and builtins", async () => {
    const output = await invoke(bunmsh, "command -V ls command");
    expect(output).toEqual({
      status: 0,
      stdout: "ls is an alias for 'ls --color=auto'\ncommand is a shell builtin\n",
      stderr: "",
    });
  });

  test("whence and builtin expose mksh-style lookup", async () => {
    const output = await invoke(bunmsh, "whence echo; builtin echo builtin-ok");
    expect(output).toEqual({ status: 0, stdout: "echo\nbuiltin-ok\n", stderr: "" });
  });

  test("standalone builtin lists registered builtin names", async () => {
    const output = await invoke(bunmsh, "builtin");
    expect(output.status).toBe(0);
    expect(output.stderr).toBe("");
    const names = output.stdout.trimEnd().split("\n");
    expect(names).toEqual([...names].sort());
    expect(names).toContain("builtin");
    expect(names).toContain("command");
    expect(names).toContain("..");
    expect(names).toContain("//");
  });
});

describe("CLI direct argv forwarding", () => {
  test("-cc preserves every argument without shell expansion", async () => {
    const output = await invoke(
      [process.execPath, "src/main.js", "-cc"],
      "/usr/bin/printf",
      process.env,
      ["<%s>\\n", "a b", "$HOME", "*", "semi;colon"],
    );
    expect(output).toEqual({
      status: 0,
      stdout: "<a b>\n<$HOME>\n<*>\n<semi;colon>\n",
      stderr: "",
    });
  });

  test("-cc uses builtin and PATH dispatch while preserving status", async () => {
    const builtin = await invoke(
      [process.execPath, "src/main.js", "-cc"],
      "echo",
      process.env,
      ["direct", "argv"],
    );
    expect(builtin).toEqual({ status: 0, stdout: "direct argv\n", stderr: "" });

    const failure = await invoke(
      [process.execPath, "src/main.js", "-cc"],
      "false",
    );
    expect(failure).toEqual({ status: 1, stdout: "", stderr: "" });
  });

  test("-cc without a command is a usage error", async () => {
    const output = await invoke([process.execPath, "src/main.js"], "-cc");
    expect({ ...output, stderr: Bun.stripANSI(output.stderr) }).toEqual({
      status: 2,
      stdout: "",
      stderr: "bunmsh: -cc requires a command\n",
    });
  });
});

describe("concurrent streaming pipelines", () => {
  test("matches /bin/sh for cat piped into grep", async () => {
    await expectLikeSh("cat test/reference-source.sh | grep BUNMSH_REFERENCE_SOURCE");
  });

  test("matches /bin/sh for a multi-stage filtering pipeline", async () => {
    await expectLikeSh(
      "printf 'alpha\\nbeta\\ngamma\\n' | grep 'a$' | tr a-z A-Z",
    );
  });

  test("matches /bin/sh when redirected stdin feeds a pipeline", async () => {
    await expectLikeSh("cat < test/reference-source.sh | grep 'sourced:'");
  });

  test("matches /bin/sh for streamed stdout overwrite and append redirects", async () => {
    await expectLikeShInTemp(
      "out=$BUNMSH_TEST_TMPDIR/redirect; printf first > \"$out\"; " +
        "printf second >> \"$out\"; cat \"$out\"; rm \"$out\"",
    );
  });

  test("matches /bin/sh for a streamed stderr redirect", async () => {
    await expectLikeShInTemp(
      "out=$BUNMSH_TEST_TMPDIR/stderr; sh -c 'printf error >&2' 2> \"$out\"; " +
        "cat \"$out\"; rm \"$out\"",
    );
  });

  test("matches /bin/sh when a redirect overrides the pipeline output", async () => {
    await expectLikeShInTemp(
      "out=$BUNMSH_TEST_TMPDIR/override; printf file > \"$out\" | cat; " +
        "printf :; cat \"$out\"; rm \"$out\"",
    );
  });

  test("streams a large redirect without collecting command output", async () => {
    await expectLikeShInTemp(
      "out=$BUNMSH_TEST_TMPDIR/large; head -c 1048576 /dev/zero > \"$out\"; " +
        "wc -c < \"$out\"; rm \"$out\"",
    );
  });

  test("matches /bin/sh by leaving stderr outside the pipe", async () => {
    await expectLikeSh("sh -c 'printf error >&2; printf output' | cat");
  });

  test("matches /bin/sh pipeline status from the last stage", async () => {
    await expectLikeSh("false | true; echo $?; true | false; echo $?");
  });

  test("matches /bin/sh pipeline state isolation", async () => {
    await expectLikeSh("before=$PWD; cd / | cat; test \"$PWD\" = \"$before\" && echo unchanged");
  });

  test("streams the builtin yes into an external early-closing consumer", async () => {
    const output = await invoke(bunmsh, "yes streamed | head -n 3");
    expect(output).toEqual({
      status: 0,
      stdout: "streamed\nstreamed\nstreamed\n",
      stderr: "",
    });
  });

  test("streams builtin output into an external command", async () => {
    const output = await invoke(bunmsh, "printf hello | tr a-z A-Z");
    expect(output).toEqual({ status: 0, stdout: "HELLO", stderr: "" });
  });

  test("does not buffer a large multi-stage external pipeline", async () => {
    const output = await invoke(
      bunmsh,
      "head -c 1048576 /dev/zero | tr '\\0' x | wc -c",
    );
    expect(output).toEqual({ status: 0, stdout: "1048576\n", stderr: "" });
  });
});

//  The fallback `curl` is only worth having if a script cannot tell it apart
//  from the real one, so the parts that can be compared byte for byte are:
//  the body, the exit code, and whatever --write-out reports. Response header
//  order and casing come from fetch rather than the wire, so `-i` output is
//  compared after normalisation instead.
describe("system curl reference", () => {
  const systemCurl = Bun.which("curl");
  let server;
  let origin;

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        switch (url.pathname) {
          case "/text": return new Response("hello\n");
          case "/query": return new Response(`${url.search}\n`);
          case "/method": return new Response(`${request.method}\n`);
          case "/body": return new Response(await request.text());
          case "/missing": return new Response("missing\n", { status: 404 });
          case "/redirect":
            return new Response(null, { status: 302, headers: { Location: "/method" } });
          case "/blob": return new Response(Buffer.alloc(65536, "b"));
          default: return new Response("not found\n", { status: 404 });
        }
      },
    });
    origin = `localhost:${server.port}`;
  });

  afterAll(() => server?.stop(true));

  async function expectLikeCurl(args, transform = (output) => output) {
    const [actual, reference] = await Promise.all([
      invokeArgvWithInput(
        [process.execPath, join(root, "src/main.js"), "-cc", "builtin", "curl", ...args],
        "",
      ),
      invokeArgvWithInput([systemCurl, ...args], ""),
    ]);
    expect(transform(actual)).toEqual(transform(reference));
  }

  test.skipIf(!systemCurl)("matches bodies, statuses, and the guessed scheme", async () => {
    await expectLikeCurl(["-s", `${origin}/text`]);
    await expectLikeCurl(["-s", `http://${origin}/text`]);
    await expectLikeCurl(["-s", `${origin}/missing`]);
    await expectLikeCurl(["-s", `${origin}/nowhere`]);
  });

  test.skipIf(!systemCurl)("matches the tmpk download and probe invocations", async () => {
    await expectLikeCurl(["-fsSL", `${origin}/text`]);
    await expectLikeCurl(["-kfsS", `${origin}/text`]);
    await expectLikeCurl(["-sk", `${origin}/blob`]);
    //  `-#` paints a live bar whose bytes depend on timing; only the body
    //  and the status are comparable.
    await expectLikeCurl(["-#k", `${origin}/text`], ({ status, stdout }) => ({ status, stdout }));
  });

  test.skipIf(!systemCurl)("matches -f and error exit codes", async () => {
    await expectLikeCurl(["-sf", `${origin}/missing`]);
    await expectLikeCurl(["-sSf", `${origin}/missing`]);
    await expectLikeCurl(["-s", "--fail-with-body", `${origin}/missing`]);
    await expectLikeCurl(["-s", "http://localhost:1/"]);
    await Promise.all([
      expectLikeCurl(["-s", "http://no-such-host-zzz.invalid/"]),
      expectLikeCurl(["-sS", "http://no-such-host-zzz.invalid/"]),
    ]);
    await expectLikeCurl(["--bogus", `${origin}/text`]);
    await expectLikeCurl([]);
  }, 10_000);

  test.skipIf(!systemCurl)("matches redirect following and the method it lands on", async () => {
    await expectLikeCurl(["-s", `${origin}/redirect`]);
    await expectLikeCurl(["-sL", `${origin}/redirect`]);
    await expectLikeCurl(["-sL", "-d", "a=1", `${origin}/redirect`]);
  });

  test.skipIf(!systemCurl)("matches the request bodies an API call sends", async () => {
    await expectLikeCurl(["-s", "-d", "a=1", "-d", "b=2", `${origin}/body`]);
    await expectLikeCurl(["-s", "--data-raw", '{"a":1}', `${origin}/body`]);
    await expectLikeCurl(["-s", "--json", '{"a":1}', `${origin}/body`]);
    await expectLikeCurl(["-s", "--data-urlencode", "q=a b&c", `${origin}/body`]);
    await expectLikeCurl(["-s", "-X", "PUT", "-d", "x", `${origin}/method`]);
    await expectLikeCurl(["-s", "-G", "-d", "a=1", "-d", "b=2", `${origin}/query`]);
    await expectLikeCurl(["-s", "-G", "--data-urlencode", "q=a b", `${origin}/query`]);
  });

  test.skipIf(!systemCurl)("matches --write-out reporting", async () => {
    await expectLikeCurl([
      "-s", "-o", "/dev/null", "-w", "%{http_code} %{size_download} %{content_type}\\n",
      `${origin}/text`,
    ]);
    await expectLikeCurl([
      "-sf", "-w", "%{http_code} %{exitcode}\\n", `${origin}/missing`,
    ]);
    await expectLikeCurl([
      "-s", "-o", "/dev/null", "-L", "-w", "%{url_effective} %{num_redirects} %{method}\\n",
      `${origin}/redirect`,
    ]);
  });

  test.skipIf(!systemCurl)("matches -i once header order and casing are normalised", async () => {
    //  fetch hands back lower-cased headers in its own order and hides the
    //  negotiated HTTP version, so compare the status line plus a sorted,
    //  lower-cased header set — the values themselves still have to agree.
    const normalize = ({ status, stdout, stderr }) => {
      const split = stdout.indexOf("\r\n\r\n");
      const head = stdout.slice(0, split).split("\r\n");
      const body = stdout.slice(split + 4);
      return {
        status,
        stderr,
        body,
        statusLine: head[0],
        headers: head.slice(1)
          .map((line) => line.toLowerCase())
          //  Date moves on between the two requests.
          .filter((line) => !line.startsWith("date:"))
          .sort(),
      };
    };
    await expectLikeCurl(["-si", `${origin}/text`], normalize);
    await expectLikeCurl(["-sI", `${origin}/text`], normalize);
  });
});
