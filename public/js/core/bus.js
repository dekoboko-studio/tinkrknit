/**
 * Tiny pub/sub. This is the only sanctioned coupling between modules:
 * nothing imports another module's DOM or reaches into its internals.
 *
 * Event names are plain strings, namespaced with a colon by convention
 * (`project:changed`, `tool:selected`). Unknown events are not an error.
 */

const listeners = new Map();

/** @returns {() => void} unsubscribe */
export function on(event, handler) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(handler);
  return () => off(event, handler);
}

export function once(event, handler) {
  const stop = on(event, (payload) => {
    stop();
    handler(payload);
  });
  return stop;
}

export function off(event, handler) {
  listeners.get(event)?.delete(handler);
}

export function emit(event, payload) {
  const set = listeners.get(event);
  if (!set) return;
  // Copy first so a handler may unsubscribe during dispatch.
  for (const handler of [...set]) {
    try {
      handler(payload);
    } catch (err) {
      console.error(`bus handler failed for "${event}"`, err);
    }
  }
}

/** Coalesce bursts of an event into one call on the next animation frame. */
export function onFrame(event, handler) {
  let queued = false;
  let last;
  return on(event, (payload) => {
    last = payload;
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      handler(last);
    });
  });
}
