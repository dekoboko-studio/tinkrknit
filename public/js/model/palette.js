/**
 * Palette slots.
 *
 * A slot is a *position*, not a color. Cells in the bitmap store the slot
 * index, so recoloring a slot instantly repaints every stitch that uses it —
 * that is the "color slots" feature and it is free, as long as nothing
 * anywhere stores a color in a cell (CLAUDE.md 3.1).
 *
 * A slot may be bound to a yarn from the stock library. It keeps its own copy
 * of the color so deleting a yarn can never corrupt a saved design.
 */

let nextId = 1;

/** A calm Shetland-ish starting set: ground, ink, then four contrasts. */
const DEFAULT_COLORS = [
  ['#f0ece1', 'Natural'],
  ['#2b2b33', 'Charcoal'],
  ['#9b1b24', 'Crimson'],
  ['#d9a12c', 'Mustard'],
  ['#2f6b6b', 'Teal'],
  ['#7a5ea8', 'Heather'],
];

export function createSlot(color = '#cccccc', name = '', yarnId = null) {
  return { id: `slot-${nextId++}`, color: normalizeHex(color), name, yarnId };
}

export function createPalette(entries = DEFAULT_COLORS) {
  return entries.map(([color, name]) => createSlot(color, name));
}

export function addSlot(palette, color = '#cccccc', name = '') {
  if (palette.length >= 256) throw new Error('A palette holds at most 256 slots.');
  const slot = createSlot(color, name || `Color ${palette.length + 1}`);
  palette.push(slot);
  return slot;
}

export function setSlotColor(palette, index, color) {
  const slot = palette[index];
  if (!slot) return false;
  slot.color = normalizeHex(color);
  // Hand-editing a bound slot means it no longer matches the stock yarn.
  slot.yarnId = null;
  return true;
}

export function bindYarn(palette, index, yarn) {
  const slot = palette[index];
  if (!slot) return false;
  slot.yarnId = yarn?.id ?? null;
  if (yarn) {
    slot.color = normalizeHex(yarn.color);
    slot.name = yarn.name;
  }
  return true;
}

export function colorAt(palette, index) {
  return palette[index]?.color ?? '#ff00ff'; // magenta = a bug, visibly
}

export function serialize(palette) {
  return palette.map(({ color, name, yarnId }) => ({ color, name, yarnId }));
}

export function deserialize(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return createPalette();
  return raw.map((s) => createSlot(s.color, s.name ?? '', s.yarnId ?? null));
}

// --- color helpers ---------------------------------------------------------

export function normalizeHex(input) {
  let hex = String(input ?? '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    hex = hex.split('').map((c) => c + c).join('');
  }
  if (!/^[0-9a-f]{6}$/i.test(hex)) return '#cccccc';
  return '#' + hex.toLowerCase();
}

export function hexToRgb(hex) {
  const h = normalizeHex(hex).slice(1);
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

export function rgbToHex([r, g, b]) {
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  return '#' + [r, g, b].map((v) => clamp(v).toString(16).padStart(2, '0')).join('');
}

/** Relative luminance, 0..1. Used to pick readable label text over a swatch. */
export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function readableTextOn(hex) {
  return luminance(hex) > 0.45 ? '#12121a' : '#f5f5f7';
}

/** Shift a color toward white or black; used for knit-preview shading. */
export function shade(hex, amount) {
  const rgb = hexToRgb(hex).map((v) =>
    amount >= 0 ? v + (255 - v) * amount : v * (1 + amount)
  );
  return rgbToHex(rgb);
}

/** Squared distance in RGB. Good enough for snapping a stray pixel to a slot. */
export function nearestSlot(palette, hex) {
  const [r, g, b] = hexToRgb(hex);
  let best = 0;
  let bestD = Infinity;
  palette.forEach((slot, i) => {
    const [sr, sg, sb] = hexToRgb(slot.color);
    const d = (sr - r) ** 2 + (sg - g) ** 2 + (sb - b) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}
