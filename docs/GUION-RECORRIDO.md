# Guion del recorrido

Guion paso a paso para mostrar el sistema. Tiene tres partes: **cliente** (tienda), **administrador** (panel) y **almacén con cámara**, que incluye la prueba de reconocimiento de los zapatos.

Se hace sobre el **Supabase local** con los datos de demostración del seed (ver [GUIA.md §2–4](GUIA.md)). Nunca sobre el proyecto real: el recorrido crea pedidos, movimientos y escaneos.

## 0. Preparación (antes de empezar)

```bash
npx supabase start      # Docker Desktop debe estar abierto
npx supabase db reset   # opcional: deja la base como recién instalada
npm run seed:imagenes
npm run dev:local       # http://localhost:8089
```

- Abre tres pestañas en Chrome: la **tienda** (`/`), el **panel** (`/admin.html`) y el **almacén** (`/almacen.html`). Para que las sesiones no se mezclen, usa una ventana de incógnito para el cliente.
- Ten a mano los zapatos (o fotos impresas o en otra pantalla) de las 6 clases: Escolar Clásico, Escolar Velcro, Deportivo Runner, Zapato de Vestir Oxford, Mocasín Casual y Bota de Trabajo.
- Cuentas: `cliente@tienda.bo` / `cliente123`, `admin@tienda.bo` / `admin123`, `almacenero@tienda.bo` / `almacenero123`.

Duración aproximada: cliente 5 min, administrador 10 min, almacén y cámara 10 min.

---

## 1. Recorrido como cliente (tienda)

| # | Acción | Qué decir / qué mostrar |
| --- | --- | --- |
| 1 | Abre `http://localhost:8089` | Portada con categorías, novedades y sucursales. La tienda es pública: no hace falta cuenta para mirar. |
| 2 | Clic en una categoría del menú (p. ej. **Escolar**) | El catálogo se filtra por categoría. |
| 3 | Usa los filtros: talla, color, marca y **solo disponibles** | Los filtros se combinan. «Limpiar» los quita todos. |
| 4 | Busca «oxford» en la barra superior | Búsqueda por nombre. |
| 5 | Abre un producto | Fotos, precio, tallas y colores. **El stock se muestra solo como «Disponible», «Pocas unidades» o «Agotado»**: el cliente nunca ve cantidades ni almacenes. |
| 6 | Elige talla y color → **Agregar al carrito** | Una variante agotada no se puede agregar. |
| 7 | Abre el **carrito**, cambia una cantidad | El total se recalcula. |
| 8 | **Continuar con el pedido** | Sin sesión pide ingresar: el carrito se conserva. |
| 9 | **Ingresar** con `cliente@tienda.bo` | Al entrar vuelve directo al checkout. (También se puede mostrar «Crear cuenta» y «Olvidé mi contraseña»; los correos llegan a Mailpit, `http://127.0.0.1:54324`.) |
| 10 | Completa los datos y **confirma el pedido** | Pantalla de pedido realizado. No hay pago en línea: el pedido queda «Pendiente» y las unidades quedan reservadas para que nadie más las compre. |
| 11 | **Mis pedidos** | El cliente ve solo sus pedidos y su estado. Deja esta pestaña abierta: el estado cambiará en el paso 2.5. |
| 12 | **Sucursales** | Direcciones y horarios. |

**Mensaje clave:** el cliente compra con información de disponibilidad, pero los datos internos (cantidades, almacenes, costos) nunca salen del sistema.

---

## 2. Recorrido como administrador (panel)

| # | Acción | Qué decir / qué mostrar |
| --- | --- | --- |
| 2.1 | Abre `/admin.html` e ingresa con `admin@tienda.bo` | Solo entra el rol administrador. Prueba antes con la cuenta del cliente para mostrar que se le niega el acceso. |
| 2.2 | **Resumen** | Indicadores generales y la guía de «Primeros pasos» para un sistema vacío. |
| 2.3 | **Productos** → abre «Zapato de Vestir Oxford» | Datos, fotos, variantes (talla × color), precio y **Etiqueta del modelo**: el nombre de la clase que reconoce la cámara. |
| 2.4 | Muestra **Marcas, Categorías, Tallas, Colores** | Catálogos maestros que usan los productos. |
| 2.5 | **Pedidos** → abre el pedido del paso 1.10 → **Cambiar estado** a «Confirmado» y luego «En preparación» | El stock se reservó al crear el pedido; si se cancela, vuelve al almacén. Vuelve a la pestaña del cliente y recarga «Mis pedidos»: ve el estado nuevo. |
| 2.6 | **Sucursales** y **Almacenes** | Una sucursal puede tener varios almacenes; el stock se lleva por almacén. |
| 2.7 | **Usuarios y roles** | Roles: administrador, operador (almacenero) y consulta. Un cliente no tiene rol hasta que se le da acceso. |
| 2.8 | **Reportes** (ver la sección 4) | Panel de métricas. |
| 2.8b | **Analítica → Tablero** y **Sesiones y grabaciones** | Abre la sesión del paso 1 (si el cliente aceptó el aviso) y reprodúcela: se ve su recorrido con los formularios ocultos. Muestra también **Mapas de calor** sobre la página de producto y el **Embudo** de compra. |
| 2.9 | **Configuración** | Umbrales de disponibilidad pública: a partir de cuántas unidades la tienda muestra «Pocas unidades» o «Agotado». |

