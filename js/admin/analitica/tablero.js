/* Analítica: tablero general con tarjetas configurables (cada admin elige cuáles ver). */
import { el, emptyState, loading, errText } from '../../ui.js';
import { barras, leyenda, tarjeta } from '../util.js';
import { poner, sesiones, eventos, rangoDe, rangoAnterior, barraRango, columnas, kpi, dias, ymd, etiquetaDia, cuenta, pct, fmtDuracion,
  nombrePagina, DISPOSITIVO, TIENDA } from './datos.js';

const TARJETAS = [
  ['indicadores', 'Indicadores'], ['tendencia', 'Visitantes y sesiones por día'], ['embudo', 'Embudo de compra'], ['dispositivos', 'Dispositivos'],
  ['navegadores', 'Navegadores'], ['sistemas', 'Sistemas operativos'], ['fuentes', 'Fuentes de tráfico'], ['paginas', 'Páginas más vistas'],
  ['entrada', 'Páginas de entrada'], ['salida', 'Páginas de salida'], ['tienda', 'Eventos de la tienda'], ['frustracion', 'Frustración'],
];
const ocultas = () => { try { return new Set(JSON.parse(localStorage.getItem('an:tablero') || '[]')); } catch (_) { return new Set(); } };
const guardarOcultas = s => { try { localStorage.setItem('an:tablero', JSON.stringify([...s])); } catch (_) { /* sin almacenamiento */ } };

function resumen(ss) {
  const vis = new Set(ss.map(s => s.visitante_id));
  const n = ss.length;
  return {
    sesiones: n, visitantes: vis.size, paginas: ss.reduce((a, s) => a + s.paginas, 0),
    duracion: n ? ss.reduce((a, s) => a + s.duracion, 0) / n : 0,
    rebote: n ? ss.filter(s => s.rebote).length / n * 100 : 0,
    conversion: n ? ss.filter(s => s.convertida).length / n * 100 : 0,
    furia: ss.reduce((a, s) => a + s.clics_furia, 0), conError: ss.filter(s => s.errores > 0).length,
  };
}

