-- =====================================================================
-- 0002 — Tienda, variantes, almacenes, conteos y pedidos
--
-- SOLO ESTRUCTURA. No inserta productos, marcas, categorías, tallas,
-- colores, sucursales, almacenes, existencias, movimientos, pedidos,
-- clientes ni usuarios. El único registro técnico es el bucket de Storage
-- «productos» (configuración, no dato de negocio).
--
-- No elimina, renombra ni vacía tablas. Relación con 0001:
--   * productos     → se REUTILIZA y se amplía (columnas nuevas, nulas o con
--                     valor por defecto; los productos existentes quedan
--                     publicado = false, es decir, ocultos en la tienda).
--   * inventario    → se CONSERVA intacta como histórico (stock por producto); se
--                     deshabilita (sin borrarlo) el disparador que le añadía filas.
--   * movimientos   → se CONSERVA intacta e inmutable (historial por producto).
--   * registrar_movimiento() (0001) → se conserva pero deja de ser ejecutable
--                     por los usuarios, para que no haya dos stocks paralelos.
--   * perfiles      → pasa a ser SOLO personal interno (admin/operador/lector).
--                     Las cuentas nuevas reciben un registro en `clientes`
--                     y ningún acceso interno.
--
-- Requiere PostgreSQL 15+ (NULLS NOT DISTINCT).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------
create type public.tipo_mov_inventario as enum (
  'entrada', 'salida', 'devolucion', 'ajuste_positivo', 'ajuste_negativo', 'pedido', 'pedido_cancelado');
create type public.origen_operacion as enum ('manual', 'camara', 'tienda', 'conteo');
create type public.estado_pedido   as enum ('pendiente', 'confirmado', 'preparando', 'enviado', 'entregado', 'cancelado');
create type public.entrega_pedido  as enum ('retiro', 'envio');
create type public.estado_conteo   as enum ('abierto', 'aplicado', 'anulado');

-- ---------------------------------------------------------------------
-- Datos maestros
-- ---------------------------------------------------------------------
create table public.marcas (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null check (char_length(btrim(nombre)) between 1 and 80),
  activo     boolean not null default true,
  creado_en  timestamptz not null default now()
);
create unique index marcas_nombre_unico on public.marcas (lower(btrim(nombre)));

create table public.categorias (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null check (char_length(btrim(nombre)) between 1 and 80),
  padre_id   uuid references public.categorias (id) on delete restrict,
  orden      integer not null default 0,
  activo     boolean not null default true,
  creado_en  timestamptz not null default now(),
  check (padre_id is distinct from id)
);
create unique index categorias_nombre_unico on public.categorias (padre_id, lower(btrim(nombre))) nulls not distinct;

create table public.tallas (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null check (char_length(btrim(nombre)) between 1 and 20),
  orden      integer not null default 0,
  activo     boolean not null default true,
  creado_en  timestamptz not null default now()
);
create unique index tallas_nombre_unico on public.tallas (lower(btrim(nombre)));

create table public.colores (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null check (char_length(btrim(nombre)) between 1 and 60),
  hex        text check (hex is null or hex ~ '^#[0-9A-Fa-f]{6}$'),
  activo     boolean not null default true,
  creado_en  timestamptz not null default now()
);
create unique index colores_nombre_unico on public.colores (lower(btrim(nombre)));

create table public.sucursales (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null check (char_length(btrim(nombre)) between 1 and 120),
  direccion  text not null default '' check (char_length(direccion) <= 300),
  telefono   text not null default '' check (char_length(telefono) <= 30),
  activo     boolean not null default true,
  creado_en  timestamptz not null default now()
);
create unique index sucursales_nombre_unico on public.sucursales (lower(btrim(nombre)));

create table public.almacenes (
  id              uuid primary key default gen_random_uuid(),
  sucursal_id     uuid references public.sucursales (id) on delete restrict,
  nombre          text not null check (char_length(btrim(nombre)) between 1 and 120),
  vende_en_linea  boolean not null default true,
  activo          boolean not null default true,
  creado_en       timestamptz not null default now()
);
create unique index almacenes_nombre_unico on public.almacenes (sucursal_id, lower(btrim(nombre))) nulls not distinct;
comment on column public.almacenes.vende_en_linea is 'Si sus existencias cuentan para la disponibilidad y los pedidos de la tienda.';

-- Productos (tabla de 0001): columnas nuevas, sin tocar las existentes
alter table public.productos
  add column modelo        text check (modelo is null or char_length(btrim(modelo)) between 1 and 80),
  add column descripcion   text not null default '' check (char_length(descripcion) <= 4000),
  add column marca_id      uuid references public.marcas (id) on delete restrict,
  add column categoria_id  uuid references public.categorias (id) on delete restrict,
  add column publicado     boolean not null default false;
create index productos_marca_idx     on public.productos (marca_id);
create index productos_categoria_idx on public.productos (categoria_id);
comment on column public.productos.publicado is 'Visible en la tienda pública (además de estado = activo).';
comment on column public.productos.stock_minimo is 'OBSOLETO desde 0002: el mínimo se define por variante y almacén en public.existencias.';

create table public.producto_imagenes (
  id           uuid primary key default gen_random_uuid(),
  producto_id  uuid not null references public.productos (id) on delete cascade,
  ruta         text not null check (char_length(ruta) between 1 and 400),
  color_id     uuid references public.colores (id) on delete set null,
  orden        integer not null default 0,
  alt          text not null default '' check (char_length(alt) <= 200),
  creado_en    timestamptz not null default now()
);
create index producto_imagenes_producto_idx on public.producto_imagenes (producto_id, orden);
comment on column public.producto_imagenes.ruta is 'Ruta del archivo dentro del bucket de Storage «productos».';

create table public.variantes (
  id              uuid primary key default gen_random_uuid(),
  producto_id     uuid not null references public.productos (id) on delete cascade,
  talla_id        uuid references public.tallas (id) on delete restrict,
  color_id        uuid references public.colores (id) on delete restrict,
  sku             text check (sku is null or char_length(btrim(sku)) between 1 and 60),
  precio          numeric(12, 2) check (precio is null or precio >= 0),
  activo          boolean not null default true,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now()
);
create unique index variantes_combinacion_unica on public.variantes (producto_id, talla_id, color_id) nulls not distinct;
create unique index variantes_sku_unico on public.variantes (lower(btrim(sku))) where sku is not null;
comment on column public.variantes.precio is 'NULL = usa el precio del producto.';

-- ---------------------------------------------------------------------
-- Existencias por variante y almacén (ÚNICA fuente del stock desde 0002)
-- ---------------------------------------------------------------------
create table public.existencias (
  variante_id     uuid not null references public.variantes (id) on delete cascade,
  almacen_id      uuid not null references public.almacenes (id) on delete restrict,
  cantidad        integer not null default 0 check (cantidad >= 0),
  stock_minimo    integer not null default 0 check (stock_minimo >= 0),
  ubicacion       text not null default '' check (char_length(ubicacion) <= 60),
  actualizado_en  timestamptz not null default now(),
  primary key (variante_id, almacen_id)
);
create index existencias_almacen_idx on public.existencias (almacen_id);
comment on table public.existencias is 'La cantidad solo cambia mediante funciones atómicas que registran el movimiento en la misma transacción.';

