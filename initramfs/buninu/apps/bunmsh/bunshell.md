# Bun Shell builtin 旗標支援表

`Bun.$` 的 19 個內建指令各自支援哪些旗標。

- 實測版本：Bun 1.4.0（Linux）
- 原始碼對照：oven-sh/bun `main` @ 8eb5b6e2b5（2026-08-22），`src/runtime/shell/builtin/*.rs`，註冊表在 `src/runtime/shell/Builtin.rs:170-196`

旗標有三種下場：**可用**、**吃掉**（收下、不報錯、什麼都不做）、**報錯**。下表只列前兩種 —— 沒列到的旗標都會報錯，至少炸得出來。

## 一覽

| builtin | 可用 | 吃掉（收下但無作用） |
| --- | --- | --- |
| `ls` | `-a -A -d -l -R` | `-r -1 -b -B -c -C -D -f -F -g -G -h -H -i -I -k -L -m -n -N -o -p -q -Q -s -S -t -T -u -U -v -w -x -X -Z` |
| `mv` | — | `-f -h -i -n -v` |
| `rm` | `-f -r -R -v -d -i -I`<br>`--recursive --verbose --dir`<br>`--interactive=never\|once\|always` | `--preserve-root --no-preserve-root` |
| `mkdir` | `-p -v` `--parents` `--vebose` | — |
| `echo` | `-n -e -E` | — |
| `seq` | `-s/--separator` `-t/--terminator` `-w/--fixed-width` | — |
| `cp` ※ | `-R -v` | `-n` |
| `touch` | — | — |
| `cat` ※ | — | — |
| `cd` | `-` | — |
| `exit` | `[n]` | — |
| `basename` `dirname` `pwd` `export` `which` `yes` `true` `false` | 無旗標 | — |

※ `cat` 和 `cp` 在 Linux/macOS 上**不是** builtin（`Builtin.rs:195` 的 `posix_disabled`），會直接交給系統執行檔，旗標全支援。上表是 Windows、或設了 `BUN_ENABLE_EXPERIMENTAL_SHELL_BUILTINS=1` 時的內建版本 —— 反而少很多旗標。

## 地雷

**`mv -n` / `mv -i` 是空操作，會直接覆蓋。** 這兩個旗標的用途就是防覆蓋，在這裡給的是假的安全感：

```
src.txt = "OLD", dst.txt = "KEEP"
$ mv -n src.txt dst.txt
$ cat dst.txt
OLD                     ← 蓋掉了，沒有任何訊息
```

**`ls` 完全不排序**，是 readdir 的原始順序（不是字母序）。`-r` `-t` `-S` 都被吃掉，所以也沒辦法排。

**`ls -lh` 的 `-h` 被吃掉**，size 欄仍是 bytes。

**`seq -w` 不補零，而且尾端多一個分隔符**：

```
bun:  seq -w 8 11   →  8\n9\n10\n11\n     (GNU: 08 09 10 11)
bun:  seq -s , 1 3  →  "1,2,3,"           (GNU: "1,2,3\n")
```

**`mkdir --verbose` 會報錯，`mkdir --vebose` 才行。** 原始碼註解說這個拼錯是刻意保留相容性用的，但沒有同時接受正確拼法。

**`pwd` 不吃任何參數**，`pwd -P` 直接失敗。

**`basename` 沒有 suffix 參數。** `basename x.txt .txt` 會把兩個都當成路徑，各印一行。

**`touch` 一個旗標都沒有**，只有 `touch file` 可用。

## 實務結論

`Bun.$` 裡只信「可用」那一欄。報錯的至少看得到，**「吃掉」那批才是真正的風險** —— 特別是 `mv -n` / `mv -i` 和 `ls` 的排序。需要那些語意時，改用 `Bun.file` / `node:fs` 自己判斷，或明確呼叫系統執行檔（`/bin/mv`）。
