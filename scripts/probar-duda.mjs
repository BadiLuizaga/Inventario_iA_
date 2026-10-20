// Prueba de la regla de duda del escáner (js/classifier/engine.js) sin cámara: secuencias de
// probabilidades simuladas y las clases débiles del reporte del modelo actual.
// Uso: npm run test:duda
import { readFileSync } from 'node:fs';
import { CountEngine, SENS, DUDA, motivosDuda } from '../js/classifier/engine.js';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(c ? '  ✔' : '  ✘', m); };
const cfg = { ...SENS.normal, release: 600, bg: 'Fondo y otros' };
const L = ['Escolar Clásico', 'Escolar Velcro', 'Bota de Trabajo', 'Fondo y otros'];
const p = (a, b = 0, c = 0) => ({ [L[0]]: a, [L[1]]: b, [L[2]]: c, [L[3]]: Math.max(0, 1 - a - b - c) });

function correr(frames) {
  const e = new CountEngine(cfg); let t = 0, det = null;
  for (const f of frames) { t += 80; const r = e.update(f, t); if (r.detail) det = r.detail; }
  return det;
}
const repetir = (f, n) => Array.from({ length: n }, () => f);

const claro = correr(repetir(p(0.98, 0.01), 20));
ok(claro && claro.label === L[0] && motivosDuda(claro).length === 0, `lectura estable y segura → sin duda (conf ${claro?.conf.toFixed(2)})`);

ok(correr(repetir(p(0.62, 0.36), 20)) === null, 'confianza 62 % no llega al umbral normal (85 %): no se propone nada');

const baja = correr(repetir(p(0.88, 0.11), 20));
ok(baja && motivosDuda(baja).some(m => m.includes('confianza baja')), 'confianza 88 % → pide confirmación por confianza baja');

const amplio = correr(repetir(p(0.91, 0.09), 20).map((f, i) => i % 2 ? p(0.91, 0.08) : p(0.92, 0.07)));
ok(amplio && motivosDuda(amplio).length === 0, 'margen amplio (91 % vs 8 %) → sin duda');

const alt = correr(repetir(p(0.93, 0.06), 20));
ok(alt && alt.second === L[1], 'la segunda clase ignora el fondo');

// Inestable: el suavizado mantiene el candidato, pero cuadro a cuadro gana otra clase a ratos
const muyInestable = []; for (let i = 0; i < 30; i++) muyInestable.push(i % 3 === 0 ? p(0.30, 0.68) : p(0.995, 0.004));
ok(correr(muyInestable) === null, 'si alterna en 1 de cada 3 cuadros, ni siquiera se confirma');
const flip = []; for (let i = 0; i < 40; i++) flip.push(i % 4 === 0 ? p(0.45, 0.5) : p(0.995, 0.004));
const inest = correr(flip);
ok(inest && inest.inestable > DUDA.inestable && motivosDuda(inest).some(m => m.includes('cambió')), `lectura que alterna → inestable (${(inest?.inestable * 100).toFixed(0)} % de cuadros en desacuerdo)`);

// Clase débil según el reporte del modelo actual (misma regla que model.js → clasesDebiles)
const rep = JSON.parse(readFileSync(new URL('../modelos/zapatos/reporte.json', import.meta.url), 'utf8'));
const debiles = new Set(rep.porClase.filter(c => c.total > 0 && c.aciertos / c.total < DUDA.aciertoClase).map(c => c.clase));
console.log('  clases débiles del modelo actual:', [...debiles].join(', '));
ok(debiles.has('Escolar Clásico') && debiles.has('Escolar Velcro') && !debiles.has('Bota de Trabajo'), 'Escolar Clásico y Escolar Velcro quedan marcadas como débiles');
ok(motivosDuda(claro, debiles).some(m => m.includes('confunde')), 'Escolar Clásico con 98 % igual pide confirmación (clase débil)');

// Caso real (foto del catálogo): un escolar clásico leído como bota al 90 %, con el escolar de segunda
const botaConEscolar = { label: L[2], conf: 0.90, second: L[0], secondConf: 0.10, inestable: 0 };
ok(motivosDuda(botaConEscolar, debiles).some(m => m.includes('podría ser «Escolar Clásico»')), 'bota 90 % con «Escolar Clásico» 10 % de segunda → pide confirmación');
ok(motivosDuda({ ...botaConEscolar, conf: 0.99, secondConf: 0.01 }, debiles).length === 0, 'bota 99 % con la clase débil al 1 % → sin duda');
ok(motivosDuda({ ...botaConEscolar, second: 'Zapato de Vestir Oxford' }, debiles).length === 0, 'bota 90 % con una clase fuerte de segunda → sin duda');

console.log(`\n${pass} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
