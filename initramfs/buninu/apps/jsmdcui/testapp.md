# jsmdcui
# hello
- world
- 你好 世界 😅
- Bun JavaScript
- [example](https://example.com)
- [Hello! Click Me](javascript:alert('world'))
- [myfunc 請按我](javascript:myfunc())
- [Print process.argv](javascript:pav())
- [Calculator🧮計算機](javascript:calc())
  * Use cos sin PI directly
- [Show ↓ text](javascript:alert($('text').val()))

```text
Text edit. TUI: Click ↙ to inc lines ↖ to dec
可編輯文字框 TUI：按↙擴充行數 ↖減少行數
```
## Question 問題
- What is 1+2+3+4+..+..+∞

```text#ans
-1/12
```
- [Submit 提交](javascript:checkAns())

## Task list
- [X] task1
- [ ] task2

```js front
export async function myfunc()
{
  let yn=confirm('😃 Are you happy? 你開心嗎？')
  alert(
    yn ? 'Great 太棒了':
         'Sorry to hear that. 很遺憾聽到你這麼說'
  );
}

export async function pav()
{
  let r=await rpc.getArgv();
  alert(r)
}

export async function calc()
{
  let s = prompt('Enter an expression 輸入運算式：')
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const result = await new AsyncFunction('rpc',...Object.getOwnPropertyNames(Math),
    `return await (${s});` 
  )(rpc,...Object.getOwnPropertyNames(Math).map(i=>Math[i]))
  alert(
  
    'Result 結果：'+
    result
    
  );
}

export function checkAns()
{
  if($('#ans').val().trim()=='-1/12')
    $('#ans').val('答對🥳Right!');
  else
    $('#ans').val('答錯😫Wrong!');
}

```


```js back

export function getArgv()
{
  return process.argv ;
}
```
