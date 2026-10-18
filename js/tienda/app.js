/* ------------------------------------------------------------------ *
 * Tienda virtual: catálogo, ficha, carrito, pedidos y cuenta del cliente.
 * Solo muestra datos reales publicados. La disponibilidad pública se limita
 * a «Disponible», «Pocas unidades» y «Agotado»: nunca cantidades.
 * ------------------------------------------------------------------ */
import { $, $$, el, icon, emptyState, loading, fmtDate, fmtMoney, setCurrency, setMsg, snack, errText, confirmDialog, dispoTag } from '../ui.js';
import { initSupabase, appConfig, DB_MSG } from '../supabase.js';
import { initAuth, signIn, signUp, signOut, resetPassword, updatePassword, getCliente, getStaffProfile, authErrorText, ROL_TEXTO } from '../auth.js';
import { cargarCatalogo, invalidarCatalogo, imagenUrl, idsCategoria, crearPedido, misPedidos, cancelarMiPedido, actualizarCliente, ESTADO_PEDIDO } from '../services/tienda.js';
import { cartItems, cartCount, onCartChange, addToCart, setQty, removeFromCart, clearCart, MAX_POR_LINEA } from './cart.js';

const ctx = { db: 'checking', session: null, cliente: null, recovery: false };
const main = $('#main');
const money = v => fmtMoney(v, true);

/* =================================================================== *
 * Utilidades de vista
 * =================================================================== */
function show(...nodes) { main.replaceChildren(...nodes); main.focus({ preventScroll: true }); window.scrollTo({ top: 0 }); }
const title = (t, sub) => el('div', {}, el('h1', { class: 'page-title', text: t }), sub ? el('p', { class: 'muted', text: sub }) : null);

function imgOrPlaceholder(ruta, alt) {
  if (!ruta) return el('div', { class: 'noimg', html: icon('shoe') + '<span>Sin imagen</span>' });
  const img = el('img', { src: imagenUrl(ruta), alt: alt || '', loading: 'lazy', decoding: 'async' });
  img.addEventListener('error', () => img.replaceWith(el('div', { class: 'noimg', html: icon('image') + '<span>Imagen no disponible</span>' })), { once: true });
  return img;
}

function priceText(p) {
  return p.precioVaria ? el('span', { class: 'price' }, el('small', { text: 'desde ' }), money(p.precioDesde)) : el('span', { class: 'price', text: money(p.precioDesde) });
}

function productCard(p) {
  return el('a', { class: 'pcard', href: `#/producto/${p.id}` },
    el('div', { class: 'media' }, imgOrPlaceholder(p.imagenes[0]?.ruta, p.imagenes[0]?.alt || p.nombre)),
    el('div', { class: 'body' },
      p.marca ? el('span', { class: 'brand-small', text: p.marca.nombre }) : null,
      el('span', { class: 'name', text: p.nombre }),
      priceText(p),
      dispoTag(p.estado)));
}

function blocker() {
  if (ctx.db !== 'ok') return emptyState(DB_MSG[ctx.db] || DB_MSG['no-config']);
  return null;
}

/** Carga el catálogo mostrando estados de carga y error. */
async function withCatalog(render) {
  const b = blocker();
  if (b) { show(b); return; }
  show(loading('Cargando catálogo…'));
  try {
    const cat = await cargarCatalogo();
    render(cat);
  } catch (e) {
    console.error(e);
    show(emptyState({ icon: 'alert', kind: 'err', title: 'No se pudo cargar el catálogo', text: errText(e),
      action: { label: 'Reintentar', onClick: () => { invalidarCatalogo(); route(); } } }));
  }
}

const NO_PRODUCTS = () => emptyState({ icon: 'shoe', title: 'Todavía no hay productos disponibles',
  text: 'Estamos preparando nuestro catálogo. Vuelve pronto para conocer los modelos disponibles.' });

/* =================================================================== *
 * Navegación de categorías
 * =================================================================== */
function buildCategoryNav(cat) {
  const tops = cat.categorias.filter(c => !c.padre_id || !cat.M.categorias.has(c.padre_id));
  const items = [el('li', {}, el('a', { href: '#/catalogo', text: 'Todo el catálogo' }))];
  for (const c of tops) {
    const kids = cat.categorias.filter(k => k.padre_id === c.id);
    items.push(el('li', {},
      el('a', { href: `#/catalogo?cat=${c.id}`, text: c.nombre }),
      kids.length ? el('div', { class: 'sub' }, ...kids.map(k => el('a', { href: `#/catalogo?cat=${k.id}`, text: k.nombre }))) : null));
  }
  $('#catList').replaceChildren(...items);
}

/* =================================================================== *
 * Inicio
 * =================================================================== */
function renderHome() {
  withCatalog(cat => {
    const nombre = appConfig().TIENDA_NOMBRE || 'Tienda de calzado';
    const intro = el('section', { class: 'intro' },
      el('h1', { text: `Bienvenido a ${nombre}` }),
      el('p', { text: 'Explora el catálogo, revisa la disponibilidad de cada talla y haz tu pedido en línea para retirarlo en tienda o recibirlo en tu dirección.' }),
      el('a', { class: 'btn', href: '#/catalogo', text: 'Ver catálogo' }));
    if (!cat.productos.length) { show(intro, el('div', { class: 'section' }, NO_PRODUCTS())); return; }

    const tops = cat.categorias.filter(c => !c.padre_id);
    const nodes = [intro];
    if (tops.length) nodes.push(el('section', { class: 'section' },
      el('div', { class: 'section-head' }, el('h2', { text: 'Categorías' })),
      el('div', { class: 'cat-tiles' }, ...tops.map(c => el('a', { class: 'cat-tile', href: `#/catalogo?cat=${c.id}` }, el('span', { text: c.nombre }), el('span', { 'aria-hidden': 'true', text: '→' }))))));
    nodes.push(el('section', { class: 'section' },
      el('div', { class: 'section-head' }, el('h2', { text: 'Novedades' }), el('a', { href: '#/catalogo', text: 'Ver todo' })),
      el('div', { class: 'grid' }, ...cat.productos.slice(0, 8).map(productCard))));
    if (cat.sucursales.length) nodes.push(el('section', { class: 'section' },
      el('div', { class: 'section-head' }, el('h2', { text: 'Nuestras sucursales' }), el('a', { href: '#/sucursales', text: 'Ver todas' })),
      branchList(cat.sucursales.slice(0, 3))));
    show(...nodes);
  });
}

