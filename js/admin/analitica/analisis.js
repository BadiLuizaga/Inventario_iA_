/* Analítica: eventos (automáticos, de la tienda y definidos por el admin), embudos, recorridos y retención. */
import { el, emptyState, loading, snack, errText, confirmDialog } from '../../ui.js';
import { db, unwrap } from '../../supabase.js';
import { dataTable, downloadCsv, tarjeta, formDialog } from '../util.js';
import { poner, sesiones, eventos, definiciones, embudos, rangoDe, barraRango, catalogo, coincide, etiquetaEvento, nombrePagina, nombreCorto,
  columnas, dias, ymd, etiquetaDia, cuenta, pct, fmtDuracion, verSesiones, limpiarCache, DISPOSITIVO } from './datos.js';
import { errorAnalitica } from './tablero.js';

const TIPOS_DEF = [{ value: 'url', text: 'Visitó una URL' }, { value: 'clic_texto', text: 'Clic en un texto' }, { value: 'clic_selector', text: 'Clic en un elemento (selector CSS)' }];
const MODOS = [{ value: 'contiene', text: 'Contiene' }, { value: 'exacta', text: 'Es exactamente' }, { value: 'comodin', text: 'Patrón con *' }];

/** Eventos crudos de las sesiones del rango (respetando el filtro de dispositivo). */
async function base(rango, tipos) {
  const ss = await sesiones(rango);
  const ids = new Set(ss.map(s => s.id));
  const evs = (await eventos(rango, { tipos })).filter(e => ids.has(e.sesion_id));
  const porSesion = new Map();
  for (const e of evs) { const a = porSesion.get(e.sesion_id) || []; a.push(e); porSesion.set(e.sesion_id, a); }
  return { ss, evs, porSesion, sesionPorId: new Map(ss.map(s => [s.id, s])) };
}

async function nuevoEvento(valores = {}) {
  const r = await formDialog({ title: 'Nuevo evento', values: { coincidencia: 'contiene', ...valores }, submit: 'Crear evento', fields: [
    { k: 'nombre', label: 'Nombre del evento', required: true, max: 80 },
    { k: 'tipo', label: 'Tipo', type: 'select', required: true, options: TIPOS_DEF },
    { k: 'valor', label: 'Valor', required: true, max: 300, help: 'Una URL (p. ej. #/carrito), un texto de botón o un selector CSS. Se aplica también a las visitas ya registradas.' },
    { k: 'coincidencia', label: 'Coincidencia', type: 'select', required: true, options: MODOS },
  ], onSubmit: async v => unwrap(await db().from('analitica_definiciones').insert(v)) });
  if (r) { limpiarCache(); snack('Evento creado'); }
  return r;
}

/* =================================================================== *
 * Eventos
 * =================================================================== */
