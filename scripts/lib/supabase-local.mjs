// URL y clave PÚBLICA del Supabase local (`npx supabase start`), leídas de `supabase status -o env`.
// Lo usan scripts/dev-local.mjs y scripts/probar-almacen.mjs. Nunca devuelve una clave secreta.
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** @returns {{ url: string, key: string, status: Record<string, string> }} o termina el proceso con un mensaje. */
export function supabaseLocal() {
  let status;
  try {
    const out = execSync('npx supabase status -o env', { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    status = Object.fromEntries(out.split(/\r?\n/).map(l => l.match(/^([A-Z_]+)="?(.*?)"?$/)).filter(Boolean).map(m => [m[1], m[2]]));
  } catch {
    console.error('El Supabase local no está en marcha. Ejecuta primero: npx supabase start');
    process.exit(1);
  }
  const url = status.API_URL;
  const key = status.PUBLISHABLE_KEY || status.ANON_KEY;
  if (!url || !key || /^sb_secret_/.test(key)) { console.error('No se pudo leer la URL o la clave pública local.'); process.exit(1); }
  return { url, key, status };
}
