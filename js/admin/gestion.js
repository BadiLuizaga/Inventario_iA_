/* ------------------------------------------------------------------ *
 * Pedidos, usuarios/roles y configuración de la tienda.
 * Todas las acciones pasan por funciones seguras de la base, que vuelven a
 * comprobar que quien las ejecuta es administrador.
 * ------------------------------------------------------------------ */
import { el, emptyState, loading, snack, errText, confirmDialog, fmtDate, fmtMoney } from '../ui.js';
import { ROL_TEXTO } from '../auth.js';
import { pedidos, pedido, historialPedido, cambiarEstadoPedido, SIGUIENTES_ESTADOS, listarUsuarios, asignarRol, configTienda, guardarConfigTienda } from '../services/interno.js';
import { ESTADO_PEDIDO } from '../services/tienda.js';
import { dataTable, formDialog } from './util.js';

const money = v => fmtMoney(v, true);
const estadoTag = e => el('span', { class: 'tag ' + (ESTADO_PEDIDO[e]?.cls || ''), text: ESTADO_PEDIDO[e]?.text || e });

/* =================================================================== *
 * Pedidos
 * =================================================================== */
export async function renderPedidos(main, go, estado = '') {
  const sel = el('select', { class: 'input', 'aria-label': 'Filtrar por estado', style: 'max-width:240px', onchange: e => go(`#/pedidos${e.target.value ? '?estado=' + e.target.value : ''}`) },
    el('option', { value: '', text: 'Todos los estados' }), ...Object.entries(ESTADO_PEDIDO).map(([k, v]) => el('option', { value: k, text: v.text, selected: k === estado })));
  main.replaceChildren(el('div', { class: 'page-head' }, el('h2', { text: 'Pedidos' }), sel), loading());
  try {
    const rows = await pedidos({ estado: estado || null });
    main.lastChild.replaceWith(rows.length ? dataTable([
      { label: 'N.º', value: r => el('a', { href: `#/pedido/${r.id}`, text: `#${r.id}` }) },
      { label: 'Fecha', value: r => fmtDate(r.creado_en) },
      { label: 'Cliente', value: r => r.clientes?.nombre || '(sin nombre)' },
      { label: 'Entrega', value: r => r.entrega === 'retiro' ? `Retiro · ${r.sucursales?.nombre || ''}` : 'Envío' },
      { label: 'Artículos', value: r => r.pedido_lineas.reduce((s, l) => s + l.cantidad, 0), num: true },
      { label: 'Total', value: r => money(r.total), num: true },
      { label: 'Estado', value: r => estadoTag(r.estado) },
    ], rows) : emptyState({ icon: 'receipt', title: estado ? 'No hay pedidos con ese estado' : 'Todavía no hay pedidos', text: 'Los pedidos que hagan los clientes desde la tienda aparecerán aquí en estado «Pendiente».' }));
  } catch (e) { main.lastChild.replaceWith(emptyState({ icon: 'alert', kind: 'err', title: 'No se pudieron cargar los pedidos', text: errText(e) })); }
}

