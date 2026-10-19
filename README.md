<div align="center">

# 👟 Inventario IA

**Tienda en línea + inventario inteligente con cámara para una empresa de calzados**

![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)
![TensorFlow](https://img.shields.io/badge/TensorFlow.js-FF6F00?style=for-the-badge&logo=tensorflow&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-3FCF8E?style=for-the-badge&logo=supabase&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)
![Nginx](https://img.shields.io/badge/Nginx-009639?style=for-the-badge&logo=nginx&logoColor=white)
![Capacitor](https://img.shields.io/badge/Capacitor-119EFF?style=for-the-badge&logo=capacitor&logoColor=white)

</div>

---

## 🧰 Stack

| Frontend | IA | Backend | Móvil | Infraestructura |
|:---:|:---:|:---:|:---:|:---:|
| HTML + CSS + JS | TensorFlow.js + Teachable Machine | Supabase (PostgreSQL + Auth + Storage) | Capacitor (Android) | Docker + Nginx |

---

## 🐳 Opción 1 — Docker

Desde la raíz del proyecto:

```bash
docker compose up -d --build
```

| Módulo | URL |
|---|---|
| 🛍️ Tienda | http://localhost:8088 |
| 📦 Almacén (escáner) | http://localhost:8088/almacen.html |
| ⚙️ Panel admin | http://localhost:8088/admin.html |

> Requiere Docker Desktop abierto y el archivo `.env` (copiar desde `.env.example` con la URL y la clave **pública** de Supabase).

---

## 💻 Opción 2 — Sin Docker

```bash
cp js/config.example.js js/config.js   # poner la URL y la clave pública de Supabase
npx serve .
```

> La base de datos se crea una sola vez con `supabase/migrations/0001…` y `0002…` (ver la [guía completa](docs/GUIA.md)).

---

## 👥 Roles

| Rol | Qué hace |
|---|---|
| 👑 Admin | Todo: catálogo, existencias, pedidos, usuarios y reportes |
| 📦 Almacenero | Escáner, entradas, salidas, devoluciones, conteos e historial |
| 🛒 Cliente | Catálogo, carrito y sus propios pedidos |

---

## 🔑 Usuarios de prueba

| Rol | Usuario | Contraseña | Entra en |
|---|---|---|---|
| 👑 Admin | `admin@tienda.bo` | `admin123` | `/admin.html` |
| 📦 Almacenero | `almacenero@tienda.bo` | `almacenero123` | `/almacen.html` |
| 🛒 Cliente | `cliente@tienda.bo` | `cliente123` | Tienda → Mi cuenta |



---

📘 Más detalles: [Guía completa](docs/GUIA.md) · [Seguridad y permisos](docs/SEGURIDAD.md)