-- ---------------------------------------------------------------------
-- Clientes de la tienda (separados del personal)
-- ---------------------------------------------------------------------
create table public.clientes (
  id         uuid primary key references auth.users (id) on delete cascade,
  nombre     text not null default '' check (char_length(nombre) <= 120),
  telefono   text not null default '' check (char_length(telefono) <= 30),
  creado_en  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Pedidos
-- ---------------------------------------------------------------------
create table public.pedidos (
  id              bigint generated always as identity primary key,
  cliente_id      uuid not null references public.clientes (id) on delete restrict,
  estado          public.estado_pedido not null default 'pendiente',
  entrega         public.entrega_pedido not null,
  sucursal_id     uuid references public.sucursales (id) on delete restrict,
  direccion       text not null default '' check (char_length(direccion) <= 300),
  telefono        text not null check (char_length(btrim(telefono)) between 6 and 30),
  notas           text not null default '' check (char_length(notas) <= 500),
  total           numeric(12, 2) not null default 0 check (total >= 0),
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  check ((entrega = 'retiro' and sucursal_id is not null) or (entrega = 'envio' and char_length(btrim(direccion)) > 0))
);
create index pedidos_cliente_idx on public.pedidos (cliente_id, creado_en desc);
create index pedidos_estado_idx  on public.pedidos (estado, creado_en desc);

create table public.pedido_lineas (
  id               bigint generated always as identity primary key,
  pedido_id        bigint not null references public.pedidos (id) on delete restrict,
  variante_id      uuid not null references public.variantes (id) on delete restrict,
  producto_nombre  text not null,
  detalle          text not null default '',
  cantidad         integer not null check (cantidad between 1 and 20),
  precio_unitario  numeric(12, 2) not null check (precio_unitario >= 0),
  unique (pedido_id, variante_id)
);

-- De qué almacén salió cada unidad reservada (interno: los clientes no lo ven)
create table public.pedido_asignaciones (
  pedido_linea_id  bigint not null references public.pedido_lineas (id) on delete restrict,
  almacen_id       uuid not null references public.almacenes (id) on delete restrict,
  cantidad         integer not null check (cantidad > 0),
  primary key (pedido_linea_id, almacen_id)
);

create table public.pedido_historial (
  id               bigint generated always as identity primary key,
  pedido_id        bigint not null references public.pedidos (id) on delete restrict,
  estado_anterior  public.estado_pedido,
  estado_nuevo     public.estado_pedido not null,
  usuario_id       uuid not null references auth.users (id) on delete restrict,
  nota             text not null default '' check (char_length(nota) <= 300),
  creado_en        timestamptz not null default now()
);
create index pedido_historial_pedido_idx on public.pedido_historial (pedido_id, creado_en);

-- ---------------------------------------------------------------------
-- Conteos físicos
-- ---------------------------------------------------------------------
create table public.conteos (
  id           uuid primary key default gen_random_uuid(),
  almacen_id   uuid not null references public.almacenes (id) on delete restrict,
  estado       public.estado_conteo not null default 'abierto',
  notas        text not null default '' check (char_length(notas) <= 500),
  creado_por   uuid not null references auth.users (id) on delete restrict,
  creado_en    timestamptz not null default now(),
  cerrado_por  uuid references auth.users (id) on delete restrict,
  cerrado_en   timestamptz
);
create index conteos_almacen_idx on public.conteos (almacen_id, creado_en desc);

create table public.conteo_lineas (
  conteo_id         uuid not null references public.conteos (id) on delete restrict,
  variante_id       uuid not null references public.variantes (id) on delete restrict,
  cantidad_contada  integer not null check (cantidad_contada between 0 and 1000000),
  cantidad_sistema  integer not null check (cantidad_sistema >= 0),
  aplicada          boolean not null default false,
  contado_por       uuid not null references auth.users (id) on delete restrict,
  contado_en        timestamptz not null default now(),
  primary key (conteo_id, variante_id)
);
comment on column public.conteo_lineas.cantidad_sistema is 'Stock registrado en el momento del conteo (para mostrar la discrepancia).';

-- ---------------------------------------------------------------------
-- Movimientos por variante y almacén (historial inmutable)
-- ---------------------------------------------------------------------
create table public.movimientos_inventario (
  id           bigint generated always as identity primary key,
  variante_id  uuid not null references public.variantes (id) on delete restrict,
  almacen_id   uuid not null references public.almacenes (id) on delete restrict,
  tipo         public.tipo_mov_inventario not null,
  cantidad     integer not null check (cantidad > 0),
  saldo        integer not null check (saldo >= 0),
  motivo       text not null default '' check (char_length(motivo) <= 300),
  referencia   text check (referencia is null or char_length(referencia) <= 120),
  pedido_id    bigint references public.pedidos (id) on delete restrict,
  conteo_id    uuid references public.conteos (id) on delete restrict,
  origen       public.origen_operacion not null default 'manual',
  usuario_id   uuid not null references auth.users (id) on delete restrict,
  dispositivo  text check (dispositivo is null or char_length(dispositivo) <= 100),
  creado_en    timestamptz not null default now()
);
create index mov_inv_fecha_idx    on public.movimientos_inventario (creado_en desc);
create index mov_inv_variante_idx on public.movimientos_inventario (variante_id, creado_en desc);
create index mov_inv_almacen_idx  on public.movimientos_inventario (almacen_id, creado_en desc);
create index mov_inv_usuario_idx  on public.movimientos_inventario (usuario_id, creado_en desc);
comment on column public.movimientos_inventario.saldo is 'Existencia resultante en ese almacén tras el movimiento.';

-- ---------------------------------------------------------------------
-- Configuración de la tienda (fila única; si no existe se usan los valores por defecto)
-- ---------------------------------------------------------------------
create table public.config_tienda (
  id               boolean primary key default true check (id),
  umbral_agotado   integer not null default 0 check (umbral_agotado >= 0),
  umbral_pocas     integer not null default 3 check (umbral_pocas >= 1),
  actualizado_en   timestamptz not null default now(),
  check (umbral_pocas > umbral_agotado)
);
comment on table public.config_tienda is 'Umbrales de disponibilidad pública. Sin fila: agotado <= 0, pocas unidades <= 3. umbral_agotado actúa como stock de seguridad que la tienda no vende.';

-- =====================================================================
-- Disparadores
-- =====================================================================
create trigger variantes_actualizado_en before update on public.variantes
  for each row execute function public.tg_actualizado_en();
create trigger pedidos_actualizado_en before update on public.pedidos
  for each row execute function public.tg_actualizado_en();

-- La tabla antigua `inventario` (stock por producto) queda congelada: los productos
-- nuevos ya no generan filas en ella. El disparador se DESHABILITA (no se elimina).
alter table public.productos disable trigger productos_crear_inventario;

create trigger movimientos_inventario_inmutables before update or delete on public.movimientos_inventario
  for each row execute function public.tg_movimientos_inmutables();
create trigger pedido_historial_inmutable before update or delete on public.pedido_historial
  for each row execute function public.tg_movimientos_inmutables();

-- Cuentas nuevas: registro de CLIENTE, sin acceso interno.
-- (Se reemplaza el cuerpo de la función de 0001; el disparador auth_crear_perfil sigue igual.
--  Los perfiles existentes no se tocan.)
create or replace function public.tg_crear_perfil() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.clientes (id, nombre)
  values (new.id, left(coalesce(new.raw_user_meta_data ->> 'nombre', ''), 120))
  on conflict (id) do nothing;
  return new;
end $$;

-- =====================================================================
-- Funciones auxiliares
-- =====================================================================
create function public.es_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.rol_actual() = 'admin', false)
$$;

