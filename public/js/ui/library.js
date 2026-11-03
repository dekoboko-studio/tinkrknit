/**
 * Library: what you own across every project, as opposed to Project settings,
 * which is this design only.
 *
 * Yarns live in SQLite, not in the project, so the same cone of cream is one
 * record shared by every project you design. Linking a palette slot to a yarn (in
 * the Colors panel) copies its color in and names the slot, which is what
 * makes an exported plan say "Cream" instead of "slot 3".
 *
 * Stamps are the reuse mechanism for motifs: draw a snowflake once, save it,
 * drop it into any project. Picking one to place is part of drawing, so that
 * stays in the Stamps panel; deleting one from the collection is managing the
 * library, so it is here.
 *
 * Yarn stock used to be a collapsed panel in the left dock, between the tools
 * and the stamps, which said it belonged to the design. It does not.
 */

import { state, setLibrary, setUI } from '../core/store.js';
import { api } from '../api.js';
import { thumbnail, materialize } from '../editor/stamps.js';
import { h, row, button, field, toast } from './dom.js';
import { guarded, svgPath } from './panels/helpers.js';
import { parseDbTime } from './projectStore.js';
import { createTabbedDialog } from './dialog.js';
import { mdiBookshelf, mdiSheep, mdiStamper, mdiMagnify } from '../icons.js';

export async function loadYarns() {
  setLibrary('yarns', await api.list('yarns', { archived: 0 }));
}

export async function loadStamps() {
  // The API's default page is 200 rows; a stamp library outgrows that first.
  setLibrary('stamps', await api.list('stamps', { limit: 500 }));
}

/**
 * When each stamp was last picked, per browser, the way recent projects are
 * kept (ui/projectStore.js): it is about who used what, not about the stamp.
 * The Stamps panel shows the most recent few; the Library shows them all.
 */
const RECENT_KEY = 'knit-designer:recent-stamps';

function readRecent() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY)) ?? {};
  } catch {
    return {};
  }
}

function touchRecent(id) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify({ ...readRecent(), [id]: Date.now() }));
  } catch {
    // Storage full or blocked: recents fall back to the newest stamps.
  }
}

/** Last picked, else when it was saved, in ms. */
function lastUsed(rowData, recent = readRecent()) {
  return recent[rowData.id] ?? parseDbTime(rowData.created_at)?.getTime() ?? 0;
}

/** Stamps by last use, newest first. */
export function recentStamps(limit = Infinity) {
  const recent = readRecent();
  return [...(state.stamps ?? [])].sort((a, b) => lastUsed(b, recent) - lastUsed(a, recent)).slice(0, limit);
}

/**
 * Tags are one text column, comma separated, lower case. Free text rather than
 * a table of tags: there are a few dozen at most, and the list of tags in use
 * is read straight off the stamps.
 */
