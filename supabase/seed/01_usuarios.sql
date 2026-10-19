-- =====================================================================
-- Seed LOCAL: cuentas de prueba del README. SOLO DESARROLLO.
-- Nunca ejecutar en un proyecto real: las contraseñas son públicas.
--
-- Se ejecuta con `npx supabase start` (primera vez) o `npx supabase db reset`.
-- El disparador auth_crear_perfil crea la fila de `clientes` de cada cuenta;
-- aquí solo se añade el perfil interno del personal.
-- =====================================================================

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                        confirmation_token, recovery_token, email_change_token_new, email_change)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
       extensions.crypt(u.clave, extensions.gen_salt('bf')), now(),
       '{"provider": "email", "providers": ["email"]}'::jsonb, jsonb_build_object('nombre', u.nombre),
       now(), now(), '', '', '', ''
from (values
  ('a0000000-0000-4000-8000-000000000001'::uuid, 'admin@tienda.bo',      'admin123',      'Administrador'),
  ('a0000000-0000-4000-8000-000000000002'::uuid, 'almacenero@tienda.bo', 'almacenero123', 'Almacenero'),
  ('a0000000-0000-4000-8000-000000000003'::uuid, 'cliente@tienda.bo',    'cliente123',    'Cliente de prueba')
) as u (id, email, clave, nombre)
on conflict (id) do nothing;

insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select u.id::text, u.id, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       'email', now(), now(), now()
from auth.users u
where u.email in ('admin@tienda.bo', 'almacenero@tienda.bo', 'cliente@tienda.bo')
on conflict do nothing;

-- Personal interno (el rol `operador` es el «Almacenero» de la interfaz)
insert into public.perfiles (id, nombre, rol) values
  ('a0000000-0000-4000-8000-000000000001', 'Administrador', 'admin'),
  ('a0000000-0000-4000-8000-000000000002', 'Almacenero', 'operador')
on conflict (id) do nothing;

-- Teléfono del cliente de prueba, para no tener que escribirlo en cada pedido
update public.clientes set telefono = '70000000'
 where id = 'a0000000-0000-4000-8000-000000000003' and telefono = '';
