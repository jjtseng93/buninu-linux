# Buninu

> **If Bun boots, Buninu boots.**

Buninu 是一個以 Bun 為系統基底的自由、可攜、自我建構使用者空間（portable and self-bootstrapping userspace）。它的目標不是只在某一個作業系統上提供幾個 JavaScript 工具，而是讓使用者能把同一套 shell、編輯器、UI、套件、設定與工作流程帶到 Android、Windows、Linux，以及未來以 Alpine Linux 為基礎的原生 Buninu 發行版。

Buninu 的核心觀念是：**底層作業系統可以更換，但屬於使用者的 userspace 不必跟著重建。**

一般跨平台軟體只讓單一應用程式在不同系統上執行；Buninu 希望讓整個個人工作環境跨平台存在。只要目標平台能可靠啟動一個 Bun binary，就能從這個最小火種載入其餘系統。

## 一、願景

傳統使用者空間通常緊密依附作業系統：Linux 使用 GNU、BusyBox 或發行版套件；Windows 與 Android 各自擁有不同的 shell、路徑、終端、套件與應用模型。更換作業系統，往往等於重新學習、重新安裝並重新組裝整套環境。

Buninu 希望在 host OS 上建立一層穩定的個人使用者空間：

```text
Android ─┐
Windows ─┼──> Bun runtime ──> Buninu userspace
Linux   ─┘
```

在這一層中，使用者面對的是一致的：

- shell 與命令語言；
- 編輯器與應用 UI；
- JavaScript、TypeScript、WebAssembly 與 npm 工具；
- 程序、檔案、網路與終端工作流程；
- 設定、資料、快取與應用格式；
- 安裝、更新、驗證、回復及重新建構方式。

Buninu 不是要假裝所有作業系統都具有完全相同的 POSIX 行為，而是定義一個真正可攜的核心，再透過 platform adapters 與 capabilities 使用各平台的額外能力。

## 二、Bun 是整個系統的根基

Bun 在 Buninu 中不是普通相依套件，而是 host OS 之上的第一個可程式化階段，是整個 userspace 的共同執行基底與最大根依賴。

```text
Host kernel / libc / native loader
                 │
                 ▼
             Bun binary
                 │
                 ▼
          Buninu portable userspace
```

Bun 同時提供或承載：

- JavaScript／TypeScript runtime；
- npm 套件生態入口；
- subprocess 與程序編排；
- HTTP、WebSocket 與 Web API；
- 檔案、串流、SQLite、打包與編譯能力；
- shell interpreter 的執行環境；
- 編輯器與 TUI/WUI 應用 runtime；
- OCI image client 與 container workflow；
- APK 及其他平台建構流程的 orchestration；
- single-file executable 與可攜應用發佈。

因此 Buninu 最重要的可用性界線是：Bun binary 必須能在目標平台可靠啟動。其他元件多半具有降級或替代路徑；Bun 一旦不能執行，整個上層 userspace 會同時失去共同 runtime。

長期而言，Buninu 應保存：

- 多個已知可用的 Bun 版本；
- 各平台 binary、BuildID、commit 與 checksum；
- Android／其他非標準 target 的完整 patch；
- NDK、LLVM 及其他可重現建構資訊；
- 離線可用的最低建構工具鏈；
- 啟動、spawn、PTY、network、WebView、npm 與 `process.execPath` smoke tests；
- 可回退到上一版 runtime 的 recovery／rollback 機制。

## 三、整體架構

```text
┌───────────────────────────────────────────────────────────┐
│                         Buninu                             │
│                                                           │
│  bunmsh       jsmdcui       jsgotty       js-udocker      │
│  Shell        Editor/UI     PTY/Web       OCI/Linux       │
│  & scripts    App runtime   terminal      bridge          │
│                                                           │
│  npm / JS / TypeScript / Wasm tools                       │
├───────────────────────────────────────────────────────────┤
│                  Bun Portable Runtime                     │
├───────────────────┬───────────────────┬───────────────────┤
│ Android           │ Windows           │ Linux             │
│ Bionic/APK        │ Win32/ConPTY      │ PTY/libc          │
└───────────────────┴───────────────────┴───────────────────┘
```

系統分為四層：

