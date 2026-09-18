#!/usr/bin/env jsmdcui

# Bun.Image Processor

先把本機圖片路徑貼到下方（例如 `/home/me/photo.jpg`）。輸出檔會放在原圖旁邊，檔名為 `original.resized.jpg` 或 `original.resized.png`；原圖不會被覆寫。

```text#image-path
demo.jpg
```

- [讀取圖片 metadata](javascript:readMetadata())
- .
- [跳到寫入按鈕](#寫入狀態)

```text#image-metadata
尚未讀取 metadata
```

## 常用選項

| 選項 | 值 | 調整 |
| --- | --- | --- |
| 寬度 | 800 | [−100](javascript:adjustCell(this,-100,1)) · [+100](javascript:adjustCell(this,100,1)) |
| 高度 | 自動 | [自動 / 600 / 1080](javascript:cycleCell(this,['自動','600','1080'])) |
| 維持長寬比 | [x] 啟用 | [切換](javascript:toggleCell(this)) |
| 旋轉 | 0 | [下個 90°](javascript:cycleCell(this,['0','90','180','270'])) |
| 不放大小圖 | [x] 啟用 | [切換](javascript:toggleCell(this)) |
| 自動校正方向 | [x] 啟用 | [切換](javascript:toggleCell(this)) |

## 進階選項

| 選項 | 值 | 調整 |
| --- | --- | --- |
| 濾鏡 | lanczos3 | [下一個](javascript:cycleCell(this,['lanczos3','lanczos2','mitchell','cubic','mks2013','mks2021','bilinear','linear','box','nearest'])) |
| 亮度 | 1 | [−0.1](javascript:adjustCell(this,-0.1,0)) · [+0.1](javascript:adjustCell(this,0.1,0)) |
| 飽和度 | 1 | [−0.1](javascript:adjustCell(this,-0.1,0)) · [+0.1](javascript:adjustCell(this,0.1,0)) |
| 上下翻轉 | [ ] 啟用 | [切換](javascript:toggleCell(this)) |
| 左右翻轉 | [ ] 啟用 | [切換](javascript:toggleCell(this)) |

## 輸出選項

| 選項 | 值 | 調整 |
| --- | --- | --- |
| 格式 | JPEG | [JPEG / PNG](javascript:cycleCell(this,['JPEG','PNG'])) |
| JPEG 品質 | 80 | [−5](javascript:adjustCell(this,-5,1,100)) · [+5](javascript:adjustCell(this,5,1,100)) |
| 漸進式 JPEG | [ ] 啟用 | [切換](javascript:toggleCell(this)) |
| PNG 壓縮 | 6 | [−1](javascript:adjustCell(this,-1,0,9)) · [+1](javascript:adjustCell(this,1,0,9)) |
| PNG 調色盤 | [ ] 啟用 | [切換](javascript:toggleCell(this)) |
| 調色盤色數 | 256 | [−16](javascript:adjustCell(this,-16,2,256)) · [+16](javascript:adjustCell(this,16,2,256)) |
| PNG 抖色 | [x] 啟用 | [切換](javascript:toggleCell(this)) |

## 最後一步
- [跳到頂端](#bunimage-processor)
- .
- [處理並寫入圖片](javascript:resizeAndWrite())

## 寫入狀態

```text#write-status
尚未執行
```

```js front
function optionText(tableId, row) {
  return $('#' + tableId).cell(row, 1).text().trim();
}

function optionChecked(tableId, row) {
  return $('#' + tableId).cell(row, 1).val() === true;
}

function valueCell(target) {
  return $(target).parent()?.lt() ?? null;
}

export function toggleCell(target) {
  const cell = valueCell(target);
  if (cell) cell.val(!cell.val());
}

export function cycleCell(target, values) {
  const cell = valueCell(target);
  if (!cell || !Array.isArray(values) || values.length === 0) return;
  const current = cell.text().trim().toLowerCase();
  const index = values.findIndex(value => String(value).toLowerCase() === current);
  cell.text(String(values[(index + 1 + values.length) % values.length]));
}

export function adjustCell(target, delta, min = -Infinity, max = Infinity) {
  const cell = valueCell(target);
  if (!cell) return;
  const current = Number(cell.text().trim());
  if (!Number.isFinite(current)) return;
  const value = Math.min(Number(max), Math.max(Number(min), current + Number(delta)));
  cell.text(String(Math.round(value * 100) / 100));
}

function describeError(error) {
  if (error == null) return '未知錯誤（沒有錯誤內容）';
  if (typeof error === 'string') return error;
  const details = [];
  if (error?.code) details.push(`錯誤代碼：${error.code}`);
  if (error?.name && error.name !== 'Error') details.push(`類型：${error.name}`);
  if (error?.message) details.push(`訊息：${error.message}`);
  if (error?.error && error.error !== error) details.push(`錯誤：${describeError(error.error)}`);
  if (error?.cause && error.cause !== error) details.push(`原因：${describeError(error.cause)}`);
  if (error?.stack && String(error.stack) !== String(error.message ?? ''))
    details.push(`Stack：${error.stack}`);
  if (details.length) return details.join('\n');
  try {
    const json = JSON.stringify(error, null, 2);
    if (json && json !== '{}') return json;
  } catch {}
  return String(error);
}

export async function readMetadata() {
  const output = $('#image-metadata');
  output.val('正在讀取 metadata…');

  try {
    const inputPath = $('#image-path').val().trim();
    const result = await rpc.readImageMetadata(inputPath);
    if (!result || typeof result !== 'object' || result.ok !== true) {
      const error = result && typeof result === 'object' && 'error' in result
        ? result.error
        : result;
      output.val(`讀取 metadata 失敗：\n${describeError(error)}`);
      return;
    }
    output.val(`圖片路徑：${result.inputPath}\n${JSON.stringify(result.metadata, null, 2)}`);
  } catch (error) {
    output.val(`讀取 metadata 失敗：\n${describeError(error)}`);
  }
}

export async function resizeAndWrite() {
  const status = $('#write-status');
  status.val('處理中…');
  let options;

  try {
    options = {
      inputPath: $('#image-path').val().trim(),
      width: optionText('常用選項', 1),
      height: optionText('常用選項', 2) === '自動'
        ? ''
        : optionText('常用選項', 2),
      fit: optionChecked('常用選項', 3) ? 'inside' : 'fill',
      rotate: Number.parseInt(optionText('常用選項', 4), 10),
      withoutEnlargement: optionChecked('常用選項', 5),
      autoOrient: optionChecked('常用選項', 6),
      filter: optionText('進階選項', 1).toLowerCase(),
      brightness: optionText('進階選項', 2),
      saturation: optionText('進階選項', 3),
      flip: optionChecked('進階選項', 4),
      flop: optionChecked('進階選項', 5),
      format: optionText('輸出選項', 1).toLowerCase(),
      jpegQuality: optionText('輸出選項', 2),
      progressive: optionChecked('輸出選項', 3),
      pngCompression: optionText('輸出選項', 4),
      pngPalette: optionChecked('輸出選項', 5),
      pngColors: optionText('輸出選項', 6),
      pngDither: optionChecked('輸出選項', 7),
    };
    const result = await rpc.resizeImage(options);

    if (!result || typeof result !== 'object' || result.ok !== true) {
      const error = result && typeof result === 'object' && 'error' in result
        ? result.error
        : result;
      status.val(`寫入失敗：\n${describeError(error)}\n讀取選項：\n${JSON.stringify(options, null, 2)}`);
      return;
    }

    status.val(`成功寫入：${result.outputPath}\n${result.width}×${result.height}，${result.bytes} bytes\n讀取選項：\n${JSON.stringify(options, null, 2)}`);
  } catch (error) {
    const optionText = options ? `\n讀取選項：\n${JSON.stringify(options, null, 2)}` : '';
    status.val(`寫入失敗：\n${describeError(error)}${optionText}`);
  }
}
```

```js back
import { dirname, extname, join, basename, resolve } from 'node:path';

function integer(value, name, { min = 1, max = Number.MAX_SAFE_INTEGER, optional = false } = {}) {
  if (optional && String(value ?? '').trim() === '') return undefined;
  const result = Number(value);
  if (!Number.isInteger(result) || result < min || result > max)
    throw new Error(`${name} 必須是 ${min}–${max} 的整數`);
  return result;
}

function finite(value, name, { min = 0 } = {}) {
  const result = Number(value);
  if (!Number.isFinite(result) || result < min)
    throw new Error(`${name} 必須是至少 ${min} 的數字`);
  return result;
}

function describeBackendError(error) {
  if (error == null) return '未知錯誤（沒有錯誤內容）';
  if (typeof error === 'string') return error;
  const details = [];
  if (error?.code) details.push(`[${error.code}]`);
  if (error?.name && error.name !== 'Error') details.push(error.name);
  if (error?.message) details.push(error.message);
  if (error?.cause && error.cause !== error)
    details.push(`原因：${describeBackendError(error.cause)}`);
  if (error?.stack) details.push(`Stack：\n${error.stack}`);
  if (details.length) return details.join('\n');
  try {
    const json = JSON.stringify(error, null, 2);
    if (json && json !== '{}') return json;
  } catch {}
  return String(error);
}

export async function readImageMetadata(inputText) {
  try {
    const pathText = String(inputText ?? '').trim();
    if (!pathText) throw new Error('請先貼上圖片路徑');

    const inputPath = resolve(pathText);
    const inputFile = Bun.file(inputPath);
    if (!await inputFile.exists()) throw new Error(`找不到輸入檔：${inputPath}`);

    const metadata = await new Bun.Image(inputFile).metadata();
    return { ok: true, inputPath, metadata };
  } catch (error) {
    return { ok: false, error: describeBackendError(error) };
  }
}

export async function resizeImage(options = {}) {
  try {
    const inputText = String(options.inputPath ?? '').trim();
    if (!inputText) throw new Error('請先貼上圖片路徑');

    const inputPath = resolve(inputText);
    const inputFile = Bun.file(inputPath);
    if (!await inputFile.exists()) throw new Error(`找不到輸入檔：${inputPath}`);

    const width = integer(options.width, '寬度');
    const height = integer(options.height, '高度', { optional: true });
    const fit = options.fit === 'fill' ? 'fill' : 'inside';
    const filters = new Set([
      'nearest', 'box', 'bilinear', 'linear', 'cubic', 'mitchell',
      'lanczos2', 'lanczos3', 'mks2013', 'mks2021',
    ]);
    const filter = filters.has(options.filter) ? options.filter : 'lanczos3';
    const rotate = [0, 90, 180, 270].includes(options.rotate) ? options.rotate : 0;
    const brightness = finite(options.brightness, '亮度');
    const saturation = finite(options.saturation, '飽和度');
    const format = options.format === 'png' ? 'png' : 'jpeg';

    let image = new Bun.Image(inputFile, { autoOrient: options.autoOrient !== false });
    if (rotate) image = image.rotate(rotate);
    if (options.flip) image = image.flip();
    if (options.flop) image = image.flop();
    image = image.resize(width, height, {
      fit,
      filter,
      withoutEnlargement: Boolean(options.withoutEnlargement),
    });
    if (brightness !== 1 || saturation !== 1)
      image = image.modulate({ brightness, saturation });

    const originalName = basename(inputPath, extname(inputPath));
    const outputPath = join(dirname(inputPath), `${originalName}.resized.${format === 'jpeg' ? 'jpg' : 'png'}`);

    if (format === 'jpeg') {
      image = image.jpeg({
        quality: integer(options.jpegQuality, 'JPEG 品質', { min: 1, max: 100 }),
        progressive: Boolean(options.progressive),
      });
    } else {
      const palette = Boolean(options.pngPalette);
      const pngOptions = {
        compressionLevel: integer(options.pngCompression, 'PNG 壓縮等級', { min: 0, max: 9 }),
        palette,
      };
      if (palette) {
        pngOptions.colors = integer(options.pngColors, 'PNG 調色盤色數', { min: 2, max: 256 });
        pngOptions.dither = Boolean(options.pngDither);
      }
      image = image.png(pngOptions);
    }

    const bytes = await image.write(outputPath);
    const metadata = await new Bun.Image(outputPath).metadata();
    return { ok: true, outputPath, bytes, width: metadata.width, height: metadata.height };
  } catch (error) {
    return { ok: false, error: describeBackendError(error) };
  }
}
```
