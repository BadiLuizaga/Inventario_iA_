/* ------------------------------------------------------------------ *
 * Selector de producto y variante (búsqueda manual). Muestra solo datos
 * reales; si no hay productos, lo dice. Opcionalmente muestra el stock de
 * cada variante en el almacén actual.
 * ------------------------------------------------------------------ */
import { el, debounce, errText } from '../ui.js';
import { listarProductos, variantesDe, existencias, nombreVariante } from '../services/interno.js';

/**
 * @param {{ almacenId?: () => string|null, onSelect: (producto, variante, stock) => void, placeholder?: string }} opts
 */
export function createPicker({ almacenId = () => null, onSelect, placeholder = 'Nombre, modelo o etiqueta IA' }) {
  const input = el('input', { type: 'search', placeholder, autocomplete: 'off', 'aria-label': 'Buscar producto' });
  const results = el('div', { class: 'pick-results', 'aria-live': 'polite' });
  const box = el('div', { class: 'picker' }, el('div', { class: 'field', style: 'margin:0' }, input), results);
  let seq = 0;

  async function search() {
    const q = input.value.trim();
    const my = ++seq;
    if (q.length < 2) { results.replaceChildren(q ? el('p', { class: 'msg', text: 'Escribe al menos 2 letras.' }) : ''); return; }
    results.replaceChildren(el('p', { class: 'msg', text: 'Buscando…' }));
    try {
      const rows = await listarProductos({ q, limit: 30 });
      if (my !== seq) return;
      if (!rows.length) { results.replaceChildren(el('p', { class: 'msg', text: 'No hay productos registrados que coincidan. Un administrador puede registrarlo desde el panel.' })); return; }
      results.replaceChildren(el('ul', { class: 'pick-list' }, ...rows.map(p => el('li', {},
        el('button', { type: 'button', class: 'pick-item', onclick: () => showProduct(p) },
          el('strong', { text: p.nombre }),
          el('span', { class: 'muted', text: [p.modelo, p.marcas?.nombre, p.estado !== 'activo' ? 'inactivo' : ''].filter(Boolean).join(' · ') || 'Sin modelo' }))))));
    } catch (e) { if (my === seq) results.replaceChildren(el('p', { class: 'msg err', text: errText(e) })); }
  }

  async function showProduct(p) {
    results.replaceChildren(el('p', { class: 'msg', text: 'Cargando variantes…' }));
    try {
      const vars = await variantesDe(p.id);
      const aid = almacenId();
      const stock = aid && vars.length ? await existencias({ almacenId: aid, productoId: p.id }) : [];
      const byVar = new Map(stock.map(s => [s.variante_id, s]));
      const back = el('button', { type: 'button', class: 'btn small ghost', text: '← Otros productos', onclick: search });
      if (!vars.length) { results.replaceChildren(back, el('p', { class: 'msg', text: `«${p.nombre}» no tiene variantes (talla/color) registradas. Un administrador debe crearlas.` })); return; }
      results.replaceChildren(back, el('p', { style: 'font-weight:700; margin:6px 0', text: p.nombre }),
        el('div', { class: 'var-grid' }, ...vars.map(v => {
          const s = byVar.get(v.id);
          return el('button', { type: 'button', class: 'var-btn' + (v.activo ? '' : ' off'), onclick: () => onSelect(p, v, s || null) },
            el('span', { text: nombreVariante(v) }),
            el('small', { text: aid ? `${s ? s.cantidad : 0} u.` : (v.sku || '') }));
        })));
    } catch (e) { results.replaceChildren(el('p', { class: 'msg err', text: errText(e) })); }
  }

  input.addEventListener('input', debounce(search, 300));
  return { el: box, showProduct, focus: () => input.focus(), clear: () => { input.value = ''; results.replaceChildren(); } };
}
