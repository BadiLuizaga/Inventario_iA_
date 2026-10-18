/* Utilidades del panel: tablas, formularios en diálogo y exportación CSV. */
import { el, setMsg, errText } from '../ui.js';

/**
 * Tabla de datos.
 * @param {Array<{label: string, value: (row) => any, num?: boolean}>} cols
 */
export function dataTable(cols, rows, { rowClass = null } = {}) {
  return el('div', { class: 'table-wrap' }, el('table', { class: 'data' },
    el('thead', {}, el('tr', {}, ...cols.map(c => el('th', { class: c.num ? 'num' : '', text: c.label })))),
    el('tbody', {}, ...rows.map(r => el('tr', { class: rowClass ? rowClass(r) || '' : '' },
      ...cols.map(c => { const v = c.value(r); return el('td', { class: c.num ? 'num' : '' }, v instanceof Node ? v : (v ?? '—') === '' ? '—' : String(v ?? '—')); }))))));
}

/** Descarga filas como CSV (separador «;», compatible con Excel en español). */
export function downloadCsv(name, cols, rows) {
  const esc = v => { const s = v === null || v === undefined ? '' : String(v); return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const text = [cols.map(c => esc(c.label)).join(';'), ...rows.map(r => cols.map(c => { const v = (c.csv || c.value)(r); return esc(v instanceof Node ? v.textContent : v); }).join(';'))].join('\r\n');
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
  const a = el('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Formulario en diálogo. `fields`: [{ k, label, type: 'text'|'number'|'textarea'|'select'|'bool'|'color'|'money', required, max, min, options: [{value,text}], help }]
 * `onSubmit(values)` debe lanzar si falla; el diálogo muestra el error y no se cierra.
 */
export function formDialog({ title, fields, values = {}, submit = 'Guardar', onSubmit }) {
  return new Promise(resolve => {
    const inputs = {};
    const msg = el('p', { class: 'msg', role: 'status' });
    const btn = el('button', { class: 'btn primary', type: 'button', text: submit });
    const form = el('form', { class: 'form-grid', novalidate: true });
    for (const f of fields) {
      const id = 'f_' + f.k;
      const v = values[f.k];
      let input;
      if (f.type === 'textarea') input = el('textarea', { id, maxlength: f.max || null }, v ?? '');
      else if (f.type === 'select') input = el('select', { id }, ...(f.required ? [] : [el('option', { value: '', text: f.empty || '— Ninguno —' })]),
        ...f.options.map(o => el('option', { value: o.value, text: o.text, selected: String(v ?? '') === String(o.value) })));
      else if (f.type === 'bool') input = el('input', { id, type: 'checkbox', checked: v === undefined ? f.default !== false : !!v });
      else if (f.type === 'color') input = el('input', { id, type: 'text', maxlength: '7', placeholder: '#1F5FBF', value: v ?? '' });
      else input = el('input', { id, type: f.type === 'number' || f.type === 'money' ? 'number' : 'text', step: f.type === 'money' ? '0.01' : (f.type === 'number' ? '1' : null),
        min: f.min ?? null, maxlength: f.max || null, value: v ?? '', inputmode: f.type === 'money' ? 'decimal' : (f.type === 'number' ? 'numeric' : null), list: f.list || null });
      inputs[f.k] = input;
      form.append(f.type === 'bool'
        ? el('label', { class: 'check' }, input, f.label)
        : el('div', { class: 'field' }, el('label', { for: id, text: f.label + (f.required ? ' *' : '') }), input, f.help ? el('small', { text: f.help }) : null));
    }
    form.append(msg, el('button', { type: 'submit', hidden: true, tabindex: '-1', 'aria-hidden': 'true' }));
    const d = el('dialog', { 'aria-labelledby': 'fdT' }, el('h2', { id: 'fdT', text: title }), form,
      el('div', { class: 'foot' }, el('button', { class: 'btn', type: 'button', text: 'Cancelar', onclick: () => d.close() }), btn));
    btn.addEventListener('click', () => form.requestSubmit());
    let saved = null;
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const out = {};
      for (const f of fields) {
        const i = inputs[f.k];
        i.removeAttribute('aria-invalid');
        let v;
        if (f.type === 'bool') v = i.checked;
        else if (f.type === 'number') v = i.value === '' ? null : Number(i.value);
        else if (f.type === 'money') v = i.value === '' ? null : Math.round(Number(i.value) * 100) / 100;
        else v = i.value.trim();
        if (f.type === 'select' && v === '') v = null;
        if (f.type !== 'bool' && f.type !== 'number' && f.type !== 'money' && f.type !== 'select' && v === '' && !f.required) v = f.nullable ? null : '';
        const bad = (f.required && (v === null || v === '')) ? 'es obligatorio'
          : (f.type === 'number' && v !== null && (!Number.isInteger(v) || (f.min !== undefined && v < f.min))) ? `debe ser un número entero${f.min !== undefined ? ` ≥ ${f.min}` : ''}`
            : (f.type === 'money' && v !== null && (!Number.isFinite(v) || v < 0)) ? 'debe ser un importe válido (0 o más)'
              : (f.type === 'color' && v && !/^#[0-9A-Fa-f]{6}$/.test(v)) ? 'debe tener el formato #RRGGBB'
                : (f.max && typeof v === 'string' && v.length > f.max) ? `admite hasta ${f.max} caracteres` : '';
        if (bad) { i.setAttribute('aria-invalid', 'true'); i.focus(); setMsg(msg, `«${f.label}» ${bad}.`, 'err'); return; }
        if (f.type === 'color' && v === '') v = null;
        out[f.k] = v;
      }
      btn.disabled = true; setMsg(msg, 'Guardando…');
      try { saved = (await onSubmit(out)) ?? out; d.close(); }
      catch (err) { console.error(err); setMsg(msg, errText(err), 'err'); btn.disabled = false; }
    });
    d.addEventListener('close', () => { d.remove(); resolve(saved); });
    document.body.append(d);
    d.showModal();
  });
}
