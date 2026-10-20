/* ------------------------------------------------------------------ *
 * Resumen: tablero del estado del sistema (estilo Power BI).
 * Semáforo de salud, indicadores con variación respecto del período
 * anterior, gráficos de ventas, pedidos, stock y movimientos, y alertas.
 * Todo sale de la base; sin datos, cada tarjeta lo dice. Nada se simula.
 * ------------------------------------------------------------------ */
import { el, emptyState, loading, errText, fmtDate, fmtMoney, startOfDay, endOfDay } from '../ui.js';
import { db, todasLasFilas } from '../supabase.js';
import { existencias, movimientos, pedidos, maestros, TIPO_MOV } from '../services/interno.js';
import { ESTADO_PEDIDO } from '../services/tienda.js';
import { dataTable, barras, leyenda, tarjeta } from './util.js';
import { poner, columnas, kpi, dias, ymd, etiquetaDia, rangoAnterior } from './analitica/datos.js';

const money = v => fmtMoney(v, true);
const PERIODOS = [[7, '7 días'], [30, '30 días'], [90, '90 días'], [365, '12 meses']];
const COLORES_ESTADO = { pendiente: '#C98A00', confirmado: '#1F5FBF', preparando: '#5B8DEF', enviado: '#13305E', entregado: '#1D7A4C', cancelado: '#A0AEC0' };
const contar = async (tabla, f = q => q) => {
  const { count, error } = await f(db().from(tabla).select('*', { count: 'exact', head: true }));
  if (error) throw error;
  return count || 0;
};

/** Gráfico de dona (SVG) con leyenda. segmentos: [{ label, value, color }] */
function dona(segmentos, centro) {
  const total = segmentos.reduce((a, s) => a + s.value, 0);
  const ns = 'http://www.w3.org/2000/svg', R = 60, C = 2 * Math.PI * R;
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 160 160'); svg.setAttribute('class', 'rs-dona'); svg.setAttribute('role', 'img');
  let acc = 0;
  for (const s of segmentos.filter(x => x.value > 0)) {
    const c = document.createElementNS(ns, 'circle');
    c.setAttribute('cx', 80); c.setAttribute('cy', 80); c.setAttribute('r', R); c.setAttribute('fill', 'none');
    c.setAttribute('stroke', s.color); c.setAttribute('stroke-width', 24);
    c.setAttribute('stroke-dasharray', `${(s.value / total) * C} ${C}`); c.setAttribute('stroke-dashoffset', String(-acc));
    c.setAttribute('transform', 'rotate(-90 80 80)');
    const t = document.createElementNS(ns, 'title'); t.textContent = `${s.label}: ${s.value}`; c.append(t);
    svg.append(c); acc += (s.value / total) * C;
  }
  const tx = document.createElementNS(ns, 'text');
  tx.setAttribute('x', 80); tx.setAttribute('y', 86); tx.setAttribute('text-anchor', 'middle'); tx.setAttribute('class', 'rs-dona-centro'); tx.textContent = centro;
  svg.append(tx);
  return el('div', { class: 'rs-dona-wrap' }, svg,
    el('ul', { class: 'rs-dona-leyenda' }, ...segmentos.map(s => el('li', {}, el('i', { style: `background:${s.color}` }), el('span', { text: s.label }), el('strong', { text: `${s.value} · ${total ? Math.round((s.value / total) * 100) : 0} %` })))));
}

/** Tarjeta del semáforo: ok | warn | err */
const salud = (nivel, titulo, valor, detalle, href) => el('a', { class: `rs-salud ${nivel}`, href },
  el('span', { class: 'rs-luz', 'aria-hidden': 'true' }), el('div', {}, el('small', { text: titulo }), el('strong', { text: valor }), el('span', { class: 'muted', text: detalle })));

