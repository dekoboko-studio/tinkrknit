/**
 * Stamps: pick one to place, open the whole library, or save the selection
 * as a new one.
 *
 * Stamps are the reuse mechanism for motifs: draw a snowflake once, save it,
 * drop it into any project. They carry the colors they were captured with and
 * are matched to the nearest slots of whatever palette they land in, so a stamp
 * is portable rather than tied to one project's palette.
 *
 * Deleting stamps is managing the library, which is global, so it is in the
 * Library dialog (ui/library.js); this panel is only what you do while drawing.
 *
 * Flip, rotate and transparency are not here: they only mean something with the
 * stamp tool in hand, so they live in the options bar above the grid alongside
 * every other tool's settings.
 */

import { registerPanel } from '../../core/registry.js';
import { state } from '../../core/store.js';
import { thumbnail } from '../../editor/stamps.js';
import { mdiStamper } from '../../icons.js';
import { pickStamp, openLibrary, recentStamps } from '../library.js';
import { saveSelectionAsStamp } from '../selectionActions.js';
import { h, button } from '../dom.js';
import { reactive } from './helpers.js';

function stampTile(rowData) {
  const record = { w: rowData.w, h: rowData.h, cells: rowData.cells, colors: rowData.colors };
  const active = state.activeStamp?.id === rowData.id;

  return h(
    'div',
    { class: `stamp-tile ${active ? 'is-active' : ''}` },
    h(
      'button',
      {
        class: 'stamp-pick',
        title: `${rowData.name}  ${rowData.w} x ${rowData.h}`,
        onclick: () => pickStamp(rowData),
      },
      thumbnail(record, state.project.palette, 44),
      h('span', { class: 'icon-label' }, rowData.name)
    )
  );
}

/**
 * One way into making a stamp; the other is the Select tool's options bar,
 * which also has copy, cut, clear and crop.
 */
function saveButton() {
  const sel = state.selection;
  return button({
    label: 'Save selection as stamp',
    variant: sel ? 'primary' : '',
    disabled: !sel,
    title: sel
      ? `Store the selected ${sel.w} x ${sel.h} area in the stamp library.`
      : 'Drag a box with the Select tool (M) first.',
    onclick: saveSelectionAsStamp,
  });
}

/**
 * The panel is for the few stamps in use right now, so it shows the most
 * recently picked and leaves the whole collection, with search and tags, to
 * the Library. They are laid out by name, not by when they were used: picking
 * one would otherwise move it to the front and shuffle the tile you were about
 * to click next.
 */
const RECENT_SHOWN = 12;

function build() {
  const total = state.stamps?.length ?? 0;
  const shown = recentStamps(RECENT_SHOWN)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

  return h(
    'div',
    { class: 'stack' },
    total
      ? h('div', { class: 'stamp-grid' }, ...shown.map(stampTile))
      : h('p', { class: 'hint', title: 'Select an area and save it.' }, 'No stamps yet.'),
    h(
      'div',
      { class: 'stamp-actions' },
      button({
        label: total > shown.length ? `All stamps (${total})` : 'All stamps',
        title: 'Search, tag, rename and delete stamps in the Library',
        onclick: () => openLibrary('stamps'),
      }),
      saveButton()
    )
  );
}

registerPanel({
  id: 'stamps',
  title: 'Stamps',
  icon: mdiStamper,
  dock: 'left',
  order: 50,
  collapsed: true,
  render: (host) =>
    reactive(host, build, ['library:changed', 'ui:changed', 'project:changed']),
});
