// Probe the parser, not Bun.version: canaries and backports can differ.
// CommonMark allows `/` after a block tag name only as part of `/>`.
const probe = Bun.markdown.html("<h1/id=x>Raw</h1>\n");
const raw = "<h1/id=x>Raw</h1>\n";
const escaped = "<p>&lt;h1/id=x&gt;Raw</h1></p>\n";
if (probe !== raw && probe !== escaped) {
  throw new Error(`Unexpected Bun Markdown slash-tag behavior: ${JSON.stringify(probe)}`);
}
export const escapesSlashTags = probe === escaped;