export async function renderEventos(main, go, params) {
  const rango = rangoDe(params);
  const sel = params.get('ev') || '';
  const nav = extra => go('#/analitica/eventos?' + new URLSearchParams({ ...rango, ev: sel, ...extra }));
  const out = el('div', { class: 'stack' }, loading('Contando eventos…'));
  poner(main, el('div', { class: 'page-head' }, el('h2', { text: 'Eventos' }),
    el('button', { class: 'btn primary small', type: 'button', text: '+ Nuevo evento', onclick: async () => { if (await nuevoEvento()) renderEventos(main, go, params); } })),
    barraRango(rango, nav), out);
  try {
    const [{ ss, evs, porSesion }, defs] = await Promise.all([base(rango, ['pagina', 'clic', 'furia', 'error', 'personalizado', 'scroll']), definiciones()]);
    if (!ss.length) { poner(out, emptyState({ icon: 'chart', title: 'Sin visitas en este período' })); return; }
    const rutas = [...new Set(evs.filter(e => e.tipo === 'pagina').map(e => e.ruta))].sort();
    const cat = catalogo(defs, rutas);
    const sesionVis = new Map(ss.map(s => [s.id, s.visitante_id]));
    const filas = cat.map(c => {
      let total = 0; const sesSet = new Set(), visSet = new Set();
      for (const [sid, lista] of porSesion) for (const e of lista) if (coincide(c.key, e, defs)) { total++; sesSet.add(sid); visSet.add(sesionVis.get(sid)); }
      return { ...c, total, sesiones: sesSet.size, visitantes: visSet.size };
    }).filter(f => f.total > 0 || f.grupo === 'Tienda' || f.grupo === 'Definido');

    const cols = [
      { label: 'Evento', value: f => el('button', { class: 'link-btn', type: 'button', text: f.label, onclick: () => nav({ ev: f.key }) }), csv: f => f.label },
      { label: 'Grupo', value: f => f.grupo },
      { label: 'Veces', value: f => f.total, num: true }, { label: 'Sesiones', value: f => f.sesiones, num: true },
      { label: 'Visitantes', value: f => f.visitantes, num: true }, { label: '% de sesiones', value: f => pct(f.sesiones, ss.length), num: true },
      { label: '', value: f => el('div', { class: 'cell-actions' },
        el('a', { class: 'btn small', href: '#/analitica/sesiones?' + new URLSearchParams({ ...rango, evento: f.key }), text: 'Sesiones' }),
        f.def ? el('button', { class: 'btn small ghost', type: 'button', text: 'Borrar', onclick: async () => {
          if (!(await confirmDialog({ title: `¿Borrar el evento «${f.label}»?`, text: 'Los datos capturados no se pierden: solo deja de contarse.', ok: 'Borrar', danger: true }))) return;
          try { unwrap(await db().from('analitica_definiciones').delete().eq('id', f.def.id)); limpiarCache(); renderEventos(main, go, params); } catch (e) { snack(errText(e), 'err'); }
        } }) : null), csv: () => '' },
    ];

    // Detalle del evento elegido: tendencia diaria
    let detalle = null;
    if (sel) {
      const ds = dias(rango.desde, rango.hasta);
      const porDia = new Map(ds.map(d => [d, 0]));
      for (const e of evs) if (coincide(sel, e, defs)) { const k = ymd(new Date(e.creado_en)); if (porDia.has(k)) porDia.set(k, porDia.get(k) + 1); }
      detalle = tarjeta(`«${etiquetaEvento(sel, defs)}» por día`, null, columnas(ds.map(etiquetaDia), [{ nombre: 'Veces', valores: ds.map(d => porDia.get(d)) }]),
        el('button', { class: 'btn small ghost', type: 'button', text: 'Cerrar', onclick: () => nav({ ev: '' }) }));
    }

    // Elementos más clicados → crear evento (equivale al selector de elementos de Smartlook)
    const clics = cuenta(evs.filter(e => e.tipo === 'clic'), e => JSON.stringify([e.texto || '', e.selector || '', e.ruta])).slice(0, 20).map(([k, n]) => { const [texto, selector, ruta] = JSON.parse(k); return { texto, selector, ruta, n }; });
    poner(out, detalle,
      el('div', { class: 'actions' }, el('button', { class: 'btn small', type: 'button', text: 'Descargar CSV', onclick: () => downloadCsv(`eventos-${rango.desde}-a-${rango.hasta}.csv`, cols, filas) })),
      dataTable(cols, filas),
      tarjeta('Elementos más clicados', 'Crea un evento a partir de un elemento: se cuenta también hacia atrás, en las visitas ya registradas.',
        clics.length ? dataTable([
          { label: 'Texto', value: c => c.texto || '—' }, { label: 'Selector', value: c => el('code', { text: c.selector || '—' }) },
          { label: 'Página', value: c => nombreCorto(c.ruta) }, { label: 'Clics', value: c => c.n, num: true },
          { label: '', value: c => el('button', { class: 'btn small', type: 'button', text: 'Crear evento', onclick: async () => {
            if (await nuevoEvento(c.texto ? { nombre: `Clic en «${c.texto.slice(0, 60)}»`, tipo: 'clic_texto', valor: c.texto, coincidencia: 'exacta' } : { nombre: 'Clic en elemento', tipo: 'clic_selector', valor: c.selector, coincidencia: 'exacta' })) renderEventos(main, go, params);
          } }) },
        ], clics) : el('p', { class: 'muted', text: 'Sin clics en este período.' })));
  } catch (e) { console.error(e); poner(out, errorAnalitica(e)); }
}

/* =================================================================== *
 * Embudos
 * =================================================================== */
const SUGERIDO = { nombre: 'Compra en la tienda', pasos: ['p:producto_visto', 'p:carrito_agregado', 'p:checkout_iniciado', 'p:pedido_realizado'] };

