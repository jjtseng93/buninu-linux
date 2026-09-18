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

Enter Todo text above, then choose Add or Remove. Remove deletes the first item whose text matches exactly.

- [Add Todo](javascript:addTodo())
- .
- [Remove Todo](javascript:removeTodo())
- .
- [Show Completed](javascript:showCompleted())
- .
- [Show Pending](javascript:showPending())

## Save / Load

```text#todo-file
todo_list.json
```

Enter a JSON file path above. Saving writes human-readable JSON; loading replaces the current Todo list after confirmation.

- [Save Todos](javascript:saveTodos())
- .
- [Load Todos](javascript:loadTodos())

## Operation Result

```text#todo-status
No action yet
```

## Filtered Result

```text#todo-result
Select “Show Completed” or “Show Pending” to view matching items
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
    : '(No items)';
  const noun = items.length === 1 ? 'item' : 'items';
  $('#todo-result').val(`${title}\n${output}`);
  $('#todo-status').val(`Found ${items.length} ${title.toLowerCase()} ${noun}`);
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
    $('#todo-status').val('Add failed: enter Todo text first');
    return;
  }

  const length = $('#todos').push(value);
  $('#todo-input').val('');
  $('#todo-status').val(`Added “${value}”; ${length} Todos total`);
}

export function removeTodo() {
  const value = todoText();
  if (!value) {
    $('#todo-status').val('Remove failed: enter the Todo text to remove');
    return;
  }

  const items = $('#todos').slice();
  const index = items.findIndex(item => item.value === value);
  if (index < 0) {
    $('#todo-status').val(`Remove failed: could not find “${value}”`);
    return;
  }

  const removed = $('#todos').splice(index, 1);
  $('#todo-input').val('');
  $('#todo-status').val(`Removed “${removed[0]}”`);
}

export function showCompleted() {
  showItems('Completed', true);
}

export function showPending() {
  showItems('Pending', false);
}

export async function saveTodos() {
  const file = todoFile();
  if (!file) {
    $('#todo-status').val('Save failed: enter a JSON file path first');
    return;
  }

  try {
    const obj = { todos: $('#todos').slice() };
    const result = await rpc.saveTodoList(file, obj);
    $('#todo-status').val(`Saved ${obj.todos.length} Todos to ${result.path}`);
  } catch (error) {
    $('#todo-status').val(`Save failed: ${describeError(error)}`);
  }
}

export async function loadTodos() {
  const file = todoFile();
  if (!file) {
    $('#todo-status').val('Load failed: enter a JSON file path first');
    return;
  }
  try {
    const result = await rpc.loadTodoList(file);
    const json = JSON.stringify(result.obj, null, 1);
    if (!confirm(`Replace the current Todo list with this JSON from “${file}”?\n\n${json}`)) {
      $('#todo-status').val('Load cancelled; current Todos were not changed');
      return;
    }
    const current = $('#todos').slice();
    $('#todos').splice(0, current.length, ...result.obj.todos);
    $('#todo-status').val(`Loaded ${result.obj.todos.length} Todos from ${result.path}`);
  } catch (error) {
    $('#todo-status').val(`Load failed: ${describeError(error)}`);
  }
}
```

```js back
import { resolve } from 'node:path';

function todoPath(input) {
  const value = String(input ?? '').trim();
  if (!value) throw new Error('Enter a JSON file path first');
  return resolve(value);
}

function validateTodoObject(obj) {
  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.todos))
    throw new Error('Todo JSON must be an object containing a todos array');

  return {
    todos: obj.todos.map((item, index) => {
      if (!item || typeof item !== 'object' || typeof item.value !== 'string')
        throw new Error(`Todo item ${index + 1} must contain a string value`);
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
  if (!await file.exists()) throw new Error(`Todo file not found: ${path}`);
  const obj = validateTodoObject(JSON.parse(await file.text()));
  return { path, obj };
}
```
