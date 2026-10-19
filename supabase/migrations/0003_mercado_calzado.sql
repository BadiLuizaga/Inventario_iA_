-- =====================================================================
-- 0003 — Mercado de calzado (referencia externa para el caso Manaco)
--
-- SOLO ESTRUCTURA. Los registros vienen del Excel «Bae de Datos MANACO -
-- INTERMEDIO» (comercio exterior de calzado de España, 2020–2024) y se cargan
-- con supabase/seed/03_mercado_manaco.sql (generado por scripts/excel_a_sql.py).
--
-- Sin restricción de unicidad: el Excel trae combinaciones repetidas de
-- flujo, año, código y socio, y se conservan tal cual para el análisis.
-- Lectura para el personal activo; nadie escribe desde la app.
-- =====================================================================

create table public.mercado_comercio (
  id                 bigint generated always as identity primary key,
  pais_reportante    text not null check (char_length(btrim(pais_reportante)) between 1 and 80),
  flujo              text not null check (flujo in ('importacion', 'exportacion')),
  anio               smallint not null check (anio between 1990 and 2100),
  codigo_sa6         text not null check (codigo_sa6 ~ '^[0-9]{6}$'),
  categoria          text not null check (char_length(btrim(categoria)) between 1 and 200),
  socio              text not null check (char_length(btrim(socio)) between 1 and 80),
  valor_usd          numeric(16, 2) not null check (valor_usd >= 0),
  pares              bigint check (pares is null or pares >= 0),
  valor_usd_por_par  numeric(12, 2) generated always as (case when pares > 0 then round(valor_usd / pares, 2) end) stored
);
create index mercado_comercio_anio_idx on public.mercado_comercio (anio, flujo);
comment on table public.mercado_comercio is 'Comercio exterior de calzado (fuente externa, no ventas de la empresa). Valor comercial en USD; no equivale al precio al consumidor.';
comment on column public.mercado_comercio.valor_usd_por_par is 'Valor comercial aproximado por par (valor_usd / pares).';

alter table public.mercado_comercio enable row level security;

revoke all on public.mercado_comercio from anon;
revoke insert, update, delete, truncate, references, trigger on public.mercado_comercio from authenticated;
grant select on public.mercado_comercio to authenticated;

create policy "mercado_comercio: lectura personal" on public.mercado_comercio
  for select to authenticated using ((select public.rol_actual()) is not null);
