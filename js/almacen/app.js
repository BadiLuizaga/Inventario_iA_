/* ------------------------------------------------------------------ *
 * Herramienta de almacén: navegación, ajustes, sesión, almacén de trabajo
 * y enlace escáner → catálogo real. La cámara SOLO identifica el modelo:
 * las cantidades se registran a mano y con confirmación.
 * ------------------------------------------------------------------ */
import { $, $$, el, setMsg, snack, errText, debounce } from '../ui.js';
import { prefs, loadPrefs, savePrefs, applySens } from '../prefs.js';
import { DEFAULT_MODEL, isLegacy, normalizeUrl } from '../classifier/model.js';
import { initScanner, loadModel, startCamera, stopCamera, resetEngine, setMirror, scannerState } from '../classifier/scanner.js';
import { initSupabase, db } from '../supabase.js';
import { initAuth, signIn, signOut, getStaffProfile, authErrorText, ROL_TEXTO } from '../auth.js';
import { productoPorEtiqueta, variantesDe, existencias, maestros, nombreAlmacen, nombreVariante, registrarEscaneo, resolverEscaneo } from '../services/interno.js';
import { accessBlocker, renderStock, renderMove, renderCount, renderHistory } from './views.js';
import { createPicker } from './picker.js';

const WH_KEY = 'inventario-ia:almacen';
const ctx = { db: 'checking', session: null, profile: null, profileError: null, almacenes: [], almacenesError: null, almacen: null, model: { state: 'loading' }, tab: 'scan' };

/* ---------- pantallas ---------- */
let movePrefill = null;
const SCREENS = {
  scan: () => {},
  stock: () => renderStock($('#stockBody'), ctx, openLogin),
  move: () => { renderMove($('#moveBody'), ctx, openLogin, movePrefill); movePrefill = null; },
  count: () => renderCount($('#countBody'), ctx, openLogin),
  history: () => renderHistory($('#historyBody'), ctx, openLogin),
};
const refresh = () => SCREENS[ctx.tab]();

