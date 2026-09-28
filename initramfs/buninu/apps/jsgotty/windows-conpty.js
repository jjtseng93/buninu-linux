// Windows PTY adapter for the out-of-band Microsoft Console package.
// Keep the same interface as BunPtyBackend in gotty.js.
const { dlopen, ptr } = require("bun:ffi");
const path = require("path");

const kernel = dlopen("kernel32.dll", {
  CreatePipe: { args: ["ptr", "ptr", "ptr", "u32"], returns: "i32" },
  InitializeProcThreadAttributeList: { args: ["ptr", "u32", "u32", "ptr"], returns: "i32" },
  UpdateProcThreadAttribute: { args: ["ptr", "u32", "usize", "ptr", "usize", "ptr", "ptr"], returns: "i32" },
  DeleteProcThreadAttributeList: { args: ["ptr"], returns: "void" },
  CreateProcessW: { args: ["ptr", "ptr", "ptr", "ptr", "i32", "u32", "ptr", "ptr", "ptr", "ptr"], returns: "i32" },
  PeekNamedPipe: { args: ["ptr", "ptr", "u32", "ptr", "ptr", "ptr"], returns: "i32" },
  ReadFile: { args: ["ptr", "ptr", "u32", "ptr", "ptr"], returns: "i32" },
  WriteFile: { args: ["ptr", "ptr", "u32", "ptr", "ptr"], returns: "i32" },
  GetExitCodeProcess: { args: ["ptr", "ptr"], returns: "i32" },
  TerminateProcess: { args: ["ptr", "u32"], returns: "i32" },
  CloseHandle: { args: ["ptr"], returns: "i32" },
  GetLastError: { args: [], returns: "u32" },
}).symbols;

const conptySymbols = {
  ConptyCreatePseudoConsole: { args: ["u32", "ptr", "ptr", "u32", "ptr"], returns: "i32" },
  ConptyResizePseudoConsole: { args: ["ptr", "u32"], returns: "i32" },
  ConptyClosePseudoConsole: { args: ["ptr"], returns: "void" },
};
const wide = (value) => Buffer.from(`${value}\0`, "utf16le");
const handle = (buffer) => Number(buffer.readBigUInt64LE(0));
const size = (cols, rows) => ((Math.max(1, rows) & 0xffff) << 16) | (Math.max(1, cols) & 0xffff);
const winError = (operation) => new Error(`${operation} failed: ${kernel.GetLastError()}`);
// Windows CRT argv escaping: double backslashes before quotes and at the end.
function quoteArg(value) {
  let result = '"', slashes = 0;
  for (const char of String(value)) {
    if (char === "\\") { slashes++; continue; }
    if (char === '"') result += "\\".repeat(slashes * 2 + 1) + '"';
    else result += "\\".repeat(slashes) + char;
    slashes = 0;
  }
  return result + "\\".repeat(slashes * 2) + '"';
}

