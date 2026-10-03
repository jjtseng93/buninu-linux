// /lib/gzip.js — gzip, gunzip and zcat over node:zlib. /bin/gzip, /bin/gunzip
// and /bin/zcat call run() with their own defaults, since a symlink would
// reach Bun under the target's name.
//
// Supported: -c/--stdout, -d/--decompress, -k/--keep, -f/--force, -n/--no-name,
// -N/--name (accepted; no name is ever stored), -q/--quiet, -t/--test,
// -v/--verbose, -1 ... -9, --fast, --best; FILE operands or "-" for stdin.
// Concatenated members decompress as one stream, as with GNU gzip.

import { existsSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync, writeSync } from "node:fs";
import { isatty } from "node:tty";
import { constants, gunzipSync, gzipSync } from "node:zlib";

const usage = (name) => `Usage: ${name} [-cdfkntqv1-9] [FILE...]
  -c, --stdout      write to standard output, keep the input files
  -d, --decompress  decompress
  -k, --keep        keep the input files
  -f, --force       overwrite output files; compress to a terminal
  -n, --no-name     (always the case) store no file name or time
  -t, --test        test the compressed files
  -q, --quiet       no warnings
  -v, --verbose     report each file
  -1 ... -9         fast ... best compression (default 6)
With no FILE, or when FILE is -, read standard input.`;

const writeAll = (fd, bytes) => {
  for (let offset = 0; offset < bytes.length;) offset += writeSync(fd, bytes, offset, bytes.length - offset);
};

const readStdin = () => {
  try {
    return readFileSync(0);
  } catch (error) {
    if (error.code === "EAGAIN") return readFileSync("/dev/stdin");
    throw error;
  }
};

export const run = (name, argv, defaults = {}) => {
  const options = { decompress: false, stdout: false, keep: false, force: false, test: false, quiet: false, verbose: false, level: 6, ...defaults };
  const files = [];
  let endOfOptions = false;
  for (const argument of argv) {
    if (endOfOptions || argument === "-" || !argument.startsWith("-")) { files.push(argument); continue; }
    if (argument === "--") { endOfOptions = true; continue; }
    const long = {
      "--stdout": "c", "--to-stdout": "c", "--decompress": "d", "--uncompress": "d", "--keep": "k", "--force": "f",
      "--no-name": "n", "--name": "N", "--test": "t", "--quiet": "q", "--verbose": "v", "--fast": "1", "--best": "9",
    }[argument];
    if (argument === "-h" || argument === "--help") { console.log(usage(name)); return 0; }
    const letters = long ?? (argument.startsWith("--") ? null : argument.slice(1));
    if (letters === null) { console.error(`${name}: unknown option ${argument}\n${usage(name)}`); return 1; }
    for (const letter of letters) {
      if (letter === "c") options.stdout = true;
      else if (letter === "d") options.decompress = true;
      else if (letter === "k") options.keep = true;
      else if (letter === "f") options.force = true;
      else if (letter === "t") options.test = options.decompress = true;
      else if (letter === "q") options.quiet = true;
      else if (letter === "v") options.verbose = true;
      else if (letter === "n" || letter === "N") {}
      else if (/[1-9]/.test(letter)) options.level = Number(letter);
      else { console.error(`${name}: unknown option -${letter}\n${usage(name)}`); return 1; }
    }
  }
  if (files.length === 0) files.push("-");

  const transform = (bytes) => options.decompress
    ? gunzipSync(bytes, { finishFlush: constants.Z_SYNC_FLUSH })
    : gzipSync(bytes, { level: options.level });

  let status = 0;
  for (const file of files) {
    const label = file === "-" ? "stdin" : file;
    try {
      if (file === "-" || options.stdout || options.test) {
        if (!options.decompress && !options.force && isatty(1) && !options.test) {
          console.error(`${name}: compressed data not written to a terminal. Use -f to force compression.`);
          return 1;
        }
        let input;
        if (file === "-") input = readStdin();
        else {
          if (statSync(file).isDirectory()) throw new Error("is a directory");
          input = readFileSync(file);
        }
        const output = transform(input);
        if (!options.test) writeAll(1, output);
        if (options.verbose) console.error(`${label}:\tOK`);
        continue;
      }
      // In place: FILE -> FILE.gz, or FILE.gz -> FILE.
      let target;
      if (options.decompress) {
        const match = /^(.*?)(\.gz|-gz|\.z|_z|\.tgz)$/i.exec(file);
        if (!match) { if (!options.quiet) console.error(`${name}: ${file}: unknown suffix -- ignored`); status = status || 2; continue; }
        target = match[1] + (match[2].toLowerCase() === ".tgz" ? ".tar" : "");
      } else {
        if (/\.gz$/i.test(file) && !options.force) { if (!options.quiet) console.error(`${name}: ${file} already has .gz suffix -- unchanged`); status = status || 2; continue; }
        target = `${file}.gz`;
      }
      const stat = statSync(file);
      if (stat.isDirectory()) throw new Error("is a directory -- ignored");
      if (existsSync(target) && !options.force) throw new Error(`${target} already exists`);
      writeFileSync(target, transform(readFileSync(file)), { mode: stat.mode & 0o7777 });
      utimesSync(target, stat.atime, stat.mtime);
      if (!options.keep) rmSync(file);
      if (options.verbose) console.error(`${file}:\t-> ${target}`);
    } catch (error) {
      console.error(`${name}: ${label}: ${error.message}`);
      status = 1;
    }
  }
  return status;
};
