// Keep user data out of CMD source. Percent expansion is single-pass (no CALL),
// delayed expansion is disabled, and the expanded value stays inside quotes.
export function windowsOpenCommand(target, env = process.env) {
  if (target.includes('\0')) throw new Error('NUL is not allowed in an open target');
  if (/["\r\n]/.test(target)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) && !/^[a-z]:[\\/]/i.test(target))
      target = target.replaceAll('"', '%22').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
    else throw new Error('Quotes and newlines are not valid Windows file paths');
  }
  const childEnv = { ...env };
  for (const key of Object.keys(childEnv))
    if (key.toUpperCase() === 'BUNINU_OPEN_TARGET') delete childEnv[key];
  childEnv.BUNINU_OPEN_TARGET = target;
  return {
    cmd: [env.ComSpec || env.COMSPEC || 'cmd.exe', '/d', '/v:off', '/s', '/c',
      'start "" "%BUNINU_OPEN_TARGET%"'],
    env: childEnv,
    windowsVerbatimArguments: true,
    stdout: 'ignore', stderr: 'ignore',
  };
}
