"""
Convierte el Excel de comercio de calzado (caso Manaco) en el seed SQL de
public.mercado_comercio. Solo usa la librería estándar de Python.

Uso:
  python scripts/excel_a_sql.py "<ruta al .xlsx>" [supabase/seed/03_mercado_manaco.sql]

Limpieza que aplica:
  * columnas por NOMBRE (sin tildes ni mayúsculas), no por posición;
  * flujo normalizado: «Importación» → importacion, «Exportación» → exportacion;
  * valor en USD redondeado a 2 decimales (el Excel trae restos de coma flotante);
  * «Valor_miles_USD» y «Valor_USD_por_par» no se copian: el valor por par lo
    calcula la base (columna generada) y aquí solo se verifica que coincida.
"""
import re
import sys
import unicodedata
import xml.etree.ElementTree as ET
import zipfile
from collections import Counter
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
      'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}
DEFAULT_OUT = Path(__file__).resolve().parent.parent / 'supabase' / 'seed' / '03_mercado_manaco.sql'
COLUMNAS = {  # nombre normalizado en el Excel → uso
    'pais_reportante': 'pais', 'flujo_comercial': 'flujo', 'ano': 'anio', 'codigo_sa6': 'codigo',
    'categoria_calzado': 'categoria', 'socio_comercial': 'socio', 'valor_usd': 'valor',
    'cantidad_pares': 'pares', 'valor_usd_por_par': 'por_par',
}


def norm(s):
    s = unicodedata.normalize('NFD', str(s)).encode('ascii', 'ignore').decode().lower().strip()
    return re.sub(r'[^a-z0-9]+', '_', s).strip('_')


def col_index(ref):
    n = 0
    for ch in re.match(r'[A-Z]+', ref).group():
        n = n * 26 + ord(ch) - 64
    return n - 1


def leer_primera_hoja(path):
    with zipfile.ZipFile(path) as z:
        compartidas = []
        if 'xl/sharedStrings.xml' in z.namelist():
            for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si', NS):
                compartidas.append(''.join(t.text or '' for t in si.iter('{%s}t' % NS['m'])))
        libro = ET.fromstring(z.read('xl/workbook.xml'))
        rels = {r.get('Id'): r.get('Target') for r in ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
        hoja = libro.find('m:sheets', NS)[0]
        destino = rels[hoja.get('{%s}id' % NS['r'])].lstrip('/')
        destino = destino if destino.startswith('xl/') else 'xl/' + destino
        filas = []
        for fila in ET.fromstring(z.read(destino)).findall('.//m:sheetData/m:row', NS):
            valores = {}
            for c in fila.findall('m:c', NS):
                tipo, v = c.get('t'), c.find('m:v', NS)
                if tipo == 'inlineStr':
                    valores[col_index(c.get('r'))] = ''.join(t.text or '' for t in c.iter('{%s}t' % NS['m']))
                elif v is not None:
                    valores[col_index(c.get('r'))] = compartidas[int(v.text)] if tipo == 's' else v.text
            if valores:
                filas.append([valores.get(i, '') for i in range(max(valores) + 1)])
        return hoja.get('name'), filas


def sql_text(s):
    return "'" + str(s).replace("'", "''") + "'"


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    origen = Path(sys.argv[1])
    salida = Path(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_OUT
    nombre_hoja, filas = leer_primera_hoja(origen)
    encabezado = [norm(h) for h in filas[0]]
    faltan = [k for k in COLUMNAS if k not in encabezado]
    if faltan:
        sys.exit(f'Faltan columnas en el Excel: {", ".join(faltan)}')
    idx = {COLUMNAS[k]: encabezado.index(k) for k in COLUMNAS}

    registros, avisos = [], []
    for n, f in enumerate(filas[1:], start=2):
        get = lambda k: str(f[idx[k]]).strip() if idx[k] < len(f) else ''
        flujo = norm(get('flujo'))
        if flujo not in ('importacion', 'exportacion'):
            sys.exit(f'Fila {n}: flujo desconocido «{get("flujo")}»')
        valor = Decimal(get('valor')).quantize(Decimal('0.01'), ROUND_HALF_UP)
        pares = int(Decimal(get('pares'))) if get('pares') else None
        if pares and get('por_par'):
            calc = (valor / pares).quantize(Decimal('0.01'), ROUND_HALF_UP)
            if abs(calc - Decimal(get('por_par'))) > Decimal('0.01'):
                avisos.append(f'Fila {n}: valor por par {get("por_par")} ≠ calculado {calc}')
        registros.append((get('pais'), flujo, int(Decimal(get('anio'))), get('codigo'), get('categoria'), get('socio'), valor, pares))

    repetidas = sum(1 for c in Counter((r[1], r[2], r[3], r[5]) for r in registros).values() if c > 1)
    paises = sorted({r[0] for r in registros})
    lineas = [
        '-- =====================================================================',
        '-- Seed: mercado de calzado (caso Manaco). GENERADO por scripts/excel_a_sql.py',
        f'-- Origen: «{origen.name}», hoja «{nombre_hoja}» · {len(registros)} filas.',
        f'-- {repetidas} combinaciones de flujo, año, código y socio aparecen repetidas: se conservan.',
        '-- Idempotente: reemplaza los registros de los países que trae el archivo.',
        '-- =====================================================================',
        f'delete from public.mercado_comercio where pais_reportante in ({", ".join(sql_text(p) for p in paises)});',
        '',
        'insert into public.mercado_comercio (pais_reportante, flujo, anio, codigo_sa6, categoria, socio, valor_usd, pares) values',
    ]
    valores = [f'  ({sql_text(p)}, {sql_text(fl)}, {a}, {sql_text(c)}, {sql_text(cat)}, {sql_text(s)}, {v}, {"null" if pa is None else pa})'
               for p, fl, a, c, cat, s, v, pa in registros]
    lineas.append(',\n'.join(valores) + ';')
    salida.parent.mkdir(parents=True, exist_ok=True)
    salida.write_text('\n'.join(lineas) + '\n', encoding='utf-8', newline='\n')

    sys.stdout.reconfigure(encoding='utf-8')
    print(f'{len(registros)} filas → {salida}')
    print(f'Combinaciones repetidas: {repetidas} · avisos de valor por par: {len(avisos)}')
    for a in avisos[:10]:
        print('  ' + a)


if __name__ == '__main__':
    main()
