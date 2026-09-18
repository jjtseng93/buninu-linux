#!/usr/bin/env jsmdcui

# Select and Task List Demo

Use `Enter` or `Space` to toggle a task item in the TUI, then activate these
links to read the values under headings at different levels.

- [Read primary color (h2 single value)](javascript:showHeadingValue('select-primary-color'))
- [Read enabled features (h3 array)](javascript:showHeadingValue('enabled-features'))
- [Read log level (h4 single value)](javascript:showHeadingValue('select-log-level'))
- [Read permissions (h2 array)](javascript:showHeadingValue('permissions'))
- [Read every group](javascript:showAllHeadingValues())

## Select Primary Color

- [ ] Red
- [x] Green
  - [x] Nested green detail (ignored)
  - [ ] Another nested detail (ignored)
- [x] Blue (ignored because select returns the first checked value)

### Enabled Features

- [x] Search
- [ ] Notifications
  - [x] Nested notification option (ignored)
- [x] Offline mode
- [x] Sync

#### Select Log Level

- [ ] Debug
- [x] Info
- [ ] Warning
- [ ] Error

## Permissions

- [x] Read
- [x] Write
  - [x] Write temporary files (ignored)
  - [ ] Write system files (ignored)
- [ ] Execute
- [x] Share

```js front
export function showHeadingValue(id)
{
  const value = $('#'+id).val();
  alert(id+': '+JSON.stringify(value));
}

export function showAllHeadingValues()
{
  const values = {
    primaryColor: $('#select-primary-color').val(),
    enabledFeatures: $('#enabled-features').val(),
    logLevel: $('#select-log-level').val(),
    permissions: $('#permissions').val(),
  };
  alert(JSON.stringify(values, null, 2));
}
```
