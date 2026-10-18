-- =====================================================================
-- Inventario inteligente — esquema inicial
-- Solo estructura: tipos, tablas, restricciones, funciones y RLS.
-- NO inserta productos, usuarios, existencias ni movimientos.
--
-- Ejecutar una vez en Supabase → SQL Editor (o `supabase db push`).
-- Ver docs/SEGURIDAD.md para la matriz de permisos.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------
create type public.rol_usuario       as enum ('admin', 'operador', 'lector');
create type public.estado_producto   as enum ('activo', 'inactivo');
create type public.tipo_movimiento   as enum ('entrada', 'salida');
create type public.origen_movimiento as enum ('manual', 'camara');

-- ---------------------------------------------------------------------
-- Perfiles: datos y permisos de cada cuenta de Supabase Auth
-- ---------------------------------------------------------------------
create table public.perfiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  nombre     text not null default '' check (char_length(nombre) <= 120),
  rol        public.rol_usuario not null default 'lector',
  activo     boolean not null default true,
  creado_en  timestamptz not null default now()
);
comment on table public.perfiles is 'Un perfil por cuenta de Auth. Rol por defecto: lector. Para quitar acceso, poner activo = false (no borrar: los movimientos lo referencian).';

-- ---------------------------------------------------------------------
-- Productos
-- ---------------------------------------------------------------------
create table public.productos (
  id                     uuid primary key default gen_random_uuid(),
  nombre                 text not null check (char_length(btrim(nombre)) between 1 and 200),
  etiqueta_clasificador  text unique check (etiqueta_clasificador is null or char_length(etiqueta_clasificador) between 1 and 200),
  precio                 numeric(12, 2) not null default 0 check (precio >= 0),
  stock_minimo           integer not null default 0 check (stock_minimo >= 0),
  estado                 public.estado_producto not null default 'activo',
  creado_en              timestamptz not null default now(),
  actualizado_en         timestamptz not null default now()
);
create unique index productos_nombre_unico on public.productos (lower(btrim(nombre)));
comment on column public.productos.etiqueta_clasificador is 'Etiqueta exacta del modelo de Teachable Machine (metadata.json). Única; NULL si el producto no se reconoce por cámara.';

-- ---------------------------------------------------------------------
-- Inventario: ÚNICA fuente de la cantidad disponible (una fila por producto)
-- ---------------------------------------------------------------------
create table public.inventario (
  producto_id     uuid primary key references public.productos (id) on delete cascade,
  cantidad        integer not null default 0 check (cantidad >= 0),
  actualizado_en  timestamptz not null default now()
);
comment on table public.inventario is 'Existencias actuales. Solo la modifica public.registrar_movimiento(). La fila se crea en 0 al crear el producto.';

-- ---------------------------------------------------------------------
-- Movimientos: historial inmutable de entradas y salidas
-- ---------------------------------------------------------------------
create table public.movimientos (
  id           bigint generated always as identity primary key,
  producto_id  uuid not null references public.productos (id) on delete restrict,
  tipo         public.tipo_movimiento not null,
  cantidad     integer not null check (cantidad > 0),
  origen       public.origen_movimiento not null default 'manual',
  usuario_id   uuid not null references public.perfiles (id) on delete restrict,
  dispositivo  text check (dispositivo is null or char_length(dispositivo) <= 100),
  creado_en    timestamptz not null default now()
);
create index movimientos_fecha_idx          on public.movimientos (creado_en desc);
create index movimientos_producto_fecha_idx on public.movimientos (producto_id, creado_en desc);
create index movimientos_usuario_idx        on public.movimientos (usuario_id);
comment on table public.movimientos is 'Libro de movimientos. Un producto con movimientos no se puede borrar (on delete restrict): se desactiva.';

-- =====================================================================
-- Funciones y disparadores
-- =====================================================================

-- Fecha de actualización de productos
create function public.tg_actualizado_en() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.actualizado_en := now();
  return new;
end $$;

create trigger productos_actualizado_en
  before update on public.productos
  for each row execute function public.tg_actualizado_en();

-- Cada producto nuevo nace con su fila de inventario en 0
create function public.tg_crear_inventario() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.inventario (producto_id) values (new.id);
  return new;
end $$;

create trigger productos_crear_inventario
  after insert on public.productos
  for each row execute function public.tg_crear_inventario();

-- Los movimientos no se editan ni se borran (para corregir, se registra otro movimiento)
create function public.tg_movimientos_inmutables() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Los movimientos no se pueden modificar ni eliminar' using errcode = '42501';
end $$;

create trigger movimientos_inmutables
  before update or delete on public.movimientos
  for each row execute function public.tg_movimientos_inmutables();

-- Cada cuenta nueva de Auth recibe un perfil con rol «lector»
create function public.tg_crear_perfil() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.perfiles (id, nombre)
  values (new.id, left(coalesce(new.raw_user_meta_data ->> 'nombre', split_part(new.email, '@', 1), ''), 120));
  return new;
end $$;

create trigger auth_crear_perfil
  after insert on auth.users
  for each row execute function public.tg_crear_perfil();

-- Rol del usuario actual (NULL si no hay sesión o el perfil está inactivo).
-- security definer: evita recursión de RLS al consultarlo desde las políticas.
create function public.rol_actual() returns public.rol_usuario
language sql stable security definer set search_path = '' as $$
  select p.rol from public.perfiles p where p.id = auth.uid() and p.activo
$$;

