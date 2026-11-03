/**
 * Indexed pixel grid.
 *
 * Cells hold **palette indices**, never colors (CLAUDE.md 3.1). A Uint8Array
 * gives us 256 slots, far more than any Fair Isle design needs, and makes
 * whole-grid operations cheap.
 *
 * Row 0 is the TOP of the chart, matching image data and the on-screen view.
 * Knitters count rows from the cast-on edge upward, so the *labels* in the UI
 * are flipped, not the data. Exported PNGs therefore look exactly like the
 * chart on screen, which is what makes the handoff predictable.
 */

export function createBitmap(w, h, fill = 0) {
  const bm = { w: Math.max(1, w | 0), h: Math.max(1, h | 0) };
  bm.data = new Uint8Array(bm.w * bm.h);
  if (fill) bm.data.fill(fill);
  return bm;
}

export const inside = (bm, x, y) => x >= 0 && y >= 0 && x < bm.w && y < bm.h;

/** Returns -1 outside the grid so callers can distinguish it from index 0. */
export function get(bm, x, y) {
  return inside(bm, x, y) ? bm.data[y * bm.w + x] : -1;
}

export function set(bm, x, y, value) {
  if (inside(bm, x, y)) bm.data[y * bm.w + x] = value & 0xff;
}

export function clone(bm) {
  return { w: bm.w, h: bm.h, data: new Uint8Array(bm.data) };
}

export function copyInto(dst, src) {
  if (dst.w !== src.w || dst.h !== src.h) {
    throw new Error('copyInto requires matching dimensions');
  }
  dst.data.set(src.data);
}

export function fillAll(bm, value) {
  bm.data.fill(value & 0xff);
}

export function row(bm, y) {
  return bm.data.subarray(y * bm.w, y * bm.w + bm.w);
}

/**
 * Resize, preserving content. `anchor` decides which corner stays put; for
 * knitting, growing a panel should normally keep the cast-on edge, so the
 * default anchors to the bottom-left.
 */
export function resize(bm, w, h, { anchor = 'bottom-left', fill = 0 } = {}) {
  const out = createBitmap(w, h, fill);
  const dx = anchor.includes('right') ? out.w - bm.w : 0;
  const dy = anchor.includes('bottom') ? out.h - bm.h : 0;

  for (let y = 0; y < bm.h; y++) {
    const ty = y + dy;
    if (ty < 0 || ty >= out.h) continue;
    for (let x = 0; x < bm.w; x++) {
      const tx = x + dx;
      if (tx < 0 || tx >= out.w) continue;
      out.data[ty * out.w + tx] = bm.data[y * bm.w + x];
    }
  }
  return out;
}

export function crop(bm, x0, y0, w, h) {
  const out = createBitmap(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = get(bm, x0 + x, y0 + y);
      out.data[y * w + x] = v < 0 ? 0 : v;
    }
  }
  return out;
}

/** Transform a bitmap. `rotate` is clockwise degrees: 0, 90, 180 or 270. */
export function transform(bm, { flipX = false, flipY = false, rotate = 0 } = {}) {
  let out = clone(bm);

  if (flipX || flipY) {
    const t = createBitmap(out.w, out.h);
    for (let y = 0; y < out.h; y++) {
      for (let x = 0; x < out.w; x++) {
        const sx = flipX ? out.w - 1 - x : x;
        const sy = flipY ? out.h - 1 - y : y;
        t.data[y * t.w + x] = out.data[sy * out.w + sx];
      }
    }
    out = t;
  }

  const turns = (((rotate / 90) | 0) % 4 + 4) % 4;
  for (let i = 0; i < turns; i++) {
    const t = createBitmap(out.h, out.w);
    for (let y = 0; y < out.h; y++) {
      for (let x = 0; x < out.w; x++) {
        // clockwise: (x, y) -> (h - 1 - y, x)
        t.data[x * t.w + (out.h - 1 - y)] = out.data[y * out.w + x];
      }
    }
    out = t;
  }
  return out;
}

/**
 * Draw `src` onto `dst` at (x0, y0).
 * `transparentIndex` lets a stamp leave the background showing through.
 * `wrap` carries what falls off one edge round to the opposite one, so a motif
 * placed across the tile's edge continues into the next repeat.
 */
export function blit(dst, src, x0, y0, { transparentIndex = null, wrap = false } = {}) {
  for (let y = 0; y < src.h; y++) {
    for (let x = 0; x < src.w; x++) {
      const v = src.data[y * src.w + x];
      if (transparentIndex !== null && v === transparentIndex) continue;
      if (wrap) set(dst, mod(x0 + x, dst.w), mod(y0 + y, dst.h), v);
      else set(dst, x0 + x, y0 + y, v);
    }
  }
}

/** Remainder that is never negative: -1 mod 10 is 9. */
export function mod(n, m) {
  return ((n % m) + m) % m;
}

/** Four-connected flood fill. Returns the number of cells changed. */
export function floodFill(bm, x, y, value) {
  const target = get(bm, x, y);
  if (target < 0 || target === value) return 0;

  const stack = [x, y];
  let changed = 0;

  while (stack.length) {
    const cy = stack.pop();
    const cx = stack.pop();
    if (!inside(bm, cx, cy)) continue;
    const i = cy * bm.w + cx;
    if (bm.data[i] !== target) continue;

    bm.data[i] = value;
    changed++;
    stack.push(cx + 1, cy, cx - 1, cy, cx, cy + 1, cx, cy - 1);
  }
  return changed;
}

/** Replace every occurrence of one index with another. */
export function replaceIndex(bm, from, to) {
  let n = 0;
  for (let i = 0; i < bm.data.length; i++) {
    if (bm.data[i] === from) {
      bm.data[i] = to;
      n++;
    }
  }
  return n;
}

/** Remap all indices through a lookup table (used when deleting a slot). */
export function remapIndices(bm, table) {
  for (let i = 0; i < bm.data.length; i++) {
    const v = table[bm.data[i]];
    if (v !== undefined) bm.data[i] = v;
  }
}

/** @returns {Set<number>} distinct palette indices in use */
export function usedIndices(bm) {
  const seen = new Set();
  for (let i = 0; i < bm.data.length; i++) seen.add(bm.data[i]);
  return seen;
}

// --- serialization ----------------------------------------------------------
// Base64 keeps a 200x200 panel around 53KB instead of ~120KB of JSON numbers,
// and survives a round trip through SQLite TEXT unharmed.

export function toJSON(bm) {
  let binary = '';
  const CHUNK = 0x8000; // avoid blowing the argument limit on large panels
  for (let i = 0; i < bm.data.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bm.data.subarray(i, i + CHUNK));
  }
  return { w: bm.w, h: bm.h, data: btoa(binary) };
}

export function fromJSON(obj) {
  const bm = createBitmap(obj.w, obj.h);
  if (typeof obj.data === 'string') {
    const binary = atob(obj.data);
    for (let i = 0; i < binary.length && i < bm.data.length; i++) {
      bm.data[i] = binary.charCodeAt(i);
    }
  } else if (Array.isArray(obj.data)) {
    bm.data.set(obj.data.slice(0, bm.data.length));
  }
  return bm;
}
