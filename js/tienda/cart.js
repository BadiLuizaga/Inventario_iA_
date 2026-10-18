/* ------------------------------------------------------------------ *
 * Carrito local del visitante (solo en este navegador). No es un dato de
 * la base: el pedido real se crea con crear_pedido(), que vuelve a validar
 * precios y existencias en el servidor.
 * ------------------------------------------------------------------ */
const KEY = 'tienda:carrito';
export const MAX_POR_LINEA = 20;
export const MAX_LINEAS = 30;

let items = load();
const listeners = new Set();

function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(d) ? d.filter(i => i && typeof i.v === 'string' && Number.isInteger(i.n) && i.n > 0).slice(0, MAX_LINEAS) : [];
  } catch (_) { return []; }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(items)); } catch (_) {}
  listeners.forEach(fn => fn(items));
}

export const cartItems = () => items.map(i => ({ ...i }));
export const cartCount = () => items.reduce((s, i) => s + i.n, 0);
export const onCartChange = fn => { listeners.add(fn); fn(items); };

/** Agrega unidades. Devuelve la cantidad final de esa línea o lanza un error comprensible. */
export function addToCart(varianteId, n = 1) {
  const it = items.find(i => i.v === varianteId);
  if (!it && items.length >= MAX_LINEAS) throw new Error(`El carrito admite hasta ${MAX_LINEAS} artículos distintos.`);
  const total = (it ? it.n : 0) + n;
  if (total > MAX_POR_LINEA) throw new Error(`Puedes pedir hasta ${MAX_POR_LINEA} unidades de cada artículo.`);
  if (it) it.n = total; else items.push({ v: varianteId, n });
  save();
  return total;
}
export function setQty(varianteId, n) {
  const it = items.find(i => i.v === varianteId);
  if (!it) return;
  it.n = Math.max(1, Math.min(MAX_POR_LINEA, n | 0));
  save();
}
export function removeFromCart(varianteId) { items = items.filter(i => i.v !== varianteId); save(); }
export function clearCart() { items = []; save(); }

// Sincroniza si el carrito cambia en otra pestaña
window.addEventListener('storage', e => { if (e.key === KEY) { items = load(); listeners.forEach(fn => fn(items)); } });