1. **Host substrate**：kernel、native loader、filesystem、process、network，以及平台提供的 terminal、browser 或 WebView。
2. **Bun runtime layer**：對上層提供共同 JavaScript runtime 與系統 API。
3. **Buninu core userspace**：shell、編輯器、UI runtime、terminal、套件與程序工具。
4. **Optional compatibility layers**：原生 host commands、OCI images、proot、標準 Linux userspace 或其他平台橋接。

## 四、核心工具

### 1. bunmsh：Buninu shell

`bunmsh`（Bun Modern Shell）是以 Bun JavaScript 實作、受 mksh 啟發且不依賴外部 npm package 的跨平台 command shell。

目前已具備：

- interactive prompt、stdin、script file 與 `-c`；
- 自有 lexer、parser、quoting 與 escaping；
- external commands（透過 `Bun.spawn`）；
- `;`、`&&`、`||` 與基本 pipelines；
- 環境變數與 positional parameter expansion；
- stdin/stdout/stderr redirection；
- persistent cwd、environment 與 exit status；
- 一組實用 builtins；
- single-file executable 打包。

它的角色不是永遠模擬所有歷史 POSIX shell 細節，而是逐步形成 Buninu 的 portable command contract。mksh/POSIX compatibility 可以擴充，但跨平台可預測性應優先於在單一 Unix 平台上追求完整相容。

重要發展方向包括 streaming pipelines、command substitution、globbing、IFS、compound commands、functions、descriptor duplication、here-documents、signals、`wait` 與必要的 job control。

### 2. jsmdcui：編輯器與跨環境應用 runtime

`jsmdcui` 是 JavaScript Markdown Cross-environment User Interface。它由 bunmicro／Micro editor 衍生，但已超越單純文字編輯器：Markdown 同時是文件、UI 描述與可執行應用來源。

同一份 Markdown 應用可產生：

- Terminal User Interface（TUI）；
- browser／WebView User Interface（WUI）；
- frontend JavaScript；
- backend JavaScript；
- RPC bridge；
- HTML 與 server modules；
- single-file executable。

現有能力包括 editable controls、selector API、events、lifecycle hooks、JavaScript plugins、syntax highlighting、backup，以及可由另一個 Bun process 透過 Chrome DevTools Protocol inspect、click 與送出鍵盤事件的 TUI automation。

其中 reactive templates 是 jsmdcui 的核心應用模型：應用可以維護 heading-scoped reactive state，使用 Markdown／JavaScript template 更新局部內容，並在 TUI 與 WUI 中以相同資料模型重新渲染。Reactive images 則讓應用透過 state 或 RPC 動態替換圖片來源；WUI 使用 browser image，TUI 可結合 Bun.Image 與 Kitty graphics 顯示及更新圖片。這使同一份 Markdown 能建立資料驅動、可互動且包含動態影像的跨環境應用。

因此 jsmdcui 同時是：

- Buninu 的預設文字編輯器；
- 跨 terminal/browser 的 UI framework；
- 快速建立個人工具的應用語言；
- Buninu 自身管理與 recovery UI 的候選基礎。

### 3. jsgotty：PTY 與 Web terminal

`jsgotty` 將真正的 PTY-backed terminal 暴露為本機 Web service，使 Android WebView 或一般 browser 能成為 Buninu terminal frontend。

它解除 Buninu 對特定 terminal emulator 的硬性依賴。在 Android 上，只要 Activity 能啟動 Bun，Bun 就能啟動 jsgotty，WebView 隨即提供 shell 介面；在桌面平台，也可用相同模型提供本機或受信任網路上的 terminal。

### 4. js-udocker：OCI 與 Linux userspace bridge

`js-udocker` 是以 JavaScript 重寫並擴充的 udocker-like 工具，可在沒有 root 的 Android 裝置上提供類 Docker workflow。

它支援：

- 從 registry 取得 Docker／OCI manifest、metadata 與 layers；
- `pull`、`create`、`import`、`export`、`save`、`load`、`inspect`、`verify`；
- Dockerfile build 與 multi-stage build；
- 基本 Compose workflow；
- 透過 proot 啟動標準 Linux userspace。

rootfs 因而不是必須長期綁定或預先保存的單點。只要仍有 OCI registry，Buninu 可以取得 Ubuntu、Debian、Alpine 或自訂 images；registry 不可用時，仍可從離線的 image archive 或 tar import 重建。

