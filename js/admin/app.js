/* ------------------------------------------------------------------ *
 * Panel administrativo: acceso, menú y enrutado.
 * Ocultar opciones no es seguridad: cada operación la vuelve a comprobar
 * la base de datos (RLS y funciones que exigen rol de administrador).
 * ------------------------------------------------------------------ */
import { $, $$, el, emptyState, setMsg, snack, setCurrency } from '../ui.js';
import { initSupabase, appConfig, DB_MSG } from '../supabase.js';
import { initAuth, signIn, signOut, getStaffProfile, authErrorText, ROL_TEXTO } from '../auth.js';
import { renderCrud, ENTIDADES } from './crud.js';
import { renderProductos, renderProducto } from './productos.js';
import { renderPedidos, renderPedido, renderUsuarios, renderConfiguracion } from './gestion.js';
import { renderResumen, renderReportes } from './reportes.js';

const ctx = { db: 'checking', session: null, profile: null, profileError: null };
const main = $('#main');
const go = hash => { if (location.hash === hash) route(); else location.hash = hash; };

const TITLES = { resumen: 'Resumen', productos: 'Productos', producto: 'Producto', pedidos: 'Pedidos', pedido: 'Pedido', reportes: 'Reportes', usuarios: 'Usuarios y roles', configuracion: 'Configuración' };

function loginView() {
  const msg = el('p', { class: 'msg', role: 'status' });
  const email = el('input', { id: 'lgEmail', type: 'email', autocomplete: 'username', inputmode: 'email', autocapitalize: 'off', spellcheck: 'false' });
  const pass = el('input', { id: 'lgPass', type: 'password', autocomplete: 'current-password' });
  const btn = el('button', { class: 'btn primary block', type: 'submit', text: 'Entrar' });
  const form = el('form', { class: 'card form-grid', novalidate: true, style: 'max-width:420px; width:100%; justify-self:center' },
    el('h2', { text: 'Acceso administrativo' }), el('p', { class: 'muted', text: 'Solo para cuentas con rol de administrador.' }),
    el('div', { class: 'field' }, el('label', { for: 'lgEmail', text: 'Correo electrónico' }), email),
    el('div', { class: 'field' }, el('label', { for: 'lgPass', text: 'Contraseña' }), pass), msg, btn);
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!email.value.trim() || !pass.value) { setMsg(msg, 'Escribe tu correo y tu contraseña.', 'err'); return; }
    btn.disabled = true; setMsg(msg, 'Entrando…');
    try { await signIn(email.value.trim(), pass.value); }
    catch (err) { setMsg(msg, authErrorText(err), 'err'); btn.disabled = false; }
  });
  return form;
}

function blocker() {
  if (ctx.db !== 'ok') return emptyState(DB_MSG[ctx.db] || DB_MSG['no-config']);
  if (!ctx.session) return loginView();
  if (ctx.profileError) return emptyState({ icon: 'alert', kind: 'err', title: 'No se pudo verificar tu acceso', text: 'Si la base de datos aún no tiene las migraciones aplicadas, ejecútalas primero (ver README).' });
  if (!ctx.profile || !ctx.profile.activo || ctx.profile.rol !== 'admin') return emptyState({ icon: 'lock', title: 'Acceso solo para administradores',
    text: ctx.profile && ctx.profile.activo ? `Tu rol es «${ROL_TEXTO[ctx.profile.rol]}». Usa la herramienta de almacén.` : 'Tu cuenta no tiene un rol administrativo activo.',
    action: ctx.profile && ctx.profile.activo ? { label: 'Ir al almacén', onClick: () => { location.href = 'almacen.html'; } } : { label: 'Ir a la tienda', onClick: () => { location.href = './'; } } });
  return null;
}

function route() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  const [name = 'resumen', arg] = path.split('/');
  const params = new URLSearchParams(query);
  const r = name || 'resumen';
  $$('#sideNav a[data-r]').forEach(a => a.toggleAttribute('aria-current', a.dataset.r === r || (r === 'producto' && a.dataset.r === 'productos') || (r === 'pedido' && a.dataset.r === 'pedidos')));
  if ($$('#sideNav a[aria-current]').length) $$('#sideNav a[aria-current]').forEach(a => a.setAttribute('aria-current', 'page'));
  $('#side').classList.remove('open'); $('#btnMenu').setAttribute('aria-expanded', 'false');
  $('#pageTitle').textContent = ENTIDADES[r]?.titulo || TITLES[r] || 'Panel administrativo';
  document.title = `${$('#pageTitle').textContent} · Panel`;

  const b = blocker();
  if (b) { main.replaceChildren(b); return; }
  main.focus({ preventScroll: true }); window.scrollTo({ top: 0 });
  if (ENTIDADES[r]) return renderCrud(main, r);
  ({
    resumen: () => renderResumen(main),
    productos: () => renderProductos(main, go),
    producto: () => renderProducto(main, arg, go, params.get('tab') || 'datos'),
    pedidos: () => renderPedidos(main, go, params.get('estado') || ''),
    pedido: () => renderPedido(main, Number(arg), go),
    reportes: () => renderReportes(main, go, params),
    usuarios: () => renderUsuarios(main, ctx),
    configuracion: () => renderConfiguracion(main),
  }[r] || (() => renderResumen(main)))();
}

async function onSession(session) {
  ctx.session = session; ctx.profile = null; ctx.profileError = null;
  if (session) { try { ctx.profile = await getStaffProfile(session.user.id); } catch (e) { ctx.profileError = e; console.error(e); } }
  $('#userInfo').textContent = session ? `${session.user.email}${ctx.profile ? ' · ' + ROL_TEXTO[ctx.profile.rol] : ''}` : '';
  $('#btnLogout').hidden = !session;
  route();
}

async function init() {
  $('#btnMenu').addEventListener('click', e => { const o = $('#side').classList.toggle('open'); e.currentTarget.setAttribute('aria-expanded', String(o)); });
  $('#btnLogout').addEventListener('click', async () => { await signOut(); snack('Sesión cerrada'); });
  window.addEventListener('hashchange', route);
  const { client, status } = await initSupabase();
  ctx.db = status;
  setCurrency(appConfig().MONEDA);
  if (appConfig().TIENDA_NOMBRE) $('#sideStore').textContent = appConfig().TIENDA_NOMBRE;
  initAuth(client, onSession);
}

init();
