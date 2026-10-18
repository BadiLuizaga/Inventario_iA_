/* ------------------------------------------------------------------ *
 * Pantallas del almacén: existencias, movimientos, conteos e historial.
 * Solo muestran datos reales de Supabase; sin datos, un estado vacío.
 * Ninguna operación cambia el stock sin una confirmación explícita.
 * ------------------------------------------------------------------ */
import { el, emptyState, loading, fmtDate, setMsg, snack, errText, confirmDialog, debounce, todayISO, startOfDay, endOfDay } from '../ui.js';
import { DB_MSG } from '../supabase.js';
import {
  existencias, registrarMovimiento, movimientos, TIPO_MOV, nombreVariante, nombreAlmacen,
  conteos, conteo, lineasConteo, crearConteo, registrarLinea, quitarLinea, aplicarConteo, anularConteo,
} from '../services/interno.js';
import { createPicker } from './picker.js';

/** Aviso cuando todavía no se pueden consultar datos (o null si todo está listo). */
export function accessBlocker(ctx, onLogin, needWarehouse = true) {
  if (ctx.db !== 'ok') return emptyState(DB_MSG[ctx.db] || DB_MSG['no-config']);
  if (!ctx.session) return emptyState({ icon: 'lock', title: 'Inicia sesión para continuar', text: 'La herramienta de almacén es solo para personal autorizado.', action: { label: 'Iniciar sesión', onClick: onLogin } });
  if (ctx.profileError) return emptyState({ icon: 'alert', kind: 'err', title: 'No se pudo leer tu perfil', text: errText(ctx.profileError) });
  if (!ctx.profile || !ctx.profile.activo) return emptyState({ icon: 'lock', title: 'Tu cuenta no tiene acceso al almacén', text: 'Pide a un administrador que te asigne un rol de personal (almacenero, lector o administrador).', action: { label: 'Ir a la tienda', onClick: () => { location.href = './'; } } });
  if (needWarehouse && ctx.almacenesError) return emptyState({ icon: 'alert', kind: 'err', title: 'No se pudieron cargar los almacenes', text: errText(ctx.almacenesError) });
  if (needWarehouse && !ctx.almacenes.length) return emptyState({ icon: 'store', title: 'Todavía no hay almacenes registrados', text: 'Un administrador debe registrar al menos un almacén desde el panel administrativo.', action: ctx.profile.rol === 'admin' ? { label: 'Abrir panel', onClick: () => { location.href = 'admin.html#/almacenes'; } } : null });
  if (needWarehouse && !ctx.almacen) return emptyState({ icon: 'store', title: 'Elige el almacén de trabajo', action: { label: 'Elegir almacén', onClick: () => document.getElementById('btnWarehouse').click() } });
  return null;
}
const canWrite = ctx => ['admin', 'operador'].includes(ctx.profile?.rol);
const isAdmin = ctx => ctx.profile?.rol === 'admin';

/* =================================================================== *
 * Existencias
 * =================================================================== */
export async function renderStock(box, ctx, onLogin) {
  const b = accessBlocker(ctx, onLogin); if (b) { box.replaceChildren(b); return; }
  const q = el('input', { type: 'search', placeholder: 'Buscar producto, modelo o SKU', 'aria-label': 'Buscar' });
  const low = el('input', { type: 'checkbox', class: 'switch', role: 'switch', id: 'stLow' });
  const list = el('div');
  const load = async () => {
    list.replaceChildren(loading());
    try {
      const rows = await existencias({ almacenId: ctx.almacen.id, q: q.value, soloBajo: low.checked });
      if (!rows.length) {
        list.replaceChildren(q.value || low.checked
          ? emptyState({ icon: 'search', title: 'Sin resultados', text: 'No hay existencias que coincidan con el filtro.' })
          : emptyState({ icon: 'box', title: 'Todavía no hay existencias en este almacén', text: 'Aparecerán cuando se registre la primera entrada de mercadería.' }));
        return;
      }
      const total = rows.reduce((s, r) => s + r.cantidad, 0);
      list.replaceChildren(el('p', { class: 'msg', text: `${rows.length} variante(s) · ${total} unidad(es) en ${nombreAlmacen(ctx.almacen)}` }),
        el('ul', { class: 'list' }, ...rows.map(r => el('li', { class: 'item' + (r.bajo_minimo ? ' low' : '') },
          el('span', { class: 'name', text: r.producto }),
          el('span', { class: 'meta', text: [r.talla && `Talla ${r.talla}`, r.color, r.sku, r.ubicacion && `Ubic. ${r.ubicacion}`, r.stock_minimo ? `Mín. ${r.stock_minimo}` : '', r.bajo_minimo ? 'Stock bajo' : ''].filter(Boolean).join(' · ') }),
          el('span', { class: 'qty' }, String(r.cantidad), el('small', { text: 'unidades' }))))));
    } catch (e) { list.replaceChildren(emptyState({ icon: 'alert', kind: 'err', title: 'No se pudieron cargar las existencias', text: errText(e) })); }
  };
  q.addEventListener('input', debounce(load, 350));
  low.addEventListener('change', load);
  box.replaceChildren(el('div', { class: 'card stack' }, el('div', { class: 'field', style: 'margin:0' }, q),
    el('div', { class: 'set', style: 'min-height:0; padding:0' }, el('label', { for: 'stLow', text: 'Solo bajo el mínimo' }), low)), list);
  load();
}

