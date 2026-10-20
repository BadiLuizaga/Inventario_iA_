/* ------------------------------------------------------------------ *
 * Modelo de Teachable Machine. El de zapatos vive en el propio sitio
 * (modelos/zapatos/, entrenado con `npm run entrenar:modelo`), así que
 * no depende de los servidores de Google.
 * Las etiquetas se leen del metadata.json del modelo: no se cambian aquí.
 * ------------------------------------------------------------------ */
import { el } from '../ui.js';
import { DUDA } from './engine.js';

export const DEFAULT_MODEL = './modelos/zapatos/';
// Modelos anteriores (3ok2iDQGD = bebidas de prueba): si alguien los tenía guardados, se reemplazan por el actual
const LEGACY_MODELS = ['-OAMSofUz', 'WT3N3SwBa', '6X92zaJfJ', '3ok2iDQGD'];
export const isLegacy = u => LEGACY_MODELS.some(id => (u || '').includes(id));

export function normalizeUrl(u) {
  u = u.trim().split('#')[0].replace(/(model|metadata)\.json.*$/i, '');
  return u && !u.endsWith('/') ? u + '/' : u;
}

export class ModelError extends Error {
  constructor(kind, cause) { super(kind); this.kind = kind; this.cause = cause; }
}

/**
 * Clases con bajo acierto en la evaluación del modelo (reporte.json de
 * `npm run entrenar:modelo`). Un modelo sin reporte (p. ej. de la web de
 * Teachable Machine) no marca ninguna: la duda se decide en vivo.
 */
export async function clasesDebiles(base) {
  try {
    const r = await fetch(base + 'reporte.json', { cache: 'no-cache' });
    if (!r.ok) return new Set();
    const { porClase = [] } = await r.json();
    return new Set(porClase.filter(c => c.total > 0 && c.aciertos / c.total < DUDA.aciertoClase).map(c => c.clase));
  } catch (_) { return new Set(); }
}

/** Carga el modelo y hace una predicción de calentamiento. Lanza ModelError('lib' | 'load'). */
export async function loadTMModel(base) {
  if (typeof window.tmImage === 'undefined') throw new ModelError('lib');
  try {
    const m = await window.tmImage.load(base + 'model.json', base + 'metadata.json');
    await m.predict(el('canvas', { width: '224', height: '224' })); // la primera predicción es lenta: mejor hacerla ahora
    return m;
  } catch (e) {
    throw new ModelError('load', e);
  }
}
