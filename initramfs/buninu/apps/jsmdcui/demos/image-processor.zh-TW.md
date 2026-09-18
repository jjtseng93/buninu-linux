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

## 尺寸

寬度（必填，正整數）：

```text#resize-width
800
```

高度（留白會保持原始長寬比）：

```text#resize-height

```

## Select Fit

- [ ] fill（精確填滿寬高，可能變形）
- [x] inside（保持比例，縮放到指定範圍內）

## Select Filter

- [x] lanczos3（照片通用，預設）
- [ ] lanczos2（較柔和、較少光暈）
- [ ] mitchell（平滑漸層）
- [ ] cubic（較銳利）
- [ ] mks2013（Magic Kernel Sharp）
- [ ] mks2021（Magic Kernel Sharp）
- [ ] bilinear（快速、柔和）
- [ ] linear（快速、柔和）
- [ ] box（大倍率整數縮小）
- [ ] nearest（像素圖、硬邊緣）

## Select Without Enlargement

- [x] yes（不放大較小的原圖）
- [ ] no（允許放大）

## 方向與翻轉

## Select Auto Orient

- [x] yes（依 JPEG EXIF 自動校正方向）
- [ ] no

## Select Rotate

- [x] 0°
- [ ] 90°
- [ ] 180°
- [ ] 270°

## Select Flip

- [ ] yes（上下翻轉）
- [x] no

## Select Flop

- [ ] yes（左右翻轉）
- [x] no

## 色彩

亮度倍率（`1` 不變）：

```text#brightness
1
```

飽和度倍率（`0` 灰階、`1` 不變、大於 `1` 增豔）：

```text#saturation
1
```

## Select Output Format

- [x] JPEG (.jpg)
- [ ] PNG (.png)

## JPEG 選項

品質（`1`–`100`，預設 `80`）：

```text#jpeg-quality
80
```

## Select Progressive JPEG

- [ ] yes
- [x] no

## PNG 選項

壓縮等級（`0`–`9`，預設 `6`）：

```text#png-compression
6
```

## Select PNG Palette

- [ ] yes（索引色 PNG）
- [x] no（全彩 PNG）

調色盤色數（啟用 Palette 時使用，`2`–`256`）：

```text#png-colors
256
```

## Select PNG Dither

- [x] yes
- [ ] no

## 最後一步
- [跳到頂端](#bunimage-processor)
- .
- [處理並寫入圖片](javascript:resizeAndWrite())

## 寫入狀態

```text#write-status
尚未執行
```

```js front
function firstWord(value) {
  return String(value ?? '').trim().split(/\s+/)[0].toLowerCase();
}

function includesChoice(id, choices, fallback) {
  const value = String($('#' + id).val() ?? '').toLowerCase();
  return choices.find(choice => value.includes(choice)) ?? fallback;
}

function yes(id) {
  return String($('#' + id).val() ?? '').toLowerCase().includes('yes');
}

function numberText(id) {
  return $('#' + id).val().trim();
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
      width: numberText('resize-width'),
      height: numberText('resize-height'),
      fit: includesChoice('select-fit', ['fill', 'inside'], 'inside'),
      filter: includesChoice('select-filter', [
        'nearest', 'box', 'bilinear', 'cubic', 'mitchell',
        'lanczos2', 'lanczos3', 'mks2013', 'mks2021', 'linear',
      ], 'lanczos3'),
      withoutEnlargement: yes('select-without-enlargement'),
      autoOrient: yes('select-auto-orient'),
      rotate: Number.parseInt(firstWord($('#select-rotate').val()), 10),
      flip: yes('select-flip'),
      flop: yes('select-flop'),
      brightness: numberText('brightness'),
      saturation: numberText('saturation'),
      format: includesChoice('select-output-format', ['png', 'jpeg'], 'jpeg'),
      jpegQuality: numberText('jpeg-quality'),
      progressive: yes('select-progressive-jpeg'),
      pngCompression: numberText('png-compression'),
      pngPalette: yes('select-png-palette'),
      pngColors: numberText('png-colors'),
      pngDither: yes('select-png-dither'),
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
