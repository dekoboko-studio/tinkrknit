/**
 * Bootstrap.
 *
 * Order matters here: register the extension points first, then build the UI
 * that reads those registries, then pull the libraries off the API. Everything
 * after that is event wiring - no module calls into another module's DOM.
 */

import { registerBuiltinTools, nudgeStamp, forgetStamp } from './editor/tools.js';
import { registerBuiltinShapes } from './editor/shapes.js';
import { registerBuiltinExporters } from './export/index.js';
import './ui/panels/index.js';
import './ui/menus/index.js';
import './ui/options/index.js';

import { state, setUI, history, commit, validation } from './core/store.js';
import { on, emit } from './core/bus.js';
import { createEditor } from './editor/canvas.js';
import { createDockManager, createResizer } from './ui/dock.js';
import { createOptionsBar } from './ui/optionsBar.js';
import { createToolbarMenu, closeAllMenus } from './ui/menu.js';
import { openProjectBrowser } from './ui/projectBrowser.js';
import { menus } from './core/registry.js';
import { TOOL_KEYS } from './ui/panels/tools.js';
import { OPS } from './model/stitch.js';
import { loadYarns, loadStamps, openLibrary } from './ui/library.js';
import { openProjectSettings } from './ui/projectSettings.js';
import { openAbout, USER_GUIDE_URL, KOFI_URL } from './ui/about.js';
import { copySelection, cutSelection, paste, clearSelection } from './ui/selectionActions.js';
import { listProjects, saveProject, importProjectFile, confirmDiscard, renameOpenProject } from './ui/projectStore.js';
import { initBackup } from './ui/backup.js';
import { initPwa } from './pwa.js';
import { serialSupported } from './knit/serial.js';
import { openFullPreview, isFullPreviewOpen } from './ui/previewOverlay.js';
import { setZoom, MIN_CELL, MAX_CELL, rowTop, rowHeight } from './editor/viewport.js';
import { rowLayout, rowName, panelRows } from './model/rows.js';
import { h, $, clear, toast, checkbox } from './ui/dom.js';
import { svgPath } from './ui/panels/helpers.js';
import {
  mdiUndoVariant, mdiRedoVariant, mdiEyeOutline, mdiContentSave, mdiSend, mdiMinus, mdiPlus,
  mdiTune, mdiBookshelf, mdiAspectRatio, mdiCheckCircleOutline, mdiAlertCircleOutline,
  mdiHelpCircleOutline, mdiHeartOutline,
} from './icons.js';
import { buildJob, jobBlocker } from './knit/job.js';
import { createKnitScreen } from './knit/screen.js';
import { api, STORAGE } from './api.js';

registerBuiltinTools();
registerBuiltinShapes();
registerBuiltinExporters();

const editor = createEditor($('#grid'));

// Above the grid: whichever settings the selected tool asked for. It reads the
// registries like a panel does, so it needs nothing from here but its host.
createOptionsBar($('#options-bar'));

const dock = createDockManager({
  left: $('#dock-left'),
  right: $('#dock-right'),
  bottom: $('#dock-bottom'),
});
dock.render();

const resizers = [
  createResizer($('#resize-left'), { property: '--dock-left-w', min: 200, max: 520 }),
  createResizer($('#resize-right'), {
    property: '--dock-right-w',
    min: 220,
    max: 640,
    invert: true,
  }),
];

// --- top bar ----------------------------------------------------------------

function toolbarButton({ label, icon, title, onclick, variant = '', disabled = false }) {
  return h(
    'button',
    { class: `tb-btn ${variant}`.trim(), title, onclick, disabled },
    icon ? svgPath(icon, 18) : null,
    h('span', {}, label)
  );
}

function zoomBy(factor) {
  const canvas = $('#grid');
  const next = Math.max(MIN_CELL, Math.min(MAX_CELL, editor.viewport.cell * factor));
  setZoom(editor.viewport, next, canvas.clientWidth / 2, canvas.clientHeight / 2);
  editor.draw();
  renderViewControls();
}

