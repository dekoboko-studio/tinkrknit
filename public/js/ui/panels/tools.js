/**
 * Tools panel: pick a tool.
 *
 * The tool list is drawn from the registry, so a new tool appears here the
 * moment it is registered - no edit to this file (CLAUDE.md 3.3).
 *
 * How a tool behaves is not set here. Brush size, mirror and fill moved to the
 * options bar above the grid, which shows only the settings the selected tool
 * can actually use; keeping a second copy in the sidebar would have meant two
 * controls for one piece of state and a permanent row of knobs that are wrong
 * for most of the tools.
 */

import { registerPanel, tools } from '../../core/registry.js';
import { state, setUI } from '../../core/store.js';
import { h } from '../dom.js';
import { reactive, iconButton } from './helpers.js';
import { mdiPencilRuler } from '../../icons.js';

/** Keyboard shortcuts, in registry order. Shown on the button tooltips. */
export const TOOL_KEYS = {
  pencil: 'b', eraser: 'e', line: 'l', rect: 'r', ellipse: 'c',
  shape: 'g', text: 't', fill: 'f', replace: 'x', eyedropper: 'i',
  select: 'm', shift: 'h', stamp: 's', gradient: 'd', hand: 'v',
};

function build() {
  const grid = h(
    'div',
    { class: 'tool-grid' },
    ...tools.sorted().map((tool) =>
      iconButton({
        path: tool.icon,
        label: tool.label,
        active: tool.id === state.tool,
        // Label, shortcut and what the tool actually does. The options bar
        // shows controls only, so this is where a tool explains itself.
        title: [
          TOOL_KEYS[tool.id]
            ? `${tool.label}  (${TOOL_KEYS[tool.id].toUpperCase()})`
            : tool.label,
          tool.hint,
        ]
          .filter(Boolean)
          .join('\n'),
        onclick: () => setUI({ tool: tool.id }),
      })
    )
  );

  return h(
    'div',
    { class: 'stack' },
    grid
  );
}

registerPanel({
  id: 'tools',
  title: 'Tools',
  icon: mdiPencilRuler,
  dock: 'left',
  order: 10,
  render: (host) => reactive(host, build, ['ui:changed', 'registry:changed']),
});
