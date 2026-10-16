/* ------------------------------------------------------------------ *
 * Autenticación con Supabase Auth (correo y contraseña).
 * El registro público está pensado para estar DESACTIVADO: las cuentas las
 * crea un administrador desde el panel de Supabase (ver README).
 * ------------------------------------------------------------------ */
let sb = null;

export function initAuth(client, onChange) {
  sb = client;
  if (!sb) return;
  // Se difiere: no se deben hacer otras llamadas a Supabase dentro del callback.
  sb.auth.onAuthStateChange((_event, session) => setTimeout(() => onChange(session), 0));
}

export async function signIn(email, password) {
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signOut() {
  if (sb) await sb.auth.signOut();
}

/** Perfil y rol del usuario actual (tabla public.perfiles). */
export async function getProfile(userId) {
  const { data, error } = await sb.from('perfiles').select('id, nombre, rol, activo').eq('id', userId).maybeSingle();
  if (error) throw error;
  return data;
}

export function authErrorText(e) {
  const m = (e && e.message || '').toLowerCase();
  if (m.includes('invalid login')) return 'Correo o contraseña incorrectos.';
  if (m.includes('email not confirmed')) return 'Este correo todavía no fue confirmado.';
  if (m.includes('fetch') || m.includes('network')) return 'No hay conexión con el servidor.';
  return 'No se pudo iniciar sesión. Vuelve a intentar.';
}
