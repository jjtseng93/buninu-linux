// /proc/meminfo reports KiB. Cache is informational, not all reclaimable.
export function memoryText(memory) {
  const total = memory.MemTotal ?? 0;
  const free = memory.MemFree ?? 0;
  const available = memory.MemAvailable;
  // Old kernels without MemAvailable: conservatively count everything not
  // free as used, and do not present that fallback as a kernel estimate.
  const used = Math.max(0, total - (available ?? free));
  const cache = (memory.Buffers ?? 0) + (memory.Cached ?? 0) + (memory.SReclaimable ?? 0);
  const mib = (value) => (value / 1024).toFixed(1);
  return `MiB Mem : ${mib(total)} total, ${mib(free)} free, ${mib(used)} used, ${mib(cache)} buff/cache, ${available == null ? "n/a" : mib(available)} available`;
}
