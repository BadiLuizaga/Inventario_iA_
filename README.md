# Comercio electrónico e inventario inteligente de calzado

Una sola base de datos (Supabase/PostgreSQL) y tres áreas:

| Área | Archivo | Para quién |
|---|---|---|
| **Tienda virtual** | `index.html` | Clientes: catálogo, filtros, ficha, carrito, pedidos sin pago en línea, cuenta |
| **Herramienta de almacén** | `almacen.html` | Personal: cámara con IA, existencias, entradas/salidas/devoluciones/ajustes, conteos físicos, historial y cierre diario |
| **Panel administrativo** | `admin.html` | Administradores: productos, variantes, imágenes, marcas, categorías, tallas, colores, sucursales, almacenes, pedidos, usuarios y roles, reportes, configuración |

> **El sistema se entrega vacío.** Las migraciones crean solo estructura (tablas, funciones, políticas). No hay productos, usuarios, existencias ni pedidos de ejemplo: todo se registra desde la interfaz.

---

## 1. Arquitectura

- **Frontend:** HTML, CSS y JavaScript modular (módulos ES, sin compilación). Librerías por CDN con versión fija: supabase-js 2.45.4, TensorFlow.js 1.3.1, Teachable Machine 0.8.5.
- **IA:** el modelo de Teachable Machine original. La cámara **identifica el modelo de calzado**; no cuenta unidades ni modifica el stock.
- **Base de datos:** PostgreSQL en Supabase, con **Row Level Security** en todas las tablas y funciones `security definer` atómicas para todo lo que cambia stock.
- **Autenticación:** Supabase Auth (correo y contraseña). Clientes y personal están separados (ver §8).
- **Despliegue:** Docker + Nginx (sitio estático). No hay PostgreSQL local: la base es Supabase.
- **Android:** Capacitor 8 envuelve la herramienta de almacén (ver §12).

```
Navegador / app Android ──HTTPS──▶ Supabase (PostgREST + Auth + Storage + Realtime)
   │  clave PÚBLICA únicamente          │
   │                                    ├─ RLS: cada fila y operación se valida en la base
   └─ Nginx (Docker) sirve los archivos └─ Funciones atómicas: movimientos, pedidos, conteos, roles
```

## 2. Funcionalidades implementadas

**Tienda** (`index.html`)
- Inicio, menú de categorías y subcategorías, y buscador.
- Catálogo con filtros por categoría, marca, talla, color y «solo con existencias», con ordenación.
- Ficha de producto con galería por color, selección de color y talla, cantidad y disponibilidad.
- Carrito local que se revalida contra la base.
- Checkout con retiro en sucursal o envío.
- Pedidos reales en estado **Pendiente**, sin pago en línea.
- «Mis pedidos», con historial y cancelación mientras el pedido siga pendiente.
- Registro, inicio de sesión y recuperación de contraseña.
- Página de sucursales.
- La disponibilidad pública solo muestra **Disponible / Pocas unidades / Agotado**, con umbrales configurables. **Nunca** se muestran cantidades ni datos por almacén.

**Almacén** (`almacen.html`, pensado para el teléfono)
- Inicio de sesión del personal y elección del almacén de trabajo.
- Escáner con IA:
  - si la etiqueta reconocida está vinculada a un producto registrado, muestra el producto, sus variantes y el stock real;
  - si no está vinculada, lo indica y ofrece la búsqueda manual.
- Registro de **entradas, salidas y devoluciones** (operador o administrador) y de **ajustes** (solo administrador):
  - motivo obligatorio salvo en las entradas;
  - confirmación previa que muestra «stock antes → después».
- **Conteos físicos:**
  - el operador registra lo contado y el sistema guarda el stock que había en ese momento;
  - se muestran las discrepancias;
  - el **administrador** las revisa contra el stock actual y aplica solo las que elija, generando ajustes trazados.
- Existencias por almacén, con búsqueda y filtro de bajo mínimo.
- Historial por día con el **resumen de cierre**, calculado sobre movimientos reales.
- Actualización en tiempo real (Realtime respeta RLS).

**Panel** (`admin.html`)
- Resumen con indicadores reales y guía de «Primeros pasos».
- Altas, bajas y modificaciones de marcas, categorías (con jerarquía), tallas, colores, sucursales y almacenes.
  - Si un registro está en uso, no se borra: se ofrece desactivarlo.
