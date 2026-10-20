/* ------------------------------------------------------------------ *
 * Reportes. Todo se calcula a partir de la base de datos; sin
 * registros, cada reporte explica qué datos necesita. Nada se simula.
 * ------------------------------------------------------------------ */
import { el, emptyState, loading, errText, fmtDate, fmtMoney, todayISO, startOfDay, endOfDay } from '../ui.js';
import { db, unwrap, todasLasFilas } from '../supabase.js';
import { existencias, movimientos, pedidos, maestros, nombreAlmacen, TIPO_MOV, escaneos, perfiles } from '../services/interno.js';
import { ESTADO_PEDIDO } from '../services/tienda.js';
import { dataTable, downloadCsv, barras, leyenda, tarjeta } from './util.js';
import { renderMercado } from './mercado.js';

const money = v => fmtMoney(v, true);
// replaceChildren convierte null en el texto «null» y los arreglos en «[object …]»: se aplanan y filtran antes
const put = (node, ...kids) => node.replaceChildren(...kids.flat(Infinity).filter(k => k !== null && k !== undefined && k !== false));

/* ---------- series por período (día o semana, en hora local) ---------- */
const pad2 = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
function clavePeriodo(fecha, g) {
  const d = new Date(fecha);
  if (g === 'semana') d.setDate(d.getDate() - (d.getDay() + 6) % 7);   // lunes de esa semana
  return ymd(d);
}
const etiquetaPeriodo = (k, g) => { const [y, m, d] = k.split('-'); return `${g === 'semana' ? 'Sem. ' : ''}${d}/${m}/${y}`; };
/** Todos los períodos del rango, también los vacíos: un día sin actividad se ve como barra en cero. */
function periodos(desde, hasta, g) {
  const out = [], d = new Date(`${clavePeriodo(`${desde}T00:00:00`, g)}T00:00:00`), fin = new Date(`${hasta}T00:00:00`);
  while (d <= fin) { out.push(ymd(d)); d.setDate(d.getDate() + (g === 'semana' ? 7 : 1)); }
  return out;
}

/* =================================================================== *
 * Reportes
 * =================================================================== */
const REPORTES = [
  ['stock', 'Stock actual'], ['bajo', 'Bajo stock'], ['movimientos', 'Entradas y salidas'],
  ['conteos', 'Diferencias de conteo'], ['actividad', 'Actividad por usuario'], ['ventas', 'Pedidos y ventas'],
  ['ia', 'Reconocimiento IA'], ['mercado', 'Mercado Manaco'],
];

