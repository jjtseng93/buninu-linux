import { realpathSync, statSync, lstatSync, readlinkSync } from 'node:fs';
import { posix, resolve } from 'node:path';

export function parseChrootArguments(argv, env = process.env) {
  const options = { mount: true, keep: false, verbose: false, binds: [] };
  let positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') { positional = argv.slice(i + 1); break; }
    if (arg === '-h' || arg === '--help') return { options, positional, help: true };
    if (arg === '-n' || arg === '--no-mount') options.mount = false;
    else if (arg === '-k' || arg === '--keep-mounts') options.keep = true;
    else if (arg === '-v' || arg === '--verbose') options.verbose = true;
    else if (arg === '-b' || arg === '--bind') {
      if (++i >= argv.length || !argv[i] || argv[i].startsWith('-')) throw Error(`${arg} requires HOST[:GUEST]`);
      options.binds.push(argv[i]);
    } else if (arg.startsWith('--bind=')) {
      if (!arg.slice(7)) throw Error('--bind requires HOST[:GUEST]');
      options.binds.push(arg.slice(7));
    } else if (arg === '--shared-tmp') {
      if (!env.TMPDIR) throw Error('--shared-tmp requires TMPDIR to be set');
      options.binds.push(`${env.TMPDIR}:/tmp`);
    } else if (arg.startsWith('-') && arg.length > 1) throw Error(`unknown option ${arg}`);
    else { positional = argv.slice(i); break; }
  }
  return { options, positional, help: false };
}

export function resolveBindings(specs, cwd = process.cwd()) {
  const bindings = new Map();
  for (const spec of specs) {
    const colon = spec.indexOf(':');
    const host = colon < 0 ? spec : spec.slice(0, colon);
    const guest = colon < 0 ? resolve(cwd, host) : spec.slice(colon + 1);
    if (!host || !guest || host.includes('\0') || guest.includes('\0')) throw Error(`invalid bind: ${spec}`);
    if (!posix.isAbsolute(guest)) throw Error(`bind guest path must be absolute: ${guest}`);
    const inside = posix.normalize(guest);
    if (inside === '/') throw Error('bind destination must not replace the chroot root');
    const source = realpathSync(resolve(cwd, host));
    bindings.set(inside, { inside, source, file: !statSync(source).isDirectory() });
  }
  // Parents must be mounted before children. For a repeated destination, the
  // last argument wins, including --shared-tmp versus an explicit /tmp bind.
  return [...bindings.values()].sort((a, b) => a.inside.split('/').length - b.inside.split('/').length);
}

// Resolve guest symlinks as chroot would: absolute links start at NEWROOT,
// never at the host's /. Missing suffixes are created by the mount caller.
export function resolveGuestPath(root, inside) {
  const todo = inside.split('/'), parts = [];
  let links = 0;
  while (todo.length) {
    const part = todo.shift();
    if (!part || part === '.') continue;
    if (part === '..') { parts.pop(); continue; }
    const candidate = `${root}/${[...parts, part].join('/')}`;
    let entry;
    try { entry = lstatSync(candidate); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (entry?.isSymbolicLink()) {
      if (++links > 40) throw Error(`too many symlinks in bind destination: ${inside}`);
      const target = readlinkSync(candidate);
      if (target.startsWith('/')) parts.length = 0;
      todo.unshift(...target.split('/'));
    } else parts.push(part);
  }
  if (!parts.length) throw Error('bind destination resolves to the chroot root');
  return '/' + parts.join('/');
}