- Productos:
  - datos y publicación en la tienda;
  - etiqueta de IA, elegida entre las etiquetas reales del modelo;
  - variantes por talla y color, creadas en lote;
  - imágenes en Storage;
  - existencias por almacén: mínimo, ubicación y movimientos.
- Pedidos: detalle, almacén del que se reservó cada unidad y cambios de estado controlados.
  - Cancelar devuelve el stock.
- Usuarios y roles: lector, operador y administrador. Nadie puede cambiar su propio rol y siempre queda al menos un administrador activo.
- Reportes, todos exportables a CSV:
  - stock actual y por almacén;
  - bajo stock;
  - entradas y salidas por fecha;
  - diferencias de conteo;
  - actividad por usuario;
  - pedidos y ventas.
- Configuración de los umbrales de disponibilidad.

## 3. Estructura de carpetas

```
index.html  almacen.html  admin.html  manifest.webmanifest  icon-*.png
css/        base.css (paleta azul y componentes) · tienda.css · almacen.css · admin.css
js/
  supabase.js · auth.js · ui.js · prefs.js · config.example.js
  classifier/   engine.js · model.js · scanner.js      ← IA original (sin cambios funcionales)
  services/     tienda.js (datos públicos) · interno.js (datos del personal)
  tienda/       app.js · cart.js
  almacen/      app.js · views.js · picker.js
  admin/        app.js · crud.js · productos.js · gestion.js · reportes.js · util.js
supabase/
  migrations/   0001_esquema_inicial.sql · 0002_tienda_variantes_almacenes.sql
  inspeccion/   inspeccion_solo_lectura.sql
  tests/        migraciones.test.mjs   (PostgreSQL en memoria; nunca toca Supabase)
docker/         nginx.conf · 40-config-js.sh
Dockerfile · compose.yaml · .env.example
package.json · capacitor.config.json · scripts/build-www.mjs · android/   (Capacitor)
docs/           SEGURIDAD.md
```

## 4. Requisitos e instalación

- Un proyecto de **Supabase** con PostgreSQL 15 o superior (comprobado: 17.11).
- Para servir el sitio, una de estas opciones: **Docker Desktop**, **Node.js 20+** (`npx serve`) o cualquier servidor estático.
- Para Android: Android Studio (ver §12).

```bash
git clone https://github.com/BadiLuizaga/Inventario_iA_.git
cd Inventario_iA_
```

## 5. Configuración de Supabase

En el panel de Supabase:

1. **Authentication → Sign In / Providers → Email**
   - *Allow new users to sign up*: **activado**. Es lo que permite registrarse a los clientes. Con la 0002 aplicada, una cuenta nueva **solo** es cliente.
   - *Confirm email*: **activado** (recomendado).
   - *Minimum password length*: 8 o más.
2. **Authentication → URL Configuration**
   - *Site URL*: la dirección pública de la tienda (por ejemplo, `https://tu-dominio/`).
   - *Redirect URLs*: añade esa misma URL y `http://localhost:8088/` para las pruebas locales.
3. **Authentication → Attack Protection**: activa la protección de contraseñas filtradas y, si quieres, CAPTCHA.
4. Después de migrar, revisa **Database → Security Advisor**. Verás avisos por las vistas `tienda_*` («security definer view»). Son **intencionados**: es lo que permite publicar solo las columnas destinadas a clientes sin abrir las tablas. Están documentados en `docs/SEGURIDAD.md`.

> Desactiva la traducción automática del navegador en supabase.com: traduce el SQL en pantalla y, si lo copias, deja de funcionar.

## 6. Variables de entorno

| Variable | Dónde | Pública |
|---|---|:-:|
| `SUPABASE_URL` | `.env` (Docker) o `js/config.js` | ✅ |
| `SUPABASE_PUBLISHABLE_KEY` | Igual. Es la *publishable* (`sb_publishable_…`) o la *anon* | ✅ |
| `TIENDA_NOMBRE`, `MONEDA` | Igual | ✅ |
| `APP_PORT` | `.env`, puerto local de Docker (por defecto 8088) | — |
| `SUPABASE_SECRET_KEY`, `SUPABASE_DB_PASSWORD` | Solo CLI o servidor. **Nunca** en `js/` | ❌ |

