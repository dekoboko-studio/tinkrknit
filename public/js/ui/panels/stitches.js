/**
 * Stitches panel: the knit technique with its settings, and the stitch layer.
 *
 * The technique is chosen here rather than in Knittability because it is a
 * decision about how to knit, and its settings (passes per color, rows per pixel,
 * the stitch chart conversion) sit under it. Knittability still names it,
 * since that is what it judges by, with a link back here. Project settings >
 * Details edits the same value.
 *
 * The layer switch decides which grid the tools paint (editor/canvas.js), so
 * tuck and slip are drawn with the pencil, line, fill and the rest rather than
 * with tools of their own. `Q` flips the layer from the keyboard, and on the
 * stitch layer the number keys pick knit, tuck, slip.
 *
 * "Stitch chart from colors" is the automation: it runs the mosaic (or slip
 * stitch) plan over the tile and writes what it inferred - the yarn of every
 * pass and every slip - as a Tuck & slip chart, which can then be edited by
 * hand. It is one undo step, and the drawing is kept in `project.source`, so
 * "Back to colors" puts it back after the undo history is gone.
 */

import { registerPanel } from '../../core/registry.js';
import { state, setUI, commit } from '../../core/store.js';
import { h, segmented, checkbox, button, select, toast } from '../dom.js';
import { reactive } from './helpers.js';
import { mdiCheckerboard } from '../../icons.js';
import { OPS, KNIT, stitchLayer, hasStitches } from '../../model/stitch.js';
import {
  getTechnique, techniqueList, passesPerColor, jacquardRows,
} from '../../model/technique.js';
import { compilePasses, stitchChart } from '../../model/passes.js';
import { passesForRows, rowLayout, panelRows } from '../../model/rows.js';
import * as bitmap from '../../model/bitmap.js';

/**
 * Two sections, in the order you decide them. Technique first: how the piece
 * is knitted, and the settings that only that technique has, so switching it
 * swaps the controls under it and nothing else on screen moves. Then the
 * layer: which grid the tools paint, and on the stitch layer which stitch.
 */
function build() {
  const { project } = state;
  const technique = getTechnique(project.technique);
  return h(
    'div',
    { class: 'stack' },
    h('h5', { class: 'sub-title', title: 'How the piece is knitted. The Knittability panel judges the chart by it.' }, 'Technique'),
    ...techniqueSection(project, technique),
    h('h5', { class: 'sub-title', title: 'Which grid the tools paint (Q)' }, 'Layer'),
    ...layerSection(project, technique)
  );
}

function techniqueSection(project, technique) {
  const out = [];

  // A select, not a segmented control: five techniques do not fit the width.
  // The tooltip lists them all, since the names alone do not say how they knit.
  out.push(
    select({
      value: technique.id,
      title: techniqueList().map((t) => `${t.label}: ${t.title}`).join('\n'),
      options: techniqueList().map((t) => [t.id, t.label]),
      onchange: (id) =>
        commit('knit technique', (p) => {
          p.technique = id;
        }),
    })
  );

  if (technique.id === 'jacquard') {
    out.push(
      h(
        'label',
        { class: 'inline-field', title: 'Rows of front stitches each chart row knits. Both change yarn only at the color changer; start with the carriage on the side away from it.' },
        h('span', {}, 'Rows per pixel'),
        segmented({
          value: jacquardRows(project),
          options: [
            [1, '1', 'Staggered: colors alternate A B | B A over pairs of rows, each stitch knitted once. A travel pass is added where a change would land on the far side.'],
            [2, '2', 'Doubled: each color out and back on the same row, so the motif comes out about twice as tall'],
          ],
          onchange: (n) =>
            commit('jacquard rows per pixel', (p) => {
              p.stitch = { ...p.stitch, jacquardRows: n };
            }),
        })
      )
    );
  } else if (technique.perColor) {
    out.push(
      h(
        'label',
        { class: 'inline-field', title: 'Carriage passes for each color in a row. Two brings the yarn back to the side it started, so colors can change without cutting.' },
        h('span', {}, 'Passes per color'),
        segmented({
          value: passesPerColor(project),
          options: [
            [1, '1', 'One pass: half the rows, but a yarn ends on the far side'],
            [2, '2', 'Two passes: each yarn returns to its side'],
          ],
          onchange: (n) =>
            commit('passes per color', (p) => {
              p.stitch = { ...p.stitch, passesPerColor: n };
            }),
        })
      )
    );
  }

  if (technique.stitches) {
    out.push(
      checkbox({
        label: 'Ribber backing',
        checked: Boolean(project.stitch?.ribber),
        title: 'Knit every pass on the ribber as well, for a double-bed texture. The main bed patterns as drawn; the ribber knits every needle.',
        onchange: (on) =>
          commit('ribber backing', (p) => {
            p.stitch = { ...p.stitch, ribber: on };
          }),
      })
    );
  }

  if (technique.id === 'mosaic' || technique.id === 'slipcolor') {
    out.push(
      button({
        label: 'Stitch chart from colors',
        title:
          `Write the slips ${technique.label} infers from the tile as a Tuck & slip chart you can edit: ` +
          'one chart row per pass, each in its yarn. The tile grows to one row per pass. Undo puts it back.',
        onclick: () => toStitchChart(technique.id),
      })
    );
  }

  if (project.source) {
    out.push(
      button({
        label: 'Back to colors',
        title:
          `Put back the color drawing this stitch chart was made from (${project.source.tile.h} rows, ` +
          `${getTechnique(project.source.technique).label}). Edits to the stitch chart are dropped, the panel size is kept; undo brings them back.`,
        onclick: backToColors,
      })
    );
  }

  return out;
}