async function editarEmbudo(cat, actual = null) {
  return new Promise(resolve => {
    let pasos = actual ? [...actual.pasos] : ['', ''];
    const nombre = el('input', { class: 'input', maxlength: '80', value: actual?.nombre || '' });
    const lista = el('ol', { class: 'an-pasos' });
    const msg = el('p', { class: 'msg', role: 'status' });
    const pintar = () => poner(lista, ...pasos.map((k, i) => el('li', {},
      el('select', { class: 'input', onchange: e => { pasos[i] = e.target.value; } }, el('option', { value: '', text: 'Elige un paso…' }),
        ...cat.map(c => el('option', { value: c.key, text: `${c.grupo}: ${c.label}`, selected: c.key === k }))),
      pasos.length > 2 ? el('button', { class: 'btn small ghost', type: 'button', text: 'Quitar', onclick: () => { pasos.splice(i, 1); pintar(); } }) : null)));
    pintar();
    const d = el('dialog', {}, el('h2', { text: actual ? 'Editar embudo' : 'Nuevo embudo' }),
      el('div', { class: 'form-grid' }, el('div', { class: 'field' }, el('label', { text: 'Nombre' }), nombre),
        el('div', { class: 'field' }, el('label', { text: 'Pasos (en orden, dentro de la misma sesión)' }), lista,
          el('button', { class: 'btn small', type: 'button', text: '+ Paso', onclick: () => { if (pasos.length < 10) { pasos.push(''); pintar(); } } })), msg),
      el('div', { class: 'foot' }, el('button', { class: 'btn', type: 'button', text: 'Cancelar', onclick: () => d.close() }),
        el('button', { class: 'btn primary', type: 'button', text: 'Guardar', onclick: async () => {
          const ps = pasos.filter(Boolean);
          if (!nombre.value.trim() || ps.length < 2) { msg.textContent = 'Escribe un nombre y elige al menos 2 pasos.'; msg.className = 'msg err'; return; }
          try {
            unwrap(actual ? await db().from('analitica_embudos').update({ nombre: nombre.value.trim(), pasos: ps }).eq('id', actual.id)
              : await db().from('analitica_embudos').insert({ nombre: nombre.value.trim(), pasos: ps }));
            d.close(); resolve(true);
          } catch (e) { msg.textContent = errText(e); msg.className = 'msg err'; }
        } })));
    d.addEventListener('close', () => { d.remove(); resolve(false); });
    document.body.append(d); d.showModal();
  });
}

/** Avance de cada sesión por los pasos, en orden. Devuelve por sesión el índice alcanzado y los tiempos. */
function calcularEmbudo(pasos, porSesion, defs) {
  const res = [];
  for (const [sid, lista] of porSesion) {
    let i = 0; const tiempos = [];
    for (const e of lista) { if (i < pasos.length && coincide(pasos[i], e, defs)) { tiempos.push(new Date(e.creado_en).getTime()); i++; } }
    if (i > 0) res.push({ sid, alcanzado: i, tiempos });
  }
  return res;
}