proot 不是 Buninu Core 啟動與日常使用的生存條件。即使 proot 因 Android kernel、ptrace、seccomp 或 SELinux 政策而失效，Buninu 仍保留 Bun、bunmsh、jsmdcui、jsgotty，以及由 Bun/Bionic 支援的龐大 JS、TS、Wasm 與 npm 生態。不過，proot 在 Android 本機自我重建 APK 的情境有另一個關鍵角色：當 Termux 及其原生 Java package 不再可用時，Buninu 必須透過 proot 進入標準 Linux userspace，從 Linux distribution 取得 Java runtime，才能執行 ECJ、R8/D8 與 apksigner。

### 5. minapk：Android 自舉與自我重建工具鏈

Android 形態的 Buninu 以 APK 作為最初容器及可信啟動入口。`minapk` 已建立不依賴 Gradle／AndroidX 的原始 APK build chain：

```text
Java source
  → ECJ
  → R8/D8
  → classes.dex
  → aapt2 compile/link
  → APK packaging
  → zipalign
  → apksigner
  → installable APK
```

這條 build chain **仍然需要 Java runtime**。`ecj-3.45.0.jar`、`d8.jar`／R8 與 `apksigner.jar` 已隨工具鏈保存，但 JAR 本身不能由 Bun 直接執行。在 Termux 正常時可以使用 Termux 提供的 Java；若 Termux 已無法取得或維護 Java，則需要 js-udocker／proot 啟動 Alpine、Debian 或其他真 Linux userspace，從該發行版取得 Java 後再執行 minapk。

因此應區分兩種自舉層級：

```text
Buninu 啟動與使用
  = Android + Bun + Buninu payload

Android 本機重新編譯 APK
  = 上述核心 + Java runtime
  = Termux Java，或在 Termux 不可用時使用 proot + Linux Java
```

完整 payload 可包含：

- Android Bun binary；
- bunmsh；
- jsmdcui；
- jsgotty；
- js-udocker；
- proot 與必要 native helpers；
- `android.jar`、ECJ、D8/R8、aapt2、zipalign、apksigner；
- signing key 與建構設定（正式使用時應妥善保護與備份）；
- 應用來源、assets、manifest 與 recovery payload。

這使 Android Buninu 不只是能執行工具；在 Java runtime 可用時，它還能編輯、重新建構、對齊、簽署並產生自己的 APK。若 Termux 倒下，proot 在這條自我重建鏈上由 optional compatibility layer 升格為必要的 Java 取得與執行橋梁。

## 五、Android 啟動與逃生路徑

Android 是 Buninu 最受限制、也最能驗證自舉能力的平台。

### 主要啟動路徑

APK 安裝時由 Android 將 Bun native library 解壓到 `nativeLibraryDir`，Activity 透過 `ProcessBuilder` 直接執行 Bun。此路徑下 executable path 正確，也最接近普通 native executable。

```text
APK Activity
    → nativeLibraryDir/libbun.so
    → Bun
    → 解開／載入 Buninu payload
    → jsmdcui / jsgotty / bunmsh
```

### 權限收緊時的逃生路徑

若未來 Android 進一步禁止 app data 中解壓後的 native executable，可將 Bun 以未壓縮且正確 page-aligned 的 native library 留在 APK 內，再由 `/system/bin/linker64` 載入執行。

此降級路徑的已知限制是 `process.execPath` 語義可能不再指向 Bun payload，但它保留了最重要的性質：Bun 仍能執行，Buninu 仍能啟動。這是一條預先設計的 future-policy escape hatch，而非目前主路徑的缺陷。

### Payload 展開

最終 APK 可攜帶一個包含所有 Buninu core components 的壓縮 payload，啟動後展開到 app 私有目錄。成熟實作宜具備：

- payload version 與 manifest；
- SHA-256／完整性驗證；
- 解壓到新版本目錄後再原子切換；
- 中斷後仍可使用舊版；
- migration 與 rollback；
- path traversal 與異常解壓大小防護；
- runtime、toolchain 與 component BuildID 記錄。

## 六、兩種 Buninu 形態

### Hosted Buninu

Hosted Buninu 寄居在既有作業系統上：

- Android：APK、Bionic、ProcessBuilder、WebView、linker64；
- Windows：Bun、Win32、ConPTY、browser；
- Linux：Bun、PTY、host commands；

