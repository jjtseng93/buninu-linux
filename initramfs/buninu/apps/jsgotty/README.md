# jsgotty / gotty.js

[English README](README.en.md)

## News
### 2026/08/16
- 修正 WebGL 模式下斷線畫面的 `Reconnect` 按鈕無法點擊。
- `Reconnect` 介面現在會正確位於 WebGL canvas 上方並接收滑鼠與觸控事件；右鍵／長按輸入 reconnect token 或 PID 也不會被 Kitty 圖片事件攔截。

### 2026/07/03 - [1.1.0]
- Unicode 11 from upstream
- WebGL support by `--webgl` & query args
- Frontend help by `--help-web`
- Added `font-size` and `font-family`
- Added `touch-scroll-threshold` for fast scrolling
- Added experimental single-exe build commands: `--build-exe` and `--build-for <target>`
- 改善 ZMODEM / `rz/sz` 大檔案傳輸可靠度
  * 傳輸時切換終端機模式，結束或取消後恢復
  * ZMODEM 期間繞過 server-side output parsers
  * ZMODEM 資料改用有順序、ACK、重送處理的 WebSocket chunks
- 改善 `sz` 下載 UI
  * 下載直接串流寫入瀏覽器檔案 writer
  * 顯示目前檔案、已傳輸 bytes / 總 bytes、進度與 verbose transfer logs
- 改善 `rz` 上傳 UI
  * 顯示目前檔案、已傳輸 bytes / 總 bytes、進度與 verbose transfer logs
  * 改善連續執行 `sz` 後馬上 `rz` 的穩定性
- `rz` / `sz` 終端機指令完成時會顯示檔案路徑與 byte size
- ZMODEM debug log 改成透過 `JSGOTTY_ZMODEM_LOG` 才啟用
### 2026/06/22 - [1.0.0]
- Added gotty cli client
  * compatible with golang gotty
  * jsgotty --client -h for more info
- Added /css to list sessions
  * when --reconnect enabled, /css can reconnect to existing sessions
### 2026/04/23
- Added optional noWinOpenUseFetch() at the frontend for Bun markdown TUI:
- https://github.com/jjtseng93/bun-taskmgr
### 2026/04/21
- Added show text in dialog for frontend:
- alert_advanced(getTerminalText())
- for copying text on mobile devices

## Intro 介紹
- 本專案旨在透過瀏覽器、命令列用戶端與現代 Web 協定，讓你的終端機隨處可用。
- 它是用 JavaScript / Bun 重新實作的 GoTTY 相容伺服器
- 參考了原本 GoTTY 的程式碼，大部分以 Codex 生成
- 包含已針對 `jsgotty` 調整過的前端與 WebTTY 協定實作
- 原版 repo:
- https://github.com/sorenisanerd/gotty
- .
- 關鍵字: 終端機 瀏覽器 命令列用戶端 工作階段管理 Kitty圖形協議 ZMODEM

### Features 特色功能
- Resumable reconnect: 瀏覽器斷線後可以用 reconnect token 接回原本的 shell / PTY，而不是重開一個新的 shell。
  * jsgotty 伺服器端支援兩種連線模式
  * 正常模式、工作階段(session)模式
  * 當命令列參數包含 `--reconnect` 或 `--session` 時會啟用工作階段模式
  * 見下方詳細說明兩種模式
- Kitty Graphics Protocol: 可以顯示終端內嵌圖片
  * 像是用 `bun viu.mjs 1.png` 直接在終端中顯示圖片。
  * 設定 `JSGOTTY_KITTY_DEBUG=1` 才會寫入 Kitty 圖片除錯 log。
  * Windows 不是使用 Kitty 協定，而是自訂協議
- ZMODEM / `rz/sz` 上傳/下載功能
  * 可以從瀏覽器端選檔並上傳到遠端 shell
  * 也可以從遠端 shell 下載檔案
  * Windows 不是使用 ZMODEM，而是自訂協議
  * 目前 Linux 系統實測能上傳/下載約 80MB 的 bun binary

## Usage 用法

### Install Bun 安裝 Bun
- Android/Termux:
  * pkg install npm
  * npm install -g bun
- Other platforms:
  * https://bun.com

### Linux

```sh
bun gotty.js -w bash
bun gotty.js -w --credential user:pass bash
bun gotty.js -w -p 8000 fish

# ↓將會開啟工作階段(session)模式
bun gotty.js -w --reconnect fish
bun gotty.js -w --reconnect --reconnect-time 30 fish
bun gotty.js -w --reconnect --reconnect-time -1 fish

# 或 npx jsgotty@latest

# 顯示伺服器/瀏覽器端的幫助
bun gotty.js
bun gotty.js --help
bun gotty.js --help-web
# ↑瀏覽器端可導覽到/help查看
```

