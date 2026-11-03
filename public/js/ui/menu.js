/**
 * Toolbar dropdown menus.
 *
 * Some panels do not deserve permanent screen space. Projects and Export are
 * both the same shape of thing: you open them a handful of times a session,
 * do one action, and close them. Docked, they spent the rest of the day taking
 * width away from the design grid, which is the whole point of the app.
 *
 * A menu is therefore a panel with two differences: it is built on open rather
 * than on boot, and it is only rebuilt while open. That matters more than it
 * looks - Export decomposes the entire panel to count its substitutions, and
 * as a docked panel it did that work on every project change forever.
 *
 * Registered through `core/registry.js` like everything else, so adding one is
 * a file plus a line in `ui/menus/index.js` (CLAUDE.md 3.3).
 *
 * The popup is `position: fixed` and placed from the trigger's rect rather than
 * absolutely inside `.menu-host`. The toolbar is `overflow: hidden` so it never
 * wraps, and an absolutely positioned child of a clipping ancestor gets clipped
 * with it - the menu opened into a 40px strip and was sliced off. A fixed box
 * is laid out against the viewport, so no ancestor's overflow touches it.
 */

import { on } from '../core/bus.js';
import { h, clear } from './dom.js';
import { svgPath } from './panels/helpers.js';
import { mdiMenuDown } from '../icons.js';

/**
 * One row of a dropdown: icon, label, an optional second line and an optional
 * right-hand detail such as a shortcut.
 *
 * The icon column is a fixed width and is rendered even when there is no icon,
 * so every label in a menu starts at the same x. That alignment is most of what
 * makes a column of rows read as a menu instead of as a stack of buttons, which
 * is what these menus used to be.
 *
 * @param {object} def
 * @param {string} [def.icon]     path data from `icons.js`
 * @param {string} def.label      the row's text
 * @param {string} [def.note]     a dimmer second line, wrapped
 * @param {string} [def.detail]   right-aligned, for shortcuts and counts
 * @param {boolean} [def.checked] draws a tick in the icon column
 */
export function menuItem({
  icon, label, note, detail, checked = false, disabled = false, title, onclick,
}) {
  return h(
    'button',
    {
      type: 'button',
      class: `menu-item ${checked ? 'is-checked' : ''}`.trim(),
      title,
      disabled,
      onclick,
    },
    h('span', { class: 'menu-item-icon' }, icon ? svgPath(icon, 17) : null),
    h(
      'span',
      { class: 'menu-item-text' },
      h('span', {}, label),
      note ? h('small', {}, note) : null
    ),
    detail ? h('span', { class: 'menu-item-detail' }, detail) : null
  );
}

/** A heading between groups of items. Reuses the panels' section styling. */
export function menuSection(label) {
  return h('h5', { class: 'sub-title' }, label);
}

const instances = new Set();

const GAP = 4; // between the trigger and the popup
const EDGE = 8; // keep this far off the viewport edges

/** Shut every menu. Used by outside clicks, Escape, and opening another one. */
export function closeAllMenus() {
  let closed = false;
  for (const menu of instances) {
    if (menu.isOpen()) {
      menu.close();
      closed = true;
    }
  }
  return closed;
}

/**
 * @param {object} def
 * @param {string} def.label      button text
 * @param {string} [def.icon]     path data for `svgPath`
 * @param {string} [def.title]    tooltip
 * @param {boolean} [def.wide]    give the popup room for lists and thumbnails
 * @param {string[]} [def.events] bus events that should rebuild it while open
 * @param {(api: {close: Function, refresh: Function}) => Node} def.build
 */
export function createToolbarMenu(def) {
  let open = false;

  const self = {
    id: def.id,
    isOpen: () => open,
    close: () => setOpen(false),
    place: () => place(),
  };
  instances.add(self);

  const pop = h('div', {
    class: `menu-pop ${def.wide ? 'menu-wide' : ''}`.trim(),
    hidden: true,
  });

  const caret = h('span', { class: 'menu-caret' }, svgPath(mdiMenuDown, 16));

  const trigger = h(
    'button',
    {
      class: 'tb-btn tb-menu',
      title: def.title ?? '',
      onclick: (event) => {
        // Otherwise the document handler below closes it again immediately.
        event.stopPropagation();
        setOpen(!open);
      },
    },
    def.icon ? svgPath(def.icon, 18) : null,
    h('span', {}, def.label),
    caret
  );

  const host = h('div', { class: 'menu-host' }, trigger, pop);
  self.element = host;

  const api = {
    close: () => setOpen(false),
    refresh: () => {
      if (!open) return;
      rebuild();
      place();
    },
  };

  function rebuild() {
    clear(pop);
    const body = def.build(api);
    if (body) pop.append(body);
  }

  /** Anchor under the trigger, clamped so a wide menu never leaves the window. */
  function place() {
    if (!open) return;
    const r = trigger.getBoundingClientRect();

    // Set the height cap first: it can change the width via the scrollbar.
    pop.style.maxHeight = `${Math.max(120, window.innerHeight - r.bottom - GAP - EDGE)}px`;

    const width = pop.offsetWidth;
    const left = Math.min(Math.max(EDGE, r.left), Math.max(EDGE, window.innerWidth - width - EDGE));

    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(r.bottom + GAP)}px`;
  }

  function setOpen(next) {
    if (next === open) return;
    open = next;

    if (open) {
      // One menu at a time, the way a menu bar behaves.
      for (const other of instances) if (other !== self && other.isOpen()) other.close();
      rebuild();
    } else {
      // Drop the body so nothing it built keeps rendering in the background.
      clear(pop);
    }

    pop.hidden = !open;
    trigger.classList.toggle('is-open', open);
    place(); // needs the popup visible to measure, so after the unhide
  }

  // Clicks inside the menu are the user working in it, not dismissing it; a
  // menu that wants to close after an action calls `api.close()` itself.
  pop.addEventListener('click', (event) => event.stopPropagation());

  for (const event of def.events ?? []) {
    on(event, () => api.refresh());
  }

  return host;
}

document.addEventListener('click', () => closeAllMenus());

// Listening on document rather than window means this runs before the editor's
// global shortcuts, so Escape can be consumed by the menu it actually closed.
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (closeAllMenus()) event.stopPropagation();
});

// A fixed popup does not follow its trigger, so re-anchor when the window moves
// under it. Docks resizing emit nothing here, but they cannot move the toolbar.
window.addEventListener('resize', () => {
  for (const menu of instances) menu.place();
});
