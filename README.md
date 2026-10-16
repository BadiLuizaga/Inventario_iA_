# Inventario inteligente

Aplicación web de inventario para una tienda. Identifica productos con la cámara (modelo de **Teachable Machine** y **TensorFlow.js**) y consulta las existencias en una base de datos compartida (**Supabase / PostgreSQL**) desde varios dispositivos.

> **Fase 1 — base del proyecto.** La app arranca **vacía**: no hay productos, usuarios, existencias ni movimientos precargados, y no existe ningún script que los inserte.

## Stack

| Pieza | Tecnología |
|---|---|
| Interfaz | HTML, CSS y JavaScript (módulos ES, sin compilación) |
| IA | TensorFlow.js 1.3.1 y @teachablemachine/image 0.8.5. Es el mismo modelo del clasificador original |
| API y base de datos | Supabase (PostgreSQL), supabase-js 2.45.4 |
| Autenticación | Supabase Auth (correo y contraseña) |
| Móvil | Web adaptable con manifiesto PWA (sin service worker todavía) |

## Estructura

```
index.html                 Estructura de las pantallas
manifest.webmanifest       Manifiesto PWA (original)
icon-*.png                 Íconos (originales)
css/styles.css             Estilos y tokens de tema claro/oscuro
js/
  app.js                   Arranque, navegación, ajustes, sesión
  config.example.js        Plantilla de configuración → copiar a js/config.js
  supabase.js              Cliente de Supabase (rechaza claves privilegiadas)
  auth.js                  Inicio y cierre de sesión, perfil
  prefs.js                 Preferencias locales del dispositivo (no guarda stock)
  ui.js                    Utilidades de interfaz y estados vacíos
  views.js                 Panel, catálogo, existencias e historial
  classifier/
    engine.js              CountEngine original (detección estable), sin cambios de lógica
    model.js               Carga del modelo de Teachable Machine
    scanner.js             Cámara, bucle de predicción y visor
  services/
    products.js            Lectura de productos y búsqueda por etiqueta
    inventory.js           Lectura de existencias
    movements.js           Lectura del historial y envoltorio de registrar_movimiento
supabase/migrations/
  0001_esquema_inicial.sql Esquema, funciones y RLS (sin datos)
docs/SEGURIDAD.md          Permisos, roles y configuración pendiente
.env.example               Referencia de variables (sin secretos)
```

## Instalación y ejecución

No hace falta instalar dependencias: las librerías se cargan desde jsDelivr con versiones fijas.

1. **Servir la carpeta por HTTP.** No funciona abriendo el archivo con `file://`, porque usa módulos ES y la cámara exige `https` o `localhost`. Cualquiera de estos comandos sirve:
   ```bash
   npx serve .            # o
   python -m http.server 8080
   ```
   Luego abre `http://localhost:8080` (o el puerto que indique el comando).
2. **Usarla desde un teléfono.** La cámara requiere **HTTPS**. Publica la carpeta en un hosting estático (GitHub Pages, Netlify, Vercel, Cloudflare Pages) o usa un túnel HTTPS (por ejemplo, `ngrok http 8080`).

Sin configurar Supabase, la app arranca igual: el escáner funciona y las pantallas de datos indican «Base de datos sin configurar».

## Configurar Supabase (requiere credenciales externas)

1. Crea un proyecto en <https://supabase.com>.
2. **SQL Editor** → pega y ejecuta `supabase/migrations/0001_esquema_inicial.sql`. Si usas la CLI, basta con `supabase link` y `supabase db push`.
3. Copia `js/config.example.js` como `js/config.js` y completa:
   - `SUPABASE_URL`: Project Settings → API → Project URL.
   - `SUPABASE_PUBLISHABLE_KEY`: la **publishable key** (`sb_publishable_…`) o, en proyectos antiguos, la **anon public key**.
   - **Nunca** pongas la *secret key* ni la *service_role*. La app las detecta y se niega a conectar.
