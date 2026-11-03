/**
 * Whole-panel preview.
 *
 * The editing grid shows one tile; this shows the finished piece with the
 * repeat applied, drawn as stockinette Vs at the real gauge aspect. It is the
 * only view that tells you whether a motif survives being repeated - seams,
 * accidental diagonals and color clashes all show up here and nowhere else.
 *
 * It zooms and pans like the full-window view (`ui/zoomPan.js`), with its own
 * view kept here, so a close look at a motif does not need the whole window.
 */

import { registerPanel } from '../../core/registry.js';
import { state, setUI } from '../../core/store.js';
import { createKnitPreview } from '../../preview/knitPreview.js';
import { on } from '../../core/bus.js';
import { openFullPreview, MODES, MODE_TITLE, SIDES, SIDE_TITLE } from '../previewOverlay.js';
import { h, row, select, checkbox, button } from '../dom.js';
import { svgPath } from './helpers.js';
import { attachZoomPan, STEP } from '../zoomPan.js';
import { mdiEyeOutline, mdiMinus, mdiPlus } from '../../icons.js';

registerPanel({
  id: 'preview',
  title: 'Panel preview',
  icon: mdiEyeOutline,
  dock: 'right',
  order: 5,
  grow: true,

  render(host) {
    // Below roughly 4px per stitch the renderer drops the V detail, which at
    // this width is most panels until you zoom in. A click that does not drag
    // still opens the full window.
    const canvas = h('canvas', {
      class: 'preview-canvas',
      title: 'Scroll to zoom, drag to pan, click for the full window  (P)',
    });
    const preview = createKnitPreview(canvas);
    const { view, clamp, fit, zoomBy } = attachZoomPan(canvas, preview, {
      draw: () => paint(),
      onClick: () => openFullPreview(),
    });

    const zoomButton = (icon, title, onclick) =>
      h('button', { type: 'button', class: 'preview-zoom-btn', title, onclick }, svgPath(icon, 16));
    const zoomLabel = h('button', {
      type: 'button',
      class: 'preview-zoom-btn preview-zoom-level',
      title: 'Fit the whole panel',
      onclick: () => fit(),
    });
    const zoom = h(
      'div',
      { class: 'preview-zoom' },
      zoomButton(mdiMinus, 'Zoom out', () => zoomBy(1 / STEP)),
      zoomLabel,
      zoomButton(mdiPlus, 'Zoom in', () => zoomBy(STEP))
    );

    // The canvas is positioned out of flow inside this box. Its bitmap size
    // must never be able to influence the box that decides its bitmap size.
    const stage = h('div', { class: 'preview-stage' }, canvas, zoom);

    const controls = h('div', { class: 'preview-controls' });
    const rebuildControls = () => {
      controls.replaceChildren(
        row(
          select({
            value: state.previewMode,
            title: MODE_TITLE,
            options: MODES,
            onchange: (v) => setUI({ previewMode: v }),
          }),
          state.previewMode === 'structure'
            ? select({
                value: state.previewSide,
                title: SIDE_TITLE,
                options: SIDES,
                onchange: (v) => setUI({ previewSide: v }),
              })
            : null,
          checkbox({
            label: 'Repeat marks',
            checked: state.showRepeatMarks,
            title: 'Dashed lines where the tile repeats.',
            onchange: (v) => setUI({ showRepeatMarks: v }),
          })
        ),
        button({
          label: 'Full window',
          title: 'Open the simulated panel across the window, with zoom and pan  (P)',
          onclick: () => openFullPreview(),
        })
      );
    };

    host.append(stage, controls);

    // Zooming and panning repaint only; the controls rebuild on real changes.
    const paint = () => {
      clamp();
      zoomLabel.textContent = `${Math.round(view.zoom * 100)}%`;
      preview.render(state, view);
    };
    const draw = () => {
      rebuildControls();
      paint();
    };

    on('project:changed', draw);
    on('ui:changed', draw);
    on('dock:rendered', draw);
    on('layout:resized', draw);

    // The panel can be resized by dragging a dock edge or collapsing a
    // neighbor, neither of which emits anything we listen to. Observe the
    // box, never the canvas, so redrawing cannot re-trigger the observer.
    new ResizeObserver(paint).observe(stage);

    draw();
  },
});