class WindowsConptyBackend {
  constructor(options, dllPath) {
    this.options = options;
    this.dataHandlers = [];
    this.exitHandlers = [];
    this.closed = false;
    this.conpty = dlopen(path.resolve(dllPath), conptySymbols).symbols;
    const inputRead = Buffer.alloc(8), inputWrite = Buffer.alloc(8);
    const outputRead = Buffer.alloc(8), outputWrite = Buffer.alloc(8);
    if (!kernel.CreatePipe(inputRead, inputWrite, 0, 0)) throw winError("CreatePipe input");
    if (!kernel.CreatePipe(outputRead, outputWrite, 0, 0)) throw winError("CreatePipe output");
    this.input = handle(inputWrite);
    this.output = handle(outputRead);
    const pseudo = Buffer.alloc(8);
    const hr = this.conpty.ConptyCreatePseudoConsole(
      size(options.width || 80, options.height || 24), handle(inputRead), handle(outputWrite), 0, pseudo);
    kernel.CloseHandle(handle(inputRead));
    kernel.CloseHandle(handle(outputWrite));
    if (hr !== 0) throw new Error(`ConptyCreatePseudoConsole failed: ${hr}`);
    this.pseudo = handle(pseudo);

    const listSize = Buffer.alloc(8);
    kernel.InitializeProcThreadAttributeList(0, 1, 0, listSize);
    const list = Buffer.alloc(Number(listSize.readBigUInt64LE(0)));
    if (!kernel.InitializeProcThreadAttributeList(list, 1, 0, listSize)) throw winError("InitializeProcThreadAttributeList");
    if (!kernel.UpdateProcThreadAttribute(list, 0, 0x00020016, this.pseudo, 8, 0, 0)) throw winError("UpdateProcThreadAttribute");
    const startup = Buffer.alloc(112);
    startup.writeUInt32LE(112, 0);
    startup.writeUInt32LE(0x100, 60); // STARTF_USESTDHANDLES
    startup.writeBigUInt64LE(BigInt(ptr(list)), 104);
    const processInfo = Buffer.alloc(24);
    const env = { ...process.env, TERM: "xterm-256color", ...(options.headerEnv || {}) };
    const envBlock = wide(Object.entries(env).filter(([key]) => !key.startsWith("="))
      .map(([key, value]) => `${key}=${value}`).join("\0") + "\0");
    const executable = Bun.which(options.command) || options.command;
    const command = wide([executable, ...options.argv].map(quoteArg).join(" "));
    const ok = kernel.CreateProcessW(wide(executable), command, 0, 0, 0,
      0x00080000 | 0x00000400, envBlock, wide(process.cwd()), startup, processInfo);
    kernel.DeleteProcThreadAttributeList(list);
    if (!ok) throw winError("CreateProcessW");
    this.process = handle(processInfo);
    this.pid = processInfo.readUInt32LE(16);
    kernel.CloseHandle(Number(processInfo.readBigUInt64LE(8)));
    this.pollTimer = setInterval(() => this.poll(), 5);
  }

  onData(handler) { this.dataHandlers.push(handler); }
  onExit(handler) { this.exitHandlers.push(handler); }
  write(buffer) { this.writeBinary(buffer); }
  writeBinary(buffer) {
    const data = Buffer.from(buffer);
    const written = Buffer.alloc(4);
    for (let offset = 0; offset < data.length;) {
      const chunk = data.subarray(offset);
      if (!kernel.WriteFile(this.input, chunk, chunk.length, written, 0)) throw winError("WriteFile");
      const count = written.readUInt32LE(0);
      if (!count) throw new Error("WriteFile wrote no data");
      offset += count;
    }
  }
  resize(cols, rows) {
    const hr = this.conpty.ConptyResizePseudoConsole(this.pseudo, size(cols, rows));
    if (hr !== 0) throw new Error(`ConptyResizePseudoConsole failed: ${hr}`);
  }
  kill() { if (!this.closed) kernel.TerminateProcess(this.process, 1); }
  close() { this.kill(); }

  poll() {
    if (this.closed) return;
    const available = Buffer.alloc(4), readCount = Buffer.alloc(4);
    if (kernel.PeekNamedPipe(this.output, 0, 0, 0, available, 0)) {
      for (let bytes = available.readUInt32LE(0); bytes > 0; bytes = available.readUInt32LE(0)) {
        const data = Buffer.alloc(Math.min(bytes, 65536));
        if (!kernel.ReadFile(this.output, data, data.length, readCount, 0)) break;
        const count = readCount.readUInt32LE(0);
        if (!count) break;
        for (const handler of this.dataHandlers) handler(data.subarray(0, count));
        if (!kernel.PeekNamedPipe(this.output, 0, 0, 0, available, 0)) break;
      }
    }
    const exitCode = Buffer.alloc(4);
    if (kernel.GetExitCodeProcess(this.process, exitCode) && exitCode.readUInt32LE(0) !== 259) {
      this.closed = true;
      clearInterval(this.pollTimer);
      this.conpty.ConptyClosePseudoConsole(this.pseudo);
      kernel.CloseHandle(this.input);
      kernel.CloseHandle(this.output);
      kernel.CloseHandle(this.process);
      for (const handler of this.exitHandlers) handler();
    }
  }
}

module.exports = WindowsConptyBackend;
