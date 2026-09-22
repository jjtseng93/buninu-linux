// Shared renderer for /usr/share/doc/buninu-linux/<name>.md command manuals.
import { resolve } from "node:path";

export const showDocument = async (name) => {
  const path = resolve(`${import.meta.dir}/../usr/share/doc/buninu-linux/${name}.md`);
  const rendered = Bun.markdown.ansi(await Bun.file(path).text(), { hyperlinks: true });
  process.stdout.write(rendered.endsWith("\n") ? rendered : `${rendered}\n`);
  // Where the page lives, for anyone who wants to read or edit the source.
  process.stdout.write(`\u001b[2m${path}\u001b[0m\n`);
};
