/* ------------------------------------------------------------------ *
 * Resumen y reportes. Todo se calcula a partir de la base de datos; sin
 * registros, cada reporte explica qué datos necesita. Nada se simula.
 * ------------------------------------------------------------------ */
import { el, emptyState, loading, errText, fmtDate, fmtMoney, todayISO, startOfDay, endOfDay } from '../ui.js';
import { db, unwrap } from '../supabase.js';
import { existencias, movimientos, pedidos, maestros, nombreAlmacen, TIPO_MOV } from '../services/interno.js';
import { ESTADO_PEDIDO } from '../services/tienda.js';
import { dataTable, downloadCsv } from './util.js';

const money = v => fmtMoney(v, true);
const count = async (table, f = q => q) => {
  const { count: n, error } = await f(db().from(table).select('*', { count: 'exact', head: true }));
  if (error) throw error;
  return n || 0;
};

/* =================================================================== *
 * Resumen
 * =================================================================== */
export async function renderResumen(main) {
  main.replaceChildren(loading());
  try {
    const [nProd, nPub, nVar, nAlm, nTallas, nPend, nMovHoy, stock] = await Promise.all([
      count('productos'), count('productos', q => q.eq('publicado', true).eq('estado', 'activo')), count('variantes'), count('almacenes', q => q.eq('activo', true)),
      count('tallas'), count('pedidos', q => q.eq('estado', 'pendiente')), count('movimientos_inventario', q => q.gte('creado_en', startOfDay())),
      existencias(),
    ]);
    const unidades = stock.reduce((s, r) => s + r.cantidad, 0);
    const bajos = stock.filter(r => r.bajo_minimo).length;
    const kpi = (label, value, href, warn = false) => el('a', { class: 'kpi' + (warn ? ' warn' : ''), href, style: 'text-decoration:none' }, el('span', { text: label }), el('strong', { text: String(value) }));
    const steps = [
      [nAlm > 0, 'Registra tus sucursales y almacenes', '#/almacenes'],
      [nTallas > 0, 'Crea las tallas, colores, marcas y categorías', '#/tallas'],
      [nProd > 0, 'Registra tu primer producto', '#/productos'],
      [nVar > 0, 'Agrega sus variantes (talla y color)', '#/productos'],
      [unidades > 0, 'Carga las existencias con una entrada de mercadería', '#/productos'],
      [nPub > 0, 'Publica el producto en la tienda', '#/productos'],
    ];
    const pending = steps.filter(s => !s[0]).length;
    main.replaceChildren(
      el('div', { class: 'kpi-grid' },
        kpi('Productos', nProd, '#/productos'), kpi('Publicados en tienda', nPub, '#/productos'), kpi('Variantes', nVar, '#/productos'),
        kpi('Unidades en stock', unidades, '#/reportes?r=stock'), kpi('Variantes bajo el mínimo', bajos, '#/reportes?r=bajo', bajos > 0),
        kpi('Pedidos pendientes', nPend, '#/pedidos?estado=pendiente', nPend > 0), kpi('Movimientos hoy', nMovHoy, '#/reportes?r=movimientos')),
      pending ? el('div', { class: 'card' }, el('h3', { text: 'Primeros pasos' }),
        el('p', { class: 'muted', style: 'margin-bottom:12px', text: 'El sistema empieza vacío. Sigue estos pasos para registrar tu primer producto real.' }),
        el('ol', { class: 'steps' }, ...steps.map(([done, t, href], i) => el('li', { class: done ? 'done' : '' },
          el('span', { class: 'n', text: done ? '✓' : String(i + 1) }), el('div', { text: t }), done ? null : el('a', { class: 'btn small', href, text: 'Ir' }))))) : null);
  } catch (e) { main.replaceChildren(emptyState({ icon: 'alert', kind: 'err', title: 'No se pudo cargar el resumen', text: errText(e) })); }
}

/* =================================================================== *
 * Reportes
 * =================================================================== */
const REPORTES = [
  ['stock', 'Stock actual'], ['bajo', 'Bajo stock'], ['movimientos', 'Entradas y salidas'],
  ['conteos', 'Diferencias de conteo'], ['actividad', 'Actividad por usuario'], ['ventas', 'Pedidos y ventas'],
];

