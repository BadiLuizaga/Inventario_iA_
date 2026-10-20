/* ------------------------------------------------------------------ *
 * Analítica: mapas de calor (clics, movimiento, desplazamiento y clics de
 * furia) sobre la página real de la tienda, cargada en un iframe del mismo
 * sitio con ?an=0 (esa carga no se mide ni muestra el aviso).
 * x se guarda como fracción del ancho del documento e y en píxeles: el
 * mapa se dibuja al ancho típico del dispositivo elegido.
 * ------------------------------------------------------------------ */
import { el, emptyState, loading } from '../../ui.js';
import { dataTable, tarjeta } from '../util.js';
import { poner, sesiones, eventos, rangoDe, barraRango, nombrePagina, cuenta, pct, DISPOSITIVO } from './datos.js';
import { errorAnalitica } from './tablero.js';

const TIPOS = [['clic', 'Clics'], ['movimiento', 'Movimiento'], ['scroll', 'Desplazamiento'], ['furia', 'Clics de furia']];
const ANCHO = { escritorio: 1280, tablet: 820, movil: 390 };
const MAX_ALTO = 9000;

/* Paleta del calor: azul → cian → verde → amarillo → rojo */
let paleta = null;
function colores() {
  if (paleta) return paleta;
  const c = el('canvas', { width: '256', height: '1' }); const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 256, 0);
  [[0, '#0000ff'], [0.25, '#00c8ff'], [0.5, '#00ff60'], [0.75, '#ffee00'], [1, '#ff2000']].forEach(([o, col]) => gr.addColorStop(o, col));
  g.fillStyle = gr; g.fillRect(0, 0, 256, 1);
  return (paleta = g.getImageData(0, 0, 256, 1).data);
}
function pintarCalor(canvas, puntos, radio) {
  const w = canvas.width, h = canvas.height, ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  if (!puntos.length) return;
  const sombra = el('canvas', { width: String(w), height: String(h) }); const s = sombra.getContext('2d');
  const alfa = Math.min(0.5, Math.max(0.04, 6 / Math.sqrt(puntos.length)));
  for (const [x, y] of puntos) {
    const g = s.createRadialGradient(x, y, 0, x, y, radio);
    g.addColorStop(0, `rgba(0,0,0,${alfa})`); g.addColorStop(1, 'rgba(0,0,0,0)');
    s.fillStyle = g; s.fillRect(x - radio, y - radio, radio * 2, radio * 2);
  }
  const img = s.getImageData(0, 0, w, h), d = img.data, pal = colores();
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (!a) continue;
    const k = Math.min(255, a * 2) * 4;
    d[i] = pal[k]; d[i + 1] = pal[k + 1]; d[i + 2] = pal[k + 2]; d[i + 3] = Math.min(200, 60 + a * 1.6);
  }
  ctx.putImageData(img, 0, 0);
}
/** Mapa de desplazamiento: qué porcentaje de las visitas llegó a cada altura. */
function pintarScroll(canvas, maximos) {
  const w = canvas.width, h = canvas.height, ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  if (!maximos.length) return;
  const n = maximos.length, pal = colores();
  for (let y = 0; y < h; y += 4) {
    const prof = (y / h) * 100;
    const llegan = maximos.filter(m => m >= prof).length / n;
    const k = Math.round(llegan * 255) * 4;
    ctx.fillStyle = `rgba(${pal[k]},${pal[k + 1]},${pal[k + 2]},0.38)`;
    ctx.fillRect(0, y, w, 4);
  }
  ctx.font = 'bold 15px DM Sans, sans-serif';
  for (const meta of [75, 50, 25]) {
    const ordenados = [...maximos].sort((a, b) => b - a);
    const p = ordenados[Math.min(n - 1, Math.floor(n * meta / 100))] ?? 0;   // profundidad que alcanza el meta % de las visitas
    const y = Math.min(h - 4, (p / 100) * h);
    ctx.fillStyle = 'rgba(11,31,63,.85)'; ctx.fillRect(0, y - 1, w, 2);
    ctx.fillStyle = '#0B1F3F'; ctx.fillRect(8, y - 26, 250, 24);
    ctx.fillStyle = '#fff'; ctx.fillText(`${meta} % de las visitas llega hasta aquí`, 16, y - 9);
  }
}

