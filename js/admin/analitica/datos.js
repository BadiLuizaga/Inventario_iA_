/* ------------------------------------------------------------------ *
 * Analítica (panel): acceso a datos y piezas comunes.
 * Los datos se leen por páginas de 1000 filas (límite de la API) y se
 * agregan en el navegador; se guardan 60 s en memoria para moverse entre
 * secciones sin volver a descargar.
 * ------------------------------------------------------------------ */
import { el, todayISO, startOfDay, endOfDay } from '../../ui.js';
import { db, unwrap, todasLasFilas } from '../../supabase.js';
import { listarUsuarios } from '../../services/interno.js';

/* ---------- lectura paginada con caché ---------- */
const cache = new Map();
async function memo(clave, fn) {
  const c = cache.get(clave);
  if (c && Date.now() - c.t < 60e3) return c.v;
  const v = await fn();
  cache.set(clave, { t: Date.now(), v });
  return v;
}
export const limpiarCache = () => cache.clear();

/** Todas las filas de una consulta, de 1000 en 1000 (hasta `max`). */
export const todas = todasLasFilas;

const COLS_SESION = 'id, visitante_id, usuario_id, inicio, ultimo, dispositivo, navegador, sistema, pantalla, idioma, zona_horaria, referente, utm_fuente, utm_medio, utm_campana, pagina_entrada, pagina_salida, paginas, eventos, clics, clics_furia, errores, convertida, grabacion_partes';
const COLS_EVENTO = 'sesion_id, creado_en, tipo, ruta, url, nombre, selector, texto';

/** Sesiones iniciadas en el rango (y del dispositivo elegido). */
export function sesiones({ desde, hasta, disp = '' }) {
  return memo(`s|${desde}|${hasta}|${disp}`, () => todas(() => {
    let q = db().from('analitica_sesiones').select(COLS_SESION).gte('inicio', startOfDay(desde)).lte('inicio', endOfDay(hasta)).order('inicio', { ascending: false }).order('id');
    if (disp) q = q.eq('dispositivo', disp);
    return q;
  })).then(rs => rs.map(derivar));
}
/** Eventos del rango. `tipos` limita la descarga; `completo` trae coordenadas y datos (mapas de calor). */
export function eventos({ desde, hasta }, { tipos = null, completo = false, ruta = null } = {}) {
  return memo(`e|${desde}|${hasta}|${tipos}|${completo}|${ruta}`, () => todas(() => {
    let q = db().from('analitica_eventos').select(completo ? COLS_EVENTO + ', x, y, ancho, alto, datos' : COLS_EVENTO)
      .gte('creado_en', startOfDay(desde)).lte('creado_en', endOfDay(hasta)).order('creado_en').order('id');
    if (tipos) q = q.in('tipo', tipos);
    if (ruta) q = q.eq('ruta', ruta);
    return q;
  }, 200000));
}
export const sesion = id => db().from('analitica_sesiones').select(COLS_SESION).eq('id', id).maybeSingle().then(unwrap).then(s => s && derivar(s));
export const eventosDeSesion = id => todas(() => db().from('analitica_eventos').select(COLS_EVENTO + ', x, y, datos').eq('sesion_id', id).order('creado_en').order('id'));
export const sesionesDeVisitante = vid => todas(() => db().from('analitica_sesiones').select(COLS_SESION).eq('visitante_id', vid).order('inicio', { ascending: false }).order('id')).then(rs => rs.map(derivar));
export async function grabacion(id) {
  const partes = await todas(() => db().from('analitica_grabaciones').select('parte, eventos').eq('sesion_id', id).order('parte'));
  return partes.flatMap(p => p.eventos).sort((a, b) => a.timestamp - b.timestamp);
}
export const definiciones = () => memo('defs', () => db().from('analitica_definiciones').select('*').order('nombre').then(unwrap));
export const embudos = () => db().from('analitica_embudos').select('*').order('creado_en').then(unwrap);
export const segmentos = () => db().from('analitica_segmentos').select('*').order('nombre').then(unwrap);
export const notas = id => db().from('analitica_notas').select('*').eq('sesion_id', id).order('creado_en').then(unwrap);
export const configAnalitica = () => db().from('analitica_config').select('*').maybeSingle().then(unwrap);

