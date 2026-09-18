export function expandBuildMdAliases(argv = process.argv) {
  const buildMdExeIndex = argv.indexOf("--build-md-exe");
  if (buildMdExeIndex !== -1) {
    const markdown = argv[buildMdExeIndex + 1];
    if (!markdown || markdown.startsWith("-")) {
      throw new Error("Missing Markdown path for --build-md-exe");
    }

    argv.splice(
      buildMdExeIndex,
      2,
      "--build-exe",
      "--define",
      `global.MDCUI_MAIN=${markdown}`,
    );
    return true;
  }

  const buildMdForIndex = argv.indexOf("--build-md-for");
  if (buildMdForIndex === -1) return false;

  const platform = argv[buildMdForIndex + 1];
  if (!platform || platform.startsWith("-")) {
    throw new Error("Missing platform for --build-md-for");
  }
  const markdown = argv[buildMdForIndex + 2];
  if (!markdown || markdown.startsWith("-")) {
    throw new Error("Missing Markdown path for --build-md-for");
  }

  argv.splice(
    buildMdForIndex,
    3,
    "--build-for",
    platform,
    "--define",
    `global.MDCUI_MAIN=${markdown}`,
  );
  return true;
}
