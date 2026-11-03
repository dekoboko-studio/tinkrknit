/**
 * Export menu.
 *
 * Everything here ends in files on disk for silver-reed-write to pick up. The
 * important choice is scope: export the *panel* and this tool has already done
 * the repeating, so what you load is literally what gets knitted; export the
 * *tile* and silver-reed-write does the repeating from patternConfig, which
 * keeps the file tiny and lets you change the repeat at the machine.
 *
 * Built on open, which also means `decompose()` - a full pass over the panel -
 * only runs when you are actually looking at it, instead of on every edit.
 *
 * Each format is a single row that writes its files when clicked. The old
 * layout put a label, a description and an Export button on one line, which
 * could not fit the menu's width and gave the popup a horizontal scrollbar.
 */

import { registerMenu, exporters } from '../../core/registry.js';
import { mdiTrayArrowDown, mdiCheck } from '../../icons.js';
import { state } from '../../core/store.js';
import { getTechnique } from '../../model/technique.js';
import { decompose } from '../../export/silverreed.js';
import { h, toast } from '../dom.js';
import { menuItem, menuSection } from '../menu.js';
import { guarded } from '../panels/helpers.js';

let scope = 'panel';

const fail = (error) => toast(error.message, 'error', 6000);

/**
 * Scope as two ticked rows rather than a `<select>`.
 *
 * The dimensions are the project's own, not `decompose()`'s, because the output
 * bitmap is one pixel per stitch either way (CLAUDE.md 4) - so both sizes can
 * be shown without decomposing the piece twice.
 */
function scopeItems(api) {
  const { panel, tile } = state.project;

  return [
    ['panel', 'Whole panel', 'Already repeated here; what you load is what knits', panel],
    ['tile', 'One repeat tile', 'silver-reed-write tiles it from patternConfig', tile],
  ].map(([id, label, title, size]) =>
    menuItem({
      icon: scope === id ? mdiCheck : null,
      label,
      title,
      detail: `${size.w} x ${size.h}`,
      checked: scope === id,
      onclick: () => {
        scope = id;
        api.refresh();
      },
    })
  );
}

/** One wrapped line, not a stat grid: a grid needs width the menu does not have. */
function summary() {
  const { substitutions } = decompose(state.project, scope);
  const rows = new Set(substitutions.map((entry) => entry.row)).size;

  // silver-reed-write is single-bed only, so these files are always Fair Isle.
  if (getTechnique(state.project.technique).id !== 'fairisle') {
    return h(
      'p',
      { class: 'warn-line' },
      'These files are for Fair Isle: two colors per row' +
        (substitutions.length ? `, ${rows} rows reduced.` : '.')
    );
  }

  if (!substitutions.length) {
    return h('p', { class: 'note-line' }, 'Exports exactly as drawn.');
  }

  return h(
    'p',
    { class: 'warn-line' },
    `${substitutions.length} stitches across ${rows} rows had more than two ` +
      'colors and will be reduced to a pair.'
  );
}

function build(api) {
  return h(
    'div',
    { class: 'menu-list' },
    menuSection('Scope'),
    ...scopeItems(api),
    summary(),

    menuSection('Write files'),
    ...exporters.sorted().map((exporter) =>
      menuItem({
        icon: exporter.icon,
        label: exporter.label,
        title: exporter.description,
        onclick: guarded(async () => {
          await exporter.run(state.project, { scope });
          toast(`${exporter.label} written.`, 'ok');
        }, fail),
      })
    )
  );
}

registerMenu({
  id: 'export',
  label: 'Export',
  title: 'Write files for silver-reed-write',
  icon: mdiTrayArrowDown,
  order: 20,
  wide: true,
  events: ['project:changed', 'registry:changed'],
  build,
});
