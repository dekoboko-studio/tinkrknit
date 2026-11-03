/**
 * Wire protocol for AYAB firmware, serial API v6 (AYAB 1.0, February 2025).
 *
 * Written from the published spec (manual.ayab-knitting.com, Development >
 * API) and checked against ayab-firmware's src/ayab/com.cpp and knitter.cpp.
 * No AYAB code is copied: the firmware and desktop app are GPL-3, the
 * message layout is not theirs to license. Not yet run against a machine.
 *
 * Every message is one SLIP packet (RFC 1055) at 115200 baud: an ID byte,
 * then its fields. ID bit 7 is set on messages from the device. Where a
 * message has a CRC it is CRC-8 Dallas/Maxim over every byte before it,
 * the ID included.
 *
 * Pure: no DOM, no serial port, like protocol.js.
 */

export const API_VERSION = 6;

// Host -> device
export const REQ_START = 0x01; // [ID, startNeedle, stopNeedle, flags, crc]
export const REQ_INFO = 0x03; // [ID]
export const REQ_INIT = 0x05; // [ID, machineType, crc]
export const CNF_LINE = 0x42; // [ID, line, color, flags, ...lineData, crc]

// Device -> host
export const CNF_START = 0xc1; // [ID, error]
export const REQ_LINE = 0x82; // [ID, line, error]
export const CNF_INFO = 0xc3; // [ID, api, major, minor, patch, ...suffix]
export const IND_STATE = 0x84; // [ID, error, state, hallL(2), hallR(2), carriage, position, direction]
export const CNF_INIT = 0xc5; // [ID, error]
export const TEST_RES = 0xee; // [ID, ...text]
export const DEBUG = 0x9f; // [ID, ...text]

// reqStart flags
const START_CONTINUOUS = 0x01; // indState on every needle while knitting
const START_BEEPER = 0x02;
// cnfLine flags
const LINE_LAST = 0x01;

/** The firmware's FSM states, by the number indState carries. */
const STATES = ['wait', 'init', 'ready', 'knit', 'test', 'error'];
const CARRIAGES = { 0: 'knit', 1: 'lace', 2: 'garter' };

export const ERROR_WRONG_STATE = 0xef;

const ERRORS = {
  0x01: 'message too short',
  0x02: 'unknown message',
  0x03: 'unexpected message',
  0x04: 'checksum error',
  0x10: 'invalid machine type',
  0x11: 'invalid start or stop needle',
  0x13: 'invalid argument',
  0x20: 'no machine type set',
  0x21: 'no carriage detected',
  0x22: 'no carriage direction',
  0x23: 'belt phase unknown',
  0xe0: 'machine is initializing',
  0xe1: 'machine is ready, not knitting',
  0xe2: 'machine is knitting',
  0xe3: 'machine is in test mode',
  0xef: 'wrong machine state',
};

export const errorText = (code) => ERRORS[code] ?? `error 0x${code.toString(16).padStart(2, '0')}`;

/** CRC-8 Dallas/Maxim: reflected polynomial 0x8C, starting from 0. */
export function crc8(bytes, length = bytes.length) {
  let crc = 0;
  for (let i = 0; i < length; i++) {
    let b = bytes[i];
    for (let bit = 0; bit < 8; bit++) {
      const mix = (crc ^ b) & 1;
      crc >>= 1;
      if (mix) crc ^= 0x8c;
      b >>= 1;
    }
  }
  return crc;
}

// --- SLIP --------------------------------------------------------------------

const END = 0xc0;
const ESC = 0xdb;
const ESC_END = 0xdc;
const ESC_ESC = 0xdd;

/** One packet, framed with END at both ends as sliplib does. */
export function slip(packet) {
  const out = [END];
  for (const b of packet) {
    if (b === END) out.push(ESC, ESC_END);
    else if (b === ESC) out.push(ESC, ESC_ESC);
    else out.push(b);
  }
  out.push(END);
  return Uint8Array.from(out);
}

