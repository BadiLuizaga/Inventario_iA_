// Entrena el modelo de la cámara (Teachable Machine) con las fotos de una carpeta, en el navegador,
// con la MISMA librería que usa la app (@teachablemachine/image 0.8.5 + TensorFlow.js 1.3.1).
//
//   carpeta de fotos/            una subcarpeta por clase; el nombre = etiqueta del modelo
//     Escolar Clásico/*.jpg      (debe coincidir con productos.etiqueta_clasificador)
//     Fondo y otros/*.jpg        clase de fondo (sin zapatos)
//
// Uso: npm run entrenar:modelo -- [carpeta de fotos] [carpeta de fotos de prueba]
//      y abrir http://localhost:8090 en Chrome. Al terminar guarda modelos/zapatos/ y se cierra.
// El 20 % de cada clase no se usa para entrenar: sirve para medir el acierto, y las que el
// modelo reconoce con más seguridad se copian a la carpeta de fotos de prueba.
import { createServer } from 'node:http';
import { readFile, readdir, writeFile, mkdir, copyFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { ROOT } from './lib/supabase-local.mjs';

const FOTOS = resolve(process.argv[2] || join(ROOT, '..', 'entrenamiento-ia'));
const PRUEBAS = resolve(process.argv[3] || join(ROOT, '..', 'fotos-prueba'));
const SALIDA = join(ROOT, 'modelos', 'zapatos');
const PORT = Number(process.env.TRAIN_PORT) || 8090;
const IMG = /\.(jpe?g|png|webp)$/i;
const TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

async function lista() {
  const clases = [];
  for (const d of (await readdir(FOTOS, { withFileTypes: true })).filter(d => d.isDirectory()).sort((a, b) => a.name.localeCompare(b.name, 'es'))) {
    const fotos = (await readdir(join(FOTOS, d.name))).filter(f => IMG.test(f)).sort();
    if (fotos.length) clases.push({ nombre: d.name, fotos });
  }
  // la clase de fondo al final (como en Teachable Machine)
  return clases.sort((a, b) => /^fondo/i.test(a.nombre) - /^fondo/i.test(b.nombre));
}

async function guardar(datos) {
  await mkdir(SALIDA, { recursive: true });
  await writeFile(join(SALIDA, 'model.json'), JSON.stringify(datos.modelJson));
  await writeFile(join(SALIDA, 'model.weights.bin'), Buffer.from(datos.pesos, 'base64'));
  await writeFile(join(SALIDA, 'metadata.json'), JSON.stringify(datos.metadata));
  await writeFile(join(SALIDA, 'reporte.json'), JSON.stringify(datos.reporte, null, 2) + '\n');
  // fotos de prueba: no vistas en el entrenamiento y reconocidas con seguridad
  const lineas = ['clase;archivo_original;probabilidad'];
  for (const p of datos.reporte.fotosPrueba) {
    await mkdir(join(PRUEBAS, p.clase), { recursive: true });
    const destino = `${String(Math.round(p.probabilidad * 100)).padStart(3, '0')}-${p.archivo}`;
    await copyFile(join(FOTOS, p.clase, p.archivo), join(PRUEBAS, p.clase, destino));
    lineas.push(`${p.clase};${p.archivo};${p.probabilidad.toFixed(3)}`);
  }
  await writeFile(join(PRUEBAS, 'resultados.csv'), '﻿' + lineas.join('\r\n') + '\r\n');
}

createServer(async (req, res) => {
  const ruta = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  try {
    if (ruta === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(await readFile(join(ROOT, 'scripts', 'entrenar', 'index.html'))); return; }
    if (ruta === '/lista') { res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ clases: await lista() })); return; }
    if (ruta.startsWith('/fotos/')) {
      const archivo = resolve(FOTOS, '.' + ruta.slice('/fotos'.length));
      if (!archivo.startsWith(FOTOS + sep) || !IMG.test(archivo) || !(await stat(archivo)).isFile()) { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'Content-Type': TYPES[extname(archivo).toLowerCase()] }).end(await readFile(archivo));
      return;
    }
    if (ruta === '/guardar' && req.method === 'POST') {
      const partes = []; for await (const p of req) partes.push(p);
      const datos = JSON.parse(Buffer.concat(partes).toString('utf8'));
      await guardar(datos);
      res.writeHead(200).end('ok');
      const r = datos.reporte;
      console.log(`\nModelo guardado en ${SALIDA}`);
      console.log(`Acierto con fotos no vistas: ${(r.acierto * 100).toFixed(1)} % (${r.aciertos}/${r.total})`);
      for (const c of r.porClase) console.log(`  ${c.clase.padEnd(26)} ${c.aciertos}/${c.total}`);
      console.log(`Fotos de prueba (${r.fotosPrueba.length}) en ${PRUEBAS}`);
      setTimeout(() => process.exit(0), 300);
      return;
    }
    if (ruta === '/progreso' && req.method === 'POST') {
      const partes = []; for await (const p of req) partes.push(p);
      console.log(Buffer.concat(partes).toString('utf8'));
      res.writeHead(204).end();
      return;
    }
    res.writeHead(404).end();
  } catch (e) { console.error(e); res.writeHead(500).end(String(e.message || e)); }
}).listen(PORT, '127.0.0.1', async () => {
  const clases = await lista();
  console.log(`Fotos: ${FOTOS}`);
  for (const c of clases) console.log(`  ${c.nombre.padEnd(26)} ${c.fotos.length} fotos`);
  console.log(`\nAbre http://localhost:${PORT} en Chrome para entrenar (no cierres la pestaña hasta que termine).`);
});