`js/config.js` y `.env` están en `.gitignore`. La app y el contenedor **se niegan a usar** claves `sb_secret_…` o `service_role`.

## 7. Aplicar las migraciones

**Aplicadas el 18/10/2026** en el proyecto real, con el esquema `public` vacío y sin datos que preservar.

- La 0001 se aplicó entera.
- La 0002 se aplicó por partes, porque el conector MCP bloquea los bloques con `UPDATE`/`DELETE` dentro de funciones. En el historial de Supabase figuran `0002a_tienda_estructura` (líneas 1–301) y `0002c_tienda_rls` (líneas 946–963). El resto se ejecutó en el SQL Editor dentro de `begin`/`commit`.
- El resultado se verificó contra la 0002 completa: 0 diferencias en 131 objetos.

Para un proyecto **nuevo**, sigue estos pasos:

1. Supabase → **SQL Editor** → *New query*.
2. Pega y ejecuta **todo** `supabase/migrations/0001_esquema_inicial.sql`.
3. En otra consulta, pega y ejecuta **todo** `supabase/migrations/0002_tienda_variantes_almacenes.sql`.
   - Hazlo **justo después** del paso 2, antes de permitir registros: con solo la 0001, cada cuenta nueva sería «lector» y vería el inventario.
4. Comprueba el resultado con `supabase/inspeccion/inspeccion_solo_lectura.sql` (solo lectura). Deben aparecer 22 tablas, todas con `filas=0` y `rls=true`.

Las migraciones no insertan datos de negocio. El único registro técnico es el *bucket* de Storage `productos`.

Pruebas de las migraciones, aisladas en memoria y sin conectar a Supabase:

```bash
npm install
npm run test:db      # 95 comprobaciones de permisos, atomicidad, RLS y estado vacío
SIN_PRIVILEGIOS_POR_DEFECTO=1 npm run test:db   # lo mismo en un proyecto sin privilegios automáticos
```

## 8. Crear el primer administrador (de forma segura)

No hay usuarios ni contraseñas predeterminados. Desde la interfaz nadie puede asignarse un rol: solo un administrador puede dárselo a otra persona.

1. Crea la cuenta:
   - en Supabase → **Authentication → Users → Add user** (correo y contraseña robusta; marca *Auto Confirm User*);
   - o regístrate en la tienda (*Mi cuenta → Crear cuenta*) y confirma el correo.
2. En **SQL Editor** (se ejecuta como propietario, sin pasar por RLS), sustituyendo el nombre y el correo:
   ```sql
   insert into public.perfiles (id, nombre, rol)
   select id, 'Nombre del administrador', 'admin' from auth.users
    where lower(email) = lower('correo@empresa.com') and email_confirmed_at is not null
   on conflict (id) do update set rol = 'admin', activo = true
   returning id, rol, activo;
   ```
   - Debe devolver **exactamente una fila**. Si no devuelve ninguna, el correo no existe o aún no está confirmado: no se ha cambiado nada.
3. Entra en `admin.html` con esa cuenta.

A partir de ahí, el resto del personal se gestiona desde **Panel → Usuarios y roles**:

| Rol | Puede |
|---|---|
| **Lector** | Consultar el inventario, los movimientos y los conteos |
| **Almacenero** (`operador` en la base) | Módulo de almacén: escáner, búsqueda, existencias, entradas, salidas, devoluciones, conteos e historial. Sin ajustes ni panel |
| **Administrador** | Todo: ajustes, aplicar conteos, catálogo, pedidos, usuarios y configuración |

### Entorno local de pruebas (cuentas de almacenero y cliente)

Es un Supabase **local** en Docker, aislado del proyecto real, con las mismas migraciones. La confirmación de correo sigue activada: los correos llegan al buzón local (Mailpit).

```bash
npm run supabase:local   # arranca Supabase local (API 127.0.0.1:54321 · Studio :54323 · Mailpit :54324)
npm run dev:local        # app local en http://localhost:8089 (usa solo la clave pública local)
npx supabase stop        # lo detiene; conserva los datos de prueba
```

Cuentas de prueba, solo en el entorno local. Las contraseñas están en `supabase/.env.pruebas.local`, que no se versiona:

