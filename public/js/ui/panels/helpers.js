/**
 * Shared plumbing for panels.
 *
 * Every panel is a small function that rebuilds its own DOM from the store when
 * something it cares about changes. Panels never reach into each other; they
 * listen on the bus and re-render (CLAUDE.md 5).
 */

import { on } from '../../core/bus.js';
import { clear, append, h } from '../dom.js';

/**
 * Re-render `host` from `build()` whenever any of `events` fires.
 * Renders are coalesced to one per frame, so a drag that emits per-pointermove
 * does not rebuild a panel forty times a second.
 */
export function reactive(host, build, events = ['project:changed', 'ui:changed']) {
  let queued = false;
  let stale = false;

  const draw = () => {
    queued = false;
    stale = false;
    // Only what was focused *in this panel*, or a rebuild elsewhere would pull
    // focus out of the canvas and into whatever matched here.
    const active = document.activeElement;
    const key = host.contains(active) ? focusKey(active) : null;
    clear(host);
    append(host, [build()]);
    if (key) restoreFocus(host, key);
  };

  const schedule = (payload) => {
    // A drag emits on every pointermove. Panels only ever need the settled
    // result, and some of them (export, knittability) do real work to render,
    // so transient frames are dropped rather than throttled.
    if (payload?.transient) return;

    // A collapsed panel is not in the document. Remember that it needs
    // redrawing and do it when the dock puts it back.
    if (!host.isConnected) {
      stale = true;
      return;
    }

    // A rebuild replaces every node in the panel, which destroys anything the
    // user is part-way through: text they are typing, an open `<select>` list,
    // or the native color dialog, which the browser anchors to its `<input>`.
    // Only those need protecting. Deferring for *any* focus inside the panel
    // meant a tool button or a swatch stayed unhighlighted after you clicked
    // it - the click focused the button, so its own update was held back until
    // focus left the panel, which read as the page having frozen.
    if (isEditing(host)) {
      stale = true;
      return;
    }
    if (queued) return;
    queued = true;
    requestAnimationFrame(draw);
  };

  // Capture, so the field is marked before its own handler commits.
  host.addEventListener('input', (event) => settled.delete(event.target), true);
  host.addEventListener('change', (event) => settled.add(event.target), true);

  for (const event of events) on(event, schedule);
  on('dock:rendered', () => {
    if (stale && host.isConnected) draw();
  });

  // `focusout` fires before the next element takes focus, so the check for
  // "focus actually left this panel" has to wait a frame.
  host.addEventListener('focusout', () => {
    requestAnimationFrame(() => {
      if (stale && host.isConnected && !host.contains(document.activeElement)) draw();
    });
  });

  draw();
  return draw;
}

/**
 * Controls whose in-progress state lives in the browser rather than in the
 * store, so replacing the element throws work away. Checkboxes, radios and
 * buttons are not in the list: they act on click and keep nothing.
 */
const EDITING =
  'textarea, select, input:not([type=checkbox]):not([type=radio]):not([type=button])';

/**
 * Inputs whose last event was `change`: the value is committed and nothing is
 * in progress, so a rebuild loses nothing. Without this a number box held its
 * own panel still for as long as it kept focus - the spinner arrows changed
 * the float limit and the Knittability panel did not move until you clicked
 * away. A `<select>` is never settled this way: an open list fires nothing.
 */
const settled = new WeakSet();

function isEditing(host) {
  const el = document.activeElement;
  if (!el || !host.contains(el) || !el.matches(EDITING)) return false;
  return el.tagName !== 'INPUT' || !settled.has(el);
}

/**
 * Focus survives a rebuild by name rather than by node, so tabbing to a tool
 * and pressing Enter does not drop you back at the top of the document. The
 * title is what distinguishes one button from the next in these panels, and
 * it is already there for the tooltip.
 */
function focusKey(el) {
  if (!el || el === document.body) return null;
  const name = el.title || el.getAttribute('aria-label') || el.textContent?.trim();
  return name ? `${el.tagName}|${name}` : null;
}

function restoreFocus(host, key) {
  for (const el of host.querySelectorAll('button, input, select, textarea, [tabindex]')) {
    if (focusKey(el) === key) {
      el.focus({ preventScroll: true });
      return;
    }
  }
}

/** A labeled stat line, used all over the measurement panels. */
export function stat(label, value, hint) {
  return h(
    'div',
    { class: 'stat', title: hint },
    h('span', { class: 'stat-label' }, label),
    h('span', { class: 'stat-value' }, value)
  );
}

/** Centimeters shown with inches underneath, because patterns get shared both ways. */
export function cmLabel(cm) {
  return `${cm.toFixed(1)} cm / ${(cm / 2.54).toFixed(1)} in`;
}

export function iconButton({ path, label, active, onclick, title }) {
  return h(
    'button',
    {
      class: `icon-btn ${active ? 'is-active' : ''}`,
      title: title ?? label,
      onclick,
    },
    svgPath(path),
    h('span', { class: 'icon-label' }, label)
  );
}

/**
 * Icons are a single Material Design Icons path on a 24x24 viewBox, taken from
 * `icons.js`. MDI ships filled silhouettes - an outline icon is drawn as a
 * closed ring, not as a stroked skeleton - so this fills with `currentColor`
 * and strokes nothing. Stroke it instead and every icon renders as an outline
 * of its own outline.
 */
export function svgPath(d, size = 20) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', d ?? '');
  path.setAttribute('fill', 'currentColor');

  svg.append(path);
  return svg;
}

/** Guard a panel action so one thrown error cannot take the whole UI down. */
export function guarded(fn, onError) {
  return async (...args) => {
    try {
      await fn(...args);
    } catch (error) {
      console.error(error);
      onError?.(error);
    }
  };
}
