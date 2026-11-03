/**
 * A tabbed settings dialog: title bar, a rail of tabs, one scrolling page.
 *
 * Project settings and the Library are both this shape. They hold forms - the
 * hat calculator, the add-yarn form - and a form does not fit a toolbar
 * dropdown, whose rows are one action each (CLAUDE.md 5). Docked, they were a
 * permanent column of fields you touch a few times per project.
 *
 * Like the Open project dialog this is a native `<dialog>` opened with
 * `showModal()`, so the browser supplies the backdrop, focus trap and Escape.
 * Keys are stopped at the dialog so the editor's single-letter shortcuts on
 * window never see what is typed into a field here.
 *
 * Each tab's page is built by `reactive()`, the same as a panel, so it redraws
 * on the bus while you work in it and holds off while a field is mid-edit. A
 * page that is not showing is detached, which `reactive()` already treats as
 * "redraw when you are put back" - a closed dialog costs nothing per edit.
 */

import { h, clear } from './dom.js';
import { reactive, svgPath } from './panels/helpers.js';
import { mdiClose } from '../icons.js';

/**
 * @param {object} def
 * @param {string} def.title
 * @param {string} [def.icon]
 * @param {string} [def.subtitle]  the title's tooltip, e.g. "this project only"
 * @param {Array<{id: string, label: string, icon?: string,
 *   build: (api: object) => Node, events?: string[]}>} def.tabs
 */
export function createTabbedDialog(def) {
  let current = def.tabs[0].id;
  const pages = new Map(); // tab id -> { host, draw }

  const rail = h('nav', { class: 'pb-rail dlg-rail' });
  const main = h('section', { class: 'dlg-main' });

  const dialog = h(
    'dialog',
    { class: 'pb dlg', 'aria-label': def.title },
    h(
      'header',
      { class: 'pb-head' },
      def.icon ? h('span', { class: 'panel-icon' }, svgPath(def.icon, 18)) : null,
      h('h2', { class: 'pb-title', title: def.subtitle }, def.title),
      h('span', { class: 'grow' }),
      h(
        'button',
        { type: 'button', class: 'pb-close', title: 'Close  (Esc)', onclick: () => dialog.close() },
        svgPath(mdiClose, 18)
      )
    ),
    h('div', { class: 'pb-body' }, rail, h('div', { class: 'dlg-scroll' }, main))
  );

  const api = {
    show: (id) => show(id),
    close: () => dialog.close(),
    /** Redraw the page that is showing, for state that is not on the bus. */
    redraw: () => pages.get(current)?.draw(),
  };

  function page(tab) {
    if (!pages.has(tab.id)) {
      const host = h('div', { class: 'dlg-page' });
      // Attached for the first draw so `reactive()` renders it at once.
      main.append(host);
      const draw = reactive(host, () => tab.build(api), tab.events ?? ['project:changed']);
      pages.set(tab.id, { host, draw });
    }
    return pages.get(tab.id);
  }

  function renderRail() {
    clear(rail);
    rail.append(
      ...def.tabs.map((tab) =>
        h(
          'button',
          {
            type: 'button',
            class: `pb-rail-item ${tab.id === current ? 'is-active' : ''}`.trim(),
            onclick: () => show(tab.id),
          },
          tab.icon ? svgPath(tab.icon, 16) : null,
          h('span', { class: 'grow' }, tab.label)
        )
      )
    );
  }

  function show(id) {
    const tab = def.tabs.find((t) => t.id === id) ?? def.tabs[0];
    current = tab.id;
    renderRail();
    const { host, draw } = page(tab);
    clear(main);
    main.append(host);
    draw();
    main.parentElement.scrollTop = 0;
  }

  dialog.addEventListener('keydown', (event) => event.stopPropagation());

  // A click on the backdrop lands on the dialog element itself.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });

  // Detach the page, so edits made while the dialog is shut cost nothing.
  dialog.addEventListener('close', () => clear(main));

  document.body.append(dialog);

  return {
    /**
     * @param {string} [tabId]  which tab to land on; the last one used if omitted
     */
    open(tabId) {
      show(tabId ?? current);
      if (!dialog.open) dialog.showModal();
    },
    isOpen: () => dialog.open,
  };
}
