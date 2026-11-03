/**
 * Tool options bar: the strip between the toolbar and the grid.
 *
 * Every tool has a handful of settings that only matter while that tool is
 * selected - a brush size, a mirror axis, whether a shape is filled. Docked in
 * a sidebar they were permanently on screen and mostly irrelevant, and they
 * took width away from the grid, which is the thing the app is for. Here they
 * cost a single 34px row and they change with the tool.
 *
 * The row holds controls only. A tool's `hint` used to sit on the right of it,
 * which cost real width - the text tool alone wants a field, a font menu, two
 * toggles, two spinners, a checkbox and a stitch count - to say something the
 * user had already read once and would not read again. It is now the tooltip
 * on the tool's name here and on its button in the Tools panel, where it is one
 * hover away for as long as it is useful and free the rest of the time.
 *
 * It is a *row of the stage grid*, not an overlay: it occupies its own space
 * above the canvas rather than floating over the top-left corner of the work,
 * which is exactly where a motif usually is.
 *
 * Which groups appear is the tool's decision - `options: ['brush', 'mirror']`
 * on the tool def - so this module never switches on a tool id, and neither
 * does anything else (CLAUDE.md 3.3).
 */

import { tools, toolOptions } from '../core/registry.js';
import { state } from '../core/store.js';
import { h } from './dom.js';
import { reactive, svgPath } from './panels/helpers.js';

/** A vertical rule between groups. Purely visual, so it is aria-hidden. */
const separator = () => h('span', { class: 'ob-sep', 'aria-hidden': 'true' });

function build() {
  if (!state.showOptionsBar) return null;

  const tool = tools.get(state.tool);
  if (!tool) return null;

  const wanted = tool.options ?? [];
  const groups = toolOptions
    .sorted()
    .filter((group) => wanted.includes(group.id))
    .map((group) => {
      const body = group.build(tool);
      return body ? h('div', { class: 'ob-group', dataset: { group: group.id } }, body) : null;
    })
    .filter(Boolean);

  // Interleave separators rather than using a border on the group, so the
  // first group does not get a rule hanging off its left edge.
  const between = groups.flatMap((group, i) => (i ? [separator(), group] : [group]));

  return h(
    'div',
    { class: 'ob-row' },
    h(
      'span',
      { class: 'ob-tool', title: tool.hint ?? tool.label },
      svgPath(tool.icon, 16),
      h('span', {}, tool.label)
    ),
    ...(between.length ? [separator(), ...between] : [])
  );
}

/**
 * `registry:changed` is in the list so the bar picks up option groups that
 * register after boot, the same way the tool grid picks up tools.
 * `project:changed` is there for the shape thumbnails, which are drawn in the
 * palette's current color.
 */
export function createOptionsBar(host) {
  return reactive(host, build, ['ui:changed', 'project:changed', 'registry:changed']);
}
