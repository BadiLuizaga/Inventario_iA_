# Seguridad y permisos

Todo está definido en `supabase/migrations/0001_esquema_inicial.sql`.

## Principios

- El navegador solo usa la **clave pública** (publishable / anon). La app se niega a arrancar si `js/config.js` contiene una `sb_secret_…` o una `service_role`.
- **Row Level Security** está activado en las cuatro tablas. El rol `anon` no tiene ningún privilegio.
- El stock **no se escribe directamente**: `inventario` y `movimientos` no aceptan `INSERT/UPDATE/DELETE` desde el cliente. Solo cambian a través de `registrar_movimiento()`, que es atómica, valida el rol, impide el stock negativo y registra el movimiento en la misma transacción.
- Los movimientos son **inmutables**: un disparador bloquea `UPDATE` y `DELETE`, incluso para la clave secreta. Los errores se corrigen con un movimiento inverso.
- Las funciones `security definer` fijan `search_path = ''` y usan nombres calificados.

## Roles

Cada cuenta de Supabase Auth recibe automáticamente un perfil (`public.perfiles`) con rol **lector**.

| Acción | lector | operador | admin | anónimo |
|---|:-:|:-:|:-:|:-:|
| Ver productos, inventario y movimientos | ✅ | ✅ | ✅ | ❌ |
| Ver nombres de otros usuarios (historial) | ✅ | ✅ | ✅ | ❌ |
| Registrar entrada / salida (`registrar_movimiento`) | ❌ | ✅ | ✅ | ❌ |
| Crear / editar / eliminar productos | ❌ | ❌ | ✅ | ❌ |
| Modificar `inventario` o `movimientos` directamente | ❌ | ❌ | ❌ | ❌ |
| Cambiar roles o activar/desactivar perfiles | ❌ | ❌ | ❌ (solo desde el panel de Supabase) | ❌ |

Un perfil con `activo = false` pierde todo acceso (incluida la lectura) aunque conserve la sesión.

## Configuración pendiente en el panel de Supabase

Estos pasos **no** se pueden hacer desde el SQL de la migración y requieren tus credenciales:

1. **Desactivar el registro público**: Authentication → Sign In / Providers → desactivar *Allow new users to sign up*. Si sigue activo, cualquiera podría crearse una cuenta (con rol lector, que puede **leer** el inventario).
2. **Crear las cuentas**: Authentication → Users → *Add user* (correo y contraseña).
3. **Asignar el primer administrador** (SQL Editor, reemplaza el correo):
   ```sql
   update public.perfiles set rol = 'admin'
   where id = (select id from auth.users where email = 'correo@tienda.com');
   ```
   Para operadores, lo mismo con `rol = 'operador'`.
4. **URL del sitio**: Authentication → URL Configuration → *Site URL* = la dirección donde publiques la app.
5. Revisar *Database → Security Advisor* después de aplicar la migración.

## Pendiente de definir (siguientes fases)

- Interfaz de administración de usuarios y roles (hoy: solo SQL o panel).
- Si los lectores deben ver precios. Hoy sí. Si no, mover el precio a una vista o columna con privilegios propios.
- Ajustes de inventario (conteo físico) como tipo de movimiento propio, con permiso específico.
- Políticas de Realtime cuando se habilite la sincronización (Realtime respeta RLS en `postgres_changes`).
- Límite de intentos de inicio de sesión y CAPTCHA (Authentication → Attack Protection).
