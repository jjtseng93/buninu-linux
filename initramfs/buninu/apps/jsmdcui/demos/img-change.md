
# myimg 我的圖片
````md template
---
img: ""
---
${data.img ? '![demo](' + data.img + ')' : 'Loading image…'}
````

- [Click to swap pictures](javascript:handle())

- [點擊切換圖片😼](javascript:handle())

```js front

let imageSources = []
let imageIndex = 0

export async function onMdcuiLoad()
{
  imageSources = await rpc.readDemoImageDataUrls()
  imageIndex = 0
  if (imageSources.length > 0)
    $('#myimg').data('img', imageSources[imageIndex])
}

export function handle()
{
  if (imageSources.length < 2) return
  imageIndex = (imageIndex + 1) % imageSources.length
  $('#myimg').data('img', imageSources[imageIndex])
}

```

```js back
import {join,dirname} from "node:path"

function internalAssetBytes(path)
{
  const key = String(path).replaceAll('\\', '/').replace(/^\.\//, '')
  const store = globalThis.internalAssets
  const value = store instanceof Map
    ? store.get(key)
    : store && typeof store === 'object'
      ? store[key]
      : null
  if (value == null) return null
  if (value instanceof Uint8Array) return value
  if (ArrayBuffer.isView(value))
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  return new TextEncoder().encode(String(value))
}

async function readAssetBytes(path)
{
  const internal = internalAssetBytes(path)
  if (internal) return internal
  const externalUrl = join(dirname(Bun.main),'..',path)
  return new Uint8Array(await Bun.file(externalUrl).arrayBuffer())
}

export async function readDemoImageDataUrls()
{
  const paths = ['demos/basic.jpg', 'demos/good.jpg']
  return await Promise.all(paths.map(async path => {
    const bytes = await readAssetBytes(path)
    return `data:image/jpeg;base64,${Buffer.from(bytes).toString('base64')}`
  }))
}

```
