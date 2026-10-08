-- Ajuste de la lista inicial del catálogo de ARS (indicado por José):
--   * se agrega SEMMA;
--   * «ARS Humano» pasa a llamarse «Primera de Humano». El nombre anterior queda
--     como alias, así que lo escrito a mano («Humano», «ARS Humano») se sigue
--     reconociendo.
-- Si el nombre oficial difiere, el operador lo corrige desde /operator/insurers.

do $$
declare
  v_id uuid;
begin
  select i.id into v_id
  from public.insurers i
  where public.normalize_insurer_name(i.name) = 'humano'
  limit 1;

  if v_id is not null then
    update public.insurers
      set name = 'Primera de Humano',
          aliases = array(
            select distinct a
            from unnest(aliases || array['ARS Humano', 'Humano', 'Primera ARS Humano']) a
            order by a
          ),
          updated_at = now()
      where id = v_id;

    -- insurer_name es una instantánea del catálogo: se refresca en los seguros ya
    -- vinculados. Es mantenimiento (pasa por el guard de solo lectura): se usa el
    -- mecanismo previsto, un GUC de transacción.
    perform set_config('cuido.allow_readonly_write', 'on', true);
    update public.patient_insurers
      set insurer_name = 'Primera de Humano'
      where insurer_id = v_id and insurer_name <> 'Primera de Humano';
  end if;
end;
$$;

insert into public.insurers (name, aliases)
values ('SEMMA', array['ARS SEMMA'])
on conflict do nothing;
