-- =====================================================================
-- 0005 — Analítica de comportamiento de la tienda (sesiones, grabaciones,
-- mapas de calor, eventos, embudos). Sin IA.
--
-- SOLO ESTRUCTURA.
--  * El navegador escribe únicamente con analitica_registrar, y solo si el
--    visitante aceptó la analítica en la tienda. Los campos de formulario
--    se enmascaran en el navegador: nunca llegan contraseñas ni teléfonos.
--  * Solo el administrador lee los datos y define eventos, embudos,
--    segmentos y notas.
--  * Límites defensivos por llamada, por sesión y globales (la función es
--    pública: la usa la tienda sin sesión).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Configuración (una sola fila; la tienda la lee para saber si medir)
-- ---------------------------------------------------------------------
create table public.analitica_config (
  id              boolean primary key default true check (id),
  activa          boolean not null default true,
  grabar          boolean not null default true,
  retencion_dias  integer not null default 90 check (retencion_dias between 7 and 730),
  actualizado_en  timestamptz not null default now()
);
comment on table public.analitica_config is 'Sin fila: analítica activa, con grabación y 90 días de retención.';

-- ---------------------------------------------------------------------
-- Sesiones: una visita (se corta tras 30 min sin actividad, en el navegador)
-- ---------------------------------------------------------------------
create table public.analitica_sesiones (
  id               uuid primary key,
  visitante_id     uuid not null,
  usuario_id       uuid references auth.users (id) on delete set null,
  inicio           timestamptz not null default now(),
  ultimo           timestamptz not null default now(),
  dispositivo      text not null check (dispositivo in ('escritorio', 'tablet', 'movil')),
  navegador        text check (char_length(navegador) <= 40),
  sistema          text check (char_length(sistema) <= 40),
  pantalla         text check (char_length(pantalla) <= 20),
  idioma           text check (char_length(idioma) <= 20),
  zona_horaria     text check (char_length(zona_horaria) <= 60),
  referente        text check (char_length(referente) <= 200),
  utm_fuente       text check (char_length(utm_fuente) <= 100),
  utm_medio        text check (char_length(utm_medio) <= 100),
  utm_campana      text check (char_length(utm_campana) <= 100),
  pagina_entrada   text check (char_length(pagina_entrada) <= 200),
  pagina_salida    text check (char_length(pagina_salida) <= 200),
  paginas          integer not null default 0,
  eventos          integer not null default 0,
  clics            integer not null default 0,
  clics_furia      integer not null default 0,
  errores          integer not null default 0,
  convertida       boolean not null default false,
  grabacion_partes integer not null default 0,
  grabacion_bytes  integer not null default 0
);
create index analitica_sesiones_inicio_idx    on public.analitica_sesiones (inicio desc);
create index analitica_sesiones_visitante_idx on public.analitica_sesiones (visitante_id, inicio);
create index analitica_sesiones_usuario_idx   on public.analitica_sesiones (usuario_id) where usuario_id is not null;

-- ---------------------------------------------------------------------
-- Eventos: páginas, clics, clics de furia, desplazamiento, movimiento del
-- ratón (muestreado), errores de JavaScript y eventos de la tienda.
--  x: fracción del ancho del documento (0–1) · y: píxeles desde arriba
--  ancho: ancho de la ventana · alto: alto del documento
-- ---------------------------------------------------------------------
create table public.analitica_eventos (
  id        bigint generated always as identity primary key,
  sesion_id uuid not null references public.analitica_sesiones (id) on delete cascade,
  creado_en timestamptz not null,
  tipo      text not null check (tipo in ('pagina', 'clic', 'furia', 'scroll', 'movimiento', 'error', 'personalizado')),
  ruta      text not null check (char_length(ruta) <= 200),
  url       text check (char_length(url) <= 300),
  nombre    text check (char_length(nombre) <= 60),
  selector  text check (char_length(selector) <= 300),
  texto     text check (char_length(texto) <= 120),
  x         real check (x between 0 and 1),
  y         real check (y >= 0),
  ancho     integer check (ancho between 0 and 10000),
  alto      integer check (alto between 0 and 100000),
  datos     jsonb
);
create index analitica_eventos_fecha_idx  on public.analitica_eventos (creado_en);
create index analitica_eventos_sesion_idx on public.analitica_eventos (sesion_id, creado_en);
create index analitica_eventos_tipo_idx   on public.analitica_eventos (tipo, ruta, creado_en);

