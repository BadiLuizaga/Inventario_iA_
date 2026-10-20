/* ------------------------------------------------------------------ *
 * Escáner: cámara, bucle de predicción y visor.
 * Portado del clasificador original. Diferencia clave: al confirmar una
 * detección solo se avisa con `onDetect(label)`; el stock no se toca.
 * ------------------------------------------------------------------ */
import { $, el, retrigger, unlockAudio, beep, buzz } from '../ui.js';
import { CountEngine, BG_RE, motivosDuda } from './engine.js';
import { DEFAULT_MODEL, normalizeUrl, loadTMModel, clasesDebiles } from './model.js';
import { prefs, savePrefs } from '../prefs.js';

const S = {
  model: null, labels: [], url: '', modelName: '', weak: new Set(),
  mirror: false, paused: false, stream: null, running: false, busy: false, lastPred: 0, raf: 0, wake: null,
  lastStatus: null, disp: null, dispAt: 0, dispDraw: 0,
};
const engine = new CountEngine(prefs.cfg);
const video = $('#video');
let isVisible = () => true;
let hooks = { onDetect: () => {}, onModelStatus: () => {} };

export const scannerState = S;
export const products = () => S.labels.filter(l => l !== prefs.cfg.bg);

/* ---------- visor ---------- */
let startAction = null;
function showStart({ text, hint = '', button = '', onClick = null, busy = false }) {
  $('#vfStart').hidden = false;
  $('#vfSpin').hidden = !busy; $('#vfIcon').toggleAttribute('hidden', busy);
  $('#vfMsg').textContent = text;
  $('#vfHint').textContent = hint; $('#vfHint').hidden = !hint;
  const b = $('#btnStart'); b.hidden = !button; b.textContent = button;
  startAction = onClick;
  $('#vfStatus').hidden = true; $('#camSet').hidden = true;
  $('#vf').dataset.state = 'off';
}

function renderStatus(r) {
  S.lastStatus = r;
  $('#vf').dataset.state = r.state; $('#vfStatus').dataset.state = r.state;
  let text = 'Muestra un producto', sub = 'Un producto a la vez', showDot = false;
  if (r.state === 'detecting') { text = r.label; sub = 'Mantenlo quieto un momento…'; showDot = true; }
  else if (r.state === 'counted') { text = '✓ ' + r.label; sub = 'Reconocido · Retíralo para el siguiente'; showDot = true; }
  else if (r.state === 'paused') { text = 'En pausa'; sub = 'Toca ▶ para seguir reconociendo'; }
  $('#vfText').textContent = text; $('#vfSub').textContent = sub;
  $('#vfDot').hidden = !showDot;
  $('#vfBar').style.width = (r.progress * 100).toFixed(0) + '%';
}

function buildProbs() {
  const probs = $('#probs');
  probs.replaceChildren();
  S.labels.forEach(label => probs.append(el('div', { class: 'prob', 'data-label': label },
    el('span', { text: label }), el('div', { class: 'track' }, el('div', { class: 'fill' })), el('output', { text: '0%' }))));
}
function renderProbs(smooth) {
  if (!prefs.cfg.tech) return;
  const now = performance.now(), dt = S.dispAt ? now - S.dispAt : 1000;
  S.dispAt = now;
  const a = 1 - Math.exp(-dt / 700);               // promedio lento, solo para mostrar
  const d = S.disp = S.disp || {};
  for (const k in smooth) d[k] = (d[k] ?? smooth[k]) + (smooth[k] - (d[k] ?? smooth[k])) * a;
  if (now - S.dispDraw < 350) return;              // se redibuja unas 3 veces por segundo
  S.dispDraw = now;
  let top = null, tp = -1;
  for (const k in d) if (d[k] > tp) { tp = d[k]; top = k; }
  for (const row of $('#probs').children) {
    const p = d[row.dataset.label] || 0;
    $('.fill', row).style.width = (p * 100).toFixed(0) + '%';
    $('output', row).textContent = (Math.round(p * 20) * 5) + '%';   // de 5 en 5
    row.classList.toggle('top', row.dataset.label === top);
  }
}

function onPreds(preds, now) {
  const probs = {};
  for (const p of preds) probs[p.className] = p.probability;
  const r = engine.update(probs, now, !S.paused);
  renderProbs(engine.smooth);
  renderStatus(r);
  if (r.counted) {
    const pop = $('#pop'); pop.className = 'pop'; pop.textContent = r.counted; retrigger(pop, 'show');
    retrigger($('#flash'), 'on');
    beep(prefs.cfg.sound, 880); buzz(prefs.cfg.vibrate, 50);
    hooks.onDetect(r.counted, { ...r.detail, motivos: motivosDuda(r.detail, S.weak), modelo: S.modelName });
  }
}

/* ---------- cámara ---------- */
function cameraError(e) {
  switch (e && e.name) {
    case 'NotAllowedError': case 'SecurityError':
      return 'No tengo permiso para usar la cámara. Toca el candado junto a la dirección, permite la cámara y vuelve a intentar.';
    case 'NotFoundError': case 'OverconstrainedError':
      return 'No encontré una cámara en este dispositivo.';
    case 'NotReadableError':
      return 'Otra aplicación está usando la cámara. Ciérrala y vuelve a intentar.';
    default:
      return 'No se pudo encender la cámara. Vuelve a intentar.';
  }
}

const READY_HINT = 'Muestra un producto a la vez y retíralo antes del siguiente.';

