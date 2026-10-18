/* ------------------------------------------------------------------ *
 * Configuración de ejemplo. Cópiala como `js/config.js` y completa los
 * valores de tu proyecto (Supabase → Project Settings → API).
 * `js/config.js` está en .gitignore: no lo subas al repositorio.
 *
 * SOLO va aquí la clave PÚBLICA del cliente:
 *   - «Publishable key» (sb_publishable_…)  o
 *   - la «anon public» key (JWT con role "anon") en proyectos antiguos.
 * NUNCA pongas la «secret key» (sb_secret_…) ni la «service_role»: dan
 * acceso total sin RLS. La app se niega a arrancar si detecta una.
 * ------------------------------------------------------------------ */
export default {
  SUPABASE_URL: '',              // p. ej. https://abcdefghijkl.supabase.co
  SUPABASE_PUBLISHABLE_KEY: '',  // p. ej. sb_publishable_…

  // Presentación de la tienda (no son datos de negocio de la base)
  TIENDA_NOMBRE: 'Tienda de calzado',
  MONEDA: 'Bs',
};
