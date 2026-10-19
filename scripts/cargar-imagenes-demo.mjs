// Sube las fotos del catálogo DEMO (supabase/seed/imagenes) al Storage del Supabase LOCAL y las vincula
// a su producto y color, igual que Panel → Productos → Imágenes: inicia sesión como el admin de prueba,
// sube al bucket «productos» y crea la fila en producto_imagenes (RLS y políticas de Storage aplican).
// Idempotente: la ruta es fija (<producto_id>/<archivo>) y no se duplica si ya está vinculada.
// Uso: npx supabase start  →  npm run seed:imagenes   (repetir después de `npx supabase db reset`)
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { ROOT, supabaseLocal } from './lib/supabase-local.mjs';

const { url, key } = supabaseLocal();
const DIR = join(ROOT, 'supabase', 'seed', 'imagenes');
const ADMIN = ['admin@tienda.bo', 'admin123'];   // cuenta de prueba de supabase/seed/01_usuarios.sql (solo local)
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

const r = await fetch(`${url}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: ADMIN[0], password: ADMIN[1] }) });
const sesion = await r.json();
if (!r.ok) { console.error(`No se pudo iniciar sesión como ${ADMIN[0]}: ${sesion.msg || r.status}. ¿Se cargó el seed?`); process.exit(1); }
const auth = { apikey: key, Authorization: `Bearer ${sesion.access_token}` };
async function rest(path, opts = {}) {
  const res = await fetch(`${url}/rest/v1/${path}`, { ...opts, headers: { ...auth, 'Content-Type': 'application/json', Prefer: 'return=representation', ...opts.headers } });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${path}: ${data?.message || res.status}`);
  return data;
}

const items = JSON.parse(await readFile(join(DIR, 'imagenes.json'), 'utf8'));
const productos = await rest('productos?select=id,nombre');
const colores = await rest('colores?select=id,nombre');
const existentes = new Set((await rest('producto_imagenes?select=ruta')).map(i => i.ruta));
const orden = new Map();
let subidas = 0, omitidas = 0, fallidas = 0;

for (const it of items) {
  const prod = productos.find(p => p.nombre === it.producto);
  const color = colores.find(c => c.nombre === it.color);
  if (!prod) { console.log(`  ✘ ${it.archivo}: no existe el producto «${it.producto}»`); fallidas++; continue; }
  const ruta = `${prod.id}/${it.archivo}`;
  const n = orden.get(prod.id) ?? 0; orden.set(prod.id, n + 1);
  if (existentes.has(ruta)) { console.log(`  · ${it.archivo}: ya estaba vinculada`); omitidas++; continue; }
  try {
    const cuerpo = await readFile(join(DIR, it.archivo));
    const up = await fetch(`${url}/storage/v1/object/productos/${ruta}`, { method: 'POST', headers: { ...auth, 'Content-Type': MIME[extname(it.archivo).toLowerCase()] }, body: cuerpo });
    // Sin upsert: la política de Storage (0002) da INSERT al admin, y el upsert exigiría también SELECT.
    // Si el archivo quedó de una corrida anterior sin su fila, se reutiliza.
    if (!up.ok) {
      const msg = (await up.json().catch(() => ({}))).message || String(up.status);
      if (!/already exists/i.test(msg)) throw new Error(`Storage: ${msg}`);
    }
    await rest('producto_imagenes', { method: 'POST', body: JSON.stringify({ producto_id: prod.id, ruta, color_id: color?.id ?? null, alt: it.alt, orden: n }) });
    console.log(`  ✔ ${it.archivo} → ${it.producto}${color ? ' · ' + color.nombre : ''}`); subidas++;
  } catch (e) { console.log(`  ✘ ${it.archivo}: ${e.message}`); fallidas++; }
}
console.log(`\n${subidas} subidas, ${omitidas} ya estaban, ${fallidas} con error. Créditos: supabase/seed/imagenes/CREDITOS.md`);
process.exit(fallidas ? 1 : 0);