export async function renderReportes(main, go, params) {
  const r = params.get('r') || 'stock';
  const hace30 = new Date(Date.now() - 29 * 864e5); const pad = n => String(n).padStart(2, '0');
  const desde = params.get('desde') || `${hace30.getFullYear()}-${pad(hace30.getMonth() + 1)}-${pad(hace30.getDate())}`;
  const hasta = params.get('hasta') || todayISO();
  const nav = (k, extra = {}) => { const p = new URLSearchParams({ r: k, desde, hasta, ...extra }); go('#/reportes?' + p); };
  const usesDates = ['movimientos', 'conteos', 'actividad', 'ventas', 'ia'].includes(r);
  // Más de un mes por día no se lee bien: por defecto se agrupa por semana
  const g = params.get('g') || ((new Date(hasta) - new Date(desde)) / 864e5 > 31 ? 'semana' : 'dia');
  const dIn = el('input', { type: 'date', class: 'input', value: desde, max: todayISO(), 'aria-label': 'Desde' });
  const hIn = el('input', { type: 'date', class: 'input', value: hasta, max: todayISO(), 'aria-label': 'Hasta' });
  const apply = () => { const p = new URLSearchParams({ r, desde: dIn.value || desde, hasta: hIn.value || hasta, ...(params.get('g') ? { g } : {}) }); go('#/reportes?' + p); };
  dIn.addEventListener('change', apply); hIn.addEventListener('change', apply);
  const out = el('div', { class: 'stack' }, loading());
  main.replaceChildren(
    el('div', { class: 'page-head' }, el('h2', { text: 'Reportes' }), usesDates ? el('div', { class: 'row' }, el('span', { class: 'muted', text: 'Desde' }), dIn, el('span', { class: 'muted', text: 'hasta' }), hIn) : null),
    el('div', { class: 'subtabs', role: 'tablist' }, ...REPORTES.map(([k, t]) => el('button', { type: 'button', role: 'tab', 'aria-selected': String(k === r), text: t, onclick: () => nav(k) }))),
    out);
  const rango = { desde: startOfDay(desde), hasta: endOfDay(hasta) };
  const csvBtn = (name, cols, rows) => el('div', { class: 'actions' }, el('button', { class: 'btn small', type: 'button', text: 'Descargar CSV', onclick: () => downloadCsv(name, cols, rows) }));
  const sinDatos = (title, text) => out.replaceChildren(emptyState({ icon: 'chart', title, text }));
  const agrupar = el('div', { class: 'subtabs', role: 'tablist', 'aria-label': 'Agrupar por' }, ...[['dia', 'Por día'], ['semana', 'Por semana']].map(([k, t]) =>
    el('button', { type: 'button', role: 'tab', 'aria-selected': String(k === g), text: t, onclick: () => nav(r, { g: k }) })));

  try {
    if (r === 'mercado') return await renderMercado(out, params, extra => go('#/reportes?' + new URLSearchParams({ r, ...extra })));

    if (r === 'stock' || r === 'bajo') {
      const [rows, m] = await Promise.all([existencias({ soloBajo: r === 'bajo' }), maestros()]);
      if (!rows.length) return sinDatos(r === 'bajo' ? 'No hay variantes bajo el mínimo' : 'Todavía no hay existencias registradas',
        r === 'bajo' ? 'Este reporte usa el «mínimo» definido por variante y almacén (Productos → Existencias). Aparecen aquí las que estén en su mínimo o por debajo.' : 'Se necesitan productos con variantes y al menos una entrada de mercadería en un almacén.');
      const almName = new Map(m.almacenes.map(a => [a.id, nombreAlmacen(a)]));
      const porAlm = new Map();
      for (const x of rows) porAlm.set(x.almacen_id, (porAlm.get(x.almacen_id) || 0) + x.cantidad);
      const cols = [
        { label: 'Almacén', value: x => almName.get(x.almacen_id) || x.almacen }, { label: 'Producto', value: x => x.producto },
        { label: 'Talla', value: x => x.talla || '—' }, { label: 'Color', value: x => x.color || '—' }, { label: 'SKU', value: x => x.sku || '—' },
        { label: 'Ubicación', value: x => x.ubicacion || '—' }, { label: 'Mínimo', value: x => x.stock_minimo, num: true }, { label: 'Stock', value: x => x.cantidad, num: true }];
      put(out,
        r === 'stock' ? el('div', { class: 'kpi-grid' }, ...[...porAlm].map(([id, n]) => el('div', { class: 'kpi' }, el('span', { text: almName.get(id) || '—' }), el('strong', { text: String(n) })))) : null,
        csvBtn(`${r === 'bajo' ? 'bajo-stock' : 'stock'}-${todayISO()}.csv`, cols, rows),
        dataTable(cols, rows, { rowClass: x => x.bajo_minimo ? 'low' : '' }));
      return;
    }

    if (r === 'movimientos' || r === 'actividad') {
      const rows = await movimientos({ ...rango, limit: 200000 });
      if (!rows.length) return sinDatos('No hay movimientos en ese período', 'Este reporte se genera con las entradas, salidas, devoluciones, ajustes y pedidos registrados en el rango de fechas elegido.');
      if (r === 'movimientos') {
        const tot = {}; const serie = new Map(periodos(desde, hasta, g).map(k => [k, { k, entra: 0, sale: 0, n: 0 }]));
        for (const m of rows) {
          tot[m.tipo] = (tot[m.tipo] || 0) + m.cantidad;
          const o = serie.get(clavePeriodo(m.creado_en, g));   // período LOCAL, no UTC
          if (!o) continue;
          if (TIPO_MOV[m.tipo].signo === '+') o.entra += m.cantidad; else o.sale += m.cantidad;
          o.n++;
        }
        const filas = [...serie.values()];
        const maxU = Math.max(...filas.flatMap(o => [o.entra, o.sale]));
        const colsSerie = [{ label: g === 'semana' ? 'Semana (desde el lunes)' : 'Día', value: o => etiquetaPeriodo(o.k, g) }, { label: 'Movimientos', value: o => o.n, num: true },
          { label: 'Ingresos', value: o => '+' + o.entra, csv: o => o.entra, num: true }, { label: 'Egresos', value: o => '−' + o.sale, csv: o => o.sale, num: true }];
        const cols = [{ label: 'Fecha', value: m => fmtDate(m.creado_en) }, { label: 'Tipo', value: m => TIPO_MOV[m.tipo].text }, { label: 'Producto', value: m => `${m.producto}${m.talla ? ' · T' + m.talla : ''}${m.color ? ' · ' + m.color : ''}` },
          { label: 'Almacén', value: m => m.almacen }, { label: 'Cantidad', value: m => TIPO_MOV[m.tipo].signo + m.cantidad, num: true }, { label: 'Saldo', value: m => m.saldo, num: true },
          { label: 'Usuario', value: m => m.usuario }, { label: 'Motivo', value: m => m.motivo || '—' }, { label: 'Referencia', value: m => m.referencia || '—' }];
        put(out,
          el('div', { class: 'kpi-grid' }, ...Object.entries(tot).map(([t, n]) => el('div', { class: 'kpi' }, el('span', { text: TIPO_MOV[t].text }), el('strong', { text: String(n) })))),
          tarjeta(`Entradas y salidas ${g === 'semana' ? 'por semana' : 'por día'} (unidades)`, 'Ingresos: entradas, devoluciones, ajustes + y pedidos cancelados. Egresos: salidas, ajustes − y pedidos.', agrupar,
            leyenda(['Ingresos'], ['Egresos', 'alt']),
            barras(filas.map(o => ({ label: etiquetaPeriodo(o.k, g), text: `+${o.entra} / −${o.sale}`,
              series: [{ value: o.entra, title: `Ingresos: ${o.entra} u.` }, { value: o.sale, fill: 'alt', title: `Egresos: ${o.sale} u.` }] })), maxU),
            csvBtn(`movimientos-por-${g}-${desde}-a-${hasta}.csv`, colsSerie, filas), dataTable(colsSerie, filas)),
          csvBtn(`movimientos-${desde}-a-${hasta}.csv`, cols, rows), dataTable(cols, rows.slice(0, 500)),
          rows.length > 500 ? el('p', { class: 'muted', text: `Se muestran 500 de ${rows.length}. El CSV incluye todos.` }) : null);
      } else {
        const porUser = new Map();
        for (const m of rows) {
          const o = porUser.get(m.usuario_id) || { usuario: m.usuario, n: 0, unidades: 0, tipos: {} , ultimo: m.creado_en };
          o.n++; o.unidades += m.cantidad; o.tipos[m.tipo] = (o.tipos[m.tipo] || 0) + 1;
          if (m.creado_en > o.ultimo) o.ultimo = m.creado_en;
          porUser.set(m.usuario_id, o);
        }
        const list = [...porUser.values()].sort((a, b) => b.n - a.n);
        const max = Math.max(...list.map(o => o.n));
        const cols = [{ label: 'Usuario', value: o => o.usuario }, { label: 'Movimientos', value: o => o.n, num: true }, { label: 'Unidades', value: o => o.unidades, num: true },
          { label: 'Detalle', value: o => Object.entries(o.tipos).map(([t, n]) => `${TIPO_MOV[t].text}: ${n}`).join(', ') }, { label: 'Último', value: o => fmtDate(o.ultimo) }];
        put(out,
          el('div', { class: 'card' }, el('h3', { text: 'Movimientos por usuario' }), el('div', { class: 'bars' }, ...list.map(o => {
            const fill = el('div', { class: 'bar-fill' }); fill.style.width = `${(o.n / max) * 100}%`;
            return el('div', { class: 'bar-row' }, el('span', { text: o.usuario }), el('div', { class: 'bar-track' }, fill), el('strong', { text: String(o.n) }));
          }))),
          csvBtn(`actividad-${desde}-a-${hasta}.csv`, cols, list), dataTable(cols, list));
      }
      return;
    }

    if (r === 'conteos') {
      const rows = await todasLasFilas(() => db().from('conteo_lineas')
        .select('cantidad_contada, cantidad_sistema, aplicada, contado_en, variantes(productos(nombre), tallas(nombre), colores(nombre)), conteos!inner(id, estado, creado_en, almacenes(nombre))')
        .gte('conteos.creado_en', rango.desde).lte('conteos.creado_en', rango.hasta).order('contado_en', { ascending: false }).order('conteo_id').order('variante_id'));
      if (!rows.length) return sinDatos('No hay conteos físicos en ese período', 'Se necesitan conteos registrados desde la herramienta de almacén (pestaña Conteos).');
      const diffs = rows.filter(x => x.cantidad_contada !== x.cantidad_sistema);
      const cols = [{ label: 'Fecha', value: x => fmtDate(x.contado_en) }, { label: 'Almacén', value: x => x.conteos.almacenes?.nombre },
        { label: 'Producto', value: x => `${x.variantes?.productos?.nombre}${x.variantes?.tallas ? ' · T' + x.variantes.tallas.nombre : ''}${x.variantes?.colores ? ' · ' + x.variantes.colores.nombre : ''}` },
        { label: 'Sistema', value: x => x.cantidad_sistema, num: true }, { label: 'Contado', value: x => x.cantidad_contada, num: true },
        { label: 'Diferencia', value: x => { const d = x.cantidad_contada - x.cantidad_sistema; return (d > 0 ? '+' : '') + d; }, num: true },
        { label: 'Estado', value: x => x.aplicada ? 'Ajuste aplicado' : x.conteos.estado === 'abierto' ? 'Pendiente de revisión' : x.conteos.estado === 'anulado' ? 'Conteo anulado' : 'No aplicado' }];
      put(out,
        el('div', { class: 'kpi-grid' },
          el('div', { class: 'kpi' }, el('span', { text: 'Líneas contadas' }), el('strong', { text: String(rows.length) })),
          el('div', { class: 'kpi warn' }, el('span', { text: 'Con diferencia' }), el('strong', { text: String(diffs.length) })),
          el('div', { class: 'kpi' }, el('span', { text: 'Unidades de diferencia (neto)' }), el('strong', { text: String(diffs.reduce((s, x) => s + x.cantidad_contada - x.cantidad_sistema, 0)) }))),
        diffs.length ? [csvBtn(`diferencias-conteo-${desde}-a-${hasta}.csv`, cols, diffs), dataTable(cols, diffs)]
          : emptyState({ icon: 'check', title: 'Sin diferencias', text: 'Todo lo contado coincidió con el stock registrado.' }));
      return;
    }

    if (r === 'ia') {
      let rows;
      try { rows = await escaneos(rango); }
      catch (e) {
        if (/escaneos_ia|PGRST205|42P01/.test(`${e.code} ${e.message}`)) return sinDatos('Falta el registro de escaneos', 'Aplica supabase/migrations/0004_escaneos_ia.sql en la base para guardar las propuestas de la cámara.');
        throw e;
      }
      if (!rows.length) return sinDatos('No hay escaneos en ese período', 'Este reporte se genera con las propuestas de la cámara en la herramienta de almacén y lo que el personal hizo con ellas: confirmarlas, corregirlas o descartarlas.');
      const nombres = new Map((await perfiles().catch(() => [])).map(p => [p.id, p.nombre]));
      const por = {}; for (const x of rows) por[x.resultado] = (por[x.resultado] || 0) + 1;
      const conf = por.confirmado || 0, corr = por.corregido || 0, revisados = conf + corr;
      const dudosos = rows.filter(x => x.dudoso && ['confirmado', 'corregido'].includes(x.resultado));
      const sinAviso = rows.filter(x => !x.dudoso && x.resultado === 'corregido').length;
      const pctTxt = (a, b) => b ? `${Math.round(a / b * 100)} %` : '—';
      const kpi = (label, value, warn = false) => el('div', { class: 'kpi' + (warn ? ' warn' : '') }, el('span', { text: label }), el('strong', { text: String(value) }));

      // Acierto por clase propuesta (solo escaneos con respuesta)
      const clases = new Map();
      for (const x of rows) {
        if (!['confirmado', 'corregido'].includes(x.resultado)) continue;
        const o = clases.get(x.clase_predicha) || { clase: x.clase_predicha, ok: 0, n: 0 };
        o.n++; if (x.resultado === 'confirmado') o.ok++;
        clases.set(x.clase_predicha, o);
      }
      const porClase = [...clases.values()].sort((a, b) => a.ok / a.n - b.ok / b.n || b.n - a.n);
      // Confusiones: lo que propuso la cámara frente a lo que eligió la persona
      const conf2 = new Map();
      for (const x of rows.filter(x => x.resultado === 'corregido')) {
        const k = `${x.clase_predicha} → ${x.confirmado?.nombre || '(producto eliminado)'}`;
        conf2.set(k, (conf2.get(k) || 0) + 1);
      }
      const confusiones = [...conf2].map(([k, n]) => ({ k, n })).sort((a, b) => b.n - a.n);
      const top = confusiones.slice(0, 10);

      const RES = { pendiente: 'Sin respuesta', confirmado: 'Confirmado', corregido: 'Corregido', descartado: 'Descartado' };
      const cols = [{ label: 'Fecha', value: x => fmtDate(x.creado_en) }, { label: 'Usuario', value: x => nombres.get(x.usuario_id) || '—' }, { label: 'Almacén', value: x => x.almacenes?.nombre || '—' },
        { label: 'Modelo', value: x => x.modelo }, { label: 'Clase propuesta', value: x => x.clase_predicha }, { label: 'Confianza', value: x => pctTxt(Number(x.confianza), 1), csv: x => x.confianza, num: true },
        { label: 'Segunda clase', value: x => x.clase_alternativa ? `${x.clase_alternativa} (${pctTxt(Number(x.confianza_alternativa), 1)})` : '—' },
        { label: 'Pidió confirmación', value: x => x.dudoso ? 'Sí' : 'No' }, { label: 'Motivo', value: x => x.motivo_duda || '—' },
        { label: 'Resultado', value: x => RES[x.resultado] }, { label: 'Producto elegido', value: x => x.confirmado?.nombre || '—' }];
      put(out,
        el('div', { class: 'kpi-grid' },
          kpi('Escaneos', rows.length), kpi('Confirmados', conf), kpi('Corregidos', corr, corr > 0),
          kpi('Descartados', por.descartado || 0), kpi('Sin respuesta', por.pendiente || 0),
          kpi('Acierto confirmado', pctTxt(conf, revisados)),
          kpi('Pidieron confirmación', dudosos.length), kpi('Errores sin aviso', sinAviso, sinAviso > 0)),
        el('p', { class: 'muted', text: 'Acierto confirmado = confirmados ÷ (confirmados + corregidos). Los descartados y los que quedaron sin respuesta no cuentan, porque nadie dijo si la cámara acertó. «Errores sin aviso» son correcciones que la cámara propuso sin pedir confirmación.' }),
        revisados ? [
          tarjeta('Acierto por clase propuesta', 'Primero las clases con peor acierto. Pasa el cursor por una barra para ver los totales.',
            barras(porClase.map(o => ({ label: o.clase, text: `${pctTxt(o.ok, o.n)} · ${o.ok}/${o.n}`, series: [{ value: o.ok / o.n, title: `${o.ok} confirmados de ${o.n}` }] })), 1)),
          top.length ? tarjeta('Clases más confundidas', `Propuesta de la cámara → producto que eligió la persona. Top ${top.length} de ${confusiones.length}.`,
            barras(top.map(x => ({ label: x.k, text: String(x.n), series: [{ value: x.n, fill: 'alt' }] })), top[0].n))
            : emptyState({ icon: 'check', title: 'Sin confusiones', text: 'Ninguna propuesta de la cámara fue corregida en este período.' }),
          dudosos.length ? el('p', { class: 'muted', text: `De las ${dudosos.length} propuestas que pidieron confirmación, ${dudosos.filter(x => x.resultado === 'corregido').length} eran un error (${pctTxt(dudosos.filter(x => x.resultado === 'corregido').length, dudosos.length)}).` }) : null]
          : emptyState({ icon: 'chart', title: 'Todavía nadie confirmó ni corrigió una propuesta', text: 'El acierto se calcula cuando el personal responde «Sí, es correcto» o elige otro producto.' }),
        csvBtn(`escaneos-ia-${desde}-a-${hasta}.csv`, cols, rows), dataTable(cols, rows.slice(0, 500)),
        rows.length > 500 ? el('p', { class: 'muted', text: `Se muestran 500 de ${rows.length}. El CSV incluye todos.` }) : null);
      return;
    }

    if (r === 'ventas') {
      const rows = await pedidos({ ...rango, limit: 100000 });
      if (!rows.length) return sinDatos('No hay pedidos en ese período', 'Este reporte se genera con los pedidos que los clientes hacen desde la tienda virtual.');
      const porEstado = {}; const prod = new Map(); let total = 0;
      const serie = new Map(periodos(desde, hasta, g).map(k => [k, { k, n: 0, importe: 0 }]));
      for (const o of rows) {
        porEstado[o.estado] = (porEstado[o.estado] || 0) + 1;
        if (o.estado === 'cancelado') continue;
        total += Number(o.total);
        const s = serie.get(clavePeriodo(o.creado_en, g));
        if (s) { s.n++; s.importe += Number(o.total); }
        for (const l of o.pedido_lineas) {
          const k = `${l.producto_nombre}${l.detalle ? ' · ' + l.detalle : ''}`;
          const x = prod.get(k) || { k, n: 0, importe: 0 }; x.n += l.cantidad; x.importe += l.cantidad * Number(l.precio_unitario); prod.set(k, x);
        }
      }
      const top = [...prod.values()].sort((a, b) => b.n - a.n);
      const validos = rows.filter(o => o.estado !== 'cancelado').length;
      const cols = [{ label: 'Artículo', value: x => x.k }, { label: 'Unidades', value: x => x.n, num: true }, { label: 'Importe', value: x => money(x.importe), csv: x => x.importe.toFixed(2), num: true }];
      const filas = [...serie.values()];
      const colsSerie = [{ label: g === 'semana' ? 'Semana (desde el lunes)' : 'Día', value: s => etiquetaPeriodo(s.k, g) }, { label: 'Pedidos', value: s => s.n, num: true },
        { label: 'Importe', value: s => money(s.importe), csv: s => s.importe.toFixed(2), num: true }];
      const top10 = top.slice(0, 10);
      put(out,
        el('div', { class: 'kpi-grid' },
          el('div', { class: 'kpi' }, el('span', { text: 'Pedidos (no cancelados)' }), el('strong', { text: String(validos) })),
          el('div', { class: 'kpi' }, el('span', { text: 'Importe pedido' }), el('strong', { text: money(total) })),
          el('div', { class: 'kpi' }, el('span', { text: 'Ticket promedio' }), el('strong', { text: validos ? money(total / validos) : '—' })),
          ...Object.entries(porEstado).map(([e, n]) => el('div', { class: 'kpi' }, el('span', { text: ESTADO_PEDIDO[e]?.text || e }), el('strong', { text: String(n) })))),
        el('p', { class: 'muted', text: 'Importe de pedidos registrados (sin pago en línea): no equivale a ingresos cobrados.' }),
        validos ? [
          tarjeta(`Importe pedido ${g === 'semana' ? 'por semana' : 'por día'}`, 'Pedidos no cancelados, según la fecha en que se hicieron.', agrupar,
            barras(filas.map(s => ({ label: etiquetaPeriodo(s.k, g), text: `${money(s.importe)} · ${s.n} ped.`, series: [{ value: s.importe }] })), Math.max(...filas.map(s => s.importe))),
            csvBtn(`ventas-por-${g}-${desde}-a-${hasta}.csv`, colsSerie, filas)),
          top10.length ? tarjeta('Productos más vendidos', `Top ${top10.length} de ${top.length} artículos por unidades pedidas. Pasa el cursor por una barra para ver el importe.`,
            barras(top10.map(x => ({ label: x.k, text: `${x.n} u.`, series: [{ value: x.n, title: money(x.importe) }] })), top10[0].n)) : null,
          top.length ? [el('h3', { text: 'Artículos más pedidos' }), csvBtn(`pedidos-articulos-${desde}-a-${hasta}.csv`, cols, top), dataTable(cols, top)] : null]
          : emptyState({ icon: 'chart', title: 'Todos los pedidos del período están cancelados', text: 'Los gráficos de ventas solo cuentan pedidos no cancelados.' }));
    }
  } catch (e) { out.replaceChildren(emptyState({ icon: 'alert', kind: 'err', title: 'No se pudo generar el reporte', text: errText(e) })); }
}
