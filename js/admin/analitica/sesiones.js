/* Analítica: sesiones (lista con filtros y segmentos), reproductor de grabaciones y visitantes. */
import { el, emptyState, loading, fmtDate, snack, errText, confirmDialog } from '../../ui.js';
import { db, unwrap } from '../../supabase.js';
import { dataTable, downloadCsv, tarjeta, formDialog } from '../util.js';
import { poner, sesiones, eventos, sesion, eventosDeSesion, sesionesDeVisitante, grabacion, definiciones, segmentos, notas, usuarios,
  rangoDe, barraRango, catalogo, coincide, coincideTexto, etiquetaEvento, nombrePagina, nombreCorto, fmtDuracion, nombreVisitante, cuenta,
  DISPOSITIVO, TIENDA } from './datos.js';
import { errorAnalitica } from './tablero.js';

const PLAYER_JS = 'https://cdn.jsdelivr.net/npm/rrweb-player@1.0.0-alpha.4/dist/index.js';
const PLAYER_CSS = 'https://cdn.jsdelivr.net/npm/rrweb-player@1.0.0-alpha.4/dist/style.css';

/* Filtros de sesión que viajan en la URL (y se guardan como segmento) */
const FILTROS = ['navegador', 'sistema', 'fuente', 'url', 'evento', 'sin_evento', 'furia', 'errores', 'convertida', 'identificada', 'grabada', 'dur_min', 'pag_min', 'visitante'];

const insignias = s => el('span', { class: 'an-badges' },
  s.convertida ? el('span', { class: 'tag ok', text: 'Pedido' }) : null,
  s.clics_furia ? el('span', { class: 'tag warn', text: `Furia ${s.clics_furia}` }) : null,
  s.errores ? el('span', { class: 'tag err', text: `Errores ${s.errores}` }) : null,
  s.usuario_id ? el('span', { class: 'tag', text: 'Identificada' }) : null);

/* =================================================================== *
 * Lista de sesiones
 * =================================================================== */