/** The view menu doubles as the panel switchboard, so a hidden panel is findable. */
function buildViewMenu() {
  return h(
    'div',
    { class: 'stack' },
    h('h5', { class: 'sub-title' }, 'Guides'),
    ...[
      ['showGrid', 'Grid lines'],
      ['showRulers', 'Rulers'],
      ['showPanelGhost', 'Ghost repeats'],
      ['showRepeatMarks', 'Repeat marks'],
      ['showOptionsBar', 'Tool options bar'],
    ].map(([key, label]) =>
      checkbox({
        label,
        checked: state[key],
        onchange: (v) => {
          setUI({ [key]: v });
          editor.draw();
        },
      })
    ),

    h('h5', { class: 'sub-title' }, 'Panels'),
    ...dock.list().map((panel) =>
      checkbox({
        label: panel.title,
        checked: !panel.hidden,
        onchange: (v) => dock.setHidden(panel.id, !v),
      })
    ),

    h('hr', {}),
    h(
      'button',
      {
        class: 'btn',
        title: 'Put every panel back in its default dock, open and shown, and the sidebars back to their default widths',
        onclick: () => {
          dock.reset();
          for (const resizer of resizers) resizer.reset();
          toast('Panel layout reset.', 'ok');
        },
      },
      'Reset layout'
    )
  );
}

const toolbar = $('#toolbar');

const knitScreen = createKnitScreen($('#knit'), {
  designer: $('.app'),
  onClose: () => {
    editor.draw();
    renderToolbar();
  },
  onChange: () => renderToolbar(),
});

// Menu elements are made once and re-appended on every toolbar render, so a
// menu that is open stays open when something behind it changes.
//
// File comes first and the output menus (Export) after the two dialogs, so the
// bar reads left to right: the file, this project's settings, the library
// shared by every project, then what leaves the app.
const FILE_ORDER_MAX = 15;
const fileMenus = menus.sorted().filter((def) => (def.order ?? 0) < FILE_ORDER_MAX).map(createToolbarMenu);
const outputMenus = menus.sorted().filter((def) => (def.order ?? 0) >= FILE_ORDER_MAX).map(createToolbarMenu);
const viewMenuEl = createToolbarMenu({
  id: 'view',
  label: 'View',
  title: 'Show or hide panels and grid guides',
  events: ['ui:changed', 'dock:rendered'],
  build: buildViewMenu,
});

// The project name is edited in place. Like the menus it is made once, so a
// toolbar rebuild mid-edit cannot throw away what is being typed.
const nameInput = h('input', {
  type: 'text',
  class: 'project-name-input',
  title: 'Project name - click to rename',
  spellcheck: false,
  onkeydown: (event) => {
    if (event.key === 'Enter') event.target.blur();
    if (event.key === 'Escape') {
      event.target.value = state.project.name;
      event.target.blur();
    }
  },
  onchange: (event) => {
    const name = event.target.value.trim() || 'Untitled';
    event.target.value = name;
    renameOpenProject(name).catch((error) => toast(`Rename failed: ${error.message}`, 'error'));
  },
});

function renderToolbar() {
  if (document.activeElement !== nameInput) nameInput.value = state.project.name;
  clear(toolbar);
  toolbar.append(
    h('div', { class: 'tb-lead' }, h(
      'button',
      {
        type: 'button',
        class: 'brand',
        title: 'About TinkrkniT',
        onclick: () => {
          closeAllMenus();
          openAbout();
        },
      },
      h('img', { src: 'img/logo-white-notxt.png', alt: 'TinkrkniT' })
    ), nameInput),

    h('span', { class: 'tb-sep' }),
    ...fileMenus,
    toolbarButton({
      label: 'Project',
      icon: mdiTune,
      title: 'Settings for this project: size, gauge, yarn estimate, details',
      onclick: () => {
        closeAllMenus();
        openProjectSettings();
      },
    }),
    toolbarButton({
      label: 'Library',
      icon: mdiBookshelf,
      title: 'Shared by every project: yarn stock and stamps',
      onclick: () => {
        closeAllMenus();
        openLibrary();
      },
    }),
    ...outputMenus,

    h('span', { class: 'tb-sep' }),
    toolbarButton({
      label: state.saving ? 'Saving...' : 'Save',
      icon: mdiContentSave,
      variant: `tb-solid ${state.dirty ? 'is-dirty' : ''}`.trim(),
      title: state.dirty
        ? 'Save the project  (Ctrl+S)'
        : 'No unsaved changes  (Ctrl+S)',
      disabled: state.saving,
      onclick: () => save(),
    }),
    toolbarButton({
      label: knitScreen.isPatterning() ? 'Knitting' : 'Knit',
      icon: mdiSend,
      // Say so before a job is set up, not after: the knit screen opens
      // either way, but cannot connect to the machine here.
      variant: `tb-knit ${knitScreen.isPatterning() ? 'is-live' : ''} ${serialSupported() ? '' : 'no-serial'}`
        .replace(/\s+/g, ' ').trim(),
      title: knitScreen.isPatterning()
        ? 'Patterning is running - back to the knit screen  (K)'
        : serialSupported()
          ? 'Knit this panel on the machine  (K)'
          : 'Knitting needs Chrome, Edge or Firefox 151+ (this browser has no Web Serial)  (K)',
      onclick: () => openKnit(),
    }),

    h('span', { class: 'tb-sep' }),
    toolbarButton({
      label: 'Preview',
      icon: mdiEyeOutline,
      title: 'Simulated preview, filling the window  (P)',
      onclick: () => openFullPreview(),
    }),
    viewMenuEl,

    h(
      'div',
      { class: 'tb-end' },
      toolbarLink({ icon: mdiHelpCircleOutline, title: 'User guide', href: USER_GUIDE_URL }),
      toolbarLink({ icon: mdiHeartOutline, title: 'Support development on Ko-fi', href: KOFI_URL, variant: 'tb-heart' })
    )
  );
}

