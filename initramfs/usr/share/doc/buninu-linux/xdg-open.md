# xdg-open — open in a new browser terminal / 開啟瀏覽器

```sh
xdg-open https://buninu.org
xdg-open about:audio
xdg-open ./page.html
xdg-open "./file with spaces.md"
xdg-open file:///buninu/page.html
```

Runs `bunterm -e buninu-browser URL` on a new virtual console. HTTP, HTTPS,
and `about:` URLs go to the browser. Local files must exist: symbolic links
are resolved and the real path is encoded as a `file://` URL, including spaces,
Chinese characters, `#`, and `%`. Markdown also opens in the browser.

透過 bunterm 在新 tty 啟動瀏覽器。本地檔案先確認存在、解析實際路徑，再轉成
`file://` 網址；Markdown 同樣使用瀏覽器。檔名若以 `-` 開頭，請加上 `./`。

Directories and other schemes (including `data:`, `mailto:` and `ftp:`) are
not supported. This is Buninu's lightweight implementation, not xdg-utils;
it does not consult MIME associations or desktop application registrations.
目前不支援目錄與其他協定，也不查詢 MIME 預設程式關聯。

## Options / 選項

| Option | Meaning |
| --- | --- |
| `-h`, `--help`, `--manual` | Show this Markdown manual / 顯示本手冊 |
| `--version` | Show the Buninu Linux version from the image's os-release / 顯示映像檔的發行版版本 |

## Exit codes / 退出碼

| Code | Meaning |
| --- | --- |
| 0 | New terminal launch succeeded / 新終端啟動成功 |
| 1 | Invalid arguments or URL / 參數或網址格式錯誤 |
| 2 | Local file does not exist / 本地檔案不存在 |
| 3 | Required tool not found / 缺少必要工具 |
| 4 | Opening failed or target unsupported / 開啟失敗或目標不支援 |

bunterm detaches when opening a new VT. Exit code 0 confirms the launcher
succeeded, not that the browser subsequently loaded the page.
新 tty 以背景工作階段啟動，因此成功退出不代表後續網頁一定載入成功。
