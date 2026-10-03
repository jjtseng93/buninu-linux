// /lib/mtools.js — mmd, mcopy and mdir over /lib/fat.js, with mtools'
// "-i IMAGE" and "::/path" conventions. /bin/mmd, /bin/mcopy and /bin/mdir
// call these; IMAGE may be "file@@offset".

import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { ATTR, FatError, now, openVolume } from "./fat.js";

/** Splits "-i IMAGE" and the option letters from the operands. */
const parse = (name, argv, letters, withValue = []) => {
  const options = { image: null, flags: new Set(), values: {} };
  const operands = [];
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "-i") {
      if (index + 1 >= argv.length) throw new FatError("-i requires an image");
      options.image = argv[++index];
    } else if (argument.startsWith("-i") && argument.length > 2) options.image = argument.slice(2);
    else if (withValue.includes(argument)) {
      if (index + 1 >= argv.length) throw new FatError(`${argument} requires an argument`);
      options.values[argument] = argv[++index];
    } else if (argument.startsWith("-") && argument.length > 1) {
      for (const letter of argument.slice(1)) {
        if (!letters.includes(letter)) throw new FatError(`unknown option -${letter}`);
        options.flags.add(letter);
      }
    } else operands.push(argument);
  }
  if (!options.image) throw new FatError(`${name} needs -i IMAGE`);
  return { options, operands };
};

const isImagePath = (operand) => operand.startsWith("::");
const imagePath = (operand) => {
  if (!isImagePath(operand)) throw new FatError(`${operand}: expected ::/path inside the image`);
  return `/${operand.slice(2).replace(/^\/+/, "")}`;
};

const guard = (name, action) => {
  try {
    return action();
  } catch (error) {
    if (!(error instanceof FatError)) throw error;
    console.error(`${name}: ${error.message}`);
    return 1;
  }
};

export const mmd = (argv) => guard("mmd", () => {
  const { options, operands } = parse("mmd", argv, "vQ", ["-D"]);
  if (!operands.length) throw new FatError("usage: mmd -i IMAGE ::/DIR...");
  const volume = openVolume(options.image);
  let status = 0;
  try {
    for (const operand of operands) {
      try { volume.mkdir(imagePath(operand)); }
      catch (error) { if (!(error instanceof FatError)) throw error; console.error(`mmd: ${error.message}`); status = 1; }
    }
  } finally {
    volume.close();
  }
  return status;
});

/**
 * mcopy: local files into the image (TARGET ::/path) or image files out of
 * it (SOURCES ::/path). -o / -D o overwrites in the image, -n overwrites
 * local files without asking, -m keeps the source's modification time.
 */
export const mcopy = (argv) => guard("mcopy", () => {
  const { options, operands } = parse("mcopy", argv, "onmvQpbt", ["-D"]);
  if (operands.length < 2) throw new FatError("usage: mcopy -i IMAGE SOURCE... TARGET");
  const target = operands.at(-1);
  const sources = operands.slice(0, -1);
  const overwrite = options.flags.has("o") || options.values["-D"] === "o";
  let status = 0;
  if (isImagePath(target)) {
    if (sources.some(isImagePath)) throw new FatError("copying within the image is not supported");
    const volume = openVolume(options.image);
    try {
      const destination = imagePath(target);
      const existing = volume.lookup(destination);
      const intoDirectory = (existing && existing.attributes & ATTR.DIRECTORY) || target.endsWith("/");
      if (sources.length > 1 && !intoDirectory) throw new FatError(`${target}: not a directory`);
      for (const source of sources) {
        try {
          const stat = statSync(source);
          if (stat.isDirectory()) throw new FatError(`${source}: is a directory (-s is not supported)`);
          const path = intoDirectory ? `${destination.replace(/\/+$/, "")}/${basename(source)}` : destination;
          const date = options.flags.has("m") ? stat.mtime : now().date;
          volume.writeFile(path, readFileSync(source), { date, overwrite });
          if (options.flags.has("v")) console.error(`Copying ${basename(source)}`);
        } catch (error) {
          if (!(error instanceof FatError) && !error.code) throw error;
          console.error(`mcopy: ${error.message}`);
          status = 1;
        }
      }
    } finally {
      volume.close();
    }
    return status;
  }
  if (!sources.every(isImagePath)) throw new FatError("either TARGET or every SOURCE must be ::/path");
  const volume = openVolume(options.image, false);
  try {
    const intoDirectory = existsSync(target) && statSync(target).isDirectory();
    if (sources.length > 1 && !intoDirectory) throw new FatError(`${target}: not a directory`);
    for (const source of sources) {
      try {
        const path = imagePath(source);
        const output = target === "-" ? null : intoDirectory ? join(target, basename(path)) : target;
        if (output && existsSync(output) && !options.flags.has("n") && !overwrite) throw new FatError(`${output}: file exists (use -n to overwrite)`);
        const bytes = volume.readFile(path);
        if (output === null) process.stdout.write(bytes); else writeFileSync(output, bytes);
      } catch (error) {
        if (!(error instanceof FatError) && !error.code) throw error;
        console.error(`mcopy: ${error.message}`);
        status = 1;
      }
    }
  } finally {
    volume.close();
  }
  return status;
});

const pad = (value) => String(value).padStart(2, "0");
const showDate = (date, time) => `${(date >> 9) + 1980}-${pad((date >> 5) & 15)}-${pad(date & 31)} ${pad(time >> 11)}:${pad((time >> 5) & 63)}`;

export const mdir = (argv) => guard("mdir", () => {
  const { options, operands } = parse("mdir", argv, "bawf");
  const volume = openVolume(options.image, false);
  try {
    for (const operand of operands.length ? operands : ["::/"]) {
      const path = imagePath(operand);
      const entries = volume.list(path).filter((entry) => options.flags.has("a") || !(entry.attributes & ATTR.HIDDEN));
      if (options.flags.has("b")) {
        for (const entry of entries) if (!(entry.attributes & ATTR.VOLUME) && entry.name !== "." && entry.name !== "..") console.log(`::${path.replace(/\/$/, "")}/${entry.name}`);
        continue;
      }
      console.log(`Directory for ::${path}\n`);
      let files = 0;
      let bytes = 0;
      for (const entry of entries) {
        if (entry.attributes & ATTR.VOLUME) continue;
        const size = entry.attributes & ATTR.DIRECTORY ? "<DIR>".padEnd(10) : String(entry.size).padStart(10);
        console.log(`${entry.name.padEnd(24)} ${size} ${showDate(entry.date, entry.time)}`);
        files++;
        bytes += entry.size;
      }
      console.log(`${String(files).padStart(8)} file${files === 1 ? "" : "s"} ${String(bytes).padStart(16)} bytes`);
    }
  } finally {
    volume.close();
  }
  return 0;
});
