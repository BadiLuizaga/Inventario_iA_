/* Analítica: errores de JavaScript y frustración (clics de furia), y ajustes de la analítica. */
import { el, emptyState, loading, fmtDate, snack, errText, confirmDialog, setMsg } from '../../ui.js';
import { db, unwrap } from '../../supabase.js';
import { dataTable, downloadCsv, tarjeta } from '../util.js';
import { poner, sesiones, eventos, configAnalitica, rangoDe, barraRango, nombrePagina, nombreCorto, pct, verSesiones, limpiarCache } from './datos.js';
import { errorAnalitica } from './tablero.js';

/* =================================================================== *
 * Errores y frustración
 * =================================================================== */
export async function renderErrores(main, go, params) {
  const rango = rangoDe(params);
  const tab = params.get('tab') === 'furia' ? 'furia' : 'errores';
  const nav = extra => go('#/analitica/errores?' + new URLSearchParams({ ...rango, tab, ...extra }));
  const out = el('div', { class: 'stack' }, loading());
  const tabs = el('div', { class: 'subtabs', role: 'tablist' }, ...[['errores', 'Errores de JavaScript'], ['furia', 'Clics de furia']].map(([k, t]) =>
    el('button', { type: 'button', role: 'tab', 'aria-selected': String(k === tab), text: t, onclick: () => nav({ tab: k }) })));
  poner(main, el('div', { class: 'page-head' }, el('h2', { text: 'Errores y frustración' })), barraRango(rango, nav), tabs, out);
  try {
    const ss = await sesiones(rango);
    const vis = new Map(ss.map(s => [s.id, s.visitante_id]));
    const evs = (await eventos(rango, { tipos: [tab === 'furia' ? 'furia' : 'error'], completo: tab !== 'furia' })).filter(e => vis.has(e.sesion_id));
    if (!evs.length) {
      poner(out, emptyState({ icon: 'check', title: tab === 'furia' ? 'Sin clics de furia en este período' : 'Sin errores en este período',
        text: tab === 'furia' ? 'Un clic de furia son 3 o más clics rápidos en el mismo lugar: suele indicar algo que no responde.' : 'Se registran los errores de JavaScript que ven los visitantes en la tienda.' }));
      return;
    }
    // Agrupar por mensaje (errores) o por página + elemento (furia); orden: sesiones afectadas
    const grupos = new Map();
    for (const e of evs) {
      const k = tab === 'furia' ? `${e.ruta}|${e.texto || e.selector || '(elemento sin texto)'}` : (e.datos?.mensaje || e.texto || 'Error');
      const g = grupos.get(k) || { k, n: 0, ses: new Set(), vis: new Set(), rutas: new Set(), ultima: e.creado_en, fuente: e.datos?.fuente || '', texto: e.texto || e.selector, ruta: e.ruta };
      g.n++; g.ses.add(e.sesion_id); g.vis.add(vis.get(e.sesion_id)); g.rutas.add(e.ruta); if (e.creado_en > g.ultima) g.ultima = e.creado_en;
      grupos.set(k, g);
    }
    const filas = [...grupos.values()].sort((a, b) => b.ses.size - a.ses.size || b.n - a.n);
    const afectadas = new Set(evs.map(e => e.sesion_id)).size;
    const cols = tab === 'furia' ? [
      { label: 'Página', value: g => nombrePagina(g.ruta) }, { label: 'Elemento', value: g => g.texto || '—' },
      { label: 'Veces', value: g => g.n, num: true }, { label: 'Sesiones', value: g => g.ses.size, num: true }, { label: 'Visitantes', value: g => g.vis.size, num: true },
      { label: 'Última vez', value: g => fmtDate(g.ultima) },
      { label: '', value: g => el('button', { class: 'btn small', type: 'button', text: 'Ver sesiones', onclick: () => verSesiones(go, [...g.ses], `clics de furia en «${g.texto}»`, rango) }), csv: () => '' },
    ] : [
      { label: 'Error', value: g => el('div', {}, el('strong', { text: g.k.slice(0, 200) }), g.fuente ? el('div', { class: 'muted small', text: g.fuente }) : null), csv: g => g.k },
      { label: 'Páginas', value: g => [...g.rutas].map(nombreCorto).join(', ') },
      { label: 'Veces', value: g => g.n, num: true }, { label: 'Sesiones', value: g => g.ses.size, num: true }, { label: 'Visitantes', value: g => g.vis.size, num: true },
      { label: 'Última vez', value: g => fmtDate(g.ultima) },
      { label: '', value: g => el('button', { class: 'btn small', type: 'button', text: 'Ver sesiones', onclick: () => verSesiones(go, [...g.ses], `error «${g.k.slice(0, 60)}»`, rango) }), csv: () => '' },
    ];
    poner(out, 
      el('div', { class: 'kpi-grid' },
        el('div', { class: 'kpi warn' }, el('span', { text: tab === 'furia' ? 'Clics de furia' : 'Errores' }), el('strong', { text: String(evs.length) })),
        el('div', { class: 'kpi' }, el('span', { text: 'Tipos distintos' }), el('strong', { text: String(filas.length) })),
        el('div', { class: 'kpi' }, el('span', { text: 'Sesiones afectadas' }), el('strong', { text: `${afectadas} · ${pct(afectadas, ss.length)}` }))),
      el('p', { class: 'muted', text: 'Ordenados por la cantidad de sesiones afectadas: primero lo que más molesta a los clientes.' }),
      el('div', { class: 'actions' }, el('button', { class: 'btn small', type: 'button', text: 'Descargar CSV', onclick: () => downloadCsv(`${tab}-${rango.desde}-a-${rango.hasta}.csv`, cols, filas) })),
      dataTable(cols, filas));
  } catch (e) { console.error(e); poner(out, errorAnalitica(e)); }
}