create function public.es_operador_o_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.rol_actual() in ('admin', 'operador'), false)
$$;

-- Núcleo interno: cambia la existencia y registra el movimiento en la misma
-- transacción. No es ejecutable por ningún usuario (solo desde otras funciones).
create function public._mover_stock(
  p_variante_id uuid, p_almacen_id uuid, p_delta integer, p_tipo public.tipo_mov_inventario,
  p_motivo text, p_referencia text, p_pedido_id bigint, p_conteo_id uuid,
  p_origen public.origen_operacion, p_dispositivo text, p_usuario uuid
) returns table (movimiento_id bigint, saldo integer)
language plpgsql security definer set search_path = '' as $$
declare
  v_saldo integer;
  v_mov   bigint;
begin
  if p_delta = 0 then
    raise exception 'La cantidad debe ser distinta de cero' using errcode = '22023';
  end if;

  insert into public.existencias (variante_id, almacen_id) values (p_variante_id, p_almacen_id)
  on conflict (variante_id, almacen_id) do nothing;

  -- El UPDATE bloquea la fila: operaciones simultáneas se serializan y la condición se reevalúa.
  update public.existencias e
     set cantidad = e.cantidad + p_delta, actualizado_en = now()
   where e.variante_id = p_variante_id and e.almacen_id = p_almacen_id
     and e.cantidad + p_delta >= 0
  returning e.cantidad into v_saldo;

  if not found then
    raise exception 'Stock insuficiente' using errcode = '23514';
  end if;

  insert into public.movimientos_inventario
    (variante_id, almacen_id, tipo, cantidad, saldo, motivo, referencia, pedido_id, conteo_id, origen, usuario_id, dispositivo)
  values
    (p_variante_id, p_almacen_id, p_tipo, abs(p_delta), v_saldo, left(coalesce(btrim(p_motivo), ''), 300),
     left(nullif(btrim(p_referencia), ''), 120), p_pedido_id, p_conteo_id, coalesce(p_origen, 'manual'),
     p_usuario, left(nullif(btrim(p_dispositivo), ''), 100))
  returning id into v_mov;

  return query select v_mov, v_saldo;
end $$;

-- =====================================================================
-- Movimientos manuales (almacén)
--   entrada / salida / devolución → operador o admin
--   ajuste_positivo / ajuste_negativo → solo admin
--   pedido / pedido_cancelado → solo mediante las funciones de pedidos
-- =====================================================================
create function public.registrar_movimiento_inventario(
  p_variante_id  uuid,
  p_almacen_id   uuid,
  p_tipo         public.tipo_mov_inventario,
  p_cantidad     integer,
  p_motivo       text default '',
  p_referencia   text default null,
  p_origen       public.origen_operacion default 'manual',
  p_dispositivo  text default null
) returns table (movimiento_id bigint, saldo integer)
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := auth.uid();
  v_rol  public.rol_usuario := public.rol_actual();
begin
  if v_uid is null or v_rol is null then
    raise exception 'Se requiere una cuenta de personal activa' using errcode = '42501';
  end if;
  if p_tipo in ('pedido', 'pedido_cancelado') then
    raise exception 'Este tipo de movimiento solo lo generan los pedidos' using errcode = '42501';
  end if;
  if p_tipo in ('ajuste_positivo', 'ajuste_negativo') and v_rol <> 'admin' then
    raise exception 'Solo un administrador puede registrar ajustes' using errcode = '42501';
  end if;
  if v_rol not in ('admin', 'operador') then
    raise exception 'Sin permiso para registrar movimientos' using errcode = '42501';
  end if;
  if p_cantidad is null or p_cantidad <= 0 or p_cantidad > 100000 then
    raise exception 'La cantidad debe estar entre 1 y 100000' using errcode = '22023';
  end if;
  if p_tipo <> 'entrada' and char_length(btrim(coalesce(p_motivo, ''))) = 0 then
    raise exception 'Indica el motivo del movimiento' using errcode = '22023';
  end if;
  if p_origen not in ('manual', 'camara') then
    raise exception 'Origen no válido' using errcode = '22023';
  end if;
  if not exists (select 1 from public.almacenes a where a.id = p_almacen_id and a.activo) then
    raise exception 'Almacén inexistente o inactivo' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.variantes v where v.id = p_variante_id) then
    raise exception 'Variante inexistente' using errcode = 'P0002';
  end if;

  return query select * from public._mover_stock(
    p_variante_id, p_almacen_id,
    case when p_tipo in ('entrada', 'devolucion', 'ajuste_positivo') then p_cantidad else -p_cantidad end,
    p_tipo, p_motivo, p_referencia, null, null, p_origen, p_dispositivo, v_uid);
end $$;

