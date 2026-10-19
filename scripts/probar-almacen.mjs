// Prueba de punta a punta de la API que usa la herramienta de almacén, contra el Supabase LOCAL
// con los datos del seed (supabase/seed). Hace las mismas llamadas que js/services/interno.js.
// Deja el stock como estaba: cada entrada de prueba se compensa con una salida y el conteo se anula
// (los movimientos quedan en el historial, que es inmutable, con el motivo «Prueba automática»).
// Uso: npx supabase start  →  npm run test:almacen
import { supabaseLocal } from './lib/supabase-local.mjs';

const { url, key } = supabaseLocal();
const USUARIOS = { almacenero: ['almacenero@tienda.bo', 'almacenero123'], cliente: ['cliente@tienda.bo', 'cliente123'] };
const ETIQUETA = 'Escolar Clásico';   // etiqueta del modelo de IA vinculada a un producto demo
const MOTIVO = 'Prueba automática';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔', m); } else { fail++; console.log('  ✘', m); } };

async function login(email, password) {
  const r = await fetch(`${url}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const j = await r.json();
  if (!r.ok) throw new Error(`No se pudo iniciar sesión como ${email}: ${j.msg || j.error_description || r.status}`);
  return { token: j.access_token, id: j.user.id };
}
async function api(sesion, path, { method = 'GET', body } = {}) {
  const headers = { apikey: key, 'Content-Type': 'application/json', Accept: 'application/json' };
  if (sesion) headers.Authorization = `Bearer ${sesion.token}`;
  const r = await fetch(`${url}/rest/v1/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  const data = text ? JSON.parse(text) : null;
  return { ok: r.ok, status: r.status, data, error: r.ok ? '' : (data?.message || String(r.status)) };
}
const rpc = (sesion, fn, args) => api(sesion, `rpc/${fn}`, { method: 'POST', body: args });
const q = encodeURIComponent;

console.log(`Supabase local: ${url}`);

console.log('\nAnónimo (tienda pública)');
const anonProd = await api(null, 'tienda_productos?select=id,nombre');
ok(anonProd.ok && anonProd.data.length > 0, `ve el catálogo publicado (${anonProd.data?.length ?? 0} productos)`);
const anonStock = await api(null, 'existencias?select=cantidad');
ok(!anonStock.ok, `no lee existencias (${anonStock.status} «${anonStock.error}»)`);

console.log('\nAlmacenero: sesión y consulta');
const alm = await login(...USUARIOS.almacenero);
ok(!!alm.token, 'inicia sesión con correo y contraseña');
const perfil = (await api(alm, `perfiles?select=rol,activo&id=eq.${alm.id}`)).data?.[0];
ok(perfil?.rol === 'operador' && perfil.activo, `perfil interno activo con rol «operador» (Almacenero)`);
const almacenes = (await api(alm, 'almacenes?select=id,nombre&activo=eq.true&order=nombre')).data || [];
ok(almacenes.length >= 1, `ve los almacenes (${almacenes.map(a => a.nombre).join(', ')})`);
const central = almacenes.find(a => a.nombre === 'Almacén Central') || almacenes[0];
const prod = (await api(alm, `productos?select=id,nombre&etiqueta_clasificador=eq.${q(ETIQUETA)}`)).data?.[0];
ok(!!prod, `la etiqueta de la cámara «${ETIQUETA}» encuentra su producto`);
const variantes = prod ? (await api(alm, `variantes?select=id,sku&producto_id=eq.${prod.id}&order=sku`)).data : [];
ok(variantes.length > 0, `el producto tiene variantes (${variantes.length})`);
const v = variantes[0];
const leerSaldo = async () => (await api(alm, `v_existencias?select=cantidad&variante_id=eq.${v.id}&almacen_id=eq.${central.id}`)).data?.[0]?.cantidad ?? 0;
const inicial = await leerSaldo();
ok(Number.isInteger(inicial), `lee la existencia de ${v.sku} en ${central.nombre}: ${inicial}`);

console.log('\nAlmacenero: movimientos');
let r = await rpc(alm, 'registrar_movimiento_inventario', { p_variante_id: v.id, p_almacen_id: central.id, p_tipo: 'entrada', p_cantidad: 5, p_motivo: MOTIVO, p_origen: 'camara', p_dispositivo: 'probar-almacen' });
ok(r.ok && r.data[0]?.saldo === inicial + 5, `entrada de 5 desde la cámara → saldo ${r.data?.[0]?.saldo ?? r.error}`);
r = await rpc(alm, 'registrar_movimiento_inventario', { p_variante_id: v.id, p_almacen_id: central.id, p_tipo: 'salida', p_cantidad: 5, p_motivo: MOTIVO, p_dispositivo: 'probar-almacen' });
ok(r.ok && r.data[0]?.saldo === inicial, `salida de 5 → saldo ${r.data?.[0]?.saldo ?? r.error} (vuelve al inicial)`);
r = await rpc(alm, 'registrar_movimiento_inventario', { p_variante_id: v.id, p_almacen_id: central.id, p_tipo: 'salida', p_cantidad: inicial + 1, p_motivo: MOTIVO });
ok(!r.ok && /Stock insuficiente/.test(r.error), `una salida mayor que el stock se rechaza («${r.error}»)`);
r = await rpc(alm, 'registrar_movimiento_inventario', { p_variante_id: v.id, p_almacen_id: central.id, p_tipo: 'salida', p_cantidad: 1 });
ok(!r.ok && /motivo/.test(r.error), `una salida sin motivo se rechaza («${r.error}»)`);
r = await rpc(alm, 'registrar_movimiento_inventario', { p_variante_id: v.id, p_almacen_id: central.id, p_tipo: 'ajuste_positivo', p_cantidad: 1, p_motivo: MOTIVO });
ok(!r.ok && /Solo un administrador/.test(r.error), `el almacenero no puede hacer ajustes («${r.error}»)`);
const hist = (await api(alm, `v_movimientos?select=tipo,cantidad,saldo,origen,usuario_id&variante_id=eq.${v.id}&order=id.desc&limit=2`)).data || [];
ok(hist.length === 2 && hist[0].tipo === 'salida' && hist[1].tipo === 'entrada' && hist[1].origen === 'camara' && hist.every(m => m.usuario_id === alm.id),
  'el historial registra los dos movimientos, con su usuario y el origen «cámara»');
ok(await leerSaldo() === inicial, 'la existencia final es igual a la inicial');

console.log('\nAlmacenero: conteo físico');
r = await rpc(alm, 'conteo_crear', { p_almacen_id: central.id, p_notas: MOTIVO });
const conteo = r.data;
ok(r.ok && !!conteo, 'crea un conteo en su almacén');
r = await rpc(alm, 'conteo_registrar_linea', { p_conteo_id: conteo, p_variante_id: v.id, p_cantidad: inicial + 1 });
ok(r.ok && r.data === inicial, `registra lo contado y guarda el stock del sistema (${r.data ?? r.error})`);
r = await rpc(alm, 'conteo_aplicar', { p_conteo_id: conteo });
ok(!r.ok && /Solo un administrador/.test(r.error), `aplicar el conteo queda para el administrador («${r.error}»)`);
r = await rpc(alm, 'conteo_anular', { p_conteo_id: conteo });
ok(r.ok, 'anula su propio conteo abierto');
ok(await leerSaldo() === inicial, 'el conteo anulado no cambia la existencia');

console.log('\nCliente (sin acceso interno)');
const cli = await login(...USUARIOS.cliente);
r = await rpc(cli, 'registrar_movimiento_inventario', { p_variante_id: v.id, p_almacen_id: central.id, p_tipo: 'entrada', p_cantidad: 1 });
ok(!r.ok && /cuenta de personal/.test(r.error), `no puede registrar movimientos («${r.error}»)`);
ok(((await api(cli, 'existencias?select=cantidad')).data || []).length === 0, 've 0 filas de existencias');
ok(((await api(cli, 'mercado_comercio?select=id')).data || []).length === 0, 've 0 filas del mercado');
ok(((await api(alm, 'mercado_comercio?select=id')).data || []).length > 0, 'el personal sí ve el mercado del Excel');

console.log(`\n${pass} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
