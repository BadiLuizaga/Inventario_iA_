-- =====================================================================
-- 0004 — Registro de escaneos de la cámara (métricas de la IA)
--
-- SOLO ESTRUCTURA. Cada fila es una propuesta de la cámara y lo que hizo
-- la persona con ella: confirmarla, corregirla o descartarla.
--  * No guarda imágenes ni datos del dispositivo: solo la clase, la
--    confianza, el producto y quién/cuándo.
--  * Escanear NUNCA modifica el inventario: esta tabla no toca existencias.
--  * Se escribe solo con escaneo_registrar / escaneo_resolver.
--  * Lectura: el admin ve todo; el resto del personal, solo lo suyo.
-- =====================================================================

create type public.resultado_escaneo as enum ('pendiente', 'confirmado', 'corregido', 'descartado');

create table public.escaneos_ia (
  id                     uuid primary key default gen_random_uuid(),
  usuario_id             uuid not null references auth.users (id) on delete restrict,
  almacen_id             uuid references public.almacenes (id) on delete set null,
  modelo                 text not null check (char_length(btrim(modelo)) between 1 and 200),
  clase_predicha         text not null check (char_length(btrim(clase_predicha)) between 1 and 200),
  confianza              numeric(4, 3) not null check (confianza between 0 and 1),
  clase_alternativa      text check (clase_alternativa is null or char_length(clase_alternativa) between 1 and 200),
  confianza_alternativa  numeric(4, 3) check (confianza_alternativa is null or confianza_alternativa between 0 and 1),
  dudoso                 boolean not null default false,
  motivo_duda            text check (motivo_duda is null or char_length(motivo_duda) <= 200),
  producto_predicho_id   uuid constraint escaneos_ia_producto_predicho_fkey references public.productos (id) on delete set null,
  resultado              public.resultado_escaneo not null default 'pendiente',
  producto_confirmado_id uuid constraint escaneos_ia_producto_confirmado_fkey references public.productos (id) on delete set null,
  creado_en              timestamptz not null default now(),
  resuelto_en            timestamptz
);
create index escaneos_ia_fecha_idx   on public.escaneos_ia (creado_en desc);
create index escaneos_ia_usuario_idx on public.escaneos_ia (usuario_id, creado_en desc);
comment on table public.escaneos_ia is 'Propuestas de la cámara y su resultado (confirmado / corregido / descartado). Sin imágenes. No afecta al inventario.';
comment on column public.escaneos_ia.dudoso is 'La app pidió confirmación explícita (confianza baja, poco margen, lectura inestable o clase débil).';

alter table public.escaneos_ia enable row level security;
revoke all on public.escaneos_ia from anon;
revoke insert, update, delete, truncate, references, trigger on public.escaneos_ia from authenticated;
grant select on public.escaneos_ia to authenticated;

create policy "escaneos_ia: admin ve todo, personal lo suyo" on public.escaneos_ia
  for select to authenticated
  using ((select public.es_admin()) or (usuario_id = (select auth.uid()) and (select public.rol_actual()) is not null));

-- ---------------------------------------------------------------------
-- Registrar una propuesta de la cámara (resultado «pendiente»).
-- Cualquier miembro del personal activo, también el de solo consulta.
-- ---------------------------------------------------------------------
create function public.escaneo_registrar(
  p_modelo text, p_clase text, p_confianza numeric,
  p_clase_alternativa text default null, p_confianza_alternativa numeric default null,
  p_dudoso boolean default false, p_motivo_duda text default null, p_almacen_id uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if public.rol_actual() is null then
    raise exception 'Sin permiso para registrar escaneos' using errcode = '42501';
  end if;
  -- Límite defensivo: una persona no escanea más de 120 veces por minuto
  if (select count(*) from public.escaneos_ia e where e.usuario_id = auth.uid() and e.creado_en > now() - interval '1 minute') >= 120 then
    raise exception 'Demasiados escaneos seguidos' using errcode = '54000';
  end if;
  insert into public.escaneos_ia (usuario_id, almacen_id, modelo, clase_predicha, confianza, clase_alternativa, confianza_alternativa,
    dudoso, motivo_duda, producto_predicho_id)
  values (auth.uid(),
    (select a.id from public.almacenes a where a.id = p_almacen_id),
    left(btrim(p_modelo), 200), left(btrim(p_clase), 200), round(p_confianza, 3),
    nullif(left(btrim(coalesce(p_clase_alternativa, '')), 200), ''), round(p_confianza_alternativa, 3),
    coalesce(p_dudoso, false), nullif(left(coalesce(p_motivo_duda, ''), 200), ''),
    (select p.id from public.productos p where p.etiqueta_clasificador = btrim(p_clase)))
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- Resolver una propuesta propia que siga pendiente.
--  * confirmado: el producto es el que propuso la cámara.
--  * corregido: la persona eligió otro producto (si elige el mismo, queda
--    como confirmado).
--  * descartado: no se eligió ningún producto.
-- ---------------------------------------------------------------------
create function public.escaneo_resolver(p_id uuid, p_resultado public.resultado_escaneo, p_producto_id uuid default null) returns public.resultado_escaneo
language plpgsql security definer set search_path = '' as $$
declare
  v_predicho uuid;
  v_res      public.resultado_escaneo := p_resultado;
  v_prod     uuid := p_producto_id;
begin
  if public.rol_actual() is null then
    raise exception 'Sin permiso para registrar escaneos' using errcode = '42501';
  end if;
  select e.producto_predicho_id into v_predicho from public.escaneos_ia e
   where e.id = p_id and e.usuario_id = auth.uid() and e.resultado = 'pendiente' for update;
  if not found then
    raise exception 'Escaneo inexistente o ya resuelto' using errcode = 'P0002';
  end if;
  if v_res = 'pendiente' then
    raise exception 'Resultado no válido' using errcode = '22023';
  elsif v_res = 'confirmado' then
    v_prod := coalesce(v_prod, v_predicho);
    if v_prod is null then raise exception 'La etiqueta no está vinculada a un producto: corrígela eligiendo uno' using errcode = '22023'; end if;
    if v_prod is distinct from v_predicho then v_res := 'corregido'; end if;
  elsif v_res = 'corregido' then
    if v_prod is null then raise exception 'Indica el producto correcto' using errcode = '22023'; end if;
    if v_prod = v_predicho then v_res := 'confirmado'; end if;
  else
    v_prod := null;
  end if;
  if v_prod is not null and not exists (select 1 from public.productos p where p.id = v_prod) then
    raise exception 'Producto inexistente' using errcode = 'P0002';
  end if;
  update public.escaneos_ia set resultado = v_res, producto_confirmado_id = v_prod, resuelto_en = now() where id = p_id;
  return v_res;
end $$;

revoke execute on function public.escaneo_registrar(text, text, numeric, text, numeric, boolean, text, uuid) from public, anon;
revoke execute on function public.escaneo_resolver(uuid, public.resultado_escaneo, uuid)                  from public, anon;
grant execute on function public.escaneo_registrar(text, text, numeric, text, numeric, boolean, text, uuid) to authenticated;
grant execute on function public.escaneo_resolver(uuid, public.resultado_escaneo, uuid)                  to authenticated;
