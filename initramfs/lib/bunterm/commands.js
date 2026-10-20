// Local bunterm commands. Deliberately separate from the child shell.
export function createCommands({fontSize, setFontSize, copy, paste, switchVT}) {
  const commands = new Map([
    ["help", () => "font SIZE / + / - | copy | paste | vt NUMBER | help"],
    ["font", args => {
      if (args.length !== 1) throw new Error("Usage: font SIZE / + / -");
      const size = args[0] === "+" ? fontSize()+1 : args[0] === "-" ? fontSize()-1 : Number(args[0]);
      setFontSize(size);
      return `Font: ${fontSize()}`;
    }],
    ["copy", async args => {
      if (args.length) throw new Error("Usage: copy");
      await copy();
      return "Copied";
    }],
    ["paste", async args => {
      if (args.length) throw new Error("Usage: paste");
      await paste();
      return "Pasted";
    }],
    ["vt", async args => {
      if (args.length !== 1 || !/^[1-9]\d*$/.test(args[0]) || Number(args[0]) > 63) throw new Error("Usage: vt 1..63");
      await switchVT(Number(args[0]));
      return "";
    }],
  ]);
  return {
    commands,
    async execute(line) {
      const [name, ...args] = line.trim().split(/\s+/);
      if (!name) return "";
      const command = commands.get(name);
      if (!command) throw new Error(`Unknown command: ${name}; try help`);
      return await command(args);
    },
  };
}
