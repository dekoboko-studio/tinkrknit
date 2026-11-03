/**
 * Zoom and pan for a knit preview canvas, shared by the docked panel and the
 * full-window overlay so the two behave alike.
 *
 * Zoom is a multiplier on the fit, not an absolute cell size, so 1x always
 * means "the whole panel" whatever the panel's dimensions are. The owner keeps
 * drawing: every change here calls its `draw()`, which calls `clamp()` and then
 * renders with `view`.
 */

import { state } from '../core/store.js';

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 24;
export const STEP = 1.4;

/** Movement in px below which a press and release is a click, not a pan. */
const CLICK_SLOP = 4;

/**
 * `onClick` makes a click without a drag do something (the docked preview
 * opens the full window); without it a double-click zooms in instead. Both
 * cannot have the click, since the first half of a double-click is one.
 */
export function attachZoomPan(canvas, preview, { draw, onClick } = {}) {
  const view = { zoom: 1, panX: 0, panY: 0 };

  /** Panning past the edges leaves you looking at nothing; keep the panel in view. */
  function clamp() {
    const m = preview.metrics();
    const panelW = m.cw * state.project.panel.w;
    const panelH = m.ch * m.rows;

    // Allow the panel to be dragged until only a quarter of it is still on
    // screen, which is enough slack to inspect a corner without losing it.
    const slackX = Math.max(m.viewW / 2, panelW * 0.75);
    const slackY = Math.max(m.viewH / 2, panelH * 0.75);

    view.panX = Math.max(-slackX, Math.min(slackX, view.panX));
    view.panY = Math.max(-slackY, Math.min(slackY, view.panY));
  }

  function fit() {
    view.zoom = 1;
    view.panX = 0;
    view.panY = 0;
    draw();
  }

  /**
   * Zoom about a point so whatever is under the cursor stays under it. The
   * origin is center + pan, so holding a point fixed means scaling its offset
   * from center by the same factor the cells grew by.
   */
  function zoomBy(factor, atX, atY) {
    const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, view.zoom * factor));
    const applied = next / view.zoom;
    if (applied === 1) return;

    const m = preview.metrics();
    const fx = atX ?? m.viewW / 2;
    const fy = atY ?? m.viewH / 2;

    view.panX = fx - m.viewW / 2 - (fx - m.viewW / 2 - view.panX) * applied;
    view.panY = fy - m.viewH / 2 - (fy - m.viewH / 2 - view.panY) * applied;
    view.zoom = next;
    draw();
  }

  canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      zoomBy(event.deltaY < 0 ? 1.15 : 1 / 1.15, event.clientX - rect.left, event.clientY - rect.top);
    },
    { passive: false }
  );

  let dragging = null;

  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    dragging = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: 0 };
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!dragging || dragging.id !== event.pointerId) return;
    const dx = event.clientX - dragging.x;
    const dy = event.clientY - dragging.y;
    dragging.moved += Math.abs(dx) + Math.abs(dy);
    if (dragging.moved < CLICK_SLOP) return;
    canvas.classList.add('is-panning');
    view.panX += dx;
    view.panY += dy;
    dragging.x = event.clientX;
    dragging.y = event.clientY;
    draw();
  });

  const endDrag = (event, cancelled) => {
    if (!dragging || dragging.id !== event.pointerId) return;
    const click = !cancelled && dragging.moved < CLICK_SLOP;
    dragging = null;
    canvas.classList.remove('is-panning');
    if (click && onClick) onClick();
  };
  canvas.addEventListener('pointerup', (event) => endDrag(event, false));
  canvas.addEventListener('pointercancel', (event) => endDrag(event, true));

  if (!onClick) {
    canvas.addEventListener('dblclick', (event) => {
      const rect = canvas.getBoundingClientRect();
      zoomBy(2, event.clientX - rect.left, event.clientY - rect.top);
    });
  }

  return { view, clamp, fit, zoomBy };
}
