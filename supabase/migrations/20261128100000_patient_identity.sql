-- Ficha de identificación del paciente (escolaridad, estado civil, residencia, procedencia, ocupación,
-- informante y religión).
--
-- El número de expediente automático (patients.record_number) NO cambia. Esta migración agrega:
--
--   * 7 columnas NULAS en `patients` (los pacientes existentes quedan con nulos; se completan al editar):
--       education_level, marital_status, residence, place_of_origin, occupation, informant_type, informant_name.
--     Las de valores cerrados llevan CHECK; los textos libres, un máximo de 200 caracteres y nunca vacíos; el
--     nombre del informante es obligatorio cuando quien informa NO es el mismo paciente (y no se guarda si lo es).
--     Sin cambios de políticas RLS en `patients`: recepción sigue creando y viendo; la edición es de admin y médicos
--     (recepción solo edita teléfono y correo por update_patient_contact). El historial de cambios
--     (patient_change_log) ya compara TODAS las columnas por to_jsonb(), así que las nuevas quedan registradas solas.
--
--   * patient_religion (1:1 con el paciente) y patient_religion_log -- la RELIGIÓN es un dato sensible (Ley 172-13:
--     convicciones religiosas), por eso NO es una columna de `patients` (que recepción puede leer):
--       - SELECT solo admin y médicos de la clínica activa; recepción: ninguna.
--       - Sin INSERT/UPDATE/DELETE para usuarios: todo por save_patient_religion() (security definer,
--         search_path = '', verifica rol y clínica; paciente no anulado; valida la lista y «otra» con texto).
--       - ENABLE + FORCE RLS, guard de solo lectura, clínica derivada del paciente (también para service_role).
--       - Historial inmutable de cada cambio (quién, cuándo, antes y después), igual que el del paciente.
--
-- Valores cerrados (claves; las etiquetas en español viven en src/lib/domain/patient-identity.ts).

-- =============================================================================
-- 1. Columnas de identificación en patients
-- =============================================================================

alter table public.patients
  add column education_level text check (
    education_level is null or education_level in (
      'sin_escolaridad', 'primaria_incompleta', 'primaria_completa', 'secundaria_incompleta',
      'secundaria_completa', 'tecnico', 'universitaria_incompleta', 'universitaria_completa', 'posgrado'
    )
  ),
  add column marital_status text check (
    marital_status is null or marital_status in ('soltero', 'casado', 'union_libre', 'separado', 'divorciado', 'viudo')
  ),
  add column residence text check (residence is null or (char_length(residence) <= 200 and btrim(residence) <> '')),
  add column place_of_origin text check (place_of_origin is null or (char_length(place_of_origin) <= 200 and btrim(place_of_origin) <> '')),
  add column occupation text check (occupation is null or (char_length(occupation) <= 200 and btrim(occupation) <> '')),
  add column informant_type text check (
    informant_type is null or informant_type in ('paciente', 'madre_padre', 'conyuge', 'hijo', 'otro_familiar', 'acompanante', 'otro')
  ),
  add column informant_name text check (informant_name is null or (char_length(informant_name) <= 200 and btrim(informant_name) <> '')),
  -- Quien informa: si no es el mismo paciente (o no se registró), hace falta su nombre; si lo es, no hay nombre.
  add constraint patients_informant_consistent check (
    ((informant_type is null or informant_type = 'paciente') and informant_name is null)
    or (informant_type is not null and informant_type <> 'paciente' and informant_name is not null)
  );

comment on column public.patients.education_level is 'Escolaridad (lista cerrada). Opcional.';
comment on column public.patients.marital_status is 'Estado civil (lista cerrada). Opcional.';
comment on column public.patients.residence is 'Dónde vive hoy (calle/sector, municipio, provincia). Texto libre.';
comment on column public.patients.place_of_origin is 'De dónde proviene (municipio, provincia o país). Texto libre.';
comment on column public.patients.occupation is 'Ocupación. Texto libre. Ya no se pide dentro de la consulta.';
comment on column public.patients.informant_type is 'Quién da los datos: el mismo paciente u otra persona (anamnesis indirecta).';
comment on column public.patients.informant_name is 'Nombre del informante cuando no es el mismo paciente.';

-- =============================================================================
-- 2. Religión (dato sensible): tabla aparte, solo admin y médicos
-- =============================================================================

