/**
 * Stamps: small reusable motifs.
 *
 * A stamp stores palette *indices* plus the hex colors those indices meant
 * when it was captured. That pairing is what lets a stamp move between
 * projects: on placement the stored colors are matched to the nearest slots in
 * the current palette, so a snowflake captured in a red-and-cream project drops
 * sensibly into a blue-and-gray one instead of turning to noise.
 */

import * as bitmap from '../model/bitmap.js';
import { nearestSlot, normalizeHex } from '../model/palette.js';

/** Capture a rectangle of the tile as a stamp record. */
export function captureFromSelection(project, selection) {
  const { x, y, w, h } = selection;
  const grid = bitmap.crop(project.tile, x, y, w, h);

  // Store only the colors this crop actually uses, remapped to a dense range,
  // so a stamp does not carry an entire unrelated palette around with it.
  const used = [...bitmap.usedIndices(grid)].sort((a, b) => a - b);
  const remap = new Array(256).fill(0);
  used.forEach((index, position) => {
    remap[index] = position;
  });
  bitmap.remapIndices(grid, remap);

  return {
    w: grid.w,
    h: grid.h,
    cells: Array.from(grid.data),
    colors: used.map((index) => project.palette[index]?.color ?? '#cccccc'),
  };
}

/** Rebuild a stamp's grid, mapping its colors onto the current palette. */
export function materialize(record, palette) {
  const grid = bitmap.createBitmap(record.w, record.h);
  grid.data.set(Uint8Array.from(record.cells ?? []).subarray(0, grid.data.length));

  const colors = (record.colors ?? []).map(normalizeHex);
  if (colors.length) {
    const table = colors.map((hex) => nearestSlot(palette, hex));
    bitmap.remapIndices(grid, table);
  }
  return grid;
}

/** An empty stamp for the stamp editor. 16x16 is a good default motif size. */
export function blankStamp(size = 16) {
  return {
    w: size,
    h: size,
    cells: new Array(size * size).fill(0),
    colors: ['#f0ece1', '#2b2b33'],
  };
}

/**
 * Canvas thumbnail, always `px` square whatever the stamp's size, so a grid of
 * them lines up. The stamp is fitted and centered; cell edges are rounded to
 * whole pixels so a 60-stitch stamp shrinks without seams, and the canvas is
 * drawn at the device pixel ratio so a 16-stitch one stays crisp. A whole-number
 * scale used to be floored to at least 1, which drew big stamps smaller than
 * small ones and let anything over `px` stitches spill out of its chip.
 */
export function thumbnail(record, palette, px = 48) {
  const grid = materialize(record, palette);
  const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
  const size = px * dpr;
  const cell = size / Math.max(grid.w, grid.h, 1);
  const ox = Math.round((size - grid.w * cell) / 2);
  const oy = Math.round((size - grid.h * cell) / 2);

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  canvas.style.width = `${px}px`;
  canvas.style.height = `${px}px`;
  const ctx = canvas.getContext('2d');

  for (let y = 0; y < grid.h; y++) {
    const y0 = oy + Math.round(y * cell);
    const y1 = oy + Math.round((y + 1) * cell);
    for (let x = 0; x < grid.w; x++) {
      const x0 = ox + Math.round(x * cell);
      const x1 = ox + Math.round((x + 1) * cell);
      ctx.fillStyle = palette[grid.data[y * grid.w + x]]?.color ?? '#cccccc';
      ctx.fillRect(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
    }
  }
  return canvas;
}

/** The shape the API expects for the `stamps` table. */
export function toRow(name, record, tags = '') {
  return {
    name,
    tags,
    w: record.w,
    h: record.h,
    cells: record.cells,
    colors: record.colors,
  };
}
