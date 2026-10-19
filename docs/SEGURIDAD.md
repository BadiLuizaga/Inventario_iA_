# Seguridad y permisos

Definidos en `supabase/migrations/0001_esquema_inicial.sql`, `0002_tienda_variantes_almacenes.sql` y `0003_mercado_calzado.sql`. Las comprobaciones automáticas están en `supabase/tests/migraciones.test.mjs` (`npm run test:db`).

## Principios

- El navegador y la app Android usan **solo la clave pública** (publishable o anon). La app y el contenedor se niegan a usar `sb_secret_…` o `service_role`.
- **RLS activado en las 23 tablas.** El rol `anon` no tiene privilegios sobre ninguna tabla.
- **Ocultar botones no es seguridad.** Cada operación la comprueba la base de datos:
  - con políticas RLS para la lectura y para los datos maestros;
  - con funciones `security definer` (con `search_path = ''`) para todo lo que cambia stock, pedidos, conteos o roles.
- **El stock no se escribe directamente.** `existencias`, `movimientos_inventario`, `pedidos` y `conteos` no aceptan `INSERT`, `UPDATE` ni `DELETE` desde el cliente. Solo cambian mediante estas funciones atómicas:
  - `registrar_movimiento_inventario`;
  - `crear_pedido`, `pedido_cambiar_estado` y `cancelar_mi_pedido`;
  - `conteo_*`.
  
  Las tres comparten el núcleo interno `_mover_stock`, que no puede ejecutar nadie desde fuera. Ese núcleo:
  - bloquea la fila;
  - impide el stock negativo;
  - registra el movimiento, con su saldo, en la misma transacción.
- **Los movimientos y el historial de pedidos son inmutables.** Un disparador bloquea `UPDATE` y `DELETE`, incluso para el propietario. Los errores se corrigen con un ajuste.
- La **cámara nunca modifica el stock.** Solo propone el producto; la cantidad la introduce y confirma una persona.

## Cuentas y roles

- **Cliente:** cualquier cuenta nueva. Recibe una fila en `clientes` y **ningún** acceso interno. Solo ve y edita lo suyo (sus datos y sus pedidos).
- **Personal:** tiene una fila en `perfiles` con el rol `lector`, `operador` o `admin`.
  - Solo la crea o modifica un administrador, con `admin_asignar_rol`.
  - Nadie puede cambiar su propio rol.
  - Siempre debe quedar al menos un administrador activo.
  - Si `activo = false`, la cuenta pierde todo el acceso interno.

| Acción | anónimo | cliente | lector | almacenero (`operador`) | admin |
|---|:-:|:-:|:-:|:-:|:-:|
| Ver catálogo publicado y disponibilidad (3 estados) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Crear pedido / ver y cancelar los propios (pendientes) | ❌ | ✅ | ✅* | ✅* | ✅* |
| Ver existencias, movimientos, conteos, almacenes | ❌ | ❌ | ✅ | ✅ | ✅ |
| Ver el mercado de calzado (`mercado_comercio`, Excel Manaco; nadie lo escribe desde la app) | ❌ | ❌ | ✅ | ✅ | ✅ |
| Entradas, salidas, devoluciones; registrar conteos | ❌ | ❌ | ❌ | ✅ | ✅ |
| Ajustes; aplicar conteos | ❌ | ❌ | ❌ | ❌ | ✅ |
| Ver todos los pedidos y clientes | ❌ | ❌ | ❌ | ✅ | ✅ |
| Cambiar estado de pedidos | ❌ | ❌ | ❌ | ❌ | ✅ |
| Catálogo, maestros, imágenes, umbrales | ❌ | ❌ | ❌ | ❌ | ✅ |
| Asignar roles | ❌ | ❌ | ❌ | ❌ | ✅ (a otros) |

\* Si su cuenta también tiene registro de cliente.

## Datos públicos

- La tienda lee **vistas** (`tienda_productos`, `tienda_variantes`, `tienda_imagenes`, `tienda_marcas`, `tienda_categorias`, `tienda_tallas`, `tienda_colores` y `tienda_sucursales`).
  - Exponen solo las columnas destinadas a clientes y solo lo publicado y activo.
  - Se ejecutan con los permisos de su propietario. Por eso el *Security Advisor* las marca como «security definer view». Es intencionado: las tablas base siguen cerradas.
  - Son **de solo lectura**. La 0002 revoca todo sobre ellas y concede únicamente `SELECT`: Supabase concede por defecto `ALL` sobre los objetos nuevos, y una vista simple que se ejecuta como propietario permitiría, sin esa revocación, cambiar precios o datos maestros sin pasar por RLS. Lo comprueba la prueba «ninguna vista admite escritura».
- `tienda_disponibilidad()` devuelve solo `disponible`, `pocas` o `agotado`, con los umbrales de `config_tienda`. **Nunca** devuelve cantidades ni datos por almacén.

## Riesgos residuales conocidos

- **Imágenes:** el bucket `productos` es público. Quien conozca la ruta exacta puede ver la imagen de un producto no publicado.
- **Deducción de stock:** probando cantidades crecientes en un pedido podría acotarse el stock de una variante. Lo limita el máximo de 20 unidades por artículo y por pedido.
- **Acaparamiento de reservas:** cada cliente puede tener como máximo **5 pedidos pendientes**. Un administrador puede cancelar los pedidos abusivos (el stock vuelve a su almacén).
- **Roles:** `admin_asignar_rol` solo da acceso interno a cuentas con el **correo confirmado**, para que nadie se registre con el correo de un empleado y reciba su rol.
- **Registro público:** es necesario para los clientes. Usa la confirmación por correo y la protección contra ataques de Supabase (CAPTCHA y límites).
- **CSP de Nginx:** usa `'unsafe-eval'`, que TensorFlow.js 1.x necesita para compilar el modelo.

## Esquema anterior (0001)

- `inventario` y `movimientos` (stock por producto) **se conservan intactas** y en solo lectura.
- `registrar_movimiento()` deja de poder ejecutarse por los usuarios.
- El disparador que añadía filas a `inventario` queda **deshabilitado**, no eliminado.
- El stock vigente está en `existencias` (por variante y almacén).
