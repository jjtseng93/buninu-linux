import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalHeaderName, curlEscape, normalizeUrl, parseCurlArguments } from "../src/curl.js";

const root = new URL("..", import.meta.url).pathname;
const bunmsh = [process.execPath, join(root, "src/main.js"), "-cc", "builtin", "curl"];

let server;
let origin;

//  Everything the builtin talks to is local, so the suite stays honest
//  without a network and without a service that could change under it.
beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      switch (url.pathname) {
        case "/text":
          return new Response("hello\n");
        case "/query":
          return new Response(`${url.search}\n`);
        case "/method":
          return new Response(`${request.method}\n`);
        case "/body":
          return new Response(await request.text());
        case "/type":
          return new Response(`${request.headers.get("content-type") ?? "none"}\n`);
        case "/auth":
          return new Response(`${request.headers.get("authorization") ?? "none"}\n`);
        case "/pick":
          return new Response(`${request.headers.get(url.searchParams.get("h")) ?? "none"}\n`);
        case "/missing":
          return new Response("missing\n", { status: 404 });
        case "/redirect":
          return new Response(null, { status: 302, headers: { Location: "/method" } });
        case "/permanent":
          return new Response(null, { status: 308, headers: { Location: "/method" } });
        case "/loop":
          return new Response(null, { status: 302, headers: { Location: "/loop" } });
        case "/attachment":
          return new Response("attached\n", {
            headers: { "Content-Disposition": 'attachment; filename="named.txt"' },
          });
        case "/chunks": {
          const stream = new ReadableStream({
            start(controller) {
              for (let i = 0; i < 4; i++) controller.enqueue(Buffer.from(`chunk${i}\n`));
              controller.close();
            },
          });
          return new Response(stream);
        }
        case "/blob": {
          const body = Buffer.alloc(65536, "b");
          const range = request.headers.get("range");
          if (!range) return new Response(body);
          const start = Number(/bytes=(\d+)-/.exec(range)?.[1] ?? 0);
          if (start >= body.length) return new Response(null, { status: 416 });
          return new Response(body.subarray(start), {
            status: 206,
            headers: { "Content-Range": `bytes ${start}-${body.length - 1}/${body.length}` },
          });
        }
        default:
          return new Response("not found\n", { status: 404 });
      }
    },
  });
  origin = `localhost:${server.port}`;
});

afterAll(() => server?.stop(true));

