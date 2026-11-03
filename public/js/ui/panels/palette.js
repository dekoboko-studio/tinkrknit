/**
 * Color slots.
 *
 * A slot is a position in the palette, not a color. Cells store the slot
 * index, so changing a slot's color repaints every stitch that uses it with no
 * redrawing (CLAUDE.md 3.1) - that is the whole point of the indexed model.
 */

import { registerPanel } from '../../core/registry.js';
import {
  state, commit, setUI, touch, beginStroke, endStroke,
} from '../../core/store.js';
import { addColorSlot, removeColorSlot } from '../../model/project.js';
import { setSlotColor, bindYarn, readableTextOn } from '../../model/palette.js';
import { usedIndices } from '../../model/bitmap.js';
import { h, row, button, field, toast } from '../dom.js';
import { reactive, svgPath } from './helpers.js';
import { openLibrary } from '../library.js';
import { mdiPaletteOutline, mdiSwapHorizontal } from '../../icons.js';

function swatch(slot, index, used) {
  const isPrimary = state.primary === index;
  const isSecondary = state.secondary === index;

  return h(
    'button',
    {
      class: [
        'swatch',
        isPrimary ? 'is-primary' : '',
        isSecondary ? 'is-secondary' : '',
        used ? '' : 'is-unused',
      ],
      style: { background: slot.color, color: readableTextOn(slot.color) },
      title:
        `${slot.name || 'Slot ' + (index + 1)}  ${slot.color}` +
        (used ? '' : '  (not used in this tile)') +
        '\nClick to set the drawing color, right-click for the base.',
      oncontextmenu: (event) => {
        event.preventDefault();
        setUI({ secondary: index });
      },
      onclick: () => setUI({ primary: index }),
    },
    h('span', { class: 'swatch-index' }, String(index + 1)),
    slot.yarnId ? h('span', { class: 'swatch-pin', title: 'Linked to a yarn' }, '*') : null,
    isPrimary || isSecondary
      ? h('span', { class: 'swatch-role' }, (isPrimary ? 'D' : '') + (isSecondary ? 'B' : ''))
      : null
  );
}

/**
 * The working pair: Drawing is what the left button paints, Base what the
 * right button paints (and where a gradient ends). Internally still
 * `primary`/`secondary` in the store.
 */
function pairCard(label, key, slot, hint) {
  return h(
    'div',
    { class: ['pair-card', `is-${key}`], title: hint },
    h('i', { style: { background: slot?.color ?? '#ccc' } }),
    h('span', { class: 'pair-label' }, label),
    h('span', { class: 'pair-name' }, slot ? slot.name || slot.color : '')
  );
}

function editor(project) {
  const index = state.primary;
  const slot = project.palette[index];
  if (!slot) return null;

  const yarnOptions = [
    h('option', { value: '' }, 'Not linked to a yarn'),
    ...state.yarns.map((yarn) =>
      h(
        'option',
        { value: String(yarn.id), selected: String(yarn.id) === String(slot.yarnId) },
        `${yarn.name}${yarn.brand ? ' - ' + yarn.brand : ''}`
      )
    ),
  ];

  /**
   * The native color dialog is a drag, not a click.
   *
   * It fires `input` on every move along the hue bar and on every keystroke in
   * its hex field. Committing each one rebuilt this panel, which replaced the
   * very `<input>` the browser anchors the dialog to - so the dialog shut the
   * instant you touched anything in it. Live changes now go through `touch()`,
   * which repaints the canvas and the preview but leaves the panel's DOM
   * alone, and the whole edit lands in history once on blur. This is the same
   * begin/touch/end protocol a brush stroke uses (CLAUDE.md 3.2), and it also
   * means dragging through fifty shades is one undo step rather than fifty.
   */
  let picking = false;

  const colorInput = h('input', {
    type: 'color',
    class: 'color-input',
    value: slot.color,
    oninput: (event) => {
      if (!picking) {
        picking = true;
        beginStroke();
      }
      setSlotColor(state.project.palette, index, event.target.value);
      touch('recolor slot');
    },
    // `change` on a color input means the dialog was dismissed, which is the
    // real end of the edit. `blur` is the fallback for the case where focus
    // leaves without it - a pending snapshot left lying around would be
    // claimed by the next brush stroke.
    onchange: () => {
      settle();
      // The spec has `change` mean "the dialog was dismissed", so letting go of
      // focus here is safe - and it is what lets the panel redraw, since the
      // rebuild is held off while focus is still inside it.
      colorInput.blur();
    },
    onblur: () => settle(),
  });

  function settle() {
    if (!picking) return;
    picking = false;
    endStroke('recolor slot');
  }

  return h(
    'div',
    { class: 'stack slot-editor' },
    h('h5', { class: 'sub-title' }, `Slot ${index + 1}`),

    row(
      field('Color', colorInput),
      field(
        'Name',
        h('input', {
          type: 'text',
          class: 'text',
          value: slot.name ?? '',
          placeholder: 'Cream, Main, ...',
          onchange: (event) => {
            const name = event.target.value;
            commit('rename slot', (p) => {
              p.palette[index].name = name;
            });
          },
        })
      )
    ),

    field(
      'Yarn',
      h(
        'select',
        {
          class: 'select',
          onchange: (event) => {
            const yarn = state.yarns.find(
              (y) => String(y.id) === event.target.value
            );
            commit('link yarn', (p) => {
              bindYarn(p.palette, index, yarn ?? null);
            });
          },
        },
        ...yarnOptions
      ),
      h('button', {
        type: 'button',
        class: 'link',
        title: 'Linking copies the yarn color into this slot and names it. Add yarns in the Library.',
        onclick: () => openLibrary('yarns'),
      }, 'Yarn stock')
    ),

    row(
      button({
        label: 'Add slot',
        title: 'Append a new color slot to the palette.',
        onclick: () =>
          commit('add color', (p) => {
            addColorSlot(p, '#888888');
            setUI({ primary: p.palette.length - 1 });
          }),
      }),
      button({
        label: 'Remove',
        variant: 'danger',
        disabled: project.palette.length <= 2,
        title:
          'Delete this slot. Stitches using it fall back to the background ' +
          'color, and higher slots shift down.',
        onclick: () => {
          const ok = commit('remove color', (p) => removeColorSlot(p, index));
          if (ok) setUI({ primary: 0, secondary: 0 });
          else toast('A palette needs at least two colors.', 'warn');
        },
      })
    )
  );
}

function build() {
  const project = state.project;
  const used = usedIndices(project.tile);

  return h(
    'div',
    { class: 'stack' },
    h(
      'div',
      { class: 'swatches' },
      ...project.palette.map((slot, index) => swatch(slot, index, used.has(index)))
    ),
    h(
      'div',
      { class: 'pair-readout' },
      pairCard('Drawing', 'primary', project.palette[state.primary],
        'Painted with the left button. Click a swatch to change it.'),
      h(
        'button',
        {
          class: 'pair-swap',
          title: 'Swap drawing and base',
          onclick: () => setUI({ primary: state.secondary, secondary: state.primary }),
        },
        svgPath(mdiSwapHorizontal, 16)
      ),
      pairCard('Base', 'secondary', project.palette[state.secondary],
        'Painted with the right button. Right-click a swatch to change it.')
    ),
    editor(project)
  );
}

registerPanel({
  id: 'palette',
  title: 'Colors',
  icon: mdiPaletteOutline,
  dock: 'left',
  order: 20,
  render: (host) =>
    reactive(host, build, ['project:changed', 'ui:changed', 'library:changed']),
});
