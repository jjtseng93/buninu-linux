// Generate musl 1.2.6 public headers without Make, sed or a C compiler.
import {
  existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

export function generateHeaders(arch, source, output) {
  if (readFileSync(join(source, "VERSION"), "utf8").trim() !== "1.2.6") {
    throw new Error("This generator follows musl 1.2.6's header rules");
  }
  if (existsSync(output)) throw new Error(`Refusing existing output: ${output}`);
  const headers = new Map();
  const copyHeaders = (directory, prefix = "") => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".h")) {
        headers.set(prefix + entry.name, readFileSync(join(directory, entry.name)));
      }
    }
  };

  // Makefile's include/*.h and include/*/*.h public headers.
  copyHeaders(join(source, "include"));
  for (const entry of readdirSync(join(source, "include"), { withFileTypes: true })) {
    if (entry.isDirectory()) copyHeaders(join(source, "include", entry.name), entry.name + "/");
  }
  // Architecture-specific bits override generic fallbacks.
  copyHeaders(join(source, "arch/generic/bits"), "bits/");
  copyHeaders(join(source, "arch", arch, "bits"), "bits/");

  // Translate tools/mkalltypes.sed's three substitutions literally. The
  // replacement's final newline is intentional, in addition to the input's.
  const types = readFileSync(join(source, "arch", arch, "bits/alltypes.h.in"), "utf8")
    + readFileSync(join(source, "include/alltypes.h.in"), "utf8");
  headers.set("bits/alltypes.h", types
    .replace(/^TYPEDEF (.*) ([^ ]*);$/gm, (_, type, name) =>
      `#if defined(__NEED_${name}) && !defined(__DEFINED_${name})\ntypedef ${type} ${name};\n#define __DEFINED_${name}\n#endif\n`)
    .replace(/^STRUCT * ([^ ]*) (.*);$/gm, (_, name, body) =>
      `#if defined(__NEED_struct_${name}) && !defined(__DEFINED_struct_${name})\nstruct ${name} ${body};\n#define __DEFINED_struct_${name}\n#endif\n`)
    .replace(/^UNION * ([^ ]*) (.*);$/gm, (_, name, body) =>
      `#if defined(__NEED_union_${name}) && !defined(__DEFINED_union_${name})\nunion ${name} ${body};\n#define __DEFINED_union_${name}\n#endif\n`));

  // Makefile: copy the input, then append sed -n 's/__NR_/SYS_/p' output.
  const syscalls = readFileSync(join(source, "arch", arch, "bits/syscall.h.in"), "utf8");
  const aliases = syscalls.split("\n").filter(line => line.includes("__NR_"))
    .map(line => line.replace("__NR_", "SYS_") + "\n").join("");
  headers.set("bits/syscall.h", syscalls + aliases);

  const previousUmask = process.umask(0o022);
  try {
    mkdirSync(output); // Parent must exist; refuse races with another writer.
    for (const [name, data] of headers) {
      const path = join(output, name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, data, { flag: "wx", mode: 0o644 });
    }
  } finally { process.umask(previousUmask); }
  console.log(`Generated ${headers.size} ${arch} headers at ${output}`);
}

