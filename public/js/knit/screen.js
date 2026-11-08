/**
 * The knit screen: drives the machine through its driver (knit/drivers/) -
 * the SK840 through the silver-reed-write controller, Brother beds through
 * AYAB.
 *
 * A view inside the designer page, not a page of its own. The serial port
 * belongs to the page that opened it, so as long as the knitter only switches
 * between Design and Knit the connection survives - which is the reason this
 * is a view and not a second tab you have to find again. Reloading the page
 * still drops the port; the beforeunload guard below catches that mid-pass.
 *
 * It is the screen you stand at the machine with, so the type is large and it
 * shows one thing well: which row is next, which way the carriage goes, which
 * yarns go in the feeders, and where the needle markers must be.
 *
 * The loop is silver-reed-write's: send a pass, wait for the driver to say
 * the carriage finished it, flip the carriage side, advance, send the next.
 * It walks the job's passes, not its chart rows, so a technique with several
 * passes per row needs nothing new here. Position is saved on every pass, so
 * a reload mid-piece resumes on the pass it left.
 */

import { createConnection, serialSupported } from './serial.js';
import { createDriver, driverOf } from './drivers/index.js';
import {
  loadJob, saveJob, loadSession, saveSession, sameKnitting,
  centeredLayout, layoutProblem, needleCount, panelNeedles, needleRow, yarnsFor, yarnChanges, yarnSide, yarnUsedAfter, nextChange, feederSlots, knitGrid, firstPassOf, passInRow,
  yarnSetup, withYarns, yarnLetter, canChangeTechnique, withTechnique, techniqueOptions,
  toMarker, fromMarker, markerLabel, bedPosition,
} from './job.js';
import { h, append, clear, toast, select, checkbox, numberInput, button } from '../ui/dom.js';
import { svgPath } from '../ui/panels/helpers.js';
import { mdiArrowLeft } from '../icons.js';
import { getTechnique, isColorTechnique, BACKING_HINT } from '../model/technique.js';
import { DEFAULT_MACHINE, getMachine, knitMachines } from '../model/machine.js';

const LOG_LINES = 120;

/** Needles each side of center on a machine's bed. */
const sideOf = (machineId) => getMachine(machineId).needles / 2;

/**
 * Mount the knit screen in `host`. It shows by hiding `designer`, and hands
 * control back through `onClose`. `onChange` fires when patterning or the
 * connection changes, so the designer's Knit button can say so.
 */
