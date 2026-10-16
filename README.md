# Inventario inteligente

App web de inventario que identifica productos con la cámara y guarda las existencias en una base de datos compartida.

## Tecnologías

- **HTML, CSS y JavaScript** (módulos ES, sin compilación).
- **TensorFlow.js + Teachable Machine**: reconocimiento de productos con la cámara.
- **Supabase (PostgreSQL)**: base de datos, autenticación y permisos (RLS).

## Requisitos

- Node.js (para `npx`) o Python 3.
- Una cuenta en [Supabase](https://supabase.com).

No hay dependencias que instalar: las librerías se cargan desde CDN.

## Levantar el proyecto

1. **Clonar el repositorio**
   ```bash
   git clone https://github.com/BadiLuizaga/Inventario_iA_.git
   cd Inventario_iA_
   ```

2. **Crear la base de datos**
   - Crea un proyecto en Supabase.
   - En **SQL Editor**, ejecuta `supabase/migrations/0001_esquema_inicial.sql`.

3. **Configurar credenciales**
   ```bash
   cp js/config.example.js js/config.js
   ```
   Completa en `js/config.js`:
   - `SUPABASE_URL`: Project Settings → API → Project URL.
   - `SUPABASE_PUBLISHABLE_KEY`: la *publishable* o *anon* key (nunca la *service_role*).

4. **Iniciar el servidor**
   ```bash
   npx serve . -l 8080
   # o
   python -m http.server 8080
   ```
   Abre `http://localhost:8080` en el navegador.

> Para usar la cámara desde un teléfono se necesita **HTTPS** (por ejemplo, GitHub Pages, Netlify o `ngrok http 8080`).
