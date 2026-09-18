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

## Dimensions

Width (required, positive integer):

```text#resize-width
800
```

Height (leave blank to preserve the source aspect ratio):

```text#resize-height

```

## Select Fit

- [ ] fill (stretch to the exact width and height; may distort the image)
- [x] inside (preserve the aspect ratio and fit within the dimensions)

## Select Filter

- [x] lanczos3 (general-purpose and sharp for photos; default)
- [ ] lanczos2 (slightly softer with fewer ringing artifacts)
- [ ] mitchell (smooth gradients)
- [ ] cubic (sharper, but may produce ringing)
- [ ] mks2013 (Magic Kernel Sharp)
- [ ] mks2021 (Magic Kernel Sharp)
- [ ] bilinear (fast and soft)
- [ ] linear (fast and soft)
- [ ] box (area-average; useful for large integer downscales)
- [ ] nearest (pixel art and hard edges)

## Select Without Enlargement

- [x] yes (do not enlarge a smaller source image)
- [ ] no (allow enlargement)

## Orientation and mirroring

## Select Auto Orient

- [x] yes (apply the JPEG EXIF orientation automatically)
- [ ] no

## Select Rotate

- [x] 0°
- [ ] 90°
- [ ] 180°
- [ ] 270°

## Select Flip

- [ ] yes (mirror vertically)
- [x] no

## Select Flop

- [ ] yes (mirror horizontally)
- [x] no

## Color

Brightness multiplier (`1` leaves brightness unchanged):

```text#brightness
1
```

Saturation multiplier (`0` produces greyscale, `1` is unchanged, and values above `1` increase saturation):

```text#saturation
1
```

## Select Output Format

- [x] JPEG (.jpg)
- [ ] PNG (.png)

## JPEG Options

Quality (`1`–`100`; default `80`):

```text#jpeg-quality
80
```

## Select Progressive JPEG

- [ ] yes
- [x] no

## PNG Options

Compression level (`0`–`9`; default `6`):

```text#png-compression
6
```

## Select PNG Palette

- [ ] yes (indexed-color PNG)
- [x] no (full-color PNG)

Palette color count (used when Palette is enabled; `2`–`256`):

```text#png-colors
256
```

## Select PNG Dither

- [x] yes
- [ ] no

## Final step
- [Jump to Top](#bunimage-processor)
- .
- [Process and write image](javascript:resizeAndWrite())

## Processing Result

```text#write-status
Not started
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
