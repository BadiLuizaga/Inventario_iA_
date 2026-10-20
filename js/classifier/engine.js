/* ------------------------------------------------------------------ *
 * Motor de detección estable (heredado sin cambios del clasificador original)
 * El modelo da UNA etiqueta por cuadro: se reconoce un producto a la vez.
 * Se confirma durante `hold` ms y no se vuelve a reportar hasta que el
 * cuadro quede sin producto `release` ms (o aparezca otro producto distinto).
 *
 * En esta versión, `counted` significa «detección confirmada»: la app la
 * muestra como propuesta y NUNCA modifica el stock por sí sola.
 * ------------------------------------------------------------------ */
const TAU = 140;    // ms, suavizado de las probabilidades
const GRACE = 250;  // ms que se tolera perder el producto sin reiniciar la confirmación

export const SENS = { fast: { threshold: 75, hold: 500 }, normal: { threshold: 85, hold: 800 }, safe: { threshold: 92, hold: 1100 } };
export const BG_RE = /^(fondo|vac[ií]o|vacia|nada|ning[uú]n|sin\s|background|empty|none|nothing|blank)/i;

/* ------------------------------------------------------------------ *
 * Duda: el modelo se equivoca a veces con mucha seguridad (en la
 * evaluación confundió una bota con un Oxford al 100 %), así que la
 * confianza sola no basta. Una propuesta pide confirmación explícita si:
 *  - la confianza suavizada es baja,
 *  - la segunda clase está cerca (poco margen),
 *  - la clase cuadro a cuadro cambió durante la confirmación (inestable),
 *  - la clase tuvo bajo acierto en la evaluación del modelo (reporte.json), o
 *  - la segunda clase es una de esas clases débiles y no es despreciable:
 *    un zapato de clase débil suele salir como otra clase con seguridad
 *    (un escolar clásico del catálogo dio «Bota de Trabajo» 90 %, escolar 10 %).
 * ------------------------------------------------------------------ */
export const DUDA = { confianza: 0.90, margen: 0.30, inestable: 0.20, aciertoClase: 0.75, alternativaDebil: 0.05 };

/** Motivos de duda de una detección confirmada (vacío = propuesta clara). */
export function motivosDuda(d, clasesDebiles = new Set()) {
  const m = [];
  const cerca = d.second && d.conf - d.secondConf < DUDA.margen;
  if (d.conf < DUDA.confianza) m.push('confianza baja');
  if (cerca) m.push(`se parece a «${d.second}»`);
  if (d.inestable > DUDA.inestable) m.push('la lectura cambió mientras se confirmaba');
  if (clasesDebiles.has(d.label)) m.push('este modelo confunde a menudo esta clase');
  else if (!cerca && d.second && clasesDebiles.has(d.second) && d.secondConf >= DUDA.alternativaDebil) m.push(`podría ser «${d.second}», que este modelo confunde a menudo`);
  return m;
}

export class CountEngine {
  constructor(cfg) { this.cfg = cfg; this.reset(); }

  reset() {
    this.smooth = null;
    this.cand = null;
    this.locked = null;
    this.idleAt = null;
    this.lastT = null;
  }

  update(probs, now, allowCount = true) {
    const c = this.cfg;
    const gap = this.lastT === null ? Infinity : now - this.lastT;
    if (gap > 1000) { this.smooth = null; this.cand = null; this.idleAt = null; }
    this.lastT = now;

    if (!this.smooth) this.smooth = { ...probs };
    else {
      const a = 1 - Math.exp(-gap / TAU);
      for (const k in probs) {
        const prev = this.smooth[k] ?? probs[k];
        this.smooth[k] = prev + (probs[k] - prev) * a;
      }
    }

    let best = null, bp = -1;
    for (const k in this.smooth) if (this.smooth[k] > bp) { bp = this.smooth[k]; best = k; }
    const isProduct = best !== null && best !== c.bg && bp >= c.threshold / 100;

    // Clase ganadora del cuadro sin suavizar: si discrepa del candidato, la lectura es inestable
    let raw = null, rp = -1;
    for (const k in probs) if (probs[k] > rp) { rp = probs[k]; raw = k; }
    if (this.cand) { this.cand.frames++; if (raw !== this.cand.label) this.cand.disagree++; }

    if (isProduct) {
      this.idleAt = null;
      if (!this.cand || this.cand.label !== best) this.cand = { label: best, since: now, lostFor: 0, frames: 1, disagree: raw === best ? 0 : 1 };
      else this.cand.lostFor = 0;
    } else {
      if (this.idleAt === null) this.idleAt = now;
      if (this.locked && now - this.idleAt >= c.release) this.locked = null;
      if (this.cand) {
        this.cand.lostFor += gap;
        this.cand.since += gap;
        if (this.cand.lostFor > GRACE) this.cand = null;
      }
    }

    let counted = null, detail = null, progress = 0;
    if (this.cand) {
      progress = Math.min(1, (now - this.cand.since) / c.hold);
      if (allowCount && isProduct && progress >= 1 && this.locked !== this.cand.label) {
        this.locked = this.cand.label;
        counted = this.cand.label;
        // Segunda clase más probable, sin contar el fondo
        let second = null, sp = 0;
        for (const k in this.smooth) if (k !== counted && k !== c.bg && this.smooth[k] > sp) { sp = this.smooth[k]; second = k; }
        detail = { label: counted, conf: this.smooth[counted], second, secondConf: sp, inestable: this.cand.disagree / this.cand.frames };
      }
    }

    let state = 'idle';
    if (!allowCount) state = 'paused';
    else if (this.cand && this.locked === this.cand.label) state = 'counted';
    else if (this.cand) state = 'detecting';

    return {
      state, best, counted, detail,
      label: this.cand ? this.cand.label : null,
      conf: this.cand ? (this.smooth[this.cand.label] || 0) : bp,
      progress: state === 'counted' ? 1 : state === 'paused' ? 0 : progress,
    };
  }
}
