/* ------------------------------------------------------------------ *
 * Modelo de Teachable Machine (el mismo del clasificador original).
 * Las etiquetas se leen del metadata.json del modelo: no se cambian aquí.
 * ------------------------------------------------------------------ */
import { el } from '../ui.js';

export const DEFAULT_MODEL = 'https://teachablemachine.withgoogle.com/models/3ok2iDQGD/';
// Modelos anteriores: si alguien los tenía guardados, se reemplazan por el actual
const LEGACY_MODELS = ['-OAMSofUz', 'WT3N3SwBa', '6X92zaJfJ'];
export const isLegacy = u => LEGACY_MODELS.some(id => (u || '').includes(id));

export function normalizeUrl(u) {
  u = u.trim().split('#')[0].replace(/(model|metadata)\.json.*$/i, '');
  return u && !u.endsWith('/') ? u + '/' : u;
}

export class ModelError extends Error {
  constructor(kind, cause) { super(kind); this.kind = kind; this.cause = cause; }
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
