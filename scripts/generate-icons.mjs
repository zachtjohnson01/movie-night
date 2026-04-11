// Generates PWA icons (192, 512) and an Apple touch icon (180) as PNG files
// using only Node built-ins (no ImageMagick, no sharp). Outputs:
//   public/icons/icon-192.png
//   public/icons/icon-512.png
//   public/apple-touch-icon.png
//
// The design: dark rounded square background, amber circle outline, amber
// play triangle centered inside.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const BG = [0x0b, 0x0b, 0x0f, 0xff];
const AMBER = [0xff, 0xb3, 0x47, 0xff];

function createImage(size) {
  const buf = Buffer.alloc(size * size * 4);
  const r = size * 0.22; // corner radius
  const cx = size / 2;
  const cy = size / 2;
  const ringOuter = size * 0.38;
  const ringInner = size * 0.33;
  // Play triangle: isoceles pointing right, centered on (cx,cy)
  const triHalfH = size * 0.17;
  const triW = size * 0.24;
  const triLeft = cx - triW * 0.35;
  const triRight = triLeft + triW;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;

      // Rounded square mask
      if (!insideRoundedRect(x, y, size, size, r)) {
        buf[idx] = 0;
        buf[idx + 1] = 0;
        buf[idx + 2] = 0;
        buf[idx + 3] = 0;
        continue;
      }

      let c = BG;

      // Circle ring
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d <= ringOuter && d >= ringInner) c = AMBER;

      // Play triangle
      if (x >= triLeft && x <= triRight) {
        const t = (x - triLeft) / triW; // 0..1
        const h = triHalfH * (1 - t);
        if (dy >= -h && dy <= h) c = AMBER;
      }

      buf[idx] = c[0];
      buf[idx + 1] = c[1];
      buf[idx + 2] = c[2];
      buf[idx + 3] = c[3];
    }
  }
  return buf;
}

function insideRoundedRect(x, y, w, h, r) {
  if (x < 0 || y < 0 || x >= w || y >= h) return false;
  // Distances from nearest corner
  const rx = x < r ? r - x : x > w - 1 - r ? x - (w - 1 - r) : 0;
  const ry = y < r ? r - y : y > h - 1 - r ? y - (h - 1 - r) : 0;
  return rx * rx + ry * ry <= r * r;
}

// --- PNG encoder (8-bit RGBA, no interlace) ---

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = makeCrcTable());
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeCrcTable() {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(rgba, size) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // Add filter byte (0 = None) at start of each scanline
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(raw);

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function write(size, outPath) {
  const rgba = createImage(size);
  const png = encodePng(rgba, size);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, png);
  console.log(`wrote ${outPath} (${png.length} bytes)`);
}

write(192, resolve(repoRoot, 'public/icons/icon-192.png'));
write(512, resolve(repoRoot, 'public/icons/icon-512.png'));
write(180, resolve(repoRoot, 'public/apple-touch-icon.png'));