| Cuenta | Rol | Dónde entra |
|---|---|---|
| `almacenero@inventario.test` | Almacenero | `http://localhost:8089/almacen.html` |
| `cliente@inventario.test` | Cliente | `http://localhost:8089` (tienda) |
| `admin.prueba@inventario.test` | Administrador (solo local) | `http://localhost:8089/admin.html` |

El entorno local contiene un catálogo mínimo de prueba (`Zapato Prueba`) para ejercitar los flujos. Nunca se carga en el proyecto real.

## 9. Inicio con Docker

```bash
cp .env.example .env          # completa SUPABASE_URL y SUPABASE_PUBLISHABLE_KEY
docker compose up -d --build
# → http://localhost:8088  (tienda) · /almacen.html · /admin.html
```

- Puerto: **8088** por defecto, porque el 8080 de esta máquina lo usa otro proceso. Cámbialo con `APP_PORT`.
- El contenedor genera `js/config.js` al arrancar a partir de `.env`. La imagen no contiene secretos.
- Nginx añade cabeceras de seguridad:
  - CSP limitada a Supabase, jsDelivr, Google Fonts y Teachable Machine;
  - `Permissions-Policy` con cámara solo para el propio sitio;
  - `nosniff` y `frame-ancestors 'none'`.
- Incluye una comprobación de salud en `/salud`.
- No detiene ni modifica contenedores de otros proyectos.

Sin Docker:

```bash
cp js/config.example.js js/config.js   # completa la URL y la clave pública
npx serve . -l 8088
```

**Cámara en el teléfono:** el navegador solo la permite con **HTTPS** (o en `localhost`). Para usarla desde un teléfono, publica el sitio con HTTPS, usa un túnel (por ejemplo, `cloudflared` o `ngrok`) o la app Android.

## 10. Uso de la tienda virtual

1. El cliente navega por el catálogo y filtra por categoría, marca, talla, color o disponibilidad.
2. En la ficha elige color y talla. Solo puede agregar al carrito variantes con precio y que no estén agotadas.
3. En el checkout inicia sesión, elige retiro o envío, indica un teléfono y confirma.
   - La base comprueba el stock y lo **reserva** en una sola transacción.
   - Si falta stock, no se crea nada.
4. El pedido queda **Pendiente**. El administrador lo gestiona desde *Panel → Pedidos* (confirmar → preparar → enviar o entregar). Cancelar devuelve las unidades a su almacén.

Solo se ven en la tienda los productos **activos y publicados**, con al menos una variante activa.

## 11. Uso de la herramienta de almacén

1. Entra con una cuenta de personal y elige el **almacén de trabajo** (se recuerda en el dispositivo).
2. **Escáner:** pulsa *Activar cámara* y muestra un producto. Si su etiqueta de IA está vinculada a un producto registrado, verás sus variantes y el stock del almacén. Para registrar, toca una variante; la cantidad **la escribes tú**.
3. **Búsqueda manual:** sirve cuando el modelo no reconoce el producto.
4. **Registrar:** tipo, cantidad, motivo y referencia, y luego confirmación. No se permite dejar stock negativo.
5. **Conteos:**
   - *Empezar conteo* → agrega cada variante con la cantidad contada;
   - el administrador revisa las diferencias y aplica solo las que elija.
6. **Historial:** movimientos del día y resumen de cierre.

Para vincular la IA, en *Panel → Productos → Editar* elige la **etiqueta del modelo** que corresponde a ese producto. El reconocimiento no inventa productos: si la etiqueta no está vinculada, lo dice.

## 12. Aplicación Android (Capacitor)

**Estado:** el proyecto Android está **generado y configurado** en `android/`:
- Capacitor 8.5.3;
- permiso de cámara;
- esquema `https` para que `getUserMedia` funcione.

**El APK todavía no se ha compilado.** En esta máquina no hay Android SDK, y el Java instalado (25) no es compatible con Gradle 8.14.3, que requiere JDK 21.

La app abre directamente la **herramienta de almacén**.

Pasos para generar el APK:

1. Instala **Android Studio**. Trae el SDK y un JDK 21 integrado.
2. Crea `js/config.js` con la URL y la clave **pública**.
3. Prepara y sincroniza la app:
   ```bash
   npm install
   npm run android:sync       # copia la web a www/ y sincroniza android/
   npm run android:open       # abre el proyecto en Android Studio
   ```
