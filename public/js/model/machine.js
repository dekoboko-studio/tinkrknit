/**
 * Machine profiles.
 *
 * A design is machine agnostic: the project stores no machine. The knit
 * screen picks one (`session.machine`), because that is where the bed is.
 *
 * The SK840 is the validated target (CLAUDE.md 1.3); only `sk840` has been
 * tested end to end. `driver` names the knit/drivers/ entry that talks to
 * the bed's interface.
 *
 * `colorsPerRow`: single-bed Fair Isle carries exactly two feeders on every
 * one of them, which is why validation does not need to know the machine.
 *
 * `maxRow`: the most needles the controller selects in one row, where that is
 * fewer than the bed has (the knit screen checks the markers against it).
 */

/** The silver-reed-write controller's row buffer (MAX_NEEDLES in knit/protocol.js). */
const CONTROLLER_NEEDLES = 200;

/**
 * A Silver Reed electronic bed on the same 8-pin DIN as the SK840. Soft Byte
 * (SilverLink) and SilverKnit list these as one interface family, with the
 * needle counts used here; neither the pin timing nor the point-cam numbering
 * has been checked on any of them with this controller.
 */
function silverReed(id, label, needles, gaugeMm, notes) {
  return {
    id,
    label,
    gaugeMm,
    needles,
    maxPatternWidth: Math.min(needles, CONTROLLER_NEEDLES),
    maxPatternHeight: null,
    repeatWidth: null,
    colorsPerRow: 2,
    electronic: true,
    driver: 'silverreed',
    ...(needles > CONTROLLER_NEEDLES ? { maxRow: CONTROLLER_NEEDLES } : {}),
    notes: `${needles} needles, L${needles / 2} to R${needles / 2}. ${notes} Not yet tested on a machine.`,
  };
}

export const MACHINES = {
  sk840: {
    id: 'sk840',
    label: 'Silver Reed SK840',
    gaugeMm: 4.5,
    needles: 200,
    /** Electronic bed: the whole 200 needles can be patterned individually. */
    maxPatternWidth: 200,
    maxPatternHeight: null,
    repeatWidth: null,
    colorsPerRow: 2,
    electronic: true,
    driver: 'silverreed',
    notes:
      'Electronic selection over 8-pin DIN. Patterns may be up to 200 stitches ' +
      'wide with no repeat. Drives via knitscape/silver-reed-write.',
  },

  sk580: silverReed('sk580', 'Silver Reed SK580 / SK581', 200, 4.5, 'Standard gauge.'),
  sk560: silverReed('sk560', 'Silver Reed SK560 / SK561 / SK562', 200, 4.5, 'Standard gauge.'),
  sk550: silverReed('sk550', 'Silver Reed SK550', 200, 4.5, 'Standard gauge.'),
  sk500: silverReed('sk500', 'Silver Reed SK500', 200, 4.5,
    'Standard gauge. Commercial interfaces need an SK500Ex adapter: it may not connect to this controller directly.'),
  sk830: silverReed('sk830', 'Silver Reed SK830 fine gauge', 250, 3.6,
    'Fine gauge. The controller selects at most 200 needles, so keep the markers within 200.'),
  sk860: silverReed('sk860', 'Silver Reed SK860 mid gauge', 150, 6.5, 'Mid gauge.'),
  sk890: silverReed('sk890', 'Silver Reed SK890 bulky', 110, 9, 'Bulky.'),
  sa3e: silverReed('sa3e', 'Silver Reed SA-3E', 128, null, 'Gauge not confirmed.'),

  // Brother beds through an AYAB interface (knit/drivers/ayab.js). Written
  // from the AYAB 1.0 spec and not yet knitted on any of them. `ayabType` is
  // the machine type AYAB's reqInit takes.
  kh910: {
    id: 'kh910',
    label: 'Brother KH-910 / KH-950i (AYAB)',
    gaugeMm: 4.5,
    needles: 200,
    maxPatternWidth: 200,
    maxPatternHeight: null,
    repeatWidth: null,
    colorsPerRow: 2,
    electronic: true,
    driver: 'ayab',
    ayabType: 0,
    notes: 'Needs an AYAB interface with AYAB firmware 1.0 or later. Not yet tested on a machine.',
  },

  kh930: {
    id: 'kh930',
    label: 'Brother KH-930 / KH-940 / KH-965i (AYAB)',
    gaugeMm: 4.5,
    needles: 200,
    maxPatternWidth: 200,
    maxPatternHeight: null,
    repeatWidth: null,
    colorsPerRow: 2,
    electronic: true,
    driver: 'ayab',
    ayabType: 1,
    notes: 'Needs an AYAB interface with AYAB firmware 1.0 or later. Not yet tested on a machine.',
  },

  kh270: {
    id: 'kh270',
    label: 'Brother KH-270 bulky (AYAB)',
    gaugeMm: 9,
    needles: 112,
    maxPatternWidth: 112,
    maxPatternHeight: null,
    repeatWidth: null,
    colorsPerRow: 2,
    electronic: true,
    driver: 'ayab',
    ayabType: 2,
    notes: 'Needs an AYAB interface with AYAB firmware 1.0 or later. 112 needles, L56 to R56. Not yet tested on a machine.',
  },

  sk280: {
    id: 'sk280',
    label: 'Silver Reed SK280 (punchcard)',
    gaugeMm: 4.5,
    needles: 200,
    maxPatternWidth: 24,
    maxPatternHeight: 60,
    /** Mechanical punchcard: the motif repeats every 24 stitches. */
    repeatWidth: 24,
    colorsPerRow: 2,
    electronic: false,
    notes:
      'Punchcard machine. 24-stitch repeat; single motifs up to 24 wide and 60 ' +
      'rows with magic/point cams. Cannot be driven by silver-reed-write.',
  },
};

export const DEFAULT_MACHINE = 'sk840';

export function getMachine(id) {
  return MACHINES[id] ?? MACHINES[DEFAULT_MACHINE];
}

export function machineList() {
  return Object.values(MACHINES);
}

/** The machines the knit screen can drive: electronic selection only, by name (SK830 before SK840). */
export function knitMachines() {
  return machineList()
    .filter((m) => m.electronic)
    .sort((a, b) => a.label.localeCompare(b.label, 'en', { numeric: true }));
}
