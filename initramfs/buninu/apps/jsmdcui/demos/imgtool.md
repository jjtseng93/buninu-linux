#!/usr/bin/env jsmdcui

# Bun.Image Processor

Paste the path to a local image below (for example, `/home/me/photo.jpg`). The output file will be written next to the source as `original.resized.jpg` or `original.resized.png`; the source image will not be overwritten.

```text#image-path
demo.jpg
```

- [Read image metadata](javascript:readMetadata())
- .
- [Jump to Write Button](#processing-result)

```text#image-metadata
Metadata has not been read
```

## Common Options

| Option | Value | Change |
| --- | --- | --- |
| Width | 800 | [−100](javascript:adjustCell(this,-100,1)) · [+100](javascript:adjustCell(this,100,1)) |
| Height | auto | [Auto / 600 / 1080](javascript:cycleCell(this,['auto','600','1080'])) |
| Preserve aspect ratio | [x] Enabled | [Toggle](javascript:toggleCell(this)) |
| Rotate | 0 | [Next 90°](javascript:cycleCell(this,['0','90','180','270'])) |
| Do not enlarge | [x] Enabled | [Toggle](javascript:toggleCell(this)) |
| Auto orient | [x] Enabled | [Toggle](javascript:toggleCell(this)) |

## Advanced Options

| Option | Value | Change |
| --- | --- | --- |
| Filter | lanczos3 | [Next](javascript:cycleCell(this,['lanczos3','lanczos2','mitchell','cubic','mks2013','mks2021','bilinear','linear','box','nearest'])) |
| Brightness | 1 | [−0.1](javascript:adjustCell(this,-0.1,0)) · [+0.1](javascript:adjustCell(this,0.1,0)) |
| Saturation | 1 | [−0.1](javascript:adjustCell(this,-0.1,0)) · [+0.1](javascript:adjustCell(this,0.1,0)) |
| Flip vertically | [ ] Enabled | [Toggle](javascript:toggleCell(this)) |
| Flip horizontally | [ ] Enabled | [Toggle](javascript:toggleCell(this)) |

## Output Options

| Option | Value | Change |
| --- | --- | --- |
| Format | JPEG | [JPEG / PNG](javascript:cycleCell(this,['JPEG','PNG'])) |
| JPEG quality | 80 | [−5](javascript:adjustCell(this,-5,1,100)) · [+5](javascript:adjustCell(this,5,1,100)) |
| Progressive JPEG | [ ] Enabled | [Toggle](javascript:toggleCell(this)) |
| PNG compression | 6 | [−1](javascript:adjustCell(this,-1,0,9)) · [+1](javascript:adjustCell(this,1,0,9)) |
| PNG palette | [ ] Enabled | [Toggle](javascript:toggleCell(this)) |
| Palette colors | 256 | [−16](javascript:adjustCell(this,-16,2,256)) · [+16](javascript:adjustCell(this,16,2,256)) |
| PNG dither | [x] Enabled | [Toggle](javascript:toggleCell(this)) |

## Final step
- [Jump to Top](#bunimage-processor)
- .
- [Process and write image](javascript:resizeAndWrite())

## Processing Result

```text#write-status
Not started
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
  if (error == null) return 'Unknown error (no error details were returned)';
  if (typeof error === 'string') return error;
  const details = [];
  if (error?.code) details.push(`Code: ${error.code}`);
  if (error?.name && error.name !== 'Error') details.push(`Type: ${error.name}`);
  if (error?.message) details.push(`Message: ${error.message}`);
  if (error?.error && error.error !== error) details.push(`Error: ${describeError(error.error)}`);
  if (error?.cause && error.cause !== error) details.push(`Cause: ${describeError(error.cause)}`);
  if (error?.stack && String(error.stack) !== String(error.message ?? ''))
    details.push(`Stack: ${error.stack}`);
  if (details.length) return details.join('\n');
  try {
    const json = JSON.stringify(error, null, 2);
    if (json && json !== '{}') return json;
  } catch {}
  return String(error);
}

export async function readMetadata() {
  const output = $('#image-metadata');
  output.val('Reading metadata…');

  try {
    const inputPath = $('#image-path').val().trim();
    const result = await rpc.readImageMetadata(inputPath);
    if (!result || typeof result !== 'object' || result.ok !== true) {
      const error = result && typeof result === 'object' && 'error' in result
        ? result.error
        : result;
      output.val(`Metadata read failed:\n${describeError(error)}`);
      return;
    }
    output.val(`Metadata for: ${result.inputPath}\n${JSON.stringify(result.metadata, null, 2)}`);
  } catch (error) {
    output.val(`Metadata read failed:\n${describeError(error)}`);
  }
}

export async function resizeAndWrite() {
  const status = $('#write-status');
  status.val('Processing…');
  let options;

  try {
    options = {
      inputPath: $('#image-path').val().trim(),
      width: optionText('common-options', 1),
      height: optionText('common-options', 2).toLowerCase() === 'auto'
        ? ''
        : optionText('common-options', 2),
      fit: optionChecked('common-options', 3) ? 'inside' : 'fill',
      rotate: Number.parseInt(optionText('common-options', 4), 10),
      withoutEnlargement: optionChecked('common-options', 5),
      autoOrient: optionChecked('common-options', 6),
      filter: optionText('advanced-options', 1).toLowerCase(),
      brightness: optionText('advanced-options', 2),
      saturation: optionText('advanced-options', 3),
      flip: optionChecked('advanced-options', 4),
      flop: optionChecked('advanced-options', 5),
      format: optionText('output-options', 1).toLowerCase(),
      jpegQuality: optionText('output-options', 2),
      progressive: optionChecked('output-options', 3),
      pngCompression: optionText('output-options', 4),
      pngPalette: optionChecked('output-options', 5),
      pngColors: optionText('output-options', 6),
      pngDither: optionChecked('output-options', 7),
    };
    const result = await rpc.resizeImage(options);

    if (!result || typeof result !== 'object' || result.ok !== true) {
      const error = result && typeof result === 'object' && 'error' in result
        ? result.error
        : result;
      status.val(`Write failed:\n${describeError(error)}\nOptions read:\n${JSON.stringify(options, null, 2)}`);
      return;
    }

    status.val(`Successfully wrote: ${result.outputPath}\n${result.width}×${result.height}, ${result.bytes} bytes\nOptions read:\n${JSON.stringify(options, null, 2)}`);
  } catch (error) {
    const optionText = options ? `\nOptions read:\n${JSON.stringify(options, null, 2)}` : '';
    status.val(`Write failed:\n${describeError(error)}${optionText}`);
  }
}
```

```js back
import { dirname, extname, join, basename, resolve } from 'node:path';

function integer(value, name, { min = 1, max = Number.MAX_SAFE_INTEGER, optional = false } = {}) {
  if (optional && String(value ?? '').trim() === '') return undefined;
  const result = Number(value);
  if (!Number.isInteger(result) || result < min || result > max)
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  return result;
}

function finite(value, name, { min = 0 } = {}) {
  const result = Number(value);
  if (!Number.isFinite(result) || result < min)
    throw new Error(`${name} must be a number greater than or equal to ${min}`);
  return result;
}

function describeBackendError(error) {
  if (error == null) return 'Unknown error (no error details were returned)';
  if (typeof error === 'string') return error;
  const details = [];
  if (error?.code) details.push(`[${error.code}]`);
  if (error?.name && error.name !== 'Error') details.push(error.name);
  if (error?.message) details.push(error.message);
  if (error?.cause && error.cause !== error)
    details.push(`Cause: ${describeBackendError(error.cause)}`);
  if (error?.stack) details.push(`Stack:\n${error.stack}`);
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
    if (!pathText) throw new Error('Paste an image path first');

    const inputPath = resolve(pathText);
    const inputFile = Bun.file(inputPath);
    if (!await inputFile.exists()) throw new Error(`Input file not found: ${inputPath}`);

    const metadata = await new Bun.Image(inputFile).metadata();
    return { ok: true, inputPath, metadata };
  } catch (error) {
    return { ok: false, error: describeBackendError(error) };
  }
}

export async function resizeImage(options = {}) {
  try {
    const inputText = String(options.inputPath ?? '').trim();
    if (!inputText) throw new Error('Paste an image path first');

    const inputPath = resolve(inputText);
    const inputFile = Bun.file(inputPath);
    if (!await inputFile.exists()) throw new Error(`Input file not found: ${inputPath}`);

    const width = integer(options.width, 'Width');
    const height = integer(options.height, 'Height', { optional: true });
    const fit = options.fit === 'fill' ? 'fill' : 'inside';
    const filters = new Set([
      'nearest', 'box', 'bilinear', 'linear', 'cubic', 'mitchell',
      'lanczos2', 'lanczos3', 'mks2013', 'mks2021',
    ]);
    const filter = filters.has(options.filter) ? options.filter : 'lanczos3';
    const rotate = [0, 90, 180, 270].includes(options.rotate) ? options.rotate : 0;
    const brightness = finite(options.brightness, 'Brightness');
    const saturation = finite(options.saturation, 'Saturation');
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
        quality: integer(options.jpegQuality, 'JPEG quality', { min: 1, max: 100 }),
        progressive: Boolean(options.progressive),
      });
    } else {
      const palette = Boolean(options.pngPalette);
      const pngOptions = {
        compressionLevel: integer(options.pngCompression, 'PNG compression level', { min: 0, max: 9 }),
        palette,
      };
      if (palette) {
        pngOptions.colors = integer(options.pngColors, 'PNG palette color count', { min: 2, max: 256 });
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
