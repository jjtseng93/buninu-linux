import {expect,test} from 'bun:test';
import {nextVirtualTerminal} from '../initramfs/lib/bunterm/vt.js';
test('new bunterm appends after known sessions and reserves the initial console',()=>{
 expect(nextVirtualTerminal([])).toBe(2);
 expect(nextVirtualTerminal([{number:1}])).toBe(2);
 expect(nextVirtualTerminal([{number:1},{number:2},{number:6}])).toBe(7);
 expect(nextVirtualTerminal([{number:4}])).toBe(5);
 expect(()=>nextVirtualTerminal([{number:63}])).toThrow('No next tty');
});
