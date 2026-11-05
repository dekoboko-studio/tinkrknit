/**
 * Open project dialog: the whole saved library, searchable.
 *
 * The Projects menu only lists the five most recent projects, which is what
 * you want most days and useless the day you want last winter's hat. This is
 * the other path: every project as a thumbnail grid, a search box that has
 * focus as soon as it opens, and a sort.
 *
 * A native `<dialog>` opened with `showModal()`: the browser supplies the
 * backdrop, the focus trap, the inert page behind it and Escape-to-close, none
 * of which is worth reimplementing. Keys are stopped at the dialog so the
 * editor's single-letter shortcuts on window never see what is typed here.
 *
 * The left rail holds the views. Tags, when they exist, belong there as more
 * rail entries filtering the same list - the grid and search do not change.
 *
 * Searching always searches the whole library. Recent is a short list, and a
 * search that silently skipped everything older than it found nothing exactly
 * when you needed the dialog.
 */

import { on } from '../core/bus.js';
import { state } from '../core/store.js';
import {
  listProjects, openProject, deleteProject, renameProject, confirmDiscard,
  recentProjects, lastUsed, parseDbTime,
} from './projectStore.js';
import { h, clear, toast } from './dom.js';
import { svgPath, guarded } from './panels/helpers.js';
import {
  mdiMagnify, mdiClose, mdiHistory, mdiViewGridOutline, mdiTrashCanOutline, mdiPencil,
} from '../icons.js';

const RECENT_COUNT = 12;

const SORTS = {
  used: { label: 'Last used', compare: (a, b) => lastUsed(b) - lastUsed(a) },
  edited: { label: 'Last edited', compare: (a, b) => dbMs(b.updated_at) - dbMs(a.updated_at) },
  created: { label: 'Newest first', compare: (a, b) => dbMs(b.created_at) - dbMs(a.created_at) },
  name: {
    label: 'Name A-Z',
    compare: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }),
  },
};

const dbMs = (text) => parseDbTime(text)?.getTime() ?? 0;

const fail = (error) => toast(error.message, 'error', 6000);

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

function ago(ms) {
  if (!ms) return 'never';
  const seconds = (ms - Date.now()) / 1000;
  const steps = [
    [60, 'second'], [60, 'minute'], [24, 'hour'], [7, 'day'], [4.35, 'week'], [12, 'month'],
  ];
  let value = seconds;
  for (const [size, unit] of steps) {
    if (Math.abs(value) < size) return relative.format(Math.round(value), unit);
    value /= size;
  }
  return relative.format(Math.round(value), 'year');
}

const longDate = (ms) =>
  ms ? new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '-';

let ui = null; // built on first open, then reused

