/* ------------------------------------------------------------------ *
 * Preferencias locales del dispositivo (tema, sonido, cámara, modelo…).
 * Aquí NO se guardan productos, stock ni movimientos: esos viven en Supabase.
 *
 * La versión anterior guardaba cantidades e historial en `inventario-ia:v2`.
 * De esa clave solo se copian las preferencias; los datos antiguos se dejan
 * intactos en el navegador pero la app ya no los lee.
 * ------------------------------------------------------------------ */
import { SENS } from './classifier/engine.js';
import { isLegacy } from './classifier/model.js';

export const PREFS_KEY = 'inventario-ia:prefs';
const OLD_STORE = 'inventario-ia:v2';
const DEVICE_KEY = 'inventario-ia:device';

export const prefs = {
  cfg: { sound: true, vibrate: true, sens: 'normal', facing: 'environment', bg: '', tech: false, theme: 'auto', ...SENS.normal, release: 600 },
  customUrl: '',
};

export function applySens() { Object.assign(prefs.cfg, SENS[prefs.cfg.sens] || SENS.normal); }

export function loadPrefs() {
  try {
    const d = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null') || JSON.parse(localStorage.getItem(OLD_STORE) || 'null');
    if (d) {
      const { sound, vibrate, sens, facing, bg, tech, theme } = d.cfg || {};
      Object.assign(prefs.cfg, Object.fromEntries(Object.entries({ sound, vibrate, sens, facing, bg, tech, theme }).filter(([, v]) => v !== undefined)));
      prefs.customUrl = isLegacy(d.customUrl) ? '' : (d.customUrl || '');
    }
  } catch (_) { /* almacenamiento no disponible */ }
  applySens();
}

export function savePrefs() {
  try {
    const { sound, vibrate, sens, facing, bg, tech, theme } = prefs.cfg;
    localStorage.setItem(PREFS_KEY, JSON.stringify({ cfg: { sound, vibrate, sens, facing, bg, tech, theme }, customUrl: prefs.customUrl }));
  } catch (_) {}
}

/** Identificador anónimo de este dispositivo, para registrar el origen de los movimientos. */
export function deviceId() {
  let id = '';
  try { id = localStorage.getItem(DEVICE_KEY) || ''; } catch (_) {}
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
    try { localStorage.setItem(DEVICE_KEY, id); } catch (_) {}
  }
  return id;
}
