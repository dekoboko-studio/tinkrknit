/**
 * Brother electronic beds through an AYAB interface running AYAB firmware
 * 1.0 or later (serial API v6, knit/ayabProtocol.js). The knitter brings the
 * hardware and flashes the firmware with AYAB's own tools; nothing of AYAB's
 * is shipped here.
 *
 * The loop is the device's, not ours. It asks for line n when it is ready for
 * one, and asking for n + 1 means line n is knitted, so a line cannot be
 * replaced once it is answered: a row picked by hand mid-pass knits after the
 * one already on the machine (screen.js tracks which that is).
 *
 * Written from the spec, not yet knitted on a machine. Unverified: which way
 * a selected needle knits under each cam (sent as 1 = selected, the AYAB
 * desktop's convention), and whether the chart lands mirrored. Swap feeders,
 * Invert stitch selection and Mirror correct those per job.
 */

import {
  API_VERSION, ERROR_WRONG_STATE, errorText, createDeframer, parsePacket,
  encodeReqInfo, encodeReqInit, encodeReqStart, encodeCnfLine,
} from '../ayabProtocol.js';
import { bedPosition, needleCount } from '../job.js';

/** The Uno resets when the port opens; it takes a moment to boot. */
const INFO_RETRY_MS = 1000;
const INFO_TRIES = 6;
const REPLY_WAIT_MS = 2000;

