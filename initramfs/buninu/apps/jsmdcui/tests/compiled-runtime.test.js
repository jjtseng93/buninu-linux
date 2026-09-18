import { expect, test } from "bun:test";
import { expandBuildMdAliases } from "../src/build-args.js";
import {
  isCompiledBinary as isSingleExeCompiled,
  stringifyNonPrimitiveDefineValues,
} from "../single-exe/compiled.js";

test("single-exe recognizes Bun compiled virtual paths", () => {
  expect(isSingleExeCompiled(["bun", "/$bunfs/root/app.js"])).toBe(true);
  expect(isSingleExeCompiled(["bun", "B:/~BUN/root/app.js"])).toBe(true);
  expect(isSingleExeCompiled(["bun", "/project/src/index.js"])).toBe(false);
});

test("--build-md-exe expands before the existing build flow", () => {
  const argv = [
    "bun",
    "src/index.js",
    "--build-md-exe",
    "../中文工具.md",
    "--sourcemap",
  ];
  expect(expandBuildMdAliases(argv)).toBe(true);
  expect(argv).toEqual([
    "bun",
    "src/index.js",
    "--build-exe",
    "--define",
    "global.MDCUI_MAIN=../中文工具.md",
    "--sourcemap",
  ]);
  expect(expandBuildMdAliases(argv)).toBe(false);
});

test("--build-md-exe requires a Markdown path", () => {
  expect(() => expandBuildMdAliases(["bun", "index.js", "--build-md-exe"]))
    .toThrow("Missing Markdown path for --build-md-exe");
  expect(() => expandBuildMdAliases([
    "bun",
    "index.js",
    "--build-md-exe",
    "--sourcemap",
  ])).toThrow("Missing Markdown path for --build-md-exe");
});

test("--build-md-for expands before the existing cross-build flow", () => {
  const argv = [
    "bun",
    "src/index.js",
    "--build-md-for",
    "bun-linux-x64",
    "../中文工具.md",
    "--sourcemap",
  ];
  expect(expandBuildMdAliases(argv)).toBe(true);
  expect(argv).toEqual([
    "bun",
    "src/index.js",
    "--build-for",
    "bun-linux-x64",
    "--define",
    "global.MDCUI_MAIN=../中文工具.md",
    "--sourcemap",
  ]);
});

test("--build-md-for requires a platform and Markdown path", () => {
  expect(() => expandBuildMdAliases(["bun", "index.js", "--build-md-for"]))
    .toThrow("Missing platform for --build-md-for");
  expect(() => expandBuildMdAliases([
    "bun",
    "index.js",
    "--build-md-for",
    "bun-linux-x64",
  ])).toThrow("Missing Markdown path for --build-md-for");
});

test("non-primitive MDCUI_MAIN define values become strings", () => {
  const split = [
    "bun",
    "src/index.js",
    "--build-exe",
    "--define",
    "global.MDCUI_MAIN=../中文=工具.md",
  ];
  expect(
    stringifyNonPrimitiveDefineValues(split, "global.MDCUI_MAIN"),
  ).toBe(split);
  expect(split.at(-1)).toBe(
    'global.MDCUI_MAIN="../中文=工具.md"',
  );

  const inline = [
    "--define=global.MDCUI_MAIN=../m.md",
    "--define",
    "OTHER=../other.md",
    "--define",
    "global.MDCUI_MAIN_BASE=m.md",
  ];
  stringifyNonPrimitiveDefineValues(inline, "global.MDCUI_MAIN");
  expect(inline).toEqual([
    '--define=global.MDCUI_MAIN="../m.md"',
    "--define",
    "OTHER=../other.md",
    "--define",
    "global.MDCUI_MAIN_BASE=m.md",
  ]);

  for (const source of ["", "[]", "{}", "makePath()"]) {
    const argv = ["--define", `global.MDCUI_MAIN=${source}`];
    stringifyNonPrimitiveDefineValues(argv, "global.MDCUI_MAIN");
    expect(argv[1]).toBe(
      `global.MDCUI_MAIN=${JSON.stringify(source)}`,
    );
  }
});

test("primitive MDCUI_MAIN define values keep their type", () => {
  const cases = new Map([
    ['"../m.md"', '"../m.md"'],
    ["'../m.md'", '"../m.md"'],
    ["true", "true"],
    ["false", "false"],
    ["null", "null"],
    ["undefined", "undefined"],
    ["0", "0"],
    ["-1.5", "-1.5"],
    ["NaN", "NaN"],
    ["Infinity", "Infinity"],
    ["0xff", "0xff"],
    ["0b10", "0b10"],
    ["1_000", "1_000"],
  ]);

  for (const [source, normalized] of cases) {
    const argv = ["--define", `global.MDCUI_MAIN=${source}`];
    stringifyNonPrimitiveDefineValues(argv, "global.MDCUI_MAIN");
    expect(argv[1]).toBe(`global.MDCUI_MAIN=${normalized}`);
  }
});
