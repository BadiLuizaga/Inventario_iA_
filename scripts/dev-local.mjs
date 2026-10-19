// Desarrollo y pruebas con el Supabase LOCAL (Docker, `npx supabase start`).
// Sirve el sitio en http://localhost:8089 y entrega /js/config.js generado en memoria
// con la URL y la clave PÚBLICA del entorno local. No escribe archivos ni toca el proyecto real.
// Uso: npm run dev:local
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { ROOT, supabaseLocal } from './lib/supabase-local.mjs';

const PORT = Number(process.env.DEV_PORT) || 8089;
const { url, key, status } = supabaseLocal();

const CONFIG = `/* Generado por scripts/dev-local.mjs: Supabase LOCAL (solo desarrollo). */
export default { SUPABASE_URL: ${JSON.stringify(url)}, SUPABASE_PUBLISHABLE_KEY: ${JSON.stringify(key)}, TIENDA_NOMBRE: 'Tienda de calzado (LOCAL)', MONEDA: 'Bs' };
`;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.bin': 'application/octet-stream' };
const PRIVADO = /^\/(\.|node_modules\/|android\/|supabase\/|scripts\/|docker\/|www\/|package|compose|Dockerfile)/;

createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/js/config.js') { res.writeHead(200, { 'Content-Type': TYPES['.js'], 'Cache-Control': 'no-store' }).end(CONFIG); return; }
  if (PRIVADO.test(path)) { res.writeHead(404).end('404'); return; }
  if (path.endsWith('/')) path += 'index.html';
  const file = normalize(join(ROOT, path));
  if (!file.startsWith(normalize(ROOT))) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(body);
  } catch { res.writeHead(404).end('404'); }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`App LOCAL: http://localhost:${PORT}  (tienda)  ·  /almacen.html  ·  /admin.html`);
  console.log(`Supabase local: ${url}  ·  correos de prueba (Mailpit): ${status.MAILPIT_URL || status.INBUCKET_URL || 'http://127.0.0.1:54324'}`);
});