async function curl(...args) {
  const proc = Bun.spawn({
    cmd: [...bunmsh, ...args],
    cwd: root,
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

describe("curl argument parsing", () => {
  test("splits the short clusters the tmpk scripts use", () => {
    const { options } = parseCurlArguments(["curl", "-kLO", "https://example.com/a.tgz"]);
    expect(options.insecure).toBe(true);
    expect(options.location).toBe(true);
    expect(options.outputs).toEqual([{ kind: "remote" }]);
    expect(options.urls).toEqual(["https://example.com/a.tgz"]);

    const quiet = parseCurlArguments(["curl", "-fsSL", "https://example.com/i.sh"]).options;
    expect([quiet.fail, quiet.silent, quiet.showError, quiet.location]).toEqual([true, true, true, true]);

    const probe = parseCurlArguments(["curl", "-kfsS", "https://example.com/m"]).options;
    expect([probe.insecure, probe.fail, probe.silent, probe.showError]).toEqual([true, true, true, true]);

    const bar = parseCurlArguments(["curl", "-#k", "https://example.com/s"]).options;
    expect([bar.progressBar, bar.insecure]).toEqual([true, true]);
  });

  test("takes a value from the next argument or the tail of a cluster", () => {
    const resume = parseCurlArguments(["curl", "-C", "-", "-kLO", "https://example.com/a"]).options;
    expect(resume.continueAt).toBe("-");
    expect(resume.urls).toEqual(["https://example.com/a"]);
    expect(parseCurlArguments(["curl", "-oout.txt", "u"]).options.outputs)
      .toEqual([{ kind: "file", path: "out.txt" }]);
    expect(parseCurlArguments(["curl", "--output=out.txt", "u"]).options.outputs)
      .toEqual([{ kind: "file", path: "out.txt" }]);
  });

  test("rejects unknown options and reports missing parameters", () => {
    expect(parseCurlArguments(["curl", "--bogus", "u"]).error)
      .toBe("curl: option --bogus: is unknown");
    expect(parseCurlArguments(["curl", "-B", "u"]).error)
      .toBe("curl: option -B: is unknown");
    expect(parseCurlArguments(["curl", "u", "-o"]).error)
      .toBe("curl: option -o: requires parameter");
  });

  test("understands --no- prefixes and -- end of options", () => {
    const options = parseCurlArguments(["curl", "--location", "--no-location", "--", "-weird"]).options;
    expect(options.location).toBe(false);
    expect(options.urls).toEqual(["-weird"]);
  });
});

describe("curl url and escaping helpers", () => {
  test("adds the scheme a bare host is missing", () => {
    expect(normalizeUrl("localhost:8080")).toBe("http://localhost:8080");
    expect(normalizeUrl("example.com/page")).toBe("http://example.com/page");
    expect(normalizeUrl("example.com:443/page")).toBe("https://example.com:443/page");
    expect(normalizeUrl("example.com", "https")).toBe("https://example.com");
    expect(normalizeUrl("https://example.com")).toBe("https://example.com");
  });

  test("escapes like curl: unreserved kept, space as plus", () => {
    expect(curlEscape("a b&c")).toBe("a+b%26c");
    expect(curlEscape("-._~AZaz09")).toBe("-._~AZaz09");
    expect(curlEscape("ü")).toBe("%C3%BC");
  });

  test("restores the conventional casing fetch lower-cases away", () => {
    expect(canonicalHeaderName("content-type")).toBe("Content-Type");
    expect(canonicalHeaderName("etag")).toBe("ETag");
    expect(canonicalHeaderName("www-authenticate")).toBe("WWW-Authenticate");
  });
});

describe("curl transfers", () => {
  test("fetches a body and adds http:// to a bare host", async () => {
    expect(await curl("-s", `${origin}/text`)).toEqual({ status: 0, stdout: "hello\n", stderr: "" });
  });

  test("reports usage without a URL", async () => {
    const output = await curl();
    expect(output.status).toBe(2);
    expect(output.stderr).toBe("curl: try 'curl --help' or 'curl --manual' for more information\n");
  });

  test("keeps the body on an HTTP error unless -f is given", async () => {
    expect(await curl("-s", `${origin}/missing`))
      .toEqual({ status: 0, stdout: "missing\n", stderr: "" });
    expect(await curl("-sf", `${origin}/missing`))
      .toEqual({ status: 22, stdout: "", stderr: "" });
    expect(await curl("-sSf", `${origin}/missing`)).toEqual({
      status: 22,
      stdout: "",
      stderr: "curl: (22) The requested URL returned error: 404\n",
    });
    expect(await curl("-s", "--fail-with-body", `${origin}/missing`))
      .toEqual({ status: 22, stdout: "missing\n", stderr: "" });
  });

  test("follows redirects only with -L and downgrades POST to GET", async () => {
    expect(await curl("-s", `${origin}/redirect`)).toMatchObject({ status: 0, stdout: "" });
    expect(await curl("-sL", `${origin}/redirect`)).toMatchObject({ stdout: "GET\n" });
    expect(await curl("-sL", "-d", "a=1", `${origin}/redirect`)).toMatchObject({ stdout: "GET\n" });
    //  308 keeps the method, which is the whole point of the status.
    expect(await curl("-sL", "-d", "a=1", `${origin}/permanent`)).toMatchObject({ stdout: "POST\n" });
  });

  test("stops a redirect loop at --max-redirs", async () => {
    const output = await curl("-sS", "-L", "--max-redirs", "3", `${origin}/loop`);
    expect(output.status).toBe(47);
    expect(output.stderr).toBe("curl: (47) Maximum (3) redirects followed\n");
  });

  test("sends data, headers, and auth the way an API expects", async () => {
    expect(await curl("-s", "-d", '{"a":1}', `${origin}/method`)).toMatchObject({ stdout: "POST\n" });
    expect(await curl("-s", "-d", "a=1", "-d", "b=2", `${origin}/body`)).toMatchObject({ stdout: "a=1&b=2" });
    expect(await curl("-s", "-d", "a=1", `${origin}/type`))
      .toMatchObject({ stdout: "application/x-www-form-urlencoded\n" });
    expect(await curl("-s", "--json", '{"a":1}', `${origin}/type`))
      .toMatchObject({ stdout: "application/json\n" });
    expect(await curl("-s", "-H", "Content-Type: text/plain", "-d", "x", `${origin}/type`))
      .toMatchObject({ stdout: "text/plain\n" });
    expect(await curl("-s", "-u", "user:pass", `${origin}/auth`))
      .toMatchObject({ stdout: "Basic dXNlcjpwYXNz\n" });
    expect(await curl("-s", "--oauth2-bearer", "sk-test", `${origin}/auth`))
      .toMatchObject({ stdout: "Bearer sk-test\n" });
    expect(await curl("-s", "-X", "DELETE", `${origin}/method`)).toMatchObject({ stdout: "DELETE\n" });
  });

  test("moves data onto the query string with -G", async () => {
    expect(await curl("-s", "-G", "-d", "a=1", "-d", "b=2", `${origin}/query`))
      .toMatchObject({ stdout: "?a=1&b=2\n" });
    expect(await curl("-s", "-G", "--data-urlencode", "q=a b", `${origin}/query`))
      .toMatchObject({ stdout: "?q=a+b\n" });
  });

  test("prints response headers for -i and -I", async () => {
    const include = await curl("-si", `${origin}/text`);
    expect(include.stdout.startsWith("HTTP/1.1 200 OK\r\n")).toBe(true);
    expect(include.stdout.endsWith("\r\n\r\nhello\n")).toBe(true);
    expect(include.stdout).toContain("Content-Type: text/plain;charset=utf-8\r\n");

    const head = await curl("-sI", `${origin}/text`);
    expect(head.stdout.startsWith("HTTP/1.1 200 OK\r\n")).toBe(true);
    expect(head.stdout).not.toContain("hello");
  });

  test("reports transfer facts through --write-out", async () => {
    expect(await curl("-s", "-o", "/dev/null", "-w", "%{http_code} %{size_download}\\n", `${origin}/text`))
      .toMatchObject({ status: 0, stdout: "200 6\n" });
    //  A failed transfer still knows what the server said.
    expect(await curl("-sf", "-w", "%{http_code} %{exitcode}\\n", `${origin}/missing`))
      .toMatchObject({ status: 22, stdout: "404 22\n" });
    expect(await curl("-s", "-o", "/dev/null", "-w", "%{url_effective} %{num_redirects}\\n", "-L", `${origin}/redirect`))
      .toMatchObject({ stdout: `http://${origin}/method 1\n` });
  });

  test("maps connection failures onto curl's exit codes", async () => {
    const refused = await curl("-sS", "http://localhost:1/");
    expect(refused.status).toBe(7);
    expect(refused.stderr).toContain("curl: (7) Failed to connect to localhost port 1");

    const unresolved = await curl("-sS", "http://no-such-host-zzz.invalid/");
    expect(unresolved.status).toBe(6);
    expect(unresolved.stderr).toBe("curl: (6) Could not resolve host: no-such-host-zzz.invalid\n");

    const unsupported = await curl("-sS", "ftp://example.com/file");
    expect(unsupported.status).toBe(1);
    expect(unsupported.stderr)
      .toBe('curl: (1) Protocol "ftp" not supported or disabled in libcurl\n');
  }, 10_000);
});

describe("curl file output", () => {
  let directory;

  beforeAll(() => { directory = mkdtempSync(join(tmpdir(), "bunmsh-curl-")); });
  afterAll(() => rmSync(directory, { recursive: true, force: true }));

  async function curlIn(...args) {
    const proc = Bun.spawn({
      cmd: [...bunmsh, ...args],
      cwd: directory,
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

  test("-O names the file after the URL path", async () => {
    expect(await curlIn("-s", "-O", `${origin}/text`)).toMatchObject({ status: 0, stdout: "" });
    expect(readFileSync(join(directory, "text"), "utf8")).toBe("hello\n");
  });

  test("-J prefers the Content-Disposition filename", async () => {
    expect(await curlIn("-sOJ", `${origin}/attachment`)).toMatchObject({ status: 0 });
    expect(readFileSync(join(directory, "named.txt"), "utf8")).toBe("attached\n");
  });

  test("-o writes where it is told, and --create-dirs makes the way", async () => {
    await curlIn("-s", "--create-dirs", "-o", "nested/deep/out.txt", `${origin}/text`);
    expect(readFileSync(join(directory, "nested/deep/out.txt"), "utf8")).toBe("hello\n");
  });

  test("-C - resumes a partial file and stops when it is complete", async () => {
    const path = join(directory, "blob");
    writeFileSync(path, Buffer.alloc(1024, "b"));
    const resumed = await curlIn("-s", "-C", "-", "-O", `${origin}/blob`);
    expect(resumed.status).toBe(0);
    expect(readFileSync(path).length).toBe(65536);

    //  Second pass: the server answers 416 and nothing is rewritten.
    const complete = await curlIn("-s", "-C", "-", "-O", `${origin}/blob`);
    expect(complete.status).toBe(0);
    expect(readFileSync(path).length).toBe(65536);
  });

  test("-d @file reads the body from disk and @- from stdin", async () => {
    writeFileSync(join(directory, "payload.json"), '{"model":"test"}\n');
    expect(await curlIn("-s", "-d", "@payload.json", `${origin}/body`))
      .toMatchObject({ stdout: '{"model":"test"}' });

    const proc = Bun.spawn({
      cmd: [...bunmsh, "-s", "--data-binary", "@-", `${origin}/body`],
      cwd: directory,
      stdin: Buffer.from("streamed body\n"),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [status, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()]);
    expect({ status, stdout }).toEqual({ status: 0, stdout: "streamed body\n" });
  });

  test("writes the response headers to -D", async () => {
    await curlIn("-s", "-o", "/dev/null", "-D", "head.txt", `${origin}/text`);
    expect(readFileSync(join(directory, "head.txt"), "utf8").startsWith("HTTP/1.1 200 OK\r\n")).toBe(true);
  });

  test("shows a progress meter for a file download and none for -s", async () => {
    const meter = await curlIn("-o", "meter.bin", `${origin}/blob`);
    expect(meter.stderr).toContain("% Total    % Received % Xferd");
    const silent = await curlIn("-s", "-o", "silent.bin", `${origin}/blob`);
    expect(silent.stderr).toBe("");
  });
});