/* =================================================================== *
 * Registrar movimiento
 * =================================================================== */
export function renderMove(box, ctx, onLogin, prefill = null) {
  const b = accessBlocker(ctx, onLogin); if (b) { box.replaceChildren(b); return; }
  if (!canWrite(ctx)) { box.replaceChildren(emptyState({ icon: 'lock', title: 'Tu rol es de solo consulta', text: 'Para registrar movimientos necesitas el rol de almacenero o administrador.' })); return; }

  let sel = prefill;   // { producto, variante, stock, origen }
  const selBox = el('div');
  const picker = createPicker({ almacenId: () => ctx.almacen?.id, onSelect: (producto, variante, stock) => { sel = { producto, variante, stock, origen: 'manual' }; draw(); } });
  const tipos = ['entrada', 'salida', 'devolucion', ...(isAdmin(ctx) ? ['ajuste_positivo', 'ajuste_negativo'] : [])];
  const tipo = el('select', { id: 'mvTipo' }, ...tipos.map(t => el('option', { value: t, text: TIPO_MOV[t].text })));
  const cant = el('input', { id: 'mvCant', type: 'number', min: '1', max: '100000', inputmode: 'numeric', required: true });
  const motivo = el('input', { id: 'mvMotivo', maxlength: '300', placeholder: 'Ej.: venta en mostrador, mercadería dañada…' });
  const ref = el('input', { id: 'mvRef', maxlength: '120', placeholder: 'N.º de guía, factura, nota…' });
  const msg = el('p', { class: 'msg', role: 'status' });
  const btn = el('button', { class: 'btn primary block', type: 'submit', text: 'Revisar y confirmar' });
  const form = el('form', { class: 'card', novalidate: true },
    el('div', { class: 'field' }, el('label', { for: 'mvTipo', text: 'Tipo de movimiento' }), tipo),
    el('div', { class: 'field' }, el('label', { for: 'mvCant', text: 'Cantidad (unidades)' }), cant),
    el('div', { class: 'field' }, el('label', { for: 'mvMotivo', text: 'Motivo' }), motivo, el('small', { class: 'muted', text: 'Obligatorio salvo en entradas.' })),
    el('div', { class: 'field' }, el('label', { for: 'mvRef', text: 'Referencia (opcional)' }), ref),
    msg, btn);

  function draw() {
    if (!sel) {
      selBox.replaceChildren(el('div', { class: 'card stack' }, el('h3', { text: '1. Elige el producto y la variante' }), picker.el));
      form.hidden = true;
      return;
    }
    selBox.replaceChildren(el('div', { class: 'card stack' },
      el('h3', { text: '1. Producto' }),
      el('div', { class: 'row between' },
        el('div', {}, el('strong', { text: sel.producto.nombre }), el('div', { class: 'muted', text: `${nombreVariante(sel.variante)} · ${nombreAlmacen(ctx.almacen)}` }),
          el('div', { class: 'muted', text: `Stock registrado: ${sel.stock ? sel.stock.cantidad : 0} u.${sel.origen === 'camara' ? ' · identificado por cámara' : ''}` })),
        el('button', { class: 'btn small', type: 'button', text: 'Cambiar', onclick: () => { sel = null; picker.clear(); draw(); } }))));
    form.hidden = false;
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const n = parseInt(cant.value, 10), t = tipo.value, m = motivo.value.trim();
    cant.removeAttribute('aria-invalid'); motivo.removeAttribute('aria-invalid');
    if (!sel) { setMsg(msg, 'Elige un producto.', 'err'); return; }
    if (!Number.isInteger(n) || n < 1 || n > 100000) { cant.setAttribute('aria-invalid', 'true'); setMsg(msg, 'La cantidad debe ser un número entero entre 1 y 100000.', 'err'); return; }
    if (t !== 'entrada' && !m) { motivo.setAttribute('aria-invalid', 'true'); setMsg(msg, 'Indica el motivo.', 'err'); return; }
    const antes = sel.stock ? sel.stock.cantidad : 0;
    const despues = antes + (TIPO_MOV[t].signo === '+' ? n : -n);
    if (despues < 0) { setMsg(msg, `Stock insuficiente: hay ${antes} u. registradas en este almacén.`, 'err'); return; }
    setMsg(msg, '');
    const ok = await confirmDialog({
      title: `Confirmar ${TIPO_MOV[t].text.toLowerCase()}`, ok: 'Registrar',
      body: el('dl', { class: 'facts' },
        el('dt', { text: 'Producto' }), el('dd', { text: `${sel.producto.nombre} · ${nombreVariante(sel.variante)}` }),
        el('dt', { text: 'Almacén' }), el('dd', { text: nombreAlmacen(ctx.almacen) }),
        el('dt', { text: 'Cantidad' }), el('dd', { text: `${TIPO_MOV[t].signo}${n} u.` }),
        el('dt', { text: 'Stock' }), el('dd', { text: `${antes} → ${despues} u.` }),
        m ? [el('dt', { text: 'Motivo' }), el('dd', { text: m })] : null),
    });
    if (!ok) return;
    btn.disabled = true; setMsg(msg, 'Registrando…');
    try {
      const r = await registrarMovimiento({ varianteId: sel.variante.id, almacenId: ctx.almacen.id, tipo: t, cantidad: n, motivo: m, referencia: ref.value.trim(), origen: sel.origen || 'manual' });
      snack(`Registrado. Stock actual: ${r.saldo} u.`);
      sel = { ...sel, stock: { ...(sel.stock || {}), cantidad: r.saldo } };
      cant.value = ''; motivo.value = ''; ref.value = '';
      setMsg(msg, `Movimiento n.º ${r.movimiento_id} registrado. Stock actual: ${r.saldo} u.`, 'ok');
      draw();
    } catch (err) {
      console.error(err);
      setMsg(msg, errText(err), 'err');
    } finally { btn.disabled = false; }
  });

  box.replaceChildren(selBox, form);
  draw();
}

