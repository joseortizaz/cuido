-- Catálogo de ARS: listado vigente indicado por José (búsqueda en línea de las ARS de
-- República Dominicana, más ARS Banco Central, SENASA y ARS SEMMA). Es el listado
-- disponible hasta que se obtenga información nueva de una fuente oficial del Estado.
--
--   * Se agregan las que faltaban: ARS GMA, ARS Asistanet, ARS Banco Central.
--   * Se unifica el nombre de las existentes con la redacción del listado (p. ej.
--     «Primera ARS de Humano», «MAPFRE SALUD ARS», «ARS Yunén»). El nombre anterior queda
--     como alias, así que lo ya escrito a mano se sigue reconociendo.
--   * Lo que NO está en el listado (ARS Palic Salud) se DESACTIVA, no se borra: deja de
--     ofrecerse a las clínicas, pero los seguros ya vinculados conservan su enlace.
--
-- Idempotente: se puede ejecutar de nuevo sin duplicar nada.

-- match_insurer solo reconoce aseguradoras ACTIVAS: una desactivada no se ofrece ni se
-- vincula por coincidencia de texto.
create or replace function public.match_insurer(p_name text)
returns uuid
language sql
stable
set search_path = public
as $$
  select i.id
  from public.insurers i
  where i.is_active
    and (
      public.normalize_insurer_name(i.name) = public.normalize_insurer_name(p_name)
      or exists (
        select 1 from unnest(i.aliases) a
        where public.normalize_insurer_name(a) = public.normalize_insurer_name(p_name)
      )
    )
  order by (public.normalize_insurer_name(i.name) = public.normalize_insurer_name(p_name)) desc, i.name
  limit 1;
$$;

do $$
declare
  -- [nombre, alias1, alias2, ...] -- el nombre es el que verá la clínica.
  v_list constant jsonb := '[
    ["Primera ARS de Humano", "Humano Seguros", "Primera de Humano", "Primera ARS Humano", "ARS Humano", "Humano"],
    ["ARS Universal", "Universal"],
    ["MAPFRE SALUD ARS", "ARS Mapfre Salud", "Mapfre Salud", "Mapfre"],
    ["ARS Reservas", "Reservas", "Grupo Reservas"],
    ["ARS Monumental", "Monumental", "La Monumental"],
    ["ARS Futuro", "Futuro"],
    ["ARS APS", "APS"],
    ["ARS Renacer", "Renacer"],
    ["ARS SIMAG", "Simag"],
    ["ARS Yunén", "ARS Yunen", "Yunen"],
    ["ARS Meta Salud", "Meta Salud"],
    ["ARS GMA", "GMA", "Grupo Médico Asociado"],
    ["ARS CMD", "CMD", "Colegio Médico Dominicano"],
    ["ARS ASEMAP", "Asemap"],
    ["ARS Asistanet", "Asistanet"],
    ["ARS Banco Central", "Banco Central"],
    ["SENASA", "Seguro Nacional de Salud", "ARS SENASA"],
    ["ARS SEMMA", "SEMMA"]
  ]'::jsonb;
  v_item jsonb;
  v_name text;
  v_texts text[];
  v_candidate text;
  v_id uuid;
  v_old_name text;
  v_old_aliases text[];
  v_keep uuid[] := '{}';
begin
  perform set_config('cuido.allow_readonly_write', 'on', true);

  for v_item in select value from jsonb_array_elements(v_list) loop
    v_texts := array(select jsonb_array_elements_text(v_item));
    v_name := v_texts[1];
    v_id := null;

    -- ¿Ya existe (por el nombre del listado o por alguno de sus alias), esté activa o no?
    foreach v_candidate in array v_texts loop
      select x.id into v_id
      from public.insurers x
      where public.normalize_insurer_name(x.name) = public.normalize_insurer_name(v_candidate)
         or exists (
           select 1 from unnest(x.aliases) a
           where public.normalize_insurer_name(a) = public.normalize_insurer_name(v_candidate)
         )
      order by (public.normalize_insurer_name(x.name) = public.normalize_insurer_name(v_candidate)) desc
      limit 1;
      exit when v_id is not null;
    end loop;

    if v_id is null then
      insert into public.insurers (name, aliases, is_active)
      values (v_name, v_texts[2:array_length(v_texts, 1)], true)
      returning id into v_id;
    else
      select x.name, x.aliases into v_old_name, v_old_aliases from public.insurers x where x.id = v_id;
      -- Alias: los que ya tenía + los del listado + el nombre anterior si cambia; sin repetir el nombre nuevo.
      update public.insurers
        set name = v_name,
            aliases = array(
              select distinct a
              from unnest(
                coalesce(v_old_aliases, '{}')
                || v_texts[2:array_length(v_texts, 1)]
                || case when v_old_name <> v_name then array[v_old_name] else '{}'::text[] end
              ) a
              where public.normalize_insurer_name(a) <> public.normalize_insurer_name(v_name)
              order by a
            ),
            is_active = true,
            updated_at = now()
        where id = v_id;
    end if;

    v_keep := v_keep || v_id;
  end loop;

  -- Lo que no está en el listado se desactiva (no se borra).
  update public.insurers set is_active = false, updated_at = now()
    where is_active and not (id = any(v_keep));

  -- insurer_name es una instantánea del catálogo: se refresca en los seguros ya vinculados.
  update public.patient_insurers pi
    set insurer_name = i.name
    from public.insurers i
    where pi.insurer_id = i.id and pi.insurer_name <> i.name;
end;
$$;
