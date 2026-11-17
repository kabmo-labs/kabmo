/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Generate the tray's monochrome glyphs.
 *
 * The tray host is a separate process and cannot read the page's CSS, so the
 * monochrome icon has to be a FILE. Two are shipped because a single ink cannot
 * be visible on both a light and a dark panel: `-light` is the black glyph for a
 * light panel, `-dark` the white one for a dark panel. macOS ignores the colour
 * (it draws the image as a template and paints it in the menu bar's own ink);
 * Windows and Linux use the variant that matches the active theme.
 *
 * The geometry is the K mark from `public/icon.svg`, read from that file rather
 * than restated here — the same rule `scripts/shell-wordmark.mjs` follows. The
 * plate is deliberately absent: a monochrome tray icon is the glyph, not a
 * filled square.
 *
 *   bun run scripts/tray-icon.mjs           # write
 *   bun run scripts/tray-icon.mjs --check   # exit 1 when stale
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const ROOT = join(import.meta.dir, '..');
const SVG = join(ROOT, 'public/icon.svg');
const SIZE = 64;
const SUPERSAMPLE = 4;

/** The K's three segments, read from the icon SVG's own path data. */
function readSegments() {
  const svg = readFileSync(SVG, 'utf8');
  const group = svg.match(/<g fill="none" stroke-width="([\d.]+)"[^>]*>/);
  if (!group) throw new Error('the icon SVG has no stroke group');
  const width = Number(group[1]);
  const paths = [...svg.matchAll(/<path d="([^"]+)"/g)].map((match) => match[1]);
  if (paths.length !== 3) throw new Error(`expected three K strokes, found ${paths.length}`);

  const segments = paths.map((d) => {
    const numbers = d.match(/-?[\d.]+/g)?.map(Number) ?? [];
    if (numbers.length === 4) {
      // `M20 15v34` → M x y v dy, and `M20 32 42 15` → M x y L x y.
      return { x1: numbers[0], y1: numbers[1], x2: numbers[2], y2: numbers[3] };
    }
    if (numbers.length === 3) {
      // `M20 15v34` is M x y v dy: the second point shares x.
      return { x1: numbers[0], y1: numbers[1], x2: numbers[0], y2: numbers[1] + numbers[2] };
    }
    throw new Error(`unexpected path data: ${d}`);
  });
  return { width, segments };
}

/** Distance from a point to a segment. */
function distanceToSegment(px, py, segment) {
  const dx = segment.x2 - segment.x1;
  const dy = segment.y2 - segment.y1;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0
    ? 0
    : Math.max(0, Math.min(1, ((px - segment.x1) * dx + (py - segment.y1) * dy) / lengthSquared));
  const x = segment.x1 + t * dx;
  const y = segment.y1 + t * dy;
  return Math.hypot(px - x, py - y);
}

/** One channel of the glyph, supersampled into an alpha mask. */
function alphaMask(segments, halfWidth) {
  const mask = new Uint8Array(SIZE * SIZE);
  const step = 1 / SUPERSAMPLE;
  const samples = SUPERSAMPLE * SUPERSAMPLE;
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      let hits = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          const px = x + (sx + 0.5) * step;
          const py = y + (sy + 0.5) * step;
          const inside = segments.some((segment) => distanceToSegment(px, py, segment) <= halfWidth);
          if (inside) hits += 1;
        }
      }
      mask[y * SIZE + x] = Math.round((hits / samples) * 255);
    }
  }
  return mask;
}

/** CRC32, for the PNG chunks. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

/** Encode an RGBA PNG from a mask and a single ink colour. */
function encodePng(mask, [r, g, b]) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(SIZE, 0);
  header.writeUInt32BE(SIZE, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
  for (let y = 0; y < SIZE; y += 1) {
    const row = y * (SIZE * 4 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < SIZE; x += 1) {
      const alpha = mask[y * SIZE + x];
      const offset = row + 1 + x * 4;
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = alpha;
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const { width, segments } = readSegments();
const mask = alphaMask(segments, width / 2);
const targets = [
  { file: join(ROOT, 'public/tray-monochrome-light.png'), ink: [0, 0, 0] },
  { file: join(ROOT, 'public/tray-monochrome-dark.png'), ink: [255, 255, 255] },
];

const check = process.argv.includes('--check');
let stale = false;
for (const target of targets) {
  const png = encodePng(mask, target.ink);
  if (check) {
    let current = null;
    try {
      current = readFileSync(target.file);
    } catch {
      // Missing is stale.
    }
    if (!current || !current.equals(png)) {
      console.error(`stale: ${target.file}`);
      stale = true;
    }
    continue;
  }
  writeFileSync(target.file, png);
  console.log(`wrote ${target.file}`);
}

if (check && stale) process.exit(1);
