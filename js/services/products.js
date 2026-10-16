/* Acceso a public.productos (solo lectura en esta fase). */
import { db } from '../supabase.js';

const COLS = 'id, nombre, etiqueta_clasificador, precio, stock_minimo, estado';

export async function listProducts() {
  const { data, error } = await db().from('productos').select(COLS).order('nombre');
  if (error) throw error;
  return data;
}

/** Producto vinculado a una etiqueta del clasificador, o null si no hay ninguno. */
export async function findByLabel(label) {
  const { data, error } = await db().from('productos')
    .select(COLS + ', inventario(cantidad)')
    .eq('etiqueta_clasificador', label).maybeSingle();
  if (error) throw error;
  return data;
}
