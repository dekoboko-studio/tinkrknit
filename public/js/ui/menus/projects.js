/**
 * Projects menu.
 *
 * Opening a project replaces the document wholesale and clears history, so the
 * dirty check below is the only thing standing between you and losing an
 * unsaved tile. It asks rather than autosaving, because silently overwriting a
 * design you were experimenting on is worse than an extra click.
 *
 * Lives in the toolbar rather than a dock: you save a few times a session and
 * open a project once, so it does not earn permanent width beside the grid.
 *
 * Only the five most recently used projects are listed here. The rest of the
 * library is behind Open project, which has search and room for a big list;
 * a menu that grew with the library pushed Save off the top of the screen.
 */

import { registerMenu } from '../../core/registry.js';
import {
  mdiFolderOpenOutline, mdiContentSave, mdiContentDuplicate, mdiFilePlusOutline,
  mdiFileImportOutline, mdiInformationOutline, mdiTrayArrowDown, mdiHistory,
  mdiShieldCheckOutline, mdiAlertCircleOutline, mdiClose, mdiOpenInNew,
} from '../../icons.js';
import {
  downloadBackup, restoreBackup, backupAge, browserOnly,
  folderSupported, folderStatus, chooseFolder, resumeFolder, stopFolder,
} from '../backup.js';
import { canInstall, install } from '../../pwa.js';
import { state } from '../../core/store.js';
import {
  saveProject, openProject, deleteProject, newProject, importProjectFile,
  confirmDiscard, recentProjects,
} from '../projectStore.js';
import { openProjectBrowser } from '../projectBrowser.js';
import { openProjectSettings } from '../projectSettings.js';
import { openAbout } from '../about.js';
import { h, toast } from '../dom.js';
import { menuItem, menuSection } from '../menu.js';
import { guarded } from '../panels/helpers.js';

const fail = (error) => toast(error.message, 'error', 6000);

const RECENT_IN_MENU = 5;

function projectRow(rowData, api) {
  const isOpen = state.project.id === rowData.id;

  return h(
    'div',
    { class: `project-row ${isOpen ? 'is-open' : ''}` },
    rowData.thumbnail
      ? h('img', { class: 'project-thumb', src: rowData.thumbnail, alt: '' })
      : h('div', { class: 'project-thumb' }),
    h(
      'button',
      {
        class: 'project-open grow',
        title: 'Open this project',
        onclick: guarded(async () => {
          if (!confirmDiscard()) return;
          await openProject(rowData.id);
          // The document just changed underneath everything; get out of the way.
          api.close();
          toast(`Opened ${rowData.name}.`, 'ok');
        }, fail),
      },
      h('strong', {}, rowData.name),
      h(
        'small',
        {},
        `${rowData.panel_w} x ${rowData.panel_h}  tile ${rowData.tile_w} x ${rowData.tile_h}`
      )
    ),
    h('button', {
      class: 'stamp-del',
      textContent: 'x',
      title: 'Delete this project permanently',
      onclick: guarded(async () => {
        if (!confirm(`Delete "${rowData.name}"? This cannot be undone.`)) return;
        await deleteProject(rowData.id);
        toast('Project deleted.', 'ok');
      }, fail),
    })
  );
}

/**
 * Library backup (ui/backup.js). In browser storage the library exists in
 * this browser only, so the last backup's age is always on show here.
 */
function backupSection(api) {
  const restoreInput = h('input', {
    type: 'file',
    accept: 'application/json,.json',
    style: { display: 'none' },
    onchange: guarded(async (event) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      const { added, skipped, tooNew } = await restoreBackup(file);
      api.close();
      toast(
        `Restored ${added} item${added === 1 ? '' : 's'}` +
          (skipped ? `, ${skipped} already here` : '') +
          (tooNew ? `, ${tooNew} from a newer version left out` : '') + '.',
        tooNew ? 'warn' : 'ok',
        tooNew ? 8000 : undefined
      );
    }, fail),
  });

  const folder = folderStatus();
  const folderRows = !folderSupported()
    ? []
    : folder.state === 'none'
      ? [menuItem({
          icon: mdiShieldCheckOutline,
          label: 'Back up to a folder...',
          title: 'Rewritten there after changes, a dated copy a day. A OneDrive, Dropbox or iCloud folder keeps it off this computer too.',
          onclick: guarded(async () => {
            if (await chooseFolder()) toast('Backing up to that folder.', 'ok');
          }, fail),
        })]
      : [
          menuItem({
            icon: folder.state === 'ok' ? mdiShieldCheckOutline : mdiAlertCircleOutline,
            label: folder.state === 'permission' ? 'Resume folder backup' : `Backing up to ${folder.name}`,
            note: folder.state === 'error' ? folder.error : folder.state === 'permission' ? 'Paused: allow access again' : null,
            title: folder.state === 'permission'
              ? `Allow writing to ${folder.name} again`
              : 'Write a backup now',
            onclick: guarded(async () => {
              if (await resumeFolder()) toast('Backed up.', 'ok');
            }, fail),
          }),
          menuItem({
            icon: mdiClose,
            label: 'Stop folder backup',
            title: 'Backups already in the folder are kept',
            onclick: guarded(stopFolder, fail),
          }),
        ];

  return [
    menuSection('Library backup'),
    menuItem({
      icon: mdiTrayArrowDown,
      label: 'Back up library',
      note: `Last backup: ${backupAge()}`,
      title: browserOnly()
        ? 'Every project, stamp and yarn in one file. The library is kept in this browser only.'
        : 'Every project, stamp and yarn in one file',
      onclick: guarded(downloadBackup, fail),
    }),
    ...folderRows,
    menuItem({
      icon: mdiHistory,
      label: 'Restore from backup...',
      title: 'Adds what is missing; anything already in the library is left as it is',
      onclick: () => restoreInput.click(),
    }),
    restoreInput,
  ];
}