-- Grabación de la sesión (eventos de rrweb por partes, con los campos enmascarados)
create table public.analitica_grabaciones (
  sesion_id uuid not null references public.analitica_sesiones (id) on delete cascade,
  parte     integer not null check (parte between 0 and 999),
  creado_en timestamptz not null default now(),
  eventos   jsonb not null check (jsonb_typeof(eventos) = 'array'),
  primary key (sesion_id, parte)
);

-- ---------------------------------------------------------------------
-- Definiciones del administrador
-- ---------------------------------------------------------------------
create table public.analitica_definiciones (
  id           uuid primary key default gen_random_uuid(),
  nombre       text not null unique check (char_length(btrim(nombre)) between 1 and 80),
  tipo         text not null check (tipo in ('url', 'clic_texto', 'clic_selector')),
  valor        text not null check (char_length(btrim(valor)) between 1 and 300),
  coincidencia text not null default 'contiene' check (coincidencia in ('exacta', 'contiene', 'comodin')),
  creado_por   uuid default auth.uid() references auth.users (id) on delete set null,
  creado_en    timestamptz not null default now()
);
comment on table public.analitica_definiciones is 'Eventos definidos sobre los datos ya capturados (se aplican también al historial).';

create table public.analitica_embudos (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null check (char_length(btrim(nombre)) between 1 and 80),
  pasos      jsonb not null check (jsonb_typeof(pasos) = 'array' and jsonb_array_length(pasos) between 2 and 10),
  creado_por uuid default auth.uid() references auth.users (id) on delete set null,
  creado_en  timestamptz not null default now()
);

create table public.analitica_segmentos (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null check (char_length(btrim(nombre)) between 1 and 80),
  filtro     jsonb not null check (jsonb_typeof(filtro) = 'object'),
  creado_por uuid default auth.uid() references auth.users (id) on delete set null,
  creado_en  timestamptz not null default now()
);

create table public.analitica_notas (
  id        uuid primary key default gen_random_uuid(),
  sesion_id uuid not null references public.analitica_sesiones (id) on delete cascade,
  texto     text not null check (char_length(btrim(texto)) between 1 and 1000),
  autor     uuid default auth.uid() references auth.users (id) on delete set null,
  creado_en timestamptz not null default now()
);
create index analitica_notas_sesion_idx on public.analitica_notas (sesion_id);

-- ---------------------------------------------------------------------
-- Permisos: lectura solo admin; escritura de definiciones solo admin;
-- sesiones, eventos y grabaciones solo con analitica_registrar.
-- ---------------------------------------------------------------------
alter table public.analitica_config       enable row level security;
alter table public.analitica_sesiones     enable row level security;
alter table public.analitica_eventos      enable row level security;
alter table public.analitica_grabaciones  enable row level security;
alter table public.analitica_definiciones enable row level security;
alter table public.analitica_embudos      enable row level security;
alter table public.analitica_segmentos    enable row level security;
alter table public.analitica_notas        enable row level security;

revoke all on public.analitica_config, public.analitica_sesiones, public.analitica_eventos, public.analitica_grabaciones,
  public.analitica_definiciones, public.analitica_embudos, public.analitica_segmentos, public.analitica_notas from anon, authenticated;
grant select on public.analitica_config to anon, authenticated;
grant select on public.analitica_sesiones, public.analitica_eventos, public.analitica_grabaciones to authenticated;
grant select, insert, update, delete on public.analitica_definiciones, public.analitica_embudos, public.analitica_segmentos to authenticated;
grant select, insert, delete on public.analitica_notas to authenticated;

create policy "analitica_config: lectura pública" on public.analitica_config for select to anon, authenticated using (true);
create policy "analitica_sesiones: admin"    on public.analitica_sesiones    for select to authenticated using ((select public.es_admin()));
create policy "analitica_eventos: admin"     on public.analitica_eventos     for select to authenticated using ((select public.es_admin()));
create policy "analitica_grabaciones: admin" on public.analitica_grabaciones for select to authenticated using ((select public.es_admin()));
create policy "analitica_definiciones: admin" on public.analitica_definiciones for all to authenticated
  using ((select public.es_admin())) with check ((select public.es_admin()));
create policy "analitica_embudos: admin" on public.analitica_embudos for all to authenticated
  using ((select public.es_admin())) with check ((select public.es_admin()));
create policy "analitica_segmentos: admin" on public.analitica_segmentos for all to authenticated
  using ((select public.es_admin())) with check ((select public.es_admin()));
