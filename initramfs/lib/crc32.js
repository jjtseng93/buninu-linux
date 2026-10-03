// /lib/crc32.js — the CRC-32 of zip, gzip and GPT (IEEE 802.3, reflected,
// polynomial 0xEDB88320).

const table = new Uint32Array(256);
for (let index = 0; index < 256; index++) {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  table[index] = value >>> 0;
}

/** CRC-32 of `bytes`, continuing from `previous` (the CRC of what came before). */
export const crc32 = (bytes, previous = 0) => {
  let crc = ~previous >>> 0;
  for (let index = 0; index < bytes.length; index++) crc = table[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  return ~crc >>> 0;
};
