/**
 * Machine drivers: what the knit screen talks to instead of a protocol.
 *
 * A driver turns passes into one firmware's bytes and that firmware's
 * messages back into events. The screen owns the job, the position and the
 * serial port (knit/serial.js); a driver owns nothing but its protocol.
 * `machine.driver` in model/machine.js picks one. A new interface is one file
 * here and one entry in DRIVERS.
 *
 *   id, baud
 *   connected()                    the port just opened
 *   disconnected()
 *   feed(bytes)                    bytes from the port
 *   start({ layout })              -> Promise<boolean>, true when ready to knit
 *   send({ row, layout, carriageSide, info })
 *                                  -> Promise<boolean>, true if the device has
 *                                  it now; false if it will knit the pass it
 *                                  already has first
 *   stop()                         stop patterning
 *   finish()                       the piece is done
 *
 * `row` is needleRow()'s selection (knit/job.js). `info` describes the pass
 * for a controller that can signal changes itself: { yarnChange, camChange,
 * feeder1, feeder2, next, cam }.
 *
 * Events, through `emit(type, detail)`:
 *
 *   passDone                       the carriage finished the pass it was sent
 *   needData                       the device wants the first pass
 *   enter                          the carriage entered the markers
 *   direction { dir }              'left' | 'right', the way it travels now
 *   needle { index }               1.. from the left marker
 *   log { level, text, toast }
 */

import { createSilverReed } from './silverReed.js';
import { createAyab } from './ayab.js';

const DRIVERS = {
  silverreed: createSilverReed,
  ayab: createAyab,
};

/** `write(bytes)` sends to the port; `emit(type, detail)` reports to the screen. */
export function createDriver(machine, io) {
  const create = DRIVERS[machine.driver] ?? createSilverReed;
  return create(machine, io);
}

export const driverOf = (machine) => (DRIVERS[machine.driver] ? machine.driver : 'silverreed');
