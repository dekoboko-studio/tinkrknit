/**
 * PNG output.
 *
 * Always one pixel per stitch. Never scale an exported PNG: silver-reed-write
 * reads pixels as needles, so a 2x image is a 2x pattern (CLAUDE.md 4).
 *
 * The color PNG is for reference and sharing. The mono PNG is the one the
 * machine actually cares about; it follows the DOB convention from the
 * silver-reed-write pin table - white pixel on, black pixel off.
 */

import { colorAt, hexToRgb } from '../model/palette.js';

/** Build a PNG Blob from a function returning [r,g,b] for each pixel. */
export async function pixelsToPNG(w, h, rgbAt) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(w, h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = rgbAt(x, y);
      const i = (y * w + x) * 4;
      image.data[i] = r;
      image.data[i + 1] = g;
      image.data[i + 2] = b;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Canvas produced no PNG'))),
      'image/png'
    );
  });
}

/** Indexed grid rendered with its palette colors. */
export function colorPNG(grid, palette) {
  const cache = palette.map((slot) => hexToRgb(slot.color));
  return pixelsToPNG(grid.w, grid.h, (x, y) => {
    const index = grid.data[y * grid.w + x];
    return cache[index] ?? hexToRgb(colorAt(palette, index));
  });
}

/** 1-bit needle selection: 1 takes the contrast feeder and exports white. */
export function monoPNG(bits) {
  return pixelsToPNG(bits.w, bits.h, (x, y) =>
    bits.data[y * bits.w + x] ? [255, 255, 255] : [0, 0, 0]
  );
}

/** A scaled-up color chart for printing or posting. Never feed this to a machine. */
export function previewPNG(grid, palette, scale = 8) {
  const cache = palette.map((slot) => hexToRgb(slot.color));
  return pixelsToPNG(grid.w * scale, grid.h * scale, (x, y) => {
    const index = grid.data[Math.floor(y / scale) * grid.w + Math.floor(x / scale)];
    return cache[index] ?? [255, 0, 255];
  });
}

// --- download helpers -------------------------------------------------------

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // Give the browser a moment to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function downloadText(text, filename, type = 'text/plain') {
  download(new Blob([text], { type: `${type};charset=utf-8` }), filename);
}

export function downloadJSON(data, filename) {
  downloadText(JSON.stringify(data, null, 2), filename, 'application/json');
}

/** Filesystem-safe base name derived from the project title. */
export function safeName(name) {
  return (
    String(name || 'pattern')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'pattern'
  );
}