-- Mínimo y ubicación de una variante en un almacén (no toca la cantidad)
create function public.configurar_existencia(
  p_variante_id uuid, p_almacen_id uuid, p_stock_minimo integer, p_ubicacion text default ''
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.es_admin() then
    raise exception 'Solo un administrador puede cambiar mínimos y ubicaciones' using errcode = '42501';
  end if;
  if p_stock_minimo is null or p_stock_minimo < 0 then
    raise exception 'El mínimo no puede ser negativo' using errcode = '22023';
  end if;
  insert into public.existencias (variante_id, almacen_id, stock_minimo, ubicacion)
  values (p_variante_id, p_almacen_id, p_stock_minimo, left(coalesce(btrim(p_ubicacion), ''), 60))
  on conflict (variante_id, almacen_id) do update
    set stock_minimo = excluded.stock_minimo, ubicacion = excluded.ubicacion, actualizado_en = now();
end $$;

-- =====================================================================
-- Conteos físicos: registrar → revisar diferencias → aplicar (admin)
-- =====================================================================
create function public.conteo_crear(p_almacen_id uuid, p_notas text default '') returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public.es_operador_o_admin() then
    raise exception 'Sin permiso para registrar conteos' using errcode = '42501';
  end if;
  if not exists (select 1 from public.almacenes a where a.id = p_almacen_id and a.activo) then
    raise exception 'Almacén inexistente o inactivo' using errcode = 'P0002';
  end if;
  insert into public.conteos (almacen_id, notas, creado_por)
  values (p_almacen_id, left(coalesce(p_notas, ''), 500), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create function public.conteo_registrar_linea(p_conteo_id uuid, p_variante_id uuid, p_cantidad integer) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_almacen  uuid;
  v_sistema  integer;
begin
  if not public.es_operador_o_admin() then
    raise exception 'Sin permiso para registrar conteos' using errcode = '42501';
  end if;
  if p_cantidad is null or p_cantidad < 0 or p_cantidad > 1000000 then
    raise exception 'La cantidad contada debe estar entre 0 y 1000000' using errcode = '22023';
  end if;
  select c.almacen_id into v_almacen from public.conteos c where c.id = p_conteo_id and c.estado = 'abierto' for update;
  if v_almacen is null then
    raise exception 'El conteo no existe o ya está cerrado' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.variantes v where v.id = p_variante_id) then
    raise exception 'Variante inexistente' using errcode = 'P0002';
  end if;
  select coalesce((select e.cantidad from public.existencias e where e.variante_id = p_variante_id and e.almacen_id = v_almacen), 0)
    into v_sistema;
  insert into public.conteo_lineas (conteo_id, variante_id, cantidad_contada, cantidad_sistema, contado_por)
  values (p_conteo_id, p_variante_id, p_cantidad, v_sistema, auth.uid())
  on conflict (conteo_id, variante_id) do update
    set cantidad_contada = excluded.cantidad_contada, cantidad_sistema = excluded.cantidad_sistema,
        contado_por = excluded.contado_por, contado_en = now();
  return v_sistema;
end $$;

create function public.conteo_quitar_linea(p_conteo_id uuid, p_variante_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.es_operador_o_admin() then
    raise exception 'Sin permiso para modificar conteos' using errcode = '42501';
  end if;
  if not exists (select 1 from public.conteos c where c.id = p_conteo_id and c.estado = 'abierto') then
    raise exception 'El conteo no existe o ya está cerrado' using errcode = 'P0002';
  end if;
  delete from public.conteo_lineas l where l.conteo_id = p_conteo_id and l.variante_id = p_variante_id;
end $$;

-- Aplica las diferencias de las líneas elegidas (NULL = todas). El ajuste se
-- calcula contra el stock ACTUAL, de modo que la existencia queda igual a lo contado.
create function public.conteo_aplicar(p_conteo_id uuid, p_variantes uuid[] default null)
returns table (variante_id uuid, anterior integer, contada integer, ajuste integer)
language plpgsql security definer set search_path = '' as $$
declare
  v_uid      uuid := auth.uid();
  v_almacen  uuid;
  l          record;
  v_actual   integer;
  v_dif      integer;
begin
  if not public.es_admin() then
    raise exception 'Solo un administrador puede aplicar un conteo' using errcode = '42501';
  end if;
  if p_variantes is not null and cardinality(p_variantes) = 0 then
    raise exception 'Elige al menos un artículo para aplicar' using errcode = '22023';
  end if;
  select c.almacen_id into v_almacen from public.conteos c where c.id = p_conteo_id and c.estado = 'abierto' for update;
  if v_almacen is null then
    raise exception 'El conteo no existe o ya está cerrado' using errcode = 'P0002';
  end if;

  for l in
    select cl.variante_id, cl.cantidad_contada from public.conteo_lineas cl
     where cl.conteo_id = p_conteo_id and (p_variantes is null or cl.variante_id = any (p_variantes))
     order by cl.variante_id
  loop
    insert into public.existencias (variante_id, almacen_id) values (l.variante_id, v_almacen)
    on conflict on constraint existencias_pkey do nothing;
    select e.cantidad into v_actual from public.existencias e
     where e.variante_id = l.variante_id and e.almacen_id = v_almacen for update;
    v_dif := l.cantidad_contada - v_actual;
    if v_dif <> 0 then
      perform public._mover_stock(l.variante_id, v_almacen, v_dif,
        case when v_dif > 0 then 'ajuste_positivo' else 'ajuste_negativo' end::public.tipo_mov_inventario,
        'Conteo físico', null, null, p_conteo_id, 'conteo', null, v_uid);
    end if;
    update public.conteo_lineas cl set aplicada = true
     where cl.conteo_id = p_conteo_id and cl.variante_id = l.variante_id;
    variante_id := l.variante_id; anterior := v_actual; contada := l.cantidad_contada; ajuste := v_dif;
    return next;
  end loop;

  update public.conteos c set estado = 'aplicado', cerrado_por = v_uid, cerrado_en = now() where c.id = p_conteo_id;
end $$;

create function public.conteo_anular(p_conteo_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.conteos c where c.id = p_conteo_id and c.estado = 'abierto'
                 and (public.es_admin() or (public.es_operador_o_admin() and c.creado_por = auth.uid()))) then
    raise exception 'No se puede anular este conteo' using errcode = '42501';
  end if;
  update public.conteos c set estado = 'anulado', cerrado_por = auth.uid(), cerrado_en = now() where c.id = p_conteo_id;
end $$;

-- =====================================================================
-- Tienda: disponibilidad pública (solo tres estados, nunca cantidades)
-- =====================================================================
create function public.tienda_disponibilidad(p_producto_ids uuid[] default null)
returns table (producto_id uuid, variante_id uuid, estado text)
language sql stable security definer set search_path = '' as $$
  with cfg as (
    select coalesce((select c.umbral_agotado from public.config_tienda c), 0) as agotado,
           coalesce((select c.umbral_pocas   from public.config_tienda c), 3) as pocas
  )
  select v.producto_id, v.id,
         case when coalesce(s.total, 0) <= cfg.agotado then 'agotado'
              when s.total <= cfg.pocas then 'pocas'
              else 'disponible' end
  from public.variantes v
  join public.productos p on p.id = v.producto_id and p.publicado and p.estado = 'activo'
  cross join cfg
  left join lateral (
    select sum(e.cantidad) as total
    from public.existencias e
    join public.almacenes a on a.id = e.almacen_id and a.activo and a.vende_en_linea
    where e.variante_id = v.id
  ) s on true
  where v.activo and (p_producto_ids is null or v.producto_id = any (p_producto_ids))
$$;

create function public.config_tienda_guardar(p_umbral_agotado integer, p_umbral_pocas integer) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.es_admin() then
    raise exception 'Solo un administrador puede cambiar la configuración' using errcode = '42501';
  end if;
  if p_umbral_agotado is null or p_umbral_pocas is null or p_umbral_agotado < 0 or p_umbral_pocas <= p_umbral_agotado then
    raise exception '«Pocas unidades» debe ser mayor que «agotado», y ninguno negativo' using errcode = '22023';
  end if;
  insert into public.config_tienda (id, umbral_agotado, umbral_pocas) values (true, p_umbral_agotado, p_umbral_pocas)
  on conflict (id) do update set umbral_agotado = excluded.umbral_agotado, umbral_pocas = excluded.umbral_pocas, actualizado_en = now();
end $$;

-- =====================================================================
-- Pedidos (sin pago en línea)
-- p_lineas: [{"variante_id": "<uuid>", "cantidad": 2}, …]
-- Todo ocurre en una transacción: si un artículo no tiene stock suficiente,
-- no se crea el pedido ni se reserva nada.
-- =====================================================================
create function public.crear_pedido(
  p_lineas     jsonb,
  p_entrega    public.entrega_pedido,
  p_sucursal_id uuid default null,
  p_direccion  text default '',
  p_telefono   text default '',
  p_notas      text default ''
) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_uid      uuid := auth.uid();
  v_pedido   bigint;
  v_total    numeric(12, 2) := 0;
  v_reserva  integer;
  v_precio   numeric(12, 2);
  v_disp     integer;
  v_linea    bigint;
  v_pend     integer;
  v_toma     integer;
  r          record;
  e          record;
begin
  if v_uid is null then
    raise exception 'Inicia sesión para hacer un pedido' using errcode = '42501';
  end if;
  -- Bloquea el registro del cliente: serializa sus pedidos simultáneos para el límite siguiente
  perform 1 from public.clientes c where c.id = v_uid for update;
  if not found then
    raise exception 'Tu cuenta no tiene perfil de cliente' using errcode = '42501';
  end if;
  -- Evita que una sola cuenta acapare el stock con reservas sin pagar
  if (select count(*) from public.pedidos p where p.cliente_id = v_uid and p.estado = 'pendiente') >= 5 then
    raise exception 'Tienes 5 pedidos pendientes. Espera a que se confirmen o cancela alguno.' using errcode = '23514';
  end if;
  if p_lineas is null or jsonb_typeof(p_lineas) <> 'array'
     or jsonb_array_length(p_lineas) not between 1 and 30 then
    raise exception 'El pedido debe tener entre 1 y 30 artículos' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_lineas) x
             where jsonb_typeof(x -> 'variante_id') is distinct from 'string'
                or jsonb_typeof(x -> 'cantidad') is distinct from 'number') then
    raise exception 'Formato de artículos no válido' using errcode = '22023';
  end if;
  if p_entrega is null then
    raise exception 'Elige la forma de entrega' using errcode = '22023';
  end if;
  if p_entrega = 'retiro' and not exists (select 1 from public.sucursales s where s.id = p_sucursal_id and s.activo) then
    raise exception 'Elige una sucursal de retiro válida' using errcode = '22023';
  end if;
  if p_entrega = 'envio' and char_length(btrim(coalesce(p_direccion, ''))) = 0 then
    raise exception 'Indica la dirección de envío' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_telefono, ''))) not between 6 and 30 then
    raise exception 'Indica un teléfono de contacto válido' using errcode = '22023';
  end if;

  insert into public.pedidos (cliente_id, entrega, sucursal_id, direccion, telefono, notas)
  values (v_uid, p_entrega, case when p_entrega = 'retiro' then p_sucursal_id end,
          case when p_entrega = 'envio' then left(btrim(p_direccion), 300) else '' end,
          btrim(p_telefono), left(coalesce(btrim(p_notas), ''), 500))
  returning id into v_pedido;

  v_reserva := coalesce((select c.umbral_agotado from public.config_tienda c), 0);

  -- Orden fijo por variante: evita bloqueos cruzados entre pedidos simultáneos
  for r in
    select l.variante_id, sum(l.cantidad)::integer as cantidad,
           v.id as vid, v.precio as vprecio, p.precio as pprecio, p.nombre,
           concat_ws(' · ', 'Talla ' || t.nombre, c.nombre) as detalle
    from (select (x ->> 'variante_id')::uuid as variante_id, (x ->> 'cantidad')::integer as cantidad
            from jsonb_array_elements(p_lineas) x) l
    left join public.variantes v on v.id = l.variante_id and v.activo
    left join public.productos p on p.id = v.producto_id and p.publicado and p.estado = 'activo'
    left join public.tallas t on t.id = v.talla_id
    left join public.colores c on c.id = v.color_id
    group by l.variante_id, v.id, v.precio, p.precio, p.nombre, t.nombre, c.nombre
    order by l.variante_id
  loop
    if r.vid is null or r.nombre is null then
      raise exception 'Un artículo del carrito ya no está disponible' using errcode = 'P0002';
    end if;
    if r.cantidad < 1 or r.cantidad > 20 then
      raise exception 'La cantidad de cada artículo debe estar entre 1 y 20' using errcode = '22023';
    end if;
    v_precio := coalesce(r.vprecio, r.pprecio);
    if v_precio is null or v_precio <= 0 then
      raise exception '«%» no tiene precio de venta definido', r.nombre using errcode = '22023';
    end if;

    -- Bloquea las existencias vendibles de esta variante y comprueba el total
    select coalesce(sum(q.cantidad), 0) into v_disp from (
      select ex.cantidad from public.existencias ex
      join public.almacenes a on a.id = ex.almacen_id and a.activo and a.vende_en_linea
      where ex.variante_id = r.variante_id
      for update of ex
    ) q;
    if v_disp - v_reserva < r.cantidad then
      raise exception 'No hay existencias suficientes de «%»%', r.nombre,
        case when r.detalle <> '' then ' (' || r.detalle || ')' else '' end using errcode = '23514';
    end if;

    insert into public.pedido_lineas (pedido_id, variante_id, producto_nombre, detalle, cantidad, precio_unitario)
    values (v_pedido, r.variante_id, r.nombre, coalesce(r.detalle, ''), r.cantidad, v_precio)
    returning id into v_linea;

    v_pend := r.cantidad;
    for e in
      select ex.almacen_id, ex.cantidad from public.existencias ex
      join public.almacenes a on a.id = ex.almacen_id and a.activo and a.vende_en_linea
      where ex.variante_id = r.variante_id and ex.cantidad > 0
      order by ex.cantidad desc, ex.almacen_id
    loop
      exit when v_pend = 0;
      v_toma := least(v_pend, e.cantidad);
      perform public._mover_stock(r.variante_id, e.almacen_id, -v_toma, 'pedido',
        'Pedido #' || v_pedido, null, v_pedido, null, 'tienda', null, v_uid);
      insert into public.pedido_asignaciones (pedido_linea_id, almacen_id, cantidad) values (v_linea, e.almacen_id, v_toma);
      v_pend := v_pend - v_toma;
    end loop;
    if v_pend > 0 then
      raise exception 'No hay existencias suficientes de «%»', r.nombre using errcode = '23514';
    end if;

    v_total := v_total + v_precio * r.cantidad;
  end loop;

  update public.pedidos set total = v_total where id = v_pedido;
  insert into public.pedido_historial (pedido_id, estado_anterior, estado_nuevo, usuario_id)
  values (v_pedido, null, 'pendiente', v_uid);
  return v_pedido;
