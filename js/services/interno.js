/* ------------------------------------------------------------------ *
 * Datos INTERNOS (personal: lector, operador, admin). La base aplica los
 * permisos con RLS y funciones seguras; aquí solo se consultan y se llaman.
 * El stock nunca se escribe directamente: siempre mediante funciones
 * atómicas que registran el movimiento en la misma transacción.
 * ------------------------------------------------------------------ */
import { db, unwrap, todasLasFilas } from '../supabase.js';
import { deviceId } from '../prefs.js';

/* ---------- maestros ---------- */
export async function maestros() {
  const c = db();
  const [marcas, categorias, tallas, colores, sucursales, almacenes] = await Promise.all([
    c.from('marcas').select('*').order('nombre'),
    c.from('categorias').select('*').order('orden').order('nombre'),
    c.from('tallas').select('*').order('orden').order('nombre'),
    c.from('colores').select('*').order('nombre'),
    c.from('sucursales').select('*').order('nombre'),
    c.from('almacenes').select('*, sucursales(nombre)').order('nombre'),
  ].map(p => p.then(unwrap)));
  return { marcas, categorias, tallas, colores, sucursales, almacenes };
}

export const nombreAlmacen = a => a ? (a.sucursales ? `${a.sucursales.nombre} · ${a.nombre}` : a.nombre) : '—';
export const nombreVariante = v => [v.tallas?.nombre && `Talla ${v.tallas.nombre}`, v.colores?.nombre].filter(Boolean).join(' · ') || 'Única';

/* ---------- productos ---------- */
const PROD_COLS = 'id, nombre, modelo, descripcion, precio, estado, publicado, etiqueta_clasificador, marca_id, categoria_id, creado_en, actualizado_en, marcas(nombre), categorias(nombre)';
const VAR_COLS = 'id, producto_id, talla_id, color_id, sku, precio, activo, tallas(nombre, orden), colores(nombre, hex)';

export async function listarProductos({ q = '', limit = 500 } = {}) {
  let query = db().from('productos').select(PROD_COLS).order('nombre').limit(limit);
  const t = q.trim().replace(/[%,()]/g, ' ');
  if (t) query = query.or(`nombre.ilike.%${t}%,modelo.ilike.%${t}%,etiqueta_clasificador.ilike.%${t}%`);
  return unwrap(await query);
}

export async function producto(id) {
  return unwrap(await db().from('productos').select(PROD_COLS).eq('id', id).single());
}

/** Producto vinculado a una etiqueta del clasificador (null si no hay). */
export async function productoPorEtiqueta(label) {
  return unwrap(await db().from('productos').select(PROD_COLS).eq('etiqueta_clasificador', label).maybeSingle());
}

export async function variantesDe(productoId) {
  const rows = unwrap(await db().from('variantes').select(VAR_COLS).eq('producto_id', productoId));
  return rows.sort((a, b) => (a.tallas?.orden ?? 0) - (b.tallas?.orden ?? 0)
    || String(a.tallas?.nombre || '').localeCompare(String(b.tallas?.nombre || ''), 'es', { numeric: true })
    || String(a.colores?.nombre || '').localeCompare(String(b.colores?.nombre || ''), 'es'));
}

/* ---------- existencias ---------- */
export async function existencias({ almacenId = null, productoId = null, varianteIds = null, soloBajo = false, q = '' } = {}) {
  const t = q.trim().replace(/[%,()]/g, ' ');
  return todasLasFilas(() => {
    let query = db().from('v_existencias').select('*').order('producto').order('talla').order('variante_id').order('almacen_id');
    if (almacenId) query = query.eq('almacen_id', almacenId);
    if (productoId) query = query.eq('producto_id', productoId);
    if (varianteIds) query = query.in('variante_id', varianteIds);
    if (soloBajo) query = query.eq('bajo_minimo', true);
    if (t) query = query.or(`producto.ilike.%${t}%,modelo.ilike.%${t}%,sku.ilike.%${t}%`);
    return query;
  });
}

