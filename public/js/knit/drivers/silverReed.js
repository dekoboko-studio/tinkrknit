/**
 * Silver Reed electronic beds through the silver-reed-write controller (an
 * RP2040 or the ESP32 sketch on the 8-pin DIN), CLAUDE.md 1.4.
 *
 * Moved here from knit/screen.js unchanged: the loop is silver-reed-write's.
 * A row is sent before each pass and can be replaced at any time until the
 * carriage reaches it; MSG_EXIT_CAMS says the pass is done. On the bed only
 * the SK840 has knitted from it.
 */

import {
  createParser, encodeRow, encodeClear, encodeHello, encodePassInfo, PASS_YARN_CHANGE, PASS_CAM_CHANGE, PASS_DONE,
  LEGACY_MAX_NEEDLES, WIDE_ROW_FIRMWARE,
} from '../protocol.js';

/** A second EXIT inside this window is the same pass reported twice. */
const EXIT_DEBOUNCE_MS = 50;
/** How long to wait for the controller to answer CMD_HELLO. */
const HELLO_WAIT_MS = 1500;

export function createSilverReed(machine, { write, emit }) {
  // Controller firmware version from CMD_HELLO: 0 is the upstream sketch,
  // which must never be sent pass info (knit/protocol.js).
  let firmware = 0;
  let probing = false;
  let isConnected = false;
  let active = false;
  let lastExitAt = -Infinity;
  let lastInfo = null;
  let lastLength = 0;
  const log = (level, text, toast = false) => emit('log', { level, text, toast });

  /** Ask the firmware its version; the upstream sketch says "Unknown command". */
  function probe() {
    probing = true;
    write(encodeHello()).catch(() => {});
    setTimeout(() => {
      if (!probing) return;
      probing = false;
      log('info', 'Controller has no change signals (older firmware).');
    }, HELLO_WAIT_MS);
  }

  function passInfo({ yarnChange, camChange, feeder1, feeder2, next, cam }) {
    const flags = (yarnChange ? PASS_YARN_CHANGE : 0) | (camChange ? PASS_CAM_CHANGE : 0);
    return encodePassInfo({ flags, feeder1, feeder2, next, cam });
  }

  const parser = createParser((msg) => {
    switch (msg.type) {
      case 'exit': {
        const now = performance.now();
        if (now - lastExitAt < EXIT_DEBOUNCE_MS) return;
        lastExitAt = now;
        return emit('passDone');
      }
      case 'enter':
        return emit('enter');
      case 'direction':
        return emit('direction', { dir: msg.dir });
      case 'needle':
        return emit('needle', { index: msg.index });
      case 'ack':
        if (msg.length !== lastLength) log('error', `Controller acknowledged ${msg.length} needles, expected ${lastLength}.`);
        return;
      case 'hello':
        probing = false;
        firmware = msg.version;
        log('info', `Controller firmware v${msg.version}: change signals on.`);
        if (active && lastInfo) write(passInfo(lastInfo)).catch(() => {});
        return;
      case 'error':
        if (probing && msg.text === 'Unknown command') {
          probing = false;
          return log('info', 'Controller has no change signals (older firmware).');
        }
        return log('error', `Controller: ${msg.text}`, true);
      case 'info':
        log('info', msg.text);
        // Opening the port resets an ESP32, so the first hello can land
        // mid-boot and be lost. Its startup line means it is listening now.
        if (isConnected && firmware === 0 && msg.text.startsWith('Starting')) probe();
        return;
      case 'unexpected':
        return log('warn', `Unexpected byte 0x${msg.byte.toString(16).padStart(2, '0')}`);
    }
  });

  return {
    id: 'silverreed',
    baud: 115200,
    connected() {
      isConnected = true;
      firmware = 0;
      parser.reset();
      probe();
    },
    disconnected() {
      isConnected = false;
      active = false;
      firmware = 0;
      probing = false;
    },
    feed: (bytes) => parser.feed(bytes),
    /** Nothing to set up: the controller takes a row whenever it is sent one. */
    async start() {
      active = true;
      return true;
    },
    /**
     * Send the next pass. `row` is needleRow()'s selection (knit/job.js); the
     * controller reads needles in the order the carriage meets them, so a pass
     * traveling right (carriage now on the left) goes reversed -
     * silver-reed-write's selectCurrentRow. Always delivered: a later send
     * replaces it.
     */
    async send({ row, carriageSide, info }) {
      if (row.length > LEGACY_MAX_NEEDLES && firmware < WIDE_ROW_FIRMWARE) {
        throw new Error(`This row is ${row.length} needles; the controller's firmware takes at most ${LEGACY_MAX_NEEDLES}. Update it to v${WIDE_ROW_FIRMWARE} or later, or keep the markers within ${LEGACY_MAX_NEEDLES}.`);
      }
      // Before the row, so the signal is up while the knitter still has hands free.
      lastInfo = info;
      if (firmware >= 1 && info) await write(passInfo(info));
      const wire = carriageSide === 'left' ? row.slice().reverse() : row;
      lastLength = wire.length;
      await write(encodeRow(wire));
      return true;
    },
    async stop() {
      active = false;
      await write(encodeClear());
    },
    /** The piece is done: clear the selection and tell the controller. */
    async finish() {
      active = false;
      await write(encodeClear());
      if (firmware >= 1) await write(encodePassInfo({ flags: PASS_DONE }));
    },
  };
}