export async function renderSesiones(main, go, params) {
  const rango = rangoDe(params);
  const f = Object.fromEntries(FILTROS.map(k => [k, params.get(k) || '']));
  const lista = params.get('lista') === '1' ? (() => { try { return JSON.parse(sessionStorage.getItem('an:lista') || 'null'); } catch (_) { return null; } })() : null;
  const nav = extra => go('#/analitica/sesiones?' + new URLSearchParams(Object.entries({ ...rango, ...f, ...extra }).filter(([, v]) => v !== '' && v !== null && v !== undefined)));
  const out = el('div', { class: 'stack' }, loading('Buscando sesiones…'));
  const segBox = el('div', { class: 'an-chips' });
  const panel = el('div', { class: 'card stack' });
  poner(main, el('div', { class: 'page-head' }, el('h2', { text: 'Sesiones' })), barraRango(rango, nav), segBox, panel, out);

  try {
    const [ss, defs, us, segs] = await Promise.all([sesiones(rango), definiciones(), usuarios(), segmentos().catch(() => [])]);
    const necesitaEventos = f.url || f.evento || f.sin_evento;
    const evs = necesitaEventos ? await eventos(rango, { tipos: ['pagina', 'clic', 'furia', 'error', 'personalizado', 'scroll'] }) : [];
    const rutas = [...new Set(evs.filter(e => e.tipo === 'pagina').map(e => e.ruta))].sort();
    const cat = catalogo(defs, rutas);

    // Segmentos guardados
    poner(segBox, el('span', { class: 'muted', text: 'Segmentos:' }),
      ...segs.map(s => el('span', { class: 'chip-seg' },
        el('button', { type: 'button', class: 'chip', text: s.nombre, onclick: () => go('#/analitica/sesiones?' + new URLSearchParams({ ...rango, ...s.filtro })) }),
        el('button', { type: 'button', class: 'chip-x', 'aria-label': `Borrar segmento ${s.nombre}`, text: '×', onclick: async () => {
          if (!(await confirmDialog({ title: `¿Borrar el segmento «${s.nombre}»?`, ok: 'Borrar', danger: true }))) return;
          try { unwrap(await db().from('analitica_segmentos').delete().eq('id', s.id)); snack('Segmento borrado'); renderSesiones(main, go, params); } catch (e) { snack(errText(e), 'err'); }
        } }))),
      segs.length ? null : el('span', { class: 'muted', text: 'ninguno todavía' }));

    // Panel de filtros
    const opts = (vals, actual, todos) => [el('option', { value: '', text: todos }), ...vals.map(v => el('option', { value: v, text: v, selected: v === actual }))];
    const I = {
      navegador: el('select', { class: 'input' }, ...opts([...new Set(ss.map(s => s.navegador).filter(Boolean))].sort(), f.navegador, 'Todos los navegadores')),
      sistema: el('select', { class: 'input' }, ...opts([...new Set(ss.map(s => s.sistema).filter(Boolean))].sort(), f.sistema, 'Todos los sistemas')),
      fuente: el('select', { class: 'input' }, ...opts([...new Set(ss.map(s => s.fuente))].sort(), f.fuente, 'Todas las fuentes')),
      url: el('input', { class: 'input', value: f.url, placeholder: 'Visitó la URL… (admite *)' }),
      evento: el('select', { class: 'input' }, el('option', { value: '', text: 'Hizo el evento…' }), ...cat.map(c => el('option', { value: c.key, text: `${c.grupo}: ${c.label}`, selected: c.key === f.evento }))),
      sin_evento: el('select', { class: 'input' }, el('option', { value: '', text: 'No hizo el evento…' }), ...cat.map(c => el('option', { value: c.key, text: `${c.grupo}: ${c.label}`, selected: c.key === f.sin_evento }))),
      dur_min: el('input', { class: 'input', type: 'number', min: '0', value: f.dur_min, placeholder: 'Duración mín. (s)' }),
      pag_min: el('input', { class: 'input', type: 'number', min: '0', value: f.pag_min, placeholder: 'Páginas mín.' }),
    };
    const chk = (k, t) => { const c = el('input', { type: 'checkbox', checked: f[k] === '1' }); I[k] = c; return el('label', {}, c, t); };
    const leer = () => Object.fromEntries(FILTROS.map(k => [k, I[k] ? (I[k].type === 'checkbox' ? (I[k].checked ? '1' : '') : I[k].value.trim()) : f[k]]));
    poner(panel, 
      el('div', { class: 'an-filtros' }, I.navegador, I.sistema, I.fuente, I.url, I.evento, I.sin_evento, I.dur_min, I.pag_min),
      el('div', { class: 'check-grid' }, chk('convertida', 'Con pedido'), chk('furia', 'Con clics de furia'), chk('errores', 'Con errores'), chk('identificada', 'Identificadas'), chk('grabada', 'Con grabación')),
      el('div', { class: 'actions' },
        el('button', { class: 'btn primary small', type: 'button', text: 'Aplicar filtros', onclick: () => nav(leer()) }),
        el('button', { class: 'btn small', type: 'button', text: 'Limpiar', onclick: () => go('#/analitica/sesiones?' + new URLSearchParams(rango)) }),
        el('button', { class: 'btn small', type: 'button', text: 'Guardar como segmento', onclick: async () => {
          const filtro = Object.fromEntries(Object.entries(leer()).filter(([, v]) => v));
          if (!Object.keys(filtro).length && !rango.disp) { snack('Elige al menos un filtro', 'err'); return; }
          if (rango.disp) filtro.disp = rango.disp;
          await formDialog({ title: 'Guardar segmento', fields: [{ k: 'nombre', label: 'Nombre', required: true, max: 80 }],
            onSubmit: async v => unwrap(await db().from('analitica_segmentos').insert({ nombre: v.nombre, filtro })) });
          renderSesiones(main, go, params);
        } })));

    // Aplicar filtros
    const porSesion = new Map();
    for (const e of evs) { const a = porSesion.get(e.sesion_id) || []; a.push(e); porSesion.set(e.sesion_id, a); }
    const idsLista = lista ? new Set(lista.ids) : null;
    const filas = ss.filter(s =>
      (!idsLista || idsLista.has(s.id)) &&
      (!f.navegador || s.navegador === f.navegador) && (!f.sistema || s.sistema === f.sistema) && (!f.fuente || s.fuente === f.fuente) &&
      (!f.visitante || s.visitante_id === f.visitante) &&
      (!f.convertida || s.convertida) && (!f.furia || s.clics_furia > 0) && (!f.errores || s.errores > 0) &&
      (!f.identificada || s.usuario_id) && (!f.grabada || s.grabacion_partes > 0) &&
      (!f.dur_min || s.duracion >= Number(f.dur_min)) && (!f.pag_min || s.paginas >= Number(f.pag_min)) &&
      (!f.url || (porSesion.get(s.id) || []).some(e => e.tipo === 'pagina' && (coincideTexto(e.url, f.url) || coincideTexto(e.ruta, f.url)))) &&
      (!f.evento || (porSesion.get(s.id) || []).some(e => coincide(f.evento, e, defs))) &&
      (!f.sin_evento || !(porSesion.get(s.id) || []).some(e => coincide(f.sin_evento, e, defs))));

    const cols = [
      { label: 'Inicio', value: s => fmtDate(s.inicio) },
      { label: 'Visitante', value: s => el('a', { href: `#/analitica/visitante/${s.visitante_id}`, text: nombreVisitante(s, us) }), csv: s => nombreVisitante(s, us) },
      { label: 'Dispositivo', value: s => `${DISPOSITIVO[s.dispositivo]} · ${s.navegador || '—'} · ${s.sistema || '—'}` },
      { label: 'Fuente', value: s => s.fuente },
      { label: 'Páginas', value: s => s.paginas, num: true },
      { label: 'Duración', value: s => fmtDuracion(s.duracion), csv: s => Math.round(s.duracion) },
      { label: 'Recorrido', value: s => `${nombreCorto(s.pagina_entrada)} → ${nombreCorto(s.pagina_salida)}` },
      { label: 'Señales', value: s => insignias(s), csv: s => [s.convertida && 'pedido', s.clics_furia && 'furia', s.errores && 'errores'].filter(Boolean).join(' ') },
      { label: '', value: s => el('a', { class: 'btn small' + (s.grabacion_partes ? ' primary' : ''), href: `#/analitica/sesion/${s.id}`, text: s.grabacion_partes ? '▶ Ver' : 'Detalle' }), csv: s => s.id },
    ];
    let mostrar = 100;
    const tabla = el('div');
    const pintar = () => poner(tabla, dataTable(cols, filas.slice(0, mostrar)),
      filas.length > mostrar ? el('button', { class: 'btn small', type: 'button', text: `Ver más (${filas.length - mostrar} restantes)`, onclick: () => { mostrar += 200; pintar(); } }) : null);
    pintar();
    poner(out, 
      lista ? el('p', { class: 'notice' }, `Mostrando: ${lista.titulo}. `, el('a', { href: '#/analitica/sesiones?' + new URLSearchParams(rango), text: 'Quitar' })) : null,
      el('div', { class: 'row between' },
        el('p', { class: 'muted', text: `${filas.length} de ${ss.length} sesiones · ${filas.filter(s => s.grabacion_partes).length} con grabación · ${new Set(filas.map(s => s.visitante_id)).size} visitantes` }),
        el('button', { class: 'btn small', type: 'button', text: 'Descargar CSV', onclick: () => downloadCsv(`sesiones-${rango.desde}-a-${rango.hasta}.csv`, cols, filas) })),
      filas.length ? tabla : emptyState({ icon: 'search', title: 'Ninguna sesión cumple los filtros', text: 'Prueba con otro período o quita algún filtro.' }));
  } catch (e) { console.error(e); poner(out, errorAnalitica(e)); }
}