export async function registrarMovimiento({ varianteId, almacenId, tipo, cantidad, motivo = '', referencia = '', origen = 'manual' }) {
  const rows = unwrap(await db().rpc('registrar_movimiento_inventario', {
    p_variante_id: varianteId, p_almacen_id: almacenId, p_tipo: tipo, p_cantidad: cantidad,
    p_motivo: motivo, p_referencia: referencia || null, p_origen: origen, p_dispositivo: deviceId(),
  }));
  return rows[0];
}

export async function configurarExistencia({ varianteId, almacenId, stockMinimo, ubicacion }) {
  return unwrap(await db().rpc('configurar_existencia', {
    p_variante_id: varianteId, p_almacen_id: almacenId, p_stock_minimo: stockMinimo, p_ubicacion: ubicacion || '',
  }));
}

/* ---------- movimientos ---------- */
export async function movimientos({ desde = null, hasta = null, almacenId = null, tipo = null, usuarioId = null, varianteId = null, limit = 500 } = {}) {
  return todasLasFilas(() => {
    let query = db().from('v_movimientos').select('*').order('creado_en', { ascending: false }).order('id', { ascending: false });
    if (desde) query = query.gte('creado_en', desde);
    if (hasta) query = query.lte('creado_en', hasta);
    if (almacenId) query = query.eq('almacen_id', almacenId);
    if (tipo) query = query.eq('tipo', tipo);
    if (usuarioId) query = query.eq('usuario_id', usuarioId);
    if (varianteId) query = query.eq('variante_id', varianteId);
    return query;
  }, limit);
}

export const TIPO_MOV = {
  entrada: { text: 'Entrada', signo: '+', cls: 'ok' },
  salida: { text: 'Salida', signo: '−', cls: 'danger' },
  devolucion: { text: 'Devolución', signo: '+', cls: 'ok' },
  ajuste_positivo: { text: 'Ajuste +', signo: '+', cls: '' },
  ajuste_negativo: { text: 'Ajuste −', signo: '−', cls: 'warn' },
  pedido: { text: 'Pedido', signo: '−', cls: '' },
  pedido_cancelado: { text: 'Pedido cancelado', signo: '+', cls: 'muted' },
};

/* ---------- conteos ---------- */
export async function conteos({ almacenId = null, estado = null, limit = 100 } = {}) {
  let query = db().from('conteos').select('*, almacenes(nombre, sucursales(nombre)), conteo_lineas(count)').order('creado_en', { ascending: false }).limit(limit);
  if (almacenId) query = query.eq('almacen_id', almacenId);
  if (estado) query = query.eq('estado', estado);
  return unwrap(await query);
}
export async function conteo(id) {
  return unwrap(await db().from('conteos').select('*, almacenes(nombre, sucursales(nombre))').eq('id', id).single());
}
export async function lineasConteo(id) {
  return todasLasFilas(() => db().from('conteo_lineas')
    .select('*, variantes(id, sku, productos(nombre, modelo), tallas(nombre), colores(nombre))')
    .eq('conteo_id', id).order('contado_en').order('variante_id'));
}
export const crearConteo = (almacenId, notas) => db().rpc('conteo_crear', { p_almacen_id: almacenId, p_notas: notas || '' }).then(unwrap);
export const registrarLinea = (conteoId, varianteId, cantidad) => db().rpc('conteo_registrar_linea', { p_conteo_id: conteoId, p_variante_id: varianteId, p_cantidad: cantidad }).then(unwrap);
export const quitarLinea = (conteoId, varianteId) => db().rpc('conteo_quitar_linea', { p_conteo_id: conteoId, p_variante_id: varianteId }).then(unwrap);
export const aplicarConteo = (conteoId, variantes = null) => db().rpc('conteo_aplicar', { p_conteo_id: conteoId, p_variantes: variantes }).then(unwrap);
export const anularConteo = conteoId => db().rpc('conteo_anular', { p_conteo_id: conteoId }).then(unwrap);