/** An icon-only link out, styled as a toolbar button. Opens in a new tab. */
function toolbarLink({ icon, title, href, variant = '' }) {
  return h(
    'a',
    { class: `tb-btn tb-icon ${variant}`.trim(), title, href, target: '_blank', rel: 'noopener' },
    svgPath(icon, 18)
  );
}

// --- view controls ----------------------------------------------------------

/**
 * Undo, redo and zoom float as pills in the grid's bottom-right corner rather
 * than in the toolbar: they act on what is under them, and the corner is the
 * part of the canvas a motif - drawn from the top-left - reaches last.
 * The box is rebuilt on its own events so a zoom never re-renders the toolbar.
 */
const viewControls = $('#view-controls');

function pillButton({ icon, label, title, onclick, disabled = false }) {
  return h(
    'button',
    { type: 'button', class: 'pill-btn', title, onclick, disabled },
    icon ? svgPath(icon, 17) : null,
    label ? h('span', {}, label) : null
  );
}

function renderViewControls() {
  clear(viewControls);
  viewControls.append(
    h(
      'div',
      { class: 'pill' },
      pillButton({
        icon: mdiUndoVariant,
        title: history.canUndo()
          ? `Undo ${history.nextUndoLabel()}  (Ctrl+Z)`
          : 'Nothing to undo',
        disabled: !history.canUndo(),
        onclick: () => history.undo(),
      }),
      pillButton({
        icon: mdiRedoVariant,
        title: history.canRedo()
          ? `Redo ${history.nextRedoLabel()}  (Ctrl+Y)`
          : 'Nothing to redo',
        disabled: !history.canRedo(),
        onclick: () => history.redo(),
      })
    ),
    h(
      'div',
      { class: 'pill' },
      pillButton({ icon: mdiMinus, title: 'Zoom out', onclick: () => zoomBy(1 / 1.3) }),
      h('span', { class: 'zoom-readout' }, `${Math.round(editor.viewport.cell)} px`),
      pillButton({ icon: mdiPlus, title: 'Zoom in', onclick: () => zoomBy(1.3) }),
      h('span', { class: 'pill-sep' }),
      pillButton({
        label: 'Fit',
        title: 'Fit the tile to the window  (0)',
        onclick: () => editor.fitToView(),
      })
    )
  );
}

async function save() {
  try {
    await saveProject();
    toast('Saved.', 'ok');
  } catch (error) {
    toast(error.message, 'error', 6000);
  }
}

// --- knit screen ------------------------------------------------------------

/**
 * Freeze the panel into a job and switch to the knit screen (knit/screen.js).
 * It is a view in this page, so going back and forth keeps the serial port
 * open; the screen itself decides whether the job replaces the one under way.
 */
function openKnit() {
  const blocker = jobBlocker(state.project);
  if (blocker) return toast(blocker, 'error', 6000);

  const job = buildJob(state.project);
  knitScreen.open(job);
  if (job.substitutions) {
    toast(`${job.substitutions} stitches were reduced to two colors per row for knitting.`, 'warn', 7000);
  }
}

// --- status bar -------------------------------------------------------------

/**
 * Along the bottom: the size of what you are drawing and whether it knits.
 *
 * Tile and panel size are the first thing a new project needs and they used to
 * sit halfway down a settings panel. Here they are always in view, and the chip
 * is the way into Project settings. The knittability badge is the one-line
 * version of the Knittability panel and brings that panel into view.
 */
