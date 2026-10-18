/* Utilidades de interfaz compartidas por la tienda, el almacén y el panel. */
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'html') n.innerHTML = v; // solo para íconos SVG fijos, nunca con datos
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (v === true) n.setAttribute(k, '');
    else n.setAttribute(k, v);
  }
  n.append(...kids.flat().filter(k => k !== null && k !== undefined && k !== false));
  return n;
}

const pad = n => String(n).padStart(2, '0');
export function fmtDate(iso, withTime = true) {
  const d = new Date(iso);
  const s = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  return withTime ? `${s} ${pad(d.getHours())}:${pad(d.getMinutes())}` : s;
}
let currency = 'Bs';
export function setCurrency(c) { if (c) currency = c; }
export function fmtMoney(v, withCurrency = false) {
  const n = Number(v || 0);
  let s;
  try { s = n.toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); } catch (_) { s = n.toFixed(2); }
  return withCurrency ? `${currency} ${s}` : s;
}
export const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
/** Inicio del día local en ISO (para filtrar «hoy» en la base). */
export const startOfDay = (ymd = todayISO()) => new Date(`${ymd}T00:00:00`).toISOString();
export const endOfDay = (ymd = todayISO()) => new Date(`${ymd}T23:59:59.999`).toISOString();

export function retrigger(node, cls) { node.classList.remove(cls); void node.offsetWidth; node.classList.add(cls); }
export function setMsg(node, text, kind = '') { if (!node) return; node.textContent = text; node.className = 'msg' + (kind ? ' ' + kind : ''); }

export function debounce(fn, ms = 300) {
  let t = 0;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

let snackTimer = 0;
export function snack(text, kind = '') {
  let s = $('#snack');
  if (!s) { s = el('div', { id: 'snack', class: 'snack', role: 'status', hidden: true }, el('span', { id: 'snackText' })); document.body.append(s); }
  $('#snackText', s).textContent = text;
  s.className = 'snack' + (kind ? ' ' + kind : '');
  s.hidden = false;
  clearTimeout(snackTimer);
  snackTimer = setTimeout(() => { s.hidden = true; }, 5000);
}

/* Sonido y vibración (heredados del clasificador original) */
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
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-5-5"/>',
  cart: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.6 12.4a1 1 0 0 0 1 .8h9.7a1 1 0 0 0 1-.8L21 7H6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  shoe: '<path d="M3 16v-5l4-1 3 3 4-1 6 2a2 2 0 0 1 1 2v2H3z"/><path d="M3 18h18"/>',
  store: '<path d="M4 10v10h16V10"/><path d="M3 10l2-6h14l2 6"/><path d="M9 20v-6h6v6"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2 20a7 7 0 0 1 14 0"/><path d="M16 4a3.5 3.5 0 0 1 0 7M18 13a6 6 0 0 1 4 7"/>',
  tag: '<path d="M3 12V3h9l9 9-9 9z"/><circle cx="8" cy="8" r="1.5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 0 0 5 12a7 7 0 0 0 .1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z"/>',
  scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M8 12h8"/>',
  swap: '<path d="M7 4L3 8l4 4"/><path d="M3 8h14"/><path d="M17 20l4-4-4-4"/><path d="M21 16H7"/>',
  check: '<path d="M4 12l5 5L20 6"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
  pin: '<path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>',
};
export const icon = (name, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS.box}</svg>`;
export const iconEl = (name, cls = '') => { const s = el('span', { class: 'ic', html: icon(name, cls) }); s.style.display = 'contents'; return s; };

/** Estado vacío / de aviso reutilizable. */
export function emptyState({ icon: ic = 'box', title, text = '', kind = '', action = null }) {
  const box = el('div', { class: 'empty', role: kind === 'err' ? 'alert' : 'status', ...(kind ? { 'data-kind': kind } : {}) });
  box.insertAdjacentHTML('beforeend', icon(ic));
  box.append(el('strong', { text: title }));
  if (text) box.append(el('p', { text }));
  if (action) {
    const b = el('button', { class: 'btn primary small', type: 'button', text: action.label });
    b.addEventListener('click', action.onClick);
    box.append(b);
  }
  return box;
}
export const loading = (text = 'Cargando…') => el('div', { class: 'loading', role: 'status' }, el('span', { class: 'spinner', 'aria-hidden': 'true' }), el('span', { text }));

/** Traduce un error de Supabase/PostgreSQL a un mensaje comprensible. */
export function errText(e) {
  const code = e && e.code || '';
  const msg = (e && e.message || '').trim();
  if (/fetch|network|Failed to fetch|NetworkError/i.test(msg)) return 'No hay conexión con el servidor. Revisa tu internet.';
  // Mensajes propios de las funciones de la base: ya están redactados para el usuario
  if (['P0001', 'P0002', '22023', '23514'].includes(code) || (code === '42501' && !/row-level security|permission denied/i.test(msg))) return msg;
  if (code === '23505') return 'Ya existe un registro con esos datos.';
  if (code === '23503') return 'No se puede eliminar porque está en uso. Puedes desactivarlo.';
  if (code === '23514' || code === '23502') return 'Algún dato no es válido.';
  if (code === '42501' || /row-level security|permission denied/i.test(msg)) return 'No tienes permiso para esta operación.';
  if (code === 'PGRST301' || /JWT/i.test(msg)) return 'Tu sesión expiró. Vuelve a iniciar sesión.';
  if (/42P01|42883|PGRST20[025]|does not exist|Could not find/i.test(`${code} ${msg}`)) return 'Falta preparar la base de datos (migraciones).';
  return 'No se pudo completar la operación. Vuelve a intentar.';
}

/** Diálogo de confirmación accesible. Devuelve true si se confirma. */
export function confirmDialog({ title, text = '', ok = 'Confirmar', danger = false, body = null }) {
  return new Promise(resolve => {
    const d = el('dialog', { 'aria-labelledby': 'cfT' },
      el('h2', { id: 'cfT', text: title }),
      text ? el('p', { class: 'sub', text }) : null,
      body,
      el('div', { class: 'foot' },
        el('button', { class: 'btn', type: 'button', value: 'no', text: 'Cancelar' }),
        el('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), type: 'button', value: 'yes', text: ok })));
    let result = false;
    d.addEventListener('click', e => { const b = e.target.closest('button[value]'); if (b) { result = b.value === 'yes'; d.close(); } });
    d.addEventListener('close', () => { d.remove(); resolve(result); });
    document.body.append(d);
    d.showModal();
  });
}

/** Etiqueta de disponibilidad pública. */
export const DISPONIBILIDAD = {
  disponible: { text: 'Disponible', cls: 'ok' },
  pocas: { text: 'Pocas unidades', cls: 'warn' },
  agotado: { text: 'Agotado', cls: 'danger' },
};
export const dispoTag = estado => {
  const d = DISPONIBILIDAD[estado] || DISPONIBILIDAD.agotado;
  return el('span', { class: 'tag ' + d.cls }, el('span', { class: 'dot', 'aria-hidden': 'true' }), d.text);
};
