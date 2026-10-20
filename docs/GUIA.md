# Guía completa

Cómo levantar el proyecto en tu PC, qué datos trae, cómo entrenar la cámara y cómo pasarlo a un proyecto Supabase en la nube. Seguridad y permisos: [SEGURIDAD.md](SEGURIDAD.md).

## 1. Requisitos

- **Node.js** 20 o superior (probado con 24).
- **Docker Desktop**, abierto antes de empezar.
- **Python 3**: solo para volver a generar el seed del Excel (`npm run mercado:sql`).

## 2. Despliegue local (todo en tu PC)

```bash
npm install            # CLI de Supabase, PGlite y Capacitor
npx supabase start     # base, Auth, Storage y Realtime en Docker + migraciones + seed
npm run seed:imagenes  # sube las fotos del catálogo demo al Storage local
npm run dev:local      # la app en http://localhost:8089
```

La primera vez, `supabase start` descarga varias imágenes de Docker y puede tardar entre 10 y 15 minutos.

| Dirección | Qué es |
| --- | --- |
| http://localhost:8089 | Tienda |
| http://localhost:8089/almacen.html | Herramienta de almacén (cámara) |
| http://localhost:8089/admin.html | Panel de administración |
| http://127.0.0.1:54323 | Supabase Studio: tablas, SQL y usuarios |
| http://127.0.0.1:54324 | Mailpit: correos de confirmación y recuperación |

- `npm run dev:local` genera `js/config.js` en memoria con la URL y la clave **pública** locales; no escribe archivos.
- El contenedor Nginx (`docker compose`, puerto 8088) es para un Supabase en la nube. Su CSP solo permite `*.supabase.co` y bloquea el Supabase local.
- La cámara funciona en `localhost` con la webcam del PC. Desde un teléfono hace falta HTTPS.

Para empezar de cero (borra todo lo local y vuelve a cargar el seed):

```bash
npx supabase db reset
npm run seed:imagenes   # el reset borra los vínculos de las fotos: vuelve a subirlas
```

Para apagar: `npx supabase stop`.

## 3. Usuarios de prueba (solo local)

Los crea `supabase/seed/01_usuarios.sql`, con el correo ya confirmado. **Nunca** se cargan en un proyecto real.

| Rol | Usuario | Contraseña | Entra en |
| --- | --- | --- | --- |
| Admin | `admin@tienda.bo` | `admin123` | `/admin.html` |
| Almacenero | `almacenero@tienda.bo` | `almacenero123` | `/almacen.html` |
| Cliente | `cliente@tienda.bo` | `cliente123` | Tienda → Mi cuenta |

## 4. Datos que carga el seed

`supabase/config.toml` carga en orden `supabase/seed/*.sql` después de las migraciones.

| Archivo | Contenido |
| --- | --- |
| `01_usuarios.sql` | Las 3 cuentas de prueba y los perfiles de admin y almacenero |
| `02_catalogo_demo.sql` | Catálogo **simulado** de Manaco: 4 categorías, tallas 34–44, 4 colores, 1 sucursal, 2 almacenes, 6 productos, 69 variantes y su stock inicial (como movimientos de entrada) |
| `03_mercado_manaco.sql` | Las 240 filas del Excel del caso Manaco en `mercado_comercio` |
| `imagenes/` | 10 fotos del catálogo demo, una por producto y color. Las sube `npm run seed:imagenes` |

Notas sobre el catálogo demo:

- No son modelos ni precios reales: cada descripción lo indica.
- El stock es determinista. Algunas variantes quedan en 0 o con pocas unidades, para ver los tres estados de la tienda.
- Cada producto tiene `etiqueta_clasificador` igual a su nombre: es la clase que debe tener el modelo de la cámara (sección 6).

Notas sobre las fotos (`supabase/seed/imagenes/`):

- Vienen de Wikimedia Commons con licencias libres (CC0, CC BY o CC BY-SA). No son productos de Manaco.
- Autor, licencia y enlace de cada una están en `CREDITOS.md`. Las licencias CC BY exigen mantener esa atribución.
- `imagenes.json` indica a qué producto y color va cada foto. Para cambiar una, reemplaza el archivo, ajusta `imagenes.json` y `CREDITOS.md`, y súbela desde Panel → Productos → Imágenes (o con `db reset` y `npm run seed:imagenes`).
- El script inicia sesión como el admin de prueba y sube **sin upsert**: la política de Storage da INSERT al admin, y un upsert exigiría también SELECT.

## 5. Datos del Excel: reporte «Mercado Manaco»

El Excel `Bae de Datos MANACO - INTERMEDIO` contiene comercio exterior de calzado de **España** (2020–2024): flujo, año, código SA6, categoría, socio, valor en USD y pares. No es un catálogo de productos, así que va a su propia tabla, `public.mercado_comercio` (migración 0003). Solo la lee el personal activo.

Para volver a generar el seed desde el Excel:

```bash
npm run mercado:sql -- "../Bae de Datos MANACO - INTERMEDIO (1).xlsx"
```