/* =================================================================== *
 * Catálogo con filtros
 * =================================================================== */
function renderCatalog(params) {
  withCatalog(cat => {
    const f = {
      q: (params.get('q') || '').trim(), cat: params.get('cat') || '', marca: params.get('marca') || '',
      talla: params.get('talla') || '', color: params.get('color') || '', disp: params.get('disp') === '1', orden: params.get('orden') || 'nuevos',
    };
    $('#q').value = f.q;
    const catIds = f.cat ? idsCategoria(cat.categorias, f.cat) : null;
    const norm = s => (s || '').toLocaleLowerCase('es').normalize('NFD').replace(/[̀-ͯ]/g, '');
    const terms = norm(f.q).split(/\s+/).filter(Boolean);

    let list = cat.productos.filter(p => {
      if (catIds && !catIds.has(p.categoria_id)) return false;
      if (f.marca && p.marca_id !== f.marca) return false;
      if (terms.length) {
        const hay = norm([p.nombre, p.modelo, p.marca?.nombre, p.categoria?.nombre].join(' '));
        if (!terms.every(t => hay.includes(t))) return false;
      }
      const vs = p.variantes.filter(v => (!f.talla || v.talla_id === f.talla) && (!f.color || v.color_id === f.color));
      if ((f.talla || f.color) && !vs.length) return false;
      if (f.disp && !vs.some(v => v.estado !== 'agotado')) return false;
      return true;
    });
    const sorters = {
      nuevos: () => 0,
      precio_asc: (a, b) => a.precioDesde - b.precioDesde,
      precio_desc: (a, b) => b.precioDesde - a.precioDesde,
      nombre: (a, b) => a.nombre.localeCompare(b.nombre, 'es'),
    };
    list = [...list].sort(sorters[f.orden] || sorters.nuevos);

    const set = (k, v) => {
      const p = new URLSearchParams(params);
      if (v) p.set(k, v); else p.delete(k);
      location.hash = '#/catalogo' + (p.toString() ? '?' + p : '');
    };
    const chip = (label, active, onClick, extra = null) => el('button', { class: 'chip', type: 'button', 'aria-pressed': String(active), onclick: onClick }, extra, label);

    // Solo se ofrecen valores que realmente tienen productos publicados
    const usados = (key) => new Set(cat.productos.flatMap(p => p.variantes.map(v => v[key])).filter(Boolean));
    const tallasUsadas = usados('talla_id'), coloresUsados = usados('color_id');
    const marcasUsadas = new Set(cat.productos.map(p => p.marca_id).filter(Boolean));

    const groups = [];
    const cats = cat.categorias.filter(c => cat.productos.some(p => idsCategoria(cat.categorias, c.id).has(p.categoria_id)));
    if (cats.length) groups.push(el('div', { class: 'filter-group' }, el('strong', { text: 'Categoría' }),
      el('div', { class: 'chips' }, chip('Todas', !f.cat, () => set('cat', '')), ...cats.map(c => chip(c.nombre, f.cat === c.id, () => set('cat', f.cat === c.id ? '' : c.id))))));
    const marcas = cat.marcas.filter(m => marcasUsadas.has(m.id));
    if (marcas.length) groups.push(el('div', { class: 'filter-group' }, el('strong', { text: 'Marca' }),
      el('div', { class: 'chips' }, ...marcas.map(m => chip(m.nombre, f.marca === m.id, () => set('marca', f.marca === m.id ? '' : m.id))))));
    const tallas = cat.tallas.filter(t => tallasUsadas.has(t.id));
    if (tallas.length) groups.push(el('div', { class: 'filter-group' }, el('strong', { text: 'Talla' }),
      el('div', { class: 'chips' }, ...tallas.map(t => chip(t.nombre, f.talla === t.id, () => set('talla', f.talla === t.id ? '' : t.id))))));
    const colores = cat.colores.filter(c => coloresUsados.has(c.id));
    if (colores.length) groups.push(el('div', { class: 'filter-group' }, el('strong', { text: 'Color' }),
      el('div', { class: 'chips' }, ...colores.map(c => {
        const sw = c.hex ? el('span', { class: 'swatch', 'aria-hidden': 'true' }) : null;
        if (sw) sw.style.background = c.hex;
        return chip(c.nombre, f.color === c.id, () => set('color', f.color === c.id ? '' : c.id), sw);
      }))));
    groups.push(el('div', { class: 'filter-group' }, el('strong', { text: 'Disponibilidad' }),
      el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: f.disp, onchange: e => set('disp', e.target.checked ? '1' : '') }), 'Solo con existencias')));

    const filters = el('aside', { class: 'filters', id: 'filters', 'aria-label': 'Filtros' },
      el('div', { class: 'row between' }, el('h3', { text: 'Filtrar' }), (f.cat || f.marca || f.talla || f.color || f.disp || f.q) ? el('a', { href: '#/catalogo', text: 'Limpiar' }) : null),
      ...groups);
    const catName = f.cat && cat.M.categorias.get(f.cat)?.nombre;
    const sort = el('select', { 'aria-label': 'Ordenar', onchange: e => set('orden', e.target.value === 'nuevos' ? '' : e.target.value) },
      ...[['nuevos', 'Más recientes'], ['precio_asc', 'Precio: menor a mayor'], ['precio_desc', 'Precio: mayor a menor'], ['nombre', 'Nombre']]
        .map(([v, t]) => el('option', { value: v, text: t, selected: f.orden === v })));
    const toggle = el('button', { class: 'btn small filters-toggle', type: 'button', 'aria-controls': 'filters', 'aria-expanded': 'false', text: 'Filtros',
      onclick: e => { const o = filters.classList.toggle('open'); e.currentTarget.setAttribute('aria-expanded', String(o)); } });

    let results;
    if (!cat.productos.length) results = NO_PRODUCTS();
    else if (!list.length) results = emptyState({ icon: 'search', title: 'No encontramos productos con esos criterios', text: 'Prueba con otras palabras o quita algún filtro.', action: { label: 'Ver todo el catálogo', onClick: () => { location.hash = '#/catalogo'; } } });
    else results = el('div', { class: 'grid' }, ...list.map(productCard));

    show(
      el('div', { class: 'crumbs' }, el('a', { href: '#/', text: 'Inicio' }), ' / ', catName || (f.q ? 'Búsqueda' : 'Catálogo')),
      title(catName || (f.q ? `Resultados para «${f.q}»` : 'Catálogo')),
      el('div', { class: 'catalog', style: 'margin-top:18px' }, filters,
        el('div', {},
          el('div', { class: 'catalog-bar' }, el('span', { class: 'muted', text: `${list.length} producto${list.length === 1 ? '' : 's'}` }), el('div', { class: 'row' }, toggle, sort)),
          results)));
    $$('#catList a').forEach(a => a.toggleAttribute('aria-current', a.getAttribute('href') === `#/catalogo?cat=${f.cat}`));
  });
}

