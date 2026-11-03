/**
 * Rearrangeable panel docking.
 *
 * Panels register themselves (CLAUDE.md 3.3) with a default dock; the user can
 * drag any panel's header into another dock, collapse it, or hide it, and the
 * arrangement persists per browser. Panel bodies are rendered once and then
 * *moved* between docks with appendChild, so a panel never loses its DOM state
 * or event listeners when it is rearranged.
 */

import { panels } from '../core/registry.js';
import { h, clear } from './dom.js';
import { emit } from '../core/bus.js';
import { svgPath } from './panels/helpers.js';

const LAYOUT_KEY = 'knit-designer-layout-v1';
const DOCK_IDS = ['left', 'right', 'bottom'];

export function createDockManager(elements) {
  /** @type {Record<string, {dock: string, order: number, collapsed: boolean, hidden: boolean}>} */
  let layout = load();
  const bodies = new Map(); // panelId -> rendered body element
  let dragging = null;

  function load() {
    try {
      return JSON.parse(localStorage.getItem(LAYOUT_KEY)) ?? {};
    } catch {
      return {};
    }
  }

  function save() {
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
    } catch {
      // Private browsing or a full quota; the layout simply will not persist.
    }
  }

  function entryFor(def) {
    if (!layout[def.id]) {
      layout[def.id] = {
        dock: DOCK_IDS.includes(def.dock) ? def.dock : 'left',
        order: def.order ?? 100,
        collapsed: Boolean(def.collapsed),
        hidden: false,
      };
    }
    return layout[def.id];
  }

  function bodyFor(def) {
    if (!bodies.has(def.id)) {
      const body = h('div', { class: 'panel-body' });
      def.render(body);
      bodies.set(def.id, body);
    }
    return bodies.get(def.id);
  }

  function card(def) {
    const entry = entryFor(def);
    const body = bodyFor(def);

    const toggle = () => {
      entry.collapsed = !entry.collapsed;
      save();
      render();
    };

    // The whole band is the toggle, not just the +/- at its end: it is the
    // biggest target in the panel. A drag never ends in a click, so moving
    // the panel by the same band does not also fold it.
    const header = h(
      'div',
      {
        class: 'panel-head',
        draggable: true,
        title: `Click to ${entry.collapsed ? 'expand' : 'collapse'}, drag to move to another dock`,
        onclick: toggle,
        ondragstart: (event) => {
          dragging = def.id;
          event.dataTransfer.effectAllowed = 'move';
          // Firefox needs data set or the drag never starts.
          event.dataTransfer.setData('text/plain', def.id);
        },
        ondragend: () => {
          dragging = null;
          document.body.classList.remove('dragging-panel');
        },
      },
      // The icon and a full-strength title are what tell a panel heading from
      // the section headings inside it, which used to be the same small
      // uppercase gray and read as one long list.
      def.icon ? h('span', { class: 'panel-icon' }, svgPath(def.icon, 16)) : null,
      h('span', { class: 'panel-title' }, def.title),
      h('span', { class: 'panel-grip', 'aria-hidden': 'true' }, '⋮⋮'),
      // Still a button, for the keyboard; its click bubbles to the header.
      h('button', {
        type: 'button',
        class: 'panel-toggle',
        title: entry.collapsed ? 'Expand' : 'Collapse',
        textContent: entry.collapsed ? '+' : '−',
      })
    );

    header.addEventListener('dragstart', () =>
      document.body.classList.add('dragging-panel')
    );

    const el = h(
      'section',
      {
        class: `panel ${entry.collapsed ? 'is-collapsed' : ''} ${def.grow ? 'panel-grow' : ''}`,
        dataset: { panel: def.id },
      },
      header
    );
    if (!entry.collapsed) el.append(body);
    return el;
  }

  function render() {
    const visible = panels
      .all()
      .filter((def) => !entryFor(def).hidden)
      .sort((a, b) => entryFor(a).order - entryFor(b).order);

    for (const dockId of DOCK_IDS) {
      const host = elements[dockId];
      if (!host) continue;
      clear(host);

      const mine = visible.filter((def) => entryFor(def).dock === dockId);
      for (const def of mine) host.append(card(def));

      host.classList.toggle('is-empty', mine.length === 0);
    }
    emit('dock:rendered', {});
  }

  // --- drop targets ---------------------------------------------------------

  for (const dockId of DOCK_IDS) {
    const host = elements[dockId];
    if (!host) continue;

    host.addEventListener('dragover', (event) => {
      if (!dragging) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      host.classList.add('drop-target');
    });

    host.addEventListener('dragleave', () => host.classList.remove('drop-target'));

    host.addEventListener('drop', (event) => {
      host.classList.remove('drop-target');
      if (!dragging) return;
      event.preventDefault();

      const entry = layout[dragging];
      if (!entry) return;

      // Drop order follows the card you dropped onto, so panels can be
      // reordered within a dock as well as moved between them.
      const target = event.target.closest?.('[data-panel]');
      entry.dock = dockId;
      if (target && target.dataset.panel !== dragging) {
        entry.order = (layout[target.dataset.panel]?.order ?? 100) - 1;
      }
      dragging = null;
      save();
      render();
    });
  }

  return {
    render,

    setHidden(panelId, hidden) {
      if (!layout[panelId]) return;
      layout[panelId].hidden = hidden;
      save();
      render();
    },

    isHidden: (panelId) => Boolean(layout[panelId]?.hidden),

    /** Show, expand and scroll to a panel, wherever the user has docked it. */
    reveal(panelId) {
      const entry = layout[panelId];
      if (!entry) return;
      const changed = entry.hidden || entry.collapsed;
      entry.hidden = false;
      entry.collapsed = false;
      if (changed) {
        save();
        render();
      }
      const el = Object.values(elements)
        .map((host) => host?.querySelector(`[data-panel="${panelId}"]`))
        .find(Boolean);
      el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      el?.classList.add('is-flash');
      setTimeout(() => el?.classList.remove('is-flash'), 900);
    },

    list: () =>
      panels.all().map((def) => ({
        id: def.id,
        title: def.title,
        hidden: Boolean(layout[def.id]?.hidden),
      })),

    reset() {
      layout = {};
      save();
      render();
    },
  };
}

