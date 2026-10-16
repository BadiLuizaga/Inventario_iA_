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

    if (isProduct) {
      this.idleAt = null;
      if (!this.cand || this.cand.label !== best) this.cand = { label: best, since: now, lostFor: 0 };
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

    let counted = null, progress = 0;
    if (this.cand) {
      progress = Math.min(1, (now - this.cand.since) / c.hold);
      if (allowCount && isProduct && progress >= 1 && this.locked !== this.cand.label) {
        this.locked = this.cand.label;
        counted = this.cand.label;
      }
    }

    let state = 'idle';
    if (!allowCount) state = 'paused';
    else if (this.cand && this.locked === this.cand.label) state = 'counted';
    else if (this.cand) state = 'detecting';

    return {
      state, best, counted,
      label: this.cand ? this.cand.label : null,
      conf: this.cand ? (this.smooth[this.cand.label] || 0) : bp,
      progress: state === 'counted' ? 1 : state === 'paused' ? 0 : progress,
    };
  }
}