4. Sigue **[docs/SEGURIDAD.md → Configuración pendiente](docs/SEGURIDAD.md#configuración-pendiente-en-el-panel-de-supabase)**: desactivar el registro público, crear las cuentas y asignar el primer administrador.

`js/config.js` está en `.gitignore`. Si publicas en un hosting estático, súbelo junto con la app: la clave pública está pensada para ir al navegador y la protegen las políticas RLS.

## Modelo de IA

- Modelo original: `https://teachablemachine.withgoogle.com/models/3ok2iDQGD/`. Se carga en remoto y no hay archivos del modelo en el repositorio, igual que en el proyecto original.
- Las etiquetas salen del `metadata.json` del modelo y **no se modifican**. La clase de fondo («Fondo», «Vacío», «Nada»…) se detecta automáticamente.
- Se mantienen las opciones originales: cambiar de modelo desde *Ajustes → Opciones avanzadas* o con `?model=URL`, sensibilidad, cámara frontal o trasera, espejo y detalles técnicos.
- **Vínculo con productos:** el campo `productos.etiqueta_clasificador` debe coincidir exactamente con la etiqueta del modelo. Al reconocer un producto, el escáner muestra el producto vinculado y sus existencias (solo lectura).
- **La cámara nunca modifica el stock.** Las entradas y salidas se harán con `registrar_movimiento()` tras una confirmación explícita (siguiente fase).
- Si el modelo o la librería no cargan, el visor muestra un error con «Reintentar» y el resto de la app sigue funcionando.

## Cambios respecto al proyecto original

| Original | Ahora | Motivo |
|---|---|---|
| Todo en `index.html` | Separado en `css/` y `js/` (módulos) | Modularidad pedida. La lógica del clasificador se movió sin alterarla |
| La cámara sumaba o restaba stock automáticamente | Solo identifica y muestra el producto | Requisito: ningún cambio de stock sin confirmación y sin un movimiento válido |
| Stock e historial en `localStorage` (`inventario-ia:v2`) | En PostgreSQL. `localStorage` solo guarda preferencias (`inventario-ia:prefs`) | Inventario compartido entre dispositivos y sin duplicar el stock |
| Datos locales existentes | No se borran, solo se ignoran | Arranque limpio sin destruir nada |
| La cámara seguía encendida en la pestaña Inventario | Se apaga al salir del escáner | Privacidad y batería |
| WhatsApp, CSV, «Deshacer», «Empezar de cero» | Retirados por ahora | Operaban sobre datos locales. Ver la propuesta en «Pendiente» |

## Funcionalidades

### Implementadas
- Interfaz adaptable (móvil con barra inferior, escritorio con barra superior) en tema claro, oscuro o automático.
- Panel principal con el estado real de la base de datos, la sesión, el modelo de IA y el tiempo real (indicado como no implementado).
- Escáner con el clasificador original. Al reconocer un producto muestra la etiqueta y, si hay sesión, el producto vinculado.
- Catálogo, existencias e historial de solo lectura desde Supabase, con estados vacíos, de error y de «falta migración».
- Inicio y cierre de sesión con Supabase Auth y lectura del rol del perfil.
- Esquema SQL: productos, inventario, movimientos y perfiles, con restricciones, RLS, roles y la función atómica `registrar_movimiento()`.
- Protección contra claves privilegiadas en `config.js`.

### Pendientes
- **Registrar entradas y salidas** desde la interfaz: confirmación manual y desde el escáner, ya preparado en `services/movements.js → registerMovement()`.
- **Alta y edición de productos** (solo admin; RLS ya preparada).
- **Sincronización en tiempo real**: añadir `inventario` y `movimientos` a la publicación `supabase_realtime` y suscribirse con `postgres_changes`. Hoy se usa el botón «Actualizar».
- **PWA instalable sin conexión**: service worker y caché del modelo.
- Gestión de usuarios y roles desde la app.
- Ajustes de inventario (conteo físico) y corrección de movimientos con un movimiento inverso, que reemplaza a «Deshacer».
- Exportar existencias e historial a CSV y resumen por WhatsApp, reintegrados sobre los datos de Supabase.
- Fuera de alcance por ahora: ventas, reportes e importaciones masivas.