/* =================================================================== *
 * Ficha de producto
 * =================================================================== */
function renderProduct(id) {
  withCatalog(cat => {
    const p = cat.productos.find(x => x.id === id);
    if (!p) { show(emptyState({ icon: 'search', title: 'Producto no disponible', text: 'Este producto no existe o ya no está publicado.', action: { label: 'Ver catálogo', onClick: () => { location.hash = '#/catalogo'; } } })); return; }
    document.title = `${p.nombre} · ${appConfig().TIENDA_NOMBRE || 'Tienda'}`;

    const colores = [...new Map(p.variantes.map(v => [v.color_id || '', v.color])).entries()];
    let selColor = colores.length ? colores[0][0] : '';
    let selVar = null;
    let qty = 1;

    const gallery = el('div', { class: 'gallery' });
    const colorBox = el('div', { class: 'stack' });
    const sizeBox = el('div', { class: 'stack' });
    const priceEl = el('div', { class: 'price big-price' });
    const stateEl = el('div');
    const msg = el('p', { class: 'msg', role: 'status' });
    const qtyInput = el('input', { type: 'number', min: '1', max: String(MAX_POR_LINEA), value: '1', 'aria-label': 'Cantidad', inputmode: 'numeric' });
    const addBtn = el('button', { class: 'btn primary', type: 'button', html: icon('cart') + '<span>Agregar al carrito</span>' });

    function drawGallery() {
      const imgs = p.imagenes.filter(i => !i.color_id || !selColor || i.color_id === selColor);
      const list = imgs.length ? imgs : p.imagenes;
      const mainBox = el('div', { class: 'main' }, imgOrPlaceholder(list[0]?.ruta, list[0]?.alt || p.nombre));
      const thumbs = list.length > 1 ? el('div', { class: 'thumbs' }, ...list.map((im, i) => el('button', { type: 'button', 'aria-label': `Imagen ${i + 1}`, 'aria-current': String(i === 0),
        onclick: e => { mainBox.replaceChildren(imgOrPlaceholder(im.ruta, im.alt || p.nombre)); $$('button', e.currentTarget.parentNode).forEach(b => b.setAttribute('aria-current', String(b === e.currentTarget))); } },
        imgOrPlaceholder(im.ruta, '')))) : null;
      gallery.replaceChildren(mainBox, thumbs || '');
    }

    function drawOptions() {
      const vs = p.variantes.filter(v => (v.color_id || '') === selColor);
      if (selVar && (selVar.color_id || '') !== selColor) selVar = null;
      if (!selVar && vs.length === 1) selVar = vs[0];
      colorBox.replaceChildren();
      if (colores.length > 1 || (colores.length === 1 && colores[0][1])) {
        colorBox.append(el('span', { class: 'opt-label', text: `Color: ${colores.find(c => c[0] === selColor)?.[1]?.nombre || 'Único'}` }),
          el('div', { class: 'chips' }, ...colores.map(([cid, c]) => {
            const sw = c?.hex ? el('span', { class: 'swatch', 'aria-hidden': 'true' }) : null;
            if (sw) sw.style.background = c.hex;
            return el('button', { class: 'chip', type: 'button', 'aria-pressed': String(cid === selColor), onclick: () => { selColor = cid; selVar = null; drawOptions(); drawGallery(); } }, sw, c?.nombre || 'Único');
          })));
      }
      sizeBox.replaceChildren();
      if (vs.some(v => v.talla)) {
        sizeBox.append(el('span', { class: 'opt-label', text: 'Talla' }),
          el('div', { class: 'sizes' }, ...vs.map(v => el('button', {
            class: 'size' + (v.estado === 'agotado' ? ' out' : ''), type: 'button', 'aria-pressed': String(selVar === v),
            'aria-label': `Talla ${v.talla?.nombre || 'única'}${v.estado === 'agotado' ? ' (agotada)' : ''}`,
            text: v.talla?.nombre || 'Única', onclick: () => { selVar = v; drawOptions(); },
          }))));
      }
      const v = selVar;
      priceEl.textContent = money(v ? v.precio : p.precioDesde);
      stateEl.replaceChildren(v ? dispoTag(v.estado) : el('span', { class: 'muted', text: vs.length ? 'Elige una talla para ver la disponibilidad.' : '' }));
      addBtn.disabled = !v || v.estado === 'agotado' || !(Number(v.precio) > 0);
      if (v && !(Number(v.precio) > 0)) setMsg(msg, 'Precio por confirmar: este artículo aún no se puede pedir en línea.', 'err');
      else setMsg(msg, '');
    }

    const step = d => { qty = Math.max(1, Math.min(MAX_POR_LINEA, (parseInt(qtyInput.value, 10) || 1) + d)); qtyInput.value = String(qty); };
    qtyInput.addEventListener('change', () => step(0));
    addBtn.addEventListener('click', () => {
      if (!selVar) { setMsg(msg, 'Elige una talla.', 'err'); return; }
      step(0);
      try {
        addToCart(selVar.id, qty);
        snack('Agregado al carrito');
        setMsg(msg, '');
      } catch (e) { setMsg(msg, e.message, 'err'); }
    });

    const facts = el('dl', { class: 'facts' },
      p.marca ? [el('dt', { text: 'Marca' }), el('dd', { text: p.marca.nombre })] : null,
      p.modelo ? [el('dt', { text: 'Modelo' }), el('dd', { text: p.modelo })] : null,
      p.categoria ? [el('dt', { text: 'Categoría' }), el('dd', {}, el('a', { href: `#/catalogo?cat=${p.categoria.id}`, text: p.categoria.nombre }))] : null);

    show(
      el('div', { class: 'crumbs' }, el('a', { href: '#/', text: 'Inicio' }), ' / ', el('a', { href: '#/catalogo', text: 'Catálogo' }),
        p.categoria ? [' / ', el('a', { href: `#/catalogo?cat=${p.categoria.id}`, text: p.categoria.nombre })] : null),
      el('div', { class: 'product' }, gallery,
        el('div', { class: 'pinfo' },
          p.marca ? el('span', { class: 'tag', text: p.marca.nombre }) : null,
          el('h1', { text: p.nombre }),
          priceEl, stateEl,
          p.variantes.length ? [colorBox, sizeBox,
            el('div', { class: 'row' },
              el('div', { class: 'qty' }, el('button', { type: 'button', 'aria-label': 'Restar', text: '−', onclick: () => step(-1) }), qtyInput, el('button', { type: 'button', 'aria-label': 'Sumar', text: '+', onclick: () => step(1) })),
              addBtn),
            msg]
            : el('div', { class: 'notice', text: 'Este producto todavía no tiene tallas a la venta.' }),
          el('p', { class: 'muted', style: 'font-size:.88rem', text: 'La disponibilidad se confirma al hacer el pedido. Pago al recibir o al retirar.' }),
          p.descripcion ? el('div', {}, el('h3', { text: 'Descripción', style: 'font-size:1rem; margin-bottom:6px' }), el('p', { class: 'desc', text: p.descripcion })) : null,
          facts.children.length ? facts : null)));
    drawGallery(); drawOptions();
  });
}