export async function renderReportes(main, go, params) {
  const r = params.get('r') || 'stock';
  const hace30 = new Date(Date.now() - 29 * 864e5); const pad = n => String(n).padStart(2, '0');
  const desde = params.get('desde') || `${hace30.getFullYear()}-${pad(hace30.getMonth() + 1)}-${pad(hace30.getDate())}`;
  const hasta = params.get('hasta') || todayISO();
  const nav = (k, extra = {}) => { const p = new URLSearchParams({ r: k, desde, hasta, ...extra }); go('#/reportes?' + p); };
  const usesDates = ['movimientos', 'conteos', 'actividad', 'ventas'].includes(r);
  const dIn = el('input', { type: 'date', class: 'input', value: desde, max: todayISO(), 'aria-label': 'Desde' });
  const hIn = el('input', { type: 'date', class: 'input', value: hasta, max: todayISO(), 'aria-label': 'Hasta' });
  const apply = () => { const p = new URLSearchParams({ r, desde: dIn.value || desde, hasta: hIn.value || hasta }); go('#/reportes?' + p); };
  dIn.addEventListener('change', apply); hIn.addEventListener('change', apply);
  const out = el('div', { class: 'stack' }, loading());
  main.replaceChildren(
    el('div', { class: 'page-head' }, el('h2', { text: 'Reportes' }), usesDates ? el('div', { class: 'row' }, el('span', { class: 'muted', text: 'Desde' }), dIn, el('span', { class: 'muted', text: 'hasta' }), hIn) : null),
    el('div', { class: 'subtabs', role: 'tablist' }, ...REPORTES.map(([k, t]) => el('button', { type: 'button', role: 'tab', 'aria-selected': String(k === r), text: t, onclick: () => nav(k) }))),
    out);
  const rango = { desde: startOfDay(desde), hasta: endOfDay(hasta) };
  const csvBtn = (name, cols, rows) => el('div', { class: 'actions' }, el('button', { class: 'btn small', type: 'button', text: 'Descargar CSV', onclick: () => downloadCsv(name, cols, rows) }));
  const sinDatos = (title, text) => out.replaceChildren(emptyState({ icon: 'chart', title, text }));

  try {
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
      out.replaceChildren(
        r === 'stock' ? el('div', { class: 'kpi-grid' }, ...[...porAlm].map(([id, n]) => el('div', { class: 'kpi' }, el('span', { text: almName.get(id) || '—' }), el('strong', { text: String(n) })))) : null,
        csvBtn(`${r === 'bajo' ? 'bajo-stock' : 'stock'}-${todayISO()}.csv`, cols, rows),
        dataTable(cols, rows, { rowClass: x => x.bajo_minimo ? 'low' : '' }));
      return;
    }

    if (r === 'movimientos' || r === 'actividad') {
      const rows = await movimientos({ ...rango, limit: 10000 });
      if (!rows.length) return sinDatos('No hay movimientos en ese período', 'Este reporte se genera con las entradas, salidas, devoluciones, ajustes y pedidos registrados en el rango de fechas elegido.');
      if (r === 'movimientos') {
        const tot = {}; const porDia = new Map();
        for (const m of rows) {
          tot[m.tipo] = (tot[m.tipo] || 0) + m.cantidad;
          const d = fmtDate(m.creado_en, false);   // día LOCAL, no UTC
          const o = porDia.get(d) || { d, entra: 0, sale: 0, n: 0 };
          if (TIPO_MOV[m.tipo].signo === '+') o.entra += m.cantidad; else o.sale += m.cantidad;
          o.n++; porDia.set(d, o);
        }
        const cols = [{ label: 'Fecha', value: m => fmtDate(m.creado_en) }, { label: 'Tipo', value: m => TIPO_MOV[m.tipo].text }, { label: 'Producto', value: m => `${m.producto}${m.talla ? ' · T' + m.talla : ''}${m.color ? ' · ' + m.color : ''}` },
          { label: 'Almacén', value: m => m.almacen }, { label: 'Cantidad', value: m => TIPO_MOV[m.tipo].signo + m.cantidad, num: true }, { label: 'Saldo', value: m => m.saldo, num: true },
          { label: 'Usuario', value: m => m.usuario }, { label: 'Motivo', value: m => m.motivo || '—' }, { label: 'Referencia', value: m => m.referencia || '—' }];
        out.replaceChildren(
          el('div', { class: 'kpi-grid' }, ...Object.entries(tot).map(([t, n]) => el('div', { class: 'kpi' }, el('span', { text: TIPO_MOV[t].text }), el('strong', { text: String(n) })))),
          el('div', { class: 'card' }, el('h3', { text: 'Por día (unidades)' }), dataTable([{ label: 'Día', value: o => o.d }, { label: 'Movimientos', value: o => o.n, num: true }, { label: 'Ingresos', value: o => '+' + o.entra, num: true }, { label: 'Egresos', value: o => '−' + o.sale, num: true }], [...porDia.values()])),
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
        out.replaceChildren(
          el('div', { class: 'card' }, el('h3', { text: 'Movimientos por usuario' }), el('div', { class: 'bars' }, ...list.map(o => {
            const fill = el('div', { class: 'bar-fill' }); fill.style.width = `${(o.n / max) * 100}%`;
            return el('div', { class: 'bar-row' }, el('span', { text: o.usuario }), el('div', { class: 'bar-track' }, fill), el('strong', { text: String(o.n) }));
          }))),
          csvBtn(`actividad-${desde}-a-${hasta}.csv`, cols, list), dataTable(cols, list));
      }
      return;
    }

    if (r === 'conteos') {
      const rows = unwrap(await db().from('conteo_lineas')
        .select('cantidad_contada, cantidad_sistema, aplicada, contado_en, variantes(productos(nombre), tallas(nombre), colores(nombre)), conteos!inner(id, estado, creado_en, almacenes(nombre))')
        .gte('conteos.creado_en', rango.desde).lte('conteos.creado_en', rango.hasta).order('contado_en', { ascending: false }).limit(5000));
      if (!rows.length) return sinDatos('No hay conteos físicos en ese período', 'Se necesitan conteos registrados desde la herramienta de almacén (pestaña Conteos).');
      const diffs = rows.filter(x => x.cantidad_contada !== x.cantidad_sistema);
      const cols = [{ label: 'Fecha', value: x => fmtDate(x.contado_en) }, { label: 'Almacén', value: x => x.conteos.almacenes?.nombre },
        { label: 'Producto', value: x => `${x.variantes?.productos?.nombre}${x.variantes?.tallas ? ' · T' + x.variantes.tallas.nombre : ''}${x.variantes?.colores ? ' · ' + x.variantes.colores.nombre : ''}` },
        { label: 'Sistema', value: x => x.cantidad_sistema, num: true }, { label: 'Contado', value: x => x.cantidad_contada, num: true },
        { label: 'Diferencia', value: x => { const d = x.cantidad_contada - x.cantidad_sistema; return (d > 0 ? '+' : '') + d; }, num: true },
        { label: 'Estado', value: x => x.aplicada ? 'Ajuste aplicado' : x.conteos.estado === 'abierto' ? 'Pendiente de revisión' : x.conteos.estado === 'anulado' ? 'Conteo anulado' : 'No aplicado' }];
      out.replaceChildren(
        el('div', { class: 'kpi-grid' },
          el('div', { class: 'kpi' }, el('span', { text: 'Líneas contadas' }), el('strong', { text: String(rows.length) })),
          el('div', { class: 'kpi warn' }, el('span', { text: 'Con diferencia' }), el('strong', { text: String(diffs.length) })),
          el('div', { class: 'kpi' }, el('span', { text: 'Unidades de diferencia (neto)' }), el('strong', { text: String(diffs.reduce((s, x) => s + x.cantidad_contada - x.cantidad_sistema, 0)) }))),
        diffs.length ? [csvBtn(`diferencias-conteo-${desde}-a-${hasta}.csv`, cols, diffs), dataTable(cols, diffs)]
          : emptyState({ icon: 'check', title: 'Sin diferencias', text: 'Todo lo contado coincidió con el stock registrado.' }));
      return;
    }

    if (r === 'ventas') {
      const rows = await pedidos({ ...rango, limit: 5000 });
      if (!rows.length) return sinDatos('No hay pedidos en ese período', 'Este reporte se genera con los pedidos que los clientes hacen desde la tienda virtual.');
      const porEstado = {}; const prod = new Map(); let total = 0;
      for (const o of rows) {
        porEstado[o.estado] = (porEstado[o.estado] || 0) + 1;
        if (o.estado === 'cancelado') continue;
        total += Number(o.total);
        for (const l of o.pedido_lineas) {
          const k = `${l.producto_nombre}${l.detalle ? ' · ' + l.detalle : ''}`;
          const x = prod.get(k) || { k, n: 0, importe: 0 }; x.n += l.cantidad; x.importe += l.cantidad * Number(l.precio_unitario); prod.set(k, x);
        }
      }
      const top = [...prod.values()].sort((a, b) => b.n - a.n);
      const validos = rows.filter(o => o.estado !== 'cancelado').length;
      const cols = [{ label: 'Artículo', value: x => x.k }, { label: 'Unidades', value: x => x.n, num: true }, { label: 'Importe', value: x => money(x.importe), csv: x => x.importe.toFixed(2), num: true }];
      out.replaceChildren(
        el('div', { class: 'kpi-grid' },
          el('div', { class: 'kpi' }, el('span', { text: 'Pedidos (no cancelados)' }), el('strong', { text: String(validos) })),
          el('div', { class: 'kpi' }, el('span', { text: 'Importe pedido' }), el('strong', { text: money(total) })),
          el('div', { class: 'kpi' }, el('span', { text: 'Ticket promedio' }), el('strong', { text: validos ? money(total / validos) : '—' })),
          ...Object.entries(porEstado).map(([e, n]) => el('div', { class: 'kpi' }, el('span', { text: ESTADO_PEDIDO[e]?.text || e }), el('strong', { text: String(n) })))),
        el('p', { class: 'muted', text: 'Importe de pedidos registrados (sin pago en línea): no equivale a ingresos cobrados.' }),
        top.length ? [el('h3', { text: 'Artículos más pedidos' }), csvBtn(`pedidos-articulos-${desde}-a-${hasta}.csv`, cols, top), dataTable(cols, top)] : null);
    }
  } catch (e) { out.replaceChildren(emptyState({ icon: 'alert', kind: 'err', title: 'No se pudo generar el reporte', text: errText(e) })); }
}
