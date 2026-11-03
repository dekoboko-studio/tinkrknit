/**
 * Web Serial connection to the controller.
 *
 * Ported from knitscape/silver-reed-write `src/serial.ts`, minus the Redux
 * coupling: this module knows bytes and ports, nothing about rows, patterns
 * or which firmware is listening. Bytes go to `onData`; the machine driver
 * (knit/drivers/) decides what they mean.
 *
 * Web Serial needs a secure context. http://127.0.0.1 and http://localhost
 * count, so the same PHP dev server that serves the designer serves this.
 * Chrome, Edge and Firefox 151+; Safari has no navigator.serial.
 */

const BAUD = 115200;

export const serialSupported = () => 'serial' in navigator;

export function createConnection({ onData, onStatus, onError }) {
  let port = null;
  let reader = null;
  let writer = null;
  // Writes are chained so two rows can never interleave on the wire.
  let writing = Promise.resolve();

  async function connect({ baudRate = BAUD } = {}) {
    if (!serialSupported()) throw new Error('This browser has no Web Serial. Use Chrome, Edge or Firefox 151+.');
    if (port) return;

    const chosen = await navigator.serial.requestPort();
    try {
      await chosen.open({ baudRate });
    } catch (error) {
      // Picked but not opened: on Linux that is nearly always another owner -
      // a second tab, the serial monitor, ModemManager - or no dialout group.
      throw new Error(`Could not open the port (${error.name}: ${error.message}). Close anything else using it - another tab, an Arduino serial monitor - and check you can read the device.`);
    }
    port = chosen;
    writer = port.writable.getWriter();
    reader = port.readable.getReader();
    onStatus?.('connected');
    readLoop(reader);
  }

  async function readLoop(r) {
    try {
      for (;;) {
        const { value, done } = await r.read();
        if (done) break;
        if (value) onData(value);
      }
    } catch (error) {
      // A cable pulled mid-read lands here; it is a disconnect, not a crash.
      onError?.(`Serial read failed: ${error.message}`);
    }
    if (reader === r) await teardown();
  }

  function write(bytes) {
    writing = writing.then(async () => {
      if (!writer) throw new Error('Not connected to the controller.');
      await writer.write(bytes);
    });
    return writing;
  }

  async function teardown() {
    const p = port;
    port = null;
    try { reader?.releaseLock(); } catch {}
    try { writer?.releaseLock(); } catch {}
    reader = null;
    writer = null;
    writing = Promise.resolve();
    try { await p?.close(); } catch {}
    if (p) onStatus?.('disconnected');
  }

  async function disconnect() {
    const r = reader;
    reader = null; // tells readLoop not to tear down a second time
    try { await r?.cancel(); } catch {}
    // The port will not close while either stream is still locked.
    try { r?.releaseLock(); } catch {}
    try { await writing; } catch {}
    await teardown();
  }

  // Unplugging the board fires this rather than ending the read cleanly.
  if (serialSupported()) {
    navigator.serial.addEventListener('disconnect', (event) => {
      if (event.target === port) disconnect();
    });
  }

  return {
    connect,
    disconnect,
    connected: () => port !== null,
    write,
  };
}