### Windows

```sh
bun gotty.js -w cmd.exe
bun gotty.js -w powershell

# ↓將會開啟工作階段(session)模式
bun gotty.js --reconnect powershell

# 或 npx jsgotty@latest

# 顯示伺服器/瀏覽器端的幫助
bun gotty.js
bun gotty.js --help
bun gotty.js --help-web
# ↑瀏覽器端可導覽到/help查看
```

### 內建工具

```sh
bun gotty.js --rz
bun gotty.js --sz
bun gotty.js --viu
bun gotty.js --client
```

- `--rz` starts `rz.js`: 上傳檔案
- `--sz` starts `sz.js`: 下載指定檔案
- `--viu` starts `viu.mjs`: 顯示圖片
- `--client` starts `client.mjs`: 命令列客戶端

### 命令列客戶端 CLI Client

- `client.mjs` 是可直接連接 GoTTY 的互動式終端 client
- 基本連線相容 Golang GoTTY
- session 列表、writer 管理與遠端終止 PTY 則需要本專案的 jsgotty server
- 正常模式與工作階段(session)模式的差異，請見下方詳細說明兩種模式。

#### 基本操作：連接伺服器

```sh
# 連接預設 ws://127.0.0.1:8080/ws
bun gotty.js --client

# 連接 127.0.0.1:8081
bun gotty.js --client 8081

# 可使用 HTTP(S) 頁面網址或 WS(S) 網址
bun gotty.js --client https://example.com/terminal/

# 使用帳號密碼
bun gotty.js --client -c user:pass 8081
```

#### 進階操作：工作階段管理

```sh
# 列出目前 sessions
bun gotty.js --client -ls [target]

# 使用 reconnect token 或 PID 接回既有 session
# 需開啟 session 模式
bun gotty.js --client -r <token|pid> [target]

# 中斷目前 writer，但保留 PTY session
# 需開啟 session 模式
bun gotty.js --client -d <token|pid> [target]

# 終止對應的 PTY session
bun gotty.js --client -k <token|pid> [target]
```

第一個參數也可使用 subcommand alias:

- `ls`、`list`、`list-sessions` => `-ls`
- `attach`、`a <token|pid>` => `-r <token|pid>`
- `detach <token|pid>` => `-d <token|pid>`
- `kill-session`、`stop <token|pid>` => `-k <token|pid>`

- `-ls` 讀取 server 的 `/css.md` session 列表。
- 使用瀏覽器查看 session 列表時請導覽到 `/css`。
- 如果 `/css` 顯示的是靜態檔案列表而不是 sessions，代表連線的是 Golang GoTTY，不是 jsgotty。
- `-r` 需開啟 session 模式；可接回指定的 PTY session。
- `-d` 需開啟 session 模式；中斷指定 session 的 writer 後，session 仍保留，下一個可寫 client 可接手。
- `-k` 會直接終止對應 PTY/session。

- `--arg <value>` 可重複指定 command arguments；`--arguments <query>` 可傳入原始 query string。
- `--cols`、`--rows` 可指定初始終端大小。
- 可用 `GOTTY_CREDENTIAL` 與 `GOTTY_RECONNECT_TOKEN` 環境變數設定 credential 和 reconnect token。
- PTY 建立方式、writer/viewer 權限與 reconnect 保留時間請參考下方「正常模式 / 工作階段(session)模式」。
- Golang GoTTY 不支援 `-ls`、`-r`、`-d`、`-k` 這些 jsgotty 控制協議。

### Wrapper
- wgotty is a wrapper for Linux
- or Windows with busybox64u.exe bash
- https://frippery.org/busybox/
- just run ./wgotty and it will 
- detect installation status of Bun
- and show installation script if needed

## 正常模式 / 工作階段(session)模式

`jsgotty` 伺服器有兩種連線模式：

- 正常模式: 未指定 `--reconnect` 或 `--session`
- 工作階段(session)模式: 指定 `--reconnect` 或 `--session`

### 正常模式

