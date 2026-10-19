/* ------------------------------------------------------------------ *
 * Prepara la carpeta www/ para Capacitor (Android).
 * La app móvil abre directamente la HERRAMIENTA DE ALMACÉN (index.html de
 * www = almacen.html). El panel queda accesible desde la cuenta del admin.
 *
 * Usa js/config.js (copia de js/config.example.js con valores PÚBLICOS).
 * Uso: npm run build:www
 * ------------------------------------------------------------------ */
import { cpSync, rmSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const OUT = 'www';
if (!existsSync('js/config.js')) {
  console.warn('AVISO: falta js/config.js. La app se generará SIN conexión a Supabase (mostrará «Base de datos sin configurar»).');
}
const cfg = existsSync('js/config.js') ? readFileSync('js/config.js', 'utf8') : '';
if (/sb_secret_|service_role/.test(cfg)) {
  console.error('js/config.js parece contener una clave secreta. Usa solo la publishable/anon.');
  process.exit(1);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT);
for (const f of ['almacen.html', 'admin.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png']) cpSync(f, `${OUT}/${f}`);
cpSync('css', `${OUT}/css`, { recursive: true });
cpSync('js', `${OUT}/js`, { recursive: true });
cpSync('modelos', `${OUT}/modelos`, { recursive: true });   // modelo de la cámara (sin depender de Google)
// Punto de entrada de la app = herramienta de almacén
writeFileSync(`${OUT}/index.html`, readFileSync('almacen.html', 'utf8'));
console.log('www/ listo (inicio: herramienta de almacén).');
