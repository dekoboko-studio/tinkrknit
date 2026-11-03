/**
 * Text tool options.
 *
 * The string is typed here rather than on the canvas. A caret on the grid would
 * mean owning key handling, a text cursor and a live text object in the
 * document, and all of it for a tool whose output is stitches the moment it
 * lands - so the bar holds the text and the grid holds the placement.
 *
 * The stitch count on the right is the useful number: a word at 12 rows can
 * easily come out 70 stitches wide, which is a third of the SK840's bed, and
 * that is worth knowing before you place it rather than after.
 */

import { registerToolOptions } from '../../core/registry.js';
import { state, setUI } from '../../core/store.js';
import { h, field, numberInput, checkbox } from '../dom.js';
import { svgPath } from '../panels/helpers.js';
import { SYSTEM_FONTS, MIN_ROWS, MAX_ROWS } from '../../editor/text.js';
import { textBlock } from '../../editor/tools.js';
import { mdiFormatBold, mdiFormatItalic } from '../../icons.js';

/**
 * A pressed-in icon button. Bold and italic as checkboxes cost a word of label
 * each, and B and I are two of the most recognizable controls there are.
 */
function toggle({ icon, label, on, title, onclick }) {
  return h(
    'button',
    {
      class: `ob-toggle ${on ? 'is-on' : ''}`.trim(),
      type: 'button',
      title,
      'aria-label': label,
      'aria-pressed': String(on),
      onclick,
    },
    svgPath(icon, 16)
  );
}

/**
 * Each option is shown in its own face, so the list reads as a font menu rather
 * than as eleven names. `font-family` on an `<option>` is honored by the major
 * desktop browsers; where it is not, the names are still names.
 */
function fontSelect() {
  return h(
    'select',
    {
      class: 'select ob-font',
      title: 'System fonts. Heavy, wide faces survive being cut to stitches best.',
      onchange: (event) => setUI({ textFont: event.target.value }),
    },
    ...SYSTEM_FONTS.map(([stack, label]) =>
      h(
        'option',
        {
          value: stack,
          selected: stack === state.textFont,
          style: { fontFamily: stack },
        },
        label
      )
    )
  );
}

/** The block the current settings would place, as a stitch count. */
function measure() {
  const block = textBlock(state);
  return block.points.length ? `${block.w} x ${block.h} sts` : 'empty';
}

registerToolOptions({
  id: 'text',
  order: 7,
  build: () => {
    // Updated in place as you type rather than by a rebuild: `reactive()` holds
    // off while a text input has focus, precisely so the field you are typing
    // into is not replaced underneath you, which would leave the count stale
    // until you clicked away. It is one node in this module's own build.
    const note = h(
      'span',
      {
        class: 'ob-note',
        title: 'Size of the block this will place, in stitches and rows.',
      },
      measure()
    );

    return h(
      'div',
      { class: 'ob-cluster' },
      h('input', {
        type: 'text',
        class: 'text ob-text',
        value: state.text,
        placeholder: 'Type here',
        title: 'One line. Place it on the grid, then edit the stitches like any others.',
        // Live, so the footprint under the cursor follows what you type.
        oninput: (event) => {
          setUI({ text: event.target.value });
          note.textContent = measure();
        },
      }),
      fontSelect(),
      field(
        'Rows',
        numberInput({
          value: state.textSize,
          min: MIN_ROWS,
          max: MAX_ROWS,
          title:
            'Height of the letters in rows, measured on the ink rather than the ' +
            'font size. Below about 7 most faces lose the holes in their letters.',
          onchange: (v) => setUI({ textSize: v }),
        })
      ),
      toggle({
        icon: mdiFormatBold,
        label: 'Bold',
        on: state.textBold,
        title: 'Bold. Thin strokes vanish when the antialiased edge is cut to stitches.',
        onclick: () => setUI({ textBold: !state.textBold }),
      }),
      toggle({
        icon: mdiFormatItalic,
        label: 'Italic',
        on: state.textItalic,
        title: 'Italic. A shallow diagonal steps badly at this size; check the preview.',
        onclick: () => setUI({ textItalic: !state.textItalic }),
      }),
      field(
        'Track',
        numberInput({
          value: state.textSpacing,
          min: -4,
          max: 12,
          title:
            'Extra stitches between letters. Worth a stitch or two: neighboring ' +
            'letters that touch read as one blob in fabric.',
          onchange: (v) => setUI({ textSpacing: v }),
        })
      ),
      checkbox({
        label: 'Fit gauge',
        checked: state.textGauge,
        title:
          'Stitches are wider than they are tall, so squeeze the chart horizontally ' +
          'and the knitting comes out at the right proportions. The letters look ' +
          'narrow here and correct in the preview. Off draws on the square grid.',
        onchange: (v) => setUI({ textGauge: v }),
      }),
      note
    );
  },
});