function setTab(t) {
  if (!SCREENS[t]) t = 'scan';
  ctx.tab = t; document.body.dataset.tab = t;
  $$('.tabbar button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
  $$('[data-screen]').forEach(s => { s.hidden = s.dataset.screen !== t; });
  if (t !== 'scan') { resetEngine(); cerrarEscaneo('descartado'); }
  if (t !== 'scan' && scannerState.running) stopCamera(false);   // la cámara no queda encendida en segundo plano
  window.scrollTo({ top: 0 });
  refresh();
}

/* ---------- registro de escaneos (métricas de la IA) ---------- *
 * Cada propuesta de la cámara queda «pendiente» hasta que la persona la
 * confirma, la corrige eligiendo otro producto o la descarta. El registro
 * es secundario: si falla (p. ej. sin la migración 0004), la app sigue. */
let escaneo = null;   // { id: Promise<uuid|null>, corrigiendo: boolean }
function abrirEscaneo(label, info) {
  cerrarEscaneo('descartado');   // la propuesta anterior quedó sin respuesta
  const id = registrarEscaneo({
    modelo: info.modelo || 'desconocido', clase: label, confianza: info.conf,
    alternativa: info.second, confianzaAlternativa: info.second ? info.secondConf : null,
    dudoso: info.motivos.length > 0, motivo: info.motivos.join('; ') || null, almacenId: ctx.almacen?.id || null,
  }).catch(e => { console.warn('No se pudo registrar el escaneo', e); return null; });
  escaneo = { id, corrigiendo: false };
}
function cerrarEscaneo(resultado, productoId = null) {
  const s = escaneo; escaneo = null;
  if (s) s.id.then(id => id && resolverEscaneo(id, resultado, productoId)).catch(e => console.warn('No se pudo registrar el resultado del escaneo', e));
}
const pct = v => `${Math.round(v * 100)} %`;
// «Es otro producto»: el escaneo sigue pendiente y se guarda como corrección al elegir en el buscador
const botonOtro = () => el('button', { class: 'btn small', type: 'button', text: 'No, es otro producto', onclick: () => {
  if (escaneo) escaneo.corrigiendo = true;
  detectSeq++;
  $('#detBody').replaceChildren(el('p', { class: 'msg', text: 'Busca el producto correcto abajo: quedará registrado como corrección de la cámara.' }));
  const box = $('#manualPick'); box.scrollIntoView({ behavior: 'smooth', block: 'center' }); box.querySelector('input')?.focus({ preventScroll: true });
} });

/* ---------- escáner → producto real ---------- */
let detectSeq = 0;
async function showProductDetail(producto, origen, label = '', lectura = null) {
  const seq = ++detectSeq;
  const body = $('#detBody');
  $('#detected').hidden = false; $('#detected').classList.remove('doubt');
  $('#detLabel').textContent = producto ? producto.nombre : label;
  body.replaceChildren(el('p', { class: 'msg', text: 'Consultando existencias…' }));
  try {
    const vars = await variantesDe(producto.id);
    const stock = vars.length ? await existencias({ almacenId: ctx.almacen.id, productoId: producto.id }) : [];
    if (seq !== detectSeq) return;
    const byVar = new Map(stock.map(s => [s.variante_id, s]));
    const total = stock.reduce((s, r) => s + r.cantidad, 0);
    const canWrite = ['admin', 'operador'].includes(ctx.profile.rol);
    const pregunta = origen === 'camara' && escaneo ? el('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap;margin:8px 0' },
      el('span', { class: 'msg', text: '¿Es el producto correcto?' }),
      el('button', { class: 'btn small primary', type: 'button', text: 'Sí, es correcto', onclick: () => {
        cerrarEscaneo('confirmado', producto.id); pregunta.replaceWith(el('p', { class: 'msg ok', text: '✓ Confirmado' }));
      } }),
      botonOtro()) : null;
    body.replaceChildren(
      el('p', { class: 'muted', text: [producto.modelo && `Modelo ${producto.modelo}`, producto.marcas?.nombre, producto.estado !== 'activo' ? 'Producto inactivo' : '', `${total} u. en ${nombreAlmacen(ctx.almacen)}`].filter(Boolean).join(' · ') }),
      lectura, pregunta,
      origen === 'camara' ? el('p', { class: 'msg', text: 'Confirma que es el producto correcto antes de registrar cualquier movimiento.' }) : null,
      vars.length
        ? el('div', { class: 'var-grid', style: 'margin-top:8px' }, ...vars.map(v => {
          const s = byVar.get(v.id);
          return el('button', { type: 'button', class: 'var-btn' + (v.activo ? '' : ' off'), disabled: !canWrite,
            title: canWrite ? 'Registrar un movimiento de esta variante' : 'Solo consulta',
            // Elegir una variante del producto propuesto equivale a confirmarlo
            onclick: () => { if (origen === 'camara') cerrarEscaneo('confirmado', producto.id); movePrefill = { producto, variante: v, stock: s || null, origen }; setTab('move'); } },
          el('span', { text: nombreVariante(v) }), el('small', { text: `${s ? s.cantidad : 0} u.${s?.ubicacion ? ' · ' + s.ubicacion : ''}` }));
        }))
        : el('p', { class: 'notice', text: 'Este producto no tiene variantes (talla/color) registradas. Un administrador debe crearlas.' }),
      vars.length && canWrite ? el('p', { class: 'msg', text: 'Toca una variante para registrar una entrada, salida o devolución.' }) : null);
  } catch (e) {
    console.error(e);
    if (seq === detectSeq) body.replaceChildren(el('p', { class: 'msg err', text: errText(e) }));
  }
}

