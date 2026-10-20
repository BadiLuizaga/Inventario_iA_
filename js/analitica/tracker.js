/* ------------------------------------------------------------------ *
 * Analítica de la tienda (al estilo de Smartlook, sin IA).
 * Registra visitas, clics, clics de furia, desplazamiento, movimiento del
 * ratón (muestreado), errores de JavaScript, eventos de la tienda y una
 * grabación de la sesión con rrweb.
 *  - Solo si el visitante aceptó la analítica y el admin la tiene activa.
 *  - Los campos de formulario se enmascaran siempre (rrweb maskAllInputs) y
 *    el texto de las zonas con datos personales también (.an-enmascarar).
 *  - Si algo falla, la tienda sigue: la analítica nunca interrumpe.
 * ------------------------------------------------------------------ */
import { db, appConfig } from '../supabase.js';

const RRWEB = 'https://cdn.jsdelivr.net/npm/rrweb@2.0.0-alpha.4/dist/record/rrweb-record.min.js';
const INACTIVIDAD = 30 * 60e3;    // una sesión se corta tras 30 min sin actividad
const CADA = 5000;                // envío periódico
const MAX_PARTE = 200000;         // bytes aproximados por parte de grabación
const CLAVE = { consent: 'an:consent', visitante: 'an:v', sesion: 'an:s', parte: 'an:p' };

const S = { activo: false, grabar: false, sesion: null, info: null, cola: [], rr: [], rrBytes: 0, parte: 0, enviando: false,
  timer: 0, stopRec: null, token: null, pagina: null, maxScroll: 0, puntos: [], ultimoPunto: 0, clics: [], errores: 0, nuevaSesion: false };

const ls = { get: k => { try { return localStorage.getItem(k); } catch (_) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* sin almacenamiento */ } } };
const ss = { get: k => { try { return sessionStorage.getItem(k); } catch (_) { return null; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch (_) { /* sin almacenamiento */ } } };
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => (Math.random() * 16 | 0).toString(16)));

/** La analítica está desactivada en esta carga (vista previa del mapa de calor en el panel: ?an=0). */
export const analiticaDesactivada = () => new URLSearchParams(location.search).get('an') === '0';
export const consentimiento = () => ls.get(CLAVE.consent);   // 'si' | 'no' | null

/** Configuración pública (activa / grabar). Sin fila: todo activo. */
export async function configAnalitica() {
  try {
    const { data, error } = await db().from('analitica_config').select('activa, grabar').maybeSingle();
    if (error) throw error;
    return { activa: data ? data.activa : true, grabar: data ? data.grabar : true };
  } catch (_) { return { activa: false, grabar: false }; }   // sin la migración 0005: no se mide
}

export function guardarConsentimiento(valor) {
  ls.set(CLAVE.consent, valor);
  if (valor === 'si') iniciarAnalitica(); else detenerAnalitica();
}

/* ---------- ruta normalizada: #/producto/<uuid> → #/producto/:id ---------- */
export function normalizarRuta(hash = location.hash) {
  const [path] = (hash || '#/').split('?');
  return (path || '#/').replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id').replace(/\/\d+(?=\/|$)/g, '/:id') || '#/';
}