El script `scripts/excel_a_sql.py` hace la limpieza:

- lee las columnas por nombre;
- normaliza el flujo (`importacion` o `exportacion`);
- redondea el valor a 2 decimales;
- comprueba que el valor por par del Excel coincida con valor ÷ pares.

El valor por par lo calcula la base en una columna generada.

En el panel: **Reportes → Mercado Manaco**.

- Filtros por año y categoría.
- Indicadores: importado, exportado, balance, pares y valor por par.
- Gráficos: importación frente a exportación por año, principales socios (top 10) y valor por par por categoría y flujo.
- Tabla de valor frente a cantidad.
- Limitaciones de los datos y descarga en CSV.

Limitaciones que muestra el propio reporte:

- Son datos de España, no de Bolivia.
- El valor comercial no es el precio al consumidor.
- Los años tienen distinta cantidad de registros (28 en 2020 y 82 en 2024).
- Hay 10 combinaciones repetidas de flujo, año, código y socio; se conservan.
- No hay registros «Mundo». Si aparecieran, el reporte los excluye para evitar doble conteo.

## 6. Cámara: entrenar el modelo de zapatos

La cámara usa un modelo de [Teachable Machine](https://teachablemachine.withgoogle.com/) que se ejecuta en el dispositivo. La cámara solo **propone** el producto: la cantidad la escribe y confirma una persona.

**El modelo incluido** está en `modelos/zapatos/` y la app lo carga desde el propio sitio, sin los servidores de Google.

- Reconoce las 6 clases del catálogo demo más `Fondo y otros`.
- Se entrenó con unas 475 fotos de internet revisadas a mano.
- Con fotos que no vio al entrenar acierta el 81 % (`modelos/zapatos/reporte.json`). Las clases escolares, que tienen pocas fotos, son las más débiles.

**Reentrenar con fotos propias:** es lo que más mejora el reconocimiento de sus zapatos reales.

1. Pon las fotos en una carpeta con una subcarpeta por clase. El nombre de cada subcarpeta debe ser la etiqueta exacta. Por defecto se usa `entrenamiento-ia/` dentro del proyecto (no se versiona) y, si no existe, `../entrenamiento-ia`.
2. Ejecuta:
   ```bash
   npm run entrenar:modelo -- "<carpeta de fotos>" "<carpeta para fotos de prueba>"
   ```
3. Abre http://localhost:8090 en Chrome y espera a que diga «Listo».

El script:

- usa la misma librería que la app;
- reserva el 20 % de cada clase para medir el acierto, apartando juntas las fotos casi idénticas;
- respalda el modelo anterior en `modelos-respaldo/<fecha>/` antes de guardar;
- guarda el modelo en `modelos/zapatos/`;
- copia a la carpeta de prueba las fotos que reconoce con más seguridad.

**Alternativa en la web de Teachable Machine:**

1. En Teachable Machine, crea un **proyecto de imagen** (modelo estándar).
2. Crea una clase por zapato, con el nombre **exacto** del producto. Para el demo:
   - `Escolar Clásico`
   - `Escolar Velcro`
   - `Deportivo Runner`
   - `Zapato de Vestir Oxford`
   - `Mocasín Casual`
   - `Bota de Trabajo`
3. Crea también la clase `Fondo y otros`, con fotos de la mesa vacía, manos y otros objetos. Todo nombre que empiece por «Fondo» se trata como fondo.
4. Toma entre 50 y 100 fotos por clase, desde varios ángulos, a distintas distancias y con distinta luz.
5. Pulsa **Entrenar** y prueba la vista previa.
6. Ve a **Exportar modelo → Subir (enlace compartible)** y copia el enlace (`https://teachablemachine.withgoogle.com/models/XXXX/`).
7. Pon ese enlace en `DEFAULT_MODEL`, en `js/classifier/model.js`, y agrega el identificador anterior a `LEGACY_MODELS`. Para probar en un solo dispositivo sin tocar el código: Almacén → Ajustes → URL de otro modelo.
8. Si una clase tiene otro nombre, vincúlala desde **Panel → Productos → (producto) → Datos → Etiqueta del modelo**. La lista se lee del modelo.

**Probar el modelo con los zapatos reales:** sigue la prueba de [GUION-RECORRIDO.md §3.2](GUION-RECORRIDO.md). Cada respuesta del personal («Sí, es correcto» o «No, es otro producto») queda en Panel → Reportes → Reconocimiento IA (necesita la migración `0004_escaneos_ia.sql`). Ese reporte muestra el acierto por clase y qué clases se confunden: esas son las que hay que reforzar con fotos nuevas.

Las clases que no estén vinculadas muestran «La etiqueta … no está vinculada a ningún producto». Así se comprueba que la búsqueda funciona aunque el modelo aún no tenga zapatos.

## 7. Analítica de la tienda (panel tipo Smartlook)

Panel → **Analítica** muestra cómo navegan los clientes. No usa IA. Necesita la migración `0005_analitica.sql`.

| Sección | Qué muestra |
| --- | --- |
| Tablero | Visitantes, sesiones, páginas, duración, rebote, conversión, furia y errores, comparados con el período anterior. Visitas por día, embudo de compra, dispositivos, navegadores, sistemas, fuentes y páginas. Las tarjetas se eligen con «Personalizar». |
| Sesiones y grabaciones | Lista con filtros: navegador, sistema, fuente, URL visitada (admite `*`), hizo / no hizo un evento, pedido, furia, errores, identificadas, con grabación, duración y páginas. Los filtros se guardan como **segmentos**. Cada sesión se reproduce con su línea de tiempo, su información y notas. |
| Mapas de calor | Clics, movimiento del ratón, desplazamiento y clics de furia, dibujados sobre la página real, por dispositivo. |
| Eventos | Eventos automáticos, de la tienda (vio un producto, agregó al carrito, checkout, pedido, búsqueda, inicio de sesión, registro) y **definidos por el admin** (URL, texto de un botón o selector CSS). Los definidos se aplican también al historial. |
| Embudos | Pasos en orden dentro de la sesión: conversión, abandono, tiempo entre pasos y conversión por dispositivo. Desde cada paso se abren las sesiones que abandonaron. |
| Recorridos | Flujo de páginas paso a paso y los recorridos más comunes. |
| Retención | Cohortes por la primera visita, por semana o por día. |
| Visitantes | Un visitante es un navegador; se identifica cuando inicia sesión. Cada uno tiene su perfil con sus sesiones. |
| Errores y frustración | Errores de JavaScript y clics de furia, agrupados y ordenados por cuántas sesiones afectan. |
| Ajustes | Activar o desactivar la medición y la grabación, el tiempo de retención y el borrado de datos viejos. |

**Privacidad:**

- La tienda pide permiso con un aviso. Quien lo rechaza no se mide.
- La opción se puede cambiar desde «Privacidad y analítica», al pie de la página.
- En las grabaciones se ocultan siempre los campos de formulario y el texto de «Mi cuenta», «Mis pedidos» y el checkout. Otra zona se oculta con la clase `an-enmascarar` (texto oculto) o `an-bloquear` (no se graba).
- Solo los administradores ven estos datos.

**Grabación:** usa [rrweb](https://github.com/rrweb-io/rrweb), cargado desde jsDelivr.

## 8. Pruebas

```bash
npm run test:db        # migraciones y permisos en PostgreSQL en memoria (no necesita Docker)
npm run test:duda      # regla de duda del escáner con lecturas simuladas (no necesita cámara)
npm run test:almacen   # API del almacenero contra el Supabase local (necesita `supabase start`)
```

`test:almacen` hace las mismas llamadas que la herramienta de almacén:

- inicio de sesión;
- producto por etiqueta de la cámara;
- existencias;
- entrada y salida;
- rechazos por stock insuficiente, falta de motivo y ajuste sin ser admin;
- conteo;
- aislamiento del cliente.

Deja el stock como estaba: la entrada se compensa con una salida y el conteo se anula. Los movimientos de prueba quedan en el historial, que es inmutable, con el motivo «Prueba automática».

## 9. Proyecto Supabase en la nube

1. Aplica las migraciones en orden, con `npx supabase link` y `npx supabase db push`, o pega en el SQL Editor:
   - `0001_esquema_inicial.sql`
   - `0002_tienda_variantes_almacenes.sql`
   - `0003_mercado_calzado.sql`
2. Carga los datos del Excel pegando `supabase/seed/03_mercado_manaco.sql` en el SQL Editor. Es idempotente: reemplaza los registros de España.
3. **No** cargues `01_usuarios.sql` ni `02_catalogo_demo.sql` en producción.
4. Crea el primer administrador:
   - registra la cuenta desde la tienda y confirma el correo;
   - en el SQL Editor ejecuta:
     ```sql
     insert into public.perfiles (id, nombre, rol)
     select id, 'Administrador', 'admin' from auth.users where email = 'tu-correo@ejemplo.com';
     ```
   - el resto de los roles se asigna desde Panel → Usuarios y roles.
5. Configura la app:
   - **Sin Docker:** copia `js/config.example.js` como `js/config.js` con la URL y la clave **pública**.
   - **Con Docker:** copia `.env.example` como `.env` y ejecuta `docker compose up -d --build`.
6. En Supabase → Authentication → URL Configuration, pon la URL del sitio y las redirecciones.

## 10. Problemas frecuentes

| Síntoma | Causa y solución |
| --- | --- |
| `failed to connect to the docker API` | Docker Desktop está cerrado: ábrelo y espera a que diga «Engine running». |
| «Base de datos sin configurar» | Abriste los HTML sin `npm run dev:local`, o falta `js/config.js`. |
| `npm run dev:local` dice que Supabase no está en marcha | Ejecuta `npx supabase start`. |
| La cámara no abre | El navegador necesita permiso de cámara, y la página debe estar en `localhost` o en HTTPS. |
| El almacenero no ve productos al escanear | La clase del modelo no coincide con ninguna `etiqueta_clasificador` (sección 6, paso 8). |
