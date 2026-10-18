/* ------------------------------------------------------------------ *
 * Productos: datos, variantes (talla × color), imágenes y existencias.
 * Las cantidades nunca se editan a mano: se registran como movimientos
 * atómicos (con confirmación) y quedan en el historial.
 * ------------------------------------------------------------------ */
import { el, emptyState, loading, snack, errText, confirmDialog, fmtMoney, debounce, setMsg } from '../ui.js';
import { db, unwrap } from '../supabase.js';
import { maestros, listarProductos, producto, variantesDe, existencias, configurarExistencia, registrarMovimiento, nombreAlmacen, nombreVariante, TIPO_MOV } from '../services/interno.js';
import { DEFAULT_MODEL } from '../classifier/model.js';
import { PREFS_KEY } from '../prefs.js';
import { imagenUrl } from '../services/tienda.js';
import { dataTable, formDialog } from './util.js';

const money = v => fmtMoney(v, true);

/** Etiquetas del modelo de Teachable Machine (sin cargar TensorFlow). */
let labelsCache = null;
async function modelLabels() {
  if (labelsCache) return labelsCache;
  let base = DEFAULT_MODEL;
  try { const p = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null'); if (p && p.customUrl) base = p.customUrl; } catch (_) {}
  try {
    const r = await fetch(base + 'metadata.json', { cache: 'no-store' });
    const m = await r.json();
    labelsCache = Array.isArray(m.labels) ? m.labels : [];
  } catch (_) { labelsCache = []; }
  return labelsCache;
}

/* =================================================================== *
 * Listado
 * =================================================================== */
export async function renderProductos(main, go) {
  const q = el('input', { type: 'search', class: 'input', placeholder: 'Buscar por nombre, modelo o etiqueta IA', 'aria-label': 'Buscar productos', style: 'max-width:360px' });
  const list = el('div');
  const load = async () => {
    list.replaceChildren(loading());
    try {
      const rows = await listarProductos({ q: q.value });
      if (!rows.length) {
        list.replaceChildren(q.value ? emptyState({ icon: 'search', title: 'Sin resultados' })
          : emptyState({ icon: 'shoe', title: 'Todavía no hay productos registrados', text: 'Registra tu primer producto. Antes conviene crear sus marcas, categorías, tallas y colores.', action: { label: 'Nuevo producto', onClick: () => editProducto(null, go) } }));
        return;
      }
      list.replaceChildren(dataTable([
        { label: 'Producto', value: r => el('a', { href: `#/producto/${r.id}`, text: r.nombre }) },
        { label: 'Modelo', value: r => r.modelo || '—' },
        { label: 'Marca', value: r => r.marcas?.nombre || '—' },
        { label: 'Categoría', value: r => r.categorias?.nombre || '—' },
        { label: 'Precio', value: r => money(r.precio), num: true },
        { label: 'Tienda', value: r => el('span', { class: 'tag ' + (r.publicado && r.estado === 'activo' ? 'ok' : 'muted'), text: r.publicado && r.estado === 'activo' ? 'Publicado' : r.estado === 'activo' ? 'Oculto' : 'Inactivo' }) },
        { label: 'Etiqueta IA', value: r => r.etiqueta_clasificador || '—' },
      ], rows));
    } catch (e) { list.replaceChildren(emptyState({ icon: 'alert', kind: 'err', title: 'No se pudieron cargar los productos', text: errText(e) })); }
  };
  q.addEventListener('input', debounce(load, 350));
  main.replaceChildren(el('div', { class: 'page-head' }, el('h2', { text: 'Productos' }),
    el('div', { class: 'row' }, q, el('button', { class: 'btn primary', type: 'button', text: 'Nuevo producto', onclick: () => editProducto(null, go) }))), list);
  load();
}

async function editProducto(actual, go) {
  let m, labels;
  try { [m, labels] = await Promise.all([maestros(), modelLabels()]); } catch (e) { snack(errText(e), 'err'); return; }
  const dl = el('datalist', { id: 'tmLabels' }, ...labels.map(l => el('option', { value: l })));
  document.body.append(dl);
  const saved = await formDialog({
    title: actual ? 'Editar producto' : 'Nuevo producto',
    values: actual || { estado: 'activo', publicado: false },
    fields: [
      { k: 'nombre', label: 'Nombre', required: true, max: 200 },
      { k: 'modelo', label: 'Modelo / código', max: 80, nullable: true },
      { k: 'marca_id', label: 'Marca', type: 'select', options: m.marcas.filter(x => x.activo || x.id === actual?.marca_id).map(x => ({ value: x.id, text: x.nombre })) },
      { k: 'categoria_id', label: 'Categoría', type: 'select', options: m.categorias.filter(x => x.activo || x.id === actual?.categoria_id).map(x => ({ value: x.id, text: x.nombre })) },
      { k: 'precio', label: 'Precio de venta', type: 'money', required: true, help: 'Las variantes pueden tener un precio propio. Con precio 0 no se puede pedir en línea.' },
      { k: 'descripcion', label: 'Descripción', type: 'textarea', max: 4000 },
      { k: 'etiqueta_clasificador', label: 'Etiqueta del reconocimiento por cámara', max: 200, nullable: true, list: 'tmLabels',
        help: labels.length ? `Debe coincidir exactamente con una etiqueta del modelo (${labels.length} disponibles).` : 'Etiqueta exacta del modelo de Teachable Machine. Déjala vacía si no se reconoce por cámara.' },
      { k: 'estado', label: 'Estado', type: 'select', required: true, options: [{ value: 'activo', text: 'Activo' }, { value: 'inactivo', text: 'Inactivo' }] },
      { k: 'publicado', label: 'Publicar en la tienda virtual', type: 'bool', default: false },
    ],
    onSubmit: async v => {
      if (v.etiqueta_clasificador && labels.length && !labels.includes(v.etiqueta_clasificador)) throw Object.assign(new Error('La etiqueta no existe en el modelo de reconocimiento actual.'), { code: 'P0001' });
      const row = { ...v };
      if (actual) { unwrap(await db().from('productos').update(row).eq('id', actual.id)); return actual.id; }
      return unwrap(await db().from('productos').insert(row).select('id').single()).id;
    },
  });
  dl.remove();
  if (saved) { snack('Producto guardado'); go(`#/producto/${typeof saved === 'string' ? saved : actual.id}`); }
}

/* =================================================================== *
 * Ficha
 * =================================================================== */
export async function renderProducto(main, id, go, tab = 'datos') {
  main.replaceChildren(loading());
  let p, m, vars;
  try { [p, m, vars] = await Promise.all([producto(id), maestros(), variantesDe(id)]); }
  catch (e) { main.replaceChildren(emptyState({ icon: 'alert', kind: 'err', title: 'No se pudo abrir el producto', text: errText(e) })); return; }

  const tabs = [['datos', 'Datos'], ['variantes', `Variantes (${vars.length})`], ['imagenes', 'Imágenes'], ['existencias', 'Existencias']];
  const body = el('div', { class: 'stack' });
  const sub = el('div', { class: 'subtabs', role: 'tablist' }, ...tabs.map(([k, t]) => el('button', { type: 'button', role: 'tab', 'aria-selected': String(k === tab), text: t,
    onclick: () => renderProducto(main, id, go, k) })));
  main.replaceChildren(
    el('a', { href: '#/productos', text: '← Productos' }),
    el('div', { class: 'page-head' }, el('h2', { text: p.nombre }),
      el('span', { class: 'tag ' + (p.publicado && p.estado === 'activo' ? 'ok' : 'muted'), text: p.publicado && p.estado === 'activo' ? 'Publicado en la tienda' : 'No visible en la tienda' })),
    sub, body);
  const reload = t => renderProducto(main, id, go, t);

  if (tab === 'datos') {
    body.append(el('div', { class: 'card' }, el('dl', { class: 'facts' },
      el('dt', { text: 'Modelo' }), el('dd', { text: p.modelo || '—' }),
      el('dt', { text: 'Marca' }), el('dd', { text: p.marcas?.nombre || '—' }),
      el('dt', { text: 'Categoría' }), el('dd', { text: p.categorias?.nombre || '—' }),
      el('dt', { text: 'Precio' }), el('dd', { text: money(p.precio) }),
      el('dt', { text: 'Estado' }), el('dd', { text: p.estado }),
      el('dt', { text: 'Etiqueta IA' }), el('dd', { text: p.etiqueta_clasificador || '— (no se reconoce por cámara)' }),
      el('dt', { text: 'Descripción' }), el('dd', { text: p.descripcion || '—', style: 'white-space:pre-line' }))),
    el('div', { class: 'actions' },
      el('button', { class: 'btn danger', type: 'button', text: 'Eliminar producto', onclick: async () => {
        if (!await confirmDialog({ title: `¿Eliminar «${p.nombre}»?`, text: 'Solo es posible si no tiene movimientos ni pedidos. Si los tiene, márcalo como inactivo.', ok: 'Eliminar', danger: true })) return;
        try { unwrap(await db().from('productos').delete().eq('id', id)); snack('Producto eliminado'); go('#/productos'); }
        catch (e) { snack(e.code === '23503' ? 'Tiene historial: no se puede eliminar. Márcalo como inactivo.' : errText(e), 'err'); }
      } }),
      el('button', { class: 'btn primary', type: 'button', text: 'Editar datos', onclick: () => editProducto(p, go).then(() => reload('datos')) })));
    if (!vars.length) body.append(el('p', { class: 'notice', text: 'Para vender o registrar stock, agrega al menos una variante (talla y/o color) en la pestaña «Variantes».' }));
  }

  if (tab === 'variantes') {
    const tallas = m.tallas.filter(t => t.activo), colores = m.colores.filter(c => c.activo);
    const addBtn = el('button', { class: 'btn primary', type: 'button', text: 'Agregar variantes', onclick: async () => {
      if (!tallas.length && !colores.length) { snack('Primero registra tallas o colores en sus secciones.', 'err'); return; }
      const tChecks = tallas.map(t => ({ t, cb: el('input', { type: 'checkbox' }) }));
      const color = el('select', { class: 'input' }, el('option', { value: '', text: '— Sin color —' }), ...colores.map(c => el('option', { value: c.id, text: c.nombre })));
      const precio = el('input', { class: 'input', type: 'number', step: '0.01', min: '0', placeholder: `Igual al producto (${money(p.precio)})` });
      const msg = el('p', { class: 'msg' });
      const ok = await confirmDialog({ title: 'Agregar variantes', ok: 'Crear variantes', body: el('div', { class: 'stack' },
        el('div', { class: 'field' }, el('span', { class: 'label', text: 'Color' }), color),
        tallas.length ? el('div', { class: 'field' }, el('span', { class: 'label', text: 'Tallas (una variante por talla)' }), el('div', { class: 'check-grid' }, ...tChecks.map(({ t, cb }) => el('label', {}, cb, t.nombre)))) : null,
        el('div', { class: 'field' }, el('span', { class: 'label', text: 'Precio propio (opcional)' }), precio), msg) });
      if (!ok) return;
      const sel = tChecks.filter(x => x.cb.checked).map(x => x.t.id);
      const pr = precio.value === '' ? null : Math.round(Number(precio.value) * 100) / 100;
      if (pr !== null && !(pr >= 0)) { snack('Precio no válido.', 'err'); return; }
      const rows = (sel.length ? sel : [null]).map(talla_id => ({ producto_id: id, talla_id, color_id: color.value || null, precio: pr }));
      if (rows.length === 1 && !rows[0].talla_id && !rows[0].color_id && vars.length) { snack('Elige al menos una talla o un color.', 'err'); return; }
      try { unwrap(await db().from('variantes').insert(rows)); snack(`${rows.length} variante(s) creada(s)`); reload('variantes'); }
      catch (e) { snack(e.code === '23505' ? 'Alguna de esas combinaciones talla/color ya existe.' : errText(e), 'err'); }
    } });
    body.append(el('div', { class: 'actions' }, addBtn));
    if (!vars.length) body.append(emptyState({ icon: 'tag', title: 'Este producto no tiene variantes', text: 'Cada combinación de talla y color es una variante con su propio stock.' }));
    else body.append(dataTable([
      { label: 'Variante', value: v => nombreVariante(v) },
      { label: 'SKU', value: v => v.sku || '—' },
      { label: 'Precio', value: v => v.precio === null ? `${money(p.precio)} (producto)` : money(v.precio), num: true },
      { label: 'Estado', value: v => el('span', { class: 'tag ' + (v.activo ? 'ok' : 'muted'), text: v.activo ? 'Activa' : 'Inactiva' }) },
      { label: '', value: v => el('div', { class: 'cell-actions' },
        el('button', { class: 'btn small', type: 'button', text: 'Editar', onclick: async () => {
          const s = await formDialog({ title: `Variante ${nombreVariante(v)}`, values: v, fields: [
            { k: 'sku', label: 'SKU / código de barras', max: 60, nullable: true },
            { k: 'precio', label: 'Precio propio (vacío = precio del producto)', type: 'money' },
            { k: 'activo', label: 'Activa (se vende y se puede registrar)', type: 'bool' }],
          onSubmit: async x => unwrap(await db().from('variantes').update(x).eq('id', v.id)) });
          if (s !== null) reload('variantes');
        } }),
        el('button', { class: 'btn small danger', type: 'button', text: 'Eliminar', onclick: async () => {
          if (!await confirmDialog({ title: `¿Eliminar la variante ${nombreVariante(v)}?`, text: 'Solo es posible si no tiene movimientos ni pedidos.', ok: 'Eliminar', danger: true })) return;
          try { unwrap(await db().from('variantes').delete().eq('id', v.id)); snack('Variante eliminada'); reload('variantes'); }
          catch (e) { snack(e.code === '23503' ? 'Tiene historial: desactívala en lugar de eliminarla.' : errText(e), 'err'); }
        } })) },
    ], vars));
  }

  if (tab === 'imagenes') {
    let imgs = [];
    try { imgs = unwrap(await db().from('producto_imagenes').select('*').eq('producto_id', id).order('orden')); }
    catch (e) { body.append(emptyState({ icon: 'alert', kind: 'err', title: 'No se pudieron cargar las imágenes', text: errText(e) })); return; }
    const file = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', id: 'imgFile' });
    const color = el('select', { class: 'input' }, el('option', { value: '', text: 'Todas las variantes' }), ...m.colores.map(c => el('option', { value: c.id, text: c.nombre })));
    const alt = el('input', { class: 'input', maxlength: '200', placeholder: 'Descripción breve (accesibilidad)' });
    const msg = el('p', { class: 'msg', role: 'status' });
    const up = el('button', { class: 'btn primary', type: 'button', text: 'Subir imagen', onclick: async () => {
      const f = file.files[0];
      if (!f) { setMsg(msg, 'Elige un archivo.', 'err'); return; }
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(f.type)) { setMsg(msg, 'Formato no admitido: usa JPG, PNG o WebP.', 'err'); return; }
      if (f.size > 5 * 1024 * 1024) { setMsg(msg, 'La imagen supera 5 MB.', 'err'); return; }
      up.disabled = true; setMsg(msg, 'Subiendo…');
      const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[f.type];
      const ruta = `${id}/${crypto.randomUUID ? crypto.randomUUID() : Date.now()}.${ext}`;
      try {
        unwrap(await db().storage.from('productos').upload(ruta, f, { contentType: f.type, upsert: false }));
        try { unwrap(await db().from('producto_imagenes').insert({ producto_id: id, ruta, color_id: color.value || null, alt: alt.value.trim(), orden: imgs.length })); }
        catch (e) { await db().storage.from('productos').remove([ruta]); throw e; }   // no deja archivos huérfanos
        snack('Imagen subida'); reload('imagenes');
      } catch (e) { console.error(e); setMsg(msg, e.statusCode === '403' || /security|policy/i.test(e.message || '') ? 'No tienes permiso para subir imágenes.' : errText(e), 'err'); up.disabled = false; }
    } });
    body.append(el('div', { class: 'card stack' }, el('h3', { text: 'Agregar imagen' }),
      el('div', { class: 'form-grid two' }, el('div', { class: 'field' }, el('label', { for: 'imgFile', text: 'Archivo (JPG, PNG o WebP, máx. 5 MB)' }), file),
        el('div', { class: 'field' }, el('span', { class: 'label', text: 'Color asociado' }), color),
        el('div', { class: 'field span2' }, el('span', { class: 'label', text: 'Texto alternativo' }), alt)), msg, el('div', { class: 'actions' }, up)));
    if (!imgs.length) body.append(emptyState({ icon: 'image', title: 'Este producto no tiene imágenes', text: 'En la tienda se mostrará un marcador «Sin imagen» hasta que subas fotos reales del producto.' }));
    else body.append(el('div', { class: 'thumb-grid' }, ...imgs.map(i => el('div', { class: 'thumb-card' },
      el('img', { src: imagenUrl(i.ruta), alt: i.alt || '', loading: 'lazy' }),
      el('div', { class: 'meta' }, el('span', { class: 'muted', text: i.color_id ? (m.colores.find(c => c.id === i.color_id)?.nombre || '') : 'Todas las variantes' }),
        el('button', { class: 'btn small danger', type: 'button', text: 'Eliminar', onclick: async () => {
          if (!await confirmDialog({ title: '¿Eliminar esta imagen?', ok: 'Eliminar', danger: true })) return;
          try { unwrap(await db().from('producto_imagenes').delete().eq('id', i.id)); await db().storage.from('productos').remove([i.ruta]); snack('Imagen eliminada'); reload('imagenes'); }
          catch (e) { snack(errText(e), 'err'); }
        } }))))));
  }

  if (tab === 'existencias') {
    const alms = m.almacenes.filter(a => a.activo);
    if (!vars.length) { body.append(emptyState({ icon: 'tag', title: 'Primero agrega variantes', text: 'El stock se registra por variante (talla/color) y almacén.' })); return; }
    if (!alms.length) { body.append(emptyState({ icon: 'store', title: 'No hay almacenes activos', text: 'Registra un almacén para poder cargar existencias.', action: { label: 'Ir a almacenes', onClick: () => go('#/almacenes') } })); return; }
    let ex = [];
    try { ex = await existencias({ productoId: id }); } catch (e) { body.append(emptyState({ icon: 'alert', kind: 'err', title: 'No se pudieron cargar las existencias', text: errText(e) })); return; }
    const key = (v, a) => `${v}|${a}`;
    const map = new Map(ex.map(r => [key(r.variante_id, r.almacen_id), r]));
    const rows = vars.flatMap(v => alms.map(a => ({ v, a, e: map.get(key(v.id, a.id)) })));
    body.append(el('p', { class: 'notice', text: 'Las cantidades solo cambian registrando movimientos (quedan en el historial con usuario y motivo). Aquí puedes definir el mínimo y la ubicación.' }),
      dataTable([
        { label: 'Variante', value: r => nombreVariante(r.v) },
        { label: 'Almacén', value: r => nombreAlmacen(r.a) },
        { label: 'Ubicación', value: r => r.e?.ubicacion || '—' },
        { label: 'Mínimo', value: r => r.e?.stock_minimo ?? 0, num: true },
        { label: 'Stock', value: r => r.e?.cantidad ?? 0, num: true },
        { label: '', value: r => el('div', { class: 'cell-actions' },
          el('button', { class: 'btn small', type: 'button', text: 'Mínimo/ubicación', onclick: async () => {
            const s = await formDialog({ title: `${nombreVariante(r.v)} · ${nombreAlmacen(r.a)}`, values: { stock_minimo: r.e?.stock_minimo ?? 0, ubicacion: r.e?.ubicacion || '' },
              fields: [{ k: 'stock_minimo', label: 'Stock mínimo (alerta de bajo stock)', type: 'number', min: 0, required: true }, { k: 'ubicacion', label: 'Ubicación física', max: 60, help: 'Ej.: pasillo 2, estante B.' }],
              onSubmit: x => configurarExistencia({ varianteId: r.v.id, almacenId: r.a.id, stockMinimo: x.stock_minimo, ubicacion: x.ubicacion }) });
            if (s) reload('existencias');
          } }),
          el('button', { class: 'btn small primary', type: 'button', text: 'Movimiento', onclick: () => movimientoDialog(p, r.v, r.a, r.e?.cantidad ?? 0).then(okk => okk && reload('existencias')) })) },
      ], rows, { rowClass: r => r.e && r.e.stock_minimo > 0 && r.e.cantidad <= r.e.stock_minimo ? 'low' : '' }));
  }
}