function build() {
  const view = { mode: 'recent', query: '', sort: 'used', selected: null, busy: false };
  let shown = []; // the rows currently in the grid, in grid order

  const search = h('input', {
    type: 'search',
    class: 'text pb-search-input',
    placeholder: 'Search projects',
    title: 'Searches every saved project by name',
    oninput: () => {
      view.query = search.value.trim();
      if (view.query) view.mode = 'all';
      renderList();
    },
  });

  const sortSelect = h(
    'select',
    {
      class: 'select pb-sort',
      title: 'Sort order',
      onchange: () => {
        view.sort = sortSelect.value;
        renderList();
      },
    },
    ...Object.entries(SORTS).map(([id, def]) => h('option', { value: id }, def.label))
  );

  const rail = h('nav', { class: 'pb-rail' });
  const grid = h('div', { class: 'pb-grid', role: 'listbox', 'aria-label': 'Saved projects' });
  const heading = h('div', { class: 'pb-heading' });
  const details = h('div', { class: 'pb-details' });

  const deleteBtn = h(
    'button',
    {
      type: 'button',
      class: 'btn danger pb-delete',
      title: 'Delete the selected project permanently  (Del)',
      onclick: () => removeSelected(),
    },
    svgPath(mdiTrashCanOutline, 15),
    h('span', {}, 'Delete')
  );
  const renameBtn = h(
    'button',
    {
      type: 'button',
      class: 'btn pb-rename',
      title: 'Rename the selected project  (F2)',
      onclick: () => renameSelected(),
    },
    svgPath(mdiPencil, 15),
    h('span', {}, 'Rename')
  );
  const openBtn = h('button', {
    type: 'button',
    class: 'btn primary',
    textContent: 'Open',
    title: 'Open the selected project  (Enter)',
    onclick: () => openSelected(),
  });

  const dialog = h(
    'dialog',
    { class: 'pb', 'aria-label': 'Open project' },
    h(
      'header',
      { class: 'pb-head' },
      h('h2', { class: 'pb-title' }, 'Open project'),
      h('label', { class: 'pb-search' }, svgPath(mdiMagnify, 16), search),
      h(
        'button',
        {
          type: 'button',
          class: 'pb-close',
          title: 'Close  (Esc)',
          onclick: () => dialog.close(),
        },
        svgPath(mdiClose, 18)
      )
    ),
    h(
      'div',
      { class: 'pb-body' },
      rail,
      h(
        'section',
        { class: 'pb-main' },
        h('div', { class: 'pb-main-bar' }, heading, sortSelect),
        grid
      )
    ),
    h(
      'footer',
      { class: 'pb-foot' },
      details,
      renameBtn,
      deleteBtn,
      h('button', {
        type: 'button',
        class: 'btn',
        textContent: 'Cancel',
        onclick: () => dialog.close(),
      }),
      openBtn
    )
  );

  document.body.append(dialog);

  // --- data -----------------------------------------------------------------

  function rowsFor() {
    const all = state.projects ?? [];
    if (view.mode === 'recent') return recentProjects(all, RECENT_COUNT);

    const words = view.query.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = all.filter((row) => {
      const name = row.name.toLowerCase();
      return words.every((word) => name.includes(word));
    });
    return matches.sort(SORTS[view.sort].compare);
  }

  const selectedRow = () => shown.find((row) => row.id === view.selected) ?? null;

  // --- rendering --------------------------------------------------------------

  function railItem(mode, icon, label, count) {
    return h(
      'button',
      {
        type: 'button',
        class: `pb-rail-item ${view.mode === mode ? 'is-active' : ''}`.trim(),
        onclick: () => {
          view.mode = mode;
          if (mode === 'recent' && view.query) {
            // Recent with a search in force would show a filtered all.
            view.query = '';
            search.value = '';
          }
          renderList();
          search.focus();
        },
      },
      svgPath(icon, 16),
      h('span', { class: 'grow' }, label),
      count === undefined ? null : h('span', { class: 'pb-count' }, String(count))
    );
  }

  function card(row) {
    const isOpen = state.project.id === row.id;
    return h(
      'button',
      {
        type: 'button',
        class: `pb-card ${row.id === view.selected ? 'is-selected' : ''}`.trim(),
        role: 'option',
        dataset: { id: String(row.id) },
        title: row.name,
        onclick: () => select(row.id),
        ondblclick: () => {
          select(row.id);
          openSelected();
        },
      },
      h(
        'span',
        { class: 'pb-thumb' },
        row.thumbnail ? h('img', { src: row.thumbnail, alt: '' }) : null,
        isOpen ? h('span', { class: 'pb-badge' }, 'Open now') : null
      ),
      h('strong', { class: 'pb-name' }, row.name),
      h('small', {}, `${row.panel_w} x ${row.panel_h}  -  ${ago(lastUsed(row))}`)
    );
  }

  function renderList() {
    const total = (state.projects ?? []).length;

    clear(rail);
    rail.append(
      railItem('recent', mdiHistory, 'Recent'),
      railItem('all', mdiViewGridOutline, 'All projects', total)
    );

    shown = rowsFor();

    heading.textContent = view.query
      ? `${shown.length} matching "${view.query}"`
      : view.mode === 'recent'
        ? 'Recently used'
        : `All projects`;
    sortSelect.hidden = view.mode === 'recent';
    sortSelect.value = view.sort;

    clear(grid);
    if (shown.length) {
      grid.append(...shown.map(card));
    } else {
      grid.append(
        h(
          'p',
          { class: 'hint pb-empty' },
          total === 0
            ? 'No saved projects yet.'
            : `No projects match "${view.query}".`
        )
      );
    }

    // Keep the selection if it is still visible, otherwise take the first, so
    // Enter after typing a search opens the top hit.
    if (!selectedRow()) view.selected = shown[0]?.id ?? null;
    select(view.selected, { scroll: false });
  }

  function select(id, { scroll = true } = {}) {
    view.selected = id;
    for (const node of grid.querySelectorAll('.pb-card')) {
      const hit = Number(node.dataset.id) === id;
      node.classList.toggle('is-selected', hit);
      node.setAttribute('aria-selected', String(hit));
      if (hit && scroll) node.scrollIntoView({ block: 'nearest' });
    }
    renderDetails();
  }

  function renderDetails() {
    const row = selectedRow();
    openBtn.disabled = !row || view.busy;
    deleteBtn.disabled = !row || view.busy;
    renameBtn.disabled = !row || view.busy;

    clear(details);
    if (!row) return;
    details.append(
      h('strong', {}, row.name),
      h(
        'small',
        {},
        `Panel ${row.panel_w} x ${row.panel_h}  -  tile ${row.tile_w} x ${row.tile_h}  -  ` +
          `edited ${longDate(dbMs(row.updated_at))}`
      )
    );
  }

  // --- actions ----------------------------------------------------------------

  const openSelected = guarded(async () => {
    const row = selectedRow();
    if (!row || view.busy) return;

    // Already open and unchanged: reloading it would only clear undo history.
    if (row.id === state.project.id && !state.dirty) {
      dialog.close();
      return;
    }
    if (!confirmDiscard()) return;
    view.busy = true;
    renderDetails();
    try {
      await openProject(row.id);
      dialog.close();
      toast(`Opened ${row.name}.`, 'ok');
    } finally {
      view.busy = false;
      renderDetails();
    }
  }, fail);

  const removeSelected = guarded(async () => {
    const row = selectedRow();
    if (!row || view.busy) return;
    if (!confirm(`Delete "${row.name}"? This cannot be undone.`)) return;

    // Land on the neighbor rather than jumping back to the top of the grid.
    const index = shown.indexOf(row);
    view.selected = (shown[index + 1] ?? shown[index - 1])?.id ?? null;

    await deleteProject(row.id); // relists, which re-renders via the bus
    toast('Project deleted.', 'ok');
  }, fail);

  const renameSelected = guarded(async () => {
    const row = selectedRow();
    if (!row || view.busy) return;
    const name = prompt('Rename project', row.name)?.trim();
    if (!name || name === row.name) return;
    await renameProject(row.id, name); // relists, which re-renders via the bus
    toast(`Renamed to ${name}.`, 'ok');
  }, fail);

  // --- keyboard ---------------------------------------------------------------

  /** Columns in the grid as laid out now, for Up and Down. */
  function columns() {
    const tracks = getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean);
    return Math.max(1, tracks.length);
  }

  function move(step) {
    if (!shown.length) return;
    const index = shown.findIndex((row) => row.id === view.selected);
    const next = Math.max(0, Math.min(shown.length - 1, (index < 0 ? 0 : index) + step));
    select(shown[next].id);
  }

  dialog.addEventListener('keydown', (event) => {
    // The editor's shortcuts live on window; nothing typed here is for them.
    event.stopPropagation();

    const inSearch = event.target === search;
    const onCard = event.target.classList?.contains('pb-card');
    if (!inSearch && !onCard) return; // footer buttons keep their own keys

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        return move(columns());
      case 'ArrowUp':
        event.preventDefault();
        return move(-columns());
      case 'ArrowRight':
        // In the search box Left and Right move the caret, as they should.
        if (onCard) {
          event.preventDefault();
          move(1);
        }
        return;
      case 'ArrowLeft':
        if (onCard) {
          event.preventDefault();
          move(-1);
        }
        return;
      case 'Enter':
        event.preventDefault();
        return openSelected();
      case 'F2':
        if (onCard) {
          event.preventDefault();
          renameSelected();
        }
        return;
      case 'Delete':
        if (onCard) {
          event.preventDefault();
          removeSelected();
        }
        return;
      default:
        // Typing on a card goes to the search box, the way a file dialog behaves.
        if (onCard && event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
          search.focus();
        }
    }
  });

  // A click on the backdrop lands on the dialog element itself.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });

  on('library:changed', () => {
    if (dialog.open) renderList();
  });

  return {
    open() {
      view.mode = 'recent';
      view.query = '';
      search.value = '';
      // Start on what is open now, so a stray Enter just closes the dialog.
      view.selected = state.project.id ?? null;
      renderList();
      dialog.showModal();
      search.focus();

      // Another tab may have saved since the list was fetched.
      listProjects().catch(fail);
    },
  };
}

export function openProjectBrowser() {
  ui ??= build();
  ui.open();
}