async function onDetect(label, info) {
  const seq = ++detectSeq;
  $('#detected').hidden = false; $('#detected').classList.remove('doubt');
  $('#detLabel').textContent = label;
  const body = $('#detBody');
  if (accessBlocker(ctx, openLogin)) { body.replaceChildren(el('p', { text: 'Inicia sesión con una cuenta de personal y elige un almacén para ver el producto vinculado a esta etiqueta.' })); return; }
  abrirEscaneo(label, info);
  body.replaceChildren(el('p', { class: 'msg', text: 'Buscando en el catálogo…' }));
  try {
    const p = await productoPorEtiqueta(label);
    if (seq !== detectSeq) return;
    const lectura = el('p', { class: 'muted', text: `Confianza ${pct(info.conf)}${info.second ? ` · después: «${info.second}» ${pct(info.secondConf)}` : ''}` });
    if (!p) {
      body.replaceChildren(
        el('p', { text: `La etiqueta «${label}» no está vinculada a ningún producto registrado.` }),
        el('p', { class: 'muted', text: 'Búscalo manualmente abajo, o pide a un administrador que registre el producto y le asigne esta etiqueta.' }),
        botonOtro());
      return;
    }
    // Propuesta dudosa: no se muestran variantes hasta que la persona elige el producto
    if (info.motivos.length) {
      const alt = info.second ? await productoPorEtiqueta(info.second).catch(() => null) : null;
      if (seq !== detectSeq) return;
      $('#detected').classList.add('doubt');
      body.replaceChildren(
        el('p', { class: 'notice', text: `Revisa antes de seguir: ${info.motivos.join(', ')}.` }), lectura,
        el('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap;margin-top:8px' },
          el('button', { class: 'btn small primary', type: 'button', text: `Sí, es ${p.nombre}`, onclick: () => { cerrarEscaneo('confirmado', p.id); showProductDetail(p, 'camara'); } }),
          alt && alt.id !== p.id ? el('button', { class: 'btn small', type: 'button', text: `Es ${alt.nombre}`, onclick: () => { cerrarEscaneo('corregido', alt.id); showProductDetail(alt, 'camara'); } }) : null,
          botonOtro()));
      return;
    }
    showProductDetail(p, 'camara', label, lectura);
  } catch (e) {
    console.error(e);
    if (seq === detectSeq) body.replaceChildren(el('p', { class: 'msg err', text: errText(e) }));
  }
}

function mountManualPicker() {
  const box = $('#manualPick');
  const blocked = accessBlocker(ctx, openLogin);
  if (blocked) { box.replaceChildren(el('p', { class: 'msg', text: `No disponible todavía: ${blocked.querySelector('strong')?.textContent || ''}.` })); return; }
  const picker = createPicker({ almacenId: () => ctx.almacen?.id, onSelect: (p, v, s) => {
    // Tras «No, es otro producto» la elección es la corrección; sin esa respuesta, la propuesta queda descartada
    if (escaneo) cerrarEscaneo(escaneo.corrigiendo ? 'corregido' : 'descartado', escaneo.corrigiendo ? p.id : null);
    if (['admin', 'operador'].includes(ctx.profile.rol)) { movePrefill = { producto: p, variante: v, stock: s, origen: 'manual' }; setTab('move'); }
    else showProductDetail(p, 'manual');
  } });
  box.replaceChildren(picker.el);
}

/* ---------- almacén de trabajo ---------- */
function setWarehouse(a) {
  ctx.almacen = a;
  try { if (a) localStorage.setItem(WH_KEY, a.id); } catch (_) {}
  $('#btnWarehouse').textContent = a ? nombreAlmacen(a) : 'Elegir almacén';
}
function openWarehouse() {
  const list = $('#whList');
  if (!ctx.almacenes.length) list.replaceChildren(el('p', { class: 'msg', text: ctx.profile ? 'No hay almacenes activos registrados.' : 'Inicia sesión para ver los almacenes.' }));
  else list.replaceChildren(...ctx.almacenes.map(a => el('button', { class: 'btn block' + (ctx.almacen?.id === a.id ? ' primary' : ''), type: 'button', text: nombreAlmacen(a),
    onclick: () => { setWarehouse(a); $('#dlgWarehouse').close(); mountManualPicker(); refresh(); } })));
  const d = $('#dlgWarehouse'); d.showModal(); d.focus({ preventScroll: true });
}
async function loadWarehouses() {
  ctx.almacenes = []; ctx.almacenesError = null;
  if (!ctx.profile || !ctx.profile.activo) { setWarehouse(null); return; }
  try {
    const m = await maestros();
    ctx.almacenes = m.almacenes.filter(a => a.activo);
    let saved = ''; try { saved = localStorage.getItem(WH_KEY) || ''; } catch (_) {}
    setWarehouse(ctx.almacenes.find(a => a.id === saved) || (ctx.almacenes.length === 1 ? ctx.almacenes[0] : null));
  } catch (e) { ctx.almacenesError = e; setWarehouse(null); }
}