/* ---------- pedidos (personal) ---------- */
export async function pedidos({ estado = null, desde = null, hasta = null, limit = 300 } = {}) {
  return todasLasFilas(() => {
    let query = db().from('pedidos')
      .select('*, clientes(nombre, telefono), sucursales(nombre), pedido_lineas(id, producto_nombre, detalle, cantidad, precio_unitario, variante_id, pedido_asignaciones(cantidad, almacenes(nombre)))')
      .order('creado_en', { ascending: false }).order('id', { ascending: false });
    if (estado) query = query.eq('estado', estado);
    if (desde) query = query.gte('creado_en', desde);
    if (hasta) query = query.lte('creado_en', hasta);
    return query;
  }, limit);
}
export async function pedido(id) {
  return unwrap(await db().from('pedidos')
    .select('*, clientes(nombre, telefono), sucursales(nombre, direccion), pedido_lineas(id, producto_nombre, detalle, cantidad, precio_unitario, pedido_asignaciones(cantidad, almacenes(nombre)))')
    .eq('id', id).maybeSingle());
}
export async function historialPedido(id) {
  return unwrap(await db().from('pedido_historial').select('*').eq('pedido_id', id).order('creado_en'));
}
export const cambiarEstadoPedido = (id, estado, nota) => db().rpc('pedido_cambiar_estado', { p_pedido_id: id, p_estado: estado, p_nota: nota || '' }).then(unwrap);
export const SIGUIENTES_ESTADOS = {
  pendiente: ['confirmado', 'cancelado'],
  confirmado: ['preparando', 'cancelado'],
  preparando: ['enviado', 'entregado', 'cancelado'],
  enviado: ['entregado'],
  entregado: [], cancelado: [],
};

/* ---------- usuarios y configuración ---------- */
export const listarUsuarios = () => db().rpc('admin_listar_usuarios').then(unwrap);
export const asignarRol = (id, rol, activo, nombre) => db().rpc('admin_asignar_rol', { p_usuario_id: id, p_rol: rol, p_activo: activo, p_nombre: nombre ?? null }).then(unwrap);
export async function configTienda() {
  return unwrap(await db().from('config_tienda').select('*').maybeSingle());
}
export const guardarConfigTienda = (agotado, pocas) => db().rpc('config_tienda_guardar', { p_umbral_agotado: agotado, p_umbral_pocas: pocas }).then(unwrap);
export async function perfiles() {
  return unwrap(await db().from('perfiles').select('id, nombre, rol, activo').order('nombre'));
}

/* ---------- escaneos de la cámara (métricas de la IA; sin imágenes, no tocan el stock) ---------- */
export const registrarEscaneo = ({ modelo, clase, confianza, alternativa = null, confianzaAlternativa = null, dudoso = false, motivo = null, almacenId = null }) =>
  db().rpc('escaneo_registrar', {
    p_modelo: modelo, p_clase: clase, p_confianza: confianza, p_clase_alternativa: alternativa, p_confianza_alternativa: confianzaAlternativa,
    p_dudoso: dudoso, p_motivo_duda: motivo, p_almacen_id: almacenId,
  }).then(unwrap);
/** resultado: 'confirmado' | 'corregido' | 'descartado'. La base corrige «corregido» al mismo producto como «confirmado». */
export const resolverEscaneo = (id, resultado, productoId = null) =>
  db().rpc('escaneo_resolver', { p_id: id, p_resultado: resultado, p_producto_id: productoId }).then(unwrap);
export async function escaneos({ desde = null, hasta = null, limit = 100000 } = {}) {
  return todasLasFilas(() => {
    let query = db().from('escaneos_ia')
      .select('*, predicho:productos!escaneos_ia_producto_predicho_fkey(nombre), confirmado:productos!escaneos_ia_producto_confirmado_fkey(nombre), almacenes(nombre)')
      .order('creado_en', { ascending: false }).order('id');
    if (desde) query = query.gte('creado_en', desde);
    if (hasta) query = query.lte('creado_en', hasta);
    return query;
  }, limit);
}

/* ---------- mercado (referencia externa: Excel del caso Manaco) ---------- */
export async function mercadoComercio() {
  return todasLasFilas(() => db().from('mercado_comercio')
    .select('pais_reportante, flujo, anio, codigo_sa6, categoria, socio, valor_usd, pares, valor_usd_por_par')
    .order('anio').order('flujo').order('valor_usd', { ascending: false }).order('id'));
}
