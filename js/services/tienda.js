/* ------------------------------------------------------------------ *
 * Datos PÚBLICOS de la tienda. Solo usa las vistas tienda_* y la función
 * tienda_disponibilidad(), que nunca devuelven cantidades de stock.
 * ------------------------------------------------------------------ */
import { db, unwrap } from '../supabase.js';

let cache = null;

/** Catálogo publicado completo (productos, variantes, imágenes, maestros y disponibilidad). */
export async function cargarCatalogo(force = false) {
  if (cache && !force) return cache;
  const c = db();
  const [productos, variantes, imagenes, marcas, categorias, tallas, colores, sucursales, dispo] = await Promise.all([
    c.from('tienda_productos').select('*').order('creado_en', { ascending: false }).limit(2000),
    c.from('tienda_variantes').select('*').limit(20000),
    c.from('tienda_imagenes').select('*').order('orden').limit(20000),
    c.from('tienda_marcas').select('*').order('nombre'),
    c.from('tienda_categorias').select('*').order('orden').order('nombre'),
    c.from('tienda_tallas').select('*').order('orden').order('nombre'),
    c.from('tienda_colores').select('*').order('nombre'),
    c.from('tienda_sucursales').select('*').order('nombre'),
    c.rpc('tienda_disponibilidad'),
  ].map(p => p.then(unwrap)));

  const byId = (rows) => new Map(rows.map(r => [r.id, r]));
  const estado = new Map(dispo.map(d => [d.variante_id, d.estado]));
  const M = { marcas: byId(marcas), categorias: byId(categorias), tallas: byId(tallas), colores: byId(colores) };

  const varsPorProd = new Map();
  for (const v of variantes) {
    v.estado = estado.get(v.id) || 'agotado';
    v.talla = M.tallas.get(v.talla_id) || null;
    v.color = M.colores.get(v.color_id) || null;
    if (!varsPorProd.has(v.producto_id)) varsPorProd.set(v.producto_id, []);
    varsPorProd.get(v.producto_id).push(v);
  }
  const imgsPorProd = new Map();
  for (const i of imagenes) {
    if (!imgsPorProd.has(i.producto_id)) imgsPorProd.set(i.producto_id, []);
    imgsPorProd.get(i.producto_id).push(i);
  }
  const RANK = { disponible: 2, pocas: 1, agotado: 0 };
  for (const p of productos) {
    p.variantes = (varsPorProd.get(p.id) || []).sort((a, b) => (a.talla?.orden ?? 0) - (b.talla?.orden ?? 0) || String(a.talla?.nombre || '').localeCompare(String(b.talla?.nombre || ''), 'es', { numeric: true }));
    p.imagenes = imgsPorProd.get(p.id) || [];
    p.marca = M.marcas.get(p.marca_id) || null;
    p.categoria = M.categorias.get(p.categoria_id) || null;
    const best = p.variantes.reduce((m, v) => Math.max(m, RANK[v.estado]), 0);
    p.estado = p.variantes.length ? ['agotado', 'pocas', 'disponible'][best] : 'agotado';
    const precios = p.variantes.map(v => Number(v.precio)).filter(n => n > 0);
    p.precioDesde = precios.length ? Math.min(...precios) : Number(p.precio);
    p.precioVaria = precios.length > 1 && Math.min(...precios) !== Math.max(...precios);
  }
  cache = { productos, marcas, categorias, tallas, colores, sucursales, M };
  return cache;
}
export const invalidarCatalogo = () => { cache = null; };

/** URL pública de una imagen del bucket «productos». */
export function imagenUrl(ruta) {
  return db().storage.from('productos').getPublicUrl(ruta).data.publicUrl;
}

/** Ids de una categoría y todas sus subcategorías. */
export function idsCategoria(categorias, rootId) {
  const ids = new Set([rootId]);
  let added = true;
  while (added) {
    added = false;
    for (const c of categorias) if (c.padre_id && ids.has(c.padre_id) && !ids.has(c.id)) { ids.add(c.id); added = true; }
  }
  return ids;
}

/* ---------- pedidos del cliente ---------- */
export async function crearPedido({ lineas, entrega, sucursalId, direccion, telefono, notas }) {
  return unwrap(await db().rpc('crear_pedido', {
    p_lineas: lineas, p_entrega: entrega, p_sucursal_id: sucursalId || null,
    p_direccion: direccion || '', p_telefono: telefono || '', p_notas: notas || '',
  }));
}

export async function misPedidos() {
  return unwrap(await db().from('pedidos')
    .select('id, estado, entrega, total, creado_en, sucursal_id, direccion, telefono, notas, pedido_lineas(id, producto_nombre, detalle, cantidad, precio_unitario), pedido_historial(estado_nuevo, creado_en, nota)')
    .order('creado_en', { ascending: false }).limit(100));
}

export async function cancelarMiPedido(id) {
  return unwrap(await db().rpc('cancelar_mi_pedido', { p_pedido_id: id }));
}

export async function actualizarCliente(id, { nombre, telefono }) {
  return unwrap(await db().from('clientes').update({ nombre, telefono }).eq('id', id));
}

export const ESTADO_PEDIDO = {
  pendiente: { text: 'Pendiente', cls: 'warn' },
  confirmado: { text: 'Confirmado', cls: '' },
  preparando: { text: 'En preparación', cls: '' },
  enviado: { text: 'Enviado', cls: '' },
  entregado: { text: 'Entregado', cls: 'ok' },
  cancelado: { text: 'Cancelado', cls: 'muted' },
};
