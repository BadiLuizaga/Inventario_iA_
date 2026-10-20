// Pruebas AISLADAS de las migraciones en PostgreSQL en memoria (PGlite).
// No se conecta a Supabase: los registros de prueba existen solo en memoria y se descartan.
// Uso: npm run test:db
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MIG = process.argv[2] || fileURLToPath(new URL('../migrations', import.meta.url));
const db = new PGlite();
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔', m); } else { fail++; console.log('  ✘', m); } };

// --- Entorno mínimo que imita Supabase ---
// SIN_PRIVILEGIOS_POR_DEFECTO=1 simula un proyecto que no concede privilegios automáticos en public.
const porDefecto = process.env.SIN_PRIVILEGIOS_POR_DEFECTO ? '' : `
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;`;
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;${porDefecto}
  create schema auth; grant usage on schema auth to anon, authenticated;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}',
    email_confirmed_at timestamptz, created_at timestamptz default now(), last_sign_in_at timestamptz);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant execute on function auth.uid() to anon, authenticated;
  create schema storage; grant usage on schema storage to anon, authenticated;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  grant all on storage.objects to authenticated;
`);

console.log('Migraciones');
for (const f of ['0001_esquema_inicial.sql', '0002_tienda_variantes_almacenes.sql', '0003_mercado_calzado.sql', '0004_escaneos_ia.sql', '0005_analitica.sql']) {
  try { await db.exec(readFileSync(`${MIG}/${f}`, 'utf8')); ok(true, `${f} se aplica sin errores`); }
  catch (e) { ok(false, `${f}: ${e.message}`); process.exit(1); }
}

// --- Utilidades ---
const U = { admin: 'a0000000-0000-0000-0000-000000000001', oper: 'a0000000-0000-0000-0000-000000000002',
  lector: 'a0000000-0000-0000-0000-000000000003', cli1: 'a0000000-0000-0000-0000-000000000004',
  cli2: 'a0000000-0000-0000-0000-000000000005', otro: 'a0000000-0000-0000-0000-000000000006' };
async function as(who, sql, params = []) {
  // Cada consulta en su transacción, como PostgREST
  return db.transaction(async tx => {
    if (who === 'anon') { await tx.exec(`set local role anon; select set_config('request.jwt.claim.sub', '', true);`); }
    else if (who) { await tx.exec(`set local role authenticated; select set_config('request.jwt.claim.sub', '${U[who]}', true);`); }
    return (await tx.query(sql, params)).rows;
  });
}
async function fails(who, sql, re, msg, params = []) {
  try { await as(who, sql, params); ok(false, `${msg} (no falló)`); }
  catch (e) { ok(re.test(e.message), `${msg} → «${e.message}»`); }
}
const one = async (who, sql, p) => (await as(who, sql, p))[0];

console.log('\nTablas de negocio vacías tras migrar');
const counts = await db.query(`select relname, (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', relname), false, true, '')))[1]::text::int n
  from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and relkind = 'r'`);
ok(counts.rows.every(r => r.n === 0 || r.relname === 'config_tienda' && r.n === 0), `todas las tablas public con 0 filas (${counts.rows.length} tablas)`);

console.log('\nCuentas y roles');
for (const [k, id] of Object.entries(U)) await db.query(`insert into auth.users (id, email, email_confirmed_at) values ($1, $2, case when $3 then now() end)`, [id, `${k}@prueba.local`, k !== 'otro']);
ok((await db.query('select count(*)::int n from public.clientes')).rows[0].n === 6, 'cada cuenta nueva recibe registro de cliente');
ok((await db.query('select count(*)::int n from public.perfiles')).rows[0].n === 0, 'ninguna cuenta nueva recibe perfil interno');
// Primer administrador: procedimiento documentado (SQL Editor, como propietario)
await db.query(`insert into public.perfiles (id, nombre, rol) values ($1, 'Admin', 'admin')`, [U.admin]);
await fails('cli1', `select public.admin_asignar_rol($1, 'admin')`, /Solo un administrador/, 'un cliente no puede asignarse admin', [U.cli1]);
await fails('cli1', `insert into public.perfiles (id, rol) values ($1, 'admin')`, /permission denied/, 'un cliente no puede insertar su perfil', [U.cli1]);
await as('admin', `select public.admin_asignar_rol($1, 'operador', true, 'Operador')`, [U.oper]);
await as('admin', `select public.admin_asignar_rol($1, 'lector', true, 'Lector')`, [U.lector]);
ok((await db.query('select count(*)::int n from public.perfiles')).rows[0].n === 3, 'admin asigna operador y lector');
await fails('oper', `select public.admin_asignar_rol($1, 'admin')`, /Solo un administrador/, 'un operador no puede elevarse ni elevar a otros', [U.otro]);
await fails('admin', `select public.admin_asignar_rol($1, 'lector')`, /propio rol/, 'el admin no puede cambiar su propio rol', [U.admin]);
await fails('oper', `update public.perfiles set rol = 'admin' where id = $1`, /permission denied/, 'update directo de perfiles bloqueado', [U.oper]);
const lu = await as('admin', 'select * from public.admin_listar_usuarios()');
ok(lu.length === 6, 'admin_listar_usuarios devuelve las cuentas al admin');
await fails('lector', 'select * from public.admin_listar_usuarios()', /Solo un administrador/, 'lector no puede listar usuarios');

console.log('\nDatos maestros (solo admin)');
const marca = (await one('admin', `insert into public.marcas (nombre) values ('M') returning id`)).id;
await fails('oper', `insert into public.marcas (nombre) values ('X')`, /row-level security/, 'operador no puede crear marcas');
await fails('cli1', `insert into public.marcas (nombre) values ('X')`, /row-level security/, 'cliente no puede crear marcas');
const cat = (await one('admin', `insert into public.categorias (nombre) values ('C') returning id`)).id;
const talla = (await one('admin', `insert into public.tallas (nombre) values ('40') returning id`)).id;
const color = (await one('admin', `insert into public.colores (nombre, hex) values ('Negro', '#000000') returning id`)).id;
const suc = (await one('admin', `insert into public.sucursales (nombre) values ('S') returning id`)).id;
const a1 = (await one('admin', `insert into public.almacenes (sucursal_id, nombre) values ($1, 'A1') returning id`, [suc])).id;
const a2 = (await one('admin', `insert into public.almacenes (sucursal_id, nombre) values ($1, 'A2') returning id`, [suc])).id;
const prod = (await one('admin', `insert into public.productos (nombre, precio, marca_id, categoria_id, publicado) values ('P', 100, $1, $2, true) returning id`, [marca, cat])).id;
const prodOculto = (await one('admin', `insert into public.productos (nombre, precio) values ('Oculto', 50) returning id`)).id;
const v1 = (await one('admin', `insert into public.variantes (producto_id, talla_id, color_id) values ($1, $2, $3) returning id`, [prod, talla, color])).id;
await fails('admin', `insert into public.variantes (producto_id, talla_id, color_id) values ($1, $2, $3)`, /duplicate key/, 'no se duplica la combinación talla/color', [prod, talla, color]);
ok((await one(null, 'select count(*)::int n from public.inventario')).n === 0, 'la tabla antigua inventario no recibe filas de productos nuevos');
void prodOculto;

console.log('\nTienda pública (anon)');
ok((await as('anon', 'select * from public.tienda_productos')).length === 1, 'anon ve solo productos publicados');
await fails('anon', 'select * from public.productos', /permission denied/, 'anon no lee la tabla productos');
await fails('anon', 'select * from public.existencias', /permission denied/, 'anon no lee existencias');
await fails('anon', 'select * from public.v_existencias', /permission denied/, 'anon no lee v_existencias');
await fails('anon', 'select * from public.pedidos', /permission denied/, 'anon no lee pedidos');
let d = await as('anon', 'select * from public.tienda_disponibilidad()');
ok(d.length === 1 && d[0].estado === 'agotado', 'sin stock → «agotado»');
ok(Object.keys(d[0]).join() === 'producto_id,variante_id,estado', 'la disponibilidad no incluye cantidades');
await fails('anon', `select public.crear_pedido('[]'::jsonb, 'envio')`, /permission denied/, 'anon no puede crear pedidos');

console.log('\nMovimientos de almacén');
await as('oper', `select * from public.registrar_movimiento_inventario($1, $2, 'entrada', 5)`, [v1, a1]);
await as('oper', `select * from public.registrar_movimiento_inventario($1, $2, 'entrada', 2)`, [v1, a2]);
await fails('oper', `select * from public.registrar_movimiento_inventario($1, $2, 'salida', 1)`, /motivo/, 'salida sin motivo rechazada', [v1, a1]);
await fails('oper', `select * from public.registrar_movimiento_inventario($1, $2, 'salida', 9, 'x')`, /Stock insuficiente/, 'no permite stock negativo', [v1, a1]);
await fails('oper', `select * from public.registrar_movimiento_inventario($1, $2, 'ajuste_positivo', 1, 'x')`, /Solo un administrador/, 'operador no puede ajustar', [v1, a1]);
await fails('oper', `select * from public.registrar_movimiento_inventario($1, $2, 'pedido', 1, 'x')`, /solo lo generan los pedidos/, 'tipo pedido no es manual', [v1, a1]);
await fails('lector', `select * from public.registrar_movimiento_inventario($1, $2, 'entrada', 1)`, /Sin permiso/, 'lector no registra movimientos', [v1, a1]);
await fails('cli1', `select * from public.registrar_movimiento_inventario($1, $2, 'entrada', 1)`, /cuenta de personal/, 'cliente no registra movimientos', [v1, a1]);
await fails('oper', `select * from public.registrar_movimiento_inventario($1, $2, 'entrada', 0)`, /entre 1 y 100000/, 'cantidad 0 rechazada', [v1, a1]);
await fails('oper', `update public.existencias set cantidad = 999`, /permission denied/, 'update directo de existencias bloqueado');
await fails('admin', `insert into public.movimientos_inventario (variante_id, almacen_id, tipo, cantidad, saldo, usuario_id) values ($1, $2, 'entrada', 1, 1, $3)`, /permission denied/, 'insert directo de movimientos bloqueado', [v1, a1, U.admin]);
await fails(null, `update public.movimientos_inventario set cantidad = 1`, /no se pueden modificar/, 'movimientos inmutables incluso para el propietario');
await fails('oper', `select * from public.registrar_movimiento(gen_random_uuid(), 'entrada', 1)`, /permission denied/, 'la función antigua de 0001 ya no es ejecutable');
ok((await one('lector', 'select sum(cantidad)::int s from public.existencias')).s === 7, 'lector consulta existencias reales (7)');

console.log('\nVistas públicas: solo lectura');
for (const [who, sql] of [
  ['anon', `update public.tienda_productos set precio = 1`],
  ['anon', `delete from public.tienda_marcas`],
  ['anon', `insert into public.tienda_marcas (nombre) values ('X')`],
  ['cli1', `update public.tienda_sucursales set nombre = 'X'`],
  ['cli1', `update public.tienda_categorias set nombre = 'X'`],
  ['cli1', `update public.tienda_tallas set nombre = 'X'`],
  ['cli1', `update public.tienda_colores set nombre = 'X'`],
  ['oper', `update public.tienda_productos set nombre = 'X'`],
]) await fails(who, sql, /permission denied/, `${who}: «${sql.slice(0, 40)}…» bloqueado`);
ok((await one(null, 'select precio::int p from public.productos where id = $1', [prod])).p === 100, 'el precio publicado sigue intacto');
const privVistas = await db.query(`select c.relname, r.rol, p.priv from pg_class c join pg_namespace n on n.oid = c.relnamespace
  cross join unnest(array['anon', 'authenticated']) r(rol) cross join unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p(priv)
  where n.nspname = 'public' and c.relkind = 'v' and has_table_privilege(r.rol, c.oid, p.priv)`);
ok(privVistas.rows.length === 0, `ninguna vista admite escritura de anon/authenticated (${privVistas.rows.map(r => `${r.relname}:${r.rol}:${r.priv}`).join(', ') || '10 vistas'})`);

console.log('\nAislamiento del cliente');
for (const t of ['existencias', 'movimientos_inventario', 'v_existencias', 'v_movimientos', 'conteos', 'perfiles', 'productos', 'inventario', 'movimientos', 'almacenes', 'pedido_asignaciones', 'config_tienda'])
  ok((await as('cli1', `select * from public.${t}`)).length === 0, `cliente ve 0 filas en ${t}`);
d = await as('cli1', 'select * from public.tienda_disponibilidad()');
ok(d[0].estado === 'disponible', 'stock 7 > 3 → «disponible»');
await as('admin', 'select public.config_tienda_guardar(0, 10)');
ok((await as('anon', 'select * from public.tienda_disponibilidad()'))[0].estado === 'pocas', 'umbral configurable: 7 ≤ 10 → «pocas»');
await fails('oper', 'select public.config_tienda_guardar(0, 1)', /Solo un administrador/, 'solo admin cambia umbrales');
await as('admin', 'select public.config_tienda_guardar(0, 3)');

console.log('\nPedidos atómicos');
const lines = n => JSON.stringify([{ variante_id: v1, cantidad: n }]);
const p1 = (await one('cli1', `select public.crear_pedido($1::jsonb, 'retiro', $2, '', '70000000') as id`, [lines(6), suc])).id;
ok(!!p1, 'pedido de 6 creado (estado pendiente)');
let st = await db.query('select almacen_id, cantidad from public.existencias order by cantidad');
ok(st.rows.map(r => r.cantidad).join() === '0,1', 'reserva repartida entre almacenes: 5 de A1 y 1 de A2');
ok((await one(null, 'select total::text t from public.pedidos where id = $1', [p1])).t === '600.00', 'total calculado en la base (6 × 100)');
const movsAntes = (await one(null, 'select count(*)::int n from public.movimientos_inventario')).n;
await fails('cli2', `select public.crear_pedido($1::jsonb, 'retiro', $2, '', '70000000')`, /No hay existencias suficientes/, 'pedido sin stock suficiente rechazado', [lines(3), suc]);
ok((await one(null, 'select count(*)::int n from public.pedidos')).n === 1, 'el pedido rechazado no deja registro');
ok((await one(null, 'select count(*)::int n from public.movimientos_inventario')).n === movsAntes, 'ni movimientos parciales');
await fails('cli1', `select public.crear_pedido($1::jsonb, 'envio', null, '', '70000000')`, /dirección/, 'envío sin dirección rechazado', [lines(1)]);
await fails('cli1', `select public.crear_pedido($1::jsonb, 'retiro', $2, '', '70000000')`, /entre 1 y 20/, 'cantidad > 20 rechazada', [lines(21), suc]);
await fails('cli1', `select public.crear_pedido($1::jsonb, 'retiro', $2, '', '70000000')`, /ya no está disponible/, 'producto no publicado no se puede pedir',
  [JSON.stringify([{ variante_id: '00000000-0000-0000-0000-000000000000', cantidad: 1 }]), suc]);
ok((await as('cli2', 'select * from public.pedidos')).length === 0, 'cliente 2 no ve el pedido del cliente 1');
ok((await as('cli1', 'select * from public.pedidos')).length === 1, 'cliente 1 ve su pedido');
ok((await as('cli1', 'select * from public.pedido_lineas')).length === 1, 'cliente 1 ve sus líneas');
await fails('cli2', 'select public.cancelar_mi_pedido($1)', /inexistente/, 'cliente 2 no puede cancelar pedido ajeno', [p1]);
await fails('cli1', `select public.pedido_cambiar_estado($1, 'confirmado')`, /Solo un administrador/, 'cliente no cambia estados', [p1]);
await as('cli1', 'select public.cancelar_mi_pedido($1)', [p1]);
st = await db.query('select cantidad from public.existencias order by cantidad');
ok(st.rows.map(r => r.cantidad).join() === '2,5', 'cancelar devuelve el stock a cada almacén de origen');

const p2 = (await one('cli2', `select public.crear_pedido($1::jsonb, 'envio', null, 'Calle 1', '70000000') as id`, [lines(2)])).id;
await fails('admin', `select public.pedido_cambiar_estado($1, 'entregado')`, /No se puede pasar/, 'transición inválida rechazada', [p2]);
for (const s of ['confirmado', 'preparando', 'enviado', 'entregado']) await as('admin', `select public.pedido_cambiar_estado($1, '${s}')`, [p2]);
ok((await one(null, 'select estado from public.pedidos where id = $1', [p2])).estado === 'entregado', 'flujo pendiente → entregado');
ok((await as('cli2', 'select * from public.pedido_historial where pedido_id = $1', [p2])).length === 5, 'historial de estados visible al cliente');
await fails('admin', `select public.pedido_cambiar_estado($1, 'cancelado')`, /No se puede pasar/, 'un pedido entregado no se cancela', [p2]);

console.log('\nConteos físicos');
const c1 = (await one('oper', 'select public.conteo_crear($1) as id', [a1])).id;
const sis = (await one('oper', 'select public.conteo_registrar_linea($1, $2, 1) as s', [c1, v1])).s;
ok(sis === 3, `snapshot del sistema guardado (${sis})`);
await fails('oper', 'select * from public.conteo_aplicar($1)', /Solo un administrador/, 'operador no aplica conteos', [c1]);
await fails('cli1', 'select public.conteo_crear($1)', /Sin permiso/, 'cliente no crea conteos', [a1]);
const ap = await as('admin', 'select * from public.conteo_aplicar($1)', [c1]);
ok(ap.length === 1 && ap[0].ajuste === -2, 'aplicar conteo genera ajuste −2');
ok((await one(null, 'select cantidad from public.existencias where variante_id = $1 and almacen_id = $2', [v1, a1])).cantidad === 1, 'existencia igual a lo contado');
ok((await one(null, `select count(*)::int n from public.movimientos_inventario where conteo_id = $1 and tipo = 'ajuste_negativo'`, [c1])).n === 1, 'ajuste trazado con el conteo');
await fails('oper', 'select public.conteo_registrar_linea($1, $2, 1)', /cerrado/, 'conteo aplicado ya no se modifica', [c1, v1]);

console.log('\nCuenta desactivada');
await as('admin', `select public.admin_asignar_rol($1, 'operador', false)`, [U.oper]);
ok((await as('oper', 'select * from public.existencias')).length === 0, 'operador desactivado pierde la lectura');
await fails('oper', `select * from public.registrar_movimiento_inventario($1, $2, 'entrada', 1)`, /cuenta de personal/, 'y la escritura', [v1, a1]);

console.log('\nAdministración: último admin');
await as('admin', `select public.admin_asignar_rol($1, 'admin', true)`, [U.lector]);
await as('lector', `select public.admin_asignar_rol($1, 'lector', true)`, [U.admin]);
ok((await one(null, `select count(*)::int n from public.perfiles where rol = 'admin' and activo`)).n === 1, 'un admin puede degradar a otro mientras quede uno');
await fails('lector', `select public.admin_asignar_rol($1, 'operador', true)`, /correo/, 'no se da acceso interno a una cuenta sin correo confirmado', [U.otro]);

console.log('\nEndurecimiento');
await as('lector', `select * from public.registrar_movimiento_inventario($1, $2, 'entrada', 20)`, [v1, a2]);
for (let i = 0; i < 5; i++) await as('cli1', `select public.crear_pedido($1::jsonb, 'retiro', $2, '', '70000000')`, [lines(1), suc]);
await fails('cli1', `select public.crear_pedido($1::jsonb, 'retiro', $2, '', '70000000')`, /5 pedidos pendientes/, 'máximo 5 pedidos pendientes por cliente', [lines(1), suc]);
const c2 = (await one('lector', 'select public.conteo_crear($1) as id', [a1])).id;
await fails('lector', `select * from public.conteo_aplicar($1, '{}'::uuid[])`, /al menos un artículo/, 'aplicar conteo con selección vacía rechazado', [c2]);
ok((await one(null, 'select estado from public.conteos where id = $1', [c2])).estado === 'abierto', 'y el conteo sigue abierto');

console.log('\nMercado de calzado (0003)');
// Carga como propietario, igual que el seed
await db.query(`insert into public.mercado_comercio (pais_reportante, flujo, anio, codigo_sa6, categoria, socio, valor_usd, pares) values
  ('España', 'importacion', 2024, '640411', 'Deportivo', 'China', 1000, 40), ('España', 'importacion', 2024, '640411', 'Deportivo', 'China', 500, 0)`);
ok((await one(null, 'select valor_usd_por_par::text p from public.mercado_comercio where pares = 40')).p === '25.00', 'valor por par calculado en la base (1000 / 40)');
ok((await one(null, 'select valor_usd_por_par p from public.mercado_comercio where pares = 0')).p === null, 'sin pares no hay valor por par');
await fails(null, `insert into public.mercado_comercio (pais_reportante, flujo, anio, codigo_sa6, categoria, socio, valor_usd) values ('España', 'otro', 2024, '640411', 'C', 'S', 1)`, /check constraint/, 'flujo desconocido rechazado');
await fails('anon', 'select * from public.mercado_comercio', /permission denied/, 'anon no lee el mercado');
ok((await as('cli1', 'select * from public.mercado_comercio')).length === 0, 'cliente ve 0 filas del mercado');
ok((await as('oper', 'select * from public.mercado_comercio')).length === 0, 'cuenta desactivada ve 0 filas del mercado');
ok((await as('admin', 'select * from public.mercado_comercio')).length === 2, 'personal activo (lector) consulta el mercado');
await fails('lector', `insert into public.mercado_comercio (pais_reportante, flujo, anio, codigo_sa6, categoria, socio, valor_usd) values ('España', 'exportacion', 2024, '640411', 'C', 'S', 1)`, /permission denied/, 'ni un admin escribe en el mercado desde la app');
await fails('lector', `delete from public.mercado_comercio`, /permission denied/, 'ni lo borra');

console.log('\nEscaneos de la cámara (0004)');
// A esta altura: «lector» es admin, «admin» quedó como lector (personal sin escritura) y «oper» está desactivado
await as('lector', `update public.productos set etiqueta_clasificador = 'Escolar Clásico' where id = $1`, [prod]);
const stockAntes = (await one(null, 'select coalesce(sum(cantidad), 0)::int n from public.existencias')).n;
const scan = (who, clase = 'Escolar Clásico', dudoso = false) => as(who, `select public.escaneo_registrar('zapatos', $1, 0.91, 'Escolar Velcro', 0.07, $2, $3, $4) as id`,
  [clase, dudoso, dudoso ? 'poco margen' : null, a1]).then(r => r[0].id);
const e1 = await scan('admin');
const f1 = await one(null, 'select usuario_id, producto_predicho_id, resultado, confianza::text c from public.escaneos_ia where id = $1', [e1]);
ok(f1.usuario_id === U.admin && f1.producto_predicho_id === prod && f1.resultado === 'pendiente' && f1.c === '0.910', 'personal de solo consulta registra un escaneo pendiente con el producto de la etiqueta');
await fails('cli1', `select public.escaneo_registrar('zapatos', 'Escolar Clásico', 0.9)`, /Sin permiso/, 'un cliente no registra escaneos');
await fails('oper', `select public.escaneo_registrar('zapatos', 'Escolar Clásico', 0.9)`, /Sin permiso/, 'una cuenta desactivada no registra escaneos');
await fails('anon', `select public.escaneo_registrar('zapatos', 'Escolar Clásico', 0.9)`, /permission denied/, 'anon no registra escaneos');
await fails('admin', `insert into public.escaneos_ia (usuario_id, modelo, clase_predicha, confianza) values ($1, 'm', 'c', 1)`, /permission denied/, 'insert directo bloqueado', [U.admin]);
await fails('lector', `update public.escaneos_ia set resultado = 'confirmado'`, /permission denied/, 'ni un admin edita escaneos directamente');
await fails('admin', `select public.escaneo_registrar('zapatos', 'Escolar Clásico', 1.5)`, /check constraint/, 'confianza fuera de 0–1 rechazada');

ok((await one('admin', `select public.escaneo_resolver($1, 'corregido', $2) r`, [e1, prodOculto])).r === 'corregido', 'corregir con otro producto');
await fails('admin', `select public.escaneo_resolver($1, 'confirmado')`, /ya resuelto/, 'un escaneo resuelto no se vuelve a resolver', [e1]);
const e2 = await scan('admin');
await fails('lector', `select public.escaneo_resolver($1, 'confirmado')`, /inexistente o ya resuelto/, 'nadie resuelve el escaneo de otra persona', [e2]);
ok((await one('admin', `select public.escaneo_resolver($1, 'corregido', $2) r`, [e2, prod])).r === 'confirmado', 'corregir eligiendo el mismo producto cuenta como confirmado');
const e3 = await scan('admin', 'Fondo raro');
await fails('admin', `select public.escaneo_resolver($1, 'confirmado')`, /no está vinculada/, 'no se confirma una etiqueta sin producto', [e3]);
ok((await one('admin', `select public.escaneo_resolver($1, 'descartado', $2) r`, [e3, prod])).r === 'descartado', 'descartar');
ok((await one(null, 'select producto_confirmado_id from public.escaneos_ia where id = $1', [e3])).producto_confirmado_id === null, 'un descarte no guarda producto');
await fails('admin', `select public.escaneo_resolver($1, 'pendiente')`, /no válido|ya resuelto/, 'no se vuelve a «pendiente»', [await scan('admin')]);
await scan('lector', 'Escolar Clásico', true);
ok((await as('admin', 'select * from public.escaneos_ia')).every(r => r.usuario_id === U.admin), 'el personal ve solo sus escaneos');
ok((await as('lector', 'select * from public.escaneos_ia')).length === 5, 'el admin ve todos los escaneos');
ok((await as('cli1', 'select * from public.escaneos_ia')).length === 0, 'un cliente ve 0 escaneos');
await fails('anon', 'select * from public.escaneos_ia', /permission denied/, 'anon no lee escaneos');
ok((await one(null, 'select coalesce(sum(cantidad), 0)::int n from public.existencias')).n === stockAntes, 'escanear no modifica el inventario');

console.log('\nAnalítica de la tienda (0005)');
// Aquí también: «lector» es el admin y «admin» es personal de solo consulta
const S1 = 'b0000000-0000-4000-8000-000000000001', V1 = 'c0000000-0000-4000-8000-000000000001';
const ses = (id = S1, vis = V1) => JSON.stringify({ id, visitante: vis, dispositivo: 'movil', navegador: 'Chrome', sistema: 'Android' });
const reg = (who, eventos = [], extra = '', params = []) => as(who, `select public.analitica_registrar($1::jsonb, $2::jsonb${extra})`, [ses(), JSON.stringify(eventos), ...params]);
const ahora = new Date().toISOString();
await reg('anon', [
  { t: ahora, tipo: 'pagina', ruta: '#/', url: '#/' },
  { t: ahora, tipo: 'clic', ruta: '#/', selector: 'a.pcard', texto: 'Oxford', x: 0.5, y: 300, ancho: 390, alto: 2000 },
  { t: ahora, tipo: 'furia', ruta: '#/', selector: 'button.size' },
  { t: ahora, tipo: 'raro', ruta: '#/' },
]);
const s1 = await one(null, 'select * from public.analitica_sesiones where id = $1', [S1]);
ok(s1 && s1.usuario_id === null && s1.dispositivo === 'movil' && s1.paginas === 1 && s1.clics === 1 && s1.clics_furia === 1 && s1.eventos === 3,
  'un visitante sin sesión registra su visita (los tipos desconocidos se ignoran)');
ok(s1.pagina_entrada === '#/', 'la sesión guarda la página de entrada');
await reg('cli1', [{ t: ahora, tipo: 'personalizado', ruta: '#/pedido-ok/1', nombre: 'pedido_realizado' }]);
const s1b = await one(null, 'select usuario_id, convertida from public.analitica_sesiones where id = $1', [S1]);
ok(s1b.usuario_id === U.cli1 && s1b.convertida, 'al iniciar sesión la visita se identifica y el pedido la marca como convertida');
await fails('anon', `select public.analitica_registrar($1::jsonb)`, /Sesión no válida/, 'otro visitante no puede escribir en una sesión ajena', [ses(S1, 'c0000000-0000-4000-8000-000000000009')]);
await fails('anon', `select public.analitica_registrar('{"id":"x"}'::jsonb)`, /Sesión no válida/, 'una sesión sin identificadores válidos se rechaza');
await fails('anon', `select public.analitica_registrar($1::jsonb, $2::jsonb)`, /Demasiados eventos/, 'más de 100 eventos por llamada se rechaza',
  [ses(), JSON.stringify(Array.from({ length: 101 }, () => ({ tipo: 'clic', ruta: '#/' })))]);
await reg('anon', [], ', $3, $4::jsonb', [0, JSON.stringify([{ type: 4, timestamp: 1 }])]);
await reg('anon', [], ', $3, $4::jsonb', [0, JSON.stringify([{ type: 4, timestamp: 2 }])]);
ok((await one(null, 'select grabacion_partes n from public.analitica_sesiones where id = $1', [S1])).n === 1, 'una parte de grabación repetida no se duplica');
await fails('anon', 'select * from public.analitica_sesiones', /permission denied/, 'anon no lee sesiones');
ok((await as('cli1', 'select * from public.analitica_eventos')).length === 0, 'un cliente no ve eventos, ni los suyos');
ok((await as('oper', 'select * from public.analitica_grabaciones')).length === 0, 'el personal que no es admin no ve grabaciones');
ok((await as('admin', 'select * from public.analitica_eventos')).length === 0, 'el lector no ve eventos');
ok((await as('lector', 'select * from public.analitica_eventos')).length === 4 && (await as('lector', 'select * from public.analitica_grabaciones')).length === 1, 'el admin ve eventos y grabaciones');
await fails('anon', `insert into public.analitica_eventos (sesion_id, creado_en, tipo, ruta) values ($1, now(), 'clic', '#/')`, /permission denied/, 'anon no inserta eventos directamente', [S1]);
await fails('lector', `update public.analitica_sesiones set convertida = false`, /permission denied/, 'ni el admin edita sesiones directamente');
await as('lector', `insert into public.analitica_definiciones (nombre, tipo, valor) values ('Clic en Oxford', 'clic_texto', 'Oxford')`);
await as('lector', `insert into public.analitica_embudos (nombre, pasos) values ('Compra', '["pagina:#/", "p:pedido_realizado"]')`);
await fails('lector', `insert into public.analitica_embudos (nombre, pasos) values ('Corto', '["pagina:#/"]')`, /check constraint/, 'un embudo necesita al menos 2 pasos');
await fails('admin', `insert into public.analitica_definiciones (nombre, tipo, valor) values ('x', 'url', '#/')`, /row-level security|permission denied/, 'el lector no define eventos');
await as('lector', `insert into public.analitica_notas (sesion_id, texto) values ($1, 'Se trabó en la talla')`, [S1]);
await fails('lector', `insert into public.analitica_notas (sesion_id, texto, autor) values ($1, 'x', $2)`, /row-level security/, 'una nota no se firma con otra cuenta', [S1, U.admin]);
ok((await as('anon', 'select * from public.analitica_config')).length === 0, 'la tienda puede leer la configuración (aún sin fila)');
await fails('admin', 'select public.analitica_config_guardar(false, false, 30)', /Solo un administrador/, 'solo el admin cambia la configuración');
await as('lector', 'select public.analitica_config_guardar(true, false, 30)');
await reg('anon', [], ', $3, $4::jsonb', [1, JSON.stringify([{ type: 3, timestamp: 3 }])]);
ok((await one(null, 'select grabacion_partes n from public.analitica_sesiones where id = $1', [S1])).n === 1, 'con la grabación apagada no se guardan partes nuevas');
await as('lector', 'select public.analitica_config_guardar(false, true, 30)');
await as('anon', `select public.analitica_registrar($1::jsonb)`, [ses('b0000000-0000-4000-8000-000000000002')]);
ok(!(await one(null, `select 1 x from public.analitica_sesiones where id = 'b0000000-0000-4000-8000-000000000002'`)), 'con la analítica apagada no se registra nada');
await db.query(`update public.analitica_sesiones set inicio = now() - interval '40 days' where id = $1`, [S1]);
await fails('admin', 'select public.analitica_purgar()', /Solo un administrador/, 'solo el admin purga');
ok((await one('lector', 'select public.analitica_purgar() n')).n === 1, 'purgar borra las sesiones más viejas que la retención');
ok((await one(null, 'select count(*)::int n from public.analitica_eventos')).n === 0 && (await one(null, 'select count(*)::int n from public.analitica_notas')).n === 0,
  'al purgar se borran también sus eventos y notas');

console.log(`\n${pass} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
