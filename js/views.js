/* ------------------------------------------------------------------ *
 * Pantallas de inventario: panel, catálogo, existencias y movimientos.
 * Solo muestran datos reales de Supabase; sin datos, un estado vacío.
 * ------------------------------------------------------------------ */
import { el, emptyState, fmtDate, fmtMoney } from './ui.js';
import { listProducts } from './services/products.js';
import { listInventory } from './services/inventory.js';
import { listMovements } from './services/movements.js';

const DB_MSG = {
  'no-config': { icon: 'plug', title: 'Base de datos sin configurar', text: 'Copia js/config.example.js como js/config.js y completa la URL y la clave pública de tu proyecto de Supabase.' },
  'unsafe-key': { icon: 'alert', kind: 'err', title: 'Clave no permitida', text: 'js/config.js contiene una clave secreta o service_role. Reemplázala por la clave pública (publishable o anon) y rota la clave expuesta en Supabase.' },
  'bad-url': { icon: 'alert', kind: 'err', title: 'URL de Supabase no válida', text: 'Revisa SUPABASE_URL en js/config.js: debe empezar por https://.' },
  'no-lib': { icon: 'alert', kind: 'err', title: 'No se pudo cargar Supabase', text: 'La librería no se descargó. Revisa tu conexión a internet y recarga la página.' },
};

/** Si todavía no se pueden consultar datos, devuelve el aviso a mostrar. */
export function accessBlocker(ctx, onLogin) {
  if (ctx.db !== 'ok') return emptyState(DB_MSG[ctx.db] || DB_MSG['no-config']);
  if (!ctx.session) return emptyState({ icon: 'lock', title: 'Inicia sesión para continuar', text: 'El inventario es compartido y solo lo pueden consultar cuentas autorizadas.', action: { label: 'Iniciar sesión', onClick: onLogin } });
  if (ctx.profileError) return dataError(ctx.profileError);
  if (!ctx.profile || !ctx.profile.activo) return emptyState({ icon: 'lock', title: 'Tu cuenta no tiene acceso activo', text: 'Pide a un administrador que habilite tu perfil.' });
  return null;
}

function dataError(e) {
  console.error(e);
  const m = `${e && e.code || ''} ${e && e.message || ''}`;
  const missingSchema = /42P01|PGRST20[025]|does not exist|Could not find/i.test(m);
  return emptyState(missingSchema
    ? { icon: 'alert', kind: 'err', title: 'Falta preparar la base de datos', text: 'Ejecuta supabase/migrations/0001_esquema_inicial.sql en el SQL Editor de Supabase.' }
    : { icon: 'alert', kind: 'err', title: 'No se pudieron cargar los datos', text: 'Revisa tu conexión y toca «Actualizar».' });
}

async function load(container, ctx, onLogin, fetcher, render) {
  const block = accessBlocker(ctx, onLogin);
  if (block) { container.replaceChildren(block); return; }
  container.replaceChildren(el('p', { class: 'msg', role: 'status', text: 'Cargando…' }));
  try {
    container.replaceChildren(render(await fetcher()));
  } catch (e) {
    container.replaceChildren(dataError(e));
  }
}

export const renderCatalog = (container, ctx, onLogin) => load(container, ctx, onLogin, listProducts, rows => {
  if (!rows.length) return emptyState({ icon: 'list', title: 'Todavía no hay productos registrados', text: 'Cuando un administrador registre productos, aparecerán aquí. El formulario de alta llegará en la siguiente fase.' });
  return el('ul', { class: 'list' }, ...rows.map(p => el('li', { class: 'item' },
    el('span', { class: 'name', text: p.nombre }),
    el('span', { class: 'meta', text: [
      p.etiqueta_clasificador ? `Etiqueta IA: ${p.etiqueta_clasificador}` : 'Sin etiqueta IA',
      `Precio: ${fmtMoney(p.precio)}`, `Mínimo: ${p.stock_minimo}`].join(' · ') }),
    el('span', { class: 'qty' }, el('span', { class: 'tag' + (p.estado === 'activo' ? '' : ' off'), text: p.estado })))));
});

