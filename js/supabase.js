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

let client = null;
let cfg = {};

/** Configuración pública (nombre de la tienda, moneda…). */
export const appConfig = () => cfg;

/**
 * @returns {Promise<{client: object|null, status: 'ok'|'no-config'|'no-lib'|'unsafe-key'|'bad-url'}>}
 */
export async function initSupabase() {
  try { cfg = (await import('./config.js')).default || {}; } catch (_) { cfg = {}; }
  const url = (cfg.SUPABASE_URL || '').trim();
  const key = (cfg.SUPABASE_PUBLISHABLE_KEY || cfg.SUPABASE_ANON_KEY || '').trim();

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

/** Cliente ya inicializado (para los servicios de datos). */
export function db() {
  if (!client) throw new Error('Supabase no está configurado');
  return client;
}

/** Lanza el error de una respuesta de Supabase o devuelve sus datos. */
export function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}

/** Mensajes para cuando la base no está disponible. */
export const DB_MSG = {
  'no-config': { icon: 'plug', title: 'Base de datos sin configurar', text: 'Copia js/config.example.js como js/config.js y completa la URL y la clave pública de tu proyecto de Supabase.' },
  'unsafe-key': { icon: 'alert', kind: 'err', title: 'Clave no permitida', text: 'js/config.js contiene una clave secreta o service_role. Reemplázala por la clave pública (publishable o anon) y rota la clave expuesta en Supabase.' },
  'bad-url': { icon: 'alert', kind: 'err', title: 'URL de Supabase no válida', text: 'Revisa SUPABASE_URL en js/config.js: debe empezar por https://.' },
  'no-lib': { icon: 'alert', kind: 'err', title: 'No se pudo cargar Supabase', text: 'La librería no se descargó. Revisa tu conexión a internet y recarga la página.' },
};
