export function parseCatOperands(argv, name) {
  const operands = [];
  const excluded = [];
  let options = true;

  for (let i = 1; i < argv.length; i++) {
    const value = argv[i];
    if (options && value === "--") {
      options = false;
    } else if (options && value === "--exclude") {
      if (i + 1 >= argv.length)
        return { error: `bunmsh: ${name}: --exclude: missing file operand\n` };
      excluded.push(argv[++i]);
    } else if (options && value.startsWith("--exclude=")) {
      excluded.push(value.slice("--exclude=".length));
    } else if (options && value.startsWith("-") && value !== "-") {
      return { error: `bunmsh: ${name}: ${value}: unknown option\n` };
    } else {
      operands.push(value);
    }
  }

  if (operands.length === 0) return { operands: ["-"] };
  const patterns = excluded.map((pattern) => new Bun.Glob(pattern.replaceAll("\\", "/")));
  return {
    operands: operands.filter((operand) => {
      const path = operand.replaceAll("\\", "/");
      return !patterns.some((pattern) => pattern.match(path));
    }),
  };
}