/* =================================================================== *
 * Carrito
 * =================================================================== */
function resolveCart(cat) {
  const idx = new Map();
  for (const p of cat.productos) for (const v of p.variantes) idx.set(v.id, { p, v });
  return cartItems().map(i => ({ ...i, ...(idx.get(i.v) || {}) }));
}

function renderCart() {
  if (!cartItems().length) {
    show(title('Carrito'), el('div', { style: 'margin-top:18px' }, emptyState({ icon: 'cart', title: 'Tu carrito está vacío', text: 'Agrega productos desde el catálogo.', action: { label: 'Ir al catálogo', onClick: () => { location.hash = '#/catalogo'; } } })));
    return;
  }
  withCatalog(cat => {
    const lines = resolveCart(cat);
    let total = 0, problems = 0;
    const rows = lines.map(l => {
      if (!l.p) {
        problems++;
        return el('div', { class: 'cline' },
          el('div', { class: 'thumb', html: icon('alert') }),
          el('div', { class: 'info' }, el('strong', { text: 'Artículo no disponible' }), el('span', { class: 'muted', text: 'Ya no está publicado. Quítalo para continuar.' })),
          el('div', { class: 'controls' }, el('button', { class: 'btn small danger', type: 'button', text: 'Quitar', onclick: () => { removeFromCart(l.v); renderCart(); } })));
      }
      const sub = Number(l.v.precio) * l.n;
      total += sub;
      if (l.v.estado === 'agotado' || !(Number(l.v.precio) > 0)) problems++;
      const qtyIn = el('input', { type: 'number', min: '1', max: String(MAX_POR_LINEA), value: String(l.n), 'aria-label': 'Cantidad', inputmode: 'numeric' });
      const upd = n => { setQty(l.v.id, n); renderCart(); };
      qtyIn.addEventListener('change', () => upd(parseInt(qtyIn.value, 10) || 1));
      const detalle = [l.v.talla && `Talla ${l.v.talla.nombre}`, l.v.color?.nombre].filter(Boolean).join(' · ');
      return el('div', { class: 'cline' },
        el('div', { class: 'thumb' }, imgOrPlaceholder(l.p.imagenes.find(i => i.color_id === l.v.color_id)?.ruta || l.p.imagenes[0]?.ruta, '')),
        el('div', { class: 'info' },
          el('a', { href: `#/producto/${l.p.id}`, text: l.p.nombre, style: 'font-weight:700; color:inherit' }),
          detalle ? el('span', { class: 'muted', text: detalle }) : null,
          el('div', { class: 'row' }, dispoTag(l.v.estado), el('span', { text: money(l.v.precio) })),
          l.v.estado === 'agotado' ? el('span', { class: 'msg err', text: 'Agotado: quítalo para continuar.' }) : null),
        el('div', { class: 'controls' },
          el('div', { class: 'qty' }, el('button', { type: 'button', 'aria-label': 'Restar', text: '−', onclick: () => upd(l.n - 1) }), qtyIn, el('button', { type: 'button', 'aria-label': 'Sumar', text: '+', onclick: () => upd(l.n + 1) })),
          el('strong', { class: 'price', text: money(sub) }),
          el('button', { class: 'btn small ghost', type: 'button', text: 'Quitar', onclick: () => { removeFromCart(l.v.id); renderCart(); } })));
    });
    const go = el('a', { class: 'btn primary block', href: '#/checkout', text: 'Continuar con el pedido' });
    if (problems) { go.setAttribute('aria-disabled', 'true'); go.classList.add('disabled'); go.addEventListener('click', e => e.preventDefault()); go.style.opacity = '.55'; }
    show(title('Carrito', `${cartCount()} unidad${cartCount() === 1 ? '' : 'es'}`),
      el('div', { class: 'cart', style: 'margin-top:18px' },
        el('div', { class: 'cart-lines' }, ...rows),
        el('aside', { class: 'summary' },
          el('h3', { text: 'Resumen' }),
          el('div', { class: 'line' }, el('span', { text: 'Subtotal' }), el('span', { text: money(total) })),
          el('div', { class: 'line muted' }, el('span', { text: 'Envío' }), el('span', { text: 'A coordinar' })),
          el('div', { class: 'line total' }, el('span', { text: 'Total' }), el('span', { text: money(total) })),
          problems ? el('p', { class: 'msg err', text: 'Revisa los artículos marcados antes de continuar.' }) : null,
          go,
          el('a', { class: 'btn ghost block', href: '#/catalogo', text: 'Seguir comprando' }))));
  });
}

