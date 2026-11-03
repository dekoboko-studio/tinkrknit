/**
 * What to do with the selection, with the Select tool in hand.
 *
 * These were a block of buttons in the Stamps panel. They only mean anything
 * once an area is selected, which is what the options bar is for; the panel
 * keeps only Save as stamp, its way into making a stamp.
 */

import { registerToolOptions } from '../../core/registry.js';
import { state } from '../../core/store.js';
import { h, button } from '../dom.js';
import {
  saveSelectionAsStamp, copySelection, cutSelection, paste, hasClip,
  clearSelection, cropToSelection, clearTile,
} from '../selectionActions.js';

registerToolOptions({
  id: 'selection',
  order: 30,
  build: () => {
    const sel = state.selection;
    const none = !sel;
    return h(
      'div',
      { class: 'ob-cluster' },
      h('span', { class: 'ob-note' }, sel ? `${sel.w} x ${sel.h}` : 'No selection'),
      button({
        label: 'Save as stamp',
        variant: 'primary',
        disabled: none,
        title: 'Store the selected area in the stamp library.',
        onclick: saveSelectionAsStamp,
      }),
      button({ label: 'Copy', disabled: none, title: 'Copy the selected area  (Ctrl+C)', onclick: copySelection }),
      button({ label: 'Cut', disabled: none, title: 'Copy the selected area and clear it to the background  (Ctrl+X)', onclick: cutSelection }),
      button({
        label: 'Paste',
        disabled: !hasClip(),
        title: 'Pick up what was copied as a stamp: it follows the cursor, click to place, R turns it  (Ctrl+V)',
        onclick: paste,
      }),
      button({ label: 'Clear', disabled: none, title: 'Set the selected stitches back to the background color  (Delete)', onclick: clearSelection }),
      button({ label: 'Crop tile', disabled: none, title: 'Make the selected area the whole repeat tile.', onclick: cropToSelection }),
      button({
        label: 'Clear tile',
        variant: 'danger',
        title: 'Wipe the whole tile back to the background color, or with the stitch layer active, back to knit.',
        onclick: clearTile,
      })
    );
  },
});