async function movimientoDialog(p, v, a, actual) {
  const saved = await formDialog({
    title: `Movimiento · ${p.nombre}`, submit: 'Registrar',
    fields: [
      { k: 'tipo', label: 'Tipo', type: 'select', required: true, options: ['entrada', 'salida', 'devolucion', 'ajuste_positivo', 'ajuste_negativo'].map(t => ({ value: t, text: TIPO_MOV[t].text })) },
      { k: 'cantidad', label: `Cantidad (stock actual en ${nombreAlmacen(a)}: ${actual})`, type: 'number', min: 1, required: true },
      { k: 'motivo', label: 'Motivo (obligatorio salvo en entradas)', max: 300 },
      { k: 'referencia', label: 'Referencia (opcional)', max: 120 },
    ],
    values: { tipo: 'entrada' },
    onSubmit: async x => {
      if (x.tipo !== 'entrada' && !x.motivo) throw Object.assign(new Error('Indica el motivo del movimiento'), { code: 'P0001' });
      const despues = actual + (TIPO_MOV[x.tipo].signo === '+' ? x.cantidad : -x.cantidad);
      if (!await confirmDialog({ title: 'Confirmar movimiento', ok: 'Registrar', text: `${TIPO_MOV[x.tipo].text} de ${x.cantidad} u. de ${nombreVariante(v)} en ${nombreAlmacen(a)}. Stock: ${actual} → ${despues}.` })) throw Object.assign(new Error('Movimiento no confirmado.'), { code: 'P0001' });
      return registrarMovimiento({ varianteId: v.id, almacenId: a.id, tipo: x.tipo, cantidad: x.cantidad, motivo: x.motivo, referencia: x.referencia });
    },
  });
  if (saved) snack(`Registrado. Stock actual: ${saved.saldo} u.`);
  return !!saved;
}
