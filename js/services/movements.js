/* ------------------------------------------------------------------ *
 * Movimientos de inventario.
 * El cliente nunca escribe directamente en `inventario` ni `movimientos`:
 * toda entrada o salida pasa por la función atómica `registrar_movimiento`
 * (ver supabase/migrations), que impide stock negativo y deja el registro.
 * ------------------------------------------------------------------ */
import { db } from '../supabase.js';
import { deviceId } from '../prefs.js';

export async function listMovements(limit = 50) {
  const { data, error } = await db().from('movimientos')
    .select('id, tipo, cantidad, origen, dispositivo, creado_en, productos(nombre), perfiles(nombre)')
    .order('creado_en', { ascending: false }).limit(limit);
  if (error) throw error;
  return data;
}

/**
 * Registra una entrada o salida. Pensado para usarse SOLO tras una
 * confirmación explícita del usuario (todavía no está conectado a la interfaz).
 * @param {{productoId: string, tipo: 'entrada'|'salida', cantidad: number, origen?: 'manual'|'camara'}} m
 */
export async function registerMovement({ productoId, tipo, cantidad, origen = 'manual' }) {
  const { data, error } = await db().rpc('registrar_movimiento', {
    p_producto_id: productoId, p_tipo: tipo, p_cantidad: cantidad, p_origen: origen, p_dispositivo: deviceId(),
  });
  if (error) throw error;
  return data;
}
