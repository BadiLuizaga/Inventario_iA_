/* ------------------------------------------------------------------ *
 * Reporte «Mercado Manaco»: comercio exterior de calzado (referencia externa,
 * Excel del caso Manaco). Responde lo que pide el caso: importación frente a
 * exportación, principales socios, valor por par y valor frente a cantidad.
 * No son ventas de la empresa: cada gráfico se calcula de public.mercado_comercio.
 * ------------------------------------------------------------------ */
import { el, emptyState } from '../ui.js';
import { mercadoComercio } from '../services/interno.js';
import { dataTable, downloadCsv } from './util.js';

const FLUJO = { importacion: 'Importación', exportacion: 'Exportación' };
// Nombres cortos de las partidas del Excel (si llega otra, se usa su nombre completo)
const CORTO = { '640411': 'Deportivo, suela de caucho/plástico', '640399': 'Suela de caucho/plástico, corte de cuero', '640420': 'Suela y corte de cuero' };
const esMundo = r => /^(mundo|world|total)$/i.test(r.socio.trim());

const nf = (v, d = 1) => v.toLocaleString('es-BO', { minimumFractionDigits: d, maximumFractionDigits: d });
const musd = v => `${nf(v / 1e6)} M USD`;
const mpares = n => `${nf(n / 1e6)} M pares`;
const porPar = (valor, pares) => pares > 0 ? valor / pares : null;
const usdPar = v => v === null ? '—' : `${nf(v, 2)} USD`;
const pct = (a, total) => total > 0 ? `${nf(a / total * 100)} %` : '—';

function sumar(rows) {
  const o = { valor: 0, pares: 0 };
  for (const r of rows) { o.valor += Number(r.valor_usd); o.pares += Number(r.pares || 0); }
  return o;
}
function agrupar(rows, key) {
  const m = new Map();
  for (const r of rows) { const k = key(r); m.set(k, [...(m.get(k) || []), r]); }
  return m;
}

/** Barras horizontales (mismo estilo que «Actividad por usuario»). series: [{ label, fill?: 'alt', value }] */
function barras(filas, max) {
  return el('div', { class: 'bars' }, ...filas.map(f => el('div', { class: 'bar-row' },
    el('span', { text: f.label }),
    el('div', { class: 'bar-pair' }, ...f.series.map(s => {
      const fill = el('div', { class: 'bar-fill' + (s.fill ? ' ' + s.fill : ''), title: s.title || '' });
      fill.style.width = `${max > 0 ? (s.value / max) * 100 : 0}%`;
      return el('div', { class: 'bar-track' }, fill);
    })),
    el('strong', { text: f.text }))));
}
const leyenda = () => el('div', { class: 'legend' },
  el('span', {}, el('i', {}), FLUJO.importacion), el('span', {}, el('i', { class: 'alt' }), FLUJO.exportacion));
const tarjeta = (titulo, sub, ...hijos) => el('div', { class: 'card stack' }, el('h3', { text: titulo }), sub ? el('p', { class: 'muted', text: sub }) : null, ...hijos);