/* ---------- dispositivo, navegador y sistema ---------- */
function dispositivo() {
  const ua = navigator.userAgent, w = Math.min(screen.width || innerWidth, innerWidth);
  if (/iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return 'tablet';
  if (/Mobi|iPhone|Android/i.test(ua) || w < 768) return 'movil';
  if (w < 1024 && navigator.maxTouchPoints > 0) return 'tablet';
  return 'escritorio';
}
function navegador() {
  const ua = navigator.userAgent;
  return /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Otro';
}
function sistema() {
  const ua = navigator.userAgent;
  return /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Otro';
}
function referente() {
  try { const r = new URL(document.referrer); return r.host && r.host !== location.host ? r.host : ''; } catch (_) { return ''; }
}

/* ---------- identificadores ---------- */
function abrirSesion() {
  let v = ls.get(CLAVE.visitante);
  if (!v) { v = uuid(); ls.set(CLAVE.visitante, v); }
  let s = null;
  try { s = JSON.parse(ss.get(CLAVE.sesion) || 'null'); } catch (_) { s = null; }
  S.nuevaSesion = !s || Date.now() - s.ultimo > INACTIVIDAD;
  if (S.nuevaSesion) { s = { id: uuid(), ultimo: Date.now() }; ss.set(CLAVE.parte, '0'); }
  ss.set(CLAVE.sesion, JSON.stringify(s));
  S.sesion = s.id;
  S.parte = Number(ss.get(CLAVE.parte) || 0);
  const q = new URLSearchParams(location.search);
  S.info = { id: s.id, visitante: v, dispositivo: dispositivo(), navegador: navegador(), sistema: sistema(),
    pantalla: `${screen.width}x${screen.height}`, idioma: navigator.language || '', zona: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    referente: referente(), utm_fuente: q.get('utm_source') || '', utm_medio: q.get('utm_medium') || '', utm_campana: q.get('utm_campaign') || '' };
}
function tocarSesion() {
  try {
    const s = JSON.parse(ss.get(CLAVE.sesion) || 'null');
    if (!s || Date.now() - s.ultimo > INACTIVIDAD) { enviar(); reiniciarSesion(); return; }
    s.ultimo = Date.now(); ss.set(CLAVE.sesion, JSON.stringify(s));
  } catch (_) { /* sin almacenamiento */ }
}
function reiniciarSesion() {
  ss.set(CLAVE.sesion, ''); abrirSesion();
  if (S.stopRec) { S.stopRec(); S.stopRec = null; S.rr = []; S.rrBytes = 0; grabar(); }
  pagina();
}

/* ---------- cola de eventos ---------- */
function evento(tipo, extra = {}) {
  if (!S.activo) return;
  S.cola.push({ t: new Date().toISOString(), tipo, ruta: normalizarRuta(), url: (location.hash || '#/').slice(0, 300), ...extra });
  if (S.cola.length >= 80) enviar();
}
/** Evento de la tienda (producto_visto, carrito_agregado, checkout_iniciado, pedido_realizado, busqueda…). */
export function registrarEvento(nombre, datos = null) { evento('personalizado', { nombre, datos }); }

function cerrarPagina() {
  if (!S.pagina) return;
  const alto = document.documentElement.scrollHeight;
  if (S.maxScroll > 0) S.cola.push({ t: new Date().toISOString(), tipo: 'scroll', ruta: S.pagina.ruta, url: S.pagina.url, alto, ancho: innerWidth, datos: { max: Math.round(S.maxScroll * 100) } });
  vaciarPuntos();
}
function pagina() {
  cerrarPagina();
  const p = S.pagina = { ruta: normalizarRuta(), url: (location.hash || '#/').slice(0, 300) };
  S.maxScroll = 0; S.errores = 0;
  // El título y la altura se leen cuando la vista ya se dibujó
  setTimeout(() => { medirScroll(); evento('pagina', { ...p, ancho: innerWidth, alto: document.documentElement.scrollHeight, datos: { titulo: document.title.slice(0, 120) } }); }, 400);
}
function medirScroll() {
  const h = document.documentElement.scrollHeight;
  if (h > 0) S.maxScroll = Math.max(S.maxScroll, Math.min(1, (scrollY + innerHeight) / h));
}
function vaciarPuntos() {
  if (!S.puntos.length || !S.pagina) return;
  S.cola.push({ t: new Date().toISOString(), tipo: 'movimiento', ruta: S.pagina.ruta, url: S.pagina.url, ancho: innerWidth, alto: document.documentElement.scrollHeight, datos: { p: S.puntos } });
  S.puntos = [];
}

/* ---------- clics, furia, movimiento, errores ---------- */
const INTERACTIVO = 'a,button,[role=button],input,select,textarea,label,summary';
function selector(n) {
  const partes = [];
  for (let e = n, i = 0; e && e.nodeType === 1 && i < 4 && e !== document.body; e = e.parentElement, i++) {
    let p = e.tagName.toLowerCase();
    if (e.id) { partes.unshift(`${p}#${e.id}`); break; }
    const cls = [...e.classList].filter(c => !/^(an-|is-|open|show|active)/.test(c)).slice(0, 2);
    if (cls.length) p += '.' + cls.join('.');
    partes.unshift(p);
  }
  return partes.join(' > ').slice(0, 300);
}
function textoDe(n) {
  if (n.closest('.an-enmascarar, .an-bloquear')) return null;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(n.tagName)) return (n.getAttribute('aria-label') || n.getAttribute('placeholder') || n.name || '').slice(0, 120) || null;   // nunca el valor
  return (n.getAttribute('aria-label') || n.innerText || n.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120) || null;
}
function onClick(e) {
  if (!S.activo) return;
  tocarSesion();
  const n = (e.target.closest && e.target.closest(INTERACTIVO)) || e.target;
  if (!n || n.nodeType !== 1) return;
  const doc = document.documentElement;
  const datos = { x: Math.min(1, Math.max(0, e.pageX / Math.max(1, doc.scrollWidth))), y: Math.max(0, Math.round(e.pageY)), ancho: innerWidth, alto: doc.scrollHeight, selector: selector(n), texto: textoDe(n) };
  evento('clic', datos);
  // Clic de furia: 3 o más clics en menos de 800 ms en un radio de 30 px
  const ahora = Date.now();
  S.clics = S.clics.filter(c => ahora - c.t < 800 && Math.hypot(c.x - e.clientX, c.y - e.clientY) < 30);
  S.clics.push({ t: ahora, x: e.clientX, y: e.clientY });
  if (S.clics.length === 3) evento('furia', datos);
}
function onMove(e) {
  if (!S.activo || e.pointerType === 'touch') return;
  const ahora = Date.now();
  if (ahora - S.ultimoPunto < 200) return;
  S.ultimoPunto = ahora;
  S.puntos.push([Math.round(e.pageX / Math.max(1, document.documentElement.scrollWidth) * 1000) / 1000, Math.round(e.pageY)]);
  if (S.puntos.length >= 60) vaciarPuntos();
}
function onError(mensaje, fuente) {
  if (!S.activo || S.errores >= 20) return;
  if (/^(chrome|moz|safari)-extension:|kaspersky/i.test(fuente || '')) return;   // extensiones del navegador: no son de la tienda
  S.errores++;
  evento('error', { texto: String(mensaje || 'Error').slice(0, 120), datos: { mensaje: String(mensaje || '').slice(0, 500), fuente: String(fuente || '').slice(0, 300) } });
}

