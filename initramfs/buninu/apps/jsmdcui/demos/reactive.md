#!/usr/bin/env jsmdcui

# Reactive Template Demo / 響應式模板示範

Type a name below. After you stop typing for 200 ms, the template updates in
both the TUI and WUI.

在下方輸入名字；停止輸入 200 毫秒後，TUI 與 WUI 中的模板都會自動更新。

```text#reactive-name @input="updateReactiveName(event)"
Johnny
```

## Reactive Result

````md template
---
name: Johnny
---
恭喜你，**${data.name}**，成就金仙！

Congratulations, **${data.name}**! You have attained the Golden Immortal realm.
````

```js front
let reactiveNameTimer = null;

export function updateReactiveName(event) {

  const name = $(event.target).val().trim() || '無名道友 / Nameless Daoist';
  
  
  clearTimeout(reactiveNameTimer);
  reactiveNameTimer = setTimeout(() => {
    
    $('#reactive-result').data('name', name);
    
  }, 200);
}
```
