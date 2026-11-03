/**
 * Installing the app: service worker, the Install row, and opening a
 * .knitproj that was double-clicked.
 *
 * All of it needs a secure context (https, localhost or 127.0.0.1), the same
 * rule as Web Serial; elsewhere this does nothing and the app runs in a tab.
 * None of it depends on Web Serial: a browser that cannot knit can still
 * install and design (knit/serial.js says what it can and cannot do).
 */

import { emit } from './core/bus.js';

let installPrompt = null;

/** Chrome and Edge offer an install prompt; others install from their own menus. */
export const canInstall = () => installPrompt !== null;

export const isInstalled = () =>
  matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

export async function install() {
  if (!installPrompt) return false;
  const prompt = installPrompt;
  installPrompt = null;
  prompt.prompt();
  const { outcome } = await prompt.userChoice;
  emit('pwa:changed');
  return outcome === 'accepted';
}

async function registerWorker() {
  if (!('serviceWorker' in navigator) || !isSecureContext) return;
  try {
    await navigator.serviceWorker.register('sw.js', { scope: './' });
    const ready = await navigator.serviceWorker.ready;
    // Everything this page loaded before the worker was in control.
    const urls = [
      location.href,
      ...performance.getEntriesByType('resource').map((entry) => entry.name),
    ];
    ready.active?.postMessage({ type: 'cache-urls', urls });
  } catch (error) {
    // Offline use is a nicety; the app works without it.
    console.warn('Service worker not registered:', error);
  }
}

/**
 * @param {{ onFile: (file: File) => void }} hooks  called for each file the OS
 *   hands over (manifest.json `file_handlers`, Chrome and Edge desktop)
 */
export function initPwa({ onFile }) {
  registerWorker();

  addEventListener('beforeinstallprompt', (event) => {
    // Keep it for the File menu's Install row; the address bar icon remains.
    event.preventDefault();
    installPrompt = event;
    emit('pwa:changed');
  });
  addEventListener('appinstalled', () => {
    installPrompt = null;
    emit('pwa:changed');
  });

  if ('launchQueue' in window) {
    window.launchQueue.setConsumer(async (params) => {
      for (const handle of params.files ?? []) onFile(await handle.getFile());
    });
  }
}