const statusbar = $('#statusbar');
const cursorReadout = h('span', { class: 'sb-cursor' });

function renderStatusbar() {
  const { tile, panel } = state.project;
  const layout = rowLayout(state.project);
  const report = validation();
  const bad = report.errors.length + report.warnings.length;

  clear(statusbar);
  statusbar.append(
    h(
      'button',
      {
        type: 'button',
        class: 'sb-chip',
        title: 'Change the tile or panel size  (Project settings)',
        onclick: () => openProjectSettings('size'),
      },
      svgPath(mdiAspectRatio, 14),
      h('span', {}, 'Tile ', h('strong', {}, `${tile.w} x ${layout ? layout.span : tile.h}`)),
      h('span', { class: 'sb-dot' }, '·'),
      h('span', {}, 'Panel ', h('strong', {}, `${panel.w} x ${panelRows(state.project)}`)),
      // A converted stitch chart is sized in drawn rows; this is what it knits.
      layout ? h('span', { class: 'muted' }, `(${panel.h} passes)`) : null
    ),
    h(
      'button',
      {
        type: 'button',
        class: `sb-chip is-${report.level}`,
        title: 'Show the Knittability panel',
        onclick: () => dock.reveal('validation'),
      },
      svgPath(report.level === 'ok' ? mdiCheckCircleOutline : mdiAlertCircleOutline, 14),
      h(
        'span',
        {},
        report.level === 'ok'
          ? 'Knittable'
          : report.summary.slice(0, 2).join(', ') || `${bad} issues`
      )
    ),
    h('span', { class: 'grow' }),
    cursorReadout
  );
  renderCursor();
}

function renderCursor() {
  const hover = editor.hover;
  const tile = state.project.tile;
  const inside = hover && hover.y >= 0 && hover.y < tile.h;

  // Rows read from the cast-on edge upward, the way a knitter counts them.
  cursorReadout.textContent = inside ? `col ${hover.x + 1}   row ${rowName(state.project, hover.y)}` : '';
}

// --- keyboard ---------------------------------------------------------------

const typing = (target) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

window.addEventListener('keydown', (event) => {
  if (typing(event.target)) return;

  // The knit screen hides the designer and handles its own keys.
  if (knitScreen.isOpen()) return;

  // The full-window preview covers the editor. Letting tool or slot shortcuts
  // through would change things the user cannot see happening.
  if (isFullPreviewOpen()) {
    // The overlay handles these itself when it has focus; this is the fallback
    // for when focus has drifted back out to the document.
    const k = event.key.toLowerCase();
    if (k === 'p' || k === 'escape') openFullPreview();
    return;
  }

  const ctrl = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();

  if (ctrl && key === 'z') {
    event.preventDefault();
    if (event.shiftKey) history.redo();
    else history.undo();
    return;
  }
  if (ctrl && key === 'y') {
    event.preventDefault();
    history.redo();
    return;
  }
  if (ctrl && key === 's') {
    event.preventDefault();
    save();
    return;
  }
  if (ctrl && key === 'o') {
    event.preventDefault();
    closeAllMenus();
    openProjectBrowser();
    return;
  }
  // Copy, cut and paste act on the selection whatever tool is in hand; paste
  // picks the copy up as a stamp (ui/selectionActions.js).
  if (ctrl && key === 'c' && copySelection()) return event.preventDefault();
  if (ctrl && key === 'x' && cutSelection()) return event.preventDefault();
  if (ctrl && key === 'v' && paste()) return event.preventDefault();
  if (ctrl) return;

  if ((key === 'delete' || key === 'backspace') && clearSelection()) return event.preventDefault();

  if (event.code === 'Space' && !state.spaceDown) {
    event.preventDefault();
    setUI({ spaceDown: true });
    return;
  }

  // Number keys pick a palette slot. In colorwork that is the most repeated
  // action there is, so it gets the easiest reach on the keyboard.
  // On the stitch layer they pick knit, tuck, slip instead.
  if (key >= '1' && key <= '9' && key.length === 1) {
    const index = Number(key) - 1;
    if (state.layer === 'stitches') {
      if (index < OPS.length) setUI({ stitchOp: index });
    } else if (index < state.project.palette.length) setUI({ primary: index });
    return;
  }
  if (key === 'q') return setUI({ layer: state.layer === 'stitches' ? 'color' : 'stitches' });

  // With a stamp in hand, R turns it a quarter clockwise (Shift+R back) rather
  // than picking the rectangle: turning is what you do between placements, and
  // the hover shows the result at once. Arrows nudge the stamp just placed.
  if (state.tool === 'stamp') {
    if (key === 'r') {
      const t = state.stampTransform;
      return setUI({ stampTransform: { ...t, rotate: (t.rotate + (event.shiftKey ? 270 : 90)) % 360 } });
    }
    const step = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] }[key];
    if (step) {
      const moved = nudgeStamp(step[0], step[1], {
        undo: () => history.undo(),
        place: (paint) => commit('stamp', (p) => paint(p.tile)),
      });
      if (moved) event.preventDefault();
      return;
    }
  }

  if (key === '[') return setUI({ brushSize: Math.max(1, state.brushSize - 1) });
  if (key === ']') return setUI({ brushSize: Math.min(12, state.brushSize + 1) });
  if (key === '0') return editor.fitToView();
  if (key === 'p') return openFullPreview();
  if (key === 'k') return openKnit();
  if (event.key === 'Escape') return setUI({ selection: null });

  const toolId = Object.keys(TOOL_KEYS).find((id) => TOOL_KEYS[id] === key);
  if (toolId) setUI({ tool: toolId });
});