host OS 只提供最低 primitive；使用者實際工作的 shell、工具、UI 與設定屬於 Buninu。

Buninu 不規劃為每個 hosted platform 維護一套厚重且彼此不同的 installer。Android APK 同時是可安裝應用與 Buninu payload archive；其他平台只需要最薄的 bootstrap script，負責從 APK 讀取／展開共同 payload、選擇對應平台的 Bun binary，然後啟動相同的 Buninu userspace。如此核心內容只封裝與版本化一次，各平台差異維持在很薄的啟動層。

### Native Buninu Linux distribution

Buninu 也可以成為真正的 Linux 發行版。最實際的基礎是多架構 Alpine Linux：

```text
Linux kernel / initramfs
        ↓
Alpine + musl + BusyBox + apk + OpenRC
        ↓
Bun runtime
        ↓
Buninu session and tools
```

原生發行版可預裝 Bun、bunmsh、jsmdcui、jsgotty 與 js-udocker，並以 bunmsh 作為日常登入 shell。BusyBox `ash` 應保留為 runtime 故障時的 recovery shell，使真正的發行版仍有底層維修能力。

初期不必 fork 整個 Alpine；可以從以下形式開始：

- Alpine package／repository 與 `buninu-base` metapackage；
- OCI image；
- minirootfs；
- WSL tarball；
- qcow2／raw VM image；
- bootable ISO；
- aarch64 SBC／mobile image。

原生 Buninu 與 Hosted Buninu 不是兩套分叉產品，而是共享同一個上層 userspace，只替換 platform adapter 與啟動方式。

## 七、Buninu Core 與 capability model

Buninu 應明確區分所有平台都保證的 portable core，與平台提供的 optional capabilities。

### Buninu Core

- Bun runtime；
- bunmsh portable command language；
- jsmdcui TUI/WUI app model；
- JS／TS／Wasm tools；
- 基本 filesystem、stream、network、subprocess 與 PTY contract；
- 統一的 config、data、cache、bin 目錄；
- component manifest、更新與 rollback。

Android hosted profile 另外要求 WebView。WebView 是 Android 平台保證提供的系統元件，也是 jsgotty 將 PTY shell 呈現給使用者的必要介面，因此不是 optional capability。

### Optional capabilities

- Unix signals、process groups 與 job control；
- Android APK build 與 linker64 fallback；
- native host commands；
- proot（Buninu Core 日常使用為 optional；Termux 不可用時的 Android 本機 APK 重建為必要）；
- OCI／container support；
- platform-specific UI、clipboard、notification 與 speech APIs。

應用應能宣告所需 capabilities，並在缺少能力時降級或清楚拒絕，而不是暗中假設 host 是 Linux。

## 八、需要形成的共同規約

當各元件逐漸成熟，Buninu 的核心資產將不只是工具本身，而是工具共同遵循的 userspace contract：

- `BUNINU_HOME` 是 Buninu userspace root 的絕對路徑，也是 jsgotty、啟動命令與互動 shell 的初始工作目錄；
- config、data、cache、state、bin 與 temporary files 規則；
- Windows drive／UNC、POSIX path 與 URI 的可攜表示；
- command resolution、`PATH`、副檔名與 shebang 規則；
- stdin/stdout/stderr byte-stream semantics；
- subprocess、取消、signal 與 exit status 模型；
- terminal capability detection；
- Buninu app/package manifest；
- portable core 與 native extension 宣告；
- component version、完整性、更新與 rollback；
- profile、設定與個人資料跨裝置同步；
- platform adapter API。

可能的 component manifest：

```toml
name = "buninu"
runtime = "bun >= 1.4"

[components]
shell = "bunmsh"
ui = "jsmdcui"
terminal = "jsgotty"
oci = "js-udocker"

[capabilities]
oci = "optional"
proot = "optional"
apk-build = "android"
```

## 九、故障與降級模型

Buninu 的韌性來自每一層都盡可能保有替代路徑：

