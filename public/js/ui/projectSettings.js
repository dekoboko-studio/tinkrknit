/**
 * Project settings: everything that belongs to *this* design and is set a few
 * times per project rather than looked at while drawing.
 *
 *   Size        the panel (the finished piece), the tile (what you edit), repeat
 *   Gauge       swatch gauge: stitches and rows per 10cm (the calculators read it)
 *   Yarn        how much of each color the panel takes
 *   Details     name, knit technique, notes
 *
 * These were two docked panels, Project settings and Gauge & sizing, that sat
 * in the right dock for the whole session. Size is the first thing a new
 * project needs and was the hardest thing to find; it is now one click from the
 * size chip in the status bar, and New project opens straight onto it.
 *
 * The garment calculators (hat, ...) are their own dialog, ui/calculators.js:
 * they are tools that write a panel size, not settings of the project.
 *
 * Global things - the yarns you own, the stamp library - are in the Library
 * dialog (ui/library.js), never here. That line is the point of the split.
 *
 * Two grids matter: the *tile* is what you edit, the *panel* is the finished
 * piece. The panel is the tile repeated, aligned and clipped. Keeping the tile
 * width a divisor of the panel width means the repeat lands flush at both
 * selvages instead of ending mid-motif, which is why "snap to divisors" is on
 * by default.
 *
 * Gauge is the bridge between stitches and centimeters, so it drives the panel
 * size, the measurements shown elsewhere and the aspect ratio of the knit
 * preview. Always swatch in the actual pattern: Fair Isle floats pull a fabric
 * in, so a stocking-stitch swatch will lie to you.
 */

import { state, commit } from '../core/store.js';
import {
  resizeTile, resizePanel, divisors, nearestDivisor, expandPanel,
} from '../model/project.js';
import { cmForStitches, cmForRows, estimateYarn, colorShares, stitchAspect } from '../model/gauge.js';
import { h, row, field, numberInput, select, checkbox, button, toast } from './dom.js';
import { renameOpenProject } from './projectStore.js';
import { getTechnique, techniqueList } from '../model/technique.js';
import { stat, cmLabel } from './panels/helpers.js';
import { rowLayout, panelRows, panelPassesFor, drawnGauge, rowGauge } from '../model/rows.js';
import { compilePasses, stitchOf } from '../model/passes.js';
import { SLIP } from '../model/stitch.js';
import { createTabbedDialog } from './dialog.js';
import { openCalculator } from './calculators.js';
import {
  mdiTune, mdiAspectRatio, mdiTapeMeasure, mdiWeight, mdiNoteTextOutline,
} from '../icons.js';

/** A titled group of fields: the unit a settings page is built from. */
function group(title, note, ...children) {
  return h(
    'section',
    { class: 'dlg-group' },
    h('h3', { class: 'dlg-group-title', title: note ?? undefined }, title),
    ...children
  );
}

// --- Size --------------------------------------------------------------------

function panelGroup(project, api) {
  const gauge = project.gauge;
  const layout = rowLayout(project);
  const rows = panelRows(project);

  return group(
    'Panel',
    'The finished piece: needles across, rows from cast-on to bind-off.',
    row(
      field(
        'Stitches',
        numberInput({
          value: project.panel.w,
          min: 1,
          max: 400,
          title: 'Needles across.',
          onchange: (v) => commit('resize panel', (p) => resizePanel(p, v, p.panel.h)),
        }),
        cmLabel(cmForStitches(project.panel.w, gauge.stsPer10))
      ),
      field(
        'Rows',
        numberInput({
          value: rows,
          min: 1,
          max: 2000,
          title: layout
            ? 'Drawn rows from cast-on to bind-off. The panel takes the passes those rows need.'
            : 'Rows from cast-on to bind-off.',
          onchange: (v) => commit('resize panel', (p) => resizePanel(p, p.panel.w, panelPassesFor(p, v))),
        }),
        cmLabel(cmForRows(rows, rowGauge(project))) + (layout ? ` · ${project.panel.h} passes` : '')
      )
    ),
    h('p', { class: 'hint' },
      h('button', { type: 'button', class: 'link', title: 'Size the panel for a garment in Calculators', onclick: () => { api.close(); openCalculator(); } }, 'Size from a calculator'))
  );
}

