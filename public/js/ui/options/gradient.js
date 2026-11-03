/**
 * Gradient tool: the two colors, the shape and the dither.
 *
 * The two colors are the primary and secondary from the Colors panel rather
 * than settings of their own, so picking either here or there is the same
 * thing. On the stitch layer the gradient runs from the selected op to knit
 * (gradientEnds in editor/tools.js), and the chips show that instead.
 *
 * The strip at the end is the real dither, drawn by the same code that paints
 * the grid, so choosing one is choosing what you see.
 */

import { registerToolOptions } from '../../core/registry.js';
import { state, setUI } from '../../core/store.js';
import { h, field, select } from '../dom.js';
import { svgPath } from '../panels/helpers.js';
import { mdiSwapHorizontal } from '../../icons.js';
import { gradientCells, DITHERS, GRADIENT_SHAPES } from '../../editor/gradient.js';
import { gradientEnds } from '../../editor/tools.js';
import { opLabel } from '../../model/stitch.js';

let popover = null;

function closePopover() {
  popover?.remove();
  popover = null;
  document.removeEventListener('pointerdown', outside, true);
  document.removeEventListener('keydown', onKey, true);
}
function outside(event) {
  if (popover && !popover.contains(event.target)) closePopover();
}
function onKey(event) {
  if (event.key === 'Escape') closePopover();
}

/** Palette swatches under the chip; picking one sets primary or secondary. */
function openPicker(anchor, key) {
  closePopover();
  const rect = anchor.getBoundingClientRect();
  popover = h(
    'div',
    { class: 'ob-swatch-pop', style: { left: `${rect.left}px`, top: `${rect.bottom + 4}px` } },
    ...state.project.palette.map((slot, index) =>
      h('button', {
        class: ['ob-swatch', state[key] === index ? 'is-active' : ''],
        style: { background: slot.color },
        title: `${slot.name || 'Slot ' + (index + 1)}  ${slot.color}`,
        onclick: () => {
          closePopover();
          setUI({ [key]: index });
        },
      })
    )
  );
  document.body.append(popover);
  // After this click has finished, or it would close the popover it opened.
  setTimeout(() => {
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', onKey, true);
  });
}

function chip(label, index, key, stitches) {
  if (stitches) {
    return h('span', { class: 'ob-chip is-op', title: `${label}: ${opLabel(index)}` }, opLabel(index));
  }
  const slot = state.project.palette[index];
  return h('button', {
    class: 'ob-chip',
    style: { background: slot?.color ?? '#ccc' },
    title: `${label}: ${slot?.name || 'Slot ' + (index + 1)}  ${slot?.color ?? ''}\n` +
      `The ${key === 'primary' ? 'drawing' : 'base'} color. Click to pick another.`,
    onclick: (event) => openPicker(event.currentTarget, key),
  });
}

function previewStrip(from, to, stitches) {
  const W = 40;
  const H = 8;
  const S = 2;
  const canvas = h('canvas', { class: 'ob-gradient-strip', width: W * S, height: H * S });
  const ctx = canvas.getContext('2d');
  const color = (i) => (stitches ? (i ? '#7a7f8c' : '#dcd8cf') : state.project.palette[i]?.color ?? '#ccc');
  const cells = gradientCells({
    start: { x: 0, y: 0 },
    end: { x: W - 1, y: 0 },
    area: { x: 0, y: 0, w: W, h: H },
    shape: 'linear',
    dither: state.gradientDither,
  });
  for (const [x, y, second] of cells) {
    ctx.fillStyle = color(second ? to : from);
    ctx.fillRect(x * S, y * S, S, S);
  }
  canvas.title = 'What the dither looks like across a full gradient';
  return canvas;
}

registerToolOptions({
  id: 'gradient',
  order: 20,
  build: () => {
    closePopover();
    const stitches = state.layer === 'stitches';
    const { from, to } = gradientEnds(state);
    return h(
      'div',
      { class: 'ob-cluster' },
      h(
        'div',
        { class: 'ob-cluster ob-tight' },
        chip('From', from, 'primary', stitches),
        h(
          'button',
          {
            class: 'ob-toggle',
            title: 'Swap drawing and base',
            disabled: stitches,
            onclick: () => setUI({ primary: state.secondary, secondary: state.primary }),
          },
          svgPath(mdiSwapHorizontal, 16)
        ),
        chip('To', to, 'secondary', stitches)
      ),
      field(
        'Shape',
        select({
          value: state.gradientShape,
          title: 'Linear runs one way along the drag; Mirrored starts at the line and fades to both sides; Radial runs out from the start point.',
          options: GRADIENT_SHAPES,
          onchange: (v) => setUI({ gradientShape: v }),
        })
      ),
      field(
        'Dither',
        select({
          value: state.gradientDither,
          title:
            'How the in-between stitches are chosen.\n' +
            'Ordered: a regular 4-stitch pattern, short floats, repeats cleanly.\n' +
            'Ordered fine: an 8-stitch pattern, more steps.\n' +
            'Diffusion: smoothest, but uneven floats and no repeat.\n' +
            'Noise: random speckle.\n' +
            'Rows: whole rows change first, a stripe ramp with no floats going up the piece.\n' +
            'None: a hard edge halfway.',
          options: DITHERS,
          onchange: (v) => setUI({ gradientDither: v }),
        })
      ),
      previewStrip(from, to, stitches)
    );
  },
});