/** Byte-at-a-time SLIP decoder. Empty packets (back-to-back ENDs) are dropped. */
export function createDeframer(onPacket) {
  let buf = [];
  let escaped = false;
  return {
    feed(bytes) {
      for (const b of bytes) {
        if (escaped) {
          escaped = false;
          buf.push(b === ESC_END ? END : b === ESC_ESC ? ESC : b);
        } else if (b === ESC) {
          escaped = true;
        } else if (b === END) {
          if (buf.length) onPacket(Uint8Array.from(buf));
          buf = [];
        } else {
          buf.push(b);
        }
      }
    },
    reset() {
      buf = [];
      escaped = false;
    },
  };
}

// --- host -> device ----------------------------------------------------------

const withCrc = (bytes) => slip([...bytes, crc8(bytes)]);

export const encodeReqInfo = () => slip([REQ_INFO]);

/** `machineType`: 0 KH-910/950i, 1 KH-930/940/965i, 2 KH-270. */
export const encodeReqInit = (machineType) => withCrc([REQ_INIT, machineType]);

/** Needles count 0.. from the left end of the bed; the firmware wants start < stop. */
export function encodeReqStart(startNeedle, stopNeedle, { continuous = true, beeper = true } = {}) {
  const flags = (continuous ? START_CONTINUOUS : 0) | (beeper ? START_BEEPER : 0);
  return withCrc([REQ_START, startNeedle, stopNeedle, flags]);
}

/**
 * One line for the whole bed: `bits[n]` is needle n from the left end, 1 =
 * selected. Packed 8 needles a byte, LSB first, `bytes` long (25 for 200
 * needles, 14 for the KH-270's 112). The firmware inverts the bytes on
 * arrival, so 1 on the wire is a set pixel as the desktop app sends it.
 * `line` is the number from the reqLine being answered, modulo 256.
 */
export function encodeCnfLine(line, bits, bytes, { color = 0, last = false } = {}) {
  const data = new Array(bytes).fill(0);
  for (let n = 0; n < bits.length && n < bytes * 8; n++) {
    if (bits[n]) data[n >> 3] |= 1 << (n & 7);
  }
  return withCrc([CNF_LINE, line & 0xff, color & 0xff, last ? LINE_LAST : 0, ...data]);
}

// --- device -> host ----------------------------------------------------------

const text = (bytes, from) => {
  let s = '';
  for (let i = from; i < bytes.length && bytes[i] !== 0; i++) s += String.fromCharCode(bytes[i]);
  return s;
};

/**
 * One packet as a message:
 *
 *   { type: 'info', api, version }        { type: 'init', error }
 *   { type: 'start', error }              { type: 'line', line, error }
 *   { type: 'state', error, state, carriage, position, direction }
 *   { type: 'debug', text }               { type: 'unexpected', id }
 *
 * `state` is 'wait' | 'init' | 'ready' | 'knit' | 'test' | 'error';
 * `direction` 'left' | 'right' | null; `carriage` 'knit' | 'lace' |
 * 'garter' | null; `position` the carriage's needle from the left end.
 */
export function parsePacket(p) {
  switch (p[0]) {
    case CNF_INFO: {
      const suffix = text(p, 5);
      return { type: 'info', api: p[1], version: `${p[2]}.${p[3]}.${p[4]}${suffix ? `-${suffix}` : ''}` };
    }
    case CNF_INIT:
      return { type: 'init', error: p[1] ?? 0xff };
    case CNF_START:
      return { type: 'start', error: p[1] ?? 0xff };
    case REQ_LINE:
      return { type: 'line', line: p[1], error: p[2] ?? 0 };
    case IND_STATE:
      return {
        type: 'state',
        error: p[1],
        state: STATES[p[2]] ?? 'error',
        carriage: CARRIAGES[p[7]] ?? null,
        position: p[8],
        direction: p[9] === 0 ? 'left' : p[9] === 1 ? 'right' : null,
      };
    case DEBUG:
    case TEST_RES:
      return { type: 'debug', text: text(p, 1) };
    default:
      return { type: 'unexpected', id: p[0] };
  }
}