| 故障或消失的元件 | Buninu 的降級方式 |
| --- | --- |
| Termux app／repositories | 由自身 APK 啟動並攜帶核心 payload |
| 固定 rootfs | 從任意 OCI image 重建或離線 `load/import` |
| 單一 registry | 切換 registry/index 或使用保存的 image archive |
| proot | 日常環境回到 Bun＋Bionic／host OS＋JS/TS/Wasm/npm；但 Termux 不可用時將無法在 Android 本機取得 Linux Java 並用 minapk 重建 APK |
| 外部 terminal emulator | jsgotty＋WebView／browser |
| 解壓後 native exec 權限 | APK 內 uncompressed/aligned library＋linker64 |
| 外部 Android build environment | 使用內附 minapk build/sign 工具；仍須由 Termux Java 或 proot Linux userspace 提供 Java runtime |
| 新版 Bun regression | runtime pin、smoke test、rollback 或重建舊版 |

其中最難替代的根節點仍是「至少一個可在 host 上執行的 Bun binary」。因此 Bun runtime 的可重現性、版本保存與 recovery path 是 Buninu 最重要的基礎設施工作。

## 十、實作階段

### Phase 1：完成 Android 自舉閉環

- 將 Bun、bunmsh、jsmdcui、jsgotty、js-udocker 與必要工具整合進 APK payload；
- 在從未安裝 Termux 的乾淨 Android 裝置離線安裝；
- 啟動 Bun 與 jsmdcui；
- 取得 jsgotty terminal；
- 執行 bunmsh 與 npm/JS 工具；
- 修改 app source／payload；
- 驗證 Termux Java 路徑，以及 Termux 不可用時由 js-udocker／proot 取得 Linux Java 的路徑；
- 使用 Java＋minapk 在裝置上重建、簽署並安裝更新後 APK；
- 驗證 rollback 與 linker64 fallback。

### Phase 2：定義 Buninu portable contract

- 標準目錄與 environment variables；
- platform adapter 與 capability API；
- component manifest；
- update、integrity、migration 與 rollback；
- Windows、Linux、Android 行為矩陣。

### Phase 3：強化 portable shell 與應用層

- 讓 bunmsh 足以執行 Buninu 自己的安裝、建構與維護 scripts；
- 將 jsmdcui 發展為 Buninu 設定、套件、更新及 recovery UI；
- 建立可攜 CLI／Wasm 工具集合；
- 統一各平台 terminal 與 process adapters。

### Phase 4：共同 APK payload 與最薄平台 bootstrap

- 以 Android APK 同時承載 app 與版本化的共同 Buninu payload；
- Android 直接安裝並啟動 APK；
- Windows 與 Linux 各自只提供最薄的 bootstrap script；
- script 從 APK 展開共同 payload並選擇對應平台的 Bun binary；
- 不為各平台另外維護內容重複的厚重 installer；
- 同一份 Buninu profile 可跨平台搬移。

### Phase 5：Native Buninu distribution

- Alpine x86_64 與 aarch64 作為第一級 targets；
- `buninu-base` package 與 repository；
- OCI、minirootfs、WSL、VM 與 bootable images；
- 登入預設進入 bunmsh，保留 ash recovery；
- 擴充至 Bun 可可靠支援的其他 Alpine architectures。

## 十一、成功條件

Buninu 的第一個完整成功標準不是「擁有很多工具」，而是在乾淨、受限制的平台完成閉環：

```text
安裝 Android APK，或在其他平台以最薄 script 展開同一 APK payload
        ↓
啟動 Bun
        ↓
進入 bunmsh 或 jsmdcui
        ↓
編輯並執行自己的程式
        ↓
取得 npm／OCI／host resources
        ↓
修改、重建、簽署並更新自己的環境
```

跨平台成功標準則是：同一份個人設定、工具與應用，在 Android、Windows、Linux 與 Native Buninu 之間搬移時，核心使用方式與資料模型保持一致。

## 十二、定位

Buninu 不是：

- 單純預裝 Bun 的 Linux image；
- Termux clone；
- Docker clone；
- 只在 browser 中運作的 Web desktop；
- 假裝各平台完全相同的 POSIX emulator。

Buninu 是：

> **A portable, self-bootstrapping userspace built on Bun.**

它讓 shell、工具、UI、設定與工作流程屬於使用者，而不是被永久綁在某一個作業系統、套件庫、終端程式或發行版上。

Android 是第一個壓力測試，也是最能證明這個概念的平台；Alpine-based Native Buninu 可以讓同一套 userspace 成為真正的 Linux 發行版；Windows 與 Linux 則證明它能隨使用者移動。

最終原則保持簡單：

> **只要還能點燃一個 Bun binary，就能把自己的使用者空間重新長回來。**