export async function renderTablero(main, go, params) {
  const rango = rangoDe(params);
  const nav = extra => go('#/analitica?' + new URLSearchParams({ ...rango, ...extra }));
  const out = el('div', { class: 'stack' }, loading('Calculando…'));
  const ocultar = ocultas();
  const config = el('div', { class: 'card stack', hidden: true }, el('h3', { text: 'Tarjetas del tablero' }),
    el('div', { class: 'check-grid' }, ...TARJETAS.map(([k, t]) => {
      const c = el('input', { type: 'checkbox', checked: !ocultar.has(k) });
      c.addEventListener('change', () => { if (c.checked) ocultar.delete(k); else ocultar.add(k); guardarOcultas(ocultar); out.querySelector(`[data-tarjeta="${k}"]`)?.toggleAttribute('hidden', !c.checked); });
      return el('label', {}, c, t);
    })), el('p', { class: 'muted', text: 'Se recuerda en este navegador.' }));
  poner(main, 
    el('div', { class: 'page-head' }, el('h2', { text: 'Tablero de analítica' }),
      el('button', { class: 'btn small', type: 'button', text: 'Personalizar', onclick: () => { config.hidden = !config.hidden; } })),
    barraRango(rango, nav), config, out);

  try {
    const [ss, prev, evs] = await Promise.all([sesiones(rango), sesiones(rangoAnterior(rango)), eventos(rango, { tipos: ['personalizado', 'pagina'] })]);
    if (!ss.length) {
      poner(out, emptyState({ icon: 'chart', title: 'Todavía no hay visitas medidas en este período',
        text: 'La tienda registra las visitas de quienes aceptan la analítica en el aviso de privacidad. Revisa también Analítica → Ajustes.' }));
      return;
    }
    const ids = new Set(ss.map(s => s.id));
    const ev = evs.filter(e => ids.has(e.sesion_id));
    const r = resumen(ss), p = resumen(prev);
    const nuevos = (() => {   // visitantes cuya primera sesión del período anterior + actual cae en este período
      const antes = new Set(prev.map(s => s.visitante_id));
      return new Set(ss.filter(s => !antes.has(s.visitante_id)).map(s => s.visitante_id)).size;
    })();
    const T = (k, ...hijos) => { const n = el('div', { 'data-tarjeta': k, hidden: ocultar.has(k) }, ...hijos); return n; };
    const top = (pares, total, n = 8) => pares.length
      ? barras(pares.slice(0, n).map(([k, v]) => ({ label: k, text: `${v} · ${pct(v, total)}`, series: [{ value: v }] })), pares[0][1])
      : el('p', { class: 'muted', text: 'Sin datos.' });

    // Tendencia diaria
    const ds = dias(rango.desde, rango.hasta);
    const porDia = new Map(ds.map(d => [d, { s: 0, v: new Set() }]));
    for (const s of ss) { const o = porDia.get(ymd(new Date(s.inicio))); if (o) { o.s++; o.v.add(s.visitante_id); } }

    // Embudo de compra (misma sesión, en orden)
    const pasos = ['producto_visto', 'carrito_agregado', 'checkout_iniciado', 'pedido_realizado'];
    const porSesion = new Map();
    for (const e of ev) if (e.tipo === 'personalizado') { const a = porSesion.get(e.sesion_id) || []; a.push(e.nombre); porSesion.set(e.sesion_id, a); }
    const llegan = pasos.map(() => 0);
    for (const nombres of porSesion.values()) { let i = 0; for (const nm of nombres) if (nm === pasos[i]) i++; for (let k = 0; k < i; k++) llegan[k]++; }

    const tienda = cuenta(ev.filter(e => e.tipo === 'personalizado'), e => TIENDA[e.nombre] || e.nombre);
    const vistas = cuenta(ev.filter(e => e.tipo === 'pagina'), e => nombrePagina(e.ruta));

    poner(out, 
      T('indicadores', el('div', { class: 'kpi-grid' },
        kpi('Visitantes únicos', r.visitantes, p.visitantes),
        kpi('Visitantes nuevos', nuevos, null, { ayuda: 'No tuvieron sesiones en el período anterior.' }),
        kpi('Sesiones', r.sesiones, p.sesiones),
        kpi('Páginas vistas', r.paginas, p.paginas),
        kpi('Páginas por sesión', r.sesiones ? r.paginas / r.sesiones : 0, p.sesiones ? p.paginas / p.sesiones : null, { fmt: v => v.toFixed(1) }),
        kpi('Duración media', r.duracion, p.duracion, { fmt: fmtDuracion }),
        kpi('Tasa de rebote', r.rebote, p.rebote, { fmt: v => `${v.toFixed(1)} %`, menosEsMejor: true, ayuda: 'Sesiones con una sola página.' }),
        kpi('Conversión', r.conversion, p.conversion, { fmt: v => `${v.toFixed(1)} %`, ayuda: 'Sesiones que terminaron en un pedido.' }),
        kpi('Clics de furia', r.furia, p.furia, { menosEsMejor: true }),
        kpi('Sesiones con errores', r.conError, p.conError, { menosEsMejor: true })),
      el('p', { class: 'muted', text: `Comparado con ${rangoAnterior(rango).desde.split('-').reverse().join('/')} – ${rangoAnterior(rango).hasta.split('-').reverse().join('/')}.` })),
      T('tendencia', tarjeta('Visitantes y sesiones por día', null, leyenda(['Sesiones'], ['Visitantes', 'alt']),
        columnas(ds.map(etiquetaDia), [{ nombre: 'Sesiones', valores: ds.map(d => porDia.get(d).s) }, { nombre: 'Visitantes', valores: ds.map(d => porDia.get(d).v.size), clase: 'alt' }]))),
      el('div', { class: 'an-grid' },
        T('embudo', tarjeta('Embudo de compra', 'Sesiones que hicieron cada paso en orden.',
          barras(pasos.map((k, i) => ({ label: TIENDA[k], text: `${llegan[i]} · ${pct(llegan[i], r.sesiones)}`, series: [{ value: llegan[i] }] })), r.sesiones),
          el('a', { class: 'btn small', href: '#/analitica/embudos', text: 'Ver embudos' }))),
        T('dispositivos', tarjeta('Dispositivos', null, top(cuenta(ss, s => DISPOSITIVO[s.dispositivo]), r.sesiones))),
        T('navegadores', tarjeta('Navegadores', null, top(cuenta(ss, s => s.navegador || 'Otro'), r.sesiones))),
        T('sistemas', tarjeta('Sistemas operativos', null, top(cuenta(ss, s => s.sistema || 'Otro'), r.sesiones))),
        T('fuentes', tarjeta('Fuentes de tráfico', 'Referente o campaña (UTM).', top(cuenta(ss, s => s.fuente), r.sesiones))),
        T('paginas', tarjeta('Páginas más vistas', null, top(vistas, r.paginas))),
        T('entrada', tarjeta('Páginas de entrada', null, top(cuenta(ss, s => s.pagina_entrada && nombrePagina(s.pagina_entrada)), r.sesiones))),
        T('salida', tarjeta('Páginas de salida', 'Última página antes de irse.', top(cuenta(ss, s => s.pagina_salida && nombrePagina(s.pagina_salida)), r.sesiones))),
        T('tienda', tarjeta('Eventos de la tienda', null, top(tienda, tienda.reduce((a, x) => a + x[1], 0)), el('a', { class: 'btn small', href: '#/analitica/eventos', text: 'Ver eventos' }))),
        T('frustracion', tarjeta('Frustración', null,
          el('div', { class: 'kpi-grid' }, kpi('Clics de furia', r.furia), kpi('Sesiones con errores', r.conError), kpi('Sesiones con furia', ss.filter(s => s.clics_furia > 0).length)),
          el('a', { class: 'btn small', href: '#/analitica/errores', text: 'Ver errores y frustración' })))));
  } catch (e) {
    console.error(e);
    poner(out, errorAnalitica(e));
  }
}

/** Mensaje de error común (incluye el caso sin migración 0005). */
export function errorAnalitica(e) {
  if (/analitica_|PGRST205|42P01/.test(`${e.code} ${e.message}`)) return emptyState({ icon: 'plug', title: 'Falta la estructura de analítica', text: 'Aplica supabase/migrations/0005_analitica.sql en la base de datos.' });
  return emptyState({ icon: 'alert', kind: 'err', title: 'No se pudo cargar la analítica', text: errText(e) });
}
