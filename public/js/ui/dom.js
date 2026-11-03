/**
 * Minimal DOM helpers. No framework, on purpose (CLAUDE.md 2).
 *
 *   h('div', { class: 'row' }, h('span', {}, 'hello'))
 *
 * Props are applied as properties where one exists (so `onclick`, `value` and
 * `checked` behave), otherwise as attributes. `class` and `style` accept
 * strings or objects.
 */

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);

  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === null || value === undefined || value === false) continue;

    if (key === 'class' || key === 'className') {
      el.className = Array.isArray(value) ? value.filter(Boolean).join(' ') : value;
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(el.style, value);
    } else if (key === 'dataset') {
      Object.assign(el.dataset, value);
    } else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2), value);
    } else if (key in el) {
      el[key] = value;
    } else {
      el.setAttribute(key, value === true ? '' : value);
    }
  }

  append(el, children);
  return el;
}

export function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

export function clear(el) {
  el.replaceChildren();
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// --- composed controls ------------------------------------------------------

/**
 * A labeled control. A string `hint` is the label's tooltip, not a visible
 * line: explanations live on hover so the panels stay readable. A node (a
 * link to somewhere else, say) is shown under the control.
 */
export function field(label, control, hint) {
  const tip = typeof hint === 'string' ? hint : undefined;
  return h(
    'label',
    { class: 'field', title: tip },
    h('span', { class: 'field-label' }, label),
    control,
    hint && !tip ? h('small', { class: 'field-hint' }, hint) : null
  );
}

export function numberInput({ value, min, max, step = 1, onchange, title }) {
  return h('input', {
    type: 'number',
    class: 'num',
    value,
    min,
    max,
    step,
    title,
    onchange: (e) => onchange(clampNumber(e.target, min, max)),
  });
}

function clampNumber(input, min, max) {
  let v = Number(input.value);
  if (!Number.isFinite(v)) v = min ?? 0;
  if (min !== undefined) v = Math.max(min, v);
  if (max !== undefined) v = Math.min(max, v);
  input.value = String(v);
  return v;
}

/**
 * Two or three mutually exclusive choices shown side by side, for a setting
 * worth seeing at a glance. Options are `[value, label, title?]`.
 */
export function segmented({ value, options, onchange, title }) {
  return h(
    'div',
    { class: 'seg', role: 'radiogroup', title },
    ...options.map(([val, label, tip]) =>
      h(
        'button',
        {
          type: 'button',
          class: `seg-btn ${val === value ? 'is-on' : ''}`.trim(),
          role: 'radio',
          'aria-checked': String(val === value),
          title: tip ?? label,
          onclick: () => val !== value && onchange(val),
        },
        label
      )
    )
  );
}

export function select({ value, options, onchange, title }) {
  return h(
    'select',
    { class: 'select', title, onchange: (e) => onchange(e.target.value) },
    ...options.map(([val, label]) =>
      h('option', { value: val, selected: val === value }, label)
    )
  );
}

export function checkbox({ label, checked, onchange, title }) {
  return h(
    'label',
    { class: 'check', title },
    h('input', {
      type: 'checkbox',
      checked,
      onchange: (e) => onchange(e.target.checked),
    }),
    h('span', {}, label)
  );
}

export function button({ label, onclick, title, variant = '', disabled = false }) {
  return h('button', { class: `btn ${variant}`.trim(), title, onclick, disabled }, label);
}

export function row(...children) {
  return h('div', { class: 'row' }, ...children);
}

export function section(title, ...children) {
  return h('div', { class: 'section' }, h('h4', { class: 'section-title' }, title), ...children);
}

/** Non-blocking status message; `kind` is 'info' | 'warn' | 'error' | 'ok'. */
export function toast(message, kind = 'info', ms = 3600) {
  let host = $('#toasts');
  if (!host) {
    host = h('div', { id: 'toasts' });
    document.body.append(host);
  }
  const node = h('div', { class: `toast toast-${kind}` }, message);
  host.append(node);
  setTimeout(() => {
    node.style.opacity = '0';
    setTimeout(() => node.remove(), 300);
  }, ms);
  return node;
}
