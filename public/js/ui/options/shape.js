/**
 * Fill/stroke and the shape picker.
 *
 * The picker used to be a docked panel, which meant a sidebar section sitting
 * there all day for something that does nothing unless the Shape tool is in
 * hand. In the bar it appears with the tool and leaves with it.
 *
 * Thumbnails are rasterized by the same code that draws on the grid, in the
 * color the tool would actually paint with, so the chip is a real preview
 * rather than a drawing of one. They are rasterized smaller here than the panel
 * drew them - 13 cells at 2x rather than 18 at 3x - because a bar row is 34px
 * tall. Scaling the old 54px canvas down would have resampled pixel art; a
 * coarser raster at a whole-number scale stays crisp, and these shapes are
 * implicit functions, so they still read at 13 cells across.
 *
 * The labels go. Eight shapes with names underneath is a grid, not a strip, and
 * the shapes are recognizable at a glance in a way that "Diamond" spelled out
 * adds nothing to; the name stays in the tooltip.
 */

import { registerToolOptions, shapes } from '../../core/registry.js';
import { state, setUI } from '../../core/store.js';
import { h, field, checkbox, numberInput } from '../dom.js';

const CELLS = 13;
const SCALE = 2;

function thumbnail(def, opts) {
  const canvas = h('canvas', {
    class: 'shape-chip',
    width: CELLS * SCALE,
    height: CELLS * SCALE,
  });
  const ctx = canvas.getContext('2d');

  // Canvas has no `currentColor`, so draw in the palette color the tool paints
  // with. That is what makes the chip a preview instead of an icon.
  ctx.fillStyle = state.project.palette[state.primary]?.color ?? '#dcd8cf';
  for (const [x, y] of def.rasterize(CELLS, CELLS, { filled: true, ...opts })) {
    ctx.fillRect(x * SCALE, y * SCALE, SCALE, SCALE);
  }
  return canvas;
}

/** Integer counts get a spinner; a 0-1 ratio gets a slider with its value shown. */
function optionControl(key, fallback) {
  const value = state.shapeOptions[key] ?? fallback;
  const isRatio = typeof fallback === 'number' && fallback > 0 && fallback < 1;
  const apply = (v) =>
    setUI({ shapeOptions: { ...state.shapeOptions, [key]: Number(v) } });

  // Sentence case from a camelCase key: `innerRatio` -> `Inner ratio`.
  const words = key.replace(/([A-Z])/g, ' $1').toLowerCase();
  const label = words.charAt(0).toUpperCase() + words.slice(1);

  if (!isRatio) {
    return field(
      label,
      numberInput({ value, min: 3, max: 24, onchange: apply, title: `${label} of the shape.` })
    );
  }

  return field(
    label,
    h(
      'span',
      { class: 'ob-range' },
      h('input', {
        type: 'range',
        class: 'range',
        value,
        min: 0.05,
        max: 0.95,
        step: 0.01,
        title: `${label} of the shape.`,
        oninput: (event) => apply(event.target.value),
      }),
      h('span', { class: 'ob-range-value' }, Number(value).toFixed(2))
    )
  );
}

registerToolOptions({
  id: 'fill',
  order: 20,
  build: () =>
    h(
      'div',
      { class: 'ob-cluster' },
      checkbox({
        label: 'Filled',
        checked: state.shapeFilled,
        title: 'Off draws the outline only, at the stroke width beside it.',
        onchange: (v) => setUI({ shapeFilled: v }),
      }),
      // The stroke width *is* the brush size - one setting, because an outline
      // is drawn by dilating its own path. Showing it only when it can do
      // something keeps the bar from implying otherwise.
      state.shapeFilled
        ? null
        : field(
            'Stroke',
            numberInput({
              value: state.brushSize,
              min: 1,
              max: 12,
              title: 'Outline thickness in stitches. The same setting as the brush size.',
              onchange: (v) => setUI({ brushSize: v }),
            })
          )
    ),
});

registerToolOptions({
  id: 'shape',
  order: 5,
  build: () => {
    const active = shapes.get(state.shape);
    const opts = { ...(active?.defaults ?? {}), ...state.shapeOptions };

    return h(
      'div',
      { class: 'ob-cluster' },
      h(
        'div',
        { class: 'shape-strip' },
        ...shapes.sorted().map((def) =>
          h(
            'button',
            {
              class: `shape-chip-btn ${def.id === state.shape ? 'is-active' : ''}`,
              title: def.label,
              'aria-pressed': String(def.id === state.shape),
              // Clearing shapeOptions drops the previous shape's knobs, which
              // are meaningless to the next one - a star's points are not a
              // snowflake's arms even where the key happens to match.
              onclick: () => setUI({ shape: def.id, shapeOptions: {} }),
            },
            thumbnail(def, def.id === state.shape ? opts : (def.defaults ?? {}))
          )
        )
      ),
      ...Object.entries(active?.defaults ?? {}).map(([key, fallback]) =>
        optionControl(key, fallback)
      )
    );
  },
});