/* =================================================================== *
 * Reproductor de una sesión
 * =================================================================== */
function cargarPlayer() {
  if (!document.querySelector(`link[href="${PLAYER_CSS}"]`)) document.head.append(el('link', { rel: 'stylesheet', href: PLAYER_CSS }));
  if (window.rrwebPlayer) return Promise.resolve(window.rrwebPlayer);
  return new Promise((ok, mal) => {
    const s = el('script', { src: PLAYER_JS, crossorigin: 'anonymous' });
    s.onload = () => (window.rrwebPlayer ? ok(window.rrwebPlayer) : mal(new Error('El reproductor no cargó')));
    s.onerror = () => mal(new Error('El reproductor no cargó (sin conexión al CDN)'));
    document.head.append(s);
  });
}
const ICONO_EV = { pagina: '📄', clic: '👆', furia: '😡', error: '⚠️', personalizado: '⭐', scroll: '↕️' };
function describir(e, defs) {
  if (e.tipo === 'pagina') return `Abrió ${nombrePagina(e.ruta)}`;
  if (e.tipo === 'clic') return `Clic en «${e.texto || e.selector || 'elemento'}»`;
  if (e.tipo === 'furia') return `Clics de furia en «${e.texto || e.selector || 'elemento'}»`;
  if (e.tipo === 'error') return `Error: ${e.texto || 'JavaScript'}`;
  if (e.tipo === 'scroll') return `Bajó hasta el ${e.datos?.max ?? '?'} % de la página`;
  if (e.tipo === 'personalizado') return `${TIENDA[e.nombre] || e.nombre}${e.datos?.producto ? ` · ${e.datos.producto}` : ''}${e.datos?.q ? ` · «${e.datos.q}»` : ''}`;
  return etiquetaEvento(e.tipo, defs);
}