/* ---------- grabación (rrweb) ---------- */
function cargarRrweb() {
  if (window.rrwebRecord) return Promise.resolve(window.rrwebRecord);
  return new Promise((ok, mal) => {
    const s = document.createElement('script');
    s.src = RRWEB; s.async = true; s.crossOrigin = 'anonymous';
    s.onload = () => (window.rrwebRecord ? ok(window.rrwebRecord) : mal(new Error('rrweb no cargó')));
    s.onerror = () => mal(new Error('rrweb no cargó'));
    document.head.append(s);
  });
}
async function grabar() {
  if (!S.grabar || S.stopRec) return;
  try {
    const record = await cargarRrweb();
    if (!S.activo) return;
    S.stopRec = record({
      emit(ev) { S.rr.push(ev); S.rrBytes += 200; if (ev.type === 2) S.rrBytes += JSON.stringify(ev).length; if (S.rrBytes > MAX_PARTE) enviar(); },
      maskAllInputs: true, maskTextClass: 'an-enmascarar', blockClass: 'an-bloquear',
      sampling: { mousemove: 50, scroll: 150, input: 'last' }, slimDOMOptions: 'all', recordCanvas: false, collectFonts: false, inlineStylesheet: true,
    });
  } catch (e) { console.warn('Grabación no disponible', e); }
}

