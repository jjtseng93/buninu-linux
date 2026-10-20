# 鍵盤診斷（手動）

此工具不由正式前端載入，也不需要修改 `static/js/gotty.js` 或安裝依賴。

1. 在與 Android WebView 共用本機網路的環境啟動收集器：

   ```sh
   node tests/manual/keyboard-collector.cjs
   # 可指定 port 與輸出檔；預設 18766、系統暫存目錄的 jsgotty-keyboard-debug.jsonl
   ```

2. 連上 jsgotty 後，透過該頁面的 DevTools Console 或 CDP `Runtime.evaluate` 執行收集器印出的 JavaScript。每次啟動會產生新 token。若要從另一台裝置連線，需要另行調整收集器位址與監聽設定。
3. 按下要測試的組合鍵，讀取收集器顯示的 JSONL 路徑。每頁最多 2000 筆、10 分鐘；重跑載入指令即可開始新一輪。檔案採追加寫入，以 `session` 分組並依 `sequence` 排序，避免 HTTP 到達順序不同造成誤判。
4. 停止頁面診斷：`window.stopGottyKeyboardDebug()`；或重新載入頁面。收集器按 Ctrl-C 停止。

記錄內容包含原始 keydown/keypress/keyup、beforeinput/input、composition 事件、既有按鍵處理器回傳值、事件處理完成後的取消狀態，以及 xterm `onData` 的 UTF-8 位元組（前 64 bytes）。onData 是前端產生的終端資料，並非伺服器 PTY 接收確認。診斷期間只輸入測試內容，避免留下密碼或其他敏感輸入。

紀錄也保留於 `window.__gottyKeyboardRecords`；傳輸失敗原因在 `window.__gottyKeyboardDeliveryError`。若無需 HTTP 收集器，可直接在 Console/CDP 執行 `keyboard-debug.js` 的內容，再呼叫 `window.startGottyKeyboardDebug()`。

工具透過 `element.__gottyXterm` 尋找終端，暫時包裝 xterm 的 `_core._customKeyEventHandler`，停止時還原。因此升級 xterm 後需要再確認這個內部欄位；正式產品不依賴此診斷工具。舊的 `#keyboard-debug` 網址片段不再啟用任何診斷。
