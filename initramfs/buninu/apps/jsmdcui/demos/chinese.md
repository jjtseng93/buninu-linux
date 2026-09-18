#!/usr/bin/env jsmdcui

# 純中文程式
- 目的是要可以輸入文字 然後送出

```text#輸入 @keydown="handle(event)"
Dr. John (醫者小智)
```

- [Submit 提交](javascript:handle())

```js front
export function handle(e)
{
  if(!e)
  {
    alert( "Hello from Submit!\n  "+$('#輸入').val() )
    return
  }

  //alert("***"+e?.key+"***");
  
  if(e.key=="Enter")
  {
    e.preventDefault()
    
    alert( "Hello from Enter!\n  "+e.target?.value)
    return
  }
  
}
```
