#!/usr/bin/env jsmdcui

# Todo List

## Todos

- [ ] canvas support
- [x] push/pop/splice/slice list items
- [x] image by --kitty
- [ ] clean up codebase

## Actions

```text#todo-input
Fly to the moon
```

在上方輸入 Todo 文字，再選擇新增或移除。移除會刪除第一個文字完全相同的項目。

- [新增 Todo](javascript:addTodo())
- .
- [移除 Todo](javascript:removeTodo())
- .
- [顯示已完成](javascript:showCompleted())
- .
- [顯示未完成](javascript:showPending())

## 存檔／讀檔

```text#todo-file
todo_list.json
```

在上方輸入 JSON 檔案路徑。存檔會寫入人類可讀的 JSON；讀檔會在確認後取代目前的 Todo 清單。

- [儲存 Todos](javascript:saveTodos())
- .
- [讀取 Todos](javascript:loadTodos())

## 操作結果：

```text#todo-status
尚未操作
```

## Filtered Result

```text#todo-result
點按「顯示已完成」或「顯示未完成」查看結果
```

```js front
function todoText() {
  return $('#todo-input').val().trim();
}

function showItems(title, checked) {
  const items = $('#todos')
    .slice()
    .filter(item => item.checked === checked);

  const output = items.length
    ? items.map(item => `${item.checked ? '✓' : '○'} ${item.value}`).join('\n')
    : '（沒有項目）';
  $('#todo-result').val(`${title}\n${output}`);
  $('#todo-status').val(`找到 ${items.length} 個${title}項目`);
}

function todoFile() {
  return $('#todo-file').val().trim();
}

function describeError(error) {
  return error?.message || String(error);
}

export function addTodo() {
  const value = todoText();
  if (!value) {
    $('#todo-status').val('新增失敗：請先輸入 Todo 文字');
    return;
  }

  const length = $('#todos').push(value);
  $('#todo-input').val('');
  $('#todo-status').val(`已新增「${value}」，目前共有 ${length} 個 Todo`);
}

export function removeTodo() {
  const value = todoText();
  if (!value) {
    $('#todo-status').val('移除失敗：請輸入要移除的 Todo 文字');
    return;
  }

  const items = $('#todos').slice();
  const index = items.findIndex(item => item.value === value);
  if (index < 0) {
    $('#todo-status').val(`移除失敗：找不到「${value}」`);
    return;
  }

  const removed = $('#todos').splice(index, 1);
  $('#todo-input').val('');
  $('#todo-status').val(`已移除「${removed[0]}」`);
}

export function showCompleted() {
  showItems('已完成', true);
}

export function showPending() {
  showItems('未完成', false);
}

export async function saveTodos() {
  const file = todoFile();
  if (!file) {
    $('#todo-status').val('存檔失敗：請先輸入 JSON 檔案路徑');
    return;
  }

  try {
    const obj = { todos: $('#todos').slice() };
    const result = await rpc.saveTodoList(file, obj);
    $('#todo-status').val(`已將 ${obj.todos.length} 個 Todo 儲存至 ${result.path}`);
  } catch (error) {
    $('#todo-status').val(`存檔失敗：${describeError(error)}`);
  }
}

export async function loadTodos() {
  const file = todoFile();
  if (!file) {
    $('#todo-status').val('讀檔失敗：請先輸入 JSON 檔案路徑');
    return;
  }
  try {
    const result = await rpc.loadTodoList(file);
    const json = JSON.stringify(result.obj, null, 1);
    if (!confirm(`要用「${file}」中的以下 JSON 取代目前的 Todo 清單嗎？\n\n${json}`)) {
      $('#todo-status').val('已取消讀檔，目前的 Todos 未變更');
      return;
    }
    const current = $('#todos').slice();
    $('#todos').splice(0, current.length, ...result.obj.todos);
    $('#todo-status').val(`已從 ${result.path} 讀取 ${result.obj.todos.length} 個 Todo`);
  } catch (error) {
    $('#todo-status').val(`讀檔失敗：${describeError(error)}`);
  }
}
```

```js back
import { resolve } from 'node:path';

function todoPath(input) {
  const value = String(input ?? '').trim();
  if (!value) throw new Error('請先輸入 JSON 檔案路徑');
  return resolve(value);
}

function validateTodoObject(obj) {
  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.todos))
    throw new Error('Todo JSON 必須是包含 todos 陣列的物件');

  return {
    todos: obj.todos.map((item, index) => {
      if (!item || typeof item !== 'object' || typeof item.value !== 'string')
        throw new Error(`第 ${index + 1} 個 Todo 項目必須包含字串 value`);
      return { value: item.value, checked: Boolean(item.checked) };
    }),
  };
}

export async function saveTodoList(input, obj) {
  const path = todoPath(input);
  const validated = validateTodoObject(obj);
  await Bun.write(path, JSON.stringify(validated, null, 1) + '\n');
  return { path };
}

export async function loadTodoList(input) {
  const path = todoPath(input);
  const file = Bun.file(path);
  if (!await file.exists()) throw new Error(`找不到 Todo 檔案：${path}`);
  const obj = validateTodoObject(JSON.parse(await file.text()));
  return { path, obj };
}
```