/** id de usuario → { nombre, email, rol } (para visitantes identificados). */
export const usuarios = () => memo('usuarios', async () => new Map((await listarUsuarios().catch(() => [])).map(u => [u.id, u])));

/* ---------- derivados de una sesión ---------- */
function derivar(s) {
  const dur = Math.max(0, (new Date(s.ultimo) - new Date(s.inicio)) / 1000);
  return { ...s, duracion: dur, rebote: s.paginas <= 1, fuente: fuenteDe(s) };
}
export function fuenteDe(s) {
  if (s.utm_fuente) return `${s.utm_fuente}${s.utm_medio ? ' / ' + s.utm_medio : ''}`;
  if (s.referente) return s.referente;
  return 'Directo';
}

/* ---------- nombres legibles ---------- */
export const DISPOSITIVO = { escritorio: 'Escritorio', tablet: 'Tablet', movil: 'Móvil' };
const PAGINAS = { '#/': 'Inicio', '#/catalogo': 'Catálogo', '#/producto/:id': 'Producto', '#/carrito': 'Carrito', '#/checkout': 'Checkout',
  '#/pedido-ok/:id': 'Pedido realizado', '#/cuenta': 'Mi cuenta', '#/pedidos': 'Mis pedidos', '#/sucursales': 'Sucursales' };
export const nombrePagina = r => PAGINAS[r] ? `${PAGINAS[r]} (${r})` : r || '—';
export const nombreCorto = r => PAGINAS[r] || r || '—';
export const AUTO = { 'auto:pagina': 'Página vista', 'auto:clic': 'Clic', 'auto:furia': 'Clic de furia', 'auto:error': 'Error de JavaScript', 'auto:scroll': 'Desplazamiento' };
export const TIENDA = { producto_visto: 'Vio un producto', carrito_agregado: 'Agregó al carrito', checkout_iniciado: 'Inició el checkout',
  pedido_realizado: 'Hizo un pedido', busqueda: 'Buscó en la tienda', inicio_sesion: 'Inició sesión', registro: 'Creó una cuenta' };

/** Catálogo de eventos para filtros, embudos y la lista de eventos. */
export function catalogo(defs = [], rutas = []) {
  return [
    ...Object.entries(TIENDA).map(([k, label]) => ({ key: `p:${k}`, label, grupo: 'Tienda' })),
    ...Object.entries(AUTO).map(([key, label]) => ({ key, label, grupo: 'Automático' })),
    ...defs.map(d => ({ key: `d:${d.id}`, label: d.nombre, grupo: 'Definido', def: d })),
    ...rutas.map(r => ({ key: `pagina:${r}`, label: `Visitó ${nombrePagina(r)}`, grupo: 'Páginas' })),
  ];
}
export function etiquetaEvento(key, defs = []) {
  if (AUTO[key]) return AUTO[key];
  if (key.startsWith('p:')) return TIENDA[key.slice(2)] || key.slice(2);
  if (key.startsWith('pagina:')) return `Visitó ${nombrePagina(key.slice(7))}`;
  if (key.startsWith('d:')) return defs.find(d => d.id === key.slice(2))?.nombre || 'Evento eliminado';
  return key;
}

