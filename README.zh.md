# Buninu Linux
- Buninu Linux 是以 Bun 作為 PID 1、搭配 Buninu 使用者空間的 Linux 發行版。
- 整個使用者空間都以 Bun 為基礎
- 透過未簽章的 UEFI UKI（統一核心映像）開機，即 vda.img 中單一的 `.EFI` 檔案，內含以下元件
  * Alpine 預先編譯的核心
  * Alpine 預先編譯的 systemd EFI stub
  * initramfs JavaScript 元件：
  * `/init.js`、Buninu 使用者空間及其他模組
  * initramfs 原生元件：
  * 官方 `bun-linux-x64-musl`（或 `bun-linux-aarch64-musl`）及其依賴
    + ld-musl-x86_64.so.1 (ld-musl-aarch64.so.1)
    + libc.musl-x86_64.so.1 (libc.musl-aarch64.so.1; 刻意保留的副本)
    + libgcc_s.so.1
    + libstdc++.so.6
- 可在真實 x86-64 UEFI 硬體開機；QEMU 系統測試同時支援 x86_64
  與 aarch64 客體。
- 核心將 `bun` 作為 PID 1 執行
  * init 通常負責的一切工作——掛載檔案系統、載入模組、設定網路、回收子行程
  * 都透過 JavaScript 的 `bun:ffi` 完成
  * 不使用 BusyBox，也沒有 C 啟動程式。