export function parseTags(text) {
  return [...new Set(String(text ?? '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))];
}

const formatTags = (tags) => tags.join(', ');

/** Make a library stamp the one the Stamp tool places, and pick that tool. */
export function pickStamp(rowData) {
  touchRecent(rowData.id);
  const record = { w: rowData.w, h: rowData.h, cells: rowData.cells, colors: rowData.colors };
  setUI({
    activeStamp: {
      id: rowData.id,
      name: rowData.name,
      record,
      bitmap: materialize(record, state.project.palette),
    },
    tool: 'stamp',
  });
}

const fail = (error) => toast(error.message, 'error', 6000);

/** A titled group, matching Project settings. */
function group(title, note, ...children) {
  return h(
    'section',
    { class: 'dlg-group' },
    h('h3', { class: 'dlg-group-title', title: note ?? undefined }, title),
    ...children
  );
}

// --- yarns -------------------------------------------------------------------

const draft = { name: '', brand: '', color: '#c8c2b4', fiber: '', weight: '', grams: 50 };

function yarnRow(yarn) {
  const inUse = state.project.palette.some((slot) => String(slot.yarnId) === String(yarn.id));
  return h(
    'div',
    { class: 'yarn-row' },
    h('i', { class: 'dot', style: { background: yarn.color } }),
    h(
      'div',
      { class: 'grow' },
      h('strong', {}, yarn.name),
      h(
        'small',
        {},
        [yarn.brand, yarn.fiber, yarn.weight, yarn.grams ? `${yarn.grams}g` : null]
          .filter(Boolean)
          .join(' - ')
      )
    ),
    inUse ? h('span', { class: 'tag tag-ok', title: 'Linked to a color in the open project' }, 'in project') : null,
    button({
      label: 'Archive',
      variant: 'ghost',
      title: 'Archive this yarn. It stays in the database but leaves the list.',
      onclick: guarded(async () => {
        await api.update('yarns', yarn.id, { ...yarn, archived: 1 });
        await loadYarns();
      }, fail),
    })
  );
}

function newYarnForm(dlg) {
  const text = (key, label, placeholder) =>
    field(
      label,
      h('input', {
        type: 'text',
        class: 'text',
        value: draft[key],
        placeholder,
        oninput: (event) => {
          draft[key] = event.target.value;
        },
      })
    );

  return group(
    'Add yarn',
    null,
    row(
      text('name', 'Name', 'Cream'),
      text('brand', 'Brand', 'Jamieson'),
      field(
        'Color',
        h('input', {
          type: 'color',
          class: 'color-input',
          value: draft.color,
          oninput: (event) => {
            draft.color = event.target.value;
          },
        })
      )
    ),
    row(text('fiber', 'Fiber', 'Shetland wool'), text('weight', 'Weight', '4ply'), text('grams', 'Grams', '25')),
    row(
      button({
        label: 'Save yarn',
        variant: 'primary',
        onclick: guarded(async () => {
          if (!draft.name.trim()) {
            toast('Give the yarn a name first.', 'warn');
            return;
          }
          await api.create('yarns', {
            ...draft,
            grams: Number(draft.grams) || null,
            archived: 0,
          });
          draft.name = '';
          draft.brand = '';
          await loadYarns();
          toast('Yarn saved.', 'ok');
        }, fail),
      }),
      button({
        label: 'Use selected slot color',
        title: 'Start from the color currently selected in the Colors panel.',
        onclick: () => {
          draft.color = state.project.palette[state.primary]?.color ?? draft.color;
          dlg.redraw();
        },
      })
    )
  );
}

function yarnsPage(dlg) {
  const yarns = state.yarns ?? [];
  return h(
    'div',
    { class: 'dlg-groups' },
    group(
      `Yarn stock (${yarns.length})`,
      'Link a yarn to a color slot from the Colors panel.',
      yarns.length
        ? h('div', { class: 'list' }, ...yarns.map(yarnRow))
        : h('p', { class: 'hint' }, 'No yarns yet.')
    ),
    newYarnForm(dlg)
  );
}

// --- stamps ------------------------------------------------------------------

/**
 * Search and filters, kept while the dialog is shut so reopening it finds the
 * same view. Typing filters the grid in place rather than rebuilding the page,
 * which would take the search box away mid-word.
 */
const view = { query: '', tag: null, sort: 'recent' };

const SORTS = [
  ['recent', 'Recently used'],
  ['name', 'Name'],
  ['newest', 'Newest'],
  ['size', 'Size'],
];

function sorted(stamps) {
  if (view.sort === 'recent') {
    const keep = new Set(stamps);
    return recentStamps().filter((s) => keep.has(s));
  }
  const by = {
    name: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
    newest: (a, b) => (parseDbTime(b.created_at)?.getTime() ?? 0) - (parseDbTime(a.created_at)?.getTime() ?? 0),
    size: (a, b) => a.w * a.h - b.w * b.h || a.name.localeCompare(b.name),
  }[view.sort];
  return [...stamps].sort(by);
}

/** Every word typed must appear in the name or a tag. */
function matches(rowData) {
  const tags = parseTags(rowData.tags);
  if (view.tag && !tags.includes(view.tag)) return false;
  const hay = [rowData.name.toLowerCase(), ...tags].join(' ');
  return view.query.toLowerCase().split(/\s+/).filter(Boolean).every((word) => hay.includes(word));
}

/** Save a name or tags edit. A blank name is put back rather than saved. */
async function saveStamp(rowData, patch) {
  if (patch.name !== undefined && !patch.name) {
    await loadStamps();
    return;
  }
  await api.update('stamps', rowData.id, patch);
  if (patch.name && state.activeStamp?.id === rowData.id) {
    setUI({ activeStamp: { ...state.activeStamp, name: patch.name } });
  }
  await loadStamps();
}

const blurOnEnter = (event) => event.key === 'Enter' && event.target.blur();

function tagChip(tag, dlg, count) {
  const on = view.tag === tag;
  return h(
    'button',
    {
      type: 'button',
      class: `chip ${on ? 'is-on' : ''}`,
      title: on ? 'Show every tag again' : `Show only stamps tagged ${tag}`,
      onclick: () => {
        view.tag = on ? null : tag;
        dlg.redraw();
      },
    },
    tag,
    count !== undefined ? h('small', {}, String(count)) : null
  );
}

function stampCard(rowData, dlg) {
  const record = { w: rowData.w, h: rowData.h, cells: rowData.cells, colors: rowData.colors };
  const tags = parseTags(rowData.tags);
  const place = () => {
    pickStamp(rowData);
    dlg.close();
  };
  return h(
    'div',
    { class: `lib-stamp ${state.activeStamp?.id === rowData.id ? 'is-active' : ''}` },
    h(
      'button',
      { type: 'button', class: 'lib-stamp-thumb', title: `Place "${rowData.name}"`, onclick: place },
      thumbnail(record, state.project.palette, 64)
    ),
    h('input', {
      type: 'text',
      class: 'text lib-stamp-name',
      value: rowData.name,
      title: `Name of stamp ${rowData.id}`,
      onchange: guarded((event) => saveStamp(rowData, { name: event.target.value.trim() }), fail),
      onkeydown: blurOnEnter,
    }),
    h('small', {}, `${rowData.w} x ${rowData.h}`),
    h('input', {
      type: 'text',
      class: 'text lib-stamp-tags',
      value: formatTags(tags),
      placeholder: 'add tags',
      title: `Tags of stamp ${rowData.id}, separated by commas`,
      onchange: guarded((event) => saveStamp(rowData, { tags: formatTags(parseTags(event.target.value)) }), fail),
      onkeydown: blurOnEnter,
    }),
    h(
      'div',
      { class: 'row' },
      button({ label: 'Place', title: 'Pick this stamp and switch to the Stamp tool.', onclick: place }),
      button({
        label: 'Delete',
        variant: 'danger',
        title: 'Delete this stamp from the library',
        onclick: guarded(async () => {
          if (!confirm(`Delete the stamp "${rowData.name}"?`)) return;
          await api.remove('stamps', rowData.id);
          if (state.activeStamp?.id === rowData.id) setUI({ activeStamp: null });
          await loadStamps();
        }, fail),
      })
    )
  );
}

/** Tags in use with their counts, most used first. */
function tagCounts(stamps) {
  const counts = new Map();
  for (const s of stamps) for (const tag of parseTags(s.tags)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function stampsPage(dlg) {
  const stamps = state.stamps ?? [];
  const tags = tagCounts(stamps);
  if (view.tag && !tags.some(([tag]) => tag === view.tag)) view.tag = null;

  const count = h('span', { class: 'muted lib-stamp-count' });
  const results = h('div', {});
  const fillResults = () => {
    const shown = sorted(stamps.filter(matches));
    results.replaceChildren(
      shown.length
        ? h('div', { class: 'lib-stamp-grid' }, ...shown.map((s) => stampCard(s, dlg)))
        : h('p', { class: 'hint' }, stamps.length ? 'No stamps match.' : 'No stamps yet.')
    );
    count.textContent = shown.length === stamps.length ? `${stamps.length} stamps` : `${shown.length} of ${stamps.length}`;
  };

  const page = h(
    'div',
    { class: 'dlg-groups' },
    group(
      'Stamps',
      'Shown in the open project\'s colors. Save new ones from a selection in the Stamps panel. ' +
        'Edit a name or the tags under it in place; click a tag above the grid to filter by it.',
      h(
        'div',
        { class: 'lib-stamp-bar' },
        h(
          'label',
          { class: 'pb-search lib-search', title: 'Search names and tags' },
          svgPath(mdiMagnify, 16),
          h('input', {
            type: 'search',
            class: 'text',
            value: view.query,
            placeholder: 'Search stamps',
            title: 'Search stamps',
            oninput: (event) => {
              view.query = event.target.value;
              fillResults();
            },
          })
        ),
        h(
          'select',
          {
            class: 'select',
            title: 'Sort stamps',
            onchange: (event) => {
              view.sort = event.target.value;
              fillResults();
            },
          },
          ...SORTS.map(([id, label]) => h('option', { value: id, selected: id === view.sort }, label))
        ),
        count
      ),
      tags.length
        ? h('div', { class: 'lib-tags lib-tag-filter' }, ...tags.map(([tag, n]) => tagChip(tag, dlg, n)))
        : null,
      results
    )
  );
  fillResults();
  return page;
}

// --- the dialog --------------------------------------------------------------

let dialog = null;

/** @param {'yarns'|'stamps'} [tab] */
export function openLibrary(tab) {
  dialog ??= createTabbedDialog({
    title: 'Library',
    subtitle: 'shared by every project',
    icon: mdiBookshelf,
    tabs: [
      { id: 'yarns', label: 'Yarn stock', icon: mdiSheep, build: yarnsPage, events: ['library:changed', 'project:changed'] },
      { id: 'stamps', label: 'Stamps', icon: mdiStamper, build: stampsPage, events: ['library:changed', 'project:changed'] },
    ],
  });
  dialog.open(tab);
}