end $$;

-- Devuelve al almacén de origen lo reservado por un pedido (uso interno)
create function public._liberar_pedido(p_pedido_id bigint, p_usuario uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare a record;
begin
  for a in
    select pl.variante_id, pa.almacen_id, pa.cantidad
    from public.pedido_asignaciones pa join public.pedido_lineas pl on pl.id = pa.pedido_linea_id
    where pl.pedido_id = p_pedido_id
    order by pl.variante_id, pa.almacen_id
  loop
    perform public._mover_stock(a.variante_id, a.almacen_id, a.cantidad, 'pedido_cancelado',
      'Pedido #' || p_pedido_id || ' cancelado', null, p_pedido_id, null, 'tienda', null, p_usuario);
  end loop;
end $$;

-- Cambios de estado (solo admin). Transiciones permitidas:
--   pendiente → confirmado | cancelado
--   confirmado → preparando | cancelado
--   preparando → enviado | entregado | cancelado
--   enviado → entregado
create function public.pedido_cambiar_estado(p_pedido_id bigint, p_estado public.estado_pedido, p_nota text default '')
returns void
language plpgsql security definer set search_path = '' as $$
declare v_actual public.estado_pedido;
begin
  if not public.es_admin() then
    raise exception 'Solo un administrador puede gestionar pedidos' using errcode = '42501';
  end if;
  select p.estado into v_actual from public.pedidos p where p.id = p_pedido_id for update;
  if v_actual is null then
    raise exception 'Pedido inexistente' using errcode = 'P0002';
  end if;
  if not ((v_actual = 'pendiente'  and p_estado in ('confirmado', 'cancelado'))
       or (v_actual = 'confirmado' and p_estado in ('preparando', 'cancelado'))
       or (v_actual = 'preparando' and p_estado in ('enviado', 'entregado', 'cancelado'))
       or (v_actual = 'enviado'    and p_estado = 'entregado')) then
    raise exception 'No se puede pasar de «%» a «%»', v_actual, p_estado using errcode = '22023';
  end if;
  if p_estado = 'cancelado' then
    perform public._liberar_pedido(p_pedido_id, auth.uid());
  end if;
  update public.pedidos p set estado = p_estado where p.id = p_pedido_id;
  insert into public.pedido_historial (pedido_id, estado_anterior, estado_nuevo, usuario_id, nota)
  values (p_pedido_id, v_actual, p_estado, auth.uid(), left(coalesce(btrim(p_nota), ''), 300));
end $$;

-- El cliente puede cancelar su propio pedido mientras siga pendiente
create function public.cancelar_mi_pedido(p_pedido_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare v_estado public.estado_pedido;
begin
  select p.estado into v_estado from public.pedidos p
   where p.id = p_pedido_id and p.cliente_id = auth.uid() for update;
  if v_estado is null then
    raise exception 'Pedido inexistente' using errcode = 'P0002';
  end if;
  if v_estado <> 'pendiente' then
    raise exception 'Solo se pueden cancelar pedidos pendientes' using errcode = '22023';
  end if;
  perform public._liberar_pedido(p_pedido_id, auth.uid());
  update public.pedidos p set estado = 'cancelado' where p.id = p_pedido_id;
  insert into public.pedido_historial (pedido_id, estado_anterior, estado_nuevo, usuario_id, nota)
  values (p_pedido_id, 'pendiente', 'cancelado', auth.uid(), 'Cancelado por el cliente');
end $$;

-- =====================================================================
-- Administración de usuarios (sin exponer la clave secreta)
-- =====================================================================
create function public.admin_listar_usuarios()
returns table (id uuid, email text, nombre text, rol public.rol_usuario, activo boolean,
               es_cliente boolean, creado_en timestamptz, ultimo_acceso timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.es_admin() then
    raise exception 'Solo un administrador puede ver los usuarios' using errcode = '42501';
  end if;
  return query
    select u.id, u.email::text, coalesce(nullif(p.nombre, ''), c.nombre, ''), p.rol, coalesce(p.activo, false),
           c.id is not null, u.created_at, u.last_sign_in_at
    from auth.users u
    left join public.perfiles p on p.id = u.id
    left join public.clientes c on c.id = u.id
    order by u.created_at desc;
end $$;

-- Asigna o cambia el rol interno de una cuenta. Reglas:
--  * solo un administrador activo puede hacerlo;
--  * nadie puede cambiar su propio rol ni desactivarse (evita autoasignación y bloqueos);
--  * siempre debe quedar al menos un administrador activo.
create function public.admin_asignar_rol(
  p_usuario_id uuid, p_rol public.rol_usuario, p_activo boolean default true, p_nombre text default null
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  -- Primero se bloquean los administradores activos y DESPUÉS se comprueba el permiso:
  -- dos administradores que se degradan a la vez quedan serializados.
  perform 1 from public.perfiles where rol = 'admin' and activo for update;
  if not public.es_admin() then
    raise exception 'Solo un administrador puede asignar roles' using errcode = '42501';
  end if;
  if p_usuario_id = auth.uid() then
    raise exception 'No puedes cambiar tu propio rol' using errcode = '42501';
  end if;
  if p_rol is null or p_activo is null then
    raise exception 'Rol y estado son obligatorios' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_usuario_id) then
    raise exception 'Cuenta inexistente' using errcode = 'P0002';
  end if;
  -- Evita dar acceso interno a una cuenta registrada con un correo ajeno sin verificar
  if p_activo and not exists (select 1 from auth.users u where u.id = p_usuario_id and u.email_confirmed_at is not null) then
    raise exception 'La cuenta aún no ha confirmado su correo' using errcode = '22023';
  end if;

  insert into public.perfiles (id, nombre, rol, activo)
  values (p_usuario_id, left(coalesce(btrim(p_nombre), ''), 120), p_rol, p_activo)
  on conflict (id) do update
    set rol = excluded.rol, activo = excluded.activo,
        nombre = case when p_nombre is null then public.perfiles.nombre else excluded.nombre end;

  if not exists (select 1 from public.perfiles where rol = 'admin' and activo) then
    raise exception 'Debe quedar al menos un administrador activo' using errcode = '23514';
  end if;
end $$;

-- =====================================================================
-- Vistas públicas de la tienda (solo columnas destinadas a clientes).
-- Se ejecutan con los permisos de su propietario y filtran lo publicado:
-- las tablas base siguen cerradas para anon y para clientes.
-- =====================================================================
create view public.tienda_productos with (security_barrier) as
  select p.id, p.nombre, p.modelo, p.descripcion, p.precio, p.marca_id, p.categoria_id, p.creado_en
  from public.productos p where p.publicado and p.estado = 'activo';

create view public.tienda_variantes with (security_barrier) as
  select v.id, v.producto_id, v.talla_id, v.color_id, coalesce(v.precio, p.precio) as precio
  from public.variantes v join public.productos p on p.id = v.producto_id
  where v.activo and p.publicado and p.estado = 'activo';

create view public.tienda_imagenes with (security_barrier) as
  select i.id, i.producto_id, i.ruta, i.color_id, i.orden, i.alt
  from public.producto_imagenes i join public.productos p on p.id = i.producto_id
  where p.publicado and p.estado = 'activo';

create view public.tienda_marcas     with (security_barrier) as select id, nombre from public.marcas where activo;
create view public.tienda_categorias with (security_barrier) as select id, nombre, padre_id, orden from public.categorias where activo;
create view public.tienda_tallas     with (security_barrier) as select id, nombre, orden from public.tallas where activo;
create view public.tienda_colores    with (security_barrier) as select id, nombre, hex from public.colores where activo;
create view public.tienda_sucursales with (security_barrier) as select id, nombre, direccion, telefono from public.sucursales where activo;

-- Vistas internas (respetan RLS de quien consulta)
create view public.v_existencias with (security_invoker = true) as
  select e.variante_id, e.almacen_id, e.cantidad, e.stock_minimo, e.ubicacion, e.actualizado_en,
         v.producto_id, p.nombre as producto, p.modelo, t.nombre as talla, c.nombre as color, v.sku,
         a.nombre as almacen, a.sucursal_id, (e.stock_minimo > 0 and e.cantidad <= e.stock_minimo) as bajo_minimo
  from public.existencias e
  join public.variantes v on v.id = e.variante_id
  join public.productos p on p.id = v.producto_id
  join public.almacenes a on a.id = e.almacen_id
  left join public.tallas t on t.id = v.talla_id
  left join public.colores c on c.id = v.color_id;

create view public.v_movimientos with (security_invoker = true) as
  select m.id, m.creado_en, m.tipo, m.cantidad, m.saldo, m.motivo, m.referencia, m.pedido_id, m.conteo_id,
         m.origen, m.dispositivo, m.usuario_id, m.variante_id, m.almacen_id,
         p.nombre as producto, t.nombre as talla, c.nombre as color, a.nombre as almacen,
         coalesce(nullif(pf.nombre, ''), 'Cliente') as usuario
  from public.movimientos_inventario m
  join public.variantes v on v.id = m.variante_id
  join public.productos p on p.id = v.producto_id
  join public.almacenes a on a.id = m.almacen_id
  left join public.tallas t on t.id = v.talla_id
  left join public.colores c on c.id = v.color_id
  left join public.perfiles pf on pf.id = m.usuario_id;

-- =====================================================================
-- Permisos de ejecución
-- =====================================================================
revoke execute on function public._mover_stock(uuid, uuid, integer, public.tipo_mov_inventario, text, text, bigint, uuid, public.origen_operacion, text, uuid) from public, anon, authenticated;
revoke execute on function public._liberar_pedido(bigint, uuid) from public, anon, authenticated;

revoke execute on function public.es_admin()                          from public, anon;
revoke execute on function public.es_operador_o_admin()               from public, anon;
revoke execute on function public.registrar_movimiento_inventario(uuid, uuid, public.tipo_mov_inventario, integer, text, text, public.origen_operacion, text) from public, anon;
revoke execute on function public.configurar_existencia(uuid, uuid, integer, text) from public, anon;
revoke execute on function public.conteo_crear(uuid, text)            from public, anon;
revoke execute on function public.conteo_registrar_linea(uuid, uuid, integer) from public, anon;
revoke execute on function public.conteo_quitar_linea(uuid, uuid)     from public, anon;
revoke execute on function public.conteo_aplicar(uuid, uuid[])        from public, anon;
revoke execute on function public.conteo_anular(uuid)                 from public, anon;
revoke execute on function public.config_tienda_guardar(integer, integer) from public, anon;
revoke execute on function public.crear_pedido(jsonb, public.entrega_pedido, uuid, text, text, text) from public, anon;
revoke execute on function public.pedido_cambiar_estado(bigint, public.estado_pedido, text) from public, anon;
revoke execute on function public.cancelar_mi_pedido(bigint)          from public, anon;
revoke execute on function public.admin_listar_usuarios()             from public, anon;
revoke execute on function public.admin_asignar_rol(uuid, public.rol_usuario, boolean, text) from public, anon;

grant execute on function public.es_admin()                          to authenticated;
grant execute on function public.es_operador_o_admin()               to authenticated;
grant execute on function public.registrar_movimiento_inventario(uuid, uuid, public.tipo_mov_inventario, integer, text, text, public.origen_operacion, text) to authenticated;
grant execute on function public.configurar_existencia(uuid, uuid, integer, text) to authenticated;
grant execute on function public.conteo_crear(uuid, text)            to authenticated;
grant execute on function public.conteo_registrar_linea(uuid, uuid, integer) to authenticated;
grant execute on function public.conteo_quitar_linea(uuid, uuid)     to authenticated;
grant execute on function public.conteo_aplicar(uuid, uuid[])        to authenticated;
grant execute on function public.conteo_anular(uuid)                 to authenticated;
grant execute on function public.config_tienda_guardar(integer, integer) to authenticated;
grant execute on function public.crear_pedido(jsonb, public.entrega_pedido, uuid, text, text, text) to authenticated;
grant execute on function public.pedido_cambiar_estado(bigint, public.estado_pedido, text) to authenticated;
grant execute on function public.cancelar_mi_pedido(bigint)          to authenticated;
grant execute on function public.admin_listar_usuarios()             to authenticated;
grant execute on function public.admin_asignar_rol(uuid, public.rol_usuario, boolean, text) to authenticated;

grant execute on function public.tienda_disponibilidad(uuid[]) to anon, authenticated;

-- El stock por producto de 0001 queda congelado: nadie lo modifica desde la app.
revoke execute on function public.registrar_movimiento(uuid, public.tipo_movimiento, integer, public.origen_movimiento, text) from authenticated;

-- =====================================================================
-- Privilegios de tabla + RLS
-- =====================================================================
alter table public.marcas                 enable row level security;
alter table public.categorias             enable row level security;
alter table public.tallas                 enable row level security;
alter table public.colores                enable row level security;
alter table public.sucursales             enable row level security;
alter table public.almacenes              enable row level security;
alter table public.producto_imagenes      enable row level security;
alter table public.variantes              enable row level security;
alter table public.existencias            enable row level security;
alter table public.clientes               enable row level security;
alter table public.pedidos                enable row level security;
alter table public.pedido_lineas          enable row level security;
alter table public.pedido_asignaciones    enable row level security;
alter table public.pedido_historial       enable row level security;
alter table public.conteos                enable row level security;
alter table public.conteo_lineas          enable row level security;
alter table public.movimientos_inventario enable row level security;
alter table public.config_tienda          enable row level security;

-- Anónimos: ninguna tabla. Solo las vistas tienda_* y tienda_disponibilidad().
revoke all on public.marcas, public.categorias, public.tallas, public.colores, public.sucursales,
  public.almacenes, public.producto_imagenes, public.variantes, public.existencias, public.clientes,
  public.pedidos, public.pedido_lineas, public.pedido_asignaciones, public.pedido_historial,
  public.conteos, public.conteo_lineas, public.movimientos_inventario, public.config_tienda,
  public.v_existencias, public.v_movimientos
  from anon;

-- Autenticados: sin escritura directa en stock, movimientos, pedidos, conteos ni configuración
revoke insert, update, delete, truncate, references, trigger on
  public.existencias, public.movimientos_inventario, public.pedidos, public.pedido_lineas,
  public.pedido_asignaciones, public.pedido_historial, public.conteos, public.conteo_lineas,
  public.config_tienda
  from authenticated;
revoke truncate, references, trigger on
  public.marcas, public.categorias, public.tallas, public.colores, public.sucursales,
  public.almacenes, public.producto_imagenes, public.variantes, public.clientes
  from authenticated;
-- Clientes: solo pueden editar nombre y teléfono de su propio registro
revoke insert, update, delete on public.clientes from authenticated;
grant update (nombre, telefono) on public.clientes to authenticated;

-- Vistas: SOLO lectura. Supabase concede por defecto ALL sobre los objetos nuevos y las vistas
-- simples son actualizables; como las tienda_* se ejecutan con permisos del propietario (sin RLS),
-- un UPDATE/INSERT/DELETE a través de ellas llegaría a las tablas base. Se revoca todo y se
-- concede únicamente SELECT.
revoke all on public.tienda_productos, public.tienda_variantes, public.tienda_imagenes, public.tienda_marcas,
  public.tienda_categorias, public.tienda_tallas, public.tienda_colores, public.tienda_sucursales,
  public.v_existencias, public.v_movimientos
  from public, anon, authenticated;
grant select on public.tienda_productos, public.tienda_variantes, public.tienda_imagenes, public.tienda_marcas,
  public.tienda_categorias, public.tienda_tallas, public.tienda_colores, public.tienda_sucursales
  to anon, authenticated;
grant select on public.v_existencias, public.v_movimientos to authenticated;

-- Concesiones explícitas (no depender de los privilegios por defecto del proyecto). RLS decide las filas.
grant select on public.marcas, public.categorias, public.tallas, public.colores, public.sucursales,
  public.almacenes, public.producto_imagenes, public.variantes, public.existencias, public.clientes,
  public.pedidos, public.pedido_lineas, public.pedido_asignaciones, public.pedido_historial,
  public.conteos, public.conteo_lineas, public.movimientos_inventario, public.config_tienda
  to authenticated;
grant insert, update, delete on public.marcas, public.categorias, public.tallas, public.colores,
  public.sucursales, public.almacenes, public.producto_imagenes, public.variantes
  to authenticated;

-- Datos maestros: lectura para personal activo, escritura solo admin
do $$
declare t text;
begin
  foreach t in array array['marcas', 'categorias', 'tallas', 'colores', 'sucursales', 'almacenes', 'producto_imagenes', 'variantes'] loop
    execute format('create policy "%1$s: lectura personal" on public.%1$I for select to authenticated using ((select public.rol_actual()) is not null)', t);
    execute format('create policy "%1$s: alta admin" on public.%1$I for insert to authenticated with check ((select public.es_admin()))', t);
    execute format('create policy "%1$s: edición admin" on public.%1$I for update to authenticated using ((select public.es_admin())) with check ((select public.es_admin()))', t);
    execute format('create policy "%1$s: baja admin" on public.%1$I for delete to authenticated using ((select public.es_admin()))', t);
  end loop;
end $$;

-- Datos internos: lectura para personal activo (lector, operador, admin)
create policy "existencias: lectura personal" on public.existencias
  for select to authenticated using ((select public.rol_actual()) is not null);
create policy "movimientos_inventario: lectura personal" on public.movimientos_inventario
  for select to authenticated using ((select public.rol_actual()) is not null);
create policy "conteos: lectura personal" on public.conteos
  for select to authenticated using ((select public.rol_actual()) is not null);
create policy "conteo_lineas: lectura personal" on public.conteo_lineas
  for select to authenticated using ((select public.rol_actual()) is not null);
create policy "config_tienda: lectura personal" on public.config_tienda
  for select to authenticated using ((select public.rol_actual()) is not null);

-- Clientes y pedidos: cada cliente ve lo suyo; admin y operador ven todos
create policy "clientes: propio" on public.clientes
  for select to authenticated using (id = (select auth.uid()));
create policy "clientes: personal" on public.clientes
  for select to authenticated using ((select public.es_operador_o_admin()));
create policy "clientes: editar propio" on public.clientes
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "pedidos: propios" on public.pedidos
  for select to authenticated using (cliente_id = (select auth.uid()));
create policy "pedidos: personal" on public.pedidos
  for select to authenticated using ((select public.es_operador_o_admin()));

create policy "pedido_lineas: propias" on public.pedido_lineas
  for select to authenticated using (exists (select 1 from public.pedidos p where p.id = pedido_id and p.cliente_id = (select auth.uid())));
create policy "pedido_lineas: personal" on public.pedido_lineas
  for select to authenticated using ((select public.es_operador_o_admin()));

create policy "pedido_historial: propio" on public.pedido_historial
  for select to authenticated using (exists (select 1 from public.pedidos p where p.id = pedido_id and p.cliente_id = (select auth.uid())));
create policy "pedido_historial: personal" on public.pedido_historial
  for select to authenticated using ((select public.es_operador_o_admin()));

create policy "pedido_asignaciones: personal" on public.pedido_asignaciones
  for select to authenticated using ((select public.es_operador_o_admin()));

-- =====================================================================
-- Storage: bucket público de imágenes de productos (escritura solo admin)
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('productos', 'productos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "productos: subir imágenes admin" on storage.objects
  for insert to authenticated with check (bucket_id = 'productos' and (select public.es_admin()));
create policy "productos: editar imágenes admin" on storage.objects
  for update to authenticated using (bucket_id = 'productos' and (select public.es_admin()))
  with check (bucket_id = 'productos' and (select public.es_admin()));
create policy "productos: borrar imágenes admin" on storage.objects
  for delete to authenticated using (bucket_id = 'productos' and (select public.es_admin()));

-- =====================================================================
-- Realtime (respeta RLS): cambios de stock, movimientos y pedidos
-- =====================================================================
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.existencias, public.movimientos_inventario, public.pedidos;
  end if;
end $$;
