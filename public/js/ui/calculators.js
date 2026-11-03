/**
 * Calculators: size a panel for a garment from body measurements and the
 * project's gauge.
 *
 * Not part of Project settings, which is what the project *is*; a calculator
 * is a scratchpad that writes one result into it (the panel size) when asked.
 * Its inputs are UI state, not document state, and are not saved.
 *
 * One entry in CALCULATORS per garment. Each is a tab in the dialog and a row
 * in the Calculators menu (ui/menus/calculators.js), so a scarf or a sock is
 * one object here and nothing else.
 *
 * The gauge stays in Project settings: it belongs to the project and every
 * calculator reads it. Each calculator shows the gauge it used, with a link to
 * edit it.
 */

import { state, commit } from '../core/store.js';
import { resizePanel } from '../model/project.js';
import { hatPanel } from '../model/gauge.js';
import { rowGauge, panelPassesFor, drawnGauge } from '../model/rows.js';
import { h, row, field, numberInput, button, toast } from './dom.js';
import { stat, cmLabel } from './panels/helpers.js';
import { createTabbedDialog } from './dialog.js';
import { openProjectSettings } from './projectSettings.js';
import { mdiCalculator } from '../icons.js';

/** A titled group of fields, as in Project settings. */
function group(title, note, ...children) {
  return h(
    'section',
    { class: 'dlg-group' },
    h('h3', { class: 'dlg-group-title', title: note ?? undefined }, title),
    ...children
  );
}

/** The gauge a calculator is working from, and the way to change it. */
function gaugeLine(project, api) {
  const g = project.gauge;
  const rows = Math.round(rowGauge(project) * 10) / 10;
  return h(
    'div',
    { class: 'row' },
    stat(
      'Gauge',
      `${g.stsPer10} sts x ${rows} ${drawnGauge(project) ? 'drawn rows' : 'rows'} / 10cm`,
      'From Project settings > Gauge. Swatch in the pattern itself: floats pull Fair Isle in.'
    ),
    h('button', {
      type: 'button',
      class: 'link',
      title: 'Edit the gauge in Project settings',
      onclick: () => {
        api.close();
        openProjectSettings('gauge');
      },
    }, 'Edit gauge')
  );
}

/** A number field over a calculator's own inputs object. */
function numField(inputs, api, key, label, opts) {
  return field(
    label,
    numberInput({
      value: inputs[key],
      ...opts,
      onchange: (v) => {
        inputs[key] = v;
        api.redraw();
      },
    })
  );
}

/** The panel-size result every calculator ends in. */
function applyButton(w, hh, what) {
  return h(
    'div',
    { class: 'row' },
    button({
      label: `Set panel to ${w} x ${hh}`,
      variant: 'primary',
      title: 'Set the panel size from this calculation.',
      onclick: () => {
        commit(`apply ${what} size`, (p) => resizePanel(p, w, panelPassesFor(p, hh)));
        toast(`Panel set to ${w} x ${hh}.`, 'ok');
      },
    })
  );
}

// --- Hat ---------------------------------------------------------------------

const hat = { headCm: 56, easePct: -10, heightCm: 22, seam: 2, ribRows: 12 };

function hatPage(api) {
  const project = state.project;
  const result = hatPanel({
    headCm: hat.headCm,
    ease: hat.easePct / 100,
    heightCm: hat.heightCm,
    gauge: { ...project.gauge, rowsPer10: rowGauge(project) },
    seamStitches: hat.seam,
    ribRows: hat.ribRows,
  });
  const num = (key, label, opts) => numField(hat, api, key, label, opts);

  return h(
    'div',
    { class: 'dlg-groups' },
    group(
      'Hat',
      'A flat panel seamed up the back. Crown shaping is done at the machine.',
      gaugeLine(project, api),
      row(
        num('headCm', 'Head (cm)', { min: 30, max: 70, step: 0.5, title: 'Measure around the widest part.' }),
        num('easePct', 'Ease (%)', {
          min: -30,
          max: 10,
          title: 'Negative so the hat grips. -10% is a good default for ribbed brims.',
        }),
        num('heightCm', 'Height (cm)', { min: 10, max: 45, step: 0.5, title: 'Cast-on to crown.' })
      ),
      row(
        num('ribRows', 'Rib rows', { min: 0, max: 80, title: 'Plain rows before the colorwork starts.' }),
        num('seam', 'Seam sts', { min: 0, max: 10, title: 'Extra stitches each side for mattress-stitching up.' }),
        h('span', { class: 'field' })
      ),
      h(
        'div',
        { class: 'result' },
        stat('Finished', cmLabel(result.finishedCm)),
        stat('Cast on', `${result.panelW} sts`),
        stat('Knit', `${result.panelH} rows`),
        stat('Pattern rows', String(result.patternRows))
      ),
      ...result.notes.map((note) => h('p', { class: 'hint' }, note)),
      applyButton(result.panelW, result.panelH, 'hat')
    )
  );
}

// --- the list and the dialog ---------------------------------------------------

/** Every calculator, in menu order. Add a garment here. */
export const CALCULATORS = [
  { id: 'hat', label: 'Hat', title: 'Size the panel from a head measurement', build: hatPage },
];

let dialog = null;

/** @param {string} [id] which calculator to show; the first by default */
export function openCalculator(id) {
  dialog ??= createTabbedDialog({
    title: 'Calculators',
    subtitle: 'Size the panel for a garment from measurements and the project gauge',
    icon: mdiCalculator,
    tabs: CALCULATORS.map((c) => ({ id: c.id, label: c.label, icon: c.icon, build: c.build })),
  });
  dialog.open(id);
}