function tileGroup(project) {
  const snap = project.snapToDivisors;
  const layout = rowLayout(project);
  const setTile = (w, hh) =>
    commit('resize tile', (p) => {
      const width = snap ? nearestDivisor(p.panel.w, w) : w;
      resizeTile(p, width, hh);
    });

  return group(
    'Repeat tile',
    'What you draw on the grid. The panel repeats it.',
    row(
      field(
        'Stitches',
        numberInput({
          value: project.tile.w,
          min: 1,
          max: 400,
          title: snap
            ? `Snapped to a divisor of the panel width (${divisors(project.panel.w).join(', ')})`
            : 'Tile width in stitches.',
          onchange: (v) => setTile(v, project.tile.h),
        })
      ),
      layout
        ? stat(
            'Rows',
            `${layout.span} (${project.tile.h} passes)`,
            'A stitch chart made from colors. Its rows are the drawing\'s; Back to colors in the Stitches panel to change them.'
          )
        : field(
            'Rows',
            numberInput({
              value: project.tile.h,
              min: 1,
              max: 400,
              title: 'Tile height in rows. Growing a tile keeps the cast-on edge fixed.',
              onchange: (v) => setTile(project.tile.w, v),
            })
          )
    ),
    checkbox({
      label: 'Snap tile width to panel divisors',
      checked: snap,
      title:
        'Keeps the horizontal repeat flush at both edges. Turn off for a motif ' +
        'that is meant to run off the sides.' +
        (snap ? `\nWidths that fit ${project.panel.w}: ${divisors(project.panel.w).join(', ')}` : ''),
      onchange: (v) =>
        commit('snap setting', (p) => {
          p.snapToDivisors = v;
        }),
    })
  );
}

function repeatGroup(project) {
  const r = project.repeat;
  const set = (patch) =>
    commit('repeat setting', (p) => {
      Object.assign(p.repeat, patch);
    });

  return group(
    'Repeat',
    null,
    row(
      checkbox({
        label: 'Across',
        checked: r.horizontal,
        title: 'Tile sideways to fill the panel width.',
        onchange: (v) => set({ horizontal: v }),
      }),
      checkbox({
        label: 'Up',
        checked: r.vertical,
        title: 'Tile upward to fill the panel height.',
        onchange: (v) => set({ vertical: v }),
      })
    ),
    field(
      'Alignment',
      select({
        value: r.alignment,
        title: 'Where a non-repeating tile sits across the needle bed.',
        options: [
          ['center', 'Center'],
          ['left', 'Left'],
          ['right', 'Right'],
        ],
        onchange: (v) => set({ alignment: v }),
      })
    ),
    stat(
      'Repeats',
      `${Math.ceil(project.panel.w / project.tile.w)} across, ` +
        `${Math.ceil(panelRows(project) / (rowLayout(project)?.span ?? project.tile.h))} up`,
      'How many times the tile lands in the panel.'
    ),
    h(
      'div',
      { class: 'row' },
      button({
        label: 'Fit panel to whole tiles',
        title: 'Round the panel up so the repeat finishes cleanly in both directions.',
        onclick: () =>
          commit('fit panel', (p) => {
            const w = Math.ceil(p.panel.w / p.tile.w) * p.tile.w;
            const hh = Math.ceil(p.panel.h / p.tile.h) * p.tile.h;
            resizePanel(p, w, hh);
          }),
      })
    )
  );
}

function sizePage(api) {
  const project = state.project;
  return h(
    'div',
    { class: 'dlg-groups' },
    panelGroup(project, api),
    tileGroup(project),
    repeatGroup(project)
  );
}

// --- Gauge ------------------------------------------------------------------

function gaugeGroup(project) {
  const g = project.gauge;
  const drawn = drawnGauge(project);
  return group(
    'Gauge',
    'Measured on a swatch knitted in the pattern itself: floats pull Fair Isle in.',
    row(
      field(
        'Sts / 10cm',
        numberInput({
          value: g.stsPer10,
          min: 5,
          max: 100,
          step: 0.5,
          title: 'Stitches across 10cm of your swatch.',
          onchange: (v) =>
            commit('gauge', (p) => {
              p.gauge.stsPer10 = v;
            }),
        })
      ),
      field(
        'Rows / 10cm',
        numberInput({
          value: g.rowsPer10,
          min: 5,
          max: 140,
          step: 0.5,
          title: drawn
            ? 'Rows the carriage counter reads over 10cm of a plain stockinette swatch.'
            : 'Rows up 10cm of your swatch.',
          onchange: (v) =>
            commit('gauge', (p) => {
              p.gauge.rowsPer10 = v;
            }),
        })
      ),
      drawn
        ? field(
            'Drawn rows / 10cm',
            numberInput({
              value: Math.round(rowGauge(project) * 2) / 2,
              min: 2,
              max: 140,
              step: 0.5,
              title:
                'Rows of the drawing in 10cm of a swatch knitted in this technique. Each takes several passes and ' +
                'slipped stitches pull the fabric up, so plain stockinette gauge does not apply. ' +
                'Until you enter one it is Rows / 10cm divided by passes per color.',
              onchange: (v) =>
                commit('gauge', (p) => {
                  p.gauge.drawnRowsPer10 = v;
                }),
            }),
            g.drawnRowsPer10 ? null : h('span', { class: 'muted' }, 'estimated')
          )
        : null
    ),
    stat(
      'Stitch shape',
      `${stitchAspect(g).toFixed(2)} : 1`,
      'Rows per stitch. Above 1 means stitches are wider than they are tall, ' +
        'which is why the preview squashes them.'
    )
  );
}