export async function renderMercado(out, params, nav) {
  const todas = await mercadoComercio();
  if (!todas.length) {
    out.replaceChildren(emptyState({ icon: 'chart', title: 'Todavía no hay datos de mercado',
      text: 'Carga el Excel del caso Manaco con supabase/seed/03_mercado_manaco.sql (se genera con scripts/excel_a_sql.py). Ver docs/GUIA.md.' }));
    return;
  }
  const anio = params.get('anio') || '', cod = params.get('cod') || '', sf = params.get('sf') === 'exportacion' ? 'exportacion' : 'importacion';
  const go = cambios => nav({ anio, cod, sf, ...cambios });

  const mundo = todas.filter(esMundo);
  const base = todas.filter(r => !esMundo(r));
  const rows = base.filter(r => (!anio || String(r.anio) === anio) && (!cod || r.codigo_sa6 === cod));
  const anios = [...new Set(base.map(r => r.anio))].sort();
  const categorias = [...agrupar(base, r => r.codigo_sa6)].map(([c, rs]) => ({ cod: c, nombre: CORTO[c] || rs[0].categoria, completo: rs[0].categoria })).sort((a, b) => a.cod.localeCompare(b.cod));
  const nombreCat = c => categorias.find(x => x.cod === c)?.nombre || c;

  const sel = (label, value, opciones, onChange) => el('label', { class: 'row' }, el('span', { class: 'muted', text: label }),
    el('select', { class: 'input', onchange: e => onChange(e.target.value) }, ...opciones.map(([v, t]) => el('option', { value: v, text: t, selected: v === value }))));
  const filtros = el('div', { class: 'row', style: 'flex-wrap:wrap;gap:12px' },
    sel('Año', anio, [['', 'Todos'], ...anios.map(a => [String(a), String(a)])], v => go({ anio: v })),
    sel('Categoría', cod, [['', 'Todas'], ...categorias.map(c => [c.cod, `${c.cod} · ${c.nombre}`])], v => go({ cod: v })));

  if (!rows.length) { out.replaceChildren(filtros, emptyState({ icon: 'chart', title: 'Sin registros para ese filtro', text: 'Prueba con otro año o categoría.' })); return; }

  const porFlujo = { importacion: sumar(rows.filter(r => r.flujo === 'importacion')), exportacion: sumar(rows.filter(r => r.flujo === 'exportacion')) };
  const kpi = (label, value, warn = false) => el('div', { class: 'kpi' + (warn ? ' warn' : '') }, el('span', { text: label }), el('strong', { text: value }));
  const balance = porFlujo.exportacion.valor - porFlujo.importacion.valor;

  // 1. Importación frente a exportación por año
  const filasAnio = anios.filter(a => !anio || String(a) === anio).map(a => {
    const rs = rows.filter(r => r.anio === a);
    return { a, imp: sumar(rs.filter(r => r.flujo === 'importacion')).valor, exp: sumar(rs.filter(r => r.flujo === 'exportacion')).valor };
  });
  const maxAnio = Math.max(...filasAnio.flatMap(f => [f.imp, f.exp]));
  const gAnio = barras(filasAnio.map(f => ({ label: String(f.a), text: `${nf(f.imp / 1e6, 0)} / ${nf(f.exp / 1e6, 0)} M USD`,
    series: [{ value: f.imp, title: `${FLUJO.importacion}: ${musd(f.imp)}` }, { value: f.exp, fill: 'alt', title: `${FLUJO.exportacion}: ${musd(f.exp)}` }] })), maxAnio);

  // 2. Principales socios (top 10) del flujo elegido
  const socios = [...agrupar(rows.filter(r => r.flujo === sf), r => r.socio)].map(([s, rs]) => ({ s, ...sumar(rs) })).sort((a, b) => b.valor - a.valor);
  const top = socios.slice(0, 10);
  const gSocios = barras(top.map(x => ({ label: x.s, text: musd(x.valor), series: [{ value: x.valor, fill: sf === 'exportacion' ? 'alt' : '', title: `${mpares(x.pares)} · ${usdPar(porPar(x.valor, x.pares))} por par` }] })), top[0]?.valor || 0);
  const toggle = el('div', { class: 'subtabs', role: 'tablist' }, ...Object.entries(FLUJO).map(([k, t]) =>
    el('button', { type: 'button', role: 'tab', 'aria-selected': String(k === sf), text: t, onclick: () => go({ sf: k }) })));

  // 3. Valor por par por categoría y flujo (promedio ponderado: valor total / pares totales)
  const vpp = categorias.filter(c => !cod || c.cod === cod).flatMap(c => Object.keys(FLUJO).map(f => {
    const t = sumar(rows.filter(r => r.codigo_sa6 === c.cod && r.flujo === f));
    return { c, f, v: porPar(t.valor, t.pares) };
  })).filter(x => x.v !== null);
  const gVpp = barras(vpp.map(x => ({ label: `${x.c.nombre} · ${x.f === 'importacion' ? 'imp.' : 'exp.'}`, text: usdPar(x.v), series: [{ value: x.v, fill: x.f === 'exportacion' ? 'alt' : '' }] })), Math.max(...vpp.map(x => x.v)));

  // 4. Valor frente a cantidad: participación de cada categoría en el valor y en los pares de su flujo
  const vc = Object.keys(FLUJO).flatMap(f => categorias.filter(c => !cod || c.cod === cod).map(c => {
    const t = sumar(rows.filter(r => r.codigo_sa6 === c.cod && r.flujo === f));
    return { f, c, ...t, pv: pct(t.valor, porFlujo[f].valor), pp: pct(t.pares, porFlujo[f].pares), vpp: porPar(t.valor, t.pares) };
  })).filter(x => x.valor > 0);
  const colsVc = [{ label: 'Flujo', value: x => FLUJO[x.f] }, { label: 'Categoría', value: x => `${x.c.cod} · ${x.c.nombre}` },
    { label: 'Valor', value: x => musd(x.valor), csv: x => x.valor.toFixed(2), num: true }, { label: '% del valor', value: x => x.pv, num: true },
    { label: 'Pares', value: x => mpares(x.pares), csv: x => x.pares, num: true }, { label: '% de los pares', value: x => x.pp, num: true },
    { label: 'Valor por par', value: x => usdPar(x.vpp), csv: x => x.vpp?.toFixed(2) ?? '', num: true }];

  // Calidad de los datos
  const repetidas = [...agrupar(base, r => `${r.flujo}|${r.anio}|${r.codigo_sa6}|${r.socio}`).values()].filter(g => g.length > 1).length;
  const porAnio = anios.map(a => [a, base.filter(r => r.anio === a).length]).sort((x, y) => x[1] - y[1]);
  const paises = [...new Set(todas.map(r => r.pais_reportante))].join(', ');

  const colsCsv = [{ label: 'País reportante', value: r => r.pais_reportante }, { label: 'Flujo', value: r => FLUJO[r.flujo] }, { label: 'Año', value: r => r.anio },
    { label: 'Código SA6', value: r => r.codigo_sa6 }, { label: 'Categoría', value: r => r.categoria }, { label: 'Socio', value: r => r.socio },
    { label: 'Valor USD', value: r => r.valor_usd }, { label: 'Pares', value: r => r.pares ?? '' }, { label: 'Valor USD por par', value: r => r.valor_usd_por_par ?? '' }];

  out.replaceChildren(
    filtros,
    el('div', { class: 'kpi-grid' },
      kpi('Importado (M USD)', nf(porFlujo.importacion.valor / 1e6)), kpi('Exportado (M USD)', nf(porFlujo.exportacion.valor / 1e6)),
      kpi('Balance exp. − imp. (M USD)', nf(balance / 1e6), balance < 0),
      kpi('Pares importados (M)', nf(porFlujo.importacion.pares / 1e6)), kpi('Pares exportados (M)', nf(porFlujo.exportacion.pares / 1e6)),
      kpi('Valor por par importado (USD)', nf(porPar(porFlujo.importacion.valor, porFlujo.importacion.pares) ?? 0, 2)),
      kpi('Valor por par exportado (USD)', nf(porPar(porFlujo.exportacion.valor, porFlujo.exportacion.pares) ?? 0, 2))),
    tarjeta('Importación frente a exportación por año', 'Valor comercial en millones de USD (importación / exportación).', leyenda(), gAnio),
    tarjeta('Principales socios comerciales', `Top ${top.length} de ${socios.length} países por valor. Pasa el cursor por una barra para ver pares y valor por par.`, toggle, gSocios),
    tarjeta('Valor por par por categoría y flujo', 'Promedio ponderado: valor total ÷ pares totales.', leyenda(), gVpp),
    tarjeta('Valor frente a cantidad', 'Si una categoría pesa más en el valor que en los pares, sus pares cuestan más que el promedio de su flujo.', dataTable(colsVc, vc)),
    tarjeta('Limitaciones de los datos', null, el('ul', { class: 'muted' },
      el('li', { text: `País reportante: ${paises}. No son datos de Bolivia ni ventas de Manaco: sirven como referencia externa del mercado.` }),
      el('li', { text: 'El valor comercial por par no es el precio al consumidor: no incluye aranceles, transporte, márgenes ni impuestos.' }),
      el('li', { text: `Los años no tienen la misma cantidad de registros (de ${porAnio[0][1]} en ${porAnio[0][0]} a ${porAnio.at(-1)[1]} en ${porAnio.at(-1)[0]}): compara proporciones, no totales entre años.` }),
      el('li', { text: repetidas ? `${repetidas} combinaciones de flujo, año, código y socio aparecen repetidas; se conservan tal como vienen en el Excel.` : 'No hay combinaciones repetidas de flujo, año, código y socio.' }),
      el('li', { text: mundo.length ? `Se excluyen ${mundo.length} registros agregados («Mundo») para evitar doble conteo.` : 'No hay registros agregados («Mundo»), así que no hay doble conteo.' }))),
    el('div', { class: 'actions' }, el('button', { class: 'btn small', type: 'button', text: `Descargar CSV (${rows.length} registros)`,
      onclick: () => downloadCsv(`mercado-calzado${anio ? '-' + anio : ''}${cod ? '-' + cod : ''}.csv`, colsCsv, rows) })));
}