create table public.patient_religion (
  patient_id uuid primary key references public.patients (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  religion text not null check (
    religion in ('catolica', 'evangelica_cristiana', 'adventista', 'testigo_jehova', 'otra', 'ninguna', 'prefiere_no_decir')
  ),
  religion_other text check (religion_other is null or (char_length(religion_other) <= 200 and btrim(religion_other) <> '')),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  -- «Otra» lleva su texto; las demás opciones no.
  check ((religion = 'otra') = (religion_other is not null))
);

comment on table public.patient_religion is
  'Religión del paciente: dato sensible (Ley 172-13), solo para administradores y médicos. Se escribe solo con save_patient_religion().';

create index patient_religion_clinic_idx on public.patient_religion (clinic_id);

create table public.patient_religion_log (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  patient_id uuid not null references public.patients (id) on delete cascade,
  changed_by uuid references auth.users (id) on delete set null,
  changed_at timestamptz not null default now(),
  old_religion text,
  old_religion_other text,
  new_religion text not null,
  new_religion_other text
);

comment on table public.patient_religion_log is
  'Historial inmutable de la religión del paciente (quién, cuándo, antes y después). Lo escribe solo un trigger.';

create index patient_religion_log_patient_idx on public.patient_religion_log (patient_id, changed_at desc);
create index patient_religion_log_clinic_idx on public.patient_religion_log (clinic_id);

-- =============================================================================
-- 3. RLS
-- =============================================================================

alter table public.patient_religion enable row level security;
alter table public.patient_religion force row level security;
alter table public.patient_religion_log enable row level security;
alter table public.patient_religion_log force row level security;

create policy patient_religion_select
  on public.patient_religion for select to authenticated
  using (public.is_clinician_of_active_clinic(clinic_id));

create policy patient_religion_log_select
  on public.patient_religion_log for select to authenticated
  using (public.is_clinician_of_active_clinic(clinic_id));

revoke all on public.patient_religion, public.patient_religion_log from anon, authenticated;
grant select on public.patient_religion, public.patient_religion_log to authenticated, service_role;

select public.attach_readonly_guard('public.patient_religion'::regclass);
select public.attach_readonly_guard('public.patient_religion_log'::regclass);

-- La clínica es la del paciente (también para service_role).
create or replace function public.enforce_patient_religion_links()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
begin
  select pt.clinic_id into v_clinic from public.patients pt where pt.id = new.patient_id;
  if not found or v_clinic <> new.clinic_id then
    raise exception 'La religión no corresponde a la clínica del paciente.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke execute on function public.enforce_patient_religion_links() from public, anon, authenticated;

create trigger patient_religion_enforce_links before insert or update on public.patient_religion
  for each row execute function public.enforce_patient_religion_links();

create trigger patient_religion_block_voided before insert on public.patient_religion
  for each row execute function public.block_writes_for_voided_patient();

-- Historial: una fila por cada alta o cambio (escrita solo por este trigger).
create or replace function public.log_patient_religion_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.patient_religion_log (clinic_id, patient_id, changed_by, old_religion, old_religion_other, new_religion, new_religion_other)
  values (
    new.clinic_id, new.patient_id, auth.uid(),
    case when tg_op = 'UPDATE' then old.religion end,
    case when tg_op = 'UPDATE' then old.religion_other end,
    new.religion, new.religion_other
  );
  return null;
end;
$$;

revoke execute on function public.log_patient_religion_change() from public, anon, authenticated;

create trigger patient_religion_log_changes after insert or update on public.patient_religion
  for each row execute function public.log_patient_religion_change();

-- Inmutables: la religión no se borra (se cambia con save_patient_religion) salvo en cascada con el paciente o la
-- clínica; el historial no se edita ni se borra.
create or replace function public.protect_patient_religion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'La religión del paciente solo se cambia con save_patient_religion y el historial no se modifica.' using errcode = 'P0001';
end;
$$;

revoke execute on function public.protect_patient_religion() from public, anon, authenticated;

create trigger patient_religion_protect_delete before delete on public.patient_religion
  for each row execute function public.protect_patient_religion();
create trigger patient_religion_log_protect before update or delete on public.patient_religion_log
  for each row execute function public.protect_patient_religion();

-- =============================================================================
-- 4. Escritura de la religión
-- =============================================================================

create or replace function public.save_patient_religion(p_patient_id uuid, p_religion text, p_other text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p record;
  v_other text := nullif(btrim(coalesce(p_other, '')), '');
begin
  select pt.clinic_id, pt.voided_at into p from public.patients pt where pt.id = p_patient_id;
  if not found or auth.uid() is null or not public.is_clinician_of_active_clinic(p.clinic_id) then
    raise exception 'No tienes permiso para registrar la religión de este paciente.' using errcode = '42501';
  end if;
  if p.voided_at is not null then
    raise exception 'El paciente está anulado: reactívalo antes de modificar sus datos.' using errcode = '22023';
  end if;
  if p_religion is null or p_religion not in ('catolica', 'evangelica_cristiana', 'adventista', 'testigo_jehova', 'otra', 'ninguna', 'prefiere_no_decir') then
    raise exception 'Elige una religión de la lista.' using errcode = '22023';
  end if;
  if p_religion = 'otra' then
    if v_other is null then
      raise exception 'Indica cuál es la religión.' using errcode = '22023';
    end if;
    if char_length(v_other) > 200 then
      raise exception 'La religión es demasiado larga (máximo 200 caracteres).' using errcode = '22023';
    end if;
  else
    v_other := null;
  end if;

  -- Sin cambio no hay actualización ni fila de historial.
  insert into public.patient_religion as r (patient_id, clinic_id, religion, religion_other, updated_by, updated_at)
  values (p_patient_id, p.clinic_id, p_religion, v_other, auth.uid(), now())
  on conflict (patient_id) do update
    set religion = excluded.religion, religion_other = excluded.religion_other,
        updated_by = excluded.updated_by, updated_at = excluded.updated_at
    where (r.religion, r.religion_other) is distinct from (excluded.religion, excluded.religion_other);
end;
$$;

revoke execute on function public.save_patient_religion(uuid, text, text) from public, anon;
grant execute on function public.save_patient_religion(uuid, text, text) to authenticated, service_role;

-- =============================================================================
-- 5. Ocupación: ya vive en la ficha, deja de pedirse dentro de la consulta
-- =============================================================================
-- El campo «Ocupación» de las plantillas pasa a `legacy` (ya no se pide; lo guardado se sigue mostrando y
-- exportando). Hoy solo lo trae Medicina Familiar y General, pero se marca en CUALQUIER plantilla que lo tenga.

update public.specialty_templates t
set schema = jsonb_set(
  t.schema,
  '{fields}',
  (
    select jsonb_agg(
      case when f ->> 'key' = 'ocupacion' then f || '{"legacy": true}'::jsonb else f end
      order by ord
    )
    from jsonb_array_elements(t.schema -> 'fields') with ordinality as x (f, ord)
  )
)
where exists (
  select 1 from jsonb_array_elements(t.schema -> 'fields') f where f ->> 'key' = 'ocupacion'
);