/* ---------- envío ---------- */
function lote() {
  const ev = S.cola.splice(0, 100);
  let parte = null, rec = null;
  if (S.rr.length) { rec = S.rr; S.rr = []; S.rrBytes = 0; parte = S.parte++; ss.set(CLAVE.parte, String(S.parte)); }
  return { p_sesion: S.info, p_eventos: ev, p_parte: parte, p_grabacion: rec };
}
async function enviar() {
  if (!S.activo || S.enviando || (!S.cola.length && !S.rr.length)) return;
  S.enviando = true;
  const body = lote();
  try {
    const { error } = await db().rpc('analitica_registrar', body);
    if (error) {
      if (/caducada|no válida/.test(error.message)) reiniciarSesion();
      else if (!/Demasiad|máximo/.test(error.message)) S.cola.unshift(...body.p_eventos.slice(0, 50));   // reintento acotado
    }
  } catch (_) { /* sin red: se pierde este lote */ }
  S.enviando = false;
  if (S.cola.length >= 80) enviar();
}
/** Al cerrar (cierra la página) o al ocultar la pestaña: envío con keepalive (límite ~64 KB del navegador). */
function enviarAlSalir(cerrar = true) {
  if (!S.activo) return;
  if (cerrar) { cerrarPagina(); S.pagina = null; }
  if (!S.cola.length && !S.rr.length) return;
  const cfg = appConfig();
  const url = `${(cfg.SUPABASE_URL || '').replace(/\/$/, '')}/rest/v1/rpc/analitica_registrar`;
  const key = cfg.SUPABASE_PUBLISHABLE_KEY || cfg.SUPABASE_ANON_KEY;
  let body = lote();
  let txt = JSON.stringify(body);
  if (txt.length > 60000) { body = { ...body, p_parte: null, p_grabacion: null }; txt = JSON.stringify(body); }
  if (txt.length > 60000) return;
  try {
    fetch(url, { method: 'POST', keepalive: true, headers: { apikey: key, Authorization: `Bearer ${S.token || key}`, 'Content-Type': 'application/json' }, body: txt });
  } catch (_) { /* el navegador no lo permitió */ }
}

/* ---------- inicio / fin ---------- */
let escuchando = false;
export async function iniciarAnalitica() {
  if (S.activo || analiticaDesactivada() || consentimiento() !== 'si') return;
  const cfg = await configAnalitica();
  if (!cfg.activa) return;
  S.activo = true; S.grabar = cfg.grabar;
  abrirSesion();
  try {
    S.token = (await db().auth.getSession()).data.session?.access_token || null;
    db().auth.onAuthStateChange((_e, s) => { S.token = s?.access_token || null; });
  } catch (_) { /* sin sesión */ }
  if (!escuchando) {
    escuchando = true;
    document.addEventListener('click', onClick, true);
    document.addEventListener('pointermove', onMove, { passive: true });
    addEventListener('scroll', () => S.activo && medirScroll(), { passive: true });
    addEventListener('hashchange', () => { if (S.activo) { tocarSesion(); pagina(); } });
    addEventListener('error', e => onError(e.message, `${e.filename || ''}:${e.lineno || ''}`));
    addEventListener('unhandledrejection', e => onError(e.reason?.message || String(e.reason), 'promesa'));
    addEventListener('pagehide', () => enviarAlSalir(true));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') enviarAlSalir(false); });
  }
  pagina();
  grabar();
  S.timer = setInterval(enviar, CADA);
}
export function detenerAnalitica() {
  if (!S.activo) return;
  S.activo = false;
  clearInterval(S.timer);
  if (S.stopRec) { S.stopRec(); S.stopRec = null; }
  S.cola = []; S.rr = []; S.puntos = []; S.pagina = null;
}