/* =================================================================== *
 * Checkout
 * =================================================================== */
function renderCheckout() {
  if (!cartItems().length) { location.hash = '#/carrito'; return; }
  const b = blocker(); if (b) { show(b); return; }
  if (!ctx.session) {
    sessionStorage.setItem('tienda:despues', '#/checkout');
    show(title('Finalizar pedido'), el('div', { style: 'margin-top:18px' }, emptyState({ icon: 'user', title: 'Inicia sesión para continuar', text: 'Necesitas una cuenta para hacer pedidos y consultar su estado.', action: { label: 'Ingresar o crear cuenta', onClick: () => { location.hash = '#/cuenta'; } } })));
    return;
  }
  withCatalog(cat => {
    const lines = resolveCart(cat);
    if (lines.some(l => !l.p || l.v.estado === 'agotado')) { location.hash = '#/carrito'; return; }
    const total = lines.reduce((s, l) => s + Number(l.v.precio) * l.n, 0);
    const suc = cat.sucursales;
    const form = el('form', { class: 'form-grid', novalidate: true });
    const msg = el('p', { class: 'msg', role: 'status' });
    const btn = el('button', { class: 'btn primary block', type: 'submit', text: 'Confirmar pedido' });

    const entregaOpts = [];
    if (suc.length) entregaOpts.push(el('label', {}, el('input', { type: 'radio', name: 'entrega', value: 'retiro', checked: true }), el('span', {}, el('strong', { text: 'Retiro en sucursal' }), el('br'), el('span', { class: 'muted', text: 'Te avisaremos cuando esté listo.' }))));
    entregaOpts.push(el('label', {}, el('input', { type: 'radio', name: 'entrega', value: 'envio', checked: !suc.length }), el('span', {}, el('strong', { text: 'Envío a domicilio' }), el('br'), el('span', { class: 'muted', text: 'El costo y la fecha se coordinan contigo.' }))));
    const sucSel = el('select', { id: 'coSuc' }, ...suc.map(s => el('option', { value: s.id, text: `${s.nombre}${s.direccion ? ' — ' + s.direccion : ''}` })));
    const sucField = el('div', { class: 'field span2' }, el('label', { for: 'coSuc', text: 'Sucursal de retiro' }), sucSel);
    const dirField = el('div', { class: 'field span2' }, el('label', { for: 'coDir', text: 'Dirección de envío' }), el('textarea', { id: 'coDir', maxlength: '300', autocomplete: 'street-address' }));
    const toggle = () => { const v = form.entrega.value; sucField.hidden = v !== 'retiro'; dirField.hidden = v !== 'envio'; };

    form.append(
      el('div', { class: 'field span2' }, el('span', { class: 'label', text: 'Forma de entrega' }), el('div', { class: 'choice', onchange: toggle }, ...entregaOpts)),
      sucField, dirField,
      el('div', { class: 'field' }, el('label', { for: 'coTel', text: 'Teléfono de contacto' }), el('input', { id: 'coTel', type: 'tel', autocomplete: 'tel', maxlength: '30', value: ctx.cliente?.telefono || '' })),
      el('div', { class: 'field span2' }, el('label', { for: 'coNotas', text: 'Notas (opcional)' }), el('textarea', { id: 'coNotas', maxlength: '500' })),
      el('div', { class: 'notice span2', text: 'No se cobra en línea. Pagas al recibir o al retirar tu pedido. Las existencias se confirman al enviar el pedido.' }),
      el('div', { class: 'span2 stack' }, msg, btn));
    form.classList.add('two');

    form.addEventListener('submit', async e => {
      e.preventDefault();
      const entrega = form.entrega.value;
      const tel = $('#coTel').value.trim(), dir = $('#coDir').value.trim();
      $('#coTel').removeAttribute('aria-invalid'); $('#coDir').removeAttribute('aria-invalid');
      if (tel.replace(/\D/g, '').length < 6) { $('#coTel').setAttribute('aria-invalid', 'true'); setMsg(msg, 'Escribe un teléfono válido.', 'err'); return; }
      if (entrega === 'envio' && !dir) { $('#coDir').setAttribute('aria-invalid', 'true'); setMsg(msg, 'Escribe la dirección de envío.', 'err'); return; }
      btn.disabled = true; setMsg(msg, 'Enviando pedido…');
      try {
        const id = await crearPedido({
          lineas: cartItems().map(i => ({ variante_id: i.v, cantidad: i.n })), entrega,
          sucursalId: entrega === 'retiro' ? sucSel.value : null, direccion: dir, telefono: tel, notas: $('#coNotas').value.trim(),
        });
        clearCart(); invalidarCatalogo();
        location.hash = `#/pedido-ok/${id}`;
      } catch (err) {
        console.error(err);
        setMsg(msg, errText(err), 'err');
        invalidarCatalogo();
        btn.disabled = false;
      }
    });

    show(title('Finalizar pedido'),
      el('div', { class: 'cart', style: 'margin-top:18px' },
        el('div', { class: 'card' }, form),
        el('aside', { class: 'summary' },
          el('h3', { text: 'Tu pedido' }),
          ...lines.map(l => el('div', { class: 'line' }, el('span', { text: `${l.n} × ${l.p.nombre}${l.v.talla ? ' · T' + l.v.talla.nombre : ''}` }), el('span', { text: money(Number(l.v.precio) * l.n) }))),
          el('div', { class: 'line total' }, el('span', { text: 'Total' }), el('span', { text: money(total) })),
          el('a', { href: '#/carrito', text: 'Modificar carrito' }))));
    toggle();
  });
}