/** Patrón según la coincidencia elegida (exacta, contiene o comodín *). */
export function coincideTexto(valor, patron, modo = 'contiene') {
  const v = String(valor ?? '').toLowerCase(), p = String(patron ?? '').toLowerCase().trim();
  if (!p) return false;
  if (modo === 'exacta') return v === p;
  if (modo === 'comodin' || p.includes('*')) return new RegExp('^' + p.split('*').map(x => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$').test(v);
  return v.includes(p);
}
/** ¿El evento crudo `ev` cumple la clave del catálogo? */
export function coincide(key, ev, defs = []) {
  if (key.startsWith('auto:')) return ev.tipo === key.slice(5);
  if (key.startsWith('p:')) return ev.tipo === 'personalizado' && ev.nombre === key.slice(2);
  if (key.startsWith('pagina:')) return ev.tipo === 'pagina' && ev.ruta === key.slice(7);
  if (key.startsWith('d:')) {
    const d = defs.find(x => x.id === key.slice(2));
    if (!d) return false;
    if (d.tipo === 'url') return ev.tipo === 'pagina' && (coincideTexto(ev.url, d.valor, d.coincidencia) || coincideTexto(ev.ruta, d.valor, d.coincidencia));
    if (d.tipo === 'clic_texto') return ev.tipo === 'clic' && coincideTexto(ev.texto, d.valor, d.coincidencia);
    if (d.tipo === 'clic_selector') return ev.tipo === 'clic' && coincideTexto(ev.selector, d.valor, d.coincidencia);
  }
  return false;
}

/* ---------- formato ---------- */
export function fmtDuracion(s) {
  s = Math.round(s || 0);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60), r = s % 60;
  if (m < 60) return `${m} min ${String(r).padStart(2, '0')} s`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}
export const pct = (a, b) => (b ? `${Math.round((a / b) * 1000) / 10} %` : '—');
export const nombreVisitante = (s, us) => {
  const u = s.usuario_id && us?.get(s.usuario_id);
  return u ? (u.nombre || u.email) : `Anónimo ${s.visitante_id.slice(0, 6)}`;
};
export const cuenta = (rows, fn) => { const m = new Map(); for (const r of rows) { const k = fn(r); if (k === null || k === undefined) continue; m.set(k, (m.get(k) || 0) + 1); } return [...m].sort((a, b) => b[1] - a[1]); };

/* ---------- días del rango (hora local) ---------- */
const p2 = n => String(n).padStart(2, '0');
export const ymd = d => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
export function dias(desde, hasta) {
  const out = [], d = new Date(`${desde}T00:00:00`), fin = new Date(`${hasta}T00:00:00`);
  while (d <= fin && out.length < 400) { out.push(ymd(d)); d.setDate(d.getDate() + 1); }
  return out;
}
export const etiquetaDia = k => { const [, m, d] = k.split('-'); return `${d}/${m}`; };

/* ---------- rango y filtro global (fechas + dispositivo) en la URL ---------- */
export function rangoDe(params) {
  const h30 = new Date(); h30.setDate(h30.getDate() - 29);
  return { desde: params.get('desde') || ymd(h30), hasta: params.get('hasta') || todayISO(), disp: params.get('disp') || '' };
}
/** Rango anterior de la misma duración (para comparar). */
export function rangoAnterior({ desde, hasta, disp }) {
  const a = new Date(`${desde}T00:00:00`), b = new Date(`${hasta}T00:00:00`);
  const n = Math.round((b - a) / 864e5) + 1;
  const fin = new Date(a); fin.setDate(fin.getDate() - 1);
  const ini = new Date(fin); ini.setDate(ini.getDate() - (n - 1));
  return { desde: ymd(ini), hasta: ymd(fin), disp };
}
/** Barra común: fechas, dispositivo y extras. `nav(extra)` vuelve a la misma sección con otros parámetros. */
export function barraRango(rango, nav, ...extras) {
  const dIn = el('input', { type: 'date', class: 'input', value: rango.desde, max: todayISO(), 'aria-label': 'Desde' });
  const hIn = el('input', { type: 'date', class: 'input', value: rango.hasta, max: todayISO(), 'aria-label': 'Hasta' });
  const dSel = el('select', { class: 'input', 'aria-label': 'Dispositivo' }, el('option', { value: '', text: 'Todos los dispositivos' }),
    ...Object.entries(DISPOSITIVO).map(([k, v]) => el('option', { value: k, text: v, selected: k === rango.disp })));
  const aplicar = () => nav({ desde: dIn.value || rango.desde, hasta: hIn.value || rango.hasta, disp: dSel.value });
  [dIn, hIn, dSel].forEach(i => i.addEventListener('change', aplicar));
  const atajo = (txt, n) => el('button', { class: 'btn small ghost', type: 'button', text: txt, onclick: () => { const d = new Date(); d.setDate(d.getDate() - (n - 1)); nav({ desde: ymd(d), hasta: todayISO(), disp: dSel.value }); } });
  return el('div', { class: 'an-rango' }, dIn, el('span', { class: 'muted', text: '→' }), hIn, dSel,
    el('div', { class: 'an-atajos' }, atajo('Hoy', 1), atajo('7 días', 7), atajo('30 días', 30), atajo('90 días', 90)), ...extras);
}

/* ---------- gráfico de columnas (SVG, una o dos series) ---------- */
export function columnas(etiquetas, series, { alto = 180, fmt = v => String(v) } = {}) {
  const max = Math.max(1, ...series.flatMap(s => s.valores));
  const n = etiquetas.length, W = 1000, H = alto, ancho = (W - 10) / Math.max(1, n), barra = Math.max(2, (ancho * 0.75) / series.length);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'an-cols'); svg.setAttribute('role', 'img');
  svg.setAttribute('preserveAspectRatio', 'none');
  for (const f of [0.25, 0.5, 0.75, 1]) {
    const l = document.createElementNS(ns, 'line');
    l.setAttribute('x1', 0); l.setAttribute('x2', W); l.setAttribute('y1', H - H * f); l.setAttribute('y2', H - H * f); l.setAttribute('class', 'grid');
    svg.append(l);
  }
  etiquetas.forEach((et, i) => {
    series.forEach((s, j) => {
      const v = s.valores[i] || 0, h = (v / max) * (H - 8);
      const r = document.createElementNS(ns, 'rect');
      r.setAttribute('x', 5 + i * ancho + (ancho - barra * series.length) / 2 + j * barra); r.setAttribute('width', barra - 1);
      r.setAttribute('y', H - h); r.setAttribute('height', Math.max(0, h)); r.setAttribute('class', s.clase || '');
      const t = document.createElementNS(ns, 'title'); t.textContent = `${et} · ${s.nombre}: ${fmt(v)}`; r.append(t);
      svg.append(r);
    });
  });
  // Las fechas van en HTML: el SVG se estira al ancho de la tarjeta y deformaría el texto
  const salto = Math.ceil(n / 8);
  const eje = el('div', { class: 'an-cols-eje', style: `grid-template-columns:repeat(${Math.max(1, n)},1fr)` },
    ...etiquetas.map((et, i) => el('span', { text: i % salto === 0 ? et : '' })));
  return el('div', { class: 'an-cols-wrap' }, svg, eje, el('div', { class: 'an-cols-max muted', text: `máx. ${fmt(max)}` }));
}