function build(api) {
  const library = state.projects ?? [];
  const rows = recentProjects(library, RECENT_IN_MENU);

  const fileInput = h('input', {
    type: 'file',
    accept: '.knitproj,application/json,.json',
    style: { display: 'none' },
    onchange: guarded(async (event) => {
      const file = event.target.files?.[0];
      if (!file || !confirmDiscard()) return;
      await importProjectFile(file);
      api.close();
      toast('Project imported. Save it to keep it.', 'ok');
    }, fail),
  });

  const saveState = state.dirty
    ? 'Unsaved changes'
    : state.lastSavedAt
      ? `Saved ${state.lastSavedAt.toLocaleTimeString()}`
      : 'Nothing saved yet';

  return h(
    'div',
    { class: 'menu-list' },
    menuItem({
      icon: mdiFolderOpenOutline,
      label: 'Open project...',
      title: library.length
        ? `Search all ${library.length} saved project${library.length === 1 ? '' : 's'}`
        : 'Browse saved projects',
      detail: 'Ctrl+O',
      onclick: () => {
        api.close();
        openProjectBrowser();
      },
    }),
    menuItem({
      icon: mdiContentSave,
      label: state.project.id ? 'Save' : 'Save new project',
      note: saveState,
      detail: 'Ctrl+S',
      disabled: state.saving,
      onclick: guarded(async () => {
        await saveProject();
        toast('Saved.', 'ok');
      }, fail),
    }),
    menuItem({
      icon: mdiContentDuplicate,
      label: 'Save as copy',
      title: 'Keeps the open project untouched',
      disabled: state.saving,
      onclick: guarded(async () => {
        await saveProject({ asNew: true });
        toast('Saved as a new project.', 'ok');
      }, fail),
    }),
    menuItem({
      icon: mdiFilePlusOutline,
      label: 'New project',
      title: 'Start from an empty tile, then set its size',
      onclick: () => {
        if (!confirmDiscard()) return;
        newProject();
        api.close();
        // Size is the first decision a new piece needs, so ask for it now
        // rather than leaving the default panel for someone to stumble on.
        openProjectSettings('size');
      },
    }),
    menuItem({
      icon: mdiFileImportOutline,
      label: 'Import file...',
      title: 'A .knitproj file exported from this tool',
      onclick: () => fileInput.click(),
    }),
    fileInput,

    menuSection('Recent projects'),
    rows.length
      ? h('div', { class: 'list' }, ...rows.map((r) => projectRow(r, api)))
      : h('p', { class: 'hint' }, 'No saved projects yet.'),

    ...backupSection(api),

    h('div', { class: 'menu-rule' }),
    canInstall()
      ? menuItem({
          icon: mdiOpenInNew,
          label: 'Install TinkrkniT',
          title: 'Its own window and a desktop or Start menu shortcut; opens without a connection',
          onclick: guarded(async () => {
            api.close();
            await install();
          }, fail),
        })
      : null,
    menuItem({
      icon: mdiInformationOutline,
      label: 'About TinkrkniT',
      title: 'Version, user guide and credits',
      onclick: () => {
        api.close();
        openAbout();
      },
    })
  );
}

registerMenu({
  id: 'projects',
  label: 'File',
  title: 'Save, open, create and import projects',
  icon: mdiFolderOpenOutline,
  order: 10,
  wide: true,
  events: ['library:changed', 'project:changed', 'save:changed', 'backup:changed', 'pwa:changed'],
  build,
});