export async function renderResumen(main, go, params = new URLSearchParams()) {
  const n = Number(params.get('d')) || 30;
  const hoy = ymd(new Date());
  const ini = new Date(); ini.setDate(ini.getDate() - (n - 1));
  const rango = { desde: ymd(ini), hasta: hoy };
  const prev = rangoAnterior(rango);
  const out = el('div', { class: 'stack' }, loading('Calculando el estado del sistema…'));
  main.replaceChildren(
    el('div', { class: 'page-head' },
      el('div', {}, el('h2', { text: 'Estado del sistema' }), el('p', { class: 'muted', text: `Actualizado ${fmtDate(new Date().toISOString())}` })),
      el('div', { class: 'row', style: 'gap:6px; flex-wrap:wrap' },
        el('div', { class: 'subtabs', role: 'tablist', 'aria-label': 'Período' }, ...PERIODOS.map(([d, t]) =>
          el('button', { type: 'button', role: 'tab', 'aria-selected': String(d === n), text: t, onclick: () => go(`#/resumen?d=${d}`) }))),
        el('button', { class: 'btn small', type: 'button', text: 'Actualizar', onclick: () => renderResumen(main, go, params) }))),
    out);

  try {
    const r = { desde: startOfDay(rango.desde), hasta: endOfDay(rango.hasta) }, rp = { desde: startOfDay(prev.desde), hasta: endOfDay(prev.hasta) };
    const [stock, peds, pedsPrev, movs, M, prods, vars, imgs, nPendTodos, nConteos, sesiones] = await Promise.all([
      existencias(), pedidos({ ...r, limit: 100000 }), pedidos({ ...rp, limit: 100000 }), movimientos({ ...r, limit: 200000 }), maestros(),
      todasLasFilas(() => db().from('productos').select('id, nombre, precio, estado, publicado, categoria_id').order('id')),
      todasLasFilas(() => db().from('variantes').select('id, producto_id, precio, activo').order('id')),
      todasLasFilas(() => db().from('producto_imagenes').select('producto_id').order('id')),
      contar('pedidos', q => q.eq('estado', 'pendiente')), contar('conteos', q => q.eq('estado', 'abierto')),
      todasLasFilas(() => db().from('analitica_sesiones').select('visitante_id, convertida').gte('inicio', r.desde).lte('inicio', r.hasta).order('id')).catch(() => null),
    ]);

    // ---- Cálculos ----
    const validos = peds.filter(p => p.estado !== 'cancelado'), validosPrev = pedsPrev.filter(p => p.estado !== 'cancelado');
    const ventas = validos.reduce((a, p) => a + Number(p.total), 0), ventasPrev = validosPrev.reduce((a, p) => a + Number(p.total), 0);
    const uds = ps => ps.reduce((a, p) => a + p.pedido_lineas.reduce((b, l) => b + l.cantidad, 0), 0);
    const unidades = stock.reduce((a, s) => a + s.cantidad, 0);
    const precioVar = new Map(vars.map(v => [v.id, v.precio]));
    const prodPor = new Map(prods.map(p => [p.id, p]));
    const valorInv = stock.reduce((a, s) => a + s.cantidad * Number(precioVar.get(s.variante_id) ?? prodPor.get(s.producto_id)?.precio ?? 0), 0);
    const bajos = stock.filter(s => s.bajo_minimo);
    const agotadas = (() => { const t = new Map(); for (const s of stock) t.set(s.variante_id, (t.get(s.variante_id) || 0) + s.cantidad); return [...t.values()].filter(x => x <= 0).length; })();
    const pendientes = peds.filter(p => p.estado === 'pendiente');
    const viejos = pendientes.filter(p => Date.now() - new Date(p.creado_en) > 24 * 3600e3);
    const activos = prods.filter(p => p.estado === 'activo');
    const conVar = new Set(vars.filter(v => v.activo).map(v => v.producto_id)), conImg = new Set(imgs.map(i => i.producto_id));
    const sinVar = activos.filter(p => !conVar.has(p.id)).length, sinImg = activos.filter(p => p.publicado && !conImg.has(p.id)).length;
    const sinPrecio = vars.filter(v => v.activo && !(Number(v.precio ?? prodPor.get(v.producto_id)?.precio) > 0)).length;
    const problemasCat = sinVar + sinImg + sinPrecio;

    // ---- Semáforo ----
    const semaforo = el('div', { class: 'rs-semaforo' },
      salud(agotadas ? 'err' : bajos.length ? 'warn' : 'ok', 'Inventario', bajos.length ? `${bajos.length} bajo el mínimo` : 'En orden', `${agotadas} variantes agotadas · ${unidades} u. en stock`, '#/reportes?r=bajo'),
      salud(viejos.length ? 'err' : nPendTodos ? 'warn' : 'ok', 'Pedidos', nPendTodos ? `${nPendTodos} por atender` : 'Al día', viejos.length ? `${viejos.length} esperan más de 24 h` : 'Ninguno atrasado', '#/pedidos?estado=pendiente'),
      salud(problemasCat ? 'warn' : 'ok', 'Catálogo', problemasCat ? `${problemasCat} por completar` : 'Completo', `${sinVar} sin variantes · ${sinPrecio} sin precio · ${sinImg} sin foto`, '#/productos'),
      salud(nConteos ? 'warn' : 'ok', 'Conteos físicos', nConteos ? `${nConteos} abiertos` : 'Ninguno abierto', nConteos ? 'Aplícalos o anúlalos en el almacén' : 'Sin pendientes', '#/reportes?r=conteos'),
      sesiones ? salud('ok', 'Tienda en línea', `${new Set(sesiones.map(s => s.visitante_id)).size} visitantes`, `${sesiones.length} visitas · ${sesiones.length ? Math.round(sesiones.filter(s => s.convertida).length / sesiones.length * 1000) / 10 : 0} % compran`, '#/analitica') : null);

    // ---- Indicadores ----
    const indicadores = el('div', { class: 'kpi-grid' },
      kpi('Ventas (pedidos)', ventas, ventasPrev, { fmt: money, ayuda: 'Importe de pedidos no cancelados. No equivale a cobros.' }),
      kpi('Pedidos', validos.length, validosPrev.length),
      kpi('Ticket promedio', validos.length ? ventas / validos.length : 0, validosPrev.length ? ventasPrev / validosPrev.length : null, { fmt: money }),
      kpi('Unidades vendidas', uds(validos), uds(validosPrev)),
      kpi('Unidades en stock', unidades),
      kpi('Valor del inventario', valorInv, null, { fmt: money, ayuda: 'Unidades × precio de venta de cada variante.' }),
      kpi('Productos activos', activos.length),
      kpi('Publicados en tienda', activos.filter(p => p.publicado).length));

    // ---- Series diarias ----
    const ds = dias(rango.desde, rango.hasta);
    const agrupar = n > 92;   // un año se lee mejor por semana
    const clave = f => { const d = new Date(f); if (agrupar) d.setDate(d.getDate() - (d.getDay() + 6) % 7); return ymd(d); };
    const ejes = agrupar ? [...new Set(ds.map(d => clave(`${d}T12:00:00`)))] : ds;
    const serie = (lista, fecha, valor) => { const m = new Map(ejes.map(k => [k, 0])); for (const x of lista) { const k = clave(fecha(x)); if (m.has(k)) m.set(k, m.get(k) + valor(x)); } return ejes.map(k => m.get(k)); };
    const ventasSerie = serie(validos, p => p.creado_en, p => Number(p.total));
    const entra = serie(movs.filter(m => TIPO_MOV[m.tipo].signo === '+'), m => m.creado_en, m => m.cantidad);
    const sale = serie(movs.filter(m => TIPO_MOV[m.tipo].signo !== '+'), m => m.creado_en, m => m.cantidad);
    const etiquetas = ejes.map(k => (agrupar ? 'Sem. ' : '') + etiquetaDia(k));

    // ---- Agrupaciones ----
    const porEstado = Object.keys(ESTADO_PEDIDO).map(k => ({ label: ESTADO_PEDIDO[k].text, value: peds.filter(p => p.estado === k).length, color: COLORES_ESTADO[k] }));
    const sumarPor = (lista, k, v) => { const m = new Map(); for (const x of lista) { const kk = k(x); if (kk) m.set(kk, (m.get(kk) || 0) + v(x)); } return [...m].sort((a, b) => b[1] - a[1]); };
    const porAlmacen = sumarPor(stock, s => s.almacen, s => s.cantidad);
    const catNombre = new Map(M.categorias.map(c => [c.id, c.nombre]));
    const porCategoria = sumarPor(stock, s => catNombre.get(prodPor.get(s.producto_id)?.categoria_id) || 'Sin categoría', s => s.cantidad);
    const masVendidos = sumarPor(validos.flatMap(p => p.pedido_lineas), l => l.producto_nombre, l => l.cantidad).slice(0, 8);
    const barrasDe = (pares, fmt = v => String(v)) => pares.length
      ? barras(pares.slice(0, 8).map(([k, v]) => ({ label: k, text: fmt(v), series: [{ value: v }] })), pares[0][1])
      : el('p', { class: 'muted', text: 'Sin datos en el período.' });

    const vacio = !prods.length && !peds.length && !stock.length;
    poner(out,
      semaforo,
      indicadores,
      el('p', { class: 'muted', text: `Período: ${rango.desde.split('-').reverse().join('/')} – ${rango.hasta.split('-').reverse().join('/')}. Las flechas comparan con los ${n} días anteriores.` }),
      vacio ? el('div', { class: 'notice' }, 'El sistema todavía no tiene datos. Empieza en ', el('a', { href: '#/almacenes', text: 'Almacenes' }), ' y luego registra tus ', el('a', { href: '#/productos', text: 'productos' }), '.') : null,
      el('div', { class: 'rs-grid' },
        el('div', { class: 'rs-ancho' }, tarjeta(`Ventas ${agrupar ? 'por semana' : 'por día'}`, 'Importe de pedidos no cancelados.',
          columnas(etiquetas, [{ nombre: 'Ventas', valores: ventasSerie }], { fmt: money }))),
        tarjeta('Pedidos por estado', `${peds.length} pedidos en el período.`, peds.length ? dona(porEstado, String(peds.length)) : el('p', { class: 'muted', text: 'Sin pedidos en el período.' })),
        el('div', { class: 'rs-ancho' }, tarjeta(`Entradas y salidas de inventario ${agrupar ? 'por semana' : 'por día'}`, 'Unidades.', leyenda(['Entradas'], ['Salidas', 'alt']),
          columnas(etiquetas, [{ nombre: 'Entradas', valores: entra }, { nombre: 'Salidas', valores: sale, clase: 'alt' }]))),
        tarjeta('Productos más vendidos', 'Unidades pedidas.', barrasDe(masVendidos, v => `${v} u.`)),
        tarjeta('Stock por almacén', null, barrasDe(porAlmacen, v => `${v} u.`)),
        tarjeta('Stock por categoría', null, barrasDe(porCategoria, v => `${v} u.`)),
        tarjeta('Bajo el mínimo', `${bajos.length} variantes.`, bajos.length
          ? [dataTable([{ label: 'Producto', value: s => `${s.producto}${s.talla ? ' · T' + s.talla : ''}${s.color ? ' · ' + s.color : ''}` }, { label: 'Almacén', value: s => s.almacen },
            { label: 'Stock', value: s => s.cantidad, num: true }, { label: 'Mín.', value: s => s.stock_minimo, num: true }], [...bajos].sort((a, b) => a.cantidad - b.cantidad).slice(0, 8)),
          el('a', { class: 'btn small', href: '#/reportes?r=bajo', text: 'Ver todas' })]
          : el('p', { class: 'muted', text: 'Ninguna variante está bajo su mínimo.' })),
        tarjeta('Pedidos por atender', `${pendientes.length} pendientes en el período.`, pendientes.length
          ? [dataTable([{ label: 'Pedido', value: p => el('a', { href: `#/pedido/${p.id}`, text: `#${p.id}` }) }, { label: 'Cliente', value: p => p.clientes?.nombre || '—' },
            { label: 'Total', value: p => money(p.total), num: true }, { label: 'Hace', value: p => { const h = Math.round((Date.now() - new Date(p.creado_en)) / 3600e3); return h < 24 ? `${h} h` : `${Math.round(h / 24)} d`; } }],
          [...pendientes].sort((a, b) => a.creado_en.localeCompare(b.creado_en)).slice(0, 8)), el('a', { class: 'btn small', href: '#/pedidos?estado=pendiente', text: 'Ir a pedidos' })]
          : el('p', { class: 'muted', text: 'No hay pedidos pendientes.' })),
        el('div', { class: 'rs-ancho' }, tarjeta('Actividad reciente', 'Últimos movimientos de inventario.', movs.length
          ? dataTable([{ label: 'Fecha', value: m => fmtDate(m.creado_en) }, { label: 'Tipo', value: m => el('span', { class: 'tag ' + (TIPO_MOV[m.tipo].cls || ''), text: TIPO_MOV[m.tipo].text }) },
            { label: 'Producto', value: m => `${m.producto}${m.talla ? ' · T' + m.talla : ''}${m.color ? ' · ' + m.color : ''}` }, { label: 'Almacén', value: m => m.almacen },
            { label: 'Cantidad', value: m => TIPO_MOV[m.tipo].signo + m.cantidad, num: true }, { label: 'Usuario', value: m => m.usuario }], movs.slice(0, 10))
          : el('p', { class: 'muted', text: 'Sin movimientos en el período.' })))),
      pasosIniciales(M, prods, vars, unidades));
  } catch (e) { console.error(e); poner(out, emptyState({ icon: 'alert', kind: 'err', title: 'No se pudo cargar el resumen', text: errText(e) })); }
}