-- ---------------------------------------------------------------------
-- Entrada / salida ATÓMICA
--  * Requiere sesión y rol admin u operador con perfil activo.
--  * El UPDATE bloquea la fila del producto: dos dispositivos simultáneos
--    se serializan y la condición de stock se vuelve a evaluar.
--  * Nunca deja stock negativo (y la tabla además tiene CHECK >= 0).
--  * Registra el movimiento en la misma transacción.
-- ---------------------------------------------------------------------
create function public.registrar_movimiento(
  p_producto_id  uuid,
  p_tipo         public.tipo_movimiento,
  p_cantidad     integer,
  p_origen       public.origen_movimiento default 'manual',
  p_dispositivo  text default null
) returns table (movimiento_id bigint, cantidad_actual integer)
language plpgsql security definer set search_path = '' as $$
declare
  v_uid       uuid := auth.uid();
  v_rol       public.rol_usuario;
  v_cantidad  integer;
  v_mov       bigint;
begin
  if v_uid is null then
    raise exception 'Se requiere iniciar sesión' using errcode = '42501';
  end if;

  select p.rol into v_rol from public.perfiles p where p.id = v_uid and p.activo;
  if v_rol is null or v_rol not in ('admin', 'operador') then
    raise exception 'Sin permiso para registrar movimientos' using errcode = '42501';
  end if;

  if p_tipo is null or p_cantidad is null or p_cantidad <= 0 then
    raise exception 'Tipo y cantidad (mayor que cero) son obligatorios' using errcode = '22023';
  end if;

  if not exists (select 1 from public.productos pr where pr.id = p_producto_id and pr.estado = 'activo') then
    raise exception 'Producto inexistente o inactivo' using errcode = 'P0002';
  end if;

  update public.inventario i
     set cantidad = i.cantidad + case when p_tipo = 'entrada' then p_cantidad else -p_cantidad end,
         actualizado_en = now()
   where i.producto_id = p_producto_id
     and (p_tipo = 'entrada' or i.cantidad >= p_cantidad)
  returning i.cantidad into v_cantidad;

  if not found then
    raise exception 'Stock insuficiente' using errcode = '23514';
  end if;

  insert into public.movimientos (producto_id, tipo, cantidad, origen, usuario_id, dispositivo)
  values (p_producto_id, p_tipo, p_cantidad, coalesce(p_origen, 'manual'), v_uid, left(nullif(btrim(p_dispositivo), ''), 100))
  returning id into v_mov;

  return query select v_mov, v_cantidad;
end $$;

-- Permisos de ejecución: nada para anónimos
revoke execute on function public.tg_actualizado_en()          from public, anon, authenticated;
revoke execute on function public.tg_crear_inventario()        from public, anon, authenticated;
revoke execute on function public.tg_movimientos_inmutables()  from public, anon, authenticated;
revoke execute on function public.tg_crear_perfil()            from public, anon, authenticated;
revoke execute on function public.rol_actual()                 from public, anon;
revoke execute on function public.registrar_movimiento(uuid, public.tipo_movimiento, integer, public.origen_movimiento, text) from public, anon;
grant  execute on function public.rol_actual()                 to authenticated;
grant  execute on function public.registrar_movimiento(uuid, public.tipo_movimiento, integer, public.origen_movimiento, text) to authenticated;

-- =====================================================================
-- Privilegios de tabla + Row Level Security
-- =====================================================================
alter table public.perfiles    enable row level security;
alter table public.productos   enable row level security;
alter table public.inventario  enable row level security;
alter table public.movimientos enable row level security;

-- Anónimos: sin acceso a ninguna tabla
revoke all on public.perfiles, public.productos, public.inventario, public.movimientos from anon;

-- Autenticados: sin escritura directa en perfiles, inventario ni movimientos
-- (inventario/movimientos solo cambian vía registrar_movimiento).
revoke insert, update, delete, truncate, references, trigger
  on public.perfiles, public.inventario, public.movimientos from authenticated;
revoke truncate, references, trigger on public.productos from authenticated;
-- Concesiones explícitas (no depender de los privilegios por defecto del proyecto). RLS decide las filas.
grant select on public.perfiles, public.productos, public.inventario, public.movimientos to authenticated;
grant insert, update, delete on public.productos to authenticated;

-- Lectura: cualquier usuario con perfil activo
create policy "perfiles: lectura para usuarios activos" on public.perfiles
  for select to authenticated using ((select public.rol_actual()) is not null);

create policy "productos: lectura para usuarios activos" on public.productos
  for select to authenticated using ((select public.rol_actual()) is not null);

create policy "inventario: lectura para usuarios activos" on public.inventario
  for select to authenticated using ((select public.rol_actual()) is not null);

create policy "movimientos: lectura para usuarios activos" on public.movimientos
  for select to authenticated using ((select public.rol_actual()) is not null);

-- Catálogo: solo administradores crean, editan o eliminan productos
create policy "productos: alta solo admin" on public.productos
  for insert to authenticated with check ((select public.rol_actual()) = 'admin');

create policy "productos: edición solo admin" on public.productos
  for update to authenticated
  using ((select public.rol_actual()) = 'admin')
  with check ((select public.rol_actual()) = 'admin');

create policy "productos: baja solo admin" on public.productos
  for delete to authenticated using ((select public.rol_actual()) = 'admin');

-- Realtime: NO habilitado todavía. Cuando se implemente, añadir las tablas a
-- la publicación (ver README → «Sincronización en tiempo real»).