function layerSection(project, technique) {
  const onStitches = state.layer === 'stitches';
  const out = [
    segmented({
      value: state.layer,
      title: 'Which grid the tools paint (Q)',
      options: [
        ['color', 'Colors', 'Paint palette colors (Q)'],
        ['stitches', 'Stitches', 'Paint knit, tuck and slip (Q). The colors are dimmed while you do.'],
      ],
      onchange: (layer) => setUI({ layer }),
    }),
  ];

  if (onStitches) {
    out.push(
      segmented({
        value: state.stitchOp,
        title: 'The stitch the left button paints; the right button paints knit',
        options: OPS.map((op, i) => [op.id, op.label, `${op.title}  (${i + 1})`]),
        onchange: (stitchOp) => setUI({ stitchOp }),
      })
    );
  }

  if (!technique.stitches && (hasStitches(project) || onStitches)) {
    out.push(
      h(
        'div',
        { class: 'row' },
        h('span', { class: 'muted', title: `${technique.label} ignores the stitch layer. Tuck & slip knits it.` }, 'Not knitted'),
        h(
          'button',
          {
            type: 'button',
            class: 'link',
            title: 'Switch the project to the Tuck & slip technique, which knits the stitch layer',
            onclick: () =>
              commit('technique', (p) => {
                p.technique = 'texture';
              }),
          },
          'Use Tuck & slip'
        )
      )
    );
  }

  return out;
}

/**
 * Replace the tile with the stitch chart the technique's plan amounts to, and
 * switch to Tuck & slip so it knits exactly that. The drawing is kept in
 * `project.source`.
 *
 * A drawn row becomes as many passes as it has colors (times passes per
 * color), so rows do not all grow alike, and the panel is resized row by row
 * rather than by an average: whole repeats take the whole chart, and the part
 * repeat at the top (repeats count from the cast-on) takes the passes of the
 * rows it actually holds.
 */
function toStitchChart(from) {
  const project = state.project;
  const plan = compilePasses(project, 'tile', from);
  const chart = stitchChart(plan);
  const rows = new Array(project.tile.h).fill(0);
  for (const pass of plan.passes) rows[pass.row]++;
  const th = project.tile.h;
  const ph = project.panel.h;
  const panelH = passesForRows(rows, project.repeat.vertical, ph);

  commit('stitch chart from colors', (p) => {
    p.source = {
      tile: p.tile,
      stitches: stitchLayer(p),
      panel: { ...p.panel },
      technique: p.technique,
      rows,
    };
    const tile = bitmap.createBitmap(chart.width, chart.height, 0);
    for (let y = 0; y < chart.height; y++) {
      tile.data.fill(chart.yarns[y], y * chart.width, (y + 1) * chart.width);
    }
    p.tile = tile;
    p.stitches = bitmap.createBitmap(chart.width, chart.height, KNIT);
    p.stitches.data.set(chart.ops);
    stitchLayer(p);
    p.panel = { ...p.panel, h: panelH };
    p.technique = 'texture';
  });
  setUI({ layer: 'stitches' });
  toast(`${ph} rows, ${panelH} passes. Rows stay ${th} tall on the chart, one strip per pass.`);
}

/**
 * Restore the drawing a stitch chart was made from. One undo step. The panel
 * keeps any resize made on the chart, which is sized in drawn rows.
 */
function backToColors() {
  commit('back to colors', (p) => {
    const { tile, stitches, panel, technique } = p.source;
    const h = rowLayout(p) ? panelRows(p) : panel.h;
    p.tile = tile;
    p.stitches = stitches;
    p.panel = { ...panel, w: p.panel.w, h };
    p.technique = technique;
    p.source = null;
  });
  setUI({ layer: 'color' });
}

registerPanel({
  id: 'stitches',
  title: 'Stitches',
  icon: mdiCheckerboard,
  dock: 'left',
  order: 25,
  render: (host) => reactive(host, build),
});
