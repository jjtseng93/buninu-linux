// Match original archive paths, before --strip-components. Testing ancestors
// makes an excluded directory exclude its whole subtree, even without a
// directory header. Like tar's default excludes, matches may start at any
// path component. Glob syntax is Bun.Glob's, not every GNU tar extension.
const normalize = (name) => name.replace(/^(?:\.\/)+/, "").replace(/^\/+|\/+$/g, "");

export function excludeMatcher(patterns) {
  if (!patterns.length) return () => false;
  const globs = patterns.map((pattern) => new Bun.Glob(normalize(pattern)));
  return (name) => {
    const parts = normalize(name).split("/");
    for (let end = parts.length; end > 0; end--) {
      for (let start = 0; start < end; start++) {
        const candidate = parts.slice(start, end).join("/");
        if (globs.some((glob) => glob.match(candidate))) return true;
      }
    }
    return false;
  };
}
