/* Utilidades de interfaz compartidas. */
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'html') n.innerHTML = v; // solo para íconos SVG fijos, nunca con datos
    else n.setAttribute(k, v);
  }
  n.append(...kids);
  return n;
}

const pad = n => String(n).padStart(2, '0');
export function fmtDate(iso) {
  const d = new Date(iso);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function fmtMoney(v) {
  const n = Number(v);
  try { return n.toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); } catch (_) { return n.toFixed(2); }
}

export function retrigger(node, cls) { node.classList.remove(cls); void node.offsetWidth; node.classList.add(cls); }
export function setMsg(node, text, kind = '') { node.textContent = text; node.className = 'msg' + (kind ? ' ' + kind : ''); }

let snackTimer = 0;
export function snack(text) {
  $('#snackText').textContent = text;
  $('#snack').hidden = false;
  clearTimeout(snackTimer);
  snackTimer = setTimeout(() => { $('#snack').hidden = true; }, 5000);
}

/* Sonido y vibración (heredados del original) */
let actx = null;
export function unlockAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!actx && AC) actx = new AC();
  if (actx && actx.state === 'suspended') actx.resume();
}
export function beep(enabled, freq, dur = 0.12) {
  if (!enabled || !actx) return;
  try {
    const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime;
    o.type = 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.3, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(actx.destination);
    o.start(t); o.stop(t + dur + 0.02);
  } catch (_) {}
}
export function buzz(enabled, ms) { if (enabled && navigator.vibrate) navigator.vibrate(ms); }

/* Íconos (SVG estáticos) */
export const ICONS = {
  box: '<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  plug: '<path d="M9 7V3M15 7V3"/><path d="M6 7h12v4a6 6 0 0 1-12 0z"/><path d="M12 17v4"/>',
  alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v4M12 18h.01"/>',
};
export const icon = name => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

/** Estado vacío / de aviso reutilizable. */
export function emptyState({ icon: ic = 'box', title, text = '', kind = '', action = null }) {
  const box = el('div', { class: 'empty', role: kind === 'err' ? 'alert' : 'status', ...(kind ? { 'data-kind': kind } : {}) });
  box.insertAdjacentHTML('beforeend', icon(ic));
  box.append(el('strong', { text: title }));
  if (text) box.append(el('p', { text }));
  if (action) {
    const b = el('button', { class: 'btn small', type: 'button', text: action.label });
    b.addEventListener('click', action.onClick);
    box.append(b);
  }
  return box;
}