export async function renderEmbudos(main, go, params) {
  const rango = rangoDe(params);
  const elegido = params.get('id') || '';
  const nav = extra => go('#/analitica/embudos?' + new URLSearchParams({ ...rango, id: elegido, ...extra }));
  const out = el('div', { class: 'stack' }, loading('Calculando embudos…'));
  poner(main, el('div', { class: 'page-head' }, el('h2', { text: 'Embudos' })), barraRango(rango, nav), out);
  try {
    const [{ ss, evs, porSesion, sesionPorId }, defs, lista] = await Promise.all([base(rango, ['pagina', 'clic', 'furia', 'error', 'personalizado']), definiciones(), embudos()]);
    const rutas = [...new Set(evs.filter(e => e.tipo === 'pagina').map(e => e.ruta))].sort();
    const cat = catalogo(defs, rutas);
    const crear = el('div', { class: 'actions' },
      el('button', { class: 'btn primary small', type: 'button', text: '+ Nuevo embudo', onclick: async () => { if (await editarEmbudo(cat)) renderEmbudos(main, go, params); } }),
      lista.some(f => f.nombre === SUGERIDO.nombre) ? null : el('button', { class: 'btn small', type: 'button', text: 'Crear el embudo de compra sugerido', onclick: async () => {
        try { unwrap(await db().from('analitica_embudos').insert(SUGERIDO)); renderEmbudos(main, go, params); } catch (e) { snack(errText(e), 'err'); }
      } }));
    if (!lista.length) { poner(out, crear, emptyState({ icon: 'chart', title: 'Todavía no hay embudos', text: 'Un embudo muestra en qué paso abandonan los visitantes. Empieza con el de compra sugerido.' })); return; }
    const actual = lista.find(f => f.id === elegido) || lista[0];
    const res = calcularEmbudo(actual.pasos, porSesion, defs);
    const n = actual.pasos.map((_, i) => res.filter(r => r.alcanzado > i).length);
    const tiempoMedio = i => { const ts = res.filter(r => r.alcanzado > i).map(r => (r.tiempos[i] - r.tiempos[i - 1]) / 1000); return ts.length ? ts.reduce((a, b) => a + b, 0) / ts.length : null; };

    // Desglose por dispositivo
    const porDisp = Object.keys(DISPOSITIVO).map(d => {
      const rs = res.filter(r => sesionPorId.get(r.sid)?.dispositivo === d);
      return { d, inicio: rs.length, fin: rs.filter(r => r.alcanzado === actual.pasos.length).length };
    }).filter(x => x.inicio);

    poner(out, crear,
      el('div', { class: 'an-chips' }, ...lista.map(f => el('button', { type: 'button', class: 'chip', 'aria-pressed': String(f.id === actual.id), text: f.nombre, onclick: () => nav({ id: f.id }) }))),
      tarjeta(actual.nombre, `Sesiones que hicieron cada paso en orden · ${ss.length} sesiones en el período.`,
        el('div', { class: 'an-embudo' }, ...actual.pasos.map((k, i) => {
          const sale = i < actual.pasos.length - 1 ? n[i] - n[i + 1] : 0;
          const ancho = n[0] ? (n[i] / n[0]) * 100 : 0;
          const barra = el('div', { class: 'an-embudo-barra' }); barra.style.width = `${Math.max(2, ancho)}%`;
          const tm = i ? tiempoMedio(i) : null;
          return el('div', { class: 'an-embudo-paso' },
            el('div', { class: 'row between' }, el('strong', { text: `${i + 1}. ${etiquetaEvento(k, defs)}` }),
              el('span', { text: `${n[i]} sesiones · ${pct(n[i], n[0])} del inicio${i ? ` · ${pct(n[i], n[i - 1])} del paso anterior` : ''}` })),
            barra,
            el('div', { class: 'row between muted' },
              el('span', { text: tm !== null ? `Tiempo medio desde el paso anterior: ${fmtDuracion(tm)}` : '' }),
              el('span', {},
                i < actual.pasos.length - 1 && sale ? el('button', { class: 'link-btn', type: 'button', text: `${sale} abandonaron aquí → ver sesiones`,
                  onclick: () => verSesiones(go, res.filter(r => r.alcanzado === i + 1).map(r => r.sid), `abandonaron en «${etiquetaEvento(k, defs)}» (${actual.nombre})`, rango) }) : null)));
        })),
        el('div', { class: 'kpi-grid' },
          el('div', { class: 'kpi' }, el('span', { text: 'Conversión del embudo' }), el('strong', { text: pct(n[n.length - 1], n[0]) })),
          el('div', { class: 'kpi' }, el('span', { text: 'Completaron' }), el('strong', { text: String(n[n.length - 1]) }))),
        el('div', { class: 'actions' },
          el('button', { class: 'btn small', type: 'button', text: 'Ver sesiones que completaron', onclick: () => verSesiones(go, res.filter(r => r.alcanzado === actual.pasos.length).map(r => r.sid), `completaron «${actual.nombre}»`, rango) }),
          el('button', { class: 'btn small', type: 'button', text: 'Editar', onclick: async () => { if (await editarEmbudo(cat, actual)) renderEmbudos(main, go, params); } }),
          el('button', { class: 'btn small ghost', type: 'button', text: 'Borrar', onclick: async () => {
            if (!(await confirmDialog({ title: `¿Borrar el embudo «${actual.nombre}»?`, ok: 'Borrar', danger: true }))) return;
            unwrap(await db().from('analitica_embudos').delete().eq('id', actual.id)); go('#/analitica/embudos?' + new URLSearchParams(rango));
          } }))),
      porDisp.length ? tarjeta('Conversión por dispositivo', null, dataTable([
        { label: 'Dispositivo', value: x => DISPOSITIVO[x.d] }, { label: 'Empezaron', value: x => x.inicio, num: true },
        { label: 'Completaron', value: x => x.fin, num: true }, { label: 'Conversión', value: x => pct(x.fin, x.inicio), num: true }], porDisp)) : null);
  } catch (e) { console.error(e); poner(out, errorAnalitica(e)); }
}

