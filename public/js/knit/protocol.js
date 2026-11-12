/**
 * Wire protocol for the silver-reed-write controller firmware
 * (silver-reed-write's firmware/silver_reed_controller/silver_reed_controller.ino).
 *
 * Ported from knitscape/silver-reed-write `src/serial.ts`. The byte values and
 * the packing must match the sketch exactly; change both sides together.
 *
 * TinkrkniT extends it (firmware version 1 and up, in the separate
 * Silver-controller repository): CMD_HELLO asks the version, and
 * CMD_PASS_INFO tells the device about the pass it is about to knit, so it
 * can signal a yarn or cam change on the controller itself. The upstream
 * sketch answers CMD_HELLO with "Unknown command" and must never be sent
 * CMD_PASS_INFO: it reads unknown bytes as commands, and a payload byte of
 * 0x02 would start a bogus row.
 *
 * Pure: no DOM, no serial port. `serial.js` owns the connection and feeds bytes
 * through `createParser`, which is what lets this be checked on its own.
 */

// Host -> device
export const CMD_SET_ROW = 0x02; // [CMD, needleCount, packed...]
export const CMD_CLEAR_ROW = 0x03;
export const CMD_HELLO = 0x10; // [CMD] -> MSG_HELLO
export const CMD_PASS_INFO = 0x11; // [CMD, length, payload...], see encodePassInfo

// Device -> host
export const MSG_ACK_ROW = 0x04; // [MSG, needleCount]
export const MSG_ENTER_CAMS = 0x05; // carriage entered the point-cam range
export const MSG_EXIT_CAMS = 0x06; // carriage left the range: the pass is done
export const MSG_CHANGE_DIRECTION = 0x07; // [MSG, DIR_*]
export const MSG_STRING = 0x08; // [MSG, STRING_*, length, ...chars]
export const MSG_NEEDLE = 0x09; // [MSG, needleIndex]
export const MSG_HELLO = 0x10; // [MSG, firmwareVersion]

// CMD_PASS_INFO flags
export const PASS_YARN_CHANGE = 0x01; // rethread before this pass
export const PASS_CAM_CHANGE = 0x02; // change the carriage setting before this pass
export const PASS_DONE = 0x04; // the piece is finished

/** Cam codes on the wire, by pass plan cam id. */
export const CAM_CODES = { plain: 0, fairisle: 1, tuck: 2, slip: 3, jacquard: 4 };
const NONE = 0xff;

export const DIR_RIGHT = 0x00;
export const DIR_LEFT = 0x01;

export const STRING_INFO = 0x00;
export const STRING_ERROR = 0x01;

/**
 * The row's length field is one byte. Firmware v3 buffers that many (32
 * bytes); earlier sketches, upstream included, buffer 25 and refuse a row
 * over 200 with "Pattern too long".
 */
export const MAX_NEEDLES = 255;
export const LEGACY_MAX_NEEDLES = 200;
/** The first firmware version that takes rows up to MAX_NEEDLES. */
export const WIDE_ROW_FIRMWARE = 3;

/**
 * Build a CMD_SET_ROW frame. `row` is one 0/1 per needle in the order the
 * carriage will meet them; 1 selects the needle (contrast feeder, DOB high).
 * Packed 8 needles per byte, LSB first: needle 0 is bit 0 of the first byte.
 */
export function encodeRow(row) {
  const count = row.length;
  if (count === 0) throw new Error('Cannot send an empty row.');
  if (count > MAX_NEEDLES) throw new Error(`Row is ${count} needles; the controller takes at most ${MAX_NEEDLES}.`);

  const frame = new Uint8Array(2 + Math.ceil(count / 8));
  frame[0] = CMD_SET_ROW;
  frame[1] = count;
  for (let i = 0; i < count; i++) {
    if (row[i]) frame[2 + (i >> 3)] |= 1 << (i & 7);
  }
  return frame;
}

export function encodeClear() {
  return Uint8Array.of(CMD_CLEAR_ROW);
}

export function encodeHello() {
  return Uint8Array.of(CMD_HELLO);
}

/**
 * Build a CMD_PASS_INFO frame. The payload is length-prefixed so fields can
 * be appended later (a color changer's buttons) without breaking firmware
 * that knows fewer: it keeps what it understands and skips the rest.
 *
 *   0  flags     PASS_* bits
 *   1  feeder 1  its yarn, 0 = A, 1 = B... as lettered on the knit screen
 *                (knit/job.js yarnSetup); 0xFF = empty. Version 1 sent the
 *                design's palette index here, but displayed nothing from it.
 *   2  feeder 2  likewise
 *   3  next      passes from this one to the next change, 0xFF = none ahead
 *   4  cam       CAM_CODES
 */
export function encodePassInfo({ flags = 0, feeder1 = null, feeder2 = null, next = null, cam = 'plain' } = {}) {
  const byte = (v) => (v === null || v === undefined || v < 0 || v > 254 ? NONE : v);
  const payload = [flags & 0xff, byte(feeder1), byte(feeder2), byte(next), CAM_CODES[cam] ?? 0];
  return Uint8Array.of(CMD_PASS_INFO, payload.length, ...payload);
}

/**
 * Byte-at-a-time decoder for device messages. Calls `onMessage` with one of:
 *
 *   { type: 'ack', length }        { type: 'enter' }       { type: 'exit' }
 *   { type: 'direction', dir }     { type: 'needle', index }
 *   { type: 'info', text }         { type: 'error', text } { type: 'unexpected', byte }
 *   { type: 'hello', version }
 *
 * `dir` is 'left' or 'right', the way the carriage is now traveling.
 */
export function createParser(onMessage) {
  let expect = null; // what the next byte means, or null between messages
  let stringType = 0;
  let stringLength = 0;
  let text = '';

  function byte(b) {
    switch (expect) {
      case 'ack':
        expect = null;
        return onMessage({ type: 'ack', length: b });
      case 'direction':
        expect = null;
        return onMessage({ type: 'direction', dir: b === DIR_LEFT ? 'left' : 'right' });
      case 'needle':
        expect = null;
        return onMessage({ type: 'needle', index: b });
      case 'hello':
        expect = null;
        return onMessage({ type: 'hello', version: b });
      case 'stringType':
        stringType = b;
        expect = 'stringLength';
        return;
      case 'stringLength':
        stringLength = b;
        text = '';
        expect = b === 0 ? null : 'stringData';
        if (b === 0) finishString();
        return;
      case 'stringData':
        text += String.fromCharCode(b);
        if (text.length >= stringLength) {
          expect = null;
          finishString();
        }
        return;
    }

    switch (b) {
      case MSG_ACK_ROW: expect = 'ack'; return;
      case MSG_CHANGE_DIRECTION: expect = 'direction'; return;
      case MSG_NEEDLE: expect = 'needle'; return;
      case MSG_HELLO: expect = 'hello'; return;
      case MSG_STRING: expect = 'stringType'; return;
      case MSG_ENTER_CAMS: return onMessage({ type: 'enter' });
      case MSG_EXIT_CAMS: return onMessage({ type: 'exit' });
      default: return onMessage({ type: 'unexpected', byte: b });
    }
  }

  function finishString() {
    onMessage({ type: stringType === STRING_ERROR ? 'error' : 'info', text });
  }

  return {
    feed(bytes) {
      for (const b of bytes) byte(b);
    },
    reset() {
      expect = null;
      text = '';
    },
  };
}