/** Indicador con variación respecto del período anterior. `menosEsMejor` invierte el color. */
export function kpi(label, valor, previo = null, { fmt = v => String(v), menosEsMejor = false, ayuda = '' } = {}) {
  let delta = null;
  if (previo !== null && previo !== undefined && Number.isFinite(previo)) {
    const d = previo ? ((valor - previo) / previo) * 100 : (valor ? 100 : 0);
    const bueno = menosEsMejor ? d <= 0 : d >= 0;
    delta = el('small', { class: 'an-delta ' + (Math.abs(d) < 0.5 ? '' : bueno ? 'up' : 'down'), title: `Período anterior: ${fmt(previo)}`, text: `${d > 0 ? '▲' : d < 0 ? '▼' : '='} ${Math.abs(Math.round(d))} %` });
  }
  return el('div', { class: 'kpi', title: ayuda || null }, el('span', { text: label }), el('strong', { text: fmt(valor) }), delta);
}

/** Paso de sesiones de una sección a la lista (embudos, errores): ids en sessionStorage. */
export function verSesiones(go, ids, titulo, rango) {
  try { sessionStorage.setItem('an:lista', JSON.stringify({ ids: [...new Set(ids)].slice(0, 5000), titulo })); } catch (_) { /* sin almacenamiento */ }
  go('#/analitica/sesiones?' + new URLSearchParams({ desde: rango.desde, hasta: rango.hasta, disp: rango.disp || '', lista: '1' }));
}

/** replaceChildren sin «null»: filtra los hijos vacíos (también en listas anidadas). */
export const poner = (nodo, ...hijos) => nodo.replaceChildren(...hijos.flat(Infinity).filter(h => h !== null && h !== undefined && h !== false && h !== ''));
