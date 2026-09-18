```text#myid @keydown.prevent="handle(event)"
hello
```

```js front
export function handle(e)
{
  alert(JSON.stringify(e,null,1))
}
```