function gaugePage() {
  return h('div', { class: 'dlg-groups' }, gaugeGroup(state.project));
}

// --- Yarn estimate ---------------------------------------------------------

/**
 * Stitches each slot knits. Fair Isle knits every stitch of the drawing once,
 * so the drawing's share is the yarn's. The pass techniques knit a stitch
 * several times or slip it, so they are counted pass by pass from the plan.
 */
function yarnCounts(project) {
  if (getTechnique(project.technique).floats) {
    const panel = expandPanel(project);
    const shares = colorShares(panel, project.palette.length);
    return { total: panel.w * panel.h, counts: shares.map((s) => s * panel.w * panel.h) };
  }
  const plan = compilePasses(project, 'panel');
  const counts = new Array(project.palette.length).fill(0);
  let total = 0;
  for (const pass of plan.passes) {
    for (let x = 0; x < plan.width; x++) {
      const { op, yarn } = stitchOf(pass, x);
      if (op === SLIP || yarn >= counts.length) continue;
      counts[yarn]++;
      total++;
    }
  }
  return { total, counts };
}

function yarnPage() {
  const project = state.project;
  const { panel } = project;
  const { total, counts } = yarnCounts(project);
  const shares = counts.map((c) => c / (total || 1));

  const lines = shares
    .map((share, index) => ({ share, index }))
    .filter((entry) => entry.share > 0.001)
    .sort((a, b) => b.share - a.share)
    .map(({ share, index }) => {
      const slot = project.palette[index];
      const est = estimateYarn({ stitches: counts[index], rows: 1 });
      return h(
        'div',
        { class: 'yarn-est' },
        h('i', { class: 'dot', style: { background: slot?.color } }),
        h('span', { class: 'grow' }, slot?.name || `Slot ${index + 1}`),
        h('span', {}, `${(share * 100).toFixed(0)}%`),
        h('strong', {}, `${est.meters} m`)
      );
    });

  return h(
    'div',
    { class: 'dlg-groups' },
    group(
      'Yarn estimate',
      `For the whole ${panel.w} x ${panelRows(project)} panel. Rough, and it ignores floats - ` +
        'buy more than this says.',
      h('div', { class: 'list yarn-est-list' }, ...lines)
    )
  );
}

// --- Details ---------------------------------------------------------------

function detailsPage() {
  const project = state.project;
  return h(
    'div',
    { class: 'dlg-groups' },
    group(
      'Project',
      null,
      field(
        'Name',
        h('input', {
          type: 'text',
          class: 'text',
          value: project.name,
          onchange: (event) => {
            const name = event.target.value.trim() || 'Untitled';
            renameOpenProject(name).catch((error) => toast(`Rename failed: ${error.message}`, 'error'));
          },
        })
      ),
      field(
        'Technique',
        select({
          value: getTechnique(project.technique).id,
          title: techniqueList().map((t) => `${t.label}: ${t.title}`).join('\n'),
          options: techniqueList().map((t) => [t.id, t.label]),
          onchange: (v) =>
            commit('knit technique', (p) => {
              p.technique = v;
            }),
        }),
        'How the colorwork is knitted. Decides the Knittability checks and what the knit screen does. Also switchable in the Stitches panel.'
      )
    ),
    group(
      'Notes',
      'Saved with the file.',
      h('textarea', {
        class: 'text notes',
        rows: 6,
        value: project.notes ?? '',
        placeholder: 'Tension dial, ribber setup, anything you want with the file.',
        onchange: (event) => {
          const notes = event.target.value;
          commit('notes', (p) => {
            p.notes = notes;
          });
        },
      })
    )
  );
}

// --- the dialog ------------------------------------------------------------

let dialog = null;

/**
 * @param {'size'|'gauge'|'yarn'|'details'} [tab]
 */
export function openProjectSettings(tab) {
  dialog ??= createTabbedDialog({
    title: 'Project settings',
    subtitle: 'this project only',
    icon: mdiTune,
    tabs: [
      { id: 'size', label: 'Size', icon: mdiAspectRatio, build: sizePage },
      { id: 'gauge', label: 'Gauge', icon: mdiTapeMeasure, build: gaugePage },
      { id: 'yarn', label: 'Yarn estimate', icon: mdiWeight, build: yarnPage },
      { id: 'details', label: 'Details', icon: mdiNoteTextOutline, build: detailsPage },
    ],
  });
  dialog.open(tab);
}
