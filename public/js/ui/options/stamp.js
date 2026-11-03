/**
 * How the selected stamp is laid down.
 *
 * The library itself stays a panel - you browse it, and it wants the room for
 * thumbnails - but these settings only mean anything with the stamp tool
 * in hand, and you change them between one placement and the next.
 */

import { registerToolOptions } from '../../core/registry.js';
import { state, setUI } from '../../core/store.js';
import { h, checkbox, button } from '../dom.js';

registerToolOptions({
  id: 'stamp',
  order: 30,
  build: () => {
    const active = state.activeStamp;
    if (!active) {
      return h('span', { class: 'ob-note' }, 'Pick a stamp in the Stamps panel.');
    }

    const t = state.stampTransform;
    const set = (patch) => setUI({ stampTransform: { ...t, ...patch } });

    return h(
      'div',
      { class: 'ob-cluster' },
      h('span', { class: 'ob-name', title: `Placing "${active.name}"` }, active.name),
      checkbox({
        label: 'Flip X',
        checked: t.flipX,
        title: 'Mirror the stamp left to right as it is placed.',
        onchange: (v) => set({ flipX: v }),
      }),
      checkbox({
        label: 'Flip Y',
        checked: t.flipY,
        title: 'Mirror the stamp top to bottom as it is placed.',
        onchange: (v) => set({ flipY: v }),
      }),
      // One button that turns a quarter, like the R key, rather than a list of
      // angles: you turn a stamp by looking at the ghost, not by number.
      button({
        label: `Rotate ${t.rotate}°`,
        title: 'Turn the stamp a quarter clockwise (R). Shift+R turns it back.',
        onclick: () => set({ rotate: (t.rotate + 90) % 360 }),
      }),
      checkbox({
        label: 'Slot 1 transparent',
        checked: state.stampTransparent,
        title: 'On, the stamp background lets the existing pattern show through.',
        onchange: (v) => setUI({ stampTransparent: v }),
      }),
      checkbox({
        label: 'Wrap at tile edges',
        checked: state.stampWrap,
        title: 'On, whatever hangs off one edge of the tile is placed on the opposite edge, so the motif continues across repeats.',
        onchange: (v) => setUI({ stampWrap: v }),
      })
    );
  },
});
