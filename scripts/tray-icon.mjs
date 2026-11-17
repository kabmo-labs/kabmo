/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Generate the tray's monochrome icons.
 *
 * The tray host is a separate process and cannot read the page's CSS, so the
 * icon has to be a FILE. The monochrome icon is a GREYSCALE conversion of the
 * app icon, not a black-and-white silhouette:
 *
 * - the green plate becomes dark on a light theme and light on a dark one;
 * - the cream K strokes become light on a light theme and dark on a dark one;
 * - the orange arm becomes the middle grey in both.
 *
 * That is what keeps the mark readable on either panel without turning the
 * plate into a solid square. Two files are shipped because the plate and the
 * strokes swap luminance with the theme; the orange arm does not.
 *
 * The geometry is read from `public/icon.svg` rather than restated here — the
 * same rule `scripts/shell-wordmark.mjs` follows.
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

/** The three grey levels, per theme variant. */
const GREYS = {
  light: { plate: '#3f3f3f', cream: '#ededed', orange: '#9e9e9e' },
  dark: { plate: '#d6d6d6', cream: '#2b2b2b', orange: '#9e9e9e' },
};

/** The K's three segments and the plate, read from the icon SVG's own markup. */
function readArtwork() {
  const svg = readFileSync(SVG, 'utf8');
  const group = svg.match(/<g fill="none" stroke-width="([\d.]+)"[^>]*>/);
  if (!group) throw new Error('the icon SVG has no stroke group');
  const width = Number(group[1]);
  const pathTags = [...svg.matchAll(/<path\b([^>]*)\/>/g)].map((match) => match[1]);
  if (pathTags.length !== 3) throw new Error(`expected three K strokes, found ${pathTags.length}`);

  const segments = pathTags.map((body) => {
    const d = body.match(/\bd="([^"]+)"/)?.[1];
    if (!d) throw new Error('a K stroke has no path data');
    const stroke = body.match(/\bstroke="(#[0-9a-fA-F]{6})"/)?.[1];
    if (!stroke) throw new Error(`a K stroke has no colour: ${body}`);
    const numbers = d.match(/-?[\d.]+/g)?.map(Number) ?? [];
    if (numbers.length === 4) {
      // `M20 15v34` → M x y v dy, and `M20 32 42 15` → M x y L x y.
      return { x1: numbers[0], y1: numbers[1], x2: numbers[2], y2: numbers[3], stroke };
    }
    if (numbers.length === 3) {
      // `M20 15v34` is M x y v dy: the second point shares x.
      return { x1: numbers[0], y1: numbers[1], x2: numbers[0], y2: numbers[1] + numbers[2], stroke };
    }
    throw new Error(`unexpected path data: ${d}`);
  });

  const rect = svg.match(/<rect width="([\d.]+)" height="([\d.]+)" rx="([\d.]+)"/);
  if (!rect) throw new Error('the icon SVG has no plate <rect>');
  const plate = { width: Number(rect[1]), height: Number(rect[2]), radius: Number(rect[3]) };
  return { width, segments, plate };
}

/** Whether a point is inside a rounded rectangle anchored at the origin. */
function insideRoundedRect(px, py, plate) {
  const halfWidth = plate.width / 2;
  const halfHeight = plate.height / 2;
  const radius = plate.radius;
  const dx = Math.abs(px - halfWidth) - (halfWidth - radius);
  const dy = Math.abs(py - halfHeight) - (halfHeight - radius);
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return outside + Math.min(Math.max(dx, dy), 0) - radius <= 0;
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

/** `#rrggbb` as `[r, g, b]`. */
function hexToRgb(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

/**
 * The plate and the K strokes, each in its own grey, supersampled into RGBA.
 *
 * The strokes are drawn ON TOP of the plate, exactly as the SVG's document
 * order does; the plate is opaque, so the only partial coverage is its own
 * rounded edge.
 */
function renderGreyscale(segments, halfWidth, plate, plateGrey, strokeGreys) {
  const pixels = new Uint8Array(SIZE * SIZE * 4);
  const step = 1 / SUPERSAMPLE;
  const samples = SUPERSAMPLE * SUPERSAMPLE;
  const plateRgb = hexToRgb(plateGrey);
  const strokeRgb = strokeGreys.map(hexToRgb);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let covered = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          const px = x + (sx + 0.5) * step;
          const py = y + (sy + 0.5) * step;
          if (!insideRoundedRect(px, py, plate)) continue;
          let rgb = plateRgb;
          for (let index = 0; index < segments.length; index += 1) {
            if (distanceToSegment(px, py, segments[index]) <= halfWidth) rgb = strokeRgb[index];
          }
          r += rgb[0];
          g += rgb[1];
          b += rgb[2];
          covered += 1;
        }
      }
      if (covered === 0) continue;
      const offset = (y * SIZE + x) * 4;
      pixels[offset] = Math.round(r / covered);
      pixels[offset + 1] = Math.round(g / covered);
      pixels[offset + 2] = Math.round(b / covered);
      pixels[offset + 3] = Math.round((covered / samples) * 255);
    }
  }
  return pixels;
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

/** Encode an RGBA PNG from a full pixel buffer. */
function encodeRgba(pixels) {
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
      const source = (y * SIZE + x) * 4;
      const target = row + 1 + x * 4;
      raw[target] = pixels[source];
      raw[target + 1] = pixels[source + 1];
      raw[target + 2] = pixels[source + 2];
      raw[target + 3] = pixels[source + 3];
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const { width, segments, plate } = readArtwork();
const targets = Object.entries(GREYS).map(([variant, greys]) => {
  const strokeGreys = segments.map((segment) =>
    segment.stroke.toLowerCase() === '#f26522' ? greys.orange : greys.cream,
  );
  const pixels = renderGreyscale(segments, width / 2, plate, greys.plate, strokeGreys);
  return { file: join(ROOT, `public/tray-monochrome-${variant}.png`), png: encodeRgba(pixels) };
});

const check = process.argv.includes('--check');
let stale = false;
for (const target of targets) {
  if (check) {
    let current = null;
    try {
      current = readFileSync(target.file);
    } catch {
      // Missing is stale.
    }
    if (!current || !current.equals(target.png)) {
      console.error(`stale: ${target.file}`);
      stale = true;
    }
    continue;
  }
  writeFileSync(target.file, target.png);
  console.log(`wrote ${target.file}`);
}

if (check && stale) process.exit(1);