export async function renderPedido(main, id, go) {
  main.replaceChildren(loading());
  try {
    const [o, hist] = await Promise.all([pedido(id), historialPedido(id)]);
    if (!o) { main.replaceChildren(emptyState({ icon: 'search', title: 'Pedido no encontrado' })); return; }
    const next = SIGUIENTES_ESTADOS[o.estado] || [];
    main.replaceChildren(
      el('a', { href: '#/pedidos', text: '← Pedidos' }),
      el('div', { class: 'page-head' }, el('h2', { text: `Pedido #${o.id}` }), estadoTag(o.estado)),
      el('div', { class: 'card' }, el('dl', { class: 'facts' },
        el('dt', { text: 'Fecha' }), el('dd', { text: fmtDate(o.creado_en) }),
        el('dt', { text: 'Cliente' }), el('dd', { text: o.clientes?.nombre || '(sin nombre)' }),
        el('dt', { text: 'Teléfono' }), el('dd', {}, el('a', { href: `tel:${o.telefono.replace(/[^\d+]/g, '')}`, text: o.telefono })),
        el('dt', { text: 'Entrega' }), el('dd', { text: o.entrega === 'retiro' ? `Retiro en ${o.sucursales?.nombre || '—'}` : `Envío a: ${o.direccion}` }),
        el('dt', { text: 'Notas' }), el('dd', { text: o.notas || '—' }),
        el('dt', { text: 'Pago' }), el('dd', { text: 'Sin pago en línea (al recibir o retirar)' }))),
      dataTable([
        { label: 'Artículo', value: l => `${l.producto_nombre}${l.detalle ? ' · ' + l.detalle : ''}` },
        { label: 'Reservado en', value: l => l.pedido_asignaciones.map(a => `${a.almacenes?.nombre}: ${a.cantidad}`).join(', ') || '—' },
        { label: 'Cant.', value: l => l.cantidad, num: true },
        { label: 'Precio', value: l => money(l.precio_unitario), num: true },
        { label: 'Subtotal', value: l => money(l.precio_unitario * l.cantidad), num: true },
      ], o.pedido_lineas),
      el('div', { class: 'row between' }, el('strong', { text: 'Total' }), el('strong', { class: 'price', text: money(o.total) })),
      el('div', { class: 'card' }, el('h3', { text: 'Historial' }), el('ul', { class: 'steps' }, ...hist.map(h => el('li', {}, el('span', { class: 'n', text: '•' }),
        el('div', {}, el('strong', { text: ESTADO_PEDIDO[h.estado_nuevo]?.text || h.estado_nuevo }), el('div', { class: 'muted', text: `${fmtDate(h.creado_en)}${h.nota ? ' · ' + h.nota : ''}` })))))),
      next.length ? el('div', { class: 'card stack' }, el('h3', { text: 'Cambiar estado' }),
        el('p', { class: 'muted', text: 'Cancelar devuelve automáticamente las unidades reservadas a su almacén de origen.' }),
        el('div', { class: 'row' }, ...next.map(s => el('button', { class: 'btn ' + (s === 'cancelado' ? 'danger' : 'primary'), type: 'button', text: `Marcar como «${ESTADO_PEDIDO[s].text}»`,
          onclick: async () => {
            const nota = el('input', { class: 'input', maxlength: '300', placeholder: 'Nota (opcional, la ve el cliente)' });
            if (!await confirmDialog({ title: `¿Pasar el pedido #${o.id} a «${ESTADO_PEDIDO[s].text}»?`, ok: 'Confirmar', danger: s === 'cancelado', body: nota })) return;
            try { await cambiarEstadoPedido(o.id, s, nota.value.trim()); snack('Estado actualizado'); renderPedido(main, id, go); }
            catch (e) { snack(errText(e), 'err'); }
          } })))) : null);
  } catch (e) { main.replaceChildren(emptyState({ icon: 'alert', kind: 'err', title: 'No se pudo abrir el pedido', text: errText(e) })); }
}

/* =================================================================== *
 * Usuarios y roles
 * =================================================================== */
