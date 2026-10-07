-- ARS Palic Salud se transformó en MAPFRE (verificado por José). No debe existir como ARS
-- aparte: se fusiona dentro de «MAPFRE SALUD ARS».
--   * Palic, Palic Salud y ARS Palic Salud pasan a ser alias de MAPFRE SALUD ARS, así que lo
--     escrito a mano con esos nombres se reconoce como MAPFRE.
--   * Los seguros de pacientes que estuvieran vinculados a Palic se re-vinculan a MAPFRE.
--   * La fila de Palic se elimina del catálogo.
-- Idempotente: si ya no existe Palic, no hace nada.

do $$
declare
  v_mapfre uuid;
  v_palic uuid;
begin
  perform set_config('cuido.allow_readonly_write', 'on', true);

  select i.id into v_mapfre
  from public.insurers i
  where public.normalize_insurer_name(i.name) = public.normalize_insurer_name('MAPFRE SALUD ARS')
  limit 1;

  select i.id into v_palic
  from public.insurers i
  where public.normalize_insurer_name(i.name) = public.normalize_insurer_name('ARS Palic Salud')
  limit 1;

  if v_mapfre is null then
    return; -- sin MAPFRE en el catálogo no hay a dónde fusionar
  end if;

  update public.insurers
    set aliases = array(
          select distinct a
          from unnest(aliases || array['ARS Palic Salud', 'Palic Salud', 'Palic']) a
          where public.normalize_insurer_name(a) <> public.normalize_insurer_name(name)
          order by a
        ),
        is_active = true,
        updated_at = now()
    where id = v_mapfre;

  if v_palic is not null and v_palic <> v_mapfre then
    update public.patient_insurers
      set insurer_id = v_mapfre   -- el trigger sync_patient_insurer_name refresca insurer_name
      where insurer_id = v_palic;
    delete from public.insurers where id = v_palic;
  end if;
end;
$$;
