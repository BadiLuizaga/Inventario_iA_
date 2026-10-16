/* ------------------------------------------------------------------ *
 * Arranque: navegación, ajustes, sesión y enlace escáner → catálogo.
 * ------------------------------------------------------------------ */
import { $, $, setMsg, snack } from './ui.js';
import { prefs, loadPrefs, savePrefs, applySens } from './prefs.js';
import { DEFAULT_MODEL, isLegacy, normalizeUrl } from './classifier/model.js';
import { initScanner, loadModel, startCamera, stopCamera, resetEngine, setMirror, scannerState } from './classifier/scanner.js';
import { initSupabase } from './supabase.js';
import { initAuth, signIn, signOut, getProfile, authErrorText } from './auth.js';
import { findByLabel } from './services/products.js';
import { renderPanel, renderCatalog, renderStock, renderHistory, accessBlocker } from './views.js';

const ctx = { db: 'checking', session: null, profile: null, profileError: null, model: { state: 'loading' }, tab: 'panel' };

/* ---------- pantallas ---------- */
const SCREENS = {
  panel: () => renderPanel($('#sysStatus'), ctx),
  scan: () => {},
  catalog: () => renderCatalog($('#catalogBody'), ctx, openLogin),
  stock: () => renderStock($('#stockBody'), ctx, openLogin),
  history: () => renderHistory($('#historyBody'), ctx, openLogin),
};
const refresh = () => SCREENS[ctx.tab]();