/* =================================================================== *
 * Recorridos (flujo de comportamiento)
 * =================================================================== */
export async function renderRecorridos(main, go, params) {
  const rango = rangoDe(params);
  const desdePag = params.get('inicio') || '';
  const nav = extra => go('#/analitica/recorridos?' + new URLSearchParams({ ...rango, inicio: desdePag, ...extra }));
  const out = el('div', { class: 'stack' }, loading('Siguiendo recorridos…'));
  poner(main, el('div', { class: 'page-head' }, el('h2', { text: 'Recorridos' })), barraRango(rango, nav), out);
  try {
    const { ss, porSesion } = await base(rango, ['pagina']);
    if (!ss.length) { poner(out, emptyState({ icon: 'chart', title: 'Sin visitas en este período' })); return; }
    // Secuencia de páginas por sesión (sin repetir la misma seguida)
    const secuencias = [];
    for (const lista of porSesion.values()) {
      const seq = [];
      for (const e of lista) if (seq[seq.length - 1] !== e.ruta) seq.push(e.ruta);
      const i = desdePag ? seq.indexOf(desdePag) : 0;
      if (i >= 0 && seq.length) secuencias.push(seq.slice(i));
    }
    const todasRutas = cuenta([...porSesion.values()].flat(), e => e.ruta);
    const PASOS = 5;
    const columnasFlujo = [];
    for (let p = 0; p < PASOS; p++) {
      const enPaso = secuencias.filter(s => s.length > p);
      if (!enPaso.length) break;
      const nodos = cuenta(enPaso, s => s[p]);
      const salen = p ? secuencias.filter(s => s.length === p).length : 0;
      columnasFlujo.push({ p, total: enPaso.length, nodos, salen });
    }
    const caminos = cuenta(secuencias, s => s.slice(0, PASOS).map(nombreCorto).join(' → ')).slice(0, 15);
    poner(out, 
      el('div', { class: 'an-filtros' }, el('select', { class: 'input', 'aria-label': 'Página de inicio', onchange: e => nav({ inicio: e.target.value }) },
        el('option', { value: '', text: 'Desde la página de entrada' }), ...todasRutas.map(([r, n]) => el('option', { value: r, text: `Desde ${nombrePagina(r)} · ${n}`, selected: r === desdePag })))),
      tarjeta('Flujo de comportamiento', `${secuencias.length} sesiones · las 6 páginas más frecuentes de cada paso.`,
        el('div', { class: 'an-flujo' }, ...columnasFlujo.map(c => el('div', { class: 'an-flujo-col' },
          el('h4', { text: c.p ? `Paso ${c.p + 1}` : (desdePag ? 'Inicio' : 'Entrada') }),
          ...c.nodos.slice(0, 6).map(([r, k]) => { const b = el('i'); b.style.width = `${(k / c.total) * 100}%`; return el('div', { class: 'an-nodo', title: nombrePagina(r) }, el('span', { text: nombreCorto(r) }), el('small', { text: `${k} · ${pct(k, c.total)}` }), b); }),
          c.nodos.length > 6 ? el('div', { class: 'an-nodo otros' }, el('span', { text: `Otras (${c.nodos.length - 6})` }), el('small', { text: String(c.nodos.slice(6).reduce((a, x) => a + x[1], 0)) })) : null,
          c.salen ? el('div', { class: 'an-nodo salida' }, el('span', { text: 'Se fueron antes' }), el('small', { text: `${c.salen}` })) : null)))),
      tarjeta('Recorridos más comunes', 'Primeras 5 páginas de cada sesión.',
        dataTable([{ label: 'Recorrido', value: x => x[0] }, { label: 'Sesiones', value: x => x[1], num: true }, { label: '%', value: x => pct(x[1], secuencias.length), num: true }], caminos)));
  } catch (e) { console.error(e); poner(out, errorAnalitica(e)); }
}

