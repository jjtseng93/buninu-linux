// Shared renderer for /usr/share/doc/buninu-linux/<name>.md command manuals.
export const showDocument = async (name) => {
  const path = `${import.meta.dir}/../usr/share/doc/buninu-linux/${name}.md`;
  const rendered = Bun.markdown.ansi(await Bun.file(path).text(), { hyperlinks: true });
  process.stdout.write(rendered.endsWith("\n") ? rendered : `${rendered}\n`);
};
