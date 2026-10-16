/* ------------------------------------------------------------------ *
 * Cliente de Supabase. Lee `js/config.js` (no versionado); si falta o está
 * incompleto, la app funciona sin base de datos y lo indica en pantalla.
 * ------------------------------------------------------------------ */

/** Detecta claves privilegiadas que nunca deben llegar al navegador. */
function isPrivilegedKey(key) {
  if (key.startsWith('sb_secret_')) return true;
  const parts = key.split('.');
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.role === 'service_role';
  } catch (_) { return false; }
}

/**
 * @returns {Promise<{client: object|null, status: 'ok'|'no-config'|'no-lib'|'unsafe-key'|'bad-url'}>}
 */
export async function initSupabase() {
  let cfg = null;
  try { cfg = (await import('./config.js')).default; } catch (_) { /* sin config.js */ }
  const url = (cfg && cfg.SUPABASE_URL || '').trim();
  const key = (cfg && (cfg.SUPABASE_PUBLISHABLE_KEY || cfg.SUPABASE_ANON_KEY) || '').trim();

  if (!url || !key) return { client: null, status: 'no-config' };
  if (isPrivilegedKey(key)) {
    console.error('config.js contiene una clave privilegiada. Usa solo la clave pública (publishable/anon).');
    return { client: null, status: 'unsafe-key' };
  }
  if (!/^https:\/\/.+/i.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(url)) return { client: null, status: 'bad-url' };
  if (!window.supabase || !window.supabase.createClient) return { client: null, status: 'no-lib' };

  client = window.supabase.createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return { client, status: 'ok' };
}

let client = null;
/** Cliente ya inicializado (para los servicios de datos). */
export function db() {
  if (!client) throw new Error('Supabase no está configurado');
  return client;
}
