#!/usr/bin/env jsmdcui

#### top

# Event Context Demo

This app demonstrates the same event-facing API in the TUI and WUI.
Activate links with the mouse, `Enter`, or `Space`, and put the cursor in the
keyboard field to inspect key events.

## Link Events

- Outputs appear in the bottom console
  * [**Jump to Output Console**](#output-console)
- .
- [Inspect this link](javascript:inspectLink(this,event))
- [Inspect another link](javascript:inspectLink(this,event))
- [**Inspect rich link content**](javascript:inspectLink(this,event))
- [Increment heading data](javascript:incrementHeadingData(this,event))
- [Inspect a multiply wrapped selection](javascript:inspectNestedSelection(this,event))

The link handler reads:

```js
$(this).text()
$(event.target).text()
$(this).html()
event.type
event.key
event.target === this
event.currentTarget === this
```

## Keyboard Events

- Outputs appear in the bottom console
  * [**Jump to Output Console**](#output-console)

```text#event-keyboard @keydown.prevent="inspectKey(this,event)"
Put the cursor here and press any key
```

The keyboard handler reads the control through `$(this).val()` and reports the
native-style `event.type`, `event.key`, modifier keys, and target identity.

## Heading References

The `$()` selection exposes its stable heading id and may be wrapped repeatedly:

```js
const selection = $($($(('#heading-references'))))
selection.id
selection.text()
selection.data()
```

- [Toggle the Details heading](javascript:$('#details').toggle())
- [Show the Details heading](javascript:$('#details').show())
- [Hide the Details heading](javascript:$('#details').hide())

You can also activate the first visible character of a heading with mouse,
`Enter`, or `Space` to toggle its section.

### Details

This content is controlled by `$('#details').show()`, `.hide()`, and `.toggle()`.
The heading itself remains visible.

- [**Jump to Top**](#top)
- .
- [Jump to key event](#keyboard-events)

## Output Console

```text#event-result
No event yet
```





```js front
const EVENT_HEADING_ID = 'event-context-demo';

function text(value) {
  return String(value ?? '');
}

function keyLabel(event) {
  if (event?.key === ' ') return 'Space';
  return text(event?.key) || '(none)';
}

function writeResult(title, fields) {
  const lines = [
    `
✓✓✓ Success ✓✓✓

${title}`,
    ...Object.entries(fields).map(([key, value]) =>
      `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`
    ),
  ];
  $('#event-result').val(lines.join('\n'));
}

export function inspectLink(target, event) {
  const wrappedThis = $(target);
  const wrappedTarget = $(event.target);

  writeResult('Link event', {
    '$(this).text()': wrappedThis.text(),
    '$(event.target).text()': wrappedTarget.text(),
    '$(this).html()': wrappedThis.html(),
    'this.tagName': text(target.tagName),
    'this.href': text(target.href),
    'event.type': text(event.type),
    'event.key': keyLabel(event),
    'event.target === this': event.target === target,
    'event.currentTarget === this': event.currentTarget === target,
  });
}

export function inspectKey(target, event) {
  writeResult('Keyboard event', {
    '$(this).val()': $(target).val(),
    'this.id': text(target.id),
    'this.tagName': text(target.tagName),
    'event.type': text(event.type),
    'event.key': keyLabel(event),
    'event.code': text(event.code),
    'event.ctrlKey': Boolean(event.ctrlKey),
    'event.shiftKey': Boolean(event.shiftKey),
    'event.altKey': Boolean(event.altKey),
    'event.metaKey': Boolean(event.metaKey),
    'event.target === this': event.target === target,
    'event.currentTarget === this': event.currentTarget === target,
  });
}

export function incrementHeadingData(target, event) {
  const heading = $('#' + EVENT_HEADING_ID);
  const data = heading.data();
  data.activations = Number(data.activations || 0) + 1;

  writeResult('ID-centered heading data', {
    'activated by': $(target).text(),
    'event.type': text(event.type),
    'heading.id': heading.id,
    'heading.text()': heading.text(),
    'heading.data() identity stable': heading.data() === data,
    activations: data.activations,
  });
}

export function inspectNestedSelection(target, event) {
  const original = $('#heading-references');
  const nested = $($($(original)));

  writeResult('Multiply wrapped selection', {
    'activated by': $(target).text(),
    'event.type': text(event.type),
    'original.id': original.id,
    'nested.id': nested.id,
    'nested.text()': nested.text(),
    'same data object': nested.data() === original.data(),
  });
}
```