function renderSuccess(id) {
  show(el('div', { class: 'success' },
    el('div', { class: 'ok-mark', html: icon('check') }),
    el('h1', { class: 'page-title', text: `Pedido n.º ${id} recibido` }),
    el('p', { class: 'muted', text: 'Tu pedido quedó en estado «Pendiente». La tienda lo revisará y te contactará al teléfono indicado. No se realizó ningún cobro en línea.' }),
    el('div', { class: 'row' }, el('a', { class: 'btn primary', href: '#/pedidos', text: 'Ver mis pedidos' }), el('a', { class: 'btn', href: '#/catalogo', text: 'Seguir comprando' }))));
}

/* =================================================================== *
 * Cuenta
 * =================================================================== */
function renderAccount() {
  const b = blocker(); if (b) { show(b); return; }
  if (ctx.recovery) return renderNewPassword();
  if (ctx.session) {
    const msg = el('p', { class: 'msg', role: 'status' });
    const nombre = el('input', { id: 'acNombre', maxlength: '120', autocomplete: 'name', value: ctx.cliente?.nombre || '' });
    const tel = el('input', { id: 'acTel', type: 'tel', maxlength: '30', autocomplete: 'tel', value: ctx.cliente?.telefono || '' });
    const form = el('form', { class: 'form-grid', novalidate: true },
      el('div', { class: 'field' }, el('label', { for: 'acNombre', text: 'Nombre' }), nombre),
      el('div', { class: 'field' }, el('label', { for: 'acTel', text: 'Teléfono' }), tel),
      msg, el('div', { class: 'actions' }, el('button', { class: 'btn primary', type: 'submit', text: 'Guardar datos' })));
    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (!ctx.cliente) { setMsg(msg, 'Tu cuenta no tiene ficha de cliente.', 'err'); return; }
      try {
        await actualizarCliente(ctx.cliente.id, { nombre: nombre.value.trim(), telefono: tel.value.trim() });
        ctx.cliente = { ...ctx.cliente, nombre: nombre.value.trim(), telefono: tel.value.trim() };
        setMsg(msg, 'Datos guardados.', 'ok'); updateHeader();
      } catch (err) { setMsg(msg, errText(err), 'err'); }
    });
    // Personal interno: acceso directo a su herramienta (la base valida el rol en cada operación)
    const staff = el('div', { class: 'notice', hidden: true });
    getStaffProfile(ctx.session.user.id).then(p => {
      if (!p || !p.activo) return;
      staff.replaceChildren(el('span', { text: `Tu cuenta también es «${ROL_TEXTO[p.rol] || p.rol}». ` }),
        p.rol === 'admin' ? el('a', { class: 'btn small', href: 'admin.html', text: 'Ir al panel' }) : null, ' ',
        el('a', { class: 'btn small', href: 'almacen.html', text: 'Ir al almacén' }));
      staff.hidden = false;
    }).catch(() => {});
    show(el('div', { class: 'auth-box stack' },
      title('Mi cuenta', ctx.session.user.email),
      staff,
      el('div', { class: 'card' }, form),
      el('div', { class: 'row' }, el('a', { class: 'btn', href: '#/pedidos', text: 'Mis pedidos' }),
        el('button', { class: 'btn ghost', type: 'button', text: 'Cerrar sesión', onclick: async () => { await signOut(); snack('Sesión cerrada'); location.hash = '#/'; } }))));
    return;
  }

  let mode = 'login';
  const box = el('div', { class: 'card' });
  const draw = () => {
    const msg = el('p', { class: 'msg', role: 'status' });
    const email = el('input', { id: 'auEmail', type: 'email', autocomplete: 'username', inputmode: 'email', autocapitalize: 'off', spellcheck: 'false', required: true });
    const pass = el('input', { id: 'auPass', type: 'password', autocomplete: mode === 'registro' ? 'new-password' : 'current-password', minlength: '8', required: true });
    const nombre = el('input', { id: 'auNombre', autocomplete: 'name', maxlength: '120' });
    const btn = el('button', { class: 'btn primary block', type: 'submit', text: mode === 'registro' ? 'Crear cuenta' : mode === 'olvido' ? 'Enviar enlace' : 'Ingresar' });
    const form = el('form', { class: 'form-grid', novalidate: true },
      mode === 'registro' ? el('div', { class: 'field' }, el('label', { for: 'auNombre', text: 'Nombre completo' }), nombre) : null,
      el('div', { class: 'field' }, el('label', { for: 'auEmail', text: 'Correo electrónico' }), email),
      mode !== 'olvido' ? el('div', { class: 'field' }, el('label', { for: 'auPass', text: 'Contraseña' }), pass, mode === 'registro' ? el('small', { text: 'Mínimo 8 caracteres.' }) : null) : null,
      msg, btn,
      mode === 'login' ? el('button', { class: 'btn ghost small', type: 'button', text: '¿Olvidaste tu contraseña?', onclick: () => { mode = 'olvido'; draw(); } }) : null,
      mode === 'olvido' ? el('button', { class: 'btn ghost small', type: 'button', text: 'Volver', onclick: () => { mode = 'login'; draw(); } }) : null);
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const em = email.value.trim(), pw = pass.value;
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) { setMsg(msg, 'Escribe un correo válido.', 'err'); return; }
      if (mode !== 'olvido' && pw.length < (mode === 'registro' ? 8 : 1)) { setMsg(msg, mode === 'registro' ? 'La contraseña debe tener al menos 8 caracteres.' : 'Escribe tu contraseña.', 'err'); return; }
      if (mode === 'registro' && !nombre.value.trim()) { setMsg(msg, 'Escribe tu nombre.', 'err'); return; }
      btn.disabled = true; setMsg(msg, 'Un momento…');
      try {
        if (mode === 'login') { await signIn(em, pw); snack('Sesión iniciada'); }
        else if (mode === 'registro') {
          const needsConfirm = await signUp(em, pw, nombre.value.trim());
          if (needsConfirm) { setMsg(msg, 'Cuenta creada. Revisa tu correo y confirma tu dirección para ingresar.', 'ok'); btn.disabled = false; return; }
          snack('Cuenta creada');
        } else { await resetPassword(em); setMsg(msg, 'Si el correo está registrado, recibirás un enlace para crear una nueva contraseña.', 'ok'); btn.disabled = false; return; }
      } catch (err) { setMsg(msg, authErrorText(err), 'err'); btn.disabled = false; }
    });
    const tabs = mode === 'olvido' ? el('h2', { text: 'Recuperar contraseña', style: 'margin-bottom:14px' }) : el('div', { class: 'tabs', role: 'tablist' },
      el('button', { type: 'button', role: 'tab', 'aria-selected': String(mode === 'login'), text: 'Ingresar', onclick: () => { mode = 'login'; draw(); } }),
      el('button', { type: 'button', role: 'tab', 'aria-selected': String(mode === 'registro'), text: 'Crear cuenta', onclick: () => { mode = 'registro'; draw(); } }));
    box.replaceChildren(tabs, form);
  };
  draw();
  show(el('div', { class: 'auth-box stack' }, title('Mi cuenta', 'Ingresa para hacer pedidos y seguir su estado.'), box));
}

