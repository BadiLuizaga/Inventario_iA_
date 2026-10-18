-- =====================================================================
-- Inspección del proyecto Supabase — SOLO LECTURA
--
-- * Una ÚNICA consulta (el SQL Editor solo muestra el último resultado).
-- * Solo lee el catálogo del sistema y cuenta filas: no crea, modifica ni
--   borra nada, y no muestra correos ni datos personales.
-- * No falla si faltan tablas: las opcionales (perfiles, migraciones de la
--   CLI, storage, realtime) se consultan solo si existen.
--
-- Uso: Supabase → SQL Editor → pegar todo → Run → exportar o copiar el
-- resultado completo (columnas: orden, seccion, elemento, detalle).
-- =====================================================================
with
tablas_public as (
  select c.oid, c.relname, c.relrowsecurity, c.relforcerowsecurity
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p')
),
resultado as (

  -- 1. Servidor
  select 1 as orden, 'servidor' as seccion, 'postgres' as elemento,
         current_setting('server_version') as detalle

  -- 2. Tablas de public: RLS y número EXACTO de filas
  union all
  select 2, 'tabla', t.relname,
         'filas=' || (xpath('/row/n/text()',
                      query_to_xml(format('select count(*) as n from public.%I', t.relname), false, true, '')))[1]::text
         || ' | rls=' || t.relrowsecurity || ' | rls_forzado=' || t.relforcerowsecurity
  from tablas_public t

  -- 3. Columnas de cada tabla de public (para comparar con las migraciones)
  union all
  select 3, 'columnas', t.relname,
         string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
                    || case when a.attnotnull then ' not null' else '' end, ', ' order by a.attnum)
  from tablas_public t
  join pg_attribute a on a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped
  group by t.relname

  -- 4. Vistas de public
  union all
  select 4, 'vista', c.relname, coalesce(array_to_string(c.reloptions, ', '), '')
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('v', 'm')

  -- 5. Políticas RLS (public y storage)
  union all
  select 5, 'politica', p.schemaname || '.' || p.tablename || ' · ' || p.policyname,
         p.cmd || ' | roles=' || array_to_string(p.roles, ',')
         || ' | using=' || coalesce(p.qual, '—') || ' | check=' || coalesce(p.with_check, '—')
  from pg_policies p where p.schemaname in ('public', 'storage')

  -- 6. Privilegios de anon / authenticated sobre public
  union all
  select 6, 'privilegio', g.table_name || ' · ' || g.grantee,
         string_agg(g.privilege_type, ', ' order by g.privilege_type)
  from information_schema.role_table_grants g
  where g.table_schema = 'public' and g.grantee in ('anon', 'authenticated')
  group by g.table_name, g.grantee

  -- 7. Funciones de public
  union all
  select 7, 'funcion', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
         'security_definer=' || p.prosecdef
         || ' | search_path=' || coalesce(array_to_string(p.proconfig, ','), '—')
         || ' | anon=' || has_function_privilege('anon', p.oid, 'execute')
         || ' | authenticated=' || has_function_privilege('authenticated', p.oid, 'execute')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'

  -- 8. Disparadores en public y en auth.users
  union all
  select 8, 'trigger', n.nspname || '.' || c.relname || ' · ' || tg.tgname,
         'funcion=' || tg.tgfoid::regproc::text || ' | habilitado=' || tg.tgenabled::text
  from pg_trigger tg
  join pg_class c on c.oid = tg.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where not tg.tgisinternal
    and (n.nspname = 'public' or (n.nspname = 'auth' and c.relname = 'users'))

  -- 9. Tipos enumerados de public
  union all
  select 9, 'enum', t.typname, string_agg(e.enumlabel, ', ' order by e.enumsortorder)
  from pg_type t
  join pg_enum e on e.enumtypid = t.oid
  join pg_namespace n on n.oid = t.typnamespace
  where n.nspname = 'public'
  group by t.typname

  -- 10. Cuentas de Auth (solo conteos)
  union all
  select 10, 'auth', 'cuentas',
         'total=' || (select count(*) from auth.users)
         || ' | sin_confirmar=' || (select count(*) from auth.users where email_confirmed_at is null)

  -- 11. Perfiles por rol (solo si existe public.perfiles)
  union all
  select 11, 'perfiles', 'por rol',
         coalesce(nullif(array_to_string(xpath('/table/row/r/text()',
           query_to_xml('select rol::text || '':'' || case when activo then ''activo'' else ''inactivo'' end'
                        || ' || ''='' || count(*) as r from public.perfiles group by rol, activo', false, false, '')), ', '), ''),
                  '(sin perfiles)')
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'perfiles' and c.relkind = 'r'

  -- 12. Migraciones registradas por la CLI (solo si existe la tabla)
  union all
  select 12, 'migraciones_cli', 'aplicadas',
         coalesce(nullif(array_to_string(xpath('/table/row/m/text()',
           query_to_xml('select version || '' '' || coalesce(name, '''') as m from supabase_migrations.schema_migrations order by version',
                        false, false, '')), ', '), ''), '(ninguna)')
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'supabase_migrations' and c.relname = 'schema_migrations'

  -- 13. Buckets de Storage (solo si existe storage.buckets)
  union all
  select 13, 'storage', 'buckets',
         coalesce(nullif(array_to_string(xpath('/table/row/b/text()',
           query_to_xml('select id || '' (public='' || public || '')'' as b from storage.buckets order by id', false, false, '')), ', '), ''),
                  '(sin buckets)')
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'storage' and c.relname = 'buckets'

  -- 14. Realtime: tablas publicadas
  union all
  select 14, 'realtime', p.pubname,
         coalesce((select string_agg(pt.schemaname || '.' || pt.tablename, ', ' order by pt.tablename)
                   from pg_publication_tables pt where pt.pubname = p.pubname), '(sin tablas)')
  from pg_publication p where p.pubname = 'supabase_realtime'

  -- 15. Marcadores de ausencia (para distinguir «no existe» de «vacío»)
  union all
  select 15, 'ausente', x.obj, 'no existe'
  from (values ('public.perfiles'), ('public.productos'), ('public.inventario'), ('public.movimientos'),
               ('supabase_migrations.schema_migrations'), ('storage.buckets')) as x(obj)
  where to_regclass(x.obj) is null
  union all
  select 15, 'ausente', 'publicacion supabase_realtime', 'no existe'
  where not exists (select 1 from pg_publication where pubname = 'supabase_realtime')
)
select orden, seccion, elemento, detalle
from resultado
order by orden, elemento;
