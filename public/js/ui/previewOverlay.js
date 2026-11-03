/**
 * Full-window panel preview.
 *
 * The docked preview is a thumbnail - at 300-odd pixels wide a 120 stitch panel
 * gives under 3px per stitch, below `V_THRESHOLD`, so it silently falls back to
 * flat cells and the knitted look disappears exactly when you want to judge it.
 * This gives the same renderer the whole window plus zoom and pan.
 *
 * It is a `position: fixed` overlay and deliberately *not* the Fullscreen API.
 * Real fullscreen takes the tab bar and the OS chrome away, animates on the way
 * in and out, and puts the browser in a mode Escape is already spoken for in -
 * all to gain a strip of pixels this overlay was covering anyway. Worse, it is
 * modal to the whole window: with the preview open there was no way to glance
 * at anything else without tearing the whole view down. A fixed overlay covers
 * the viewport, keeps the window a window, and closes the instant you ask.
 *
 * Zoom and pan are `ui/zoomPan.js`, shared with the docked preview.
 */

import { state, setUI } from '../core/store.js';
import { on } from '../core/bus.js';
import { createKnitPreview } from '../preview/knitPreview.js';
import { panelRows } from '../model/rows.js';
import { h, select, checkbox, button } from './dom.js';
import { attachZoomPan, STEP } from './zoomPan.js';

let ui = null; // built on first open, then reused

export const MODES = [
  ['knit', 'Knitted'],
  ['chart', 'Chart'],
  ['structure', 'Structure'],
];
export const MODE_TITLE =
  'Knitted simulates the stitch shape; Chart shows flat squares; ' +
  'Structure builds the fabric pass by pass, so slipped stitches stretch, tucks bulge and the back shows its floats.';
export const SIDES = [
  ['front', 'Front'],
  ['back', 'Back'],
];
export const SIDE_TITLE = 'Front is the knit side; Back is the purl side as seen turned over, with floats and tuck loops.';

function build() {
  const canvas = h('canvas', { class: 'preview-overlay-canvas' });
  const preview = createKnitPreview(canvas);

  const { view, clamp, fit, zoomBy } = attachZoomPan(canvas, preview, { draw: () => draw() });

  const modeSelect = select({
    value: state.previewMode,
    title: MODE_TITLE,
    options: MODES,
    onchange: (v) => setUI({ previewMode: v }),
  });

  const sideSelect = select({
    value: state.previewSide,
    title: SIDE_TITLE,
    options: SIDES,
    onchange: (v) => setUI({ previewSide: v }),
  });

  const marks = checkbox({
    label: 'Repeat marks',
    checked: state.showRepeatMarks,
    title: 'Dashed lines where the tile repeats.',
    onchange: (v) => setUI({ showRepeatMarks: v }),
  });

  const stage = h('div', { class: 'preview-overlay-stage' }, canvas);

  const hint = h('span', { class: 'preview-overlay-hint' });
  const title = h('span', { class: 'preview-overlay-title' });

  const overlay = h(
    'div',
    { class: 'preview-overlay', hidden: true },
    h(
      'div',
      { class: 'preview-overlay-bar' },
      title,
      h('span', { class: 'sep' }),
      modeSelect,
      sideSelect,
      marks,
      h('span', { class: 'sep' }),
      button({ label: '-', title: 'Zoom out', onclick: () => zoomBy(1 / STEP) }),
      hint,
      button({ label: '+', title: 'Zoom in', onclick: () => zoomBy(STEP) }),
      button({ label: 'Fit', title: 'Fit the whole panel', onclick: () => fit() }),
      h('span', { class: 'grow' }),
      button({ label: 'Close', title: 'Close  (Esc)', onclick: () => close(), variant: 'primary' })
    ),
    stage
  );

  document.body.append(overlay);

  function draw() {
    title.textContent = state.project.name;
    hint.textContent =
      `${Math.round(view.zoom * 100)}%  -  ` +
      `${state.project.panel.w} sts x ${panelRows(state.project)} rows`;
    if (modeSelect.value !== state.previewMode) modeSelect.value = state.previewMode;
    if (sideSelect.value !== state.previewSide) sideSelect.value = state.previewSide;
    sideSelect.hidden = state.previewMode !== 'structure';
    const box = marks.querySelector('input');
    if (box.checked !== state.showRepeatMarks) box.checked = state.showRepeatMarks;

    clamp();
    preview.render(state, view);
  }

  // Keys are captured on the overlay itself so the editor's shortcuts, which
  // live on window, do not fire at a pattern you cannot see.
  overlay.addEventListener('keydown', (event) => {
    const handled = ['Escape', '0', '+', '=', '-'];
    if (!handled.includes(event.key)) return;
    event.stopPropagation();

    if (event.key === 'Escape') return close();
    if (event.key === '0') return fit();
    if (event.key === '-') return zoomBy(1 / STEP);
    return zoomBy(STEP);
  });
  overlay.tabIndex = -1;

  // Redraw on anything that changes what is being previewed, but only while
  // open - a hidden overlay has a zero-sized canvas and nothing to show.
  const redraw = () => {
    if (!overlay.hidden) draw();
  };
  on('project:changed', redraw);
  on('ui:changed', redraw);

  // Observe the box, not the canvas: resizing the canvas inside the callback
  // would otherwise be able to retrigger it.
  new ResizeObserver(redraw).observe(stage);

  function open() {
    overlay.hidden = false;
    // The overlay owns Escape and the zoom keys while it is up, so it has to
    // hold focus; without this the keydown handler above never sees anything.
    overlay.focus();
    fit();
  }

  function close() {
    overlay.hidden = true;
  }

  return { overlay, open, close, isOpen: () => !overlay.hidden };
}

export function openFullPreview() {
  if (!ui) ui = build();
  if (ui.isOpen()) ui.close();
  else ui.open();
}

/** Lets the editor's global shortcuts stand down while the overlay has the screen. */
export function isFullPreviewOpen() {
  return Boolean(ui && ui.isOpen());
}
