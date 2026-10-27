// Only buffers created by our mmap reader may be detached. Ordinary buffers,
// pooled Buffer slabs and callers' pixel arrays retain their normal lifetime.
const mappings = new WeakMap();

export function ownMapping(bytes) {
  const buffer = bytes.buffer;
  if (mappings.has(buffer)) throw Error('mapping already owned');
  mappings.set(buffer, {refs: 0});
  return retainMapping(bytes);
}

export function retainMapping(bytes) {
  const buffer = bytes?.buffer;
  const state = buffer && mappings.get(buffer);
  if (!state) return null;
  state.refs++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--state.refs) return;
    mappings.delete(buffer);
    // Transfer to zero bytes runs Bun's mmap deallocator immediately, rather
    // than batching many full frames into a later GC pause. Older runtimes or
    // non-detachable buffers safely fall back to ordinary GC reclamation.
    try { buffer.transfer?.(0); } catch {}
  };
}
