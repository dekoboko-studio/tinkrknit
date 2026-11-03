/**
 * Knittability check.
 *
 * Two things stop a Fair Isle chart from knitting: more than two colors in a
 * row, and floats too long to sit flat behind the fabric. Neither blocks
 * drawing - the rule the project follows is warn and auto-decompose on export
 * (CLAUDE.md 6) - so this panel is where the consequences are made visible.
 */

import { registerPanel } from '../../core/registry.js';
import { state, commit, validation } from '../../core/store.js';
import { h, numberInput } from '../dom.js';
import { getTechnique } from '../../model/technique.js';
import { reactive, svgPath } from './helpers.js';
import { mdiCheckCircleOutline, mdiAlertCircleOutline, mdiShieldCheckOutline } from '../../icons.js';
import { emit } from '../../core/bus.js';
import { rowName } from '../../model/rows.js';

function rowList(report) {
  const bad = report.rows.filter((r) => r.tooMany || r.floats.length || r.issues.length);
  if (!bad.length) return null;

  // Rows repeat, so many panel rows map to the same tile row. Report the tile
  // row once - that is the one you would actually go and fix.
  const seen = new Map();
  for (const r of bad) {
    if (r.tileY < 0 || seen.has(r.tileY)) continue;
    seen.set(r.tileY, r);
  }

  return h(
    'div',
    { class: 'issue-rows' },
    h(
      'h5',
      {
        class: 'sub-title',
        title: 'Also marked in the editor gutter: red for a row that cannot knit as drawn, amber for a warning.',
      },
      `Tile rows to fix (${seen.size})`
    ),
    ...[...seen.values()]
      .sort((a, b) => b.tileY - a.tileY)
      .slice(0, 40)
      .map((r) =>
        h(
          'button',
          {
            class: 'issue-row',
            title: 'Scroll the editor to this row.',
            onclick: () => emit('editor:focusRow', { tileY: r.tileY }),
          },
          h('span', { class: 'issue-num' }, `Row ${rowName(state.project, r.tileY)}`),
          r.tooMany
            ? h('span', { class: 'tag tag-error' }, `${r.colors.length} colors`)
            : null,
          r.floats.length
            ? h('span', { class: 'tag tag-warn' }, `float ${r.longestFloat}`)
            : null,
          ...r.issues.map((i) => h('span', { class: `tag tag-${i.level === 'error' ? 'error' : 'warn'}` }, i.label))
        )
      )
  );
}

/**
 * Compact on purpose: a verdict, the rows to fix, the float limit that decides
 * what counts as a long float. The same verdict is on the status bar, so this
 * panel can be hidden by anyone who would rather keep the width.
 */
function build() {
  const report = validation();
  const project = state.project;

  const { level } = report;
  const technique = getTechnique(project.technique);
  const issues = report.errors.length + report.warnings.length;
  const upTo = `${report.maxColors} colors or fewer per row`;
  const detail =
    level === 'ok'
      ? technique.floats
        ? `${upTo}, no float over ${project.validation.floatThreshold}.`
        : Number.isFinite(report.maxColors)
          ? `${upTo}.`
          : `Every pass knits, no slip float over ${project.validation.floatThreshold}.`
      : report.summary.join(', ') || `${issues} issue${issues === 1 ? '' : 's'}`;

  const headline = {
    ok: 'Knits as drawn',
    warn: 'Knittable, with warnings',
    error: technique.floats ? 'Needs attention before export' : 'Will not knit as drawn',
  }[level];

  return h(
    'div',
    { class: 'stack' },

    // Named, not chosen, here: it decides every judgment below, so the panel
    // says which rules it is applying. The choice is in the Stitches panel,
    // beside the settings that go with it.
    h(
      'div',
      { class: 'row' },
      h('span', { class: 'muted' }, 'Judged as'),
      h(
        'button',
        {
          type: 'button',
          class: 'link',
          title: `${technique.title}\n\nChange the technique in the Stitches panel`,
          onclick: () => emit('dock:reveal', 'stitches'),
        },
        technique.label
      )
    ),

    h(
      'div',
      { class: `verdict is-${level}` },
      svgPath(level === 'ok' ? mdiCheckCircleOutline : mdiAlertCircleOutline, 18),
      h('div', {}, h('strong', {}, headline), h('small', {}, detail))
    ),

    ...report.errors.map((e) => h('p', { class: 'warn-line' }, e.message)),
    ...report.warnings.map((w) => h('p', { class: 'note-line' }, w.message)),

    rowList(report),

    ...limits(project, technique)
  );
}

/** The settings that decide what counts as a problem, for this technique. */
function limits(project, technique) {
  if (technique.id === 'jacquard') return [colorLimit(project)];
  const out = [floatLimit(project)];
  if (technique.id === 'texture') out.push(heldLimit(project, 'maxTuck', 'Flag tucks held over', 'Passes a needle may tuck in a row before the loops are too tight to knit off. 2 to 4 is usual.'));
  if (technique.id === 'texture' || technique.id === 'mosaic') {
    out.push(heldLimit(project, 'maxSlip', technique.id === 'mosaic' ? 'Slip a stitch at most' : 'Flag slips held over',
      'Passes a stitch may be slipped before it is pulled too long. Mosaic plans its slips within this.'));
  }
  return out;
}

function heldLimit(project, key, label, title) {
  return h(
    'label',
    { class: 'inline-field', title },
    h('span', {}, label),
    numberInput({
      value: project.validation[key] ?? 4,
      title: label,
      min: 1,
      max: 12,
      onchange: (v) =>
        commit('held loop limit', (p) => {
          p.validation[key] = v;
        }),
    }),
    h('span', {}, 'passes')
  );
}

/** Jacquard's only rule. The changer and the backing set it, not the bed. */
function colorLimit(project) {
  return h(
    'label',
    {
      class: 'inline-field',
      title:
        'Most colors any row may use. Each color is one more carriage pass and ' +
        'makes the backing thicker; the color changer holds four.',
    },
    h('span', {}, 'Up to'),
    numberInput({
      value: project.validation.jacquardColors,
      title: 'Colors per row',
      min: 2,
      max: 8,
      onchange: (v) =>
        commit('colors per row', (p) => {
          p.validation.jacquardColors = v;
        }),
    }),
    h('span', {}, 'colors per row')
  );
}

function floatLimit(project) {
  return h(
    'label',
    {
      class: 'inline-field',
      title:
        'Longest run of one color before the other yarn is flagged. 7 is a ' +
        'common limit; go lower for pieces that get pulled on hard.',
    },
    h('span', {}, 'Flag floats longer than'),
    numberInput({
      value: project.validation.floatThreshold,
      title: 'Float limit',
      min: 2,
      max: 30,
      onchange: (v) =>
        commit('float limit', (p) => {
          p.validation.floatThreshold = v;
        }),
    }),
    h('span', {}, 'stitches')
  );
}

registerPanel({
  id: 'validation',
  title: 'Knittability',
  icon: mdiShieldCheckOutline,
  dock: 'right',
  order: 30,
  render: (host) => reactive(host, build, ['project:changed']),
});