create policy "analitica_notas: admin lee y borra" on public.analitica_notas for select to authenticated using ((select public.es_admin()));
create policy "analitica_notas: admin escribe" on public.analitica_notas for insert to authenticated
  with check ((select public.es_admin()) and autor = (select auth.uid()));
create policy "analitica_notas: admin borra" on public.analitica_notas for delete to authenticated using ((select public.es_admin()));

-- ---------------------------------------------------------------------
-- Registro desde la tienda. p_sesion: { id, visitante, dispositivo, … }
-- p_eventos: [{ t, tipo, ruta, url, nombre, selector, texto, x, y, ancho, alto, datos }]
-- p_parte / p_grabacion: una parte de la grabación (opcional)
-- ---------------------------------------------------------------------
create function public.analitica_registrar(p_sesion jsonb, p_eventos jsonb default '[]'::jsonb,
  p_parte integer default null, p_grabacion jsonb default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_id   uuid;
  v_vis  uuid;
  v_ses  public.analitica_sesiones;
  v_cfg  public.analitica_config;
  v_n    integer := coalesce(jsonb_array_length(case when jsonb_typeof(p_eventos) = 'array' then p_eventos end), 0);
  v_tam  integer := coalesce(pg_column_size(p_grabacion), 0);
  t      text := '';
begin
  select * into v_cfg from public.analitica_config;
  if found and not v_cfg.activa then return; end if;   -- analítica apagada: se ignora sin error
  begin
    v_id  := (p_sesion ->> 'id')::uuid;
    v_vis := (p_sesion ->> 'visitante')::uuid;
  exception when others then
    raise exception 'Sesión no válida' using errcode = '22023';
  end;
  if v_id is null or v_vis is null then raise exception 'Sesión no válida' using errcode = '22023'; end if;
  if v_n > 100 then raise exception 'Demasiados eventos en una llamada' using errcode = '54000'; end if;
  if v_tam > 512000 then raise exception 'Parte de grabación demasiado grande' using errcode = '54000'; end if;

  select * into v_ses from public.analitica_sesiones s where s.id = v_id for update;
  if not found then
    -- Límite global: protege la base si alguien crea sesiones en masa
    if (select count(*) from public.analitica_sesiones s where s.inicio > now() - interval '1 minute') >= 300 then
      raise exception 'Demasiadas sesiones nuevas' using errcode = '54000';
    end if;
    insert into public.analitica_sesiones (id, visitante_id, usuario_id, dispositivo, navegador, sistema, pantalla, idioma, zona_horaria,
      referente, utm_fuente, utm_medio, utm_campana)
    values (v_id, v_vis, auth.uid(),
      case when p_sesion ->> 'dispositivo' in ('escritorio', 'tablet', 'movil') then p_sesion ->> 'dispositivo' else 'escritorio' end,
      left(p_sesion ->> 'navegador', 40), left(p_sesion ->> 'sistema', 40), left(p_sesion ->> 'pantalla', 20),
      left(p_sesion ->> 'idioma', 20), left(p_sesion ->> 'zona', 60), nullif(left(p_sesion ->> 'referente', 200), ''),
      nullif(left(p_sesion ->> 'utm_fuente', 100), ''), nullif(left(p_sesion ->> 'utm_medio', 100), ''), nullif(left(p_sesion ->> 'utm_campana', 100), ''))
    returning * into v_ses;
  elsif v_ses.visitante_id <> v_vis then
    raise exception 'Sesión no válida' using errcode = '22023';
  elsif v_ses.inicio < now() - interval '12 hours' then
    raise exception 'Sesión caducada' using errcode = '22023';
  end if;
  if v_ses.eventos + v_n > 5000 then raise exception 'La sesión superó el máximo de eventos' using errcode = '54000'; end if;

  if v_n > 0 then
    with e as (
      select least(greatest(coalesce(x.t, now()), now() - interval '1 day'), now()) as t, x.tipo, left(coalesce(x.ruta, '#/'), 200) as ruta,
             left(x.url, 300) as url, left(x.nombre, 60) as nombre, left(x.selector, 300) as selector, left(x.texto, 120) as texto,
             case when x.x between 0 and 1 then x.x end as x, case when x.y >= 0 then least(x.y, 100000) end as y,
             case when x.ancho between 0 and 10000 then x.ancho end as ancho, case when x.alto between 0 and 100000 then x.alto end as alto,
             case when pg_column_size(x.datos) <= 4000 then x.datos end as datos
        from jsonb_to_recordset(p_eventos) as x(t timestamptz, tipo text, ruta text, url text, nombre text, selector text, texto text,
             x real, y real, ancho integer, alto integer, datos jsonb)
       where x.tipo in ('pagina', 'clic', 'furia', 'scroll', 'movimiento', 'error', 'personalizado')
    ), ins as (
      insert into public.analitica_eventos (sesion_id, creado_en, tipo, ruta, url, nombre, selector, texto, x, y, ancho, alto, datos)
      select v_id, e.t, e.tipo, e.ruta, e.url, e.nombre, e.selector, e.texto, e.x, e.y, e.ancho, e.alto, e.datos from e
      returning creado_en, tipo, ruta, nombre
    )
    update public.analitica_sesiones s set
      eventos        = s.eventos + (select count(*) from ins),
      paginas        = s.paginas + (select count(*) from ins where ins.tipo = 'pagina'),
      clics          = s.clics + (select count(*) from ins where ins.tipo = 'clic'),
      clics_furia    = s.clics_furia + (select count(*) from ins where ins.tipo = 'furia'),
      errores        = s.errores + (select count(*) from ins where ins.tipo = 'error'),
      convertida     = s.convertida or exists (select 1 from ins where ins.tipo = 'personalizado' and ins.nombre = 'pedido_realizado'),
      inicio         = least(s.inicio, coalesce((select min(ins.creado_en) from ins), s.inicio)),   -- el primer evento puede ser anterior al primer envío
      ultimo         = greatest(s.ultimo, coalesce((select max(ins.creado_en) from ins), s.ultimo)),
      pagina_entrada = coalesce(s.pagina_entrada, (select ins.ruta from ins where ins.tipo = 'pagina' order by ins.creado_en limit 1)),
      pagina_salida  = coalesce((select ins.ruta from ins where ins.tipo = 'pagina' order by ins.creado_en desc limit 1), s.pagina_salida),
      usuario_id     = coalesce(s.usuario_id, auth.uid())
    where s.id = v_id;
  elsif v_ses.usuario_id is null and auth.uid() is not null then
    update public.analitica_sesiones s set usuario_id = auth.uid() where s.id = v_id;
  end if;

  if p_grabacion is not null and p_parte is not null and coalesce(v_cfg.grabar, true) then
    if jsonb_typeof(p_grabacion) <> 'array' then raise exception 'Grabación no válida' using errcode = '22023'; end if;
    if v_ses.grabacion_partes >= 1000 or v_ses.grabacion_bytes + v_tam > 30000000 then return; end if;   -- la sesión sigue midiéndose, sin grabar más
    insert into public.analitica_grabaciones (sesion_id, parte, eventos) values (v_id, p_parte, p_grabacion)
    on conflict (sesion_id, parte) do nothing;
    if found then
      update public.analitica_sesiones s set grabacion_partes = s.grabacion_partes + 1, grabacion_bytes = s.grabacion_bytes + v_tam,
        ultimo = greatest(s.ultimo, now()) where s.id = v_id;
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Administración
-- ---------------------------------------------------------------------
create function public.analitica_config_guardar(p_activa boolean, p_grabar boolean, p_retencion_dias integer) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.es_admin() then raise exception 'Solo un administrador puede cambiar la analítica' using errcode = '42501'; end if;
  insert into public.analitica_config (id, activa, grabar, retencion_dias) values (true, p_activa, p_grabar, p_retencion_dias)
  on conflict (id) do update set activa = excluded.activa, grabar = excluded.grabar, retencion_dias = excluded.retencion_dias, actualizado_en = now();
end $$;

/** Borra las sesiones (con sus eventos, grabaciones y notas) más antiguas que la retención. Devuelve cuántas borró. */
create function public.analitica_purgar() returns integer
language plpgsql security definer set search_path = '' as $$
declare v_dias integer; v_n integer;
begin
  if not public.es_admin() then raise exception 'Solo un administrador puede borrar datos de analítica' using errcode = '42501'; end if;
  v_dias := coalesce((select c.retencion_dias from public.analitica_config c), 90);
  delete from public.analitica_sesiones s where s.inicio < now() - make_interval(days => v_dias);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke execute on function public.analitica_registrar(jsonb, jsonb, integer, jsonb) from public;
revoke execute on function public.analitica_config_guardar(boolean, boolean, integer) from public, anon;
revoke execute on function public.analitica_purgar() from public, anon;
grant execute on function public.analitica_registrar(jsonb, jsonb, integer, jsonb) to anon, authenticated;
grant execute on function public.analitica_config_guardar(boolean, boolean, integer) to authenticated;
grant execute on function public.analitica_purgar() to authenticated;
