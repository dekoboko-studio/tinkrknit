/**
 * About: the app's name, version and maker, and where to go for help.
 *
 * The same tabbed dialog as Project settings and the Library (ui/dialog.js),
 * so it looks and closes like them. Opened from the logo in the toolbar and
 * from the File menu.
 *
 * A link whose URL is still empty below shows as "Coming soon" rather than
 * as a dead link. Fill the URL in and it becomes a link; nothing else changes.
 */

import { h } from './dom.js';
import { stat, svgPath } from './panels/helpers.js';
import { createTabbedDialog } from './dialog.js';
import { serialSupported } from '../knit/serial.js';
import { STORAGE } from '../api.js';
import { APP_NAME, APP_VERSION } from '../version.js';
import {
  mdiInformationOutline, mdiHeartOutline, mdiHelpCircleOutline, mdiWeb,
  mdiCoffeeOutline, mdiOpenInNew,
} from '../icons.js';

const STUDIO = 'Dekoboko Studio';
const STUDIO_URL = 'https://dekobokostudio.com';
export const USER_GUIDE_URL = 'https://tinkrknit.com/guide/';
export const KOFI_URL = 'https://ko-fi.com/dekobokostudio';

/** A titled group, as in Project settings. */
function group(title, ...children) {
  return h(
    'section',
    { class: 'dlg-group' },
    h('h3', { class: 'dlg-group-title' }, title),
    ...children
  );
}

/** One row: icon, label, and a link out (or "Coming soon" with no URL yet). */
function linkRow(icon, label, url, text) {
  return h(
    'div',
    { class: 'about-link' },
    svgPath(icon, 18),
    h('span', { class: 'grow' }, label),
    url
      ? h(
          'a',
          { class: 'link', href: url, target: '_blank', rel: 'noopener' },
          text ?? url.replace(/^https?:\/\//, ''),
          svgPath(mdiOpenInNew, 13)
        )
      : h('span', { class: 'hint' }, 'Coming soon')
  );
}

function aboutPage() {
  const year = new Date().getFullYear();
  return h(
    'div',
    { class: 'dlg-groups' },
    h(
      'div',
      { class: 'about-hero' },
      h('img', { class: 'about-logo', src: 'img/logo-white-notxt.png', alt: '' }),
      h(
        'div',
        {},
        h('h1', { class: 'about-name' }, APP_NAME),
        h('p', { class: 'note-line' }, 'Colorwork design and knitting for electronic flatbed machines'),
        h('p', { class: 'note-line' }, `Version ${APP_VERSION}`)
      )
    ),
    group(
      'Links',
      linkRow(mdiWeb, `Made by ${STUDIO}`, STUDIO_URL),
      linkRow(mdiHelpCircleOutline, 'User guide', USER_GUIDE_URL),
      linkRow(mdiCoffeeOutline, 'Support development', KOFI_URL, 'Buy us a coffee on Ko-fi')
    ),
    group(
      'This browser',
      h(
        'div',
        { class: 'row' },
        stat(
          'Web Serial',
          serialSupported() ? 'Available' : 'Not available',
          'Needed to drive the machine from the Knit screen: Chrome, Edge or Firefox 151+, on localhost or https'
        ),
        stat(
          'Library',
          STORAGE === 'server' ? 'On this server' : 'In this browser',
          STORAGE === 'server'
            ? 'Projects, stamps and yarns are saved on the server this page came from'
            : 'Projects, stamps and yarns are saved in this browser only. Back up from the File menu.'
        )
      )
    ),
    h('p', { class: 'hint' }, `© ${year} ${STUDIO}. All rights reserved.`)
  );
}

function creditsPage() {
  return h(
    'div',
    { class: 'dlg-groups' },
    group(
      'Built on',
      linkRow(
        mdiHeartOutline,
        'silver-reed-write by knitscape: the machine controller and protocol',
        'https://github.com/knitscape/silver-reed-write',
        'github.com/knitscape'
      ),
      linkRow(
        mdiHeartOutline,
        'AYAB: the serial protocol the Brother driver speaks',
        'https://ayab-knitting.com',
        'ayab-knitting.com'
      ),
      linkRow(
        mdiHeartOutline,
        'Material Design Icons (Apache-2.0)',
        'https://pictogrammers.com/library/mdi/',
        'pictogrammers.com'
      )
    )
  );
}

let dialog = null;

export function openAbout(tab) {
  dialog ??= createTabbedDialog({
    title: `About ${APP_NAME}`,
    icon: mdiInformationOutline,
    tabs: [
      { id: 'about', label: 'About', icon: mdiInformationOutline, build: aboutPage, events: [] },
      { id: 'credits', label: 'Credits', icon: mdiHeartOutline, build: creditsPage, events: [] },
    ],
  });
  dialog.open(tab);
}