/* =================================================================== *
 * Retención (cohortes por primera visita)
 * =================================================================== */
export async function renderRetencion(main, go, params) {
  const rango = rangoDe(params);
  const g = params.get('g') === 'dia' ? 'dia' : 'semana';
  const nav = extra => go('#/analitica/retencion?' + new URLSearchParams({ ...rango, g, ...extra }));
  const out = el('div', { class: 'stack' }, loading('Calculando cohortes…'));
  const grupo = el('div', { class: 'subtabs', role: 'tablist' }, ...[['semana', 'Por semana'], ['dia', 'Por día']].map(([k, t]) =>
    el('button', { type: 'button', role: 'tab', 'aria-selected': String(k === g), text: t, onclick: () => nav({ g: k }) })));
  poner(main, el('div', { class: 'page-head' }, el('h2', { text: 'Retención' })), barraRango(rango, nav), grupo, out);
  try {
    const ss = await sesiones(rango);
    if (!ss.length) { poner(out, emptyState({ icon: 'chart', title: 'Sin visitas en este período' })); return; }
    const paso = g === 'semana' ? 7 : 1, N = g === 'semana' ? 8 : 14;
    const inicioPeriodo = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); if (g === 'semana') x.setDate(x.getDate() - (x.getDay() + 6) % 7); return x; };
    const porVis = new Map();
    for (const s of ss) { const a = porVis.get(s.visitante_id) || []; a.push(new Date(s.inicio)); porVis.set(s.visitante_id, a); }
    const cohortes = new Map();
    for (const fechas of porVis.values()) {
      fechas.sort((a, b) => a - b);
      const c0 = inicioPeriodo(fechas[0]);
      const k = ymd(c0);
      const o = cohortes.get(k) || { k, n: 0, vuelven: Array(N).fill(0) };
      o.n++;
      const vistos = new Set(fechas.map(f => Math.floor((inicioPeriodo(f) - c0) / (paso * 864e5))));
      for (const i of vistos) if (i >= 0 && i < N) o.vuelven[i]++;
      cohortes.set(k, o);
    }
    const filas = [...cohortes.values()].sort((a, b) => a.k.localeCompare(b.k));
    const hoy = inicioPeriodo(new Date());
    const celda = (o, i) => {
      const futuro = new Date(`${o.k}T00:00:00`).getTime() + i * paso * 864e5 > hoy.getTime();
      if (futuro) return el('td', { class: 'an-cohorte vacia' });
      const v = o.n ? o.vuelven[i] / o.n : 0;
      const td = el('td', { class: 'an-cohorte', title: `${o.vuelven[i]} de ${o.n}`, text: i === 0 ? '100 %' : `${Math.round(v * 100)} %` });
      td.style.setProperty('--v', String(i === 0 ? 1 : v));
      if (i === 0 || v > 0.55) td.style.color = '#fff';
      return td;
    };
    poner(out, 
      el('p', { class: 'muted', text: `Cada fila agrupa a los visitantes por su primera visita del período. Las columnas muestran qué porcentaje volvió ${g === 'semana' ? 'cada semana' : 'cada día'} después.` }),
      el('div', { class: 'table-wrap' }, el('table', { class: 'data an-retencion' },
        el('thead', {}, el('tr', {}, el('th', { text: g === 'semana' ? 'Semana de la 1.ª visita' : 'Día de la 1.ª visita' }), el('th', { class: 'num', text: 'Visitantes' }),
          ...Array.from({ length: N }, (_, i) => el('th', { class: 'num', text: i === 0 ? (g === 'semana' ? 'Sem. 0' : 'Día 0') : `${g === 'semana' ? 'Sem.' : 'Día'} ${i}` })))),
        el('tbody', {}, ...filas.map(o => el('tr', {}, el('td', { text: o.k.split('-').reverse().join('/') }), el('td', { class: 'num', text: String(o.n) }), ...Array.from({ length: N }, (_, i) => celda(o, i))))))));
  } catch (e) { console.error(e); poner(out, errorAnalitica(e)); }
}
