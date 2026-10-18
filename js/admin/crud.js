/* ------------------------------------------------------------------ *
 * Gestión genérica de datos maestros. Escriben directamente en las tablas:
 * RLS solo lo permite a administradores activos. Si un registro está en
 * uso, la base impide borrarlo y se ofrece desactivarlo.
 * ------------------------------------------------------------------ */
import { el, emptyState, loading, snack, errText, confirmDialog } from '../ui.js';
import { db, unwrap } from '../supabase.js';
import { dataTable, formDialog } from './util.js';

const activo = (label = 'Activo') => ({ k: 'activo', label, type: 'bool' });
const dot = hex => { const s = el('span', { class: 'color-dot', 'aria-hidden': 'true' }); s.style.background = hex; return s; };
const estadoTag = r => el('span', { class: 'tag ' + (r.activo ? 'ok' : 'muted'), text: r.activo ? 'Activo' : 'Inactivo' });

export const ENTIDADES = {
  marcas: {
    titulo: 'Marcas', singular: 'marca', tabla: 'marcas', orden: ['nombre'],
    vacio: 'Registra las marcas que comercializas para poder asignarlas a los productos.',
    campos: () => [{ k: 'nombre', label: 'Nombre', required: true, max: 80 }, activo('Activa')],
    cols: [{ label: 'Nombre', value: r => r.nombre }, { label: 'Estado', value: estadoTag }],
  },
  categorias: {
    titulo: 'Categorías', singular: 'categoría', tabla: 'categorias', orden: ['orden', 'nombre'],
    vacio: 'Crea categorías (por ejemplo, por público o tipo de calzado). Pueden tener subcategorías.',
    campos: (rows, actual) => [
      { k: 'nombre', label: 'Nombre', required: true, max: 80 },
      { k: 'padre_id', label: 'Categoría superior', type: 'select', empty: '— Ninguna (principal) —', options: rows.filter(r => !actual || r.id !== actual.id).map(r => ({ value: r.id, text: r.nombre })) },
      { k: 'orden', label: 'Orden en el menú', type: 'number', min: 0, help: 'Menor número = aparece antes.' },
      activo('Activa')],
    defaults: { orden: 0 },
    cols: [{ label: 'Nombre', value: r => r.nombre }, { label: 'Superior', value: (r, all) => r.padre_id ? (all.find(x => x.id === r.padre_id)?.nombre || '—') : '—' }, { label: 'Orden', value: r => r.orden, num: true }, { label: 'Estado', value: estadoTag }],
  },
  tallas: {
    titulo: 'Tallas', singular: 'talla', tabla: 'tallas', orden: ['orden', 'nombre'],
    vacio: 'Registra las tallas que manejas (por ejemplo, la numeración de calzado que usa la empresa).',
    campos: () => [{ k: 'nombre', label: 'Talla', required: true, max: 20 }, { k: 'orden', label: 'Orden', type: 'number', min: 0, help: 'Para mostrarlas de menor a mayor.' }, activo('Activa')],
    defaults: { orden: 0 },
    cols: [{ label: 'Talla', value: r => r.nombre }, { label: 'Orden', value: r => r.orden, num: true }, { label: 'Estado', value: estadoTag }],
  },
  colores: {
    titulo: 'Colores', singular: 'color', tabla: 'colores', orden: ['nombre'],
    vacio: 'Registra los colores de tus modelos. El código de color es opcional y sirve para la muestra en la tienda.',
    campos: () => [{ k: 'nombre', label: 'Nombre', required: true, max: 60 }, { k: 'hex', label: 'Código de color (opcional)', type: 'color', help: 'Formato #RRGGBB.' }, activo()],
    cols: [{ label: 'Color', value: r => el('span', {}, r.hex ? dot(r.hex) : null, r.nombre) }, { label: 'Código', value: r => r.hex || '—' }, { label: 'Estado', value: estadoTag }],
  },
  sucursales: {
    titulo: 'Sucursales', singular: 'sucursal', tabla: 'sucursales', orden: ['nombre'],
    vacio: 'Registra tus sucursales. Las activas aparecen en la tienda como puntos de retiro.',
    campos: () => [{ k: 'nombre', label: 'Nombre', required: true, max: 120 }, { k: 'direccion', label: 'Dirección', max: 300 }, { k: 'telefono', label: 'Teléfono', max: 30 }, activo('Activa')],
    cols: [{ label: 'Nombre', value: r => r.nombre }, { label: 'Dirección', value: r => r.direccion }, { label: 'Teléfono', value: r => r.telefono }, { label: 'Estado', value: estadoTag }],
  },
  almacenes: {
    titulo: 'Almacenes', singular: 'almacén', tabla: 'almacenes', orden: ['nombre'], select: '*, sucursales(nombre)',
    vacio: 'Registra al menos un almacén para poder cargar existencias y usar la herramienta de almacén.',
    extra: async () => ({ sucursales: unwrap(await db().from('sucursales').select('id, nombre').order('nombre')) }),
    campos: (rows, actual, x) => [
      { k: 'nombre', label: 'Nombre', required: true, max: 120 },
      { k: 'sucursal_id', label: 'Sucursal', type: 'select', empty: '— Sin sucursal —', options: x.sucursales.map(s => ({ value: s.id, text: s.nombre })) },
      { k: 'vende_en_linea', label: 'Su stock cuenta para la tienda en línea', type: 'bool' },
      activo()],
    cols: [{ label: 'Nombre', value: r => r.nombre }, { label: 'Sucursal', value: r => r.sucursales?.nombre || '—' },
      { label: 'Tienda en línea', value: r => r.vende_en_linea ? 'Sí' : 'No' }, { label: 'Estado', value: estadoTag }],
  },
};