- 首頁：<https://buninu.org>
- 原始碼：[github.com/jjtseng93/buninu-linux](https://github.com/jjtseng93/buninu-linux)
- Buninu 使用者空間原始碼：[github.com/jjtseng93/buninu](https://github.com/jjtseng93/buninu)
  + **BUNinu Is Not Unix** 🐮
  + **幫你牛** 🐂 ・ **Bunに入魂** 🔥
- <img src="https://raw.githubusercontent.com/jjtseng93/buninu/main/icon.png" width="256">

---

- [English](README.md)
- [目錄](#目錄)
- 終端機文件：`bun x buninu-linux --readme`（英文），
  `bun x buninu-linux --readme-zh` 或 `--docs`（繁體中文）。
- .
- 仍處於早期階段
- [影片在此](https://www.reddit.com/r/bun/comments/1wkpraj/buninu_linux_a_distro_with_bun_as_pid_1)：已透過 `--real` 在真實 x86-64 UEFI 硬體成功開機：
  * Bun 進入互動式 REPL
  * `start` 啟動 Buninu 使用者空間 shell
  * `cfg.disk` 搭配 shell 的 `mount` 掛載本機磁碟
  * `cfg.net` 載入常見有線網卡與 Android USB 網路共享驅動，並自動嘗試 DHCP 設定
  * `cfg.sound` 載入所有已打包的 ALSA 音效模組
  * 已成功測試透過 RNDIS 使用 Android 手機 USB 網路共享，讓 Buninu Linux 經由手機連上網際網路
  * DHCP 租約到期或需要重新取得網路設定時，執行 `dhclient usb0`（換成實際介面名稱）。仍可使用 `ip` 手動設定。
  * 內附的 `jmi` 編輯器、jsmdcui App 執行環境及本機 JavaScript 執行也可運作。
  * 透過核心 VT 或 jsmdcui 進行多工
    + 請見[多工模式](#多工模式)
  * 圖形終端機 `bunterm` 在 framebuffer 上繪製中日韓文字、彩色 emoji 與 Kitty 圖片；請見[顯示圖片](#顯示圖片)
    + 也支援滑鼠點擊、滾輪及游標繪製
    + 簡易瀏覽器可運作：原生 buninu-browser，或 chroot Debian 中的 casty
    + 可播放有聲音的 YouTube（實驗性）；請見[播放有聲音的影片](#實驗性有聲影片播放)
    + 內建瀏覽器請見 [Buninu Browser](#內建瀏覽器的早期實驗支援)，可選的 chroot 設定請見 [Debian 與 Chromium 搭配 casty](#在隔離根目錄使用瀏覽器前端)
  * [從 Bun 建立 C 編譯器](initramfs/usr/lib/bootstrap/README.md)：
    + 編號腳本產生 musl 標頭檔與 CRT，
    + 建置 TinyCC 並下載後續建置至 GCC 4.7 所需的原始碼，從 `bun /usr/lib/bootstrap/1.prepare-rootfs.js` 開始。

---

- [第一節](#第一節問候範例)的 hello-world EFI 應用程式是 UKI 所取代的起點
- 它仍可建置，也是確認磁碟映像與韌體路徑是否能運作的最快方式。

## 快速開始

> [!IMPORTANT]
> 本節建置用於真實 x86-64 UEFI 硬體的映像檔。若要改用
> `qemu-system` 建置及測試 x86_64 或 aarch64 客體，請見
> [在桌面系統建置及測試虛擬機](#在桌面系統建置及測試虛擬機)。

你可以在 Android 手機建置映像檔，但以下 `--real` 映像是用來
啟動 x86-64 UEFI 電腦，並不是把 Buninu Linux 安裝到手機上。

- 本教學會建置可開機的 `buninu-linux-<version>.img`
- 下載與建置預設使用 JS 工具，需要主機的 Bun，不需要原生
  建置工具鏈或 Docker；不必只為了建置而進入 PRoot。

### 步驟

- 先安裝 bun：
  * Android：在 Termux 執行以下命令：

    ```sh
    pkg update && pkg upgrade
    pkg i npm
    npm i -g bun
    ```

  * 其他平台：依照官方教學：<https://bun.com>
- 安裝 Bun 並確認在 `PATH` 內後，選擇下列任一建置方法。
  * 可用 `bun --version` 檢查
- 不要設定 `BUNINU_JS_TOOLS`（或設為 `1`）；`0`、`off`
  或 `false` 會改用[舊版 shell 建置](#舊版建置工具)。

#### 直接透過套件建置

進入要存放完成映像檔的目錄，直接執行已發布的套件。不需要用
`apt install`／`apk add` 安裝建置工具：

```sh
mkdir -p buninu-build
cd buninu-build
bun x buninu-linux --version
bun x buninu-linux -fb --real --export
```

`--export` 會把完成的 `vda.img` 從 bunx
套件目錄複製到執行命令時所在的目錄，命名為
`buninu-linux-<version>.img`。寫入 USB 隨身碟
時，請使用命令輸出的完整匯出檔名。

#### 或從原始碼建置

準備好 Git 與 Bun 後：

```sh
git clone https://github.com/jjtseng93/buninu-linux.git buninu-linux
cd buninu-linux
bun ./index.js -fb --real --export
```

這會下載已鎖定的 Alpine／Bun／npm 輸入、選取真機模組、建置 `vda.img`，
並匯出 `buninu-linux-<version>.img`。

若要較小的映像檔，可在任一建置命令加入 `--no-gpu`：

```sh
bun x buninu-linux -fb --real --no-gpu --export
# 從原始碼目錄建置：
bun ./index.js -fb --real --no-gpu --export
```

x86-64 `--real` 參考建置使用 `--no-gpu`
時產生 **128 MiB** 映像，預設包含 GPU 模組與韌體
則為 **320 MiB**。此選項省略可選的 GPU 套件內容，
保留 framebuffer／bunterm 軟體顯示路徑。映像大小依
打包內容計算，後續版本可能改變。

#### 寫入映像檔到隨身碟

建議使用 **Ventoy**：先透過 Windows 或
Linux 電腦在隨身碟安裝一次，再從 Android、
Linux、macOS 或 Windows 複製映像檔進去。後續
建置只需將新的 `.img` 複製到同一隨身碟，不必每次重新燒錄
或格式化。可保留多個映像，從 Ventoy 開機選單選擇。

在 Android 上，先讓檔案管理員能存取匯出的映像。執行
`termux-setup-storage` 並接受儲存權限提示，
或在 Android 應用程式設定中允許 Termux
管理所有檔案（若有此選項）。從匯出映像所在目錄將檔案複製到
Download：

```sh
termux-setup-storage
cp buninu-linux-*.img /sdcard/Download/
```

請使用完整匯出的 `.img`（未使用 `--export` 時
則為 `vda.img`），而不是其中的 FAT 分割區。請將下方範例
檔名換成建置輸出的實際名稱。

**Android／Termux：複製到已準備好的 Ventoy 隨身碟。**
一般未 root 的 Android／Termux 無法透過 `dd` 直接
存取 USB 區塊裝置，PRoot 也不會賦予此權限。一個方法是先
[透過 Windows 或 Linux 電腦在隨身碟安裝 Ventoy](https://www.ventoy.net/en/doc_start.html)，
再用 USB OTG 連接 Android，以檔案管理員將
`.img` 複製到 Ventoy 資料分割區。安全退出後，讓目標電腦從
隨身碟開機，在 Ventoy 選單選取映像。Ventoy 支援
`.img`，不必解壓縮或改名成 `.iso`。

---

首次安裝 Ventoy 會清除所選隨身碟。之後複製映像
檔進去不必重新格式化。若要保留 Ventoy 安裝，
請勿對該隨身碟使用 `dd` 或 Rufus。

Ventoy 與直接寫入映像兩種方式擇一使用。若已使用 Ventoy，
略過下方 Linux／macOS／Windows 直接寫入
方法，繼續[從隨身碟開機](#從隨身碟開機)。

**Linux：使用 `dd` 直接寫入。** 先用 `lsblk`
辨認隨身碟並卸載其已掛載的分割區。下方 `/dev/sdX`
指整顆磁碟，不是 `/dev/sdX1` 之類的分割區。
此操作會覆寫目標磁碟、分割表及既有檔案，請仔細確認裝置。

```sh
sudo dd if='buninu-linux-<version>.img' of=/dev/sdX bs=4M conv=fsync status=progress
```

**macOS：使用 `dd` 直接寫入。** 用 `diskutil list`
辨認隨身碟，將下方 `N` 換成實際磁碟編號。同樣會覆寫
整顆磁碟。請使用 macOS 的 `bs=4m` 寫法；複製
時按 `Ctrl-T` 可查看進度。

```sh
diskutil list
diskutil unmountDisk /dev/diskN
sudo dd if='buninu-linux-<version>.img' of=/dev/rdiskN bs=4m
sync
diskutil eject /dev/diskN
```

**Windows：使用 [Rufus](https://rufus.ie/) 寫入。**
Rufus 除了 ISO，也支援原始 `.img` 磁碟映像（見
[官方常見問題](https://github.com/pbatard/rufus/wiki/FAQ#openbsd)）。
選取正確的 USB 裝置，以匯出的 `.img` 作為開機映像並開始寫入。若出現提示，使用
DD／原始映像模式。此操作會覆寫所選隨身碟，不必轉成 `.iso`。

#### 從隨身碟開機

以 x86-64 UEFI 模式從該隨身碟開機。UKI 未簽章，
除非自行簽署，否則請停用 Secure Boot。真機成功開機後，
本機螢幕與 USB 鍵盤會呈現如下結尾的歡迎訊息：

```text
Welcome to Buninu Linux!
Bun 1.4.2 is now PID 1
Type start() to run buninu --local
Configuration getters: cfg.all, cfg.disk, cfg.net, cfg.power, cfg.sound, cfg.gpu

bun-repl>
```

若看不到歡迎訊息，可能只是後續核心訊息將它從同一主控台捲走。
在空的 REPL 提示按 Enter；空白或只有空格的行會
再次印出歡迎訊息及目前的 `cfg.*` getter 清單。

只載入需要的子系統，再進入 Buninu shell：

```js
cfg.net       // 有線網卡與 Android USB 網路共享驅動
cfg.disk      // SATA／NVMe／USB 儲存驅動及偵測到的區塊裝置
cfg.power     // 電池、交流電源、按鈕與溫度驅動
cfg.sound     // 所有已打包 ALSA 音效模組及偵測到的音效裝置
start()
```

`start()` 開啟 Buninu shell 後，執行：

```sh
bunterm 2
```

這會在虛擬主控台 2 開啟圖形終端機並切換過去。它支援中文、
emoji 及瀏覽器終端圖形。用 `Ctrl+Alt+F1`
回到原始主控台，`Ctrl+Alt+F2`
回到此終端機。

執行 `poweroff` 可同步
資料後關機。修改 initramfs 後，用 `bun ./index.js -b --real --export`
重建映像；`-h` 列出所有旗標。

### 在桌面系統建置及測試虛擬機

> [!IMPORTANT]
> 本節只涵蓋用 `qemu-system` 建置與執行的客體。若要建置
> 真實 x86-64 UEFI 硬體使用的映像，請依照上方[快速開始](#快速開始)
> 並使用 `-fb --real --export`。

本節命令假設你已依[從原始碼建置](#或從原始碼建置)
複製原始碼並進入目錄，不必先執行該節的 `--real`
建置。Bun 必須在 `PATH` 中；依
下方步驟安裝 QEMU。

同一個 `index.js` 可在 Mac 或 Linux 主機的 QEMU 中建置及啟動 Buninu
Linux。`--arch` 選取客體架構：

| 主機 | `--arch x86_64`（預設） | `--arch aarch64`（別名 `arm64`） |
| --- | --- | --- |
| Apple Silicon Mac | q35，模擬（TCG） | `virt`，硬體加速（Hypervisor.framework） |
| Intel Mac | q35，硬體加速（Hypervisor.framework） | `virt`，模擬（TCG） |
| x86-64 Linux | 可使用 `/dev/kvm` 時，q35 硬體加速（KVM） | `virt`，模擬（TCG） |
| arm64 Linux | q35，模擬（TCG） | 可使用 `/dev/kvm` 時，`virt` 硬體加速（KVM） |
| Android Termux | q35，模擬（TCG） | `virt`，可使用 `/dev/kvm` 時採用 KVM，否則為 TCG |

`run-qemu.sh` 自行選取加速器；`ACCEL=tcg` 強制使用模擬。

#### macOS

預設 JS 工具直接透過主機 Bun 在 macOS 建置，不需要 Docker。
若用 `BUNINU_JS_TOOLS=0` 停用，`index.js` 會在由
[`Dockerfile`](Dockerfile) 建立、以 Debian 為
基礎的 `oven/bun:1.4.2` 容器內執行 shell 下載與建置階段，並綁定掛載
原始碼目錄。首次使用時建立容器映像，以 Dockerfile 雜湊作為標籤。在此 shell
工具模式下，只有執行階段直接使用 Mac 本身：

```sh
# -f／-b 使用主機 Bun；-r 使用 QEMU 及其 UEFI 韌體
brew install qemu

# Apple Silicon：Hypervisor.framework 加速 aarch64 客體
bun ./index.js -fbr --arch arm64

# x86_64 客體也可運作，採用模擬
bun ./index.js -fbr
```

`run-qemu.sh` 的第一行開機訊息列出選取的客體、機器、加速器
及韌體。單獨使用 `-r` 會啟動 `vda.img` 上次建置的架構；
`-br --arch arm64` 是 aarch64 修改後建置及開機的循環。若要
在 aarch64 客體的 QEMU 視窗執行 `bunterm`，
請見[此架構的差異](#六十四位元安謀架構的差異)。

#### amd64 Linux

在 Debian 或 Ubuntu 上，預設 JS 建置需要主機 Bun，
不需要原生建置工具鏈。當使用者能開啟 `/dev/kvm` 時，QEMU 會為
x86_64 客體使用 KVM。安裝 QEMU 及其韌體後即可建置開機：

```sh
sudo apt install qemu-system-x86 ovmf
bun ./index.js -fbr
```

若要執行 aarch64 客體，另安裝 `qemu-system-arm`
與 `qemu-efi-aarch64`。預設 JS 建置不需要交叉 binutils。
可選的[舊版 shell 建置](#舊版建置工具)則需要原生工具鏈（aarch64
包含 `binutils-aarch64-linux-gnu`），或設定
`BUNINU_JS_TOOLS=0` 並傳入 `--docker`，改用建置容器。

#### 六十四位元安謀架構的差異

* 映像位於同一 GPT 磁碟的 `vda/EFI/BOOT/BOOTAA64.EFI`，以 Alpine
  aarch64 套件及 `bun-linux-aarch64-musl` 建置。
* 序列主控台是 `ttyAMA0`（QEMU `virt` 的 PL011），而非 `ttyS0`。
* `--real` 僅適用 x86_64，其模組集針對個人電腦硬體。
* QEMU 的 `virt` 機器沒有顯示器或 PS/2 裝置，因此 `bunterm`
  預設沒有繪製目標；序列 REPL 與 Buninu shell 的運作方式與 x86_64
  相同。若要執行 `bunterm`，請用 `--linux-lts` 建置，並給 QEMU
  `ramfb` 顯示裝置及 virtio 輸入裝置。在 Mac 上，`-display cocoa`
  會開啟視窗：

  ```sh
  bun ./index.js -fbr --arch arm64 --linux-lts -- \
      -device ramfb -device virtio-keyboard-pci -device virtio-mouse-pci -display cocoa
  ```

  建置完成後，可以不重建（也不使用 Docker）而再次開機。
  `--linux-lts` 屬於建置選項，因此使用 `-r` 時省略：

  ```sh
  bun ./index.js -r --arch arm64 -- \
      -device ramfb -device virtio-keyboard-pci -device virtio-mouse-pci -display cocoa
  ```

  在序列 REPL 執行 `start()`，再執行 `bunterm 2`，
  便會在 QEMU 視窗的 VT 2 開啟 bunterm，並返回序列
  shell；請在視窗內輸入。單獨使用 `bunterm` 也預設採用 VT
  2，保留 VT 1 設定硬體。指定非目前使用中的 VT 時會以分離模式啟動（見[多個虛擬主控台](#多個虛擬主控台)）。韌體將 ramfb 設為 800×600，
  `init.js` 載入 `simpledrm`，讓它成為 `/dev/fb0`（見
  [graphics.md](graphics.md#trying-it)）。
* `--export` 寫出 `buninu-linux-<version>-aarch64.img`。
* 核心啟動前，Homebrew 的 aarch64 EDK2 會印出幾行
  `Error: Image at … start failed`（其驅動對應的硬體不存在於
  `virt`）及 `ConvertPages: failed to find range …`
  （無法將 UKI 放在 stub 偏好的位址，因此重新定位）。兩者皆無害，
  之後會出現 `BdsDxe: starting Boot0001` 並繼續開機。

#### 在容器中測試主機建置流程

`test/host/host-test.sh` 可在任何有 Docker 的機器
檢查 Linux 主機路徑：它啟動指定 CPU 的全新 `oven/bun:1.4.2`
容器，內含上述建置套件及 QEMU，複製目前原始碼已提交的 `HEAD`，
以 Bun 和預設 JS 工具建置兩種客體（不巢狀使用 `--docker`），依序開機並用
`test/host/boot-test.exp` 操作序列主控台：

```sh
test/host/host-test.sh arm64     # Linux arm64 主機（Apple Silicon 上原生執行）
test/host/host-test.sh amd64     # Linux x86-64 主機（在該平台模擬執行）
```

每個步驟——REPL、`start()`、`uname`、eth0、PID 1、掛載
tmpfs、客體下載及 `poweroff`——都等待預期輸出，最後以 `### PASS`
和結束狀態 0，或 `### FAIL` 和 1 結束。未提交的專案變更不會被測試，請先提交。
`GUESTS=aarch64` 限制客體架構，`BUILD_FLAGS=--linux-lts`
加入建置旗標，`downloads/` 以唯讀方式作為下載快取。Docker
Desktop 不提供 `/dev/kvm`，因此兩種客體皆使用 TCG；Linux
主機有 KVM 時腳本會傳入，對應架構的客體以 `accel=kvm` 開機。在
macOS，同一份 `boot-test.exp` 也能驅動本機開機：先
執行 `bun ./index.js -b --arch arm64`，再執行
`expect test/host/boot-test.exp "$PWD" aarch64`。

`ALPINE_MIRROR` 可將 Alpine CDN 換成鏡像站，例如
`ALPINE_MIRROR=https://mirrors.edge.kernel.org/alpine`；
每次下載仍會依鎖定的 SHA-256 驗證。

## 使用作業系統

### 基本設定

主要目標是真實硬體。除非自行簽署 UKI，否則請停用
Secure Boot 後從隨身碟開機。實體螢幕與 USB 鍵盤
提供 `bun-repl>` 提示。

只載入需要的硬體子系統：

```js
cfg.net
cfg.disk
cfg.power
cfg.sound
```

`cfg.net` 載入已打包的有線網路及 Android
USB 網路共享驅動，印出偵測到的介面及 MAC 位址，並自動
嘗試 DHCP 設定。成功後不必另下 DHCP 命令。

租約到期或需要重新取得網路設定時，用 `start()` 進入
Buninu shell，再執行 `dhclient usb0`
（將 `usb0` 換成介面名稱）。它只設定介面一次
便退出，不會自動續租。

若要手動設定固定 IP，使用：

```sh
ip link set eth0 up
ip addr add 192.168.1.50/24 dev eth0
ip route add default via 192.168.1.1
```

真機映像以 `1.1.1.1` 和 `8.8.8.8` 初始化
`/etc/resolv.conf`；若網路需要其他 DNS，請自行更換。
`cfg.disk` 載入常見 SATA／PATA／SCSI、NVMe
／VMD 及 USB 儲存裝置驅動，讓偵測到的磁碟與分割區出現在
`/dev`。`cfg.sound` 無條件載入映像中所有音效模組，再
列出產生的 `/dev/snd` 裝置；載入前不做硬體探測。若只想查看
檔案系統而不掛載：

```sh
mount -fv /dev/sda1 /mnt
```

執行 `poweroff` 可同步資料後關機。

### 使用終端機

點擊 bunterm 選單標題右側的 FPS 按鈕，可開啟／關閉終端右上角的青藍色計數器。它每秒取樣一次，統計實際呈現的新 Kitty 圖片幀（例如 Casty／Land 輸出），不計滑鼠與選單重畫。靜態圖片與純文字工作階段顯示 0 FPS。設定僅作用於目前 bunterm，預設關閉。

原生 bunterm 依 framebuffer 的位元欄位宣告偏好的原始像素格式：支援的 32 位元排列採用 BGRA 或 RGBA，其餘回報 PNG。新版 Casty、buninu-browser 與 Land 透過 Kitty 共用檔案傳輸自動協商；BGRA 使用私有格式 `f=1111970369`，RGBA 使用標準 `f=32`。其他終端機與 jsgotty 維持既有協議。

若要查看 Casty 目前的畫面傳輸路徑，按 `Ctrl-E`，輸入 `kitty`，
再按 Enter。在 Land 中則點擊 **@** 開啟命令列。
例如 `Kitty: file · format=bgra` 表示透過共用檔案傳送原始像素；
`rgba` 也是原始像素，PNG／JPEG 則表示已編碼圖片。支援的本機兩端
會自動協商 raw，不需要額外啟動旗標。
bunterm 的 FPS 計數器統計實際呈現的圖片，不是客戶端本身的渲染 FPS。

`bunterm` 是 Linux framebuffer 上的圖形終端機，不必啟動
X11 或 Wayland 即可顯示中日韓文字、彩色 emoji 與 Kitty
圖形。在真機映像中，於 `bun-repl>` 提示用 `start()` 進入
shell，再執行：

```sh
bunterm                     # 在最後工作階段之後開新 VT；首次為 tty2
bunterm 3 -s 16             # 另一個工作階段，字體 16 px（預設：13）
# 或在未使用的 VT 啟動指定應用程式：
bunterm 4 -e jsmdcui --allow-url README.md
```

若要在新的瀏覽器終端開啟網址或既有的本機檔案：

```sh
xdg-open https://buninu.org
xdg-open "./page with spaces.html"
```

`xdg-open` 在新的 VT 執行 `bunterm -e buninu-browser URL`。
HTTP／HTTPS 與 `about:` URL 直接開啟；本機路徑與 `file://` URL
會解析為既有的一般檔案，並編碼為絕對檔案 URL。不支援目錄與其他 URL
協定。用 `xdg-open --help` 查看用法。

用 `Ctrl+Alt+F1` 回到初始主控台，`Ctrl+Alt+F2` 回到 VT 2，
或用 `Alt+Left`／`Alt+Right` 切換 VT。在 shell 執行
`chvt 1`、`chvt 2` 也有相同效果。切換保留執行中的工作階段；離開某工作
階段的 shell 或應用程式則結束該 bunterm。

點擊螢幕最左上角的 **2×2 像素** 開啟選單：

| 控制項 | 用途 |
| --- | --- |
| 🔤 字體 − / + | 調整目前工作階段的文字及終端格數；字體大小置中顯示於按鈕之間。 |
| 📋 複製 | 用滑鼠左鍵拖曳選取終端文字，再複製到共用的 xclip 剪貼簿。只有應用程式未啟用滑鼠回報時才能選取。 |
| 📥 貼上 | 從 xclip 貼上。啟用 bracketed paste 的應用程式會收到其分隔序列，其餘收到純文字。 |
| 命令輸入 | 點擊淺色輸入框或按 Tab，輸入 `font 16`、`font +`、`font -`、`copy`、`paste`、`vt 2` 或 `help`，再按 Enter。這些是 bunterm 本身的命令。 |
| VT 列表 | 切換到既有 bunterm 或初始 tty。目前 VT 標記為 `(current)`。 |
| + 新增 bunterm | 在列表最大編號的下一個 tty 啟動 bunterm，沿用目前字體大小。 |

按 Esc 關閉選單。字體調整只保留於目前工作階段。應用程式
未要求滑鼠事件時，滾輪可捲動終端歷史。`--no-mouse` 停用
滑鼠輸入與選單；`--no-clipboard`
同時停用選單剪貼簿操作及 OSC 52。應用
程式間共享文字請見[剪貼簿](#剪貼簿)。

**Kitty keyboard：**應用程式可協商旗標
**1、2、8**，使用與 jsgotty 相同的編碼器，區分 Ctrl
／Alt／Shift／Super 組合，並要求按下、重複及放開事件。
不需要啟動旗標。一般應用程式仍使用主控台轉譯後的輸入；應用程式停用 Kitty
或 bunterm 退出時會還原原始鍵盤模式。VT 切換快捷鍵仍保留。
Kitty 模式尚未實作 dead key／Compose 序列。完整
選項與鍵盤細節見 `bunterm --help`。

### 使用命令殼層

bunmsh 是 Buninu 內附、受 mksh 啟發且無外部依賴的 shell。
主要功能如下：

- 以 `Bun.*` 開頭的行作為 JavaScript 執行；印出回傳值並自動
  等待 Promise。可用 `Bun.e;` 或 `Bun.e,` 執行任意
  JavaScript。
- 輕量的工作目錄分頁可保留多個工作目錄。在 bunmsh 中，
  `Ctrl-T` 建立或向右循環分頁，`Alt-T` 則向左循環。
  * 其他實用命令：`tab n`、`tab c`（Alt-C）
- shell 變數與 JavaScript 透過 `$.` 共用即時變數表，`Bun.sha`
  可跨命令及工作目錄分頁保留 JavaScript 值。
- 互動模式提供歷史儲存、匯入 Bash／Fish 歷史、
  補全與幽靈文字建議。
- `serve [directory]` 啟動可瀏覽的 HTTP 檔案
  伺服器。搭配 Android USB 網路共享，可簡單地在 Buninu
  Linux 與連接的手機之間傳輸檔案。
- 提供跨平台內建命令及 PATH 備援命令。
- `Ctrl-U` 移除並保存游標前的文字；在行
  首再次按下可還原。`Ctrl-K` 獨立處理游標後
  的文字，在行尾時可切換還原。
- 未加引號的路徑模式使用 `Bun.Glob`，如同
  傳統 shell，會跟隨路徑中間的目錄符號連結。這對
  sysfs 很重要，因為 class 項目通常是連結。例如：

```sh
ls /sys/class/net/*/device
```

若要方便閱讀的行程概覽，執行：

```sh
pspac

# 核心執行緒顯示為 [name]；濾除後只看使用者空間
pspac | grep -v '\[[a-z]'
```

`pspac` 顯示實際的 `PID COMMAND` 行程表，並以
micro 的 Monokai 配色將各命令列作為 shell 語法
上色。開頭的目錄以暗色顯示，凸顯程式名稱。`pspa` 則以純文字顯示同
一份表格。

完整語法、互動操作、內建命令及目前相容性細節，請見
[bunmsh 儲存庫](https://github.com/jjtseng93/bunmsh)。

### 編輯器快速開始

內附的 `jmi` 終端編輯器不需要網路連線：

```sh
jmi hlw.js
```

- 建議使用 `jmi` 的 `cmc-tc` 色彩主題
- 設定方式：
  * 按 `Ctrl-E`
  * 輸入 `theme `（包含結尾空白）
  * 按 `Tab`，使用上下方向鍵選取
  * 按 `Enter`。
  
- 輸入並儲存（Ctrl-S）以下內容：

```js
console.log("Hello world from real hardware");
```

用 `Ctrl-Q` 離開編輯器後，在本機執行：

```sh
bun hlw.js
```

若特定終端機無法辨識 `Enter`，可嘗試 `Ctrl-J` 或
`Ctrl-M`。

#### jsmdcui
- `jsmdcui` 是同一個編輯器，但預設會把 Markdown 檔案當作互動式 App 執行
- 請小心，不要執行陌生人提供的 Markdown 檔案
  * 否則它可以在你的電腦上執行任何命令
- `jsmdcui --cdp-maze` 執行會自行解題的迷宮遊戲
  * 先執行 `bunterm 2` 才能顯示其中的 emoji

### 多工模式

#### 多個虛擬主控台

在每個 Linux 虛擬主控台分別執行 `bunterm`。數字
位置參數是對應裝置的簡寫，因此 `bunterm 2` 等同
`bunterm /dev/tty2`。省略參數時，在最後一個已知工作階段之後開啟新的 VT（首次為 tty2）：

```sh
bunterm 2
bunterm 3 -s 13
```

指定的 VT 不是目前使用中的 VT 時，`bunterm` 會以分離工作
階段在該處啟動，切換顯示過去，並立即將控制權交回呼叫它的 shell。
用 `Ctrl+Alt+F1` 至 `Ctrl+Alt+F12` 切換
VT，或用 `Alt+Left`、`Alt+Right` 移到上一個或下
一個 VT。每個 VT 保有自己的終端工作階段；非使用中的 bunterm
仍會處理 PTY，但停止繪製，直到其 VT 再次啟用。每個 VT 只能由
一個 bunterm 控制。若已被使用，錯誤訊息會指出其 PID 並建議
其他 VT 編號。

#### 編輯器的窗格與終端分頁

`jmi` 與 jsmdcui 可同時開啟編輯器及終端工作階段。按
`Ctrl-E`，輸入 `term` 後按 `Enter`，便會在終端窗格開啟
預設 Buninu shell。`term COMMAND` 則啟動指定命令。在
同一 `Ctrl-E` 命令提示使用 `vsplit`、`hsplit`
或 `tab`，可建立其他編輯窗格或分頁；各命令皆可選擇傳入檔名。在編輯窗
格中，`Ctrl-T` 是開啟空白新分頁的直接快捷鍵。

##### 窗格與分頁操作

| 輸入 | 結果 |
| --- | --- |
| 點擊窗格 | 聚焦該編輯器或終端窗格。 |
| 在編輯窗格按 `Ctrl-T` | 開啟空白新分頁。 |
| 按一次 `Ctrl-W` | 從編輯器或終端窗格移到目前分頁的下一個窗格。 |
| `Alt-T` | 移到下一個分頁。 |
| **快速按兩次 `Ctrl-W`** | **重要的離開操作：**如同 `Alt-T` 移到下一個分頁，必要時建立編輯器分頁。詳細說明見下文。 |
| 在終端窗格按 `Esc` | 關閉該終端窗格，回到先前的編輯器緩衝區 |
| 在編輯窗格按 `Ctrl-Q` 或 `Alt-Q` | 關閉目前編輯器介面。 |

**為何此離開操作很重要：**終端窗格必須將幾乎所有組合鍵原樣轉送給
其中執行的 shell 或應用程式。因此
`Ctrl-W` 是 jsmdcui 攔截的多工
離開鍵，讓你能離開目前終端而不終止裡面的工作。按一次
移到目前分頁的下一個窗格；快速按兩次移到下一個分頁。

雙按在全是終端的工作區特別重要。目前分頁是
最右側，而且所有既有分頁都只有終端窗格時，
會建立新編輯器分頁，而非繞回第一個終端分頁。
其他情況都執行正常的下一分頁循環。只有確實
要關閉目前終端窗格時才使用 `Esc`。

### 顯示圖片

Linux 文字主控台不能繪製圖片，因此先啟動 framebuffer
圖形終端機 `bunterm`，再於其中執行圖片命令。請在另一個虛擬
主控台啟動，讓 tty1 保留 `bun-repl>` 提示供硬體設定
使用（用 `Ctrl+Alt+F1` 回去）：

```sh
# 在 VT 2 啟動圖形終端機（等同 bunterm /dev/tty2）
bunterm 2

# 用 Kitty 圖形協議顯示圖片（jsgotty --viu）
showimg /buninu/icon.png

# 用 glow 顯示 README.md，再顯示 icon.png
buninu-help

# 在 Markdown 檢視中就地顯示圖片
# 先執行 cfg.net 才能顯示該 GitHub 圖片
jsmdcui --allow-url README.md

# bunterm 支援滑鼠；--no-mouse 不操作 /dev/input
# （使用 VT 3，因為 VT 2 已有上面啟動的 bunterm）
bunterm 3 -e jsmdcui --allow-url README.md
```

`bunterm` 用 Skia（CanvasKit）繪製並理解 Kitty
圖形協議，因此 `showimg`、`jsmdcui`、`kitten icat`、
`timg` 等使用此協議的程式都能顯示圖片，也能呈現中日韓文字與彩色
emoji。顯示圖片後游標會移到圖片下方，圖片也會隨文字捲動。啟動的程式
結束後，主控台回到文字模式。選項見 `bunterm --help`；
[graphics.md](graphics.md) 說明其實作方式。映像需要
支援 framebuffer 的核心：請用 `--linux-lts` 或
`--real` 建置（預設 `linux-virt` 只將它建成模組，而映像未打包該
模組）。aarch64 客體還需要 QEMU 顯示
裝置，請見[此架構的差異](#六十四位元安謀架構的差異)。

### 剪貼簿

`bunterm` 透過 OSC 52 支援複製貼上，讓 `casty`、
`jsmdcui` 等程式可使用剪貼簿。bunterm 本身不保存內容，每次複製貼上都
交給 Buninu 的 `xclip -selection clipboard`。
目前剪貼簿是記憶體磁碟中的 `$HOME/.xclip.clipboard`
檔案，所以所有 bunterm 工作階段共用，重開機後會消失。應用程式
未啟用滑鼠回報時，才可左鍵拖曳選字。點擊左上角 **2×2 像素** 可開啟
**複製／貼上**、**字體 − / +**、VT 列表及本機命令欄位
（`font 16`、`copy`、`paste`、`vt 2`、`help`）。
應用程式要求時，貼上會使用 bracketed paste。
`bunterm --no-clipboard` 同時停用 OSC 52 與選單剪貼簿操作。

選單與 Kitty keyboard 支援請見[使用終端機](#使用終端機)。

在 `buninu-browser` 中，HTTPS 或 localhost 網頁的 Copy 按鈕可在
使用者點擊或按鍵後，透過 `navigator.clipboard.writeText()` 寫入文字。
瀏覽器控制端優先使用 `xclip -selection clipboard`，
因此複製的文字會進入 bunterm 與 jsmdcui 使用的同一剪貼簿。
若沒有可用的剪貼簿提供者，操作會回報失敗。
這與在 Casty 中選取文字後使用複製快捷鍵是不同的功能。

若要輸入中文，在 chroot 外的 bunterm 執行拼音輸入法
[jspinyin](https://www.npmjs.com/package/@drxiaozhi/jspinyin)，
讓它使用 Buninu 的 `xclip`：

```sh
jspinyin
```

- jspinyin → casty：在 jspinyin 按 `Ctrl-C` 複製結果框，再於 casty
  按 `Ctrl-V` 或輸入 `Ctrl-E paste`，便會透過 OSC 52 貼上。
- casty → jsmdcui／jspinyin：在 casty 按 `Alt-C` 透過 OSC
  52 複製選取內容，再於 jsmdcui 或 jspinyin 按 `Ctrl-V` 貼上，因為
  jsmdcui 預設優先讀取 `xclip`。

jspinyin 也提供**清除／還原**按鈕。清除會先保存目前結果，
再清空結果框；還原則把保存的文字追加到結果尾端。
還原後仍保留緩衝內容，因此可重複點擊以追加同一段文字。
候選字選取與其他操作，請見輸入面板內的說明連結。

### 實驗性有聲影片播放

已內建的 [jspulse](https://github.com/jjtseng93/jspulse)
是為 Bun 撰寫、相容 PulseAudio 的音效伺服器。它在 chroot
外的 Buninu 原生執行，透過 ALSA 播放。Debian chroot 內
`casty` 等基於 Chromium 的程式透過 `127.0.0.1`
連線，因為 chroot 共用 Buninu 網路。多個程式可以同時播放。

此處假設已完成
[Debian 與 Chromium 搭配 casty](#在隔離根目錄使用瀏覽器前端)的 Debian chroot
及 `casty` 設定，chroot shell 位於 tty2。
`bun x` 需要網路，請見[基本設定](#基本設定)。

1. **載入音效驅動。** 按 `Ctrl+Alt+F1` 回到 tty1 的
   `bun-repl>` 提示並執行：

   ```js
   cfg.sound
   ```

2. **開啟原生 Buninu 終端。** 仍在 tty1 時，用
   `start()` 進入 Buninu shell，再從該 shell 開啟另一
   個虛擬主控台（見[多工模式](#多工模式)）。接下來兩個步驟請在那裡執行，*不是
   *在 chroot 內：

   ```js
   start()
   ```

   ```sh
   bunterm 3
   ```

3. **辨認音效卡、設定音量並測試播放。** 先列出
   ALSA 音效卡及混音控制項：

   ```sh
   jspulse --audio-info
   ```

   內建喇叭或插在電腦音源孔的耳機，請選**主機板類比音效**卡。若列出
   card 0 **HDA Intel HDMI**、card 1
   **HDA Intel PCH**、card 2 **HDA NVIDIA**，先試
   **card 1（HDA Intel PCH）**。`Speaker Playback`、
   `Headphone Playback`、`PCM Playback` 或
   `Master Playback` 等控制項是辨認這類輸出的線索。

   若要從接在該 GPU 的螢幕或電視發聲，則選
   **HDMI／DisplayPort** 音效卡。Intel
   HDMI 與 NVIDIA 音效通常不會輸出到電腦的類比耳機孔。USB
   耳機或 USB 音效卡應使用自己的 USB 音效卡。

   音效卡編號依機器而異；請把下方 `1` 換成
   連接所需輸出的音效卡，再用測試音確認。

   ```sh
   jspulse --card 1 --volume 50
   jspulse --card 1 --play
   ```

   設定支援的播放音量也會解除對應開關的靜音。
   HDMI 卡可能沒有硬體播放音量控制，此時略過
   `--volume`，改調連接的螢幕／電視音量。
   這本身不代表 HDMI 無法播放。測試音會檢查選取的
   輸出；請視需要調整音量。

4. **在同一音效卡啟動音效伺服器。** 它持續在前景
   執行，因此保留此終端；`Ctrl+C` 可停止：

   ```sh
   jspulse --alsa --card 1

   # 或在背景啟動
   jspulse --alsa --card 1 &
   ```

5. **啟動有音效的 casty。** 按 `Ctrl+Alt+F2` 回到 chroot
   shell，將 PulseAudio 客戶端指向 jspulse，再啟動 casty：

   ```sh
   export PULSE_SERVER=127.0.0.1
   cd ~/casty/bin
   bun casty.js https://www.youtube.com
   ```

   另一種方式是內建 `buninu-browser`，它直接在
   chroot 外的原生 Buninu `bunterm` 執行，
   使用同一個執行中的 jspulse 伺服器。它仍在早期實驗
   階段，但可播放個別影片，例如：

   ```sh
   buninu-browser https://youtu.be/jf-pn0a-Twk
   ```

   播放仍可能失敗或不穩定；這不代表完整相容
   YouTube。

若沒有聲音，檢查步驟 4 的終端是否有錯誤，並確認在啟動 casty
的同一個 shell 匯出了 `PULSE_SERVER`。

### 資料與持久保存

Buninu Linux 從記憶體中的 initramfs
執行。預設家目錄（`/buninu`）、系統設定及工作
階段中安裝的套件，除非存到已掛載的磁碟，否則重開機後會
消失。`/tmp` 也是暫存空間。開機映像不會自動將變更
寫回自身，僅在 `/mnt` 建立目錄也不會讓資料永久保存。

若要保留檔案，在初始 `bun-repl>` 提示載入儲存驅動，再進入
shell：

```js
cfg.disk
start()
```

掛載既有資料分割區（將 `/dev/sda1` 換成實際分割區），
再將檔案存入或複製進去：

```sh
mount /dev/sda1 /mnt/data --mkdir
mkdir -p /mnt/data/work
cp /buninu/notes.md /mnt/data/work/notes.md
cd /mnt/data/work
```

複製範例假設你已建立 `/buninu/notes.md`。
分割區掛載時寫入 `/mnt/data` 的檔案
會留在磁碟上。重開機後再次掛載同一分割區便可
存取。這不會自動還原家目錄、已安裝套件或系統設定。

拔除磁碟前，關閉正在使用它的程式、離開其中的
目錄，再成功卸載：

```sh
cd /
umount /mnt/data
```

## 內建命令

| 命令 | 功能 | 手冊 |
| --- | --- | --- |
| `buninu-linux-help` | 顯示 `/usr/share/doc/buninu-linux/README.md` 中的本份 buninu-linux README | `buninu-linux-help` |
| `buninu-browser` | 早期實驗性的 JavaScript／WASM 瀏覽器，搭配內附 casty 終端前端；尚不能取代通用瀏覽器 | `buninu-browser --help` |
| `buninu-land` | 實驗性的軟體渲染 Wayland 合成器，搭配內附 casty 終端前端 | `buninu-land --help` |
| `jspulse` | 相容 PulseAudio 的音效伺服器與 ALSA 混音控制；在 Buninu Linux 使用 `--alsa` | `jspulse --help` |
| `jspinyin` | 透過系統 jsmdcui 以 TUI 模式開啟的中文拼音輸入面板；不是全系統輸入法 | — |
| `mount` | `mount(2)`，支援類型偵測、`-o` 解析、`LABEL=`／`UUID=`、bind／move／remount，並載入所需檔案系統及磁碟模組 | `mount --help` → `/usr/share/doc/buninu-linux/mount.md` |
| `umount` | `umount2(2)`，支援 `-l`、`-f`、`-R` | `umount --help` |
| `ip` | 透過 `SIOC*` ioctl 與 `/proc/net` 提供 iproute2 語法：`link`、`addr`、`route`、`neigh` | `ip --help` |
| `dhclient` | 到期或需要時重新取得 DHCPv4 設定（`dhclient usb0`）後退出，也支援釋放租約 | `dhclient --help` |
| `ping` | 透過 Bun FFI 傳送 IPv4 ICMP／IPv6 ICMPv6 echo；支援次數、間隔、逾時、總期限、資料大小、TTL 及來源選擇 | `ping --help` |
| `ps` | 從 `/proc` 取得可組合的行程欄位，也匯出快照及單列格式化函式供其他命令使用 | `ps --help` |
| `top` | 定期更新由 `ps` 提供的行程快照與各列 | `top --help` |
| `xdg-open` | 在新的 bunterm VT 用 buninu-browser 開啟 HTTP／HTTPS、`about:` 或既有本機檔案 | `xdg-open --help` |
| `chvt` | 切換 Linux VT（`chvt 1`／`chvt 2`），包含離開與返回 bunterm | `chvt --help` |
| `poweroff` | 同步待寫入資料，透過 Linux reboot 系統呼叫關機 | `poweroff --help` |
| `reboot` | 同步待寫入資料，透過共用的 Linux reboot 邏輯重新啟動 | `reboot --help` |
| `tar` | 透過 `Bun.Archive` 建立、解開或列出 tar 封存檔，支援 gzip 與 zstd 壓縮 | `tar --help` |
| `gzip`、`gunzip`、`zcat` | 壓縮或解壓縮 gzip 檔案，包含解壓縮到標準輸出 | `gzip --help` |
| `unzip` | 列出或解開 ZIP 封存檔，或用 `-p` 將其中項目寫到標準輸出 | `unzip --help` |
| `truncate` | 調整檔案大小，包含稀疏檔案 | `truncate --help` |
| `dd` | 在檔案間複製區塊，支援偏移、大小限制與稀疏輸出 | `dd --help` |
| `mkfs.fat` | 在磁碟映像內格式化 FAT32 檔案系統 | `mkfs.fat --help` |
| `mmd`、`mcopy`、`mdir` | 不掛載即可在 FAT 映像建立目錄、複製檔案及列出內容；使用 `-i IMAGE` 與 `::/path` | — |
| `parted` | 在磁碟映像建立及檢查 GPT 分割區；支援腳本模式子集 | `parted --help` |
| `stripansi` | 移除標準輸入、`-` 或一至多個檔案的 ANSI 跳脫序列，並串接結果 | — |
| `chroot` | 以 `chroot(2)` 進入另一個根目錄，自動掛載 `/proc`、`/sys`、`/dev`、`/dev/pts`、`/run`、`/tmp` 及 `/etc/resolv.conf`；支援 `-b HOST[:GUEST]`、`--shared-tmp`，退出時自動清理 | `chroot --help` |
| `bunterm` | framebuffer 圖形終端：以 Skia（CanvasKit）顯示中日韓文字、彩色 emoji、無縫框線與 Kitty 圖片，支援滑鼠及滾輪歷史捲動（`--no-mouse` 可停用）；透過 Bun 內建 PTY 使用 xterm.js 模擬核心 | `bunterm --help` |

除了 `bun`（及指向它的 `sh`／`node`），`/bin`
也包含上述命令，以 Bun 腳本或內附套件的輕量啟動器實作。

Debian／Alpine rootfs 與 Chromium
範例，請見[可選的根目錄切換與原生程式](#可選的根目錄切換與原生程式)。

`ping -c 4 127.0.0.1` 檢查 IPv4 連線；`ping -6 -c 4 ::1`
檢查 IPv6。`ping -c 10 -i 0.2 -W 1 HOST` 調整次數、
間隔及回覆逾時。此命令直接使用 ICMP socket，必要時退回 raw socket。
透過共用 libc 載入器支援 Linux glibc／musl 與原生 Android
bionic；`BUNINU_LIBC` 仍可明確覆寫選擇。執行
`bun test test/ping.test.js test/libc.test.js`
可與已安裝的系統 ping 對照。權限需求與支援旗標見 `ping --help`。

### 內建瀏覽器的早期實驗支援

`buninu-browser` 仍在早期階段。網站可能顯示
不正確、無法載入或播放媒體，尚不能取代通用瀏覽器。請在
`bunterm`（或其他支援 Kitty 圖形的終端）內執行。
瀏覽器與 casty 已內附，這些命令不會從 npm 安裝它們。

```sh
# 開啟 Buninu 網站（需要網路）
buninu-browser buninu.org

# 開啟瀏覽器內建音效測試頁
buninu-browser about:audio
```

若要音效輸出，先在 PID 1 REPL 用 `cfg.sound` 載入
音效驅動，再於另一個終端執行 `jspulse --alsa`，或用 `jspulse --alsa &` 在背景執行。在瀏覽器終端中：

```sh
buninu-browser about:audio
```

若要瀏覽使用自簽 HTTPS 憑證的可信任測試網站，可只針對
該次執行停用憑證驗證：

```sh
env NODE_TLS_REJECT_UNAUTHORIZED=0 buninu-browser https://localhost:8443
```

這也會停用該行程及繼承環境的子行程對其他請求的憑證驗證。
請勿將它全域匯出；未設定此覆寫時，
憑證驗證仍保持啟用。

### 內建合成器的早期實驗支援

在 `bunterm`（或其他支援 Kitty 圖形的終端）內執行
`buninu-land`，即可開啟 Wayland 桌面。合成器與 Casty 已內附，
啟動時不需從 npm 下載。

```sh
buninu-land
```

啟動器啟用 Casty 的 `--no-shortcuts`：頁面按鍵傳給 Land 與其
客戶端，不觸發 Casty 快捷鍵。若要退出前端，點擊網址列左側的
**@**，輸入 `q` 後按 Enter。點擊網址本身
則進入編輯；網址列顯示實際的 Wayland socket 路徑。

在 bunterm 或支援 Kitty keyboard 的 jsgotty 中使用內附 Casty，
會自動轉送 Super 組合鍵及放開事件：

| 快捷鍵 | 動作 |
| --- | --- |
| Super+方向鍵 | 聚焦該方向的視窗 |
| Super+W／Super+Q | 要求關閉目前聚焦視窗 |
| Super+F | 切換全螢幕 |
| Super+T | 切換浮動／平鋪 |
| Super+Alt+F | 在 Land 的單一輸出切換最大化 |
| Super+Shift+方向鍵 | 與該方向的平鋪視窗交換 |
| Alt+Tab／Alt+Shift+Tab | 向前／向後循環切換視窗 |
| Super+1–9 | 切換工作區 |
| Super+Shift+1–9 | 將聚焦視窗移到該工作區並跟隨過去 |
| Super+-／Super+= | 水平縮小／放大；加 Shift 改為垂直 |

調整尺寸預設每次 100 邏輯像素，加 Alt 為 25，加 Ctrl 為 300。
平鋪視窗調整的是分割比例。這些是已實作的視窗操作，
不是完整 Omarchy 桌面。傳統終端無法可靠傳送 Super；
Ctrl+Alt 組合現在直接傳給客戶端，不再作為替代快捷鍵。

**客戶端 GPU 加速：**先在初始 REPL 執行 `cfg.gpu`，再開啟
bunterm（見[可選的客戶端圖形加速](#可選的客戶端圖形加速)）。
接著在 bunterm 執行 Land，指定要向客戶端宣告的 GPU render 節點：

```sh
buninu-land -- --gpu=/dev/dri/renderD128
```

請將範例節點換成實際裝置；編號可能隨開機改變。
客戶端環境仍須具備可運作的 Mesa 驅動，並能存取同一個
render 節點。chroot 內的客戶端也必須能存取 Land 的 Wayland socket。
此預設組合啟用線性 DMA-BUF 匯入、延後擷取及 2 ms 輪詢。
單獨 `--gpu` 啟用此組合，但不指定 DRM 裝置。Land 本身
仍使用軟體合成，只有客戶端繪圖能使用 GPU。
驅動支援仍有限：測試過的 Intel 路徑可運作，但測試的 Nouveau
路徑產生空白或損壞圖片，因此不保證 NVIDIA 可用。

socket 目錄預設為 `$TMPDIR`，未設定 `TMPDIR`
時則使用系統暫存目錄；明確設定的 `XDG_RUNTIME_DIR`
優先。啟動合成器不需要設定環境。

在另一個終端，將 Wayland 客戶端的 `XDG_RUNTIME_DIR` 設為該 socket
目錄，`WAYLAND_DISPLAY` 設為合成器 socket 名稱（通常為 `wayland-buninu`，
額外執行個體依序使用 `wayland-buninu1`、`wayland-buninu2`
等），再啟動 Wayland 客戶端。當主機 `TMPDIR` 指向該目錄時，
chroot 內的客戶端可透過 `chroot --shared-tmp` 共用 socket。

`/bin/buninu-land` 啟動器將 `CASTY_BROWSER`
設為 `/usr/lib/node_modules/buninu-land/compositor.js`，
並執行內附 Casty。`--casty` 將參數轉送 Casty；`--headless`、
`--help`、`--version`、README 選項及預留的原生前端
則經過套件入口。套件的 CanvasKit WASM 若與系統副本位元組
相同，就共用系統副本；仍保留其載入器與授權檔案。

### 封存工具及其他範例

小型 `tar` 讀取封存檔自身的標頭來處理連結與清單，因此解壓時可
還原目錄、硬連結及所有符號連結，包括 `Bun.Archive`
拒絕的絕對目標，這也是解開後的 Alpine 根檔案系統能使用的
原因。`-t` 列出所有項目，不只一般檔案。建立封存檔仍遵循
`Bun.Archive` 的限制：儲存一般檔案，但不儲存
Unix 中繼資料、連結或空目錄。它支援 gzip 與 Bun
內建的 zstd，不支援 xz 或 bzip2。

- 有提供時，`--help` 會顯示命令說明或呈現其 Markdown 手冊。
- 下方 `bun x` 範例需要網路：
  * `bun x` 從 npm registry 下載指定程式並執行，不會永久安裝。
  * 若首次失敗，試試 `bun pm cache rm`
- 常見範例：

```sh
mount /dev/sda1 /mnt --mkdir
mount -fv /dev/sda1 /mnt
mount -t tmpfs -o size=64M tmpfs /tmp/x
mount -t ntfs3 -o force /dev/sda3 /mnt/windows
umount /mnt
umount -R /mnt


# 透過 bunproot 複製 Git 儲存庫
bun x bunproot --git clone https://github.com/jjtseng93/bunproot

# 在 jmi 閱讀移除 ANSI 格式後的 bunproot Git 手冊
bunterm 2
bun x bunproot --git --readme | stripansi | jmi



ip link set eth0 up
ip addr add 192.168.1.50/24 dev eth0
ip route add default via 192.168.1.1

ip -br addr && ip route
ip addr replace 192.168.1.50/24 dev eth0
ip route replace default via 192.168.1.1

ps -eo pid,args
ps -ef
ps aux
pspac
top
top -b -n 1

poweroff
reboot

tar cvf /tmp/buninu.tar README.md package.json
tar tvf /tmp/buninu.tar
mkdir -p /tmp/buninu-copy
tar xvf /tmp/buninu.tar -C /tmp/buninu-copy

# 加入 z 可建立 gzip 壓縮封存檔
tar czvf /tmp/buninu.tar.gz README.md package.json

# 在另一個虛擬主控台：支援中日韓文字、emoji 與圖片的圖形終端機
bunterm 2
bunterm /dev/tty3 --font-size 13 -e bun /buninu/apps/jsmdcui/src/index.js --demo
```

`bunterm` 背後的圖形堆疊——framebuffer 模組、CanvasKit、
字型及終端——記載於 [graphics.md](graphics.md)。

## 可選的根目錄切換與原生程式

這些可選範例會下載並執行原生 Linux 程式，包含 Debian／
Alpine 工具與 Chromium。它們不屬於 Buninu
Linux 的 JS／WASM 使用者空間工具路線，也不在預設內
附應用程式中。若只想使用 JS／WASM 工具，可略過本節。內建
`chroot` 命令本身是 Bun 腳本，但在所選根檔案系統內執行的
程式不一定要是 JavaScript 或 WebAssembly。

chroot 共用主機核心，不是安全沙箱。請使用可信任的根
檔案系統與軟體，下載需要網路。下方 Debian 與
Alpine 範例針對 x86-64；chroot 不會模擬
其他 CPU 架構。

### 在隔離根目錄使用瀏覽器前端

```sh
# 下載並進入 x64 Debian 根檔案系統
# 確認已執行過以下命令：
#   bunterm 2 --font-size 13
bun x bunproot --git --yes clone https://github.com/jjtseng93/js-udocker
cd js-udocker
bun udocker.js pull --platform=linux/amd64 debian:13
bun udocker.js create --name db debian:13
cd ~/.udocker/containers/db/ROOT
chroot . /bin/bash
apt update
apt install --no-install-recommends ca-certificates curl unzip chromium-headless-shell fonts-noto-cjk fonts-noto-color-emoji git
curl -fsSL https://bun.sh/install | bash
bun x bunmsh
# 原版 casty 是
#   @sanohiro/casty
# 以下是我的分支版本
# 修正部分問題並加入功能
cd
git clone https://github.com/jjtseng93/casty
cd casty/bin

bun casty.js buninu.org
# 若要 casty（YouTube）播放音效，先啟動 jspulse：
# 請見「使用作業系統」下的「實驗性有聲影片播放」
```

音效設定請見
[播放有聲音的影片](#實驗性有聲影片播放)。

### 最小根檔案系統

```sh
# 下載並進入 x64 Alpine 最小根檔案系統
bun x bunproot --download-alpine-x64
mkdir alpine
cd alpine
tar xvf ../alpine-minirootfs-*-x86_64.tar.gz
cp $(which bun) bin
chroot .
apk add libgcc libstdc++
```

### 使用既有根檔案系統

```sh
# 進入磁碟上的根檔案系統。/proc、/sys、/dev、/dev/pts、/run、/tmp
# 及 /etc/resolv.conf 會自動掛載，退出時再移除掛載
chroot /mnt
chroot /mnt /bin/bun --version
chroot -n /mnt /bin/sh        # 略過自動掛載（明確指定的 -b 仍有效）
```


可重複使用 `-b` 選項來共用主機檔案與目錄，放在
根檔案系統路徑前：

```sh
# 將主機目錄掛載到客體內的不同路徑
chroot -b /home/user/project:/work /mnt /bin/sh

# 省略客體路徑時，在客體內使用相同絕對路徑
chroot -b /home/user/project /mnt /bin/sh

# 共用多個路徑，包含個別檔案
chroot -b /home/user/project:/work -b /etc/hosts:/etc/hosts /mnt /bin/sh

# 共用主機暫存目錄，包含 Wayland socket
export TMPDIR=/tmp
chroot --shared-tmp /mnt /bin/sh
# 等同於：
chroot -b "$TMPDIR:/tmp" /mnt /bin/sh
```

`--shared-tmp` 展開成 `-b "$TMPDIR:/tmp"`
並取代自動建立的 `/tmp` tmpfs。必須設定 `TMPDIR`，且來源
路徑存在。此選項不改寫客體內的環境變數；若主機使用不同路徑，請在客體設定
`TMPDIR=/tmp`。對 Buninu Land 客戶端，請將客體
`XDG_RUNTIME_DIR=/tmp`、`WAYLAND_DISPLAY` 設為合成
器 socket 名稱，並確認主機 `TMPDIR` 是該 socket 所在目錄。

主機路徑可為相對路徑，客體路徑必須是絕對路徑。缺少的
客體掛載目標會自動建立。目錄採遞迴綁定，重複目標以最後
一個參數為準。即使使用 `-k`，綁定失敗也會中止設定
並清理已掛載項目。通常命令結束時會移除掛載；`-k`／
`--keep-mounts` 則在設定成功後保留。`-v` 回報
掛載與卸載過程。完整細節見 `chroot --help` 或
[chroot 手冊](initramfs/usr/share/doc/buninu-linux/chroot.md)。

## 環境與依賴

預設 JS 建置使用主機 Bun。下方原生建置工具依賴適用於
[舊版 shell 建置](#舊版建置工具)、可選的 Docker shell
工具鏈，以及獨立的原生 hello-world 範例。

### 建置環境

基準是原版 Debian 13（trixie）OCI 映像，本 PRoot
也是此環境；凡映像未內含的項目都算依賴。`debian:13`
與 `debian:13-slim` 含相同的 78 個套件，各
`PATH` 目錄內的執行檔完全相同；slim 只移除文件、man 手冊
與語系。因此 105 MB 的 `debian:13-slim` 比 149
MB 的完整版更適合作為起點，下方清單兩者皆適用。

基礎映像已提供 `bash`、GNU `tar`、`gzip`、`sha256sum`、
`mknod`、`find`、`sort`、`mkdir`、`mktemp`、`cp`、`rm`、
`chmod`、`truncate`、`dd`、`printf`、`awk` 及 `dirname`，這些
腳本都直接使用它們。其餘工具必須另外加入。

### 作業系統建置所需工具 ([第二節](#第二節作業系統與初始行程))

Buninu Linux 不需要編譯器：Bun 下載預先編譯的執行檔，UKI
以 `objcopy` 組裝。

```sh
apt install binutils-mingw-w64-x86-64 cpio curl dosfstools fakeroot mtools parted unzip
```

* **`binutils-mingw-w64-x86-64`** — `x86_64-w64-mingw32-objcopy`
  將 `.osrel`、`.cmdline`、`.linux` 及 `.initrd` 區段附加至 EFI stub，
  `x86_64-w64-mingw32-objdump` 則讀取其中的 `ImageBase`。兩者都需要理解
  PE 的 binutils：ELF `objcopy` 無法寫入這些區段，`llvm-objcopy`
  則拒絕 `--change-section-vma`。
* **`cpio`** — 寫出 `build/initramfs.cpio.gz`。腳本傳入
  `--owner=0:0 --reproducible`，因此必須使用 GNU cpio，不能用 busybox
  applet。
* **`curl`** — 下載 Alpine `.apk` 套件與 Bun 發行版 zip。
* **`dosfstools`** — `mkfs.fat` 格式化
  ESP，其 `-h` 隱藏磁區數必須與分割區起始磁區一致。
* **`fakeroot`** — 讓 `mknod` 與 `cpio` 不必有真正 root 權限就能在
  封存檔記錄 root 擁有的字元裝置；PRoot 無法提供真正 root 權限。
* **`mtools`** — `mmd`、`mcopy` 在 FAT 映像內建立
  `/EFI/BOOT` 並複製 UKI，不需掛載或 loop 裝置。
* **`parted`** — 寫入保護用 MBR、主要及備份 GPT，以及含
  類型 GUID 的 ESP 分割區項目。
* **`unzip`** — 從發行版 zip 解出 `bun` 執行檔。
* **`bun`**（或 **`node`**）— 在建置環境執行 `index.js`。
  + 在 bun 下，`--readme` 會呈現 Markdown；在 node 下則原樣印出。

### 問候範例所需工具 ([第一節](#第一節問候範例))

hello-world EFI 應用程式需要 C／PE 工具鏈，以及共用的磁碟
映像工具：

```sh
apt install clang lld dosfstools mtools parted
```

* **`clang`** — 用 `--target=x86_64-pc-win32-coff`
  將 `hello/hello.c` 編譯成 PE32+ 物件檔。在 trixie 對應 `clang-19`。
* **`lld`** — 提供 `lld-link`，透過 `/subsystem:efi_application`
  將 `hello/hello.obj` 連結為 EFI 應用程式。在 trixie 對應
  `lld-19`。
* **`dosfstools`**、**`mtools`** 及 **`parted`** — 透過共用的
  `build-image.sh` 建立 FAT ESP，並包入 GPT `vda.img`。

### 已退役的原生啟動程式

已退役的 `test/build-init-bootstrap.sh` 也需要 `clang lld`。
它編譯歷史上的獨立 x86-64 `/init`；目前 Buninu Linux
路徑不使用也不編譯它。

## 舊版建置工具

以下是先前的原生工具鏈建置說明，保留作為預設 JS 工具之外的
選擇。請明確設定 `BUNINU_JS_TOOLS=0`
才會使用。文件環境為 Termux PRoot 中的 Debian
13，或一般 Debian／Ubuntu 安裝；Alpine 路徑仍
屬實驗性。所選階段開始前會回報缺少的 shell 建置工具。

- 若從原始碼建置，請複製到 Termux 家目錄，讓原生 Termux
  與 PRoot 共用；兩者的 `~` 不同，但絕對路徑相同。
- 開始前，先在 Debian／Alpine 安裝 Bun：

```sh
# Debian/Ubuntu
apt update
apt install curl unzip

# Alpine
apk update
apk add curl unzip bash libgcc libstdc++

curl -fsSL https://bun.sh/install | bash
```

### 舊版直接透過套件建置

安裝建置工具，進入要保存完成映像檔的
目錄，再執行已發布的套件：

```sh
# Debian/Ubuntu
apt install binutils-mingw-w64-x86-64 cpio curl dosfstools fakeroot mtools parted unzip

# Alpine
apk add bash coreutils tar curl unzip parted dosfstools mtools libgcc libstdc++

mkdir -p /data/data/com.termux/files/home/buninu-build
cd /data/data/com.termux/files/home/buninu-build

export PATH=$HOME/.bun/bin:$PATH
export BUNINU_JS_TOOLS=0

bun x buninu-linux --version

# Debian/Ubuntu
bun x buninu-linux -fb --real --export

# Alpine：在 shell 流程內用 JS 處理 cpio 與 UKI 組裝
export BUNINU_JS_CPIO=1
export BUNINU_JS_UKI=1
bun x buninu-linux -fb --real --export
```

`--export` 將完成的 `vda.img` 從 bunx 套件目錄複製到執行命令時所在
目錄，命名為 `buninu-linux-<version>.img`。

### 舊版從原始碼建置

在原生 Termux 中：

```sh
git clone https://github.com/jjtseng93/buninu-linux.git ~/buninu-linux
```

在 PRoot 的 Debian 13 中：

```sh
apt install binutils-mingw-w64-x86-64 cpio curl dosfstools fakeroot mtools parted unzip
cd /data/data/com.termux/files/home/buninu-linux
BUNINU_JS_TOOLS=0 bun ./index.js -fb --real --export
```

這會下載鎖定的輸入、選取真機模組、建置 `vda.img` 並匯出
`buninu-linux-<version>.img`。
接著請見[寫入映像檔到隨身碟](#寫入映像檔到隨身碟)。

## 實作細節

### 第一節問候範例

- `hello/hello.c` 是獨立的 PE32+ EFI 應用程式，安裝於可移除
  媒體的備援路徑 `EFI/BOOT/BOOTX64.EFI`。
- 它是基本開機測試，不是完整的 Buninu Linux

```sh
./hello/build-hello.sh   # 在 PRoot 中
./build-image.sh         # 在 PRoot 中
sudo dd if=vda.img of=/dev/sdX bs=4M conv=fsync status=progress
```

確認 `/dev/sdX` 是整個目標 USB 裝置後，在
實體 x86-64 UEFI 機器開機。它向韌體主控台寫出
`Hello world from x64 UEFI!` 並等待；按任意鍵回到韌體介面。

`build-image.sh` 與[第二節](#第二節作業系統與初始行程)共用，請見[磁碟配置](#磁碟配置)。

### 第二節作業系統與初始行程

以官方 Alpine 套件組裝的未簽章 x64 統一核心映像，將 Bun
作為 init 行程，取代 hello-world 應用程式：

```sh
# 真機映像，在 PRoot Debian 中
bun ./index.js -fb --real --export

# bun x buninu-linux -fb --real --export
```

`index.js` 是統一入口（`npm run fetch` 與 `npm run pack`
也呼叫它）。真機映像階段依下載 → 建置的順序執行：

#### 建置旗標

下載與建置預設採用 JS 工具。解開 npm 套件需要主機 Bun。只有
`BUNINU_JS_TOOLS=0`、`off` 或 `false` 會
停用此路徑（不分大小寫，忽略前後空白）；未設定或空值則保持啟用。即使有
`--docker`，JS 工具仍略過 Docker。若要使用容器工具鏈，執行
`BUNINU_JS_TOOLS=0 bun index.js -fb --docker`。執行階段仍使用
`run-qemu.sh` 與主機 QEMU。

| 旗標 | 執行內容 | 使用時機 |
| --- | --- | --- |
| `-f`、`--fetch` | 預設 `scripts/fetch.js`；shell 路徑：`fetch-alpine.sh`、`fetch-bun.sh`、`fetch-npm.sh` | 首次複製原始碼，或更新鎖定版本後 |
| `-b`、`--build` | 預設 `scripts/build.js`；shell 路徑：`build-uki.sh`、`build-image.sh` | 修改 `initramfs/init.js` 或核心命令列後 |
| `--arch ARCH` | 明確選取 `x86_64`（下載／建置預設）或 `aarch64`；單獨 `-r` 偵測上次建置的 UKI | 建置或執行特定客體架構 |
| `--docker` | 停用 JS 工具時，在 `Dockerfile` 容器內執行 `-f`／`-b`（macOS shell 模式自動使用） | 不在主機安裝 shell 工具鏈而使用它 |

`--export` 是建置後選項：`-b` 完成後，將
`vda.img` 複製到執行命令時所在目錄，命名為
`buninu-linux-<version>.img`（`--arch aarch64`
則為 `buninu-linux-<version>-aarch64.img`）。因此
需要 `-b`／`--build`，也是保存 npx／bunx 所建映像的建議方法：

```sh
bun x buninu-linux -fb --real --export
```

`--linux-lts` 選取 Alpine 通用 LTS 核心。
`--real` 隱含 `--linux-lts` 並為真機建置：將 `tty0`
設為主要主控台，包含一般筆電與桌機所需的 xHCI／USB HID、常見有線
網卡、Android USB 網路共享、儲存及 ACPI 電源模組。

真機的完整映像流程是 `-fb --real`，修改後
重建則用 `-b --real`。開始前，`index.js`
檢查所有必需工具是否在 `PATH` 中，列出缺少項目，
避免執行到一半才失敗。shell 腳本負責實際工作，各自仍能
獨立執行。

```text
index.js                  entry point: -f / -b / -r / --arch / --docker / --export / --linux-lts / --real
Dockerfile                Debian-based oven/bun:1.4.2 plus the shell build toolchain
fetch-alpine.sh           [fetch]  kernel, EFI stub, musl, network/input/display modules
fetch-bun.sh              [fetch]  Bun, libstdc++, libgcc
fetch-npm.sh              [fetch]  pinned browser, land, casty, jspulse and jspinyin tarballs (download only)
build-uki.sh              [build]  UKI; calls scripts/pack-initramfs.sh
build-image.sh            [build]  GPT disk image; shared with the hello-world EFI
run-qemu.sh               [run]    QEMU q35 (x86_64) or virt (aarch64), KVM/HVF/TCG
scripts/arch.sh           per-architecture pins, hashes and names, sourced by all of the above
scripts/fetch.sh          hash-checked download helper, sourced by fetch-*.sh
scripts/pack-initramfs.sh cpio archive with the device nodes
hello/                    hello-world EFI: hello.c and build-hello.sh (x86_64 only)
test/                     the retired C bootstrap and its build script (x86_64 only)
test/host/                build-and-boot test on a fresh Linux amd64/arm64 host, in Docker
initramfs/                init.js, commands, userspace: the same for every architecture
native/<arch>/            musl and the GCC runtime (committed); bun and modules (fetched)
```

`--real` 的輸入為 Alpine v3.24 `linux-lts-6.18.58-r0`、musl
`1.2.6-r2`、`systemd-efistub-260.2-r0`、`libstdc++`／`libgcc`
`15.2.0-r5`，以及 Bun 1.4.2 `linux-x64-musl-baseline`。aarch64
客體使用 Alpine aarch64 儲存庫的相同版本與 Bun 的 `linux-aarch64-musl`。
不包含 BusyBox 或傳統原生使用者空間；命令由 Bun 與 JavaScript 的
Buninu 使用者空間提供。

每個步驟皆可重複執行而保持相同結果，`-f` 不會重下載有效
快取：`scripts/fetch.sh` 以各鎖定
SHA-256 作為快取鍵，`downloads/<arch>/` 中雜湊正確的
檔案直接沿用，缺少、截斷、過時或遭竄改的檔案則重新下載，且必須
通過同一雜湊驗證，腳本才會解開。更新版本同時更換檔名與雜湊，因此
一定會重新取得。

五個應用套件與精確版本鎖定於
[`scripts/npm-packages.md`](scripts/npm-packages.md)，以該清單為映像依據。
下載時絕不即時解析 `latest` 或版本範圍。
各 registry tarball 都先依發布的 SHA-512 integrity 驗證，
再將 SHA-256 記入該共用鎖定清單。

清單使用固定且相容 YAML 的區塊：以雙引號包住
`"package@version":` 標頭，後接兩行 `  - `，分別包含
registry URL 與 `sha256:HEX`。允許空行及 `#` 註解。
`.md` 副檔名讓 `bun scripts/npm-packages.md`
可顯示清單。Bun 用 `Bun.YAML.parse`
解析；Node 與 shell 也支援相同嚴格格式，不需安裝
YAML 解析器。快取檔名由套件名及版本推得，保留既有快取名稱。

兩種下載路徑都直接從 `registry.npmjs.org` 下載至
x86_64 與 aarch64 共用的 `downloads/npm/`，
無論命中快取或重新下載，都驗證鎖定 SHA-256。下載期間不
執行 npm／Bun 套件安裝、生命週期腳本或依賴解析。

打包時，`scripts/stage-npm.js`（JS 工具）或
`scripts/stage-npm.sh`（shell 工具）再次檢查 SHA-256，去掉封
存檔最前面一層路徑後，解到暫存樹的 `/usr/lib/node_modules/<package>`。
有 scope 的名稱保留 `@scope/name` 目錄。不執行安裝腳本
或依賴解析。JS 解壓使用 initramfs 的 JS `tar`，需要
主機 Bun；shell／Docker 解壓使用主機 `tar`，不需 Bun。
打包不修改原始 `initramfs/` 與專案 `package.json`。

映像內的 `/usr/lib/package.json` 包含五個精確依賴版本及
標準 `node_modules/.bin` 連結。這保留一般套件管理器配置，供
之後 `cd /usr/lib`、`bun i --backend=copyfile`
使用；不會憑空製作 lockfile。單獨 `bun i` 保留
鎖定版本，不更新為較新版本。此處尚未實作跨開機持久保存或套件更新命令。

解壓時只有 `buninu-browser` 排除
`package/usr/lib/canvaskit` 與 `package/usr/share/fonts`；
`usr/README.md`
及其他內容皆保留。發行版的 `/bin/buninu-browser`
啟動器在啟動時建立缺少的資源目錄與相對連結：套件
的 `usr/lib/canvaskit` 指向
`/lib/canvaskit`，`usr/share/fonts`
指向 `/usr/share/fonts`。既有資源不動，包含後續
npm 安裝還原的資源。啟動器直接執行打包的 casty，不透過
`bunx`／`npx` 下載；其他前端與選項交由套件啟動器。請使用
發行版命令完成資源設定，直接呼叫 npm 入口會略過此掛鉤。除此之外，解
出的套件保持原樣，包含授權與原始碼檔案。這個步驟不啟動服務，也不把
jspinyin 整合進終端。

`/bin/jspulse` 直接從 `/usr/lib/node_modules`
匯入已安裝套件的入口。`/bin/jspinyin` 則以 `--tui` 啟動
`/buninu/apps/jsmdcui/src/index.js` 的系統 jsmdcui，傳入使用者參數後再接
`/usr/lib/node_modules/@drxiaozhi/jspinyin/im.md`。
它略過上游 `bun x jsmdcui` 啟動器，所以啟動此命令不會下載 jsmdcui。兩者
皆是小型可執行 JavaScript 檔案，沒有 shell 包裝。在終端執行
`jspulse --alsa` 或 `jspinyin` 即可。

若只要下載這些應用程式封存檔：

```sh
bun scripts/fetch-npm.js     # 內建 fetch；也可用 Node.js 執行
./fetch-npm.sh              # curl + sha256sum，也適用 Docker 內部
```

#### 建置流程

主要的 `bun ./index.js -fb --real` 流程依序執行
下列步驟，各步驟寫出下一步要讀取的檔案。若選用 `--export`，最後
會將完成的 `vda.img` 複製到執行命令時所在目錄。

##### 流程輸入與輸出

| 腳本 | 讀取 | 寫出 |
| --- | --- | --- |
| `fetch-alpine.sh` | Alpine CDN | `kernel/<arch>/vmlinuz-<flavor>`、`kernel/<arch>/linuxx64.efi.stub`（`linuxaa64.efi.stub`）、`native/<arch>/lib/ld-musl-<arch>.so.1`，以及 `native/<arch>/lib/modules/` 下選取的網路、儲存、輸入、電源與檔案系統模組，附精簡模組索引 |
| `fetch-bun.sh` | GitHub、Alpine CDN | `native/<arch>/bin/bun`、`native/<arch>/lib/{libc.musl-<arch>.so.1,libstdc++.so.6,libgcc_s.so.1}` |
| `fetch-npm.sh`／`scripts/fetch-npm.js` | npm registry，`scripts/npm-packages.md` 的固定 URL 與 SHA-256 | `downloads/npm/*.tgz`；打包時再解到 `/usr/lib/node_modules` |
| `scripts/pack-initramfs.sh` | `initramfs/`，再以 `native/<arch>/` 覆蓋 | `build/initramfs.cpio.gz` |
| `build-uki.sh` | 該封存檔、核心及 stub | `build/cmdline`、`build/os-release`、`vda/EFI/BOOT/BOOTX64.EFI`（`BOOTAA64.EFI`） |
| `build-image.sh` | `vda/EFI/BOOT/BOOTX64.EFI`（`BOOTAA64.EFI`） | `vda.img` |

`build-uki.sh` 會自行呼叫 `scripts/pack-initramfs.sh`，因此
很少直接執行後者。

各階段是巢狀的：initramfs 嵌入 UKI，UKI 再嵌入磁碟映像。因此
即使只修改 `initramfs/init.js` 一行，仍需要以下兩個步驟：

```sh
bun ./index.js -b --real
```

核心命令列也相同：`build-uki.sh` 將它寫入
`build/cmdline` 並編入 UKI。開機時不會從磁碟
讀取該檔案。

#### 統一核心映像配置

`build-uki.sh` 透過 `objcopy` 在 systemd 對應架構
的 EFI stub 附加區段，使用計算出的 VMA，因為 `objcopy` 不會自動
配置。以下大小與偏移描述目前 x86_64 `--real` 映像；aarch64
使用較大的 `linuxaa64.efi.stub`，因此 `.osrel`
與 `.cmdline` 會位移，每次建置都測量輸入以避免重疊：

##### 統一核心映像區段

| 區段 | 相對映像基底的偏移 | 內容 | 大小 |
| --- | --- | --- | --- |
| `.text` | +0x0 | stub 本身 | 66 KB |
| `.osrel` | +0x20000 | `build/os-release` | 78 B |
| `.cmdline` | +0x30000 | `build/cmdline` | 136 B |
| `.linux` | +0x2000000 | `kernel/x86_64/vmlinuz-lts` | 14.5 MB |
| `.initrd` | +0x3000000 | `build/initramfs.cpio.gz` | 44.6 MB |

目前 x86_64 `--real` 的結果是單一 59.3 MB
PE32+ 檔案，包含核心、initramfs 與命令列。其他架構、核心
類型與原始碼版本可能產生不同大小。

#### 磁碟配置

`build-image.sh` 不需要掛載、loop 裝置或
root 權限。它格式化獨立 FAT32 映像，以 mtools 填入
檔案、`parted` 建立 GPT，再用 `dd`
的 `conv=notrunc,sparse` 將檔案系統寫入分割區。
`mkfs.fat -h 2048` 很重要：FAT 隱藏磁區數必須符合分割區起始磁區，否則某些
韌體會拒絕該磁碟區。

```text
LBA 0              protective MBR
LBA 1..33          primary GPT
LBA 2048..262110   ESP, FAT32 "EFIBOOT", type GUID C12A7328-F81F-11D2-BA4B-00A0C93EC93B
                     /EFI/BOOT/BOOTX64.EFI     x86_64 UKI
                     /EFI/BOOT/BOOTAA64.EFI    aarch64 UKI (in an aarch64 image)
LBA 262111..       backup GPT
```

映像至少為 128 MiB 的稀疏檔案，依 EFI 內容自動增長
（每次 64 MiB，預留 FAT 中繼資料及可用空間），採 1
MiB 對齊，尾端保留 34 個磁區
給備份 GPT。`EFI/BOOT/BOOTX64.EFI` 與
`EFI/BOOT/BOOTAA64.EFI` 是各架構的可移除媒體備援路徑，
因此對應韌體會直接執行映像內的檔案，不需任何 NVRAM 開機項目。

#### 真機開機細節

真機開機鏈為韌體 → UKI stub → 其內嵌的 `.linux`
／`.initrd`／`.cmdline` 區段 → 核心 →
`rdinit=/bin/bun`。`--real` 使用 Alpine `linux-lts`，
包含 xHCI 與 USB HID 模組鏈，目前鎖定核心使用以下完整命令列：

```text
console=ttyS0,115200 console=tty0 REAL_MACHINE=1 panic=0 PATH=/bin KERNEL_RELEASE=6.18.58-0-lts rdinit=/bin/bun -- -e import('/init.js')
```

保留序列核心日誌，最後指定的主控台則讓
`/dev/console` 與 Bun REPL 使用
實體螢幕及鍵盤。此路徑已在真機測試成功。

#### 虛擬機開發

此可選路徑已在原生 Android Termux，以及搭配 QEMU 8.2.2、
TCG 與 OVMF 的 Ubuntu 24.04 雲端虛擬機測試。在原生
Termux，請另外安裝執行工具，與 PRoot 建置依賴分開：

```sh
pkg install qemu-system-x86-64
```

該套件在 QEMU 執行檔附近的 `$PREFIX/share/qemu/edk2-x86_64-code.fd`
提供 OVMF，這是 `run-qemu.sh` 在 `OVMF_FILE` 與 Debian 的
`/usr/share/OVMF/OVMF_CODE_4M.fd` 之後搜尋的位置（Homebrew
的 `share/qemu` 也用同樣方式尋找）。建置時不加 `--real`，就會選取 Alpine `linux-virt`、省略真
機模組集，並將 `ttyS0` 放最後，讓序列標準輸入輸出擁有 `/dev/console`：

```text
console=tty0 console=ttyS0,115200 panic=0 PATH=/bin KERNEL_RELEASE=6.18.58-0-virt rdinit=/bin/bun -- -e import('/init.js')
```

使用以下命令建置並開機：

```sh
bun ./index.js -fb

# 在 PRoot 內使用 Termux 原生 qemu-system-x86_64 時，
# 將它加入 PATH；其 OVMF 位於附近：
PATH="/data/data/com.termux/files/usr/bin:$PATH" \
bun ./index.js -r
```

若 QEMU 安裝於目前 Debian 環境內，直接 `bun ./index.js -r`
即可；`run-qemu.sh` 會使用 Debian 的 OVMF 路徑。

`bun ./index.js -r` 執行 `run-qemu.sh`，在
q35（aarch64 映像則為 `virt`）啟動 `vda.img`，
配備 1 GiB、virtio 磁碟、virtio-net 使用者網路、不開
顯示器，第一個序列埠接到標準輸入輸出。客體與主機 CPU 相符時使用 KVM 或
Hypervisor.framework，其餘使用 TCG；請見[在桌面系統建置及測試虛擬機](#在桌面系統建置及測試虛擬機)。`--` 後的內容附加到 QEMU 命令列。Ctrl
-C 結束 QEMU。離開 REPL 不會結束工作階段，`init.js` 會重啟
它，因為 PID 1 退出會造成核心 panic。

僅供 QEMU 的 CLI 階段是 `-r`／`--run`；`-fbr` 是完整
虛擬機流程，`-br` 是修改後建置開機循環，`--` 後參數原樣轉送，例如
`-r -- -m 1G`。對應儲存庫入口為 `run-qemu.sh`。
若要改測[第一節](#第一節問候範例)的 EFI hello-world 映像，先建置它，再執行
相同 `-r` 階段；OVMF 透過 COM1 提供主控台。舊的
`fetch-plus-build.sh` 包裝等同虛擬機 `-fb`
階段，不選取 `--real`。`npm start` 呼叫執行階段。

若要更短的 initramfs 測試循環，可略過 UKI 與磁碟映像：

```sh
qemu-system-x86_64 -machine q35,accel=tcg -cpu max -m 512M \
    -kernel kernel/x86_64/vmlinuz-virt -initrd build/initramfs.cpio.gz \
    -append "console=ttyS0,115200 panic=0 PATH=/bin rdinit=/bin/bun -- -e console.log(1+1)" \
    -nic user,model=virtio-net-pci -display none -serial stdio -no-reboot
```

這類測試之間只需重新執行 `./scripts/pack-initramfs.sh`。
由於 `panic=0`，panic 會讓客體停住，此時按 Ctrl-C。
此捷徑不測試 UKI stub、GPT、實體主控台或硬體驅動；完成後仍須用
`bun ./index.js -b --real` 在真正 UEFI 路徑驗證結果。

##### 虛擬機網路

網卡使用 QEMU 使用者模式網路（SLIRP）：客體為 NAT 後的 `10.0.2.15/24`，
閘道是 `10.0.2.2`，DNS 是 `10.0.2.3`，因此可以向外連線——開機
時 `fetch example.com` 可驗證——但若未轉送連接埠，外部無法連入。
`PORTS` 用來設定轉送，以空格分隔 `host[:guest]`，`guest`
預設與 `host` 相同：

```sh
PORTS="18080" bun ./index.js -r           # 主機 127.0.0.1:18080 → 客體 :18080
PORTS="18080 2222:22" bun ./index.js -r   # ……另加主機 127.0.0.1:2222 → 客體 :22
```

`run-qemu.sh` 將每個項目轉為 `hostfwd=tcp:127.0.0.1:H-:G`。
依 SLIRP 的轉送方式，有兩點需要注意：

* 主機端只綁定 `127.0.0.1`，不會暴露到裝置自身的
  網路介面。移除位址（`hostfwd=tcp::H-:G`）可
  改變此行為。
* 轉送連線抵達客體的 `eth0` 位址，因此內部服務必須監聽
  `0.0.0.0`（或 `10.0.2.15`）。綁定客體自身
  `127.0.0.1` 的服務收不到外部流量；已用兩個轉送連接埠
  上的伺服器分別綁定兩種位址驗證。

客體內的 `127.0.0.1` 仍可供內部程式使用：`init.js` 掛
載完成後立即啟用 `lo`，此時核心指派 `127.0.0.1/8`。
若缺少此步驟，所有綁定 `127.0.0.1` 的操作都會以
`EADDRNOTAVAIL` 失敗。

以下兩個行為屬於預期：

* **開機會修改 `vda.img`。** 韌體以唯讀方式掛載，且沒有獨立變數儲存
  區，因此 OVMF 將非揮發性變數存為 ESP 上的 `/NvVars`。每次
  開機後 `git status` 都會回報 `vda.img` 已修改。
* **QEMU 會對 `vda.img` 加寫入鎖。** 第二個執行個體會以
  `Failed to get "write" lock` 失敗；若要同時執行兩個，請先複製映像。

#### 命令實作

前述 `/bin` 命令是建構於 `/lib` 兩個共用模組之上的
Bun 腳本。`--help` 使用 `Bun.markdown.ansi`
將 Markdown 手冊呈現為含超連結的內容，並在最後印出頁面
的絕對路徑，以便直接讀取或編輯。共用部分如下：

* `/lib/dlopen.js` — 以 `bun:ffi` 綁定 `/lib/libc.musl-<arch>.so.1`
  （`mount`、`umount2`、`ioctl`、`socket`、`sync`、`reboot`、`syscall` 等），
  提供 `errno`／`strerror`、`SysError` 類別及各命令 `--help`
  使用的 `showDocument()` 輔助函式。`process.arch` 決定
  libc 檔名與 `finit_module` 系統呼叫編號，後者是這些命令唯一直接使用的原始系統呼叫。`init.js` 保有自己的綁定副本，因為它在
  `/proc` 存在之前執行，無法匯入其他內容。
* `/lib/modprobe.js` — `modprobe(name)` 解析
  `/lib/modules/<release>/` 下的 `modules.alias` 與
  `modules.dep`，依序為各依賴呼叫 `finit_module`。核心在此沒有可呼叫的
  `/sbin/modprobe`，因此 `mount` 自行預載 `ext4`＋`jbd2`、`vfat`＋NLS
  表、`ntfs3`、`sd_mod`、`nvme` 等。

映像包含哪些模組由 `fetch-alpine.sh` 清單決定，其中的
`select_module` 輔助函式從 Alpine `modules.dep`
帶入依賴；`--real` 加入常見儲存路徑（`sd_mod`、`ahci`、
`ata_generic`、`pata_acpi`、`nvme`、Intel
`vmd`、`usb-storage`、`uas`）、有線網卡、Android USB 網路共享
驅動及 ACPI 電源驅動。Alpine 核心將這些都建成模組；自行建置核心並將它們
設為 `=y` 也能以相同方式運作，只是載入器找不到需要載入的項目。

#### 尚未掛載時進入腳本環境

預設 `--real` 映像內嵌以下核心命令列（此處為目前
鎖定的 LTS 版本）：

```text
console=ttyS0,115200 console=tty0 REAL_MACHINE=1 panic=0 PATH=/bin KERNEL_RELEASE=6.18.58-0-lts rdinit=/bin/bun -- -e import('/init.js')
```

實體螢幕（`tty0`）是最後指定的主控台，因此擁有 PID 1 的
標準串流；`ttyS0` 仍可提供序列日誌。核心直接 exec
`/bin/bun`，中間沒有原生啟動程式；`init.js` 的第
一個動作是透過 `bun:ffi` 掛載 `/proc`、`/sys`、
`/dev`、`/tmp` 與 `/dev/pts`。`--` 前的
每個項目都需要 `=`，因為核心會把裸字附加到 init argv，而
非視為環境變數指派；`--` 後的所有內容原樣成為 `argv[1..]`，
`argv[0]` 設為 `rdinit=` 路徑。除此之外參數順序不限，所以將
`rdinit=` 放最後，讓行尾讀起來就是最後執行的 `bun -e …`。

要讓這個流程運作，必須分別滿足兩個條件。

**入口必須是 `-e`，不能是檔案。** `bun /init.js` 先開啟入口檔案，再以
`readlink("/proc/self/fd/N")` 正規化路徑（位於
`src/runtime/cli/run_command.rs` 的 `maybe_open_with_bun_js`）；
失敗便放棄，這正是沒有 /proc 的開機環境會遇到的情況。`-e` 不開啟入口檔案，因此略過
此步驟。Bun 啟動時*不會*解析 `/proc/self/exe`——該結果由
`process.execPath`／`process.argv[0]` 延後快取，失敗時退回
`argv[0]`——其餘啟動時讀取 `/proc` 的項目（`vm/overcommit_memory`、
`vm/mmap_min_addr`、`self/cgroup`、`self/statm`）
失敗都不致命。

**Bun 啟動前必須存在 `/dev/urandom`。** JSC 的 `OSRandomSource`
無法開啟它時會呼叫 `CRASH()`，而作為 PID 1 時這會立即造成核心 panic：

```text
panic(main thread): abort() called
traps: bun[1] trap invalid opcode
Kernel panic - not syncing: Attempted to kill init!
```

當時尚未掛載 devtmpfs，因此 `scripts/pack-initramfs.sh`
直接在 cpio 封存檔記錄 `urandom`，以及核心在 exec
前開啟為 init 的 fd 0／1／2 的 `console`，和其他
少數無害節點。
使用 `--real` 時，`tty0` 列在 `console=` 參數
最後，使實體螢幕擁有 `/dev/console`；`ttyS0` 仍可輸出
序列核心日誌。

initramfs 中沒有 `/init`；核心僅透過 `rdinit=` 進入 Bun。已
退役的原生啟動程式保留在 `test/build-init-bootstrap.sh`，
可重建為 `/init`，用於在 Bun 啟動前掛載內容，或以不同
參數 exec Bun 來逐步縮小開機失敗原因。建置、重新打包後，以
`rdinit=/init` 開機。上述 `/dev/urandom`
需求，就是透過改變此啟動程式在 exec 前掛載哪些檔案系統
而找出的。

#### 初始化腳本的工作

它安裝訊號處理器，透過 `bun:ffi` 載入 musl 的獨立實體
副本，掛載 `/proc`、`/sys`、`/dev`、`/tmp`
與 `/dev/pts`（若未掛載 devpts，每次開啟 pty
都會以 `ENODEV` 失敗，因為 `/dev/ptmx` 透過
`/dev/pts/ptmx` 解析），開啟 Num Lock、印出問候訊息
並啟動 `node:repl`。核心以 Num Lock 關閉狀態啟動各虛擬
主控台，數字鍵盤因此會輸入方向鍵而非數字；init 透過 `KDSKBLED`
為每個已存在的主控台設定目前狀態與重設後的狀態。稍後才首次啟用的主控台——
例如剛開機按 `Ctrl-Alt-F3`——仍從核心預設開始；在 REPL
執行 `numlock()`（或 `numlock(false)`）
可再次將設定套用到所有主控台。提交空白或只有空格的 REPL 行，會
再次印出歡迎訊息及可用 `cfg` getter。載入器與
libc 路徑內容位元組相同，但刻意使用不同 inode：

```text
/lib/ld-musl-x86_64.so.1      /lib/ld-musl-aarch64.so.1
/lib/libc.musl-x86_64.so.1    /lib/libc.musl-aarch64.so.1
```

對已作為 Bun 載入器的同一個 musl inode 呼叫 `dlopen`
會死鎖，獨立實體 libc 則可運作。它提供 `mount`、
`waitpid`、網路呼叫與通用 `syscall` 入口，因此不需要
自訂 `libinit.so`。

`--real` 開機時，init 以 `1.1.1.1` 和
`8.8.8.8` 初始化 `/etc/resolv.conf`，
作為使用者換成適合本地網路 DNS 前的初始公共解析器。硬體
網路在 `cfg.net` 載入已打包驅動並嘗試 DHCP
設定前維持停用。仍可用 `ip` 手動設定位址與路由。

`cfg.net` 為每個偵測到的非 loopback 介面在背景
啟動 DHCP，立即返回；失敗與取得逾時只記錄訊息，不中斷
init。各客戶端設定租約後退出，不留下續租行程。重複呼叫 `cfg.net`
不會重複啟動仍在執行的客戶端。路由 metric 從
100 開始；只有第一個介面更新 DNS，若它無法取得
租約，init 的備援解析器仍可使用。

租約到期或需要重新取得網路設定時，執行 `dhclient usb0`
（或依介面名稱使用 `dhclient eth0`）。
`cfg.net` 自動設定成功後，不需要再多做此步驟。
`dhclient` 設定完成便退出；`-timeout 20`
將取得時間限制為 20 秒。租約不會自動續租。手動固定
設定請見[基本設定](#基本設定)。

`--real` 映像的 REPL 也提供以 getter 為基礎的 `cfg` 命名空間：
`cfg.net`、`cfg.disk`、`cfg.power`、`cfg.sound`、`cfg.gpu` 與 `cfg.all` 讀取屬性時
立即執行，不需括號。`cfg.net` 載入所有已打包網路模組（包含 PHY 與匯流排支援），再讀取各 PCI、
USB 網路裝置的 `modalias`，與 `fetch-alpine.sh` 保留
於 `modules.alias`
的 `pci:`／`usb:` 行比對，並列出介面。`cfg.disk` 載入已打包
SATA／PATA／SCSI、NVMe／VMD 與 USB 儲存堆疊，讓磁碟與
分割區出現在 `/dev`，再列出 `/sys/class/block`。`cfg.all` 嘗試
**除了 GPU 模組以外**的所有已打包模組，並遞迴載入其宣告依賴。`--real` 包含
Intel `e1000`／`e1000e`／`igb`／`igc`、Realtek
`r8169`、Atheros `alx`、Broadcom `tg3`、常見 USB
網卡，以及供 Android USB 網路共享的 `rndis_host`／`cdc_ether`
／`cdc_ncm`／`cdc_eem`／`cdc_subset`／`zaurus`。
`cfg.net` 無條件嘗試這些已打包網路模組。`cfg.sound` 同樣無條件嘗試
`kernel/sound/` 下所有已打包模組，再列出 `/dev/snd`，不做硬體探測。

所選核心類型有提供時，打包音效集涵蓋 QEMU ES1371／HDA、常見 PC HDA／
HDMI 及 USB 音效。`cfg.power` 透過 `/lib/modprobe.js`
載入 ACPI 的 `battery`、`ac`、`button`、`thermal`
模組，並列出 `/sys/class/power_supply`（無電池桌機只會回報
沒有註冊項目）。開機時不會載入它們。PID 1 也安裝 `uncaughtException`
／`unhandledRejection` 監聽器；若沒有，在提示中一個未處理的
`Promise.reject()` 就會讓 Bun 退出，造成核心 panic
（`Attempted to kill init!`）。

`start()` 啟動內附的 Buninu 使用者空間及 bunmsh（Bun
Modern Shell），保留目前行程環境，同時覆寫使用者空間工作階段的
`PATH` 與 `HOME`。

### 可選的客戶端圖形加速

若建置時只要省略額外要求的 GPU 模組與韌體：

```sh
bun index.js -b --real --no-gpu
```

原有 simpledrm／fbcon／bunterm
路徑、音效／網路／儲存模組及其所需依賴都
保留。此設定作用於下載與建置，並轉送進
Docker。直接使用 shell 腳本時，執行
`env BUNINU_NO_GPU=1 REAL_MACHINE=1 LINUX_FLAVOR=lts ./build-uki.sh`。
切換此選項會使模組／韌體快取失效；省略選項（並取消設定 `BUNINU_NO_GPU`）
即可恢復預設 GPU 打包。已快取 APK 下載檔保留，但不放進映像。
這不會停用所選核心已編入的 GPU 支援。


GPU 驅動會打包，但**不會由開機、`start()`、`cfg.all` 或 `cfgMod` 載入**。
既有 simpledrm／framebuffer 與軟體渲染 bunterm 路徑
仍是預設。在開啟 bunterm／fbdev 前，於 PID 1 REPL 明確讀取：

```js
cfg.gpu
```

這是一次性的 PCI／virtio 硬體探測，不是常駐服務。它配對可用
驅動、載入模組依賴，並列出 `/dev/dri/renderD*`
與 `/dev/fb*`。個別驅動失敗會回報，但不停止 init。
缺少 render 節點不會被回報為成功加速：請檢查核心韌體／驅動
訊息；若探測是非同步，稍後再次讀取 `cfg.gpu`。若行程已持有
`/dev/fb*` 的 fd 或 mmap，會拒絕載入 GPU 驅動。
先退出該 framebuffer 客戶端；GPU 接管後重新開啟，以
取得新的 framebuffer、解析度與像素格式。不保證一定是 `fb0`。

x86_64 LTS 模組集包含 Intel `i915`／`xe`、AMD `amdgpu`
／舊版 `radeon`、NVIDIA **Nouveau** 及 VMware
`vmwgfx`；兩種架構都要求 `virtio_gpu`。所選 Alpine 核心
沒有的模組會略過並在建置時註明。有 PC GPU 模組時會包含五個鎖定的 Alpine
`linux-firmware-{i915,xe,amdgpu,radeon,nvidia}`
套件（下載約 151 MB）。保留韌體符號連結與目錄別名，核心直接讀取其 `.zst`
檔。韌體版本鎖定於 `scripts/gpu-firmware.json`；授權
與 WHENCE 位於 `LICENSES/linux-firmware/`。
請重建既有映像以加入新模組與韌體；建置會偵測舊版下載快取。

render 節點設為 `root:0`、權限 `0660`，供本系統 root
客戶端使用。非 root 客戶端請在讀取 getter 前設定數字形式的附加群組：

```js
process.env.BUNINU_RENDER_GID = "107" // 使用客戶端實際的 render 群組 ID
cfg.gpu
```

客戶端必須以該數字群組執行，且在 chroot／proot 內能看到實際的
`/dev/dri` 節點與相關 `/sys`。Mesa、Vulkan
loader／ICD 及其依賴屬於**客戶端**環境；此變更不安裝它們，也不
加速 CanvasKit／Land 本身。僅有 render 節點不能證明
硬體渲染，應確認 `vulkaninfo`／瀏覽器渲染器及可見輸出。QEMU 另需
加速的主機 GPU 後端（VirGL／Venus）；單純 2D virtio
GPU 不代表 3D 加速。此處不包含 NVIDIA 專有驅動、Android
KGSL 或特定 ARM 板子的 GPU／DT／韌體啟用支援。

## 目錄

- [快速開始](#快速開始)
  * [步驟](#步驟)
    + [直接透過套件建置](#直接透過套件建置)
    + [或從原始碼建置](#或從原始碼建置)
    + [寫入映像檔到隨身碟](#寫入映像檔到隨身碟)
    + [從隨身碟開機](#從隨身碟開機)
  * [在桌面系統建置及測試虛擬機](#在桌面系統建置及測試虛擬機)
    + [macOS](#macos)
    + [amd64 Linux](#amd64-linux)
    + [六十四位元安謀架構的差異](#六十四位元安謀架構的差異)
    + [在容器中測試主機建置流程](#在容器中測試主機建置流程)
- [使用作業系統](#使用作業系統)
  * [基本設定](#基本設定)
  * [使用終端機](#使用終端機)
  * [使用命令殼層](#使用命令殼層)
  * [編輯器快速開始](#編輯器快速開始)
    + [jsmdcui](#jsmdcui)
  * [多工模式](#多工模式)
    + [多個虛擬主控台](#多個虛擬主控台)
    + [編輯器的窗格與終端分頁](#編輯器的窗格與終端分頁)
      - [窗格與分頁操作](#窗格與分頁操作)
  * [顯示圖片](#顯示圖片)
  * [剪貼簿](#剪貼簿)
  * [實驗性有聲影片播放](#實驗性有聲影片播放)
  * [資料與持久保存](#資料與持久保存)
- [內建命令](#內建命令)
  * [內建瀏覽器的早期實驗支援](#內建瀏覽器的早期實驗支援)
  * [內建合成器的早期實驗支援](#內建合成器的早期實驗支援)
  * [封存工具及其他範例](#封存工具及其他範例)
- [可選的根目錄切換與原生程式](#可選的根目錄切換與原生程式)
  * [在隔離根目錄使用瀏覽器前端](#在隔離根目錄使用瀏覽器前端)
  * [最小根檔案系統](#最小根檔案系統)
  * [使用既有根檔案系統](#使用既有根檔案系統)
- [環境與依賴](#環境與依賴)
  * [建置環境](#建置環境)
  * [作業系統建置所需工具 (第二節)](#作業系統建置所需工具-第二節)
  * [問候範例所需工具 (第一節)](#問候範例所需工具-第一節)
  * [已退役的原生啟動程式](#已退役的原生啟動程式)
- [舊版建置工具](#舊版建置工具)
  * [舊版直接透過套件建置](#舊版直接透過套件建置)
  * [舊版從原始碼建置](#舊版從原始碼建置)
- [實作細節](#實作細節)
  * [第一節問候範例](#第一節問候範例)
  * [第二節作業系統與初始行程](#第二節作業系統與初始行程)
    + [建置旗標](#建置旗標)
    + [建置流程](#建置流程)
      - [流程輸入與輸出](#流程輸入與輸出)
    + [統一核心映像配置](#統一核心映像配置)
      - [統一核心映像區段](#統一核心映像區段)
    + [磁碟配置](#磁碟配置)
    + [真機開機細節](#真機開機細節)
    + [虛擬機開發](#虛擬機開發)
      - [虛擬機網路](#虛擬機網路)
    + [命令實作](#命令實作)
    + [尚未掛載時進入腳本環境](#尚未掛載時進入腳本環境)
    + [初始化腳本的工作](#初始化腳本的工作)
  * [可選的客戶端圖形加速](#可選的客戶端圖形加速)
- [作者](#作者)
- [授權](#授權)
  * [內附元件授權](#內附元件授權)

## 作者

Buninu Linux 由其使用者空間
[Buninu](https://github.com/jjtseng93/buninu)
的作者 Dr. John 撰寫與維護。核心、C 函式庫、GCC 執行環境、UEFI
stub 與 Bun 本身都是各自專案的成果；[NOTICE.md](NOTICE.md)
列出每個元件在此發行的精確版本、套件與 SHA-256。

## 授權

Buninu Linux 自有作品——建置腳本、`hello/hello.c`、
`init.js`、已退役啟動程式，以及設定與中繼資料檔案——採 MIT 授權，見
[LICENSE](LICENSE)。`initramfs/buninu/` 下
的 Buninu 使用者空間也採 MIT（`initramfs/buninu/LICENSE`），
並附有自身的第三方聲明，列於 [NOTICE.md](NOTICE.md) 末尾。

儲存庫也為每個客體架構在 `native/<arch>/lib/`
提交四個第三方平台二進位檔，建置的映像還會重新散布更多元件。
各自維持原有條款，平台
授權文字位於 [`LICENSES/`](LICENSES/)。

建置也會下載五個以 SHA-256 鎖定的 npm 發行版，並於
`/usr/lib/node_modules` 重新散布：`buninu-browser`、`buninu-land`、
`@drxiaozhi/casty`、`@drxiaozhi/jspulse` 及
`@drxiaozhi/jspinyin`。其授權與聲明檔案保留在套件目錄中。精確下載 URL 與雜湊見
[`scripts/npm-packages.md`](scripts/npm-packages.md)；
版本、上游來源及安裝後的聲明／原始碼位置記錄於
[NOTICE.md](NOTICE.md#npm-applications-fetched-and-redistributed-in-the-image)。
本專案 MIT 授權不取代這些套件的授權。尤其
jspulse 與瀏覽器內附的 wasmpeg／FFmpeg
程式碼帶有 LGPL 義務；重新散布映像時，請保留其
授權及提供的原始碼／重建資料。

### 內附元件授權

| 元件 | 授權 | 位置 |
|---|---|---|
| musl（`ld-musl-x86_64.so.1`、`libc.musl-x86_64.so.1` 及 `aarch64` 對應組合） | MIT | 已提交 |
| GCC 執行環境（`libgcc_s.so.1`、`libstdc++.so.6`） | GPL-3.0-or-later，附 GCC Runtime Library Exception | 已提交 |
| Linux 核心及網路、儲存、xHCI、USB、HID 模組 | GPL-2.0-only，附 Linux syscall note | 僅映像內 |
| systemd EFI stub | LGPL-2.1-or-later | 僅映像內 |
| Bun | MIT，以及靜態連結元件的各自授權 | 僅映像內 |
| buninu-browser | 自有程式碼採 MIT；內附元件各有授權 | npm 下載 → 映像 |
| buninu-land | 自有程式碼採 MIT；內附元件保留各自授權與聲明 | npm 下載 → 映像 |
| wasmpeg／FFmpeg（`@wasmpeg/cpu` 1.0.1，內附於 buninu-browser） | LGPL-2.1-or-later，另附元件聲明；保留原始碼封存檔與重建文件 | 瀏覽器套件 → 映像 |
| `@drxiaozhi/casty` | MIT | npm 下載 → 映像 |
| `@drxiaozhi/jspulse` | LGPL-2.1-or-later，另附元件聲明 | npm 下載 → 映像 |
| `@drxiaozhi/jspinyin` | MIT；hanzipinyin 素材採 Unlicense | npm 下載 → 映像 |
| CanvasKit 0.41.1（`initramfs/lib/canvaskit/`，編譯成 WebAssembly 的 Skia） | BSD-3-Clause（`LICENSES/BSD-3-Clause-Skia.txt`） | 已提交 |
| xterm.js 6.0.0 無頭核心與 unicode-graphemes 附加元件（`initramfs/lib/xterm/`）；`initramfs/lib/bunterm/glyphs.js` 中的框線形狀表 | MIT（`LICENSES/MIT-xterm.js.txt`） | 已提交 |
| DejaVu Sans Mono（`initramfs/usr/share/fonts/DejaVuSansMono*.ttf`） | Bitstream Vera（`LICENSES/Bitstream-Vera.txt`） | 已提交 |
| Noto Sans CJK、Noto Color Emoji（含 Flags）、Noto Sans Symbols（`initramfs/usr/share/fonts/Noto*`） | SIL OFL 1.1（`LICENSES/OFL-1.1.txt`） | 已提交 |
| Roboto（`initramfs/usr/share/fonts/Roboto-Regular.ttf`） | Apache-2.0（`LICENSES/Apache-2.0.txt`） | 已提交 |

有個元件值得直接指出，而不是留待讀者自行發現：兩個 GCC 執行環境函式庫採
**GPL-3.0，附 GCC Runtime Library Exception**
（Buninu 的 `apps/musl-la/` 所提交、映像也一併攜帶
的 aarch64 `libgcc_s.so.1`／`libstdc++.so.6`
也是如此）。正是這項例外允許它們與 MIT 程式碼一同發行，所以此處不
改變 Buninu Linux 自身的條款；但若組織會篩查 GPL，會找到的
就是這些元件。[NOTICE.md](NOTICE.md)
記錄各元件的精確 Alpine 建置、作為對應原始碼的鎖定
aports 提交、套件 SHA-256，以及選定解出檔案的 SHA
-256。