/* =================================================================== *
 * Conteos físicos
 * =================================================================== */
export async function renderCount(box, ctx, onLogin, openId = null) {
  const b = accessBlocker(ctx, onLogin); if (b) { box.replaceChildren(b); return; }
  if (openId) return renderCountDetail(box, ctx, onLogin, openId);
  box.replaceChildren(loading());
  try {
    const rows = await conteos({ almacenId: ctx.almacen.id, limit: 30 });
    const nodes = [];
    if (canWrite(ctx)) {
      const notas = el('input', { id: 'cnNotas', maxlength: '500', placeholder: 'Ej.: pasillo 3, zapatillas' });
      const msg = el('p', { class: 'msg', role: 'status' });
      nodes.push(el('form', { class: 'card', novalidate: true, onsubmit: async e => {
        e.preventDefault();
        try { const id = await crearConteo(ctx.almacen.id, notas.value.trim()); renderCount(box, ctx, onLogin, id); }
        catch (err) { setMsg(msg, errText(err), 'err'); }
      } }, el('h3', { text: 'Nuevo conteo' }), el('p', { text: 'Registra lo que cuentas físicamente. El stock no cambia hasta que un administrador revise y aplique las diferencias.' }),
      el('div', { class: 'field' }, el('label', { for: 'cnNotas', text: 'Notas (opcional)' }), notas), msg,
      el('button', { class: 'btn primary block', type: 'submit', text: 'Empezar conteo' })));
    }
    if (!rows.length) nodes.push(emptyState({ icon: 'list', title: 'Todavía no hay conteos en este almacén', text: canWrite(ctx) ? 'Empieza uno con el formulario de arriba.' : 'Aún no se registraron conteos físicos.' }));
    else nodes.push(el('ul', { class: 'list' }, ...rows.map(c => el('li', {},
      el('button', { class: 'item item-btn', type: 'button', onclick: () => renderCount(box, ctx, onLogin, c.id) },
        el('span', { class: 'name', text: `Conteo del ${fmtDate(c.creado_en)}` }),
        el('span', { class: 'meta', text: [c.notas, `${c.conteo_lineas?.[0]?.count ?? 0} línea(s)`].filter(Boolean).join(' · ') }),
        el('span', { class: 'qty' }, el('span', { class: 'tag ' + ({ abierto: 'warn', aplicado: 'ok', anulado: 'muted' }[c.estado]), text: c.estado })))))));
    box.replaceChildren(...nodes);
  } catch (e) { box.replaceChildren(emptyState({ icon: 'alert', kind: 'err', title: 'No se pudieron cargar los conteos', text: errText(e) })); }
}