export async function renderCrud(main, key) {
  const E = ENTIDADES[key];
  main.replaceChildren(loading());
  let rows, extra = {};
  try {
    let q = db().from(E.tabla).select(E.select || '*');
    for (const o of E.orden) q = q.order(o);
    [rows, extra] = await Promise.all([q.then(unwrap), E.extra ? E.extra() : {}]);
  } catch (e) {
    main.replaceChildren(emptyState({ icon: 'alert', kind: 'err', title: `No se pudieron cargar las ${E.titulo.toLowerCase()}`, text: errText(e) }));
    return;
  }
  const strip = r => { const o = { ...r }; delete o.sucursales; return o; };
  const edit = async (actual = null) => {
    const saved = await formDialog({
      title: actual ? `Editar ${E.singular}` : `Nueva ${E.singular}`.replace('Nueva almacén', 'Nuevo almacén').replace('Nueva color', 'Nuevo color'),
      fields: E.campos(rows, actual, extra), values: actual ? strip(actual) : { ...(E.defaults || {}) },
      onSubmit: async v => {
        if (actual) unwrap(await db().from(E.tabla).update(v).eq('id', actual.id));
        else unwrap(await db().from(E.tabla).insert(v));
      },
    });
    if (saved) { snack('Guardado'); renderCrud(main, key); }
  };
  const del = async r => {
    if (!await confirmDialog({ title: `¿Eliminar «${r.nombre}»?`, text: 'Si está en uso, no se podrá eliminar: en ese caso, desactívalo.', ok: 'Eliminar', danger: true })) return;
    try { unwrap(await db().from(E.tabla).delete().eq('id', r.id)); snack('Eliminado'); renderCrud(main, key); }
    catch (e) {
      if (e.code === '23503' && r.activo && await confirmDialog({ title: 'No se puede eliminar', text: `«${r.nombre}» está en uso por otros registros. ¿Quieres desactivarlo? Dejará de ofrecerse, pero se conserva el historial.`, ok: 'Desactivar' })) {
        try { unwrap(await db().from(E.tabla).update({ activo: false }).eq('id', r.id)); snack('Desactivado'); renderCrud(main, key); } catch (e2) { snack(errText(e2), 'err'); }
      } else snack(errText(e), 'err');
    }
  };

  const head = el('div', { class: 'page-head' }, el('h2', { text: E.titulo }),
    el('button', { class: 'btn primary', type: 'button', text: `Agregar ${E.singular}`, onclick: () => edit() }));
  const cols = [...E.cols.map(c => ({ ...c, value: r => c.value(r, rows) })), { label: '', value: r => el('div', { class: 'cell-actions' },
    el('button', { class: 'btn small', type: 'button', text: 'Editar', onclick: () => edit(r) }),
    el('button', { class: 'btn small danger', type: 'button', text: 'Eliminar', onclick: () => del(r) })) }];
  main.replaceChildren(head, rows.length ? dataTable(cols, rows)
    : emptyState({ icon: 'list', title: `Todavía no hay ${E.titulo.toLowerCase()} registradas`.replace('registradas', key === 'almacenes' || key === 'colores' ? 'registrados' : 'registradas'), text: E.vacio, action: { label: `Agregar ${E.singular}`, onClick: () => edit() } }));
}