/* ---------- tiempo real (respeta RLS) ---------- */
let channel = null;
const liveRefresh = debounce(() => { if (['stock', 'history'].includes(ctx.tab) && !document.hidden) refresh(); }, 1200);
function subscribeLive() {
  try {
    if (channel) { db().removeChannel(channel); channel = null; }
    if (!ctx.profile || !ctx.profile.activo) return;
    channel = db().channel('almacen-cambios')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'existencias' }, liveRefresh)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'movimientos_inventario' }, liveRefresh)
      .subscribe();
  } catch (e) { console.warn('Realtime no disponible', e); }
}

/* ---------- sesión ---------- */
function openLogin() {
  const signed = !!ctx.session;
  $('#loginForm').hidden = signed; $('#accountView').hidden = !signed;
  if (signed) {
    const p = ctx.profile;
    $('#accountInfo').textContent = `${ctx.session.user.email}${p ? ` · ${ROL_TEXTO[p.rol] || p.rol}${p.activo ? '' : ' (inactivo)'}` : ' · sin acceso de personal'}`;
    $('#lnkAdmin').hidden = !(p && p.activo && p.rol === 'admin');
  } else setMsg($('#loginMsg'), '');
  const d = $('#dlgLogin'); d.showModal(); d.focus({ preventScroll: true });
}

async function onSession(session) {
  ctx.session = session; ctx.profile = null; ctx.profileError = null;
  if (session) {
    try { ctx.profile = await getStaffProfile(session.user.id); } catch (e) { ctx.profileError = e; }
  }
  $('#btnAccount').textContent = session ? (ctx.profile && ctx.profile.nombre || session.user.email) : 'Iniciar sesión';
  // Una cuenta sin rol de personal activo (cliente) no ve el escáner ni las pestañas internas
  const sinAcceso = !!session && !ctx.profileError && (!ctx.profile || !ctx.profile.activo);
  document.body.dataset.acceso = sinAcceso ? 'denegado' : '';
  $('#noAccess').hidden = !sinAcceso;
  if (sinAcceso) {
    if (scannerState.running) stopCamera(false);
    $('#noAccess').replaceChildren(accessBlocker(ctx, openLogin));
  }
  await loadWarehouses();
  subscribeLive();
  mountManualPicker();
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
  const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = dark ? '#0A1628' : '#F3F5F8';
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
  $$('[data-refresh]').forEach(b => b.addEventListener('click', refresh));
  $$('dialog [data-close]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));
  $('#btnDetClose').addEventListener('click', () => { detectSeq++; cerrarEscaneo('descartado'); $('#detected').hidden = true; });
  $('#btnAccount').addEventListener('click', openLogin);
  $('#btnWarehouse').addEventListener('click', openWarehouse);

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
    hooks: { onDetect, onModelStatus: s => { ctx.model = s; } },
  });

  setTab('scan');

  // Base de datos y sesión (independiente del modelo de IA)
  const { client, status } = await initSupabase();
  ctx.db = status;
  initAuth(client, onSession);   // emite la sesión inicial y cada cambio posterior

  // Modelo de IA: si falla, se muestra el error y el resto sigue funcionando
  const param = new URLSearchParams(location.search).get('model');
  if (param && !isLegacy(param)) prefs.customUrl = normalizeUrl(param);
  loadModel(prefs.customUrl || DEFAULT_MODEL).then(ok => {
    if (ok) { if (param) savePrefs(); }
    else if (prefs.customUrl) { prefs.customUrl = ''; savePrefs(); loadModel(DEFAULT_MODEL); }   // si el enlace propio falla, se vuelve al modelo original
  });
}

init();
