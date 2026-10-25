# Normal HTML follow-up

Tested with the same unmodified micro highlighter oracle and upstream YAML as
REPORT.md. See normal-html-report.json for counts and first differing positions.
The full comparison.html was also passed to both engines as input, unchanged.

The minimal reproduction is ordinary valid HTML:

```html
<div class="hello">Hello</div>
<p>Next line</p>
```

With html.yaml (the definition selected by the .html filename), jmi ends the
first line with a constant.string state and colors the entire second line as a
string. This is a real nested-region state bug, not just a malformed generated
sample. normal-html.html contains a complete document for manual reproduction.

For the generated comparison.html, html.yaml produced 731354 differing character
groups, including 438494 characters marked as strings only by jmi. This large
one-line file amplifies the state issue; it is not a typical per-file error rate.
The same full file matched with explicitly selected html4.yaml and html5.yaml,
which have different rules and are not the default .html filename match.

This check did not modify the highlighter or the syntax files.

## After the nested-region fix

The historical reproduction above is now covered by highlight-regions.test.js.
The child scanner already resumes its parent and processes the rest of the line;
returning that result directly avoids rescanning closing quotes as new openings.
Both HTML and XML now return to the correct outer state, including when an
attribute legitimately spans multiple lines. Original syntax YAML is unchanged.

The current normal-html-report.json records the follow-up: simple HTML,
two-attribute HTML and a complete normal document have no extra string-colored
characters. Their remaining differences are local token groups, such as micro
using symbol.tag where jmi recognizes an attribute as identifier. The current
comparison.html still has local group differences and is not fully identical.
It is regenerated from the latest results, so its total size differs from the
historical input above; raw differing-character totals are not a fixed-corpus
before/after benchmark.

The 158-syntax corpus now has 130 identical samples and 28 with differences.
XML and MSBuild samples match completely. Mixed POSIX character classes are
also translated; default/email, mail and privoxy-action samples now match.