export async function renderUsuarios(main, ctx) {
  main.replaceChildren(el('div', { class: 'page-head' }, el('h2', { text: 'Usuarios y roles' })), loading());
  try {
    const rows = await listarUsuarios();
    const info = el('div', { class: 'notice' },
      'Para dar acceso a una persona del equipo: 1) que cree su cuenta en la tienda (Mi cuenta → Crear cuenta) o créala en Supabase → Authentication → Add user; 2) asígnale aquí un rol. ',
      'Las cuentas sin rol son clientes de la tienda y no ven el inventario interno. Nadie puede cambiar su propio rol.');
    const edit = async u => {
      const saved = await formDialog({
        title: `Acceso de ${u.email}`, values: { rol: u.rol || 'operador', activo: u.rol ? u.activo : true, nombre: u.nombre },
        fields: [
          { k: 'nombre', label: 'Nombre visible', max: 120 },
          { k: 'rol', label: 'Rol interno', type: 'select', required: true, options: Object.entries(ROL_TEXTO).map(([v, t]) => ({ value: v, text: t })),
            help: 'Almacenero: escáner, entradas, salidas, devoluciones y conteos. Lector: solo consulta. Administrador: todo, incluidos ajustes, pedidos y usuarios.' },
          { k: 'activo', label: 'Acceso interno activo', type: 'bool', help: 'Desactívalo para quitar el acceso sin borrar el historial.' },
        ],
        onSubmit: v => asignarRol(u.id, v.rol, v.activo, v.nombre),
      });
      if (saved) { snack('Acceso actualizado'); renderUsuarios(main, ctx); }
    };
    main.lastChild.replaceWith(el('div', { class: 'stack' }, info, rows.length ? dataTable([
      { label: 'Correo', value: u => u.email },
      { label: 'Nombre', value: u => u.nombre || '—' },
      { label: 'Rol', value: u => u.rol ? el('span', { class: 'tag ' + (u.activo ? '' : 'muted'), text: `${ROL_TEXTO[u.rol]}${u.activo ? '' : ' (inactivo)'}` }) : el('span', { class: 'tag muted', text: 'Cliente' }) },
      { label: 'Alta', value: u => fmtDate(u.creado_en, false) },
      { label: 'Último acceso', value: u => u.ultimo_acceso ? fmtDate(u.ultimo_acceso) : '—' },
      { label: '', value: u => u.id === ctx.session.user.id ? el('span', { class: 'muted', text: 'Tú' }) : el('button', { class: 'btn small', type: 'button', text: u.rol ? 'Cambiar acceso' : 'Dar acceso', onclick: () => edit(u) }) },
    ], rows) : emptyState({ icon: 'users', title: 'No hay cuentas registradas' })));
  } catch (e) { main.lastChild.replaceWith(emptyState({ icon: 'alert', kind: 'err', title: 'No se pudieron cargar los usuarios', text: errText(e) })); }
}

/* =================================================================== *
 * Configuración
 * =================================================================== */
export async function renderConfiguracion(main) {
  main.replaceChildren(loading());
  try {
    const c = await configTienda();
    const vals = { umbral_agotado: c ? c.umbral_agotado : 0, umbral_pocas: c ? c.umbral_pocas : 3 };
    main.replaceChildren(el('div', { class: 'page-head' }, el('h2', { text: 'Configuración' })),
      el('div', { class: 'card stack' },
        el('h3', { text: 'Disponibilidad pública en la tienda' }),
        el('p', { class: 'muted', text: 'La tienda nunca muestra cantidades: solo «Disponible», «Pocas unidades» o «Agotado», según la suma de existencias de los almacenes que venden en línea.' }),
        el('dl', { class: 'facts' },
          el('dt', { text: 'Agotado' }), el('dd', { text: `con ${vals.umbral_agotado} unidades o menos${vals.umbral_agotado ? ' (stock de seguridad que la tienda no vende)' : ''}` }),
          el('dt', { text: 'Pocas unidades' }), el('dd', { text: `de ${vals.umbral_agotado + 1} a ${vals.umbral_pocas} unidades` }),
          el('dt', { text: 'Disponible' }), el('dd', { text: `más de ${vals.umbral_pocas} unidades` })),
        c ? null : el('p', { class: 'notice', text: 'Se están usando los valores por defecto.' }),
        el('div', { class: 'actions' }, el('button', { class: 'btn primary', type: 'button', text: 'Cambiar umbrales', onclick: async () => {
          const s = await formDialog({ title: 'Umbrales de disponibilidad', values: vals, fields: [
            { k: 'umbral_agotado', label: '«Agotado» hasta (unidades)', type: 'number', min: 0, required: true },
            { k: 'umbral_pocas', label: '«Pocas unidades» hasta (unidades)', type: 'number', min: 1, required: true, help: 'Debe ser mayor que el umbral de agotado.' }],
          onSubmit: v => {
            if (v.umbral_pocas <= v.umbral_agotado) throw Object.assign(new Error('«Pocas unidades» debe ser mayor que «Agotado».'), { code: 'P0001' });
            return guardarConfigTienda(v.umbral_agotado, v.umbral_pocas);
          } });
          if (s) { snack('Configuración guardada'); renderConfiguracion(main); }
        } }))));
  } catch (e) { main.replaceChildren(emptyState({ icon: 'alert', kind: 'err', title: 'No se pudo cargar la configuración', text: errText(e) })); }
}
