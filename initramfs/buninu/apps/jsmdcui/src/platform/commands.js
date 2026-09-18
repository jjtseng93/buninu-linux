import process from "node:process";

const decoder = new TextDecoder();

let _httpBackend = null;

export function detectHttpBackend() {
  if (_httpBackend !== null) return _httpBackend;
  if (Bun.which("curl")) { _httpBackend = "curl"; return _httpBackend; }
  if (Bun.which("wget")) { _httpBackend = "wget"; return _httpBackend; }
  _httpBackend = "fetch";
  return _httpBackend;
}

export async function fetchHttp(url) {
  return decoder.decode(await fetchHttpBytes(url));
}

export async function fetchHttpBytes(url, options = {}) {
  const b = detectHttpBackend();
  const timeoutMs = Number.isFinite(options.timeoutMs)
    ? Math.max(1, Math.trunc(options.timeoutMs))
    : null;
  const timeoutSeconds = timeoutMs == null
    ? null
    : String(Math.max(1, Math.ceil(timeoutMs / 1000)));
  if (b === "curl") {
    const command = ["curl", "-kL", "--silent", "--fail"];
    if (timeoutSeconds != null)
      command.push("--connect-timeout", timeoutSeconds, "--max-time", timeoutSeconds);
    command.push(url);
    const r = await runBytes(command, {
      allowFailure: true,
      timeout: timeoutMs,
      signal: options.signal,
    });
    if (!r.ok) throw new Error(`curl: ${r.stderr.trim() || "failed"} (${url})`);
    return r.stdout;
  }
  if (b === "wget") {
    const command = ["wget", "--no-check-certificate", "-q", "-O", "-"];
    if (timeoutSeconds != null)
      command.push(`--timeout=${timeoutSeconds}`, "--tries=1");
    command.push(url);
    const r = await runBytes(command, {
      allowFailure: true,
      timeout: timeoutMs,
      signal: options.signal,
    });
    if (!r.ok) throw new Error(`wget: ${r.stderr.trim() || "failed"} (${url})`);
    return r.stdout;
  }
  const controller = timeoutMs == null && !options.signal
    ? null
    : new AbortController();
  const abort = () => controller?.abort(options.signal?.reason);
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener("abort", abort, { once: true });
  const timeout = timeoutMs != null
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;
  try {
    const resp = await fetch(
      url,
      controller ? { signal: controller.signal } : undefined,
    );
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${url}`);
    return new Uint8Array(await resp.arrayBuffer());
  } finally {
    if (timeout != null) clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
  }
}

export async function downloadFile(url, outPath) {
  const b = detectHttpBackend();
  if (b === "curl") {
    await run(["curl", "-kL", "--silent", "--fail", "-o", outPath, url]);
    return;
  }
  if (b === "wget") {
    await run(["wget", "--no-check-certificate", "-q", "-O", outPath, url]);
    return;
  }
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${url}`);
  await Bun.write(outPath, resp);
}

export function platformId() {
  return process.platform;
}

export function isLinuxLike() {
  const platform = platformId();
  return platform === "linux" || platform === "android";
}

export function runSync(command, options = {}) {
  try {
    const spawnOpts = {
      stdio: [stdioInput(options.stdin), options.stdout ?? "pipe", options.stderr ?? "pipe"],
      env: options.env ?? process.env,
      cwd: options.cwd,
    };
    if (options.timeout != null) spawnOpts.timeout = options.timeout;
    const proc = Bun.spawnSync(command, spawnOpts);
    return {
      ok: proc.success,
      code: proc.exitCode,
      stdout: proc.stdout ? decoder.decode(proc.stdout) : "",
      stderr: proc.stderr ? decoder.decode(proc.stderr) : "",
    };
  } catch (error) {
    return {
      ok: false,
      code: -1,
      stdout: "",
      stderr: String(error?.message || error),
    };
  }
}

export async function run(command, options = {}) {
  const proc = Bun.spawn(command, {
    stdio: [stdioInput(options.stdin), options.stdout ?? "pipe", options.stderr ?? "pipe"],
    env: options.env ?? process.env,
    cwd: options.cwd,
  });
  const [stdout, stderr, code] = await Promise.all([
    proc.stdout ? new Response(proc.stdout).text() : Promise.resolve(""),
    proc.stderr ? new Response(proc.stderr).text() : Promise.resolve(""),
    proc.exited,
  ]);
  if (code !== 0 && !options.allowFailure) {
    throw new Error(`${command[0]} exited with ${code}: ${stderr || stdout}`);
  }
  return { ok: code === 0, code, stdout, stderr };
}

export async function runBytes(command, options = {}) {
  const failure = (message, code = -1) => {
    const result = {
      ok: false,
      code,
      stdout: new Uint8Array(),
      stderr: message,
    };
    if (!options.allowFailure) throw new Error(message);
    return result;
  };
  if (options.signal?.aborted)
    return failure(`${command[0]} aborted`);

  const proc = Bun.spawn(command, {
    stdio: [stdioInput(options.stdin), options.stdout ?? "pipe", options.stderr ?? "pipe"],
    env: options.env ?? process.env,
    cwd: options.cwd,
  });
  const timeoutMs = Number.isFinite(options.timeout)
    ? Math.max(1, Math.trunc(options.timeout))
    : null;
  let interrupted = "";
  const interrupt = message => {
    if (interrupted) return;
    interrupted = message;
    try { proc.kill(); } catch {}
  };
  const abort = () => interrupt(`${command[0]} aborted`);
  options.signal?.addEventListener("abort", abort, { once: true });
  const timeout = timeoutMs == null
    ? null
    : setTimeout(
      () => interrupt(`${command[0]} timed out after ${timeoutMs}ms`),
      timeoutMs,
    );
  let stdoutBuf;
  let stderr;
  let code;
  try {
    [stdoutBuf, stderr, code] = await Promise.all([
      proc.stdout ? new Response(proc.stdout).arrayBuffer() : Promise.resolve(new ArrayBuffer(0)),
      proc.stderr ? new Response(proc.stderr).text() : Promise.resolve(""),
      proc.exited,
    ]);
  } finally {
    if (timeout != null) clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
  }
  const stdout = new Uint8Array(stdoutBuf);
  if (interrupted) {
    const message = stderr.trim()
      ? `${interrupted}: ${stderr.trim()}`
      : interrupted;
    if (!options.allowFailure) throw new Error(message);
    return { ok: false, code, stdout, stderr: message };
  }
  if (code !== 0 && !options.allowFailure) {
    throw new Error(`${command[0]} exited with ${code}: ${stderr || decoder.decode(stdout)}`);
  }
  return { ok: code === 0, code, stdout, stderr };
}

export function hasCommand(name) {
  return Bun.which(name);
}

export function firstCommand(names) {
  return names.find((name) => hasCommand(name)) ?? null;
}

export function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function stdioInput(input) {
  if (input == null) return "ignore";
  if (input === "pipe" || input === "inherit" || input === "ignore") return input;
  if (typeof input === "string" || input instanceof Uint8Array || input instanceof ArrayBuffer) return new Blob([input]);
  return input;
}