export async function renderMapas(main, go, params) {
  const rango = rangoDe(params);
  const disp = params.get('d') || rango.disp || 'escritorio';
  const tipo = params.get('t') || 'clic';
  const ruta = params.get('ruta') || '';
  const nav = extra => go('#/analitica/mapas?' + new URLSearchParams({ ...rango, d: disp, t: tipo, ruta, ...extra }));
  const out = el('div', { class: 'stack' }, loading('Preparando el mapa…'));
  poner(main, el('div', { class: 'page-head' }, el('h2', { text: 'Mapas de calor' })), barraRango(rango, nav), out);

  try {
    const ss = await sesiones({ ...rango, disp });
    const ids = new Set(ss.map(s => s.id));
    const vistas = (await eventos(rango, { tipos: ['pagina'] })).filter(e => ids.has(e.sesion_id));
    const rutas = cuenta(vistas, e => e.ruta);
    if (!rutas.length) { poner(out, emptyState({ icon: 'chart', title: `Sin visitas desde ${DISPOSITIVO[disp].toLowerCase()} en este período`, text: 'Elige otro dispositivo o amplía las fechas.' })); return; }
    const rutaSel = ruta && rutas.some(r => r[0] === ruta) ? ruta : rutas[0][0];
    const evs = (await eventos(rango, { tipos: tipo === 'scroll' ? ['scroll'] : tipo === 'movimiento' ? ['movimiento'] : ['clic', 'furia'], completo: true, ruta: rutaSel })).filter(e => ids.has(e.sesion_id));
    const propios = tipo === 'clic' ? evs.filter(e => e.tipo === 'clic') : tipo === 'furia' ? evs.filter(e => e.tipo === 'furia') : evs;
    const nVistas = vistas.filter(e => e.ruta === rutaSel).length;
    // Página de muestra: la URL más visitada de esa ruta (p. ej. un producto concreto)
    const muestra = cuenta(vistas.filter(e => e.ruta === rutaSel), e => e.url)[0]?.[0] || rutaSel;
    const anchos = propios.map(e => e.ancho).filter(Boolean).sort((a, b) => a - b);
    const ancho = anchos.length ? Math.min(1920, Math.max(320, anchos[Math.floor(anchos.length / 2)])) : ANCHO[disp];

    const controles = el('div', { class: 'an-filtros' },
      el('select', { class: 'input', 'aria-label': 'Página', onchange: e => nav({ ruta: e.target.value }) },
        ...rutas.map(([r, n]) => el('option', { value: r, text: `${nombrePagina(r)} · ${n} vistas`, selected: r === rutaSel }))),
      el('select', { class: 'input', 'aria-label': 'Dispositivo', onchange: e => nav({ d: e.target.value }) },
        ...Object.entries(DISPOSITIVO).map(([k, v]) => el('option', { value: k, text: v, selected: k === disp }))));
    const tipos = el('div', { class: 'subtabs', role: 'tablist' }, ...TIPOS.map(([k, t]) =>
      el('button', { type: 'button', role: 'tab', 'aria-selected': String(k === tipo), text: t, onclick: () => nav({ t: k }) })));

    const marco = el('iframe', { class: 'an-heat-frame', title: 'Vista de la página', src: `index.html?an=0${muestra.startsWith('#') ? muestra : '#/'}`, scrolling: 'no', tabindex: '-1' });
    const lienzo = el('canvas', { class: 'an-heat-canvas' });
    const escena = el('div', { class: 'an-heat-scene' }, marco, lienzo);
    const visor = el('div', { class: 'an-heat' }, escena);
    const estado = el('p', { class: 'muted', text: 'Cargando la página…' });

    // Elementos más clicados en esta página
    const elementos = cuenta(propios.filter(e => e.tipo === 'clic' || e.tipo === 'furia'), e => e.texto || e.selector || '(sin texto)');
    const lado = tipo === 'scroll'
      ? tarjeta('Profundidad', null, (() => {
        const mx = propios.map(e => e.datos?.max ?? 0);
        const llegan = p => mx.filter(m => m >= p).length;
        return dataTable([{ label: 'Llegó al', value: p => `${p} %` }, { label: 'Visitas', value: p => llegan(p), num: true }, { label: '%', value: p => pct(llegan(p), mx.length), num: true }], [25, 50, 75, 100]);
      })())
      : tipo === 'movimiento' ? tarjeta('Movimiento', 'Zonas por donde pasa el ratón (solo escritorio y tablet con ratón).', el('p', { text: `${propios.reduce((a, e) => a + (e.datos?.p?.length || 0), 0)} puntos de ${propios.length} vistas.` }))
        : tarjeta(tipo === 'furia' ? 'Dónde se frustran' : 'Elementos más clicados', null,
          elementos.length ? dataTable([{ label: 'Elemento', value: x => x[0] }, { label: 'Clics', value: x => x[1], num: true }, { label: '%', value: x => pct(x[1], propios.length), num: true }], elementos.slice(0, 15))
            : el('p', { class: 'muted', text: 'Sin clics en esta página.' }));

    poner(out, controles, tipos,
      el('div', { class: 'kpi-grid' },
        el('div', { class: 'kpi' }, el('span', { text: 'Vistas de la página' }), el('strong', { text: String(nVistas) })),
        el('div', { class: 'kpi' }, el('span', { text: tipo === 'scroll' ? 'Visitas medidas' : tipo === 'movimiento' ? 'Muestras de movimiento' : 'Clics' }), el('strong', { text: String(propios.length) })),
        el('div', { class: 'kpi' }, el('span', { text: 'Ancho dibujado' }), el('strong', { text: `${ancho} px` }))),
      nVistas < 10 ? el('p', { class: 'notice', text: `Con ${nVistas} vistas el mapa es orientativo: se vuelve fiable a partir de unas 10 visitas.` }) : null,
      el('div', { class: 'an-heat-layout' }, el('div', { class: 'stack' }, estado, visor), lado));

    // Dibujo: cuando la página del iframe terminó de dibujarse
    marco.style.width = `${ancho}px`;
    const escalar = () => { if (!visor.isConnected) { removeEventListener('resize', escalar); return; } const k = Math.min(1, (visor.clientWidth - 2) / ancho); escena.style.transform = `scale(${k})`; escena.style.width = `${ancho}px`; visor.style.height = `${(parseFloat(marco.style.height) || 600) * k}px`; };
    (async () => {
      // Espera a que la tienda (no la página en blanco inicial del iframe) termine de dibujarse: sin «Cargando…»
      let doc = null;
      for (let i = 0; i < 100 && visor.isConnected; i++) {
        try { doc = marco.contentDocument; } catch (_) { doc = null; }
        if (doc && doc.readyState === 'complete' && doc.URL.includes('index.html') && doc.querySelector('main') && !doc.querySelector('main .loading')) break;
        doc = null;
        await new Promise(r => setTimeout(r, 150));
      }
      if (!visor.isConnected) return;
      if (!doc) { estado.textContent = 'No se pudo abrir la página (revisa que el sitio permita mostrarse dentro del mismo dominio).'; return; }
      await Promise.race([Promise.all([...doc.images].filter(im => !im.complete).map(im => new Promise(r => { im.onload = im.onerror = r; }))), new Promise(r => setTimeout(r, 2500))]);
      doc.documentElement.style.overflow = 'hidden';
      const alto = Math.min(MAX_ALTO, doc.documentElement.scrollHeight);
      marco.style.height = `${alto}px`;
      lienzo.width = ancho; lienzo.height = alto;
      lienzo.style.width = `${ancho}px`; lienzo.style.height = `${alto}px`;
      escalar();
      if (tipo === 'scroll') pintarScroll(lienzo, propios.map(e => e.datos?.max ?? 0));
      else {
        const pts = tipo === 'movimiento'
          ? propios.flatMap(e => (e.datos?.p || []).map(([x, y]) => [x * ancho, y]))
          : propios.filter(e => e.x !== null && e.y !== null).map(e => [e.x * ancho, e.y]);
        pintarCalor(lienzo, pts.filter(([, y]) => y <= alto), tipo === 'movimiento' ? 18 : 26);
      }
      estado.textContent = `Página de muestra: ${muestra}. El mapa junta las visitas a «${nombrePagina(rutaSel)}» desde ${DISPOSITIVO[disp].toLowerCase()}.`;
    })();
    addEventListener('resize', escalar);
  } catch (e) { console.error(e); poner(out, errorAnalitica(e)); }
}