function renderNewPassword() {
  const msg = el('p', { class: 'msg', role: 'status' });
  const pass = el('input', { id: 'npPass', type: 'password', autocomplete: 'new-password', minlength: '8' });
  const form = el('form', { class: 'form-grid', novalidate: true },
    el('div', { class: 'field' }, el('label', { for: 'npPass', text: 'Nueva contraseña' }), pass, el('small', { text: 'Mínimo 8 caracteres.' })),
    msg, el('button', { class: 'btn primary block', type: 'submit', text: 'Guardar contraseña' }));
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (pass.value.length < 8) { setMsg(msg, 'La contraseña debe tener al menos 8 caracteres.', 'err'); return; }
    try { await updatePassword(pass.value); ctx.recovery = false; snack('Contraseña actualizada'); location.hash = '#/cuenta'; }
    catch (err) { setMsg(msg, authErrorText(err), 'err'); }
  });
  show(el('div', { class: 'auth-box stack' }, title('Crear nueva contraseña'), el('div', { class: 'card' }, form)));
}

/* =================================================================== *
 * Mis pedidos
 * =================================================================== */
async function renderOrders() {
  const b = blocker(); if (b) { show(b); return; }
  if (!ctx.session) {
    sessionStorage.setItem('tienda:despues', '#/pedidos');
    show(title('Mis pedidos'), el('div', { style: 'margin-top:18px' }, emptyState({ icon: 'user', title: 'Inicia sesión para ver tus pedidos', action: { label: 'Ingresar', onClick: () => { location.hash = '#/cuenta'; } } })));
    return;
  }
  show(loading('Cargando pedidos…'));
  try {
    const rows = await misPedidos();
    if (!rows.length) { show(title('Mis pedidos'), el('div', { style: 'margin-top:18px' }, emptyState({ icon: 'receipt', title: 'Todavía no tienes pedidos', text: 'Cuando hagas un pedido, aquí verás su estado.', action: { label: 'Ir al catálogo', onClick: () => { location.hash = '#/catalogo'; } } }))); return; }
    show(title('Mis pedidos'), el('div', { class: 'stack', style: 'margin-top:18px' }, ...rows.map(o => {
      const st = ESTADO_PEDIDO[o.estado] || { text: o.estado, cls: '' };
      return el('article', { class: 'order' },
        el('div', { class: 'order-head' },
          el('strong', { text: `Pedido n.º ${o.id}` }), el('span', { class: 'muted', text: fmtDate(o.creado_en) }),
          el('span', { class: 'tag ' + st.cls, text: st.text }), el('strong', { class: 'price', text: money(o.total) })),
        el('div', { class: 'order-body' },
          ...o.pedido_lineas.map(l => el('div', { class: 'row between' }, el('span', { text: `${l.cantidad} × ${l.producto_nombre}${l.detalle ? ' (' + l.detalle + ')' : ''}` }), el('span', { text: money(l.precio_unitario * l.cantidad) }))),
          el('span', { class: 'muted', text: o.entrega === 'retiro' ? 'Retiro en sucursal' : `Envío a: ${o.direccion}` }),
          el('ul', { class: 'timeline' }, ...[...o.pedido_historial].sort((a, b) => a.creado_en.localeCompare(b.creado_en)).map(h => el('li', { text: `${fmtDate(h.creado_en)} · ${ESTADO_PEDIDO[h.estado_nuevo]?.text || h.estado_nuevo}${h.nota ? ' — ' + h.nota : ''}` }))),
          o.estado === 'pendiente' ? el('div', {}, el('button', { class: 'btn small danger', type: 'button', text: 'Cancelar pedido', onclick: async () => {
            if (!await confirmDialog({ title: `¿Cancelar el pedido n.º ${o.id}?`, text: 'Esta acción no se puede deshacer.', ok: 'Cancelar pedido', danger: true })) return;
            try { await cancelarMiPedido(o.id); invalidarCatalogo(); snack('Pedido cancelado'); renderOrders(); }
            catch (err) { snack(errText(err), 'err'); }
          } })) : null));
    })));
  } catch (e) {
    console.error(e);
    show(emptyState({ icon: 'alert', kind: 'err', title: 'No se pudieron cargar tus pedidos', text: errText(e), action: { label: 'Reintentar', onClick: renderOrders } }));
  }
}