async function renderCountDetail(box, ctx, onLogin, id) {
  box.replaceChildren(loading());
  try {
    const [c, lines] = await Promise.all([conteo(id), lineasConteo(id)]);
    const abierto = c.estado === 'abierto';
    const back = el('button', { class: 'btn small ghost', type: 'button', text: '← Conteos', onclick: () => renderCount(box, ctx, onLogin) });
    const head = el('div', { class: 'card' },
      el('div', { class: 'row between' }, el('h3', { text: `Conteo del ${fmtDate(c.creado_en)}` }), el('span', { class: 'tag ' + ({ abierto: 'warn', aplicado: 'ok', anulado: 'muted' }[c.estado]), text: c.estado })),
      el('p', { text: [nombreAlmacen(c.almacenes), c.notas].filter(Boolean).join(' · ') }));
    const nodes = [back, head];

    if (abierto && canWrite(ctx)) {
      const cant = el('input', { type: 'number', min: '0', inputmode: 'numeric', id: 'clCant', 'aria-label': 'Cantidad contada' });
      const msg = el('p', { class: 'msg', role: 'status' });
      let picked = null;
      const pickedBox = el('div');
      const save = el('button', { class: 'btn primary block', type: 'button', text: 'Guardar cantidad contada', disabled: true });
      const picker = createPicker({ almacenId: () => null, onSelect: (p, v) => {
        picked = { p, v }; save.disabled = false;
        pickedBox.replaceChildren(el('div', { class: 'notice', text: `${p.nombre} · ${nombreVariante(v)}` }));
        cant.focus();
      } });
      save.addEventListener('click', async () => {
        const n = parseInt(cant.value, 10);
        if (!picked) { setMsg(msg, 'Elige un producto.', 'err'); return; }
        if (!Number.isInteger(n) || n < 0) { setMsg(msg, 'Escribe la cantidad contada (0 o más).', 'err'); return; }
        save.disabled = true;
        try { await registrarLinea(id, picked.v.id, n); snack('Cantidad guardada'); renderCountDetail(box, ctx, onLogin, id); }
        catch (err) { setMsg(msg, errText(err), 'err'); save.disabled = false; }
      });
      nodes.push(el('div', { class: 'card stack' }, el('h3', { text: 'Agregar producto contado' }), picker.el, pickedBox,
        el('div', { class: 'field', style: 'margin:0' }, el('label', { for: 'clCant', text: 'Cantidad contada físicamente' }), cant), msg, save));
    }

    if (!lines.length) nodes.push(emptyState({ icon: 'list', title: 'Este conteo todavía no tiene productos', text: abierto ? 'Agrega cada variante con la cantidad que contaste.' : '' }));
    else {
      const dif = l => l.cantidad_contada - l.cantidad_sistema;
      const withDiff = lines.filter(l => dif(l) !== 0);
      nodes.push(el('p', { class: 'msg', text: `${lines.length} línea(s) · ${withDiff.length} con diferencia respecto al stock registrado al contar` }));
      nodes.push(el('div', { class: 'table-wrap' }, el('table', { class: 'data' },
        el('thead', {}, el('tr', {}, el('th', { text: 'Producto' }), el('th', { class: 'num', text: 'Sistema' }), el('th', { class: 'num', text: 'Contado' }), el('th', { class: 'num', text: 'Dif.' }), abierto && canWrite(ctx) ? el('th', {}) : null)),
        el('tbody', {}, ...lines.map(l => el('tr', { class: dif(l) ? 'low' : '' },
          el('td', {}, el('strong', { text: l.variantes?.productos?.nombre || '—' }), el('br'), el('small', { class: 'muted', text: nombreVariante({ tallas: l.variantes?.tallas, colores: l.variantes?.colores }) + (l.aplicada ? ' · aplicada' : '') })),
          el('td', { class: 'num', text: String(l.cantidad_sistema) }),
          el('td', { class: 'num', text: String(l.cantidad_contada) }),
          el('td', { class: 'num', text: (dif(l) > 0 ? '+' : '') + dif(l) }),
          abierto && canWrite(ctx) ? el('td', {}, el('button', { class: 'btn small ghost', type: 'button', text: 'Quitar', onclick: async () => {
            try { await quitarLinea(id, l.variante_id); renderCountDetail(box, ctx, onLogin, id); } catch (err) { snack(errText(err), 'err'); }
          } })) : null))))));

      if (abierto && isAdmin(ctx)) {
        nodes.push(el('button', { class: 'btn primary block', type: 'button', text: 'Revisar diferencias y aplicar', onclick: () => reviewCount(box, ctx, onLogin, c, lines) }));
      } else if (abierto) {
        nodes.push(el('p', { class: 'notice', text: 'Un administrador debe revisar las diferencias y aplicarlas para actualizar el stock.' }));
      }
    }
    if (abierto && (isAdmin(ctx) || (canWrite(ctx) && c.creado_por === ctx.session.user.id))) {
      nodes.push(el('button', { class: 'btn danger block', type: 'button', text: 'Anular conteo', onclick: async () => {
        if (!await confirmDialog({ title: '¿Anular este conteo?', text: 'No se modificará el stock. Las líneas quedan como registro.', ok: 'Anular', danger: true })) return;
        try { await anularConteo(id); snack('Conteo anulado'); renderCount(box, ctx, onLogin); } catch (err) { snack(errText(err), 'err'); }
      } }));
    }
    box.replaceChildren(...nodes);
  } catch (e) { box.replaceChildren(emptyState({ icon: 'alert', kind: 'err', title: 'No se pudo abrir el conteo', text: errText(e) })); }
}