/**
 * Drag-to-resize for the side docks. Widths live in CSS custom properties so
 * the grid can stay declarative. Returns `{ reset }`.
 */
export function createResizer(handle, { property, min = 180, max = 620, invert = false }) {
  // Firefox throws on any localStorage access when site data is blocked, and
  // this runs during bootstrap: unguarded, it took the whole page down.
  let stored = null;
  try {
    stored = localStorage.getItem(`knit-designer-${property}`);
  } catch {}
  if (stored) document.documentElement.style.setProperty(property, `${stored}px`);

  handle.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);

    const startX = event.clientX;
    const startWidth = parseInt(
      getComputedStyle(document.documentElement).getPropertyValue(property),
      10
    );

    const move = (moveEvent) => {
      const delta = (moveEvent.clientX - startX) * (invert ? -1 : 1);
      const width = Math.max(min, Math.min(max, startWidth + delta));
      document.documentElement.style.setProperty(property, `${width}px`);
    };

    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      const final = parseInt(
        getComputedStyle(document.documentElement).getPropertyValue(property),
        10
      );
      try {
        localStorage.setItem(`knit-designer-${property}`, String(final));
      } catch {}
      emit('layout:resized', { property, width: final });
    };

    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  });

  return {
    /** Back to the stylesheet's width, forgetting the stored one. */
    reset() {
      document.documentElement.style.removeProperty(property);
      try {
        localStorage.removeItem(`knit-designer-${property}`);
      } catch {}
      emit('layout:resized', { property });
    },
  };
}