window.addEventListener('keyup', (event) => {
  if (event.code === 'Space') setUI({ spaceDown: false });
});

// Losing focus mid-pan would otherwise leave the editor stuck in pan mode.
window.addEventListener('blur', () => setUI({ spaceDown: false }));

window.addEventListener('beforeunload', (event) => {
  if (!state.dirty) return;
  event.preventDefault();
  event.returnValue = '';
});

// --- wiring -----------------------------------------------------------------

on('project:changed', (payload) => {
  // Only the stamp just placed can be nudged; any other change ends that.
  if (!payload?.transient && payload?.reason !== 'stamp') forgetStamp();
  editor.draw();
  if (!payload?.transient) {
    renderToolbar();
    renderStatusbar();
  }
});
on('ui:changed', () => {
  editor.draw();
  renderCursor();
});
on('editor:redraw', () => editor.draw());
// Panels point at each other through the bus, never by holding the dock.
on('dock:reveal', (panelId) => dock.reveal(panelId));
on('save:changed', renderToolbar);
on('zoom:changed', renderViewControls);
on('history:changed', renderViewControls);
on('dock:rendered', () => editor.draw());
on('layout:resized', () => editor.draw());

$('#grid').addEventListener('pointermove', renderCursor);
$('#grid').addEventListener('pointerleave', renderCursor);

/** Scroll the editor so a flagged row sits in the middle of the view. */
on('editor:focusRow', ({ tileY }) => {
  const canvas = $('#grid');
  const vp = editor.viewport;
  vp.rows = rowLayout(state.project);
  vp.panY += canvas.clientHeight / 2 - (rowTop(vp, tileY) + rowHeight(vp, tileY) / 2);
  editor.draw();
});

// --- boot -------------------------------------------------------------------

renderToolbar();
renderStatusbar();
renderViewControls();
editor.fitToView();

// A .knitproj double-clicked in the OS, once the app is installed.
initPwa({
  onFile: async (file) => {
    if (!confirmDiscard()) return;
    try {
      await importProjectFile(file);
      toast(`Opened ${file.name}. Save it to keep it in the library.`, 'ok');
    } catch (error) {
      toast(error.message, 'error', 8000);
    }
  },
});

(async () => {
  try {
    await api.ping();
  } catch (error) {
    toast(
      STORAGE === 'server'
        ? `Cannot reach the API: ${error.message}. Check that PHP is serving public/ ` +
            'and that data/ is writable.'
        : `Cannot open the library in this browser: ${error.message}`,
      'error',
      12000
    );
    return;
  }

  // The library lives only in this browser: ask not to have it cleared when
  // the disk runs low. Installed apps are usually granted this silently.
  if (STORAGE === 'browser') navigator.storage?.persist?.().catch(() => {});

  // The libraries are independent; one failing should not hide the others.
  const results = await Promise.allSettled([loadYarns(), loadStamps(), listProjects()]);
  for (const result of results) {
    if (result.status === 'rejected') {
      console.error(result.reason);
      toast(`Library failed to load: ${result.reason.message}`, 'warn', 8000);
    }
  }

  // After the load, so loading the library is not taken for a change to back up.
  initBackup();
})();

// Handy in the console while the app is young.
window.knit = { state, editor, dock, emit, commit, history };