export function createAyab(machine, { write, emit }) {
  const side = machine.needles / 2;
  const bytes = Math.ceil(machine.needles / 8);
  const log = (level, text, toast = false) => emit('log', { level, text, toast });

  let firmware = null; // { api, version } once cnfInfo arrives
  let infoTimer = null;
  let state = null; // the device's state as last reported: 'wait' | 'init' | 'ready' | 'knit' | ...
  let range = null; // [startNeedle, stopNeedle] from the left end, while knitting

  // The line protocol.
  let pending = null; // line number the device is waiting for
  let delivered = null; // last line answered, as { line, frame }
  let ending = false; // the next answer is the blank last line

  // One reply awaited at a time: cnfInit or cnfStart.
  let awaiting = null;
  // Waiting for the knitter to move the carriage across a sensor.
  let readyWait = null;

  const deframer = createDeframer((packet) => handle(parsePacket(packet)));

  function request(frame, type) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        awaiting = null;
        resolve(null);
      }, REPLY_WAIT_MS);
      awaiting = { type, resolve: (error) => { clearTimeout(timer); awaiting = null; resolve(error); } };
      write(frame).catch(() => awaiting?.resolve(null));
    });
  }

  function askInfo(tries = INFO_TRIES) {
    clearTimeout(infoTimer);
    if (firmware) return;
    if (tries === 0) return log('error', 'No answer from AYAB. Check the firmware is AYAB 1.0 or later and the interface is powered.', true);
    write(encodeReqInfo()).catch(() => {});
    infoTimer = setTimeout(() => askInfo(tries - 1), INFO_RETRY_MS);
  }

  const blank = () => encodeCnfLine(pending, [], bytes, { last: true });

  function answerBlank() {
    write(blank()).catch(() => {});
    pending = null;
    ending = false;
    range = null;
  }

  function handle(msg) {
    switch (msg.type) {
      case 'info':
        clearTimeout(infoTimer);
        firmware = msg;
        if (msg.api !== API_VERSION) {
          return log('error', `AYAB firmware ${msg.version} speaks API ${msg.api}; this needs API ${API_VERSION} (AYAB 1.0 or later). Update it with the AYAB desktop app.`, true);
        }
        return log('info', `AYAB firmware ${msg.version}.`);
      case 'init':
      case 'start':
        if (awaiting?.type === msg.type) awaiting.resolve(msg.error);
        return;
      case 'state':
        // The device reports its sensors with error 0 as it leaves init.
        state = msg.state === 'init' && msg.error === 0 ? 'ready' : msg.state;
        if (state === 'ready' && readyWait) readyWait(true);
        if (msg.direction) emit('direction', { dir: msg.direction });
        if (range && msg.position >= range[0] && msg.position <= range[1]) {
          emit('needle', { index: msg.position - range[0] + 1 });
        }
        return;
      case 'line':
        if (delivered && msg.line === delivered.line) {
          // Asked again for the line just answered: it did not arrive whole.
          write(delivered.frame).catch(() => {});
          return;
        }
        pending = msg.line;
        if (ending) return answerBlank();
        // The first request after reqStart; after that, a request means the
        // line before it is knitted.
        return emit(delivered ? 'passDone' : 'needData');
      case 'debug':
        return log('info', `AYAB: ${msg.text}`);
      case 'unexpected':
        return log('warn', `Unexpected AYAB message 0x${msg.id.toString(16).padStart(2, '0')}`);
    }
  }

  /** Resolves true when the device reports ready, false if stopped first. */
  function untilReady() {
    return new Promise((resolve) => {
      readyWait = (ok) => {
        readyWait = null;
        resolve(ok);
      };
    });
  }

  return {
    id: 'ayab',
    baud: 115200,
    connected() {
      deframer.reset();
      firmware = null;
      state = null;
      pending = null;
      delivered = null;
      ending = false;
      askInfo();
    },
    disconnected() {
      clearTimeout(infoTimer);
      awaiting?.resolve(null);
      readyWait?.(false);
      firmware = null;
      state = null;
      range = null;
    },
    feed: (bytes) => deframer.feed(bytes),

    /**
     * Set the device up for these markers. May wait for the knitter to move
     * the carriage across the end of the bed, which AYAB needs to find it.
     */
    async start({ layout }) {
      if (!firmware) {
        log('error', 'AYAB has not answered yet. Wait a moment, or reconnect.', true);
        return false;
      }
      if (firmware.api !== API_VERSION) {
        log('error', `AYAB firmware ${firmware.version} is too old for this screen. Update it with the AYAB desktop app.`, true);
        return false;
      }

      if (state === null || state === 'wait') {
        const error = await request(encodeReqInit(machine.ayabType), 'init');
        if (error === 0) state = 'init';
        else if (error === null) {
          log('error', 'AYAB did not answer the setup request.', true);
          return false;
        } else if (error !== ERROR_WRONG_STATE) {
          log('error', `AYAB setup failed: ${errorText(error)}.`, true);
          return false;
        }
        // Wrong state: it was set up already, for this machine or another.
      }

      const start = bedPosition(layout.left, side);
      const stop = bedPosition(layout.right, side);
      let told = false;
      for (;;) {
        if (state !== 'init') {
          // reqLine(0) follows cnfStart at once, so be ready for it first.
          pending = null;
          delivered = null;
          ending = false;
          range = [start, stop];
          const error = await request(encodeReqStart(start, stop), 'start');
          if (error === 0) {
            state = 'knit';
            return true;
          }
          range = null;
          if (error === null) {
            log('error', 'AYAB did not answer the start request.', true);
            return false;
          }
          if (error < 0xe0) {
            log('error', `AYAB would not start: ${errorText(error)}.`, true);
            return false;
          }
        }
        if (!told) {
          log('info', 'Move the carriage across the left end of the bed, past the turn mark, so AYAB can find it.', true);
          told = true;
        }
        state = 'init';
        if (!(await untilReady())) return false;
      }
    },

    /**
     * Answer the line the device is waiting for, or return false if it is
     * not waiting for one. `row` is needleRow()'s selection, in the SK840's
     * terms (knit/job.js); AYAB takes 1 = selected for the whole bed, indexed
     * from the left end whichever way the carriage travels.
     */
    async send({ row, layout }) {
      if (pending === null || ending) return false;
      const bits = new Array(machine.needles).fill(0);
      const first = bedPosition(layout.left, side);
      const count = needleCount(layout.left, layout.right);
      for (let i = 0; i < count; i++) bits[first + i] = 1 - row[i];
      const frame = encodeCnfLine(pending, bits, bytes);
      delivered = { line: pending, frame };
      pending = null;
      await write(frame);
      return true;
    },

    /**
     * Stop after the line already on the machine. AYAB has no stop message:
     * the next line goes out blank and flagged last, and the device ends
     * (and beeps) when the carriage clears it.
     */
    async stop() {
      readyWait?.(false);
      if (state !== 'knit') return;
      if (pending !== null) answerBlank();
      else ending = true;
    },
    async finish() {
      return this.stop();
    },
  };
}
