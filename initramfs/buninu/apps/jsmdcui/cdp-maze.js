#!/usr/bin/env bun

// Generated from llm-maze.txt instructions.
// Start the maze TUI first:
//   bun src/index.js --remote-debugging-port=9222 demos/maze.md
// Then run:
//   bun cdp-maze.js

const DEFAULT_CDP_URL = "ws://127.0.0.1:9222/devtools/browser/cdp-server";

const dirs = [
  [1, 0, "ArrowDown"],
  [-1, 0, "ArrowUp"],
  [0, 1, "ArrowRight"],
  [0, -1, "ArrowLeft"],
];

function parseMaze(text) {
  return text.trimEnd().split("\n").map(line => {
    const cells = [];

    for (let i = 0; i < line.length;) {
      const ch = String.fromCodePoint(line.codePointAt(i));

      if (ch === "🧱" || ch === "😀") {
        cells.push(ch);
        i += ch.length;
      } else if (line[i] === " ") {
        cells.push(" ");
        i += 2;
      } else {
        cells.push(ch);
        i += ch.length;
      }
    }

    return cells;
  });
}

function solveMaze(grid) {
  let start;

  for (let row = 0; row < grid.length; row++) {
    for (let col = 0; col < grid[row].length; col++) {
      if (grid[row][col] === "😀") start = [row, col];
    }
  }

  if (!start) throw new Error("Maze start not found");

  const queue = [{ row: start[0], col: start[1], path: [] }];
  const seen = new Set([start.join(",")]);

  while (queue.length) {
    const { row, col, path } = queue.shift();

    for (const [dr, dc, key] of dirs) {
      const nextRow = row + dr;
      const nextCol = col + dc;

      if (
        nextRow < 0 ||
        nextRow >= grid.length ||
        nextCol < 0 ||
        nextCol >= grid[row].length
      ) {
        if (path.length > 0) return path.concat(key);
        continue;
      }

      if (nextCol >= grid[nextRow].length) continue;
      if (grid[nextRow][nextCol] === "🧱") continue;

      const id = `${nextRow},${nextCol}`;
      if (seen.has(id)) continue;

      seen.add(id);
      queue.push({
        row: nextRow,
        col: nextCol,
        path: path.concat(key),
      });
    }
  }

  throw new Error("No path found");
}

export async function runCdpMaze(cdpUrl = DEFAULT_CDP_URL) {
  const view = new Bun.WebView({
    backend: {
      type: "chrome",
      url: cdpUrl,
    },
  });

  try {
    const control = await view.evaluate(`
    (() => {
      const lines = micro.getAllText().split("\\n");
      const y = lines.findIndex(line =>
        line.includes("Put the cursor here")
      );

      return {
        x: lines[y].indexOf("Put the cursor here") + 1,
        y: y + 1,
      };
    })()
  `);

    await view.click(control.x, control.y);
    await view.press("r", { modifiers: ["Control"] });
    await Bun.sleep(100);

    const mazeText = await view.evaluate(`$("#character").val()`);
    const path = solveMaze(parseMaze(mazeText));

    for (const key of path) {
      await view.press(key);
      await Bun.sleep(100);

      const status = await view.evaluate(`$("#last-key").val()`);
      if (status.includes("Escaped the maze")) break;
      if (status.includes("Wall")) {
        throw new Error(`Hit a wall after ${key}: ${status}`);
      }
    }

    const result = await view.evaluate(`$("#last-key").val()`);
    if (!process.stdin.isRaw) console.log(result);
    return result;
  } finally {
    view.close();
  }
}

if (import.meta.main) {
  await runCdpMaze(Bun.argv[2] ?? DEFAULT_CDP_URL);
}
