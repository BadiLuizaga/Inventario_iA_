-- =====================================================================
-- Seed LOCAL: catálogo DEMO de Manaco con datos SIMULADOS.
-- Sirve para probar la tienda, la herramienta de almacén y los reportes.
-- No son modelos, precios ni existencias reales de la empresa.
--
-- * etiqueta_clasificador = nombre del producto: al entrenar el modelo de
--   Teachable Machine, cada clase debe llamarse EXACTAMENTE igual.
-- * El stock inicial entra con public._mover_stock (tipo «entrada»), así queda
--   en el historial de movimientos con su saldo, como cualquier ingreso.
-- * Las cantidades son deterministas (hash del SKU): algunas variantes quedan
--   en 0 o con pocas unidades para ver los tres estados de la tienda.
-- Requiere 01_usuarios.sql (el administrador registra los movimientos).
-- =====================================================================
do $$
declare
  v_admin    uuid := 'a0000000-0000-4000-8000-000000000001';
  v_marca    uuid;
  v_suc      uuid;
  v_central  uuid;
  v_deposito uuid;
  v_prod     uuid;
  v_var      uuid;
  v_sku      text;
  v_q        integer;
  p          record;
  c          text;
  t          integer;
begin
  if exists (select 1 from public.productos) then
    raise notice 'Ya hay productos: no se carga el catálogo demo.';
    return;
  end if;
  if not exists (select 1 from auth.users where id = v_admin) then
    raise exception 'Falta el administrador de prueba (01_usuarios.sql)';
  end if;

  insert into public.marcas (nombre) values ('Manaco') returning id into v_marca;
  insert into public.categorias (nombre, orden) values ('Escolar', 1), ('Deportivo', 2), ('Vestir', 3), ('Trabajo', 4);
  insert into public.tallas (nombre, orden) select g::text, g from generate_series(34, 44) g;
  insert into public.colores (nombre, hex) values
    ('Negro', '#1B1B1B'), ('Café', '#6B4226'), ('Blanco', '#F2F2F2'), ('Azul marino', '#1F2A44');
  insert into public.sucursales (nombre, direccion, telefono)
    values ('Sucursal Central (demo)', 'Dirección de demostración', '70000000') returning id into v_suc;
  insert into public.almacenes (sucursal_id, nombre, vende_en_linea) values (v_suc, 'Almacén Central', true) returning id into v_central;
  insert into public.almacenes (sucursal_id, nombre, vende_en_linea) values (v_suc, 'Depósito Sucursal', false) returning id into v_deposito;

  for p in
    select * from (values
      ('Escolar Clásico',         'MAN-ESC-01', 'Escolar',   189.00, 34, 40, array['Negro'],                 'Zapato escolar de cuero con suela de goma antideslizante.'),
      ('Escolar Velcro',          'MAN-ESC-02', 'Escolar',   169.00, 34, 38, array['Negro', 'Azul marino'],  'Zapato escolar con cierre de velcro, fácil de poner.'),
      ('Deportivo Runner',        'MAN-DEP-01', 'Deportivo', 279.00, 36, 44, array['Blanco', 'Azul marino'], 'Zapatilla deportiva liviana con suela de caucho.'),
      ('Zapato de Vestir Oxford', 'MAN-VES-01', 'Vestir',    359.00, 38, 44, array['Negro', 'Café'],         'Zapato de vestir de cuero con cordones.'),
      ('Mocasín Casual',          'MAN-VES-02', 'Vestir',    299.00, 38, 43, array['Café'],                  'Mocasín de cuero para uso diario.'),
      ('Bota de Trabajo',         'MAN-TRA-01', 'Trabajo',   419.00, 38, 44, array['Café', 'Negro'],         'Bota de seguridad con puntera reforzada.')
    ) as x (nombre, modelo, categoria, precio, talla_min, talla_max, colores, detalle)
  loop
    insert into public.productos (nombre, modelo, descripcion, marca_id, categoria_id, precio, publicado, etiqueta_clasificador)
    values (p.nombre, p.modelo, p.detalle || ' Producto de demostración con datos simulados.', v_marca,
            (select id from public.categorias where nombre = p.categoria and padre_id is null),
            p.precio, true, p.nombre)
    returning id into v_prod;

    foreach c in array p.colores loop
      for t in p.talla_min .. p.talla_max loop
        v_sku := p.modelo || '-' || t || '-' || upper(left(translate(c, 'é', 'e'), 2));
        insert into public.variantes (producto_id, talla_id, color_id, sku)
        values (v_prod, (select id from public.tallas where nombre = t::text), (select id from public.colores where nombre = c), v_sku)
        returning id into v_var;

        v_q := abs(hashtext(v_sku)) % 13;
        if v_q > 0 then
          perform public._mover_stock(v_var, v_central, v_q, 'entrada', 'Stock inicial (demo)', 'SEED', null, null, 'manual', 'seed', v_admin);
        end if;
        v_q := abs(hashtext(v_sku || ':deposito')) % 6;
        if v_q > 0 then
          perform public._mover_stock(v_var, v_deposito, v_q, 'entrada', 'Stock inicial (demo)', 'SEED', null, null, 'manual', 'seed', v_admin);
        end if;
      end loop;
    end loop;
  end loop;

  -- Mínimo y ubicación en el almacén principal (también para las variantes sin stock,
  -- para que aparezcan en «Bajo stock»). No cambia ninguna cantidad.
  insert into public.existencias (variante_id, almacen_id, stock_minimo, ubicacion)
  select v.id, v_central, 2, 'Estante ' || upper(left(cat.nombre, 3))
  from public.variantes v
  join public.productos pr on pr.id = v.producto_id
  join public.categorias cat on cat.id = pr.categoria_id
  on conflict (variante_id, almacen_id) do update set stock_minimo = excluded.stock_minimo, ubicacion = excluded.ubicacion;
end $$;