- 每一個新的瀏覽器或 `client.mjs` 連線，都會建立一個新的 `PtySession` 與新的 PTY。
- 兩個 client 同時連線時，通常就是兩個不同的 shell / PTY，彼此不共享畫面、輸入或行程狀態。
- client 斷線後，對應的 PTY session 會被關閉。
- 如果瀏覽器被關閉、tab 被關閉、或 websocket 正常斷線，server 會清理該連線對應的 PTY。
- 正常模式不支援接回既有 PTY；瀏覽器或 CLI 傳入 reconnect token / PID 時，不會 resume 原 session，而是開新的 PTY。
- `/css` 與 `/css.md` 仍會列出目前 active sessions 的 PID 與 command name，但不提供 reconnect token 或接回連結。
- `client.mjs -ls` 可列出 sessions；`-k <pid>` 可用 PID 終止 session；`-r` 與 `-d` 需要工作階段模式。

### 工作階段(session)模式

- 使用 `--reconnect` 或 `--session` 啟用。
- 第一次連線如果沒有指定可 resume 的 token / PID，server 會建立新的 `PtySession` 與新的 PTY。
- server 會替每個 session 產生 reconnect token，並把 session PID 與 token 傳給前端。
- 之後瀏覽器或 CLI 可以用 reconnect token 或 PID 接回同一個 PTY，而不是建立新的 shell。
- 在同一個 PTY session 裡可以有多個 client 同時連線。
- 第一個可寫入的 client 會成為 writer，可以送鍵盤輸入、resize、ZMODEM 控制等資料到 PTY。
- 其他 client 會是 viewer，只接收畫面輸出，不會寫入 PTY。
- client 也可以用 `--readonly` 主動以 viewer 身分連線。
- 如果 writer 斷線但 session 還有其他 viewer，既有 viewer 不會自動升級為 writer；下一個可寫入且接回同一 session 的 client 可以成為新的 writer。
- 最後一個 client 斷線後，PTY 是否保留由 `--reconnect-time` 決定。

#### `--reconnect-time` 的行為：
- `> 0`: 最後一個 client 斷線後保留指定秒數，期間可接回，逾時後關閉 PTY。
- `= 0`: 最後一個 client 斷線後立刻關閉 PTY。
- `< 0`: 最後一個 client 斷線後無限期保留 PTY，直到 shell 自己結束、手動 `-k` 終止、或 server 停止。

#### 前端的 reconnect 行為：
- `reconnect-time > 0` 時，會在期限內自動重試多次。
- `reconnect-time < 0` 時，會每 1 分鐘自動重試一次。
- 斷線時會提供 `Reconnect` 按鈕，可手動立即重試。
- 該按鈕右鍵/長按可輸入自訂 reconnect token 或 PID。

## Tested platforms 已測試作業系統
- Windows x64: Windows 11
- Linux x64: CachyOS
- Android arm64: Termux Native/Proot
- Android arm64: My App
  * https://drive.google.com/drive/folders/18iwbKrAZfA-HoTSP9I5MzGz5xVFMZ4bg


## Current implementation 目前實做
- 使用node原生 `http`/`https`
- 使用 `ws` 處理 WebSocket upgrade
- 使用 `./static` 內自帶前端頁面、kitty overlay 與 WebTTY/ZMODEM 前端邏輯
- 支援輸出圖片到終端
- 支援檔案上傳/下載

### PTY Backends PTY後端策略
- Linux / macOS: 使用 Bun 內建 PTY `Bun.spawn(..., { terminal: ... })`
- Windows: 使用patched `node-pty`，但整體以 `bun` 啟動 `gotty.js`
  * Bun版本若>=1.3.14會全面使用 Bun 內建 PTY

### Kitty intro
- 只要終端程式使用 Kitty Graphics Protocol (Linux) 輸出圖片，前端就會把圖片顯示在終端對應位置。
- Windows採用自訂協議。
- 用法：

```sh
bun viu.mjs 1.png
# or bun gotty.js --viu 1.png
```

### rz upload intro
- 當遠端 shell 執行：

```sh
bun rz.js
# or bun gotty.js --rz
```

- 前端會跳出檔案選擇視窗。選擇檔案後，會以 ZMODEM 上傳到目前 shell 所在目錄。

### sz download intro
- 當遠端 shell 執行：

```sh
bun sz.js file.txt
# or bun gotty.js --sz file.txt
```

- 前端會接收 ZMODEM 下載資料，並讓瀏覽器下載檔案。


## Others 備註
- 目標是模擬原版 GoTTY 的主要行為，並增加特色功能
- 以 Bun 為主要執行方式。
- Linux / macOS 如果不是用 Bun 執行，PTY 會無法使用。
- 目前未實作 Go 版的 config 檔載入
