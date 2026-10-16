/* Acceso a public.inventario (existencias). La tabla es de solo lectura para el cliente. */
import { db } from '../supabase.js';

export async function listInventory() {
  const { data, error } = await db().from('inventario')
    .select('producto_id, cantidad, actualizado_en, productos!inner(nombre, etiqueta_clasificador, stock_minimo, estado)');
  if (error) throw error;
  return data.sort((a, b) => a.productos.nombre.localeCompare(b.productos.nombre, 'es'));
}
