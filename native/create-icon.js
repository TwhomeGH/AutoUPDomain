// Reproducible code-native app icon, no external assets or build dependencies.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
const size = 256;
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const bytes = Buffer.concat([Buffer.from(type), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(bytes));
  return Buffer.concat([length, bytes, crc]);
}
const pixels = Buffer.alloc(size * (size * 4 + 1));
for (let y = 0; y < size; y++)
  for (let x = 0; x < size; x++) {
    const dx = x - 128,
      dy = y - 128,
      r = Math.hypot(dx, dy);
    const globe =
      Math.abs(r - 78) < 5 ||
      (r < 78 && (Math.abs(dy) < 4 || Math.abs(Math.hypot(dx * 2.2, dy) - 78) < 5));
    const i = y * (size * 4 + 1) + 1 + x * 4;
    const color = globe ? [233, 249, 238, 255] : r < 120 ? [33, 100, 80, 255] : [0, 0, 0, 0];
    color.forEach((value, offset) => {
      pixels[i + offset] = value;
    });
  }
const header = Buffer.alloc(13);
header.writeUInt32BE(size);
header.writeUInt32BE(size, 4);
header[8] = 8;
header[9] = 6;
writeFileSync(
  new URL('./icon.png', import.meta.url),
  Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]),
);

const png = (await import('node:fs')).readFileSync(new URL('./icon.png', import.meta.url));
const ico = Buffer.alloc(22);
ico.writeUInt16LE(1, 2);
ico.writeUInt16LE(1, 4);
ico.writeUInt16LE(1, 10);
ico.writeUInt16LE(32, 12);
ico.writeUInt32LE(png.length, 14);
ico.writeUInt32LE(22, 18);
writeFileSync(new URL('./icon.ico', import.meta.url), Buffer.concat([ico, png]));