function setTab(t) {
  if (!SCREENS[t]) t = 'panel';
  ctx.tab = t; document.body.dataset.tab = t;
  $$('.tabbar button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
  $$('[data-screen]').forEach(s => { s.hidden = s.dataset.screen !== t; });
  if (t !== 'scan') resetEngine();
  if (t !== 'scan' && scannerState.running) stopCamera(false);   // la cámara no queda encendida en segundo plano
  window.scrollTo({ top: 0 });
  refresh();
}

/* ---------- escáner → producto ---------- */
let detectSeq = 0;
async function onDetect(label) {
  const seq = ++detectSeq;
  $('#detected').hidden = false;
  $('#detLabel').textContent = label;
  const info = $('#detLink');
  if (accessBlocker(ctx, openLogin)) { info.textContent = 'Inicia sesión con la base de datos configurada para ver el producto vinculado a esta etiqueta.'; return; }
  info.textContent = 'Buscando en el catálogo…';
  try {
    const p = await findByLabel(label);
    if (seq !== detectSeq) return;
    if (!p) { info.textContent = 'Esta etiqueta todavía no está vinculada a ningún producto del catálogo.'; return; }
    const inv = Array.isArray(p.inventario) ? p.inventario[0] : p.inventario;
    info.textContent = `Producto: ${p.nombre}${p.estado !== 'activo' ? ' (inactivo)' : ''} · Existencias: ${inv ? inv.cantidad : '—'}`;
  } catch (e) {
    console.error(e);
    if (seq === detectSeq) info.textContent = 'No se pudo consultar el catálogo.';
  }
}

/* ---------- sesión ---------- */
function openLogin() {
  const signed = !!ctx.session;
  $('#loginForm').hidden = signed; $('#accountView').hidden = !signed;
  if (signed) {
    const p = ctx.profile;
    $('#accountInfo').textContent = `${ctx.session.user.email}${p ? ` · rol ${p.rol}${p.activo ? '' : ' (inactivo)'}` : ''}`;
  } else setMsg($('#loginMsg'), '');
  const d = $('#dlgLogin'); d.showModal(); d.focus({ preventScroll: true });
}

async function onSession(session) {
  ctx.session = session; ctx.profile = null; ctx.profileError = null;
  if (session) {
    try { ctx.profile = await getProfile(session.user.id); } catch (e) { ctx.profileError = e; }
  }
  $('#btnAccount').textContent = session ? (ctx.profile && ctx.profile.nombre || session.user.email) : 'Iniciar sesión';
  refresh();
}

/* ---------- ajustes (heredados del original) ---------- */
function setSens(s) {
  prefs.cfg.sens = s; applySens();
  $$('[data-sens]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.sens === s)));
  savePrefs();
}
function applyTech() { $('#tech').hidden = !prefs.cfg.tech; }
function applyTheme() {
  const t = prefs.cfg.theme || 'auto', root = document.documentElement;
  if (t === 'light' || t === 'dark') root.dataset.theme = t; else delete root.dataset.theme;
  const dark = t === 'dark' || (t === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = dark ? '#08181D' : '#EDF3F4';
  $$('[data-theme-opt]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.themeOpt === t)));
}

function bindSettings() {
  $('#optSound').checked = prefs.cfg.sound; $('#optVibrate').checked = prefs.cfg.vibrate; $('#optTech').checked = prefs.cfg.tech;
  $$('[data-sens]').forEach(b => b.addEventListener('click', () => setSens(b.dataset.sens)));
  $$('[data-theme-opt]').forEach(b => b.addEventListener('click', () => { prefs.cfg.theme = b.dataset.themeOpt; applyTheme(); savePrefs(); }));
  const sysDark = window.matchMedia('(prefers-color-scheme: dark)');
  if (sysDark.addEventListener) sysDark.addEventListener('change', applyTheme);

  $('#btnSettings').addEventListener('click', () => { $('#modelUrl').value = prefs.customUrl || ''; const d = $('#dlgSettings'); d.showModal(); d.focus({ preventScroll: true }); });
  $('#btnStop').addEventListener('click', () => { $('#dlgSettings').close(); stopCamera(false); });
  $('#btnFlip').addEventListener('click', () => { $('#dlgSettings').close(); prefs.cfg.facing = prefs.cfg.facing === 'environment' ? 'user' : 'environment'; savePrefs(); startCamera(); });
  $('#optSound').addEventListener('change', e => { prefs.cfg.sound = e.target.checked; savePrefs(); });
  $('#optVibrate').addEventListener('change', e => { prefs.cfg.vibrate = e.target.checked; savePrefs(); });
  $('#optTech').addEventListener('change', e => { prefs.cfg.tech = e.target.checked; applyTech(); savePrefs(); });
  $('#optMirror').addEventListener('change', e => setMirror(e.target.checked));

  $('#btnModelSave').addEventListener('click', async () => {
    const v = $('#modelUrl').value.trim();
    if (!v) { setMsg($('#modelMsg'), 'Pega el enlace del modelo.', 'err'); return; }
    setMsg($('#modelMsg'), 'Probando…');
    const prev = prefs.customUrl;
    prefs.customUrl = normalizeUrl(v);
    if (await loadModel(prefs.customUrl)) { savePrefs(); setMsg($('#modelMsg'), 'Listo. Ya se usa este modelo.', 'ok'); return; }
    prefs.customUrl = prev; savePrefs();
    await loadModel(prev || DEFAULT_MODEL);
    setMsg($('#modelMsg'), 'Ese enlace no funcionó. Se sigue usando el modelo anterior.', 'err');
  });
  $('#btnModelReset').addEventListener('click', async () => {
    prefs.customUrl = ''; savePrefs(); $('#modelUrl').value = '';
    const ok = await loadModel(DEFAULT_MODEL);
    setMsg($('#modelMsg'), ok ? 'Se volvió al modelo original.' : 'No se pudo cargar el modelo original.', ok ? 'ok' : 'err');
  });
}

/* ---------- arranque ---------- */
async function init() {
  loadPrefs();
  setSens(prefs.cfg.sens); applyTech(); applyTheme();
  bindSettings();

  $$('.tabbar button').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
  $$('[data-go]').forEach(b => b.addEventListener('click', () => setTab(b.dataset.go)));
  $$('[data-refresh]').forEach(b => b.addEventListener('click', refresh));
  $$('dialog [data-close]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));
  $('#btnDetClose').addEventListener('click', () => { detectSeq++; $('#detected').hidden = true; });
  $('#btnAccount').addEventListener('click', openLogin);

  $('#frmLogin').addEventListener('submit', async e => {
    e.preventDefault();
    const email = $('#loginEmail').value.trim(), pass = $('#loginPass').value;
    if (ctx.db !== 'ok') { setMsg($('#loginMsg'), 'Primero configura la conexión con Supabase (js/config.js).', 'err'); return; }
    if (!email || !pass) { setMsg($('#loginMsg'), 'Escribe tu correo y tu contraseña.', 'err'); return; }
    $('#btnLogin').disabled = true; setMsg($('#loginMsg'), 'Entrando…');
    try { await signIn(email, pass); $('#loginPass').value = ''; $('#dlgLogin').close(); snack('Sesión iniciada'); }
    catch (err) { setMsg($('#loginMsg'), authErrorText(err), 'err'); }
    finally { $('#btnLogin').disabled = false; }
  });
  $('#btnLogout').addEventListener('click', async () => { await signOut(); $('#dlgLogin').close(); snack('Sesión cerrada'); });

  initScanner({
    isVisible: () => ctx.tab === 'scan' && !document.hidden,
    hooks: { onDetect, onModelStatus: s => { ctx.model = s; if (ctx.tab === 'panel') refresh(); } },
  });

  setTab('panel');

  // Base de datos y sesión (independiente del modelo de IA)
  const { client, status } = await initSupabase();
  ctx.db = status;
  initAuth(client, onSession);   // emite la sesión inicial y cada cambio posterior
  if (!client) refresh();

  // Modelo de IA: si falla, se muestra el error y el resto sigue funcionando
  const param = new URLSearchParams(location.search).get('model');
  if (param && !isLegacy(param)) prefs.customUrl = normalizeUrl(param);
  loadModel(prefs.customUrl || DEFAULT_MODEL).then(ok => {
    if (ok) { if (param) savePrefs(); }
    else if (prefs.customUrl) { prefs.customUrl = ''; savePrefs(); loadModel(DEFAULT_MODEL); }   // si el enlace propio falla, se vuelve al modelo original
  });
}

init();
