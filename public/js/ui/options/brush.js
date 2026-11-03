/**
 * Brush size and mirror: the two settings that follow you between the drawing
 * tools.
 *
 * Both write UI state, not the document, so neither takes an undo step - the
 * stroke you draw afterwards is the thing worth undoing.
 */

import { registerToolOptions } from '../../core/registry.js';
import { state, setUI } from '../../core/store.js';
import { field, numberInput, select } from '../dom.js';

registerToolOptions({
  id: 'brush',
  order: 10,
  build: () =>
    field(
      'Brush',
      numberInput({
        value: state.brushSize,
        min: 1,
        max: 12,
        // A dilation radius, so the footprint is a disc, not a square; the
        // hover cursor outlines the real shape (CLAUDE.md 5).
        title: 'How many stitches across the nib is. 1 is a single stitch.  ([ and ])',
        onchange: (v) => setUI({ brushSize: v }),
      })
    ),
});

registerToolOptions({
  id: 'mirror',
  order: 90,
  build: () =>
    field(
      'Mirror',
      select({
        value: state.symmetry,
        title:
          'Mirrors every stroke about the center of the tile. Left/right is the ' +
          'one that keeps a Fair Isle motif symmetric across the repeat.',
        options: [
          ['none', 'Off'],
          ['x', 'Left / right'],
          ['y', 'Up / down'],
          ['xy', 'Both'],
        ],
        onchange: (v) => setUI({ symmetry: v }),
      })
    ),
});