/** Revisión del administrador: compara con el stock ACTUAL y aplica solo lo elegido. */
async function reviewCount(box, ctx, onLogin, c, lines) {
  let actual = [];
  try { actual = await existencias({ almacenId: c.almacen_id, varianteIds: lines.map(l => l.variante_id) }); }
  catch (e) { snack(errText(e), 'err'); return; }
  const now = new Map(actual.map(r => [r.variante_id, r.cantidad]));
  const rows = lines.map(l => ({ l, actual: now.get(l.variante_id) ?? 0 })).map(r => ({ ...r, ajuste: r.l.cantidad_contada - r.actual }));
  const changes = rows.filter(r => r.ajuste !== 0);
  const checks = new Map();
  const body = changes.length
    ? el('div', { class: 'stack' },
      el('p', { class: 'muted', text: 'Se ajustará el stock actual para que coincida con lo contado. Desmarca lo que no quieras aplicar.' }),
      ...changes.map(r => {
        const cb = el('input', { type: 'checkbox', checked: true });
        checks.set(r.l.variante_id, cb);
        return el('label', { class: 'check' }, cb, `${r.l.variantes?.productos?.nombre} · ${nombreVariante({ tallas: r.l.variantes?.tallas, colores: r.l.variantes?.colores })}: ${r.actual} → ${r.l.cantidad_contada} (${r.ajuste > 0 ? '+' : ''}${r.ajuste})`);
      }))
    : el('p', { class: 'muted', text: 'No hay diferencias con el stock actual. Aplicar solo cerrará el conteo.' });
  if (!await confirmDialog({ title: 'Aplicar conteo', ok: 'Aplicar ajustes', body })) return;
  const elegidas = changes.length ? [...checks].filter(([, cb]) => cb.checked).map(([v]) => v) : lines.map(l => l.variante_id);
  if (!elegidas.length) { snack('No elegiste ningún ajuste: el conteo sigue abierto.'); return; }
  try {
    const res = await aplicarConteo(c.id, elegidas);
    snack(`Conteo aplicado: ${res.filter(r => r.ajuste !== 0).length} ajuste(s).`);
    renderCountDetail(box, ctx, onLogin, c.id);
  } catch (err) { snack(errText(err), 'err'); }
}

