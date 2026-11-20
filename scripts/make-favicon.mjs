import sharp from 'sharp';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(root, 'public/assets/favicon.png');
const out = join(root, 'public/favicon.ico');

const sizes = [16, 32, 48];
const pngBuffers = await Promise.all(
  sizes.map((s) => sharp(src).resize(s, s, { fit: 'cover' }).png().toBuffer()),
);

function writeIco(buffers) {
  const count = buffers.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);

  let offset = 6 + count * 16;
  const entries = [];
  const images = [];

  for (let i = 0; i < count; i++) {
    const buf = buffers[i];
    const size = sizes[i];
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size === 256 ? 0 : size, 0);
    entry.writeUInt8(size === 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(buf.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    images.push(buf);
    offset += buf.length;
  }

  return Buffer.concat([header, ...entries, ...images]);
}

writeFileSync(out, writeIco(pngBuffers));
console.log(`favicon.ico ${sizes.join('/')}px`);