/** Guía para un sistema vacío: se oculta cuando todo está hecho. */
function pasosIniciales(M, prods, vars, unidades) {
  const steps = [
    [M.almacenes.some(a => a.activo), 'Registra tus sucursales y almacenes', '#/almacenes'],
    [M.tallas.length > 0, 'Crea las tallas, colores, marcas y categorías', '#/tallas'],
    [prods.length > 0, 'Registra tu primer producto', '#/productos'],
    [vars.length > 0, 'Agrega sus variantes (talla y color)', '#/productos'],
    [unidades > 0, 'Carga las existencias con una entrada de mercadería', '#/productos'],
    [prods.some(p => p.publicado && p.estado === 'activo'), 'Publica el producto en la tienda', '#/productos'],
  ];
  if (!steps.some(s => !s[0])) return null;
  return el('div', { class: 'card' }, el('h3', { text: 'Primeros pasos' }),
    el('p', { class: 'muted', style: 'margin-bottom:12px', text: 'El sistema empieza vacío. Sigue estos pasos para registrar tu primer producto real.' }),
    el('ol', { class: 'steps' }, ...steps.map(([done, t, href], i) => el('li', { class: done ? 'done' : '' },
      el('span', { class: 'n', text: done ? '✓' : String(i + 1) }), el('div', { text: t }), done ? null : el('a', { class: 'btn small', href, text: 'Ir' })))));
}