/* =================================================================== *
 * Historial y cierre diario
 * =================================================================== */
export async function renderHistory(box, ctx, onLogin, state = {}) {
  const b = accessBlocker(ctx, onLogin); if (b) { box.replaceChildren(b); return; }
  const day = el('input', { type: 'date', id: 'hiDay', value: state.day || todayISO(), max: todayISO() });
  const scope = el('select', { id: 'hiScope' }, el('option', { value: 'actual', text: 'Este almacén' }), el('option', { value: 'todos', text: 'Todos los almacenes' }));
  scope.value = state.scope || 'actual';
  const out = el('div', { class: 'stack' });
  const load = async () => {
    out.replaceChildren(loading());
    try {
      const rows = await movimientos({ desde: startOfDay(day.value), hasta: endOfDay(day.value), almacenId: scope.value === 'actual' ? ctx.almacen.id : null, limit: 2000 });
      if (!rows.length) { out.replaceChildren(emptyState({ icon: 'clock', title: 'Sin movimientos ese día', text: 'Cada entrada, salida, devolución, ajuste o pedido quedará registrado aquí con fecha, usuario y motivo.' })); return; }
      const porTipo = {};
      let entra = 0, sale = 0;
      for (const m of rows) {
        porTipo[m.tipo] = (porTipo[m.tipo] || 0) + m.cantidad;
        if (TIPO_MOV[m.tipo].signo === '+') entra += m.cantidad; else sale += m.cantidad;
      }
      const usuarios = new Set(rows.map(m => m.usuario_id)).size;
      out.replaceChildren(
        el('div', { class: 'card' },
          el('h3', { text: `Cierre del ${day.value.split('-').reverse().join('/')}` }),
          el('div', { class: 'kpis' },
            el('div', {}, el('strong', { text: String(rows.length) }), el('span', { text: 'movimientos' })),
            el('div', {}, el('strong', { text: `+${entra}` }), el('span', { text: 'unidades ingresadas' })),
            el('div', {}, el('strong', { text: `−${sale}` }), el('span', { text: 'unidades egresadas' })),
            el('div', {}, el('strong', { text: String(usuarios) }), el('span', { text: 'usuario(s)' }))),
          el('div', { class: 'chips', style: 'margin-top:10px' }, ...Object.entries(porTipo).map(([t, n]) => el('span', { class: 'tag ' + TIPO_MOV[t].cls, text: `${TIPO_MOV[t].text}: ${n}` })))),
        el('ul', { class: 'list' }, ...rows.map(m => el('li', { class: 'item' },
          el('span', { class: 'name', text: `${m.producto}${m.talla ? ' · T' + m.talla : ''}${m.color ? ' · ' + m.color : ''}` }),
          el('span', { class: 'meta', text: [fmtDate(m.creado_en), TIPO_MOV[m.tipo].text, m.usuario, scope.value === 'todos' ? m.almacen : '', m.motivo, m.referencia && `Ref. ${m.referencia}`, m.origen === 'camara' ? 'cámara' : '', `saldo ${m.saldo}`].filter(Boolean).join(' · ') }),
          el('span', { class: 'qty' }, el('span', { class: 'tag ' + TIPO_MOV[m.tipo].cls, text: TIPO_MOV[m.tipo].signo + m.cantidad }))))));
    } catch (e) { out.replaceChildren(emptyState({ icon: 'alert', kind: 'err', title: 'No se pudo cargar el historial', text: errText(e) })); }
  };
  day.addEventListener('change', load); scope.addEventListener('change', load);
  box.replaceChildren(el('div', { class: 'card toolbar' },
    el('div', { class: 'field', style: 'margin:0' }, el('label', { for: 'hiDay', text: 'Día' }), day),
    el('div', { class: 'field', style: 'margin:0' }, el('label', { for: 'hiScope', text: 'Alcance' }), scope)), out);
  load();
}