4. En Android Studio, en *Settings → Build Tools → Gradle → Gradle JDK*, elige el **JDK 21 integrado**.
5. Genera el APK: *Build → Build App Bundle(s) / APK(s) → Build APK(s)*. Para una versión de producción, firma con tu propio keystore, que nunca se sube a Git.
6. Instálalo en el teléfono y comprueba en un **dispositivo físico** el permiso de cámara, la carga del modelo (requiere internet) y el inicio de sesión.

Limitaciones conocidas:
- El modelo de IA y las librerías se descargan de internet: no funciona sin conexión.
- Los enlaces de confirmación y recuperación por correo abren la web, no la app. El registro de clientes se hace en la tienda web.

## 13. Pruebas realizadas y resultados

| Prueba | Resultado |
|---|---|
| Sintaxis de los 21 módulos JS (`node --check`) | ✅ Sin errores |
| Importaciones entre módulos | ✅ Todas resuelven |
| ESLint (`no-undef`, duplicados, código inalcanzable) | ✅ 0 errores |
| Migraciones 0001 + 0002 en PostgreSQL 17 aislado (PGlite) | ✅ 95/95, con y sin privilegios por defecto: RLS, roles, vistas públicas de solo lectura, límite de 5 pedidos pendientes, autoasignación bloqueada, stock no negativo, pedidos atómicos (sin restos al fallar), cancelación que devuelve stock, conteos, movimientos inmutables, aislamiento de clientes, 0 filas tras migrar |
| Consulta de inspección (proyecto vacío, con 0001, con 0001 + 0002) | ✅ Solo lectura; no crea objetos |
| Interfaz en Chrome headless: 3 páginas sin configuración y 16 escenarios con un Supabase **simulado** con tablas vacías | ✅ Sin errores de JavaScript; estados vacíos correctos; sin desbordamiento horizontal a 390 px |
| IA en Chrome headless: carga del modelo de Teachable Machine y cámara simulada | ✅ Modelo listo en unos 9 s; vídeo 1280×720; la cámara se apaga al cambiar de pestaña |
| Script de `config.js` del contenedor | ✅ Escapa comillas; rechaza `sb_secret_` y `service_role` |
| Generación del proyecto Android (`npx cap add android`) | ✅ Generado |
| Compilación del APK | ⛔ No realizada (falta el SDK; ver §12) |
| `docker compose up` | ⛔ No verificado: Docker Desktop no estaba en ejecución |
| Pruebas contra el Supabase real | ⛔ No realizadas: las migraciones aún no están aplicadas |

## 14. Funcionalidades pendientes

- Pagos en línea: no se implementan sin una pasarela configurada y autorizada.
- Transferencias entre almacenes como operación única. Hoy se hacen con una salida y una entrada.
- Costo de envío: se coordina con el cliente; no se calcula.
- Paginación del catálogo en la tienda: se cargan hasta 2000 productos publicados de una vez, suficiente para empezar.
- Funcionamiento sin conexión de la herramienta de almacén.

## 15. Configuración externa que requiere tu intervención

1. Aplicar las migraciones 0001 y 0002 (§7).
2. Ajustes de Auth y URLs en Supabase (§5).
3. Crear el primer administrador (§8).
4. Crear `.env` o `js/config.js` con la clave **pública** (§6).
5. Iniciar Docker Desktop y ejecutar `docker compose up -d --build` (§9).
6. Instalar Android Studio para compilar el APK (§12).
7. HTTPS para usar la cámara desde teléfonos en la web (§9).

### Primer producto real, paso a paso

1. Aplica las migraciones y crea el primer administrador.
2. Entra en `admin.html`.
3. *Sucursales* → agrega la sucursal; *Almacenes* → agrega el almacén.
4. *Tallas*, *Colores*, *Marcas* y *Categorías* → registra las que uses.
5. *Productos → Nuevo producto*: nombre, precio, marca, categoría y, si se reconoce por cámara, su etiqueta de IA.
6. En la ficha del producto:
   - *Variantes → Agregar variantes*: color y tallas;
   - *Imágenes*: sube fotos reales.
7. *Existencias → Movimiento → Entrada* con la cantidad recibida. También puedes hacerlo desde la herramienta de almacén.
8. *Editar datos* → marca **Publicar en la tienda**. El producto aparecerá en `index.html`.
