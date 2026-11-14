/**
 * The editing canvas controller.
 *
 * Owns the pointer gesture and the viewport; delegates all actual drawing
 * decisions to the registered tool and all pixel painting to the model. One
 * pointer drag becomes exactly one undo step.
 */

import {
  state, beginStroke, endStroke, cancelStroke, touch, validation,
} from '../core/store.js';
import { tools } from '../core/registry.js';
import { emit, on } from '../core/bus.js';
import * as bitmap from '../model/bitmap.js';
import { createRenderer } from './renderer.js';
import { createViewport, screenToCell, zoomAt, fit, pan } from './viewport.js';
import { applySymmetry } from './tools.js';
import { stitchLayer } from '../model/stitch.js';
import { rowLayout } from '../model/rows.js';

/** The grid the tools paint: the colors, or the stitch layer. */
export function activeLayer(state) {
  return state.layer === 'stitches' ? stitchLayer(state.project) : state.project.tile;
}

export function createEditor(canvasEl) {
  const vp = createViewport();
  const renderer = createRenderer(canvasEl);

  let hover = null;
  let gesture = null;
  let panning = null;
  let frameQueued = false;

  function draw() {
    if (frameQueued) return;
    frameQueued = true;
    requestAnimationFrame(() => {
      frameQueued = false;
      vp.rows = rowLayout(state.project);
      renderer.render(state, vp, { hover, validation: validation() });
    });
  }

  function cellAt(event) {
    const rect = canvasEl.getBoundingClientRect();
    vp.rows = rowLayout(state.project);
    return screenToCell(vp, event.clientX - rect.left, event.clientY - rect.top);
  }

  function makeContext(tool, cell, extra = {}) {
    const tile = activeLayer(state);
    const stitches = state.layer === 'stitches';
    // On the stitch layer the right button paints knit, which is "erase".
    const index = tool.forceIndex !== undefined
      ? tool.forceIndex
      : gesture?.button === 2
        ? stitches ? 0 : state.secondary
        : stitches ? state.stitchOp : state.primary;

    return {
      state,
      project: state.project,
      tile,
      palette: state.project.palette,
      cell,
      start: gesture?.start ?? cell,
      last: gesture?.last ?? cell,
      base: gesture?.base,
      index,
      shiftKey: extra.shiftKey ?? false,
      altKey: extra.altKey ?? false,

      paint(points, overrideIndex) {
        const value = overrideIndex ?? index;
        for (const [x, y] of applySymmetry(points, tile, state.symmetry)) {
          bitmap.set(tile, x, y, value);
        }
      },

      restore() {
        if (gesture?.base) tile.data.set(gesture.base.data);
      },
    };
  }

  // --- pointer handling -----------------------------------------------------

  /**
   * The cursor says when a drag will pan: an open hand while Space is held or
   * the Pan tool is in hand, a closed one while panning (the middle button
   * too). Otherwise pan-by-Space is invisible until you try it.
   */
  function updateCursor() {
    canvasEl.classList.toggle('pan-ready', state.spaceDown || !!tools.get(state.tool)?.pan);
    canvasEl.classList.toggle('panning', !!panning);
  }
  on('ui:changed', (patch) => {
    if ('spaceDown' in patch || 'tool' in patch) {
      updateCursor();
      if ('spaceDown' in patch) draw(); // the hover outline hides while Space is held
    }
  });
  updateCursor();

  canvasEl.addEventListener('contextmenu', (e) => e.preventDefault());

  canvasEl.addEventListener('pointerdown', (event) => {
    canvasEl.focus();

    // Middle button, Space held, or the Pan tool's left button pans,
    // regardless of the active tool.
    const panTool = tools.get(state.tool)?.pan && event.button === 0;
    if (event.button === 1 || state.spaceDown || panTool) {
      event.preventDefault(); // a middle click would otherwise start autoscroll
      panning = { x: event.clientX, y: event.clientY };
      canvasEl.setPointerCapture(event.pointerId);
      updateCursor();
      return;
    }
    if (event.button !== 0 && event.button !== 2) return;

    const tool = tools.get(state.tool);
    if (!tool) return;

    const cell = cellAt(event);
    gesture = {
      tool,
      button: event.button,
      start: cell,
      last: cell,
      base: bitmap.clone(activeLayer(state)),
      changed: false,
    };

    if (!tool.noHistory) beginStroke();
    canvasEl.setPointerCapture(event.pointerId);

    tool.onDown?.(makeContext(tool, cell, event));
    gesture.changed = true;
    touch('tool');
    draw();
  });

  canvasEl.addEventListener('pointermove', (event) => {
    if (panning) {
      pan(vp, event.clientX - panning.x, event.clientY - panning.y);
      panning = { x: event.clientX, y: event.clientY };
      draw();
      return;
    }

    const cell = cellAt(event);

    if (!gesture) {
      if (!hover || hover.x !== cell.x || hover.y !== cell.y) {
        hover = cell;
        emit('cursor:moved', cell);
        draw();
      }
      return;
    }

    if (cell.x === gesture.last.x && cell.y === gesture.last.y) return;

    gesture.tool.onMove?.(makeContext(gesture.tool, cell, event));
    gesture.last = cell;
    hover = cell;
    touch('tool');
    draw();
  });

  function finishGesture(event) {
    if (panning) {
      panning = null;
      updateCursor();
      return;
    }
    if (!gesture) return;

    const { tool } = gesture;
    tool.onUp?.(makeContext(tool, cellAt(event), event));

    if (!tool.noHistory) {
      // A click that changed nothing should not leave an undo step behind.
      if (sameData(gesture.base.data, activeLayer(state).data)) cancelStroke();
      else endStroke(tool.label.toLowerCase());
    }
    gesture = null;
    draw();
  }

  canvasEl.addEventListener('pointerup', finishGesture);
  canvasEl.addEventListener('pointercancel', finishGesture);

  // --- zoom and pan ---------------------------------------------------------

  canvasEl.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      const rect = canvasEl.getBoundingClientRect();
      const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
      if (zoomAt(vp, event.clientX - rect.left, event.clientY - rect.top, factor)) {
        emit('zoom:changed', vp.cell);
        draw();
      }
    },
    { passive: false }
  );

  canvasEl.addEventListener('pointerleave', () => {
    if (!gesture) {
      hover = null;
      draw();
    }
  });

  // --- public surface -------------------------------------------------------

  function fitToView() {
    const { w, h } = renderer.resize();
    vp.rows = rowLayout(state.project);
    fit(vp, state.project.tile.w, vp.rows?.span ?? state.project.tile.h, w, h, 40);
    emit('zoom:changed', vp.cell);
    draw();
  }

  const observer = new ResizeObserver(() => draw());
  observer.observe(canvasEl);

  return { draw, fitToView, viewport: vp, get hover() { return hover; } };
}

/** True when two grids are identical. Used to discard no-op gestures. */
function sameData(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