export const renderStock = (container, ctx, onLogin) => load(container, ctx, onLogin, listInventory, rows => {
  if (!rows.length) return emptyState({ icon: 'box', title: 'Todavía no hay existencias registradas', text: 'Las existencias aparecerán cuando haya productos en el catálogo.' });
  return el('ul', { class: 'list' }, ...rows.map(r => {
    const p = r.productos, low = p.stock_minimo > 0 && r.cantidad <= p.stock_minimo;
    return el('li', { class: 'item' + (low ? ' low' : '') },
      el('span', { class: 'name', text: p.nombre }),
      el('span', { class: 'meta', text: `Mínimo: ${p.stock_minimo}${low ? ' · Stock bajo' : ''}${p.estado !== 'activo' ? ' · Inactivo' : ''}` }),
      el('span', { class: 'qty' }, String(r.cantidad), el('small', { text: 'unidades' })));
  }));
});

export const renderHistory = (container, ctx, onLogin) => load(container, ctx, onLogin, () => listMovements(50), rows => {
  if (!rows.length) return emptyState({ icon: 'clock', title: 'Todavía no hay movimientos', text: 'Cada entrada y salida quedará registrada aquí con fecha, usuario y dispositivo.' });
  return el('ul', { class: 'list' }, ...rows.map(m => el('li', { class: 'item' },
    el('span', { class: 'name', text: m.productos ? m.productos.nombre : '—' }),
    el('span', { class: 'meta', text: [fmtDate(m.creado_en), m.perfiles && m.perfiles.nombre, m.origen === 'camara' ? 'cámara' : 'manual'].filter(Boolean).join(' · ') }),
    el('span', { class: 'qty' }, el('span', { class: 'tag' + (m.tipo === 'salida' ? ' neg' : ''), text: (m.tipo === 'salida' ? '−' : '+') + m.cantidad })))));
});

/** Panel principal: estado real de cada pieza, sin cifras inventadas. */
export function renderPanel(list, ctx) {
  const row = (s, title, text) => el('li', { class: 'status-item' }, el('span', { class: 'dot', 'data-s': s, 'aria-hidden': 'true' }), el('div', {}, el('strong', { text: title }), el('span', { text })));
  const dbText = {
    ok: ['ok', 'Conectada a Supabase'], 'no-config': ['warn', 'Sin configurar (falta js/config.js)'],
    'unsafe-key': ['err', 'Clave no permitida en js/config.js'], 'bad-url': ['err', 'URL no válida en js/config.js'], 'no-lib': ['err', 'No se pudo cargar la librería'],
  }[ctx.db] || ['warn', 'Comprobando…'];

  let auth = ['warn', 'No has iniciado sesión'];
  if (ctx.db !== 'ok') auth = ['warn', 'Requiere la base de datos'];
  else if (ctx.session && ctx.profile && ctx.profile.activo) auth = ['ok', `${ctx.profile.nombre || ctx.session.user.email} · rol ${ctx.profile.rol}`];
  else if (ctx.session && ctx.profileError) auth = ['err', 'No se pudo leer tu perfil'];
  else if (ctx.session) auth = ['err', 'Sesión iniciada, pero sin perfil activo'];

  const m = ctx.model;
  const model = m.state === 'ready' ? ['ok', `Listo · ${m.labels.length} etiqueta(s)${m.custom ? ' · modelo personalizado' : ''}`]
    : m.state === 'error' ? ['err', 'No se pudo cargar (el resto de la app funciona)']
    : ['warn', 'Cargando…'];

  list.replaceChildren(
    row(dbText[0], 'Base de datos', dbText[1]),
    row(auth[0], 'Sesión', auth[1]),
    row(model[0], 'Reconocimiento por cámara', model[1]),
    row('warn', 'Sincronización en tiempo real', 'No implementada todavía. Usa «Actualizar» para ver cambios de otros dispositivos.'),
  );
}
