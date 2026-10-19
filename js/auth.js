/* ------------------------------------------------------------------ *
 * Autenticación con Supabase Auth (correo y contraseña).
 * - Clientes de la tienda: pueden registrarse; la base les crea un registro
 *   en `clientes` sin ningún acceso interno.
 * - Personal (lector / operador / admin): el rol lo asigna un administrador
 *   desde el panel; nadie puede asignárselo a sí mismo.
 * ------------------------------------------------------------------ */
let sb = null;

export function initAuth(client, onChange) {
  sb = client;
  if (!sb) { onChange(null); return; }
  // Se difiere: no se deben hacer otras llamadas a Supabase dentro del callback.
  sb.auth.onAuthStateChange((event, session) => setTimeout(() => onChange(session, event), 0));
}

/** Cambia la contraseña de la sesión actual (p. ej. tras el enlace de recuperación). */
export async function updatePassword(password) {
  const { error } = await sb.auth.updateUser({ password });
  if (error) throw error;
}

export async function signIn(email, password) {
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

/** Registro de cliente. Devuelve true si la cuenta necesita confirmar el correo. */
export async function signUp(email, password, nombre) {
  const { data, error } = await sb.auth.signUp({
    email, password,
    options: { data: { nombre }, emailRedirectTo: location.origin + location.pathname },
  });
  if (error) throw error;
  return !data.session;
}

export async function resetPassword(email) {
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
  if (error) throw error;
}

export async function signOut() {
  if (sb) await sb.auth.signOut();
}

/** Perfil interno (personal). null si la cuenta no es del personal. */
export async function getStaffProfile(userId) {
  const { data, error } = await sb.from('perfiles').select('id, nombre, rol, activo').eq('id', userId).maybeSingle();
  if (error) throw error;
  return data;
}

/** Registro de cliente de la tienda (null si no existe). */
export async function getCliente(userId) {
  const { data, error } = await sb.from('clientes').select('id, nombre, telefono').eq('id', userId).maybeSingle();
  if (error) throw error;
  return data;
}

export function authErrorText(e) {
  const m = (e && e.message || '').toLowerCase();
  const code = e && e.code || '';
  if (code === 'email_address_invalid' || (m.includes('email address') && m.includes('invalid'))) return 'Ese correo no puede recibir mensajes. Usa un correo real.';
  if (code === 'email_address_not_authorized') return 'Por ahora no se pueden enviar correos a esa dirección. Avisa al administrador de la tienda.';
  if (code === 'over_email_send_rate_limit' || m.includes('email rate limit')) return 'Se enviaron demasiados correos. Espera una hora y vuelve a intentar.';
  if (m.includes('invalid login')) return 'Correo o contraseña incorrectos.';
  if (m.includes('email not confirmed')) return 'Primero confirma tu correo con el enlace que te enviamos.';
  if (m.includes('already registered') || m.includes('already been registered')) return 'Ya existe una cuenta con ese correo. Inicia sesión.';
  if (m.includes('signups not allowed') || m.includes('signup is disabled')) return 'El registro de cuentas está desactivado en este momento.';
  if (m.includes('password') && (m.includes('least') || m.includes('weak') || m.includes('short'))) return 'La contraseña es demasiado débil (mínimo 8 caracteres).';
  if (m.includes('rate limit') || m.includes('too many')) return 'Demasiados intentos. Espera unos minutos.';
  if (m.includes('fetch') || m.includes('network')) return 'No hay conexión con el servidor.';
  return 'No se pudo completar. Vuelve a intentar.';
}

export const ROL_TEXTO = { admin: 'Administrador', operador: 'Almacenero', lector: 'Lector' };
