#!/bin/sh

':' //; sd=$(dirname "$(realpath "$0")")

':' //; exec bun "$sd"/src/index.js "$@"

console.log(Bun.argv)

if(Bun.argv[2]=='--jsgotty')
{
  Bun.argv.splice(2,1);
  let m=await import('../../wgotty/gotty.js');
  m.bootstrap()
}
else
  await import('../src/index.js');