export async function renderSesion(main, go, id) {
  poner(main, loading('Cargando la sesión…'));
  try {
    const [s, evs, defs, us] = await Promise.all([sesion(id), eventosDeSesion(id), definiciones(), usuarios()]);
    if (!s) { poner(main, emptyState({ icon: 'search', title: 'Sesión no encontrada', text: 'Puede haberse borrado por la retención de datos.' })); return; }
    const vecinas = await sesionesDeVisitante(s.visitante_id);
    const i = vecinas.findIndex(x => x.id === id);
    const anterior = vecinas[i + 1], siguiente = vecinas[i - 1];
    const lugar = el('div', { class: 'an-player' }, loading('Preparando la grabación…'));
    const lineaTiempo = el('ol', { class: 'an-timeline' });
    const notaBox = el('div', { class: 'stack' });
    let player = null, t0 = Math.min(new Date(s.inicio).getTime(), evs.length ? new Date(evs[0].creado_en).getTime() : Infinity);

    poner(lineaTiempo, ...evs.filter(e => e.tipo !== 'movimiento').map(e => el('li', {},
      el('button', { type: 'button', title: 'Ir a este momento', onclick: () => { if (player) player.goto(Math.max(0, new Date(e.creado_en).getTime() - t0), true); } },
        el('span', { class: 'ico', text: ICONO_EV[e.tipo] || '•' }),
        el('span', { class: 'txt', text: describir(e, defs) }),
        el('time', { text: fmtDuracion((new Date(e.creado_en).getTime() - t0) / 1000) })))));

    const pintarNotas = async () => {
      const ns = await notas(id).catch(() => []);
      const txt = el('textarea', { class: 'input', maxlength: '1000', rows: '2', placeholder: 'Escribe una nota para el equipo…' });
      poner(notaBox, 
        ...ns.map(n => el('div', { class: 'an-nota' }, el('p', { text: n.texto }), el('small', { class: 'muted', text: `${us.get(n.autor)?.nombre || 'Admin'} · ${fmtDate(n.creado_en)}` }),
          el('button', { class: 'btn small ghost', type: 'button', text: 'Borrar', onclick: async () => { unwrap(await db().from('analitica_notas').delete().eq('id', n.id)); pintarNotas(); } }))),
        txt, el('button', { class: 'btn small primary', type: 'button', text: 'Guardar nota', onclick: async () => {
          if (!txt.value.trim()) return;
          try { unwrap(await db().from('analitica_notas').insert({ sesion_id: id, texto: txt.value.trim() })); pintarNotas(); } catch (e) { snack(errText(e), 'err'); }
        } }));
    };

    const info = [
      ['Visitante', el('a', { href: `#/analitica/visitante/${s.visitante_id}`, text: nombreVisitante(s, us) })],
      ['Inicio', fmtDate(s.inicio)], ['Duración', fmtDuracion(s.duracion)], ['Páginas', s.paginas], ['Clics', s.clics],
      ['Dispositivo', DISPOSITIVO[s.dispositivo]], ['Navegador', s.navegador], ['Sistema', s.sistema], ['Pantalla', s.pantalla],
      ['Idioma', s.idioma], ['Zona horaria', s.zona_horaria], ['Fuente', s.fuente], ['Entrada', nombrePagina(s.pagina_entrada)], ['Salida', nombrePagina(s.pagina_salida)],
    ];
    poner(main, 
      el('div', { class: 'page-head' },
        el('div', {}, el('a', { href: '#/analitica/sesiones', text: '← Sesiones' }), el('h2', { text: `Sesión de ${nombreVisitante(s, us)}` }), insignias(s)),
        el('div', { class: 'actions' },
          anterior ? el('a', { class: 'btn small', href: `#/analitica/sesion/${anterior.id}`, text: '← Anterior del visitante' }) : null,
          siguiente ? el('a', { class: 'btn small', href: `#/analitica/sesion/${siguiente.id}`, text: 'Siguiente del visitante →' }) : null,
          el('button', { class: 'btn small', type: 'button', text: 'Copiar enlace', onclick: async () => {
            try { await navigator.clipboard.writeText(location.href); snack('Enlace copiado (solo lo abren administradores)'); } catch (_) { snack(location.href); }
          } }))),
      el('div', { class: 'an-sesion' }, lugar,
        el('aside', { class: 'stack' },
          tarjeta('Línea de tiempo', 'Toca un evento para ir a ese momento.', lineaTiempo),
          tarjeta('Información', null, el('dl', { class: 'an-info' }, ...info.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', {}, v ?? '—')]))),
          tarjeta('Notas', null, notaBox))));
    pintarNotas();

    if (!s.grabacion_partes) {
      poner(lugar, emptyState({ icon: 'chart', title: 'Esta sesión no tiene grabación', text: 'La grabación estaba apagada o el navegador no la permitió. La línea de tiempo muestra lo que hizo el visitante.' }));
      return;
    }
    const [Player, rec] = await Promise.all([cargarPlayer(), grabacion(id)]);
    if (rec.length < 2) { poner(lugar, emptyState({ icon: 'chart', title: 'Grabación incompleta', text: 'Llegaron muy pocos datos de esta sesión.' })); return; }
    t0 = rec[0].timestamp;
    const meta = rec.find(e => e.type === 4)?.data || { width: 1280, height: 800 };
    const ancho = Math.max(320, lugar.clientWidth - 2);
    const alto = Math.min(640, Math.round(ancho * (meta.height / Math.max(1, meta.width))));
    poner(lugar, );
    player = new Player({ target: lugar, props: { events: rec, width: ancho, height: alto, autoPlay: false, skipInactive: true, showController: true, speedOption: [1, 2, 4, 8], mouseTail: { strokeStyle: '#1F5FBF' } } });
  } catch (e) { console.error(e); poner(main, errorAnalitica(e)); }
}

/* =================================================================== *
 * Visitantes
 * =================================================================== */
export async function renderVisitantes(main, go, params) {
  const rango = rangoDe(params);
  const q = params.get('q') || '';
  const nav = extra => go('#/analitica/visitantes?' + new URLSearchParams({ ...rango, q, ...extra }));
  const buscar = el('input', { class: 'input', type: 'search', value: q, placeholder: 'Buscar por nombre, correo o identificador' });
  buscar.addEventListener('change', () => nav({ q: buscar.value.trim() }));
  const out = el('div', { class: 'stack' }, loading());
  poner(main, el('div', { class: 'page-head' }, el('h2', { text: 'Visitantes' })), barraRango(rango, nav, buscar), out);
  try {
    const [ss, us] = await Promise.all([sesiones(rango), usuarios()]);
    const m = new Map();
    for (const s of ss) {
      const v = m.get(s.visitante_id) || { id: s.visitante_id, usuario: null, sesiones: 0, paginas: 0, tiempo: 0, primera: s.inicio, ultima: s.inicio, disp: new Set(), pedidos: 0, furia: 0, ref: s };
      v.sesiones++; v.paginas += s.paginas; v.tiempo += s.duracion; v.disp.add(DISPOSITIVO[s.dispositivo]); if (s.convertida) v.pedidos++; v.furia += s.clics_furia;
      if (s.inicio < v.primera) v.primera = s.inicio; if (s.inicio > v.ultima) v.ultima = s.inicio;
      if (s.usuario_id) { v.usuario = s.usuario_id; v.ref = s; }
      m.set(s.visitante_id, v);
    }
    let filas = [...m.values()].sort((a, b) => b.ultima.localeCompare(a.ultima));
    if (q) filas = filas.filter(v => coincideTexto(`${nombreVisitante(v.ref, us)} ${us.get(v.usuario)?.email || ''} ${v.id}`, q));
    const cols = [
      { label: 'Visitante', value: v => el('a', { href: `#/analitica/visitante/${v.id}`, text: nombreVisitante(v.ref, us) }), csv: v => nombreVisitante(v.ref, us) },
      { label: 'Correo', value: v => us.get(v.usuario)?.email || '—' },
      { label: 'Sesiones', value: v => v.sesiones, num: true }, { label: 'Páginas', value: v => v.paginas, num: true },
      { label: 'Tiempo total', value: v => fmtDuracion(v.tiempo), csv: v => Math.round(v.tiempo) },
      { label: 'Dispositivos', value: v => [...v.disp].join(', ') },
      { label: 'Sesiones con pedido', value: v => v.pedidos, num: true },
      { label: 'Primera visita', value: v => fmtDate(v.primera) }, { label: 'Última visita', value: v => fmtDate(v.ultima) },
    ];
    poner(out, 
      el('div', { class: 'kpi-grid' },
        el('div', { class: 'kpi' }, el('span', { text: 'Visitantes' }), el('strong', { text: String(filas.length) })),
        el('div', { class: 'kpi' }, el('span', { text: 'Identificados' }), el('strong', { text: String(filas.filter(v => v.usuario).length) })),
        el('div', { class: 'kpi' }, el('span', { text: 'Recurrentes (2+ sesiones)' }), el('strong', { text: String(filas.filter(v => v.sesiones > 1).length) })),
        el('div', { class: 'kpi' }, el('span', { text: 'Compraron' }), el('strong', { text: String(filas.filter(v => v.pedidos).length) }))),
      el('p', { class: 'muted', text: 'Un visitante es un navegador. Se identifica cuando inicia sesión en la tienda.' }),
      el('div', { class: 'actions' }, el('button', { class: 'btn small', type: 'button', text: 'Descargar CSV', onclick: () => downloadCsv(`visitantes-${rango.desde}-a-${rango.hasta}.csv`, cols, filas) })),
      filas.length ? dataTable(cols, filas.slice(0, 500)) : emptyState({ icon: 'user', title: 'Sin visitantes en este período' }));
  } catch (e) { console.error(e); poner(out, errorAnalitica(e)); }
}

export async function renderVisitante(main, go, vid) {
  poner(main, loading());
  try {
    const [ss, us] = await Promise.all([sesionesDeVisitante(vid), usuarios()]);
    if (!ss.length) { poner(main, emptyState({ icon: 'user', title: 'Visitante sin sesiones', text: 'Sus datos pueden haberse borrado por la retención.' })); return; }
    const ref = ss.find(s => s.usuario_id) || ss[0];
    const u = ref.usuario_id && us.get(ref.usuario_id);
    const evs = (await Promise.all(ss.slice(0, 30).map(s => eventosDeSesion(s.id)))).flat();
    const tienda = cuenta(evs.filter(e => e.tipo === 'personalizado'), e => TIENDA[e.nombre] || e.nombre);
    const productos = cuenta(evs.filter(e => e.nombre === 'producto_visto'), e => e.datos?.producto);
    poner(main, 
      el('div', { class: 'page-head' }, el('div', {}, el('a', { href: '#/analitica/visitantes', text: '← Visitantes' }), el('h2', { text: nombreVisitante(ref, us) }),
        el('p', { class: 'muted', text: u ? `${u.email} · cuenta ${u.rol ? 'del personal' : 'de cliente'}` : `Anónimo · ${vid}` }))),
      el('div', { class: 'kpi-grid' },
        el('div', { class: 'kpi' }, el('span', { text: 'Sesiones' }), el('strong', { text: String(ss.length) })),
        el('div', { class: 'kpi' }, el('span', { text: 'Páginas' }), el('strong', { text: String(ss.reduce((a, s) => a + s.paginas, 0)) })),
        el('div', { class: 'kpi' }, el('span', { text: 'Tiempo total' }), el('strong', { text: fmtDuracion(ss.reduce((a, s) => a + s.duracion, 0)) })),
        el('div', { class: 'kpi' }, el('span', { text: 'Sesiones con pedido' }), el('strong', { text: String(ss.filter(s => s.convertida).length) })),
        el('div', { class: 'kpi' }, el('span', { text: 'Primera visita' }), el('strong', { class: 'small', text: fmtDate(ss[ss.length - 1].inicio, false) }))),
      el('div', { class: 'an-grid' },
        tarjeta('Lo que hizo en la tienda', null, tienda.length ? dataTable([{ label: 'Evento', value: x => x[0] }, { label: 'Veces', value: x => x[1], num: true }], tienda) : el('p', { class: 'muted', text: 'Sin eventos de la tienda.' })),
        tarjeta('Productos que vio', null, productos.length ? dataTable([{ label: 'Producto', value: x => x[0] }, { label: 'Veces', value: x => x[1], num: true }], productos.slice(0, 15)) : el('p', { class: 'muted', text: 'Ninguno.' }))),
      tarjeta('Sesiones', null, dataTable([
        { label: 'Inicio', value: s => fmtDate(s.inicio) }, { label: 'Dispositivo', value: s => `${DISPOSITIVO[s.dispositivo]} · ${s.navegador || ''}` },
        { label: 'Páginas', value: s => s.paginas, num: true }, { label: 'Duración', value: s => fmtDuracion(s.duracion) },
        { label: 'Recorrido', value: s => `${nombreCorto(s.pagina_entrada)} → ${nombreCorto(s.pagina_salida)}` }, { label: 'Señales', value: s => insignias(s) },
        { label: '', value: s => el('a', { class: 'btn small' + (s.grabacion_partes ? ' primary' : ''), href: `#/analitica/sesion/${s.id}`, text: s.grabacion_partes ? '▶ Ver' : 'Detalle' }) },
      ], ss)));
  } catch (e) { console.error(e); poner(main, errorAnalitica(e)); }
}