export function createKnitScreen(host, { designer, onClose, onChange }) {
  let job = loadJob();
  let session = freshSession(job, loadSession());
  let pendingJob = null;
  let open = false;

  // Transient: never persisted, so a reload never comes back mid-pass.
  let patterning = false;
  let connected = false;
  let needleNow = 0;
  let traveling = null; // 'left' | 'right' as last reported by the carriage
  // The driver for the machine picked when the port was opened.
  let driver = null;
  // The pass the device has, or null before the first. Silver Reed takes a
  // new pass at any time; AYAB knits the one it has before the next.
  let onMachine = null;
  const log = [];

  const conn = createConnection({
    onData: (bytes) => driver?.feed(bytes),
    onError: (text) => {
      addLog('error', text);
      toast(text, 'error', 6000);
    },
    onStatus: (status) => {
      connected = status === 'connected';
      onMachine = null;
      if (connected) driver.connected();
      else driver?.disconnected();
      if (!connected && patterning) {
        patterning = false;
        addLog('error', 'Controller disconnected while knitting. Patterning stopped.');
        toast('Controller disconnected. Patterning stopped.', 'error', 8000);
      } else {
        addLog('info', connected ? 'Connected to the controller.' : 'Disconnected.');
      }
      changed();
    },
  });

  const changed = () => {
    render();
    onChange?.();
  };

  // --- session --------------------------------------------------------------

  /** Identifies a job's design colors, so yarn settings only carry to the same ones. */
  function paletteKey(forJob) {
    return forJob.yarns.map((y) => y.hex).join(',');
  }

  function freshSession(forJob, saved) {
    if (!forJob) return null;
    const defaults = { passIndex: 0, finished: false, passes: 0, markersSet: false, swapFeeders: false, invertSelect: false, mirror: false, repeat: false, scope: 'panel', sound: true, machine: DEFAULT_MACHINE, yarnLetters: null, yarnColors: {}, yarnFor: null };
    if (saved && saved.jobId === forJob.id) {
      // Sessions saved before the pass plan counted rows; those jobs were
      // Fair Isle, one pass per row, so the row was the pass.
      const { rowIndex, ...rest } = saved;
      return { ...defaults, passIndex: rowIndex ?? 0, technique: colorTechniqueFor(forJob, null), ...rest };
    }
    // Same markers on the machine still fit the new job: they are still set.
    const scope = saved?.scope ?? 'panel';
    const keepLayout = saved?.layout && !layoutProblem(knitGrid(forJob, scope, saved.layout), saved.layout, sideOf(saved.machine), getMachine(saved.machine).maxRow);
    return {
      ...defaults,
      jobId: forJob.id,
      carriageSide: saved?.carriageSide ?? 'left',
      layout: keepLayout ? saved.layout : centeredLayout(forJob.width),
      markersSet: Boolean(keepLayout && saved.markersSet),
      swapFeeders: saved?.swapFeeders ?? false,
      // Like Swap feeders, a fact about the machine more than the job, so it
      // carries over to the next one.
      invertSelect: saved?.invertSelect ?? false,
      mirror: saved?.mirror ?? false,
      repeat: saved?.repeat ?? false,
      sound: saved?.sound ?? true,
      // The machine is the knitter's, not the design's (designs store none),
      // so it stays from job to job.
      machine: saved?.machine ?? DEFAULT_MACHINE,
      // How a color chart is knitted is the knitter's choice too, kept from
      // job to job; the designer's own choice only fills in the first time.
      technique: colorTechniqueFor(forJob, saved?.technique),
      scope,
      // Yarn letters and colors carry over while the design's colors are the
      // same ones, so pressing Knit after an edit keeps the cones as loaded.
      ...(saved?.yarnFor && saved.yarnFor === paletteKey(forJob)
        ? { yarnLetters: saved.yarnLetters, yarnColors: saved.yarnColors ?? {}, yarnFor: saved.yarnFor }
        : {}),
    };
  }

  /** The session's color technique: `kept` if it is one, else the job's own when that is one. */
  function colorTechniqueFor(forJob, kept) {
    if (isColorTechnique(kept)) return kept;
    return isColorTechnique(forJob.technique) ? forJob.technique : null;
  }

  /**
   * What is being knitted: the panel, or the tile filling the markers. Every
   * row, bed and chart calculation goes through this, never through `job`.
   */
  const scopeOf = () => (session.scope === 'tile' && job.tile ? 'tile' : 'panel');
  /** The knit screen's yarn letters and colors for this job (knit/job.js). */
  const setupOf = () => yarnSetup(job, session.yarnLetters, session.yarnColors);
  // Everything reads the grid in yarns, never in design colors. It is rebuilt
  // only when what it depends on changes: a render asks for it many times.
  // A plan's `wrap` passes only carry the carriage and yarn back to pass 0
  // (model/passes.js), so a panel that stops at its end leaves them out.
  let gridCache = null;
  const grid = (lay = session.layout) => {
    const key = JSON.stringify([scopeOf(), lay, session.yarnLetters, session.yarnColors, repeating()]);
    if (gridCache?.job !== job || gridCache.key !== key) {
      const g = knitGrid(job, scopeOf(), lay);
      const passes = repeating() ? g.passes : g.passes.filter((p) => !p.wrap);
      gridCache = { job, key, grid: withYarns({ ...g, passes }, setupOf()) };
    }
    return gridCache.grid;
  };
  // A tile knits as an all-over repeat; the panel stops at its last row unless asked.
  const repeating = () => scopeOf() === 'tile' || session.repeat;
  const techniqueLabel = () => getTechnique(job.technique).label;

  function setScope(scope) {
    if (scope === scopeOf() || patterning) return;
    update({ scope, passIndex: 0, finished: false });
    addLog('info', scope === 'tile' ? 'Knitting one tile, repeated across the markers.' : 'Knitting the whole panel.');
  }

  function update(patch) {
    Object.assign(session, patch);
    saveSession(session);
    render();
  }

  function loadNewJob(next) {
    job = next;
    saveJob(next);
    session = freshSession(next, session);
    saveSession(session);
    pendingJob = null;
    addLog('info', `Loaded "${next.name}" (${next.width} x ${next.height}).`);
    render();
  }

  /**
   * Knit the same design snapshot as another color technique. The passes
   * change, so knitting starts again at row 1 and the setup is confirmed
   * again; the markers and yarns stay.
   */
  function setTechnique(id) {
    if (patterning || id === job.technique || !canChangeTechnique(job)) return;
    const wasUnderWay = underWay();
    job = withTechnique(job, id);
    saveJob(job);
    update({ technique: id, passIndex: 0, finished: false, markersSet: false });
    addLog('info', `Knitting as ${techniqueLabel()}.`);
    if (wasUnderWay) toast(`Knitting as ${techniqueLabel()}, from row 1.`, 'warn');
  }

  // The cost of each technique, computed once per design snapshot: it
  // compiles and checks the panel four times.
  let optionsCache = null;
  function knitOptions() {
    const key = `${job.id}:${job.sentAt}`;
    if (optionsCache?.key !== key) optionsCache = { key, options: techniqueOptions(job) };
    return optionsCache.options;
  }

  const underWay = () => patterning || session.passIndex > 0 || session.passes > 0 || session.finished;

  /** Offer a job from the designer. Never throws away progress silently. */
  function offer(next) {
    if (!job) return loadNewJob(next);
    if (sameKnitting(job, next)) {
      // Unchanged design: keep the place, but pick up a rename, which
      // changes no stitch, and the design snapshot a job saved before
      // there was one lacks, without which the technique cannot change.
      if (job.name !== next.name || !job.design) {
        job.name = next.name;
        job.design = next.design;
        job.stitchChart = next.stitchChart;
        saveJob(job);
        render();
      }
      pendingJob = null;
      return;
    }
    if (underWay()) pendingJob = next;
    else loadNewJob(next);
  }

  // --- the knitting loop ----------------------------------------------------

  const nextTravel = () => (session.carriageSide === 'left' ? 'right' : 'left');
  /** The chart row the next pass belongs to, 0 = cast-on edge. */
  const currentRow = () => grid().passes[session.passIndex].row;
  /** "row 12" or "row 12, pass 2 of 3", for the log. */
  function passLabel() {
    const { n, of } = passInRow(grid(), session.passIndex);
    return `row ${currentRow() + 1}${of > 1 ? `, pass ${n} of ${of}` : ''}`;
  }

  /** What is wrong with the markers on the machine picked, or null. */
  const markerProblem = (g = grid(), lay = session.layout) =>
    layoutProblem(g, lay, sideOf(session.machine), getMachine(session.machine).maxRow);

  async function sendCurrent() {
    if (!driver) return;
    const p = session.passIndex;
    try {
      const row = needleRow(grid(), session.layout, p, { swap: session.swapFeeders, invert: session.invertSelect, mirror: session.mirror });
      const sent = await driver.send({ row, layout: session.layout, carriageSide: session.carriageSide, info: passInfo(p) });
      if (sent) {
        onMachine = p;
        addLog('info', `Sent ${passLabel()}, carriage traveling ${nextTravel()}.`);
      } else if (onMachine !== null && onMachine !== p) {
        addLog('info', `Next: ${passLabel()}, after the pass already on the machine.`);
      }
    } catch (error) {
      addLog('error', error.message);
      toast(error.message, 'error', 6000);
    }
  }

  /**
   * How to set the carriage for a pass, and a tooltip on why. Every technique
   * sends one selection per pass; the cam buttons decide what the unselected
   * needles do. Only Fair Isle has been checked on the bed (CLAUDE.md 1.4).
   */
  function camSetting(pass) {
    switch (pass.cam) {
      case 'fairisle':
        return ['Fair Isle buttons in', 'Unselected needles knit feeder 1, selected needles feeder 2.'];
      case 'tuck':
        return ['Tuck buttons in', 'Selected needles knit; the rest tuck. Use Invert stitch selection if a swatch shows it the other way round.'];
      case 'slip':
        return ['Slip (part) buttons in', 'Selected needles knit; the rest slip and the yarn floats behind them. Use Invert stitch selection if a swatch shows it the other way round.'];
      case 'jacquard':
        return ['Main bed: slip buttons in. Ribber: your backing', `The main bed knits this color's needles and slips the rest; the ribber knits the back.\n\n${BACKING_HINT}`];
      default:
        return ['Every needle knits', 'A plain pass. Leave the buttons as they are: every needle is selected, so it knits whatever is set.'];
    }
  }

  // --- sound ----------------------------------------------------------------

  // At the machine you watch the carriage, not the screen, so a pass that
  // needs a rethread or a cam change is announced the moment the carriage
  // leaves the pass before it. Tones are synthesized: no files to serve.
  let audio = null;

  /** Browsers start audio suspended until a click; Start patterning is one. */
  function unlockAudio() {
    try {
      audio ??= new AudioContext();
      if (audio.state === 'suspended') audio.resume();
    } catch {}
  }

  function chime(kind) {
    if (!session.sound) return;
    unlockAudio();
    if (!audio) return;
    // Loud enough to hear over the carriage: a triangle carries further than a
    // sine at the same level and the notes are longer. Each note ends before
    // the next starts, so the peak stays under 1 and nothing clips.
    const notes = kind === 'done' ? [660, 880, 1320] : [880, 660];
    notes.forEach((freq, i) => {
      const t = audio.currentTime + i * 0.24;
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.9, t + 0.02);
      gain.gain.setValueAtTime(0.9, t + 0.12);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      osc.connect(gain).connect(audio.destination);
      osc.start(t);
      osc.stop(t + 0.23);
    });
  }

  // --- controller signals ---------------------------------------------------

  /** What the controller is told about pass `p`, so it can signal a change itself. */
  function passInfo(p) {
    const g = grid();
    const wrapped = repeating() && session.passes > 0;
    const pass = g.passes[p];
    const [feeder1, feeder2] = feederSlots(pass, session.swapFeeders);
    const next = nextChange(g, p, repeating(), session.swapFeeders);
    return {
      yarnChange: yarnChanges(g, p, wrapped, session.swapFeeders).length > 0,
      camChange: camChangeAt(g, p, wrapped),
      feeder1,
      feeder2,
      next: next ? next.ahead : null,
      cam: pass.cam,
    };
  }

  /** True when pass `p` needs the knitter at the machine: new yarn or new cam. */
  function needsHands(p) {
    const g = grid();
    return yarnChanges(g, p, true, session.swapFeeders).length > 0 || camChangeAt(g, p, true);
  }

  async function start() {
    unlockAudio();
    const problem = markerProblem();
    if (problem) return toast(problem, 'error', 6000);
    if (!session.markersSet) return toast('Confirm how it knits and the needle markers first.', 'warn');
    if (!connected) return toast('Connect to the controller first.', 'warn');
    if (session.finished) update({ finished: false, passIndex: 0 });
    patterning = true;
    onMachine = null;
    changed();
    // May wait for the knitter (AYAB has to find the carriage); Stop ends the wait.
    let ready = false;
    try {
      ready = await driver.start({ layout: session.layout });
    } catch (error) {
      addLog('error', error.message);
    }
    if (!patterning) return;
    if (!ready) {
      patterning = false;
      changed();
      return;
    }
    await sendCurrent();
  }

  async function stop() {
    patterning = false;
    changed();
    try {
      if (connected) await driver.stop();
    } catch {}
    addLog('info', 'Patterning stopped.');
  }

  function onPassComplete() {
    needleNow = 0;
    // A free pass (moving the carriage to the changer, testing the cams)
    // still crosses the point cams, so the side follows it; nothing is counted.
    if (!patterning) {
      update({ carriageSide: session.carriageSide === 'left' ? 'right' : 'left' });
      return;
    }

    const carriageSide = session.carriageSide === 'left' ? 'right' : 'left';
    const passes = session.passes + 1;

    // A row picked by hand while the device held another pass: that pass is
    // what was just knitted, and the row picked is next.
    if (onMachine !== null && onMachine !== session.passIndex) {
      update({ carriageSide, passes });
      if (needsHands(session.passIndex)) chime('change');
      sendCurrent();
      return;
    }

    let passIndex = session.passIndex + 1;

    const total = grid().passes.length;
    if (passIndex >= total) {
      if (repeating()) {
        // silver-reed-write's advanceRow wraps; here it is opt-in for a panel.
        passIndex = 0;
        addLog('info', scopeOf() === 'tile' ? 'Tile finished. Repeating from row 1.' : 'Panel finished. Repeating from row 1.');
      } else {
        patterning = false;
        update({ carriageSide, passes, passIndex: total - 1, finished: true });
        driver.finish().catch(() => {});
        chime('done');
        addLog('info', 'Last row knitted. Panel complete.');
        toast('Panel complete.', 'ok', 8000);
        onChange?.();
        return;
      }
    }

    update({ carriageSide, passes, passIndex });
    if (needsHands(passIndex)) chime('change');
    sendCurrent();
  }

  /**
   * Move the next pass by hand, to the first pass of chart row `row`. While
   * knitting, the controller gets it at once.
   */
  function goToRow(row) {
    const passIndex = firstPassOf(grid(), row);
    if (passIndex === session.passIndex && !session.finished) return;
    update({ passIndex, finished: false });
    if (patterning) sendCurrent();
  }

  function flipCarriage() {
    update({ carriageSide: session.carriageSide === 'left' ? 'right' : 'left' });
    if (patterning) sendCurrent();
  }

  /** Open the port for the machine picked, with that machine's driver. */
  function connect() {
    const machine = getMachine(session?.machine);
    driver = createDriver(machine, { write: conn.write, emit: handleEvent });
    return conn.connect({ baudRate: driver.baud });
  }

  /** Events from the driver (knit/drivers/index.js). */
  function handleEvent(type, msg = {}) {
    switch (type) {
      case 'passDone':
        return onPassComplete();
      case 'needData':
        if (patterning) sendCurrent();
        return;
      case 'enter':
        needleNow = 0;
        // A mismatch means the pass lands mirrored. Logged rather than shouted:
        // the firmware only reports direction when the pin changes, and how it
        // reads at the very start of a pass is not yet verified on the machine.
        if (patterning && traveling && traveling !== nextTravel()) {
          addLog('warn', `Carriage reported traveling ${traveling}; ${passLabel()} was sent for ${nextTravel()}.`);
        }
        return scheduleRender();
      case 'direction':
        traveling = msg.dir;
        return;
      case 'needle':
        needleNow = msg.index;
        return scheduleRender();
      case 'log':
        addLog(msg.level, msg.text);
        if (msg.toast) toast(msg.text, msg.level, 6000);
        return;
    }
  }

  function addLog(level, text) {
    const time = new Date().toLocaleTimeString([], { hour12: false });
    log.push({ level, text: `${time}  ${text}` });
    if (log.length > LOG_LINES) log.shift();
    scheduleRender();
  }

  // --- rendering ------------------------------------------------------------

  const chartBox = h('div', { class: 'knit-chart' });
  const chart = h('canvas', { class: 'knit-chart-canvas', title: 'Click a row to knit it next' });
  chartBox.append(chart);
  const side = h('aside', { class: 'knit-side' });
  const bar = h('header', { class: 'toolbar knit-bar' });
  host.append(bar, h('main', { class: 'knit-main' }, chartBox, side));

  let frameQueued = false;
  function scheduleRender() {
    if (frameQueued || !open) return;
    frameQueued = true;
    requestAnimationFrame(() => {
      frameQueued = false;
      render();
    });
  }

  /** A color input for yarn number `yarn`: what the cone really is, for the chart and cards. */
  function colorPicker(yarn, cls) {
    const { yarns } = setupOf();
    return h('input', {
      type: 'color',
      class: `knit-yarn-color ${cls}`,
      value: yarns[yarn].hex,
      title: `Color of yarn ${yarnLetter(yarn)}: click to change. The design keeps its own.`,
      onchange: (event) => {
        event.target.blur();
        setYarnColor(yarn, event.target.value);
      },
      onblur: () => scheduleRender(),
    });
  }

  function renderBar() {
    clear(bar);
    bar.append(
      h('button', { class: 'tb-btn tb-solid', title: 'Back to the designer  (Esc or K). The machine stays connected.', onclick: close },
        svgPath(mdiArrowLeft, 18), h('span', {}, 'Design')),
      h('span', { class: 'tb-sep' }),
      h('span', { class: 'knit-bar-mode' }, 'Knitting'),
      session ? renderMachine() : null,
      job ? renderScope() : null,
      job ? h('span', { class: 'project-name knit-job-name' }, `${job.name} - ${techniqueLabel()} - ${grid().width} sts x ${grid().height} rows`) : null,
      h('span', { class: 'grow' }),
      h('span', { class: `knit-pill ${connected ? 'is-on' : ''}` }, connected ? 'Controller connected' : 'Not connected'),
      connected
        ? button({ label: 'Disconnect', onclick: () => conn.disconnect() })
        : button({
            label: 'Connect',
            variant: 'primary',
            disabled: !serialSupported(),
            title: serialSupported() ? 'Pick the controller\'s serial port' : 'Web Serial needs Chrome, Edge or Firefox 151+',
            onclick: () => connect().catch((error) => {
              // Always log it: a browser that blocks the request can report the
              // same NotFoundError as closing the picker, and a silent failure
              // is undiagnosable.
              addLog(error.name === 'NotFoundError' ? 'warn' : 'error', `Connect failed - ${error.name}: ${error.message}`);
              // Closing the port picker is not an error worth a toast.
              if (error.name !== 'NotFoundError') toast(error.message, 'error', 6000);
            }),
          })
    );
  }

  /** Which machine is driven. Only electronic beds are offered. */
  function renderMachine() {
    const machine = getMachine(session.machine);
    const el = select({
      value: machine.id,
      title: patterning ? 'Stop patterning first' : machine.notes,
      options: knitMachines().map((m) => [m.id, m.label]),
      onchange: (v) => {
        const next = getMachine(v);
        // Another bed: the markers need checking against it again, and
        // markers past the end of a shorter bed move to its last needle.
        const half = next.needles / 2;
        const lay = session.layout;
        let layout = { ...lay, left: Math.max(lay.left, -half), right: Math.min(lay.right, half) };
        // Markers that no longer fit (cut short by a smaller bed, or wider than
        // the controller selects) go back round the panel, centered.
        if (layoutProblem(grid(layout), layout, half, next.maxRow)) {
          const width = scopeOf() === 'tile' ? Math.min(needleCount(layout.left, layout.right), next.maxRow ?? Infinity) : job.width;
          layout = { ...centeredLayout(width), align: lay.align, endNeedles: lay.endNeedles };
        }
        update({ machine: v, layout, markersSet: false });
        addLog('info', `Machine: ${next.label}.`);
        // The open port is speaking the old machine's protocol. AYAB also
        // fixes its machine type at setup, until it is reset.
        if (connected && (driverOf(next) !== driver?.id || next.driver === 'ayab')) {
          addLog('info', 'Disconnected for the new machine. Connect again.');
          conn.disconnect();
        }
      },
    });
    el.classList.add('knit-machine');
    el.disabled = patterning;
    return el;
  }

  /** Whole panel or one tile: what fills the needles between the markers. */
  function renderScope() {
    const options = [
      ['panel', 'Whole panel', 'Knit the panel exactly as designed, then stop.'],
      ['tile', 'Repeat tile', 'Repeat one tile across every needle between the markers, and keep repeating it upward.'],
    ];
    return h('div', { class: 'knit-seg knit-scope' }, ...options.map(([value, label, title]) => {
      const unavailable = value === 'tile' && !job.tile;
      return h('button', {
        class: `knit-seg-btn ${scopeOf() === value ? 'is-on' : ''}`,
        title: unavailable ? 'Press Knit in the designer again to bring the tile across.' : patterning ? 'Stop patterning first' : title,
        disabled: unavailable || patterning,
        onclick: () => setScope(value),
      }, label);
    }));
  }

  // The bed, drawn to scale: every needle, the marker range, the panel inside it.
  function bedStrip(lay) {
    const half = sideOf(session.machine);
    const pct = (pos) => `${(pos / (half * 2)) * 100}%`;
    // Clamped: a marker past the end of the bed must not draw outside the strip.
    const span = (a, b, cls) => {
      const from = Math.max(0, bedPosition(a, half));
      const to = Math.min(half * 2 - 1, bedPosition(b, half));
      if (to < from) return null;
      return h('span', { class: cls, style: { left: pct(from), width: pct(to - from + 1) } });
    };
    const g = grid(lay);
    const fits = !markerProblem(g, lay);
    const [a, b] = fits ? panelNeedles(g, lay) : [0, 0];
    return h(
      'div',
      { class: 'knit-strip' },
      h('div', { class: 'knit-strip-bed' },
        span(lay.left, lay.right, 'knit-strip-range'),
        fits ? span(a, b, 'knit-strip-panel') : null,
        h('span', { class: 'knit-strip-center' })),
      h('div', { class: 'knit-strip-scale' }, ...[`L${half}`, `L${half / 2}`, 'Center', `R${half / 2}`, `R${half}`].map((t) => h('span', {}, t)))
    );
  }

  /** One marker: which side of center, then the number printed on the bed. */
  function markerInput(label, needle, onset) {
    const m = toMarker(needle);
    return h(
      'div',
      { class: 'knit-marker' },
      h('span', { class: 'knit-marker-label' }, label),
      h('div', { class: 'knit-marker-input' },
        h('div', { class: 'knit-seg' }, ...['L', 'R'].map((side) =>
          h('button', {
            class: `knit-seg-btn ${m.side === side ? 'is-on' : ''}`,
            title: side === 'L' ? 'Left of center' : 'Right of center',
            onclick: () => onset(fromMarker(side, m.n)),
          }, side))),
        numberInput({
          value: m.n,
          min: 1,
          max: sideOf(session.machine),
          title: 'The needle number printed on the bed',
          onchange: (v) => onset(fromMarker(m.side, v)),
        }))
    );
  }

  function renderBed() {
    const lay = session.layout;
    const g = grid(lay);
    const tiled = scopeOf() === 'tile';
    const problem = markerProblem(g, lay);
    const count = needleCount(lay.left, lay.right);
    // Any change to the markers needs confirming again on the machine.
    const set = (patch) => update({ layout: { ...lay, ...patch }, markersSet: false });
    const range = `${markerLabel(lay.left)} - ${markerLabel(lay.right)}`;

    if (session.markersSet && !problem) {
      return h(
        'section',
        { class: 'knit-card knit-bed' },
        h('div', { class: 'knit-bed-head' },
          h('div', { title: getTechnique(job.technique).title },
            h('div', { class: 'knit-row-label' }, 'Knit as'),
            h('div', { class: 'knit-bed-range' }, techniqueLabel())),
          h('div', {},
            h('div', { class: 'knit-row-label' }, 'Needle markers'),
            h('div', { class: 'knit-bed-range' }, range)),
          h('span', { class: 'grow' }),
          button({
            label: 'Change setup',
            variant: 'knit-change',
            disabled: patterning,
            title: patterning ? 'Stop patterning first' : 'Change the technique or move the markers',
            onclick: () => update({ markersSet: false }),
          })),
        bedStrip(lay)
      );
    }

    const [a, b] = problem ? [0, 0] : panelNeedles(g, lay);
    const card = h(
      'section',
      { class: 'knit-card knit-bed is-setup' },
      ...renderTechnique(),
      h('div', { class: 'knit-row-label', title: 'Move the point cams on the machine to these needles before you knit.' }, 'Set the needle markers'),
      h('div', { class: 'knit-markers' },
        markerInput('Left marker', lay.left, (v) => set({ left: v })),
        markerInput('Right marker', lay.right, (v) => set({ right: v }))),
      bedStrip(lay),
      problem
        ? h('p', { class: 'knit-note is-error' }, problem)
        : h('p', { class: 'knit-note' }, tiled
            ? `${count} needles · ${job.tile.width}-stitch tile${count % job.tile.width ? ', part repeat at the edges' : ''}`
            : `${count} needles · pattern on ${markerLabel(a)} - ${markerLabel(b)}`),
      h('div', { class: 'knit-bed-opts' },
        h('label', { class: 'knit-inline' }, tiled ? 'Repeat from' : 'Pattern',
          select({
            value: lay.align,
            options: tiled
              ? [['left', 'Left marker'], ['center', 'Center'], ['right', 'Right marker']]
              : [['left', 'Left'], ['center', 'Centered'], ['right', 'Right']],
            title: tiled
              ? 'Where a whole tile starts; part repeats fall at the other edge or both'
              : 'Where the pattern sits when the markers are wider than it',
            onchange: (v) => set({ align: v }),
          })),
        checkbox({
          label: 'Select end needles',
          checked: lay.endNeedles,
          title: 'Knit both edge needles in feeder 2 so both yarns are caught at the selvages.',
          onchange: (v) => set({ endNeedles: v }),
        }),
        button({
          label: 'Center on the bed',
          variant: 'ghost',
          // A tile keeps its span and just moves to the middle; a panel gets markers to fit it.
          onclick: () => set({ ...centeredLayout(tiled ? count || job.tile.width : job.width), align: lay.align, endNeedles: lay.endNeedles }),
        })),
      button({
        label: `Knit as ${techniqueLabel()} on ${range}`,
        title: 'The carriage is set for this technique and the point cams are at these needles',
        variant: 'primary knit-confirm',
        disabled: Boolean(problem) || patterning,
        onclick: () => update({ markersSet: true }),
      })
    );
    if (patterning) card.querySelectorAll('input, select, button').forEach((el) => (el.disabled = true));
    return card;
  }

  /**
   * The first half of the setup card: how this job knits. A color chart
   * offers every color technique, each with its passes and what would go
   * wrong, so the choice explains itself. A stitch chart knits only as drawn.
   */
  function renderTechnique() {
    const label = h('div', { class: 'knit-row-label' }, 'Knit as');
    // The carriage setting is a tooltip here; the yarn card says it again
    // where the knitter looks at the first pass.
    const carriage = `Carriage: ${camSetting(job.passes[0])[0]}`;
    if (!canChangeTechnique(job)) {
      const title = job.stitchChart
        ? 'A stitch chart knits as drawn: knit, tuck or slip per needle. Make it a color chart in the Stitches panel to knit it another way.'
        : 'Press Knit in the designer again to choose the technique here.';
      return [label, h('div', { class: 'knit-technique-fixed', title: `${title}\n\n${carriage}` }, techniqueLabel())];
    }

    const options = knitOptions();
    const chosen = options.find((o) => o.id === job.technique);
    const el = select({
      value: job.technique,
      title: [carriage, ...(chosen?.problems ?? []), '', ...options.map((o) => `${o.label}: ${o.title}`)].join('\n'),
      options: options.map((o) => [o.id, [o.label, `${o.passes} passes`, o.problems[0]].filter(Boolean).join(' · ')]),
      onchange: setTechnique,
    });
    el.classList.add('knit-technique');
    el.disabled = patterning;
    return [label, el];
  }

  function renderSide() {
    clear(side);

    if (pendingJob) {
      side.append(
        h(
          'div',
          { class: 'knit-banner is-warn' },
          h('strong', {}, `Changed design: "${pendingJob.name}"`),
          h('p', {}, `Loading it starts again at row 1. You are on row ${currentRow() + 1} of the current one.`),
          h('div', { class: 'row' },
            button({ label: 'Load the new design', variant: 'primary', disabled: patterning, title: patterning ? 'Stop patterning first' : '', onclick: () => loadNewJob(pendingJob) }),
            button({ label: 'Keep knitting this', onclick: () => { pendingJob = null; render(); } })
          )
        )
      );
    }

    const g = grid();
    const p = session.passIndex;
    const r = g.passes[p].row;
    const inRow = passInRow(g, p);
    const wrapped = repeating() && session.passes > 0;
    const yarns = yarnsFor(g, p, session.swapFeeders);
    const changes = yarnChanges(g, p, wrapped, session.swapFeeders);
    const change = changes.length > 0;
    const problem = markerProblem(g);
    const count = needleCount(session.layout.left, session.layout.right);

    const startBlocker = problem ?? (!session.markersSet ? 'Confirm how it knits and the needle markers first.' : !connected ? 'Connect to the controller first.' : null);

    append(side, [
      h(
        'section',
        { class: 'knit-card' },
        // The big number is rows done, from 0, so it reads the same as the
        // machine's own row counter when both are reset together. Where that
        // leaves you on the chart is the line beneath, counted from 1.
        h('div', { class: 'row knit-count' },
          h('span', { class: 'knit-row-label' }, 'Rows knitted'),
          h('span', { class: 'grow' }),
          button({
            label: 'Reset count',
            variant: 'ghost',
            title: 'Set this to 0. Reset the machine\'s row counter at the same time.',
            disabled: session.passes === 0,
            onclick: () => update({ passes: 0 }),
          })),
        h('div', { class: 'knit-row-num' }, String(session.passes)),
        h('div', { class: 'knit-next' },
          session.finished
            ? `Panel complete: all ${g.height} chart rows knitted`
            : h('span', {}, 'Next: ', h('strong', {}, `${scopeOf() === 'tile' ? 'tile' : 'chart'} row ${r + 1}`), ` of ${g.height}`,
                inRow.of > 1 ? `, pass ${inRow.n} of ${inRow.of}` : '')),
        h('div', { class: 'knit-progress' }, h('span', { style: { width: `${((p + (session.finished ? 1 : 0)) / g.passes.length) * 100}%` } })),
        h('div', { class: 'row knit-step' },
          button({ label: '- Row', title: 'Previous row  (Down arrow)', onclick: () => goToRow(r - 1), disabled: r === 0 }),
          button({ label: 'Row +', title: 'Next row  (Up arrow)', onclick: () => goToRow(r + 1), disabled: r >= g.height - 1 }),
          h('span', { class: 'grow' }),
          button({ label: 'Back to row 1', variant: 'ghost', onclick: () => goToRow(0), disabled: p === 0 && !session.finished })
        )
      ),

      // Always second, under the row counter, so the card never jumps. Until
      // the markers are confirmed renderBed() draws it highlighted and
      // expanded: forgetting them is the commonest way to ruin a first row.
      renderBed(),

      h(
        'section',
        { class: 'knit-card' },
        h('div', { class: 'knit-carriage' },
          h('span', { class: 'knit-arrow' }, nextTravel() === 'right' ? '→' : '←'),
          h('div', {},
            h('strong', {}, `Carriage on the ${session.carriageSide}`),
            h('small', {}, patterning && needleNow ? `Needle ${needleNow} of ${count}` : `Next pass travels ${nextTravel()}`)
          ),
          h('span', { class: 'grow' }),
          button({ label: 'It\'s on the other side', variant: 'ghost', onclick: flipCarriage, title: 'Set this to where the carriage actually is' })
        )
      ),

      h(
        'section',
        { class: `knit-card ${change ? 'is-change' : ''}` },
        change ? h('div', { class: 'knit-change' }, 'Change yarn') : null,
        renderFeeders(changes, yarns),
        change ? renderYarnAction(g, p, wrapped, changes, yarns) : null,
        g.passes[p].travel
          ? h('p', { class: 'knit-note', title: 'The main bed slips every needle and only the ribber knits, taking the yarn back to the color changer.' }, 'Travel pass: nothing on the front')
          : null,
        renderStartSide(g, p),
        yarns.cam === 'fairisle' ? null : camLine(g, p, wrapped),
        yarns.ribber && yarns.cam !== 'jacquard'
          ? h('p', { class: 'knit-note', title: 'The ribber knits every needle on every pass; set its carriage to plain knitting.' }, 'Ribber: knit every needle')
          : null,
        yarns.substituted
          ? h('p', { class: 'knit-note is-warn' }, yarns.cam === 'fairisle'
              ? `${yarns.substituted} stitches in this row were reduced to two colors.`
              : `${yarns.substituted} stitches in this pass knit in this yarn instead of the color drawn.`)
          : null,
        renderNextChange(g, p),
        renderYarns()
      ),

      h(
        'section',
        { class: 'knit-card' },
        patterning
          ? button({ label: 'Stop patterning', variant: 'knit-go is-stop', onclick: stop })
          : button({
              label: session.finished ? 'Knit it again from row 1' : 'Start patterning',
              variant: 'primary knit-go',
              disabled: Boolean(startBlocker),
              title: startBlocker ?? '',
              onclick: start,
            }),
        !patterning && startBlocker ? h('p', { class: 'knit-note is-warn' }, startBlocker) : null
      ),

      renderOptions(),
      renderLog(),
    ]);
  }

  /**
   * The cam setting for this pass, marked when it differs from the last pass
   * that needed one. A plain pass needs none, so it neither marks a change
   * nor counts as one.
   */
  function camLine(g, p, wrapped) {
    const [label, title] = camSetting(g.passes[p]);
    // Only when there is something to do: the first pass, or a new setting.
    // Otherwise it is in the tooltip on the yarn, not on screen every pass.
    if (camChangeAt(g, p, wrapped)) return h('p', { class: 'knit-note is-warn', title }, `Set the carriage: ${label}`);
    if (p === 0 && !wrapped && session.passes === 0 && g.passes[p].cam !== 'plain') return h('p', { class: 'knit-note', title }, `Carriage: ${label}`);
    return null;
  }

  function camChangeAt(g, p, wrapped) {
    const pass = g.passes[p];
    let before = null;
    for (let i = 1; i <= g.passes.length && !before; i++) {
      const q = p - i;
      if (q < 0 && !wrapped) break;
      const other = g.passes[(q + g.passes.length) % g.passes.length];
      if (other.cam !== 'plain') before = other.cam;
    }
    return pass.cam !== 'plain' && before !== null && before !== pass.cam;
  }

  const chip = (yarn) => h('span', { class: 'knit-chip', style: { background: yarn.hex }, title: yarn.name });

  /**
   * What is in each feeder for this pass, one line per feeder: the yarn, or
   * old -> new where it changes. The big chip is the yarn's color picker.
   * The cam setting is the tooltip, so it is there without being read.
   */
  function renderFeeders(changes, yarns) {
    const [camLabel] = camSetting(grid().passes[session.passIndex]);
    const feeders = yarns.single ? [yarns.feeder1] : [yarns.feeder1, yarns.feeder2];
    const roles = ['Feeder 1 - background', 'Feeder 2 - selected needles'];
    return feeders.map((yarn, i) => {
      const c = changes.find((ch) => ch.feeder === i + 1);
      return h('div', { class: `knit-feed ${c ? 'is-change' : ''}`.trim(), title: yarns.single ? `Carriage: ${camLabel}` : roles[i] },
        yarns.single ? null : h('span', { class: 'knit-feed-num' }, String(i + 1)),
        c ? [c.from ? chip(c.from) : h('small', {}, 'empty'), h('span', { class: 'knit-swap-arrow' }, '→')] : null,
        colorPicker(grid().yarns.indexOf(yarn), 'knit-yarn-chip'),
        h('strong', {}, yarn.name));
    });
  }

  /**
   * The one thing to do with the yarn ends, on a one-yarn pass: join the new
   * yarn, or cut and rejoin it if it was left on the far side, and cut the
   * old one if it is finished. Nothing when the new yarn is waiting here and
   * the old one is parked - the common case with a color changer. Sides
   * follow the carriage side ("It's on the other side" fixes both).
   */
  function renderYarnAction(g, p, wrapped, changes, yarns) {
    if (!yarns.single) return null;
    const here = session.carriageSide;
    const [c] = changes;
    const at = yarnSide(g, p, c.toIndex, here, wrapped);
    const steps = [];
    if (at === null) steps.push(`Join ${c.to.name}`);
    else if (at !== here) steps.push(`${c.to.name} is on the ${at}: cut and rejoin here`);
    if (c.from && !yarnUsedAfter(g, p, c.fromIndex, repeating())) steps.push(`cut ${c.from.name}, it is finished`);
    if (!steps.length) return null;
    const text = steps.join(' · ');
    return h('p', { class: `knit-note ${at !== null && at !== here ? 'is-warn' : ''}`.trim() }, text[0].toUpperCase() + text.slice(1));
  }

  /**
   * Before the first jacquard pass: the side to start from so that every
   * change comes with the carriage at the color changer, which is on the
   * left on Silver Reed and Brother beds. The plan says which: a change before
   * an odd pass needs a start on the right, before an even one on the left.
   */
  function renderStartSide(g, p) {
    if (p !== 0 || session.passes !== 0 || g.passes[0].cam !== 'jacquard') return null;
    const first = g.passes.findIndex((_, i) => i > 0 && yarnChanges(g, i, false, session.swapFeeders).length > 0);
    if (first < 0) return null;
    const start = first % 2 ? 'right' : 'left';
    if (start === session.carriageSide) return null;
    return h('p', { class: 'knit-note is-warn', title: 'Yarn changes then all come with the carriage at the color changer, on the left.' },
      `Start with the carriage on the ${start}`);
  }

  /** The next rethread ahead, so the cone can be ready before the carriage is. */
  function renderNextChange(g, p) {
    if (session.finished) return null;
    const next = nextChange(g, p, repeating(), session.swapFeeders);
    if (!next) return null;
    const when = next.ahead === 1 ? 'next pass' : `in ${next.ahead} passes`;
    return h('div', { class: 'knit-then', title: `Before chart row ${g.passes[next.passIndex].row + 1}` },
      h('small', {}, 'Next'),
      ...next.changes.map((c) => h('span', { class: 'knit-then-yarn' }, chip(c.to), c.to.name)),
      h('small', { class: 'grow' }, when));
  }

  /**
   * Which cone knits each design color, and what color it really is. Letters
   * start in the order the yarns are first needed; two design colors given
   * one letter knit from one cone. The controller shows the letters.
   */
  function renderYarns() {
    const setup = setupOf();
    const used = job.yarns.map((_, i) => i).filter((i) => setup.map[i] !== null)
      .sort((a, b) => setup.map[a] - setup.map[b] || a - b);
    const letters = Math.max(10, setup.yarns.length);
    const custom = session.yarnLetters !== null || Object.keys(session.yarnColors ?? {}).length > 0;
    return h(
      'details',
      { class: 'knit-yarn-setup', dataset: { key: 'yarns' } },
      h('summary', { title: 'Which yarn letter knits each design color, and each yarn\'s color' }, `All yarns (${setup.yarns.filter((y) => y.colors.length).length})`),
      h('div', { class: 'knit-yarns' },
        ...used.map((index) => {
          const yarn = setup.map[index];
          return h('div', { class: 'knit-yarn-row' },
            h('span', { class: 'knit-chip', style: { background: job.yarns[index].hex }, title: `${job.yarns[index].name} in the design` }),
            h('span', { class: 'knit-swap-arrow' }, '→'),
            select({
              value: String(yarn),
              title: 'The cone that knits this color. Give two colors the same letter to knit both from one cone.',
              options: Array.from({ length: letters }, (_, n) => [String(n), `Yarn ${yarnLetter(n)}`]),
              onchange: (v) => setYarnLetter(index, Number(v)),
            }),
            colorPicker(yarn, ''));
        }),
        custom
          ? h('button', { class: 'link', title: 'Back to the design colors, lettered in the order they are first knitted', onclick: resetYarns }, 'Reset yarns')
          : null)
    );
  }

  function setYarnLetter(index, yarn) {
    const letters = setupOf().map.slice();
    letters[index] = yarn;
    update({ yarnLetters: letters, yarnFor: paletteKey(job) });
    addLog('info', `${job.yarns[index].name} knits from yarn ${yarnLetter(yarn)}.`);
    if (patterning) sendCurrent();
  }

  function setYarnColor(yarn, hex) {
    const colors = { ...session.yarnColors };
    if (hex.toLowerCase() === setupOf().yarns[yarn].design.toLowerCase()) delete colors[yarn];
    else colors[yarn] = hex;
    update({ yarnColors: colors, yarnFor: paletteKey(job) });
  }

  function resetYarns() {
    update({ yarnLetters: null, yarnColors: {}, yarnFor: null });
    addLog('info', 'Yarns reset to the design colors.');
    if (patterning) sendCurrent();
  }

  function renderOptions() {
    const details = h(
      'details',
      { class: 'knit-card knit-details', dataset: { key: 'options' } },
      h('summary', {}, 'Knitting options'),
      h('div', { class: 'knit-opts' },
        getTechnique(job.technique).id === 'fairisle'
          ? checkbox({
              label: 'Swap feeders',
              checked: session.swapFeeders,
              title: 'Invert every row, so the two yarns change feeders. Use it if main and contrast come out the wrong way round.',
              onchange: (v) => {
                update({ swapFeeders: v });
                if (patterning) sendCurrent();
              },
            })
          : checkbox({
              label: 'Invert stitch selection',
              checked: session.invertSelect,
              title: 'Swap which needles knit and which tuck or slip. Not yet checked on the SK840: knit a small swatch, and turn this on if the tucks or slips land where the knit stitches should be.',
              onchange: (v) => {
                update({ invertSelect: v });
                if (patterning) sendCurrent();
              },
            }),
        checkbox({
          label: 'Sound on yarn and carriage changes',
          checked: session.sound,
          title: 'A chime as the carriage finishes the pass before a yarn or cam change, and a longer one when the panel is done. Turning it on plays it once.',
          onchange: (v) => {
            update({ sound: v });
            chime('change');
          },
        }),
        checkbox({
          label: 'Mirror left to right',
          checked: session.mirror,
          title: 'Flip the pattern across the bed. Off knits the chart the right way round on the knit side.',
          onchange: (v) => {
            update({ mirror: v });
            if (patterning) sendCurrent();
          },
        }),
        checkbox({
          label: 'Repeat from row 1 when the panel ends',
          checked: repeating(),
          disabled: scopeOf() === 'tile',
          title: scopeOf() === 'tile'
            ? 'A repeated tile always keeps going. Stop patterning when the piece is long enough.'
            : 'Keep knitting the panel over and over instead of stopping after the last row.',
          onchange: (v) => {
            // Turned off on a closing pass: that pass is gone from the plan.
            session.repeat = v;
            const passIndex = Math.min(session.passIndex, grid().passes.length - 1);
            const moved = passIndex !== session.passIndex;
            update({ passIndex });
            if (moved && patterning) sendCurrent();
          },
        }))
    );
    return details;
  }

  function renderLog() {
    const body = h('div', { class: 'knit-log' }, ...log.map((line) => h('div', { class: `is-${line.level}` }, line.text)));
    const details = h('details', { class: 'knit-card knit-details', dataset: { key: 'log' } }, h('summary', {}, `Controller log (${log.length})`), body);
    details.addEventListener('toggle', () => (body.scrollTop = body.scrollHeight));
    return details;
  }

  const disclosures = {};
  function render() {
    if (!open) return;
    renderBar();
    if (!job) {
      clear(side);
      side.append(h('div', { class: 'knit-empty' },
        h('strong', {}, 'No pattern yet'),
        null
      ));
      drawChart();
      return;
    }

    // A color input's picker is anchored to the element: rebuilding the panel
    // under it would close it. It blurs itself once a color is chosen.
    const active = document.activeElement;
    if (active?.type === 'color' && side.contains(active)) {
      drawChart();
      return;
    }

    // The panel rebuilds wholesale; keep the disclosures as the user left them.
    side.querySelectorAll('details[data-key]').forEach((d) => (disclosures[d.dataset.key] = d.open));
    renderSide();
    side.querySelectorAll('details[data-key]').forEach((d) => {
      d.open = Boolean(disclosures[d.dataset.key]);
      const body = d.querySelector('.knit-log');
      if (d.open && body) body.scrollTop = body.scrollHeight;
    });
    drawChart();
  }

  // --- chart ----------------------------------------------------------------

  let chartGeom = null;

  function drawChart() {
    const dpr = window.devicePixelRatio || 1;
    const w = chart.clientWidth;
    const hgt = chart.clientHeight;
    if (!w || !hgt) return;
    chart.width = Math.round(w * dpr);
    chart.height = Math.round(hgt * dpr);
    const ctx = chart.getContext('2d', { alpha: false });
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;

    // Theme colors come from CSS, as in the editor (CLAUDE.md 5).
    ctx.fillStyle = getComputedStyle(chart).backgroundColor;
    ctx.fillRect(0, 0, w, hgt);
    if (!job) return;
    const knit = grid();

    const gutter = 34;
    const pad = 14;
    const cell = Math.max(1, Math.min((w - gutter - pad * 2) / knit.width, (hgt - pad * 2) / knit.height));
    const ox = Math.round(gutter + (w - gutter - knit.width * cell) / 2);
    const oy = Math.round((hgt - knit.height * cell) / 2);
    chartGeom = { ox, oy, cell };

    // One pixel per stitch in an offscreen bitmap, scaled up unsmoothed.
    const img = new ImageData(knit.width, knit.height);
    const rgb = knit.yarns.map((y) => [1, 3, 5].map((i) => parseInt(y.hex.slice(i, i + 2), 16)));
    for (let i = 0; i < knit.chart.length; i++) {
      const [r, g, b] = rgb[knit.chart[i]];
      img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255;
    }
    const off = new OffscreenCanvas(knit.width, knit.height);
    off.getContext('2d').putImageData(img, 0, 0);
    ctx.drawImage(off, ox, oy, knit.width * cell, knit.height * cell);

    const css = getComputedStyle(document.documentElement);
    const accent = css.getPropertyValue('--accent').trim();
    const well = getComputedStyle(chart).backgroundColor;

    // Knitted rows sit below the current one; dim them so what is left reads.
    const rowY = (index) => oy + (knit.height - 1 - index) * cell;
    const row = knit.passes[session.passIndex].row;
    const done = session.finished ? knit.height : row;
    if (done > 0) {
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = well;
      ctx.fillRect(ox, rowY(done - 1), knit.width * cell, done * cell);
      ctx.globalAlpha = 1;
    }

    // The next row: bars either side, plus an outline when rows are tall enough.
    if (!session.finished) {
      const y = rowY(row);
      const band = Math.max(cell, 2);
      ctx.fillStyle = accent;
      ctx.fillRect(ox - 10, y, 6, band);
      ctx.fillRect(ox + knit.width * cell + 4, y, 6, band);
      if (cell >= 4) {
        ctx.fillRect(ox, y - 1, knit.width * cell, 1);
        ctx.fillRect(ox, y + cell, knit.width * cell, 1);
      }
    }

    // Row numbers from the cast-on edge, every ten when there is room for them.
    ctx.fillStyle = css.getPropertyValue('--ink-faint').trim();
    ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const step = cell >= 10 ? 5 : cell >= 3 ? 10 : 50;
    for (let n = step; n <= knit.height; n += step) {
      ctx.fillText(String(n), ox - 14, rowY(n - 1) + cell / 2);
    }
  }

  chart.addEventListener('click', (event) => {
    if (!job || !chartGeom) return;
    const rect = chart.getBoundingClientRect();
    const y = event.clientY - rect.top;
    const gridY = Math.floor((y - chartGeom.oy) / chartGeom.cell);
    if (gridY < 0 || gridY >= grid().height) return;
    goToRow(grid().height - 1 - gridY);
  });

  new ResizeObserver(() => drawChart()).observe(chartBox);

  // --- page -----------------------------------------------------------------

  window.addEventListener('keydown', (event) => {
    if (!open || ['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName)) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === 'escape' || key === 'k') { event.preventDefault(); close(); return; }
    if (!job) return;
    if (event.key === 'ArrowUp') { event.preventDefault(); goToRow(currentRow() + 1); }
    if (event.key === 'ArrowDown') { event.preventDefault(); goToRow(currentRow() - 1); }
  });

  window.addEventListener('beforeunload', (event) => {
    if (!patterning) return;
    event.preventDefault();
    event.returnValue = '';
  });

  if (!serialSupported()) addLog('error', 'This browser has no Web Serial. Use Chrome, Edge or Firefox 151+ to drive the machine.');

  function show(next) {
    if (next) offer(next);
    open = true;
    designer.hidden = true;
    host.hidden = false;
    render();
  }

  function close() {
    if (!open) return;
    open = false;
    host.hidden = true;
    designer.hidden = false;
    onClose?.();
  }

  return {
    open: show,
    close,
    isOpen: () => open,
    isPatterning: () => patterning,
    /** The color technique the next job from the designer knits as, or null for the designer's. */
    technique: () => session?.technique ?? null,
  };
}