/* =================================================================== *
 * Sucursales
 * =================================================================== */
const branchList = list => el('div', { class: 'branches' }, ...list.map(s => el('div', { class: 'branch' },
  el('strong', { html: icon('pin') + ' ' }, s.nombre),
  s.direccion ? el('span', { class: 'muted', text: s.direccion }) : null,
  s.telefono ? el('a', { href: `tel:${s.telefono.replace(/[^\d+]/g, '')}`, text: s.telefono }) : null)));

function renderBranches() {
  withCatalog(cat => show(title('Sucursales'), el('div', { style: 'margin-top:18px' },
    cat.sucursales.length ? branchList(cat.sucursales) : emptyState({ icon: 'store', title: 'Todavía no hay sucursales publicadas' }))));
}

/* =================================================================== *
 * Router y arranque
 * =================================================================== */
function route() {
  const raw = location.hash.replace(/^#\/?/, '');
  if (/^(access_token|error|type)=/.test(raw)) { show(loading('Verificando…')); return; }   // retorno de enlaces de correo
  const [path, query = ''] = raw.split('?');
  const [name, arg] = path.split('/');
  const params = new URLSearchParams(query);
  document.title = appConfig().TIENDA_NOMBRE || 'Tienda de calzado';
  $('#catNav').classList.remove('open'); $('#btnMenu').setAttribute('aria-expanded', 'false');
  ({
    '': renderHome, catalogo: () => renderCatalog(params), producto: () => renderProduct(arg),
    carrito: renderCart, checkout: renderCheckout, 'pedido-ok': () => renderSuccess(arg),
    cuenta: renderAccount, pedidos: renderOrders, sucursales: renderBranches,
  }[name] || renderHome)();
}

function updateHeader() {
  $('#accountLabel').textContent = ctx.session ? (ctx.cliente?.nombre?.split(' ')[0] || 'Mi cuenta') : 'Ingresar';
}

async function onSession(session, event) {
  ctx.session = session; ctx.cliente = null;
  if (event === 'PASSWORD_RECOVERY') { ctx.recovery = true; location.hash = '#/cuenta'; }
  if (session) { try { ctx.cliente = await getCliente(session.user.id); } catch (e) { console.error(e); } }
  updateHeader();
  const next = session && sessionStorage.getItem('tienda:despues');
  if (next) { sessionStorage.removeItem('tienda:despues'); location.hash = next; return; }
  route();
}

async function init() {
  $('#frmSearch').addEventListener('submit', e => { e.preventDefault(); const q = $('#q').value.trim(); location.hash = '#/catalogo' + (q ? '?q=' + encodeURIComponent(q) : ''); });
  $('#btnMenu').addEventListener('click', e => { const o = $('#catNav').classList.toggle('open'); e.currentTarget.setAttribute('aria-expanded', String(o)); });
  onCartChange(() => { const n = cartCount(); $('#cartCount').textContent = String(n); $('#cartCount').hidden = !n; });
  window.addEventListener('hashchange', route);

  const { client, status } = await initSupabase();
  ctx.db = status;
  const cfg = appConfig();
  setCurrency(cfg.MONEDA);
  const nombre = cfg.TIENDA_NOMBRE || 'Tienda de calzado';
  $('#brandName').textContent = nombre; $('#footerBrand').textContent = nombre;
  $('#footerCopy').textContent = `© ${new Date().getFullYear()} ${nombre}`;
  if (client) cargarCatalogo().then(buildCategoryNav).catch(() => {});
  initAuth(client, onSession);   // emite la sesión inicial (o null sin base) y llama a route()
}

init();