/* =================================================================== *
 * Ajustes
 * =================================================================== */
export async function renderAjustesAnalitica(main) {
  poner(main, loading());
  try {
    const c = (await configAnalitica()) || { activa: true, grabar: true, retencion_dias: 90 };
    const { count: nSes } = await db().from('analitica_sesiones').select('id', { count: 'exact', head: true });
    const { count: nGrab } = await db().from('analitica_sesiones').select('id', { count: 'exact', head: true }).gt('grabacion_partes', 0);
    const activa = el('input', { type: 'checkbox', checked: c.activa });
    const grabar = el('input', { type: 'checkbox', checked: c.grabar });
    const dias = el('select', { class: 'input' }, ...[30, 60, 90, 180, 365, 730].map(d => el('option', { value: String(d), text: `${d} días`, selected: d === c.retencion_dias })));
    const msg = el('p', { class: 'msg', role: 'status' });
    poner(main, 
      el('div', { class: 'page-head' }, el('h2', { text: 'Ajustes de analítica' })),
      el('div', { class: 'kpi-grid' },
        el('div', { class: 'kpi' }, el('span', { text: 'Sesiones guardadas' }), el('strong', { text: String(nSes ?? 0) })),
        el('div', { class: 'kpi' }, el('span', { text: 'Con grabación' }), el('strong', { text: String(nGrab ?? 0) }))),
      tarjeta('Captura', null,
        el('label', { class: 'check' }, activa, 'Medir las visitas a la tienda (de quienes aceptan el aviso)'),
        el('label', { class: 'check' }, grabar, 'Grabar las sesiones (los formularios y los datos personales siempre se ocultan)'),
        el('div', { class: 'field' }, el('label', { text: 'Guardar los datos durante' }), dias),
        msg,
        el('div', { class: 'actions' }, el('button', { class: 'btn primary', type: 'button', text: 'Guardar', onclick: async () => {
          setMsg(msg, 'Guardando…');
          try {
            unwrap(await db().rpc('analitica_config_guardar', { p_activa: activa.checked, p_grabar: grabar.checked, p_retencion_dias: Number(dias.value) }));
            setMsg(msg, 'Guardado.', 'ok');
          } catch (e) { setMsg(msg, errText(e), 'err'); }
        } }))),
      tarjeta('Borrar datos antiguos', 'Elimina las sesiones (con sus eventos, grabaciones y notas) más antiguas que el plazo guardado.',
        el('div', { class: 'actions' }, el('button', { class: 'btn danger', type: 'button', text: 'Borrar ahora', onclick: async () => {
          if (!(await confirmDialog({ title: `¿Borrar las sesiones de hace más de ${c.retencion_dias} días?`, text: 'No se puede deshacer.', ok: 'Borrar', danger: true }))) return;
          try { const n = unwrap(await db().rpc('analitica_purgar')); limpiarCache(); snack(`${n} sesiones borradas`); renderAjustesAnalitica(main); } catch (e) { snack(errText(e), 'err'); }
        } }))),
      tarjeta('Privacidad', null, el('ul', { class: 'an-lista' },
        el('li', { text: 'La tienda pide permiso con un aviso antes de medir; quien lo rechaza no se registra.' }),
        el('li', { text: 'Los campos de formulario (contraseñas, teléfono, dirección) se ocultan en la grabación, igual que el texto de «Mi cuenta», «Mis pedidos» y el checkout.' }),
        el('li', { text: 'Solo los administradores ven las sesiones y grabaciones.' }),
        el('li', { text: 'Para ocultar otra zona de la tienda en las grabaciones, agrégale la clase an-enmascarar (texto oculto) o an-bloquear (no se graba).' }))));
  } catch (e) { console.error(e); poner(main, errorAnalitica(e)); }
}