export async function startCamera() {
  if (!S.model) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showStart({ text: 'La cámara solo funciona si la página se abre con https:// (o en localhost).', button: 'Intentar de nuevo', onClick: startCamera });
    return;
  }
  stopCamera(true);
  showStart({ text: 'Encendiendo la cámara…', busy: true });
  try {
    unlockAudio();
    S.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: prefs.cfg.facing }, width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    video.srcObject = S.stream;
    await video.play();

    const facing = S.stream.getVideoTracks()[0].getSettings().facingMode;
    S.mirror = facing !== 'environment';
    $('#optMirror').checked = S.mirror;
    video.classList.toggle('mirror', S.mirror);

    try {
      const cams = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
      $('#btnFlip').hidden = cams.length < 2;
    } catch (_) { $('#btnFlip').hidden = false; }

    S.running = true; setPaused(false);
    engine.reset(); S.disp = null;
    $('#vfStart').hidden = true; $('#vfStatus').hidden = false; $('#camSet').hidden = false;
    renderStatus({ state: 'idle', label: null, progress: 0 });
    lockScreen();
    loop();
  } catch (e) {
    stopCamera(true);
    showStart({ text: cameraError(e), button: 'Intentar de nuevo', onClick: startCamera });
  }
}

export function stopCamera(silent) {
  S.running = false;
  cancelAnimationFrame(S.raf);
  if (S.stream) S.stream.getTracks().forEach(t => t.stop());
  S.stream = null;
  video.srcObject = null;
  if (S.wake) { S.wake.release().catch(() => {}); S.wake = null; }
  engine.reset();
  if (!silent && S.model) showStart({ text: 'Cámara apagada', hint: READY_HINT, button: 'Activar cámara', onClick: startCamera });
}

export function setPaused(p) {
  S.paused = p;
  const b = $('#btnPause');
  b.setAttribute('aria-pressed', String(p));
  b.setAttribute('aria-label', p ? 'Seguir reconociendo' : 'Pausar el reconocimiento');
  b.title = p ? 'Seguir' : 'Pausar';
  $('#icPause').toggleAttribute('hidden', p); $('#icPlay').toggleAttribute('hidden', !p);
  if (S.running) { engine.reset(); renderStatus({ state: p ? 'paused' : 'idle', label: null, progress: 0 }); }
}

async function lockScreen() {
  try {
    if ('wakeLock' in navigator && !S.wake) {
      S.wake = await navigator.wakeLock.request('screen');
      S.wake.addEventListener('release', () => { S.wake = null; });
    }
  } catch (_) {}
}

const PRED_EVERY = 80;
function loop() {
  if (!S.running) return;
  const now = performance.now();
  if (!isVisible()) engine.reset();   // fuera de la pantalla del escáner no se reconoce
  else if (!S.busy && now - S.lastPred >= PRED_EVERY && video.readyState >= 2 && video.videoWidth > 0) {
    S.busy = true; S.lastPred = now;
    S.model.predict(video, S.mirror)
      .then(preds => { if (S.running && isVisible()) onPreds(preds, performance.now()); })
      .catch(e => console.error('predict', e))
      .finally(() => { S.busy = false; });
  }
  S.raf = requestAnimationFrame(loop);
}

/* ---------- modelo ---------- */
function setLabels(labels) {
  S.labels = labels;
  if (!labels.includes(prefs.cfg.bg)) prefs.cfg.bg = labels.find(l => BG_RE.test(l.trim())) || '';
  engine.reset();
  buildProbs(); savePrefs();
}

/** Carga el modelo. Si falla, muestra un error comprensible y el resto de la app sigue funcionando. */
export async function loadModel(rawUrl) {
  const base = normalizeUrl(rawUrl);
  stopCamera(true);
  showStart({ text: 'Preparando el reconocimiento…', busy: true });
  hooks.onModelStatus({ state: 'loading' });
  try {
    const m = await loadTMModel(base);
    try { if (S.model && S.model.dispose) S.model.dispose(); } catch (_) { /* el modelo viejo ya estaba liberado */ }
    S.model = m; S.url = base;
    S.modelName = (m.getMetadata && m.getMetadata().modelName) || base;
    S.weak = await clasesDebiles(base);
    setLabels(m.getClassLabels());
    showStart({ text: 'Todo listo', hint: READY_HINT, button: 'Activar cámara', onClick: startCamera });
    hooks.onModelStatus({ state: 'ready', labels: products(), custom: base !== DEFAULT_MODEL });
    return true;
  } catch (e) {
    console.error(e.cause || e);
    const text = e.kind === 'lib'
      ? 'No se pudo descargar la librería de reconocimiento. Revisa tu internet y vuelve a intentar.'
      : 'No se pudo preparar el reconocimiento. Revisa tu internet y vuelve a intentar.';
    showStart({ text, hint: 'El resto de la aplicación sigue disponible.', button: 'Reintentar', onClick: () => (e.kind === 'lib' ? location.reload() : loadModel(rawUrl)) });
    hooks.onModelStatus({ state: 'error', kind: e.kind });
    return false;
  }
}

export function resetEngine() { engine.reset(); }
export function setMirror(m) { S.mirror = m; video.classList.toggle('mirror', m); }

export function initScanner(opts) {
  hooks = { ...hooks, ...opts.hooks };
  isVisible = opts.isVisible;
  $('#pop').addEventListener('animationend', () => $('#pop').classList.remove('show'));
  $('#flash').addEventListener('animationend', () => $('#flash').classList.remove('on'));
  $('#btnStart').addEventListener('click', () => startAction && startAction());
  $('#btnPause').addEventListener('click', () => setPaused(!S.paused));
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.running) lockScreen(); });
}