**Mensaje clave:** todo el negocio se maneja desde aquí, y cada cambio de stock queda en un historial inmutable con usuario, fecha y motivo.

---

## 3. Recorrido de almacén con cámara (y prueba de la IA)

### 3.1 Recorrido

| # | Acción | Qué decir / qué mostrar |
| --- | --- | --- |
| 1 | Abre `/almacen.html`, ingresa con `almacenero@tienda.bo` y elige **Almacén Central** | Herramienta pensada para el teléfono. |
| 2 | Pestaña **Escáner** → **Activar cámara** | El modelo corre en el propio dispositivo: no envía imágenes a ningún servidor. |
| 3 | Muestra un zapato a la cámara y espera el aviso | La cámara **propone** un producto. Muestra la confianza y la segunda opción. |
| 4 | Si la propuesta es clara: **Sí, es correcto** | Se ven las existencias por talla y color. |
| 5 | Muestra un zapato de una clase débil (Escolar Velcro) | El recuadro se pone naranja y dice por qué duda («se parece a…», «confianza baja», «este modelo confunde a menudo esta clase», «podría ser…»). Hay que elegir el producto antes de seguir. |
| 6 | Pulsa **No, es otro producto** y elige el correcto en el buscador | Queda registrado como **corrección**: así se mide dónde se equivoca la IA. |
| 7 | Toca una variante → **Movimiento**: registra una entrada de 2 u. | Escanear nunca cambia el stock. La cantidad siempre la escribe y confirma una persona. |
| 8 | Pestaña **Existencias** e **Historial** | El movimiento aparece con usuario, hora y motivo. |
| 9 | Pestaña **Conteo** | Conteo físico: las diferencias se ven en el reporte «Diferencias de conteo». |

### 3.2 Prueba de reconocimiento de los zapatos

Sirve para decidir si el modelo está listo o hay que seguir entrenándolo. Cada escaneo queda guardado y se analiza en **Panel → Reportes → Reconocimiento IA**.

1. Por cada una de las 6 clases, escanea el zapato **10 veces**: de frente, de lado, desde arriba, con otra luz y a otra distancia. Con los 6 zapatos son 60 escaneos.
2. En cada propuesta responde siempre: **Sí, es correcto**, o **No, es otro producto** y elige el correcto. No dejes propuestas sin respuesta, porque no cuentan para el acierto.
3. Escanea también la mesa vacía y otros objetos: no debería proponer ningún zapato.
4. Abre **Reportes → Reconocimiento IA** con la fecha de hoy y anota:

   | Indicador | Meta para darlo por bueno |
   | --- | --- |
   | Acierto confirmado (total) | 90 % o más |
   | Acierto de cada clase | 80 % o más en todas |
   | Errores sin aviso | 0, o casi: un error sin aviso es el más peligroso porque nadie lo revisa |

5. **Si no se cumple la meta, sigue entrenando:**
   - Mira **Clases más confundidas** (p. ej. «Escolar Velcro → Deportivo Runner»).
   - Toma 30–50 fotos nuevas de **esas dos clases**, con su zapato real, en el lugar y con la luz donde se usará la cámara.
   - Agrégalas a `entrenamiento-ia/<clase>/` y reentrena: `npm run entrenar:modelo` (ver [GUIA.md §6](GUIA.md)). El modelo anterior se respalda solo en `modelos-respaldo/`.
   - Repite la prueba. Si el modelo nuevo es peor, restaura el respaldo copiándolo a `modelos/zapatos/`.

---

## 4. Panel de métricas (Reportes)

Todos los reportes tienen filtro de fechas y se descargan en CSV (abre bien en Excel).

| Reporte | Qué muestra |
| --- | --- |
| Stock actual | Existencias por producto, variante y almacén. |
| Bajo stock | Variantes en o por debajo de su mínimo. |
| Entradas y salidas | Gráfico de ingresos y egresos por día o por semana, totales por tipo y el detalle de movimientos. |
| Diferencias de conteo | Lo contado frente a lo que decía el sistema. |
| Actividad por usuario | Movimientos de cada persona del personal. |
| Pedidos y ventas | Pedidos, importe y ticket promedio; gráfico de importe por día o por semana y **productos más vendidos**. |
| **Reconocimiento IA** | Escaneos, confirmados, corregidos, descartados, **acierto confirmado**, acierto por clase, clases más confundidas y errores sin aviso. |
| Mercado Manaco | Datos de comercio exterior del Excel del caso. |

En el recorrido conviene mostrar **Pedidos y ventas** (con el pedido del paso 1), **Entradas y salidas** (con el movimiento del paso 3.1) y **Reconocimiento IA** (con los escaneos de la prueba 3.2).
