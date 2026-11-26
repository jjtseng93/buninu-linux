import {test, expect} from 'bun:test';
import {windowsOpenCommand} from '../windows-command.js';
test('CMD command source contains no target, with expansion and autorun disabled', () => {
  const target='https://example.invalid/?a=中文 &b=%PATH%&c=!var!^()';
  const command=windowsOpenCommand(target,{ComSpec:'C:\\Windows\\System32\\cmd.exe',Path:'unchanged',buninu_open_target:'old'});
  expect(command.cmd).toEqual(['C:\\Windows\\System32\\cmd.exe','/d','/v:off','/s','/c','start "" "%BUNINU_OPEN_TARGET%"']);
  expect(command.env).toEqual({ComSpec:'C:\\Windows\\System32\\cmd.exe',Path:'unchanged',BUNINU_OPEN_TARGET:target});
  expect(command.windowsVerbatimArguments).toBe(true);
});
test('URL quotes/newlines are encoded; invalid file paths fail before spawning',()=>{
  expect(windowsOpenCommand('http://localhost/a"b\r\nc').env.BUNINU_OPEN_TARGET).toBe('http://localhost/a%22b%0D%0Ac');
  expect(()=>windowsOpenCommand('C:\\a"b')).toThrow();
  expect(()=>windowsOpenCommand('a\nb')).toThrow();
  expect(()=>windowsOpenCommand('http://localhost/\0')).toThrow();
});
