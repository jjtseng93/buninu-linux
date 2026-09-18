```text#character
🧱😀🧱🧱🧱🧱🧱🧱🧱🧱🧱🧱
🧱  🧱                🧱
🧱  🧱🧱🧱  🧱  🧱🧱🧱🧱
🧱      🧱  🧱        🧱
🧱🧱🧱  🧱🧱🧱🧱🧱  🧱🧱
🧱  🧱      🧱        🧱
🧱  🧱🧱🧱  🧱  🧱  🧱🧱
🧱      🧱      🧱    🧱
🧱  🧱🧱🧱🧱🧱🧱🧱  🧱🧱
🧱          🧱        🧱
🧱  🧱  🧱🧱🧱  🧱🧱🧱🧱
🧱  🧱                🧱
🧱🧱🧱🧱🧱🧱🧱🧱🧱  🧱🧱
```

```text#controls @keydown.prevent="handle(event)"
Put the cursor here, then press:
將遊標放在這裡，然後按：

L't half of QWERTY  ← move left
R't half of QWERTY  → move right
T / Y               ↑ move up
Space               ↓ move down

鍵盤左半邊 ← 向左移動
鍵盤右半邊 → 向右移動
T / Y 向上移動
空白鍵向下移動

Arrow keys   ←↑→↓ / 正常方向移動
Ctrl-R       Reset maze / 重新開始

Do not hit 🧱 / 不能撞牆
```

```text#last-key
Waiting for input / 等待輸入
```

[🔄 Reset maze / 重新開始](javascript:reset())

```js front
const LEFT_KEYS = new Set([
  ...'`12345qwerasdfgzxcvb',
  'escape', 'tab',
]);
const RIGHT_KEYS = new Set([
  ...'67890-=uiop[]\\hjkl;\'nm,./',
  'backspace', 'enter', 'delete',
  'home', 'end', 'pageup', 'pagedown',
]);
const MAZE = [
  '# ##########',
  '# #        #',
  '# ### # ####',
  '#   # #    #',
  '### ##### ##',
  '# #   #    #',
  '# ### # # ##',
  '#   #   #  #',
  '# ####### ##',
  '#     #    #',
  '# # ### ####',
  '# #        #',
  '######### ##',
];
const GOAL = { row: MAZE.length - 1, col: 9 };
const player = { row: 0, col: 1 };
let completed = false;

function drawMaze() {
  const screen = MAZE.map((line, row) => [...line].map((cell, col) => {
    if (row === player.row && col === player.col) return '😀';
    return cell === '#' ? '🧱' : '  ';
  }).join('')).join('\n');
  $('#character').val(screen);
}

export function reset() {
  player.row = 0;
  player.col = 1;
  completed = false;
  drawMaze();
  $('#last-key').val('Waiting for input / 等待輸入');
}

export function handle(event) {
  const key = String(event.key ?? '').toLowerCase();
  if (event.ctrlKey && key === 'r') {
    reset();
    return;
  }
  if (completed) return;

  let row = player.row;
  let col = player.col;
  let direction;

  if (key === 't' || key === 'y' || key === 'arrowup') {
    row--;
    direction = 'up / 上';
  } else if (key === ' ' || key === 'arrowdown') {
    row++;
    direction = 'down / 下';
  } else if (key === 'arrowleft' || LEFT_KEYS.has(key)) {
    col--;
    direction = 'left / 左';
  } else if (key === 'arrowright' || RIGHT_KEYS.has(key)) {
    col++;
    direction = 'right / 右';
  } else {
    $('#last-key').val(`Ignored / 忽略：${event.key}`);
    return;
  }

  if (MAZE[row]?.[col] !== ' ') {
    $('#last-key').val(`${event.key === ' ' ? 'Space' : event.key} → 🧱 Wall / 撞牆`);
    return;
  }

  player.row = row;
  player.col = col;
  drawMaze();

  if (row === GOAL.row && col === GOAL.col) {
    completed = true;
    $('#last-key').val('🎉🏆🌟 Escaped the maze! / 成功走出迷宮！🌟🏆🎉');
    $('#character').val([
      '',
      '🎆🎇🎉 恭 喜 過 關 ！ 🎉🎇🎆',
      '',
      '🥳 你成功逃出迷宮了！ 🥳',
      '👑 🏆 ⭐ 🌟 💫 🌈 🦄',
      '👏👏👏  AMAZING!  👏👏👏',
      '🎈 🎊 🎁 🪩 🎁 🎊 🎈',
      '',
      '🚀 ESCAPED THE MAZE! 🚀',
      '',
      'Press Ctrl-R to reset',
      '按 Ctrl-R 重新開始',
      ''
    ].join('\n'));
  } else {
    const label = event.key === ' ' ? 'Space' : event.key;
    $('#last-key').val(`${label} → ${direction} (${row}, ${col})`);
  }
}
```
