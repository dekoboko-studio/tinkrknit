/**
 * Extension points. Every pluggable thing in the app lives in one of these
 * registries so that adding a feature is an *addition*, never an edit to a
 * switch statement in core code. See CLAUDE.md section 3.3.
 */

import { emit } from './bus.js';

function makeRegistry(kind, requiredKeys = ['id']) {
  const items = new Map();

  return {
    kind,

    register(def) {
      for (const key of requiredKeys) {
        if (def?.[key] === undefined) {
          throw new Error(`${kind} registration is missing "${key}"`);
        }
      }
      if (items.has(def.id)) {
        console.warn(`${kind} "${def.id}" was already registered; replacing it.`);
      }
      items.set(def.id, Object.freeze({ ...def }));
      emit('registry:changed', { kind, id: def.id });
      return def.id;
    },

    get: (id) => items.get(id),
    has: (id) => items.has(id),
    all: () => [...items.values()],
    ids: () => [...items.keys()],

    /** Registration order is display order unless a def sets `order`. */
    sorted() {
      return [...items.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    },
  };
}

export const tools = makeRegistry('tool', ['id', 'label']);
export const shapes = makeRegistry('shape', ['id', 'label', 'rasterize']);
export const panels = makeRegistry('panel', ['id', 'title', 'render']);
export const exporters = makeRegistry('exporter', ['id', 'label', 'run']);

/** Toolbar dropdowns: panels that are built on open instead of living in a dock. */
export const menus = makeRegistry('menu', ['id', 'label', 'build']);

/**
 * Groups of controls for the options bar above the grid.
 *
 * The coupling runs from the tool, not from the group: a tool def lists the
 * group ids it wants in `options`, and the bar shows those groups in registry
 * order. So a new tool that wants a brush size declares `options: ['brush']`
 * and changes nothing here, and a new kind of control is one file plus one
 * `registerToolOptions` call - the same bargain as every other registry.
 *
 * `build(tool)` is handed the active tool def, because a control can mean a
 * slightly different thing from one tool to the next: the same brush size is
 * a nib for the pencil and an outline thickness for the rectangle.
 */
export const toolOptions = makeRegistry('tool options', ['id', 'build']);

export const registerTool = (def) => tools.register(def);
export const registerShape = (def) => shapes.register(def);
export const registerPanel = (def) => panels.register(def);
export const registerExporter = (def) => exporters.register(def);
export const registerMenu = (def) => menus.register(def);
export const registerToolOptions = (def) => toolOptions.register(def);
