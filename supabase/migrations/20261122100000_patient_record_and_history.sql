-- Expediente clínico: «Abrir Expediente» e historia general (PR 4 del plan).
--
-- Un paciente nuevo NO tiene expediente: un médico (o el admin) lo abre una vez
-- con la historia general y, mientras no exista, no se puede registrar ninguna
-- consulta. Después se completa o corrige en cualquier momento, pero NUNCA se
-- sobrescribe ni se borra: cada ajuste deja una revisión inmutable (quién,
-- cuándo, campo, valor anterior y nuevo, motivo opcional), como pide la norma
-- del MSP.
--
--   * patient_records                     -- el expediente (uno por paciente)
--   * patient_medical_history             -- la historia general VIGENTE (1:1)
--   * patient_medical_history_revisions   -- todos los ajustes (inmutable)
--   * allergies / medications             -- ahora guardan quién las registró y
--       quién cambió su estado (antes solo tenían la fecha, no el autor)
--
-- Secciones de la historia: heredofamiliares, patológicos, no patológicos,
-- quirúrgicos, ginecoobstétricos, hábitos tóxicos (tabaco, alcohol, otras
-- sustancias), hábitos alimentarios y actividad física, vacunas y otros. NO hay
-- «antecedentes personales» como campo aparte (decisión 5 del plan); lo que ya
-- existe dentro de las consultas viejas se conserva tal cual.
--
-- Políticas RLS (descritas en la PR):
--   Las 3 tablas nuevas: SELECT solo admin y médicos de la clínica activa
--       (is_clinician_of_active_clinic); NINGÚN INSERT/UPDATE/DELETE directo de
--       usuarios -- se escribe solo con open_patient_record() y
--       save_medical_history() (security definer, search_path = '', verifican
--       rol, clínica y que el paciente no esté anulado). ENABLE + FORCE RLS,
--       guard de solo lectura, revisiones inmutables (trigger).
--   encounters: un trigger BEFORE INSERT exige el expediente abierto (los
--       usuarios y cualquier cliente; solo service_role queda fuera, igual que
--       los jobs de backend que ya lo usan).
--   patients/allergies/medications: sin cambio de políticas.

-- =============================================================================
-- 1. Tablas
-- =============================================================================

create table public.patient_records (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  patient_id uuid not null unique references public.patients (id) on delete cascade,
  -- null = expediente creado por la migración para pacientes que ya tenían
  -- consultas, alergias o medicamentos (migrated = true); el médico lo completa
  -- cuando quiera.
  opened_by uuid references auth.users (id) on delete set null,
  opened_at timestamptz not null default now(),
  migrated boolean not null default false
);

comment on table public.patient_records is
  'Expediente clínico del paciente (uno por paciente). Sin expediente abierto no se puede registrar ninguna consulta.';

create index patient_records_clinic_idx on public.patient_records (clinic_id);

create table public.patient_medical_history (
  patient_id uuid primary key references public.patients (id) on delete cascade,
  record_id uuid not null unique references public.patient_records (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  family_history text,
  pathological_history text,
  non_pathological_history text,
  surgical_history text,
  gyneco_obstetric_history text,
  toxic_tobacco text,
  toxic_alcohol text,
  toxic_other_substances text,
  diet_habits text,
  physical_activity text,
  vaccines text,
  other_notes text,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint patient_medical_history_lengths check (
    coalesce(char_length(family_history), 0) <= 5000
    and coalesce(char_length(pathological_history), 0) <= 5000
    and coalesce(char_length(non_pathological_history), 0) <= 5000
    and coalesce(char_length(surgical_history), 0) <= 5000
    and coalesce(char_length(gyneco_obstetric_history), 0) <= 5000
    and coalesce(char_length(toxic_tobacco), 0) <= 5000
    and coalesce(char_length(toxic_alcohol), 0) <= 5000
    and coalesce(char_length(toxic_other_substances), 0) <= 5000
    and coalesce(char_length(diet_habits), 0) <= 5000
    and coalesce(char_length(physical_activity), 0) <= 5000
    and coalesce(char_length(vaccines), 0) <= 5000
    and coalesce(char_length(other_notes), 0) <= 5000
  )
);

comment on table public.patient_medical_history is
  'Historia general VIGENTE del paciente (una fila por expediente). Se escribe solo con open_patient_record() / '
  'save_medical_history(); cada cambio deja una revisión en patient_medical_history_revisions.';

create index patient_medical_history_clinic_idx on public.patient_medical_history (clinic_id);

create table public.patient_medical_history_revisions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  patient_id uuid not null references public.patients (id) on delete cascade,
  field text not null,
  old_value text,
  new_value text,
  changed_by uuid references auth.users (id) on delete set null,
  changed_at timestamptz not null default now(),
  reason text
);

comment on table public.patient_medical_history_revisions is
  'Cada ajuste a la historia general: campo, valor anterior y nuevo, quién, cuándo y motivo opcional. Inmutable.';

create index patient_medical_history_revisions_patient_idx
  on public.patient_medical_history_revisions (patient_id, changed_at desc);
create index patient_medical_history_revisions_clinic_idx
  on public.patient_medical_history_revisions (clinic_id);

-- =============================================================================
-- 2. RLS: solo lectura para admin y médicos; todo lo demás por las funciones
-- =============================================================================

alter table public.patient_records enable row level security;
alter table public.patient_records force row level security;
alter table public.patient_medical_history enable row level security;
alter table public.patient_medical_history force row level security;
alter table public.patient_medical_history_revisions enable row level security;
alter table public.patient_medical_history_revisions force row level security;

create policy patient_records_select
  on public.patient_records for select to authenticated
  using (public.is_clinician_of_active_clinic(clinic_id));
create policy patient_medical_history_select
  on public.patient_medical_history for select to authenticated
  using (public.is_clinician_of_active_clinic(clinic_id));
create policy patient_medical_history_revisions_select
  on public.patient_medical_history_revisions for select to authenticated
  using (public.is_clinician_of_active_clinic(clinic_id));

revoke all on public.patient_records from anon, authenticated;
revoke all on public.patient_medical_history from anon, authenticated;
revoke all on public.patient_medical_history_revisions from anon, authenticated;
grant select on public.patient_records, public.patient_medical_history, public.patient_medical_history_revisions to authenticated;
grant select on public.patient_records, public.patient_medical_history, public.patient_medical_history_revisions to service_role;
-- service_role puede abrir un expediente directo (preparar datos de prueba, mantenimiento).
grant insert on public.patient_records to service_role;

select public.attach_readonly_guard('public.patient_records'::regclass);
select public.attach_readonly_guard('public.patient_medical_history'::regclass);
select public.attach_readonly_guard('public.patient_medical_history_revisions'::regclass);

-- Revisiones: inmutables (solo desaparecen en cascada con el paciente o la clínica).
create or replace function public.enforce_medical_history_revisions_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'El historial de ajustes del expediente no se puede modificar ni borrar.' using errcode = 'P0001';
end;
$$;

revoke execute on function public.enforce_medical_history_revisions_append_only() from public, anon, authenticated;

create trigger patient_medical_history_revisions_append_only
  before update or delete on public.patient_medical_history_revisions
  for each row execute function public.enforce_medical_history_revisions_append_only();

-- Un paciente anulado no recibe expediente nuevo.
create trigger patient_records_block_voided before insert on public.patient_records
  for each row execute function public.block_writes_for_voided_patient();

-- =============================================================================
-- 3. Triggers: historia vacía al abrir, revisiones al cambiar
-- =============================================================================

create or replace function public.create_empty_medical_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.patient_medical_history (patient_id, record_id, clinic_id)
  values (new.patient_id, new.id, new.clinic_id)
  on conflict (patient_id) do nothing;
  return null;
end;
$$;

revoke execute on function public.create_empty_medical_history() from public, anon, authenticated;

create trigger patient_records_create_history
  after insert on public.patient_records
  for each row execute function public.create_empty_medical_history();

-- Una fila por campo que cambia (el motivo viene de la función que hizo el cambio).
create or replace function public.log_medical_history_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := nullif(btrim(coalesce(current_setting('cuido.history_reason', true), '')), '');
begin
  insert into public.patient_medical_history_revisions
    (clinic_id, patient_id, field, old_value, new_value, changed_by, reason)
  select
    new.clinic_id,
    new.patient_id,
    n.key,
    o.value #>> '{}',
    n.value #>> '{}',
    auth.uid(),
    v_reason
  from jsonb_each(to_jsonb(new)) n
  join jsonb_each(to_jsonb(old)) o on o.key = n.key
  where o.value is distinct from n.value
    and n.key not in ('patient_id', 'record_id', 'clinic_id', 'updated_by', 'updated_at')
  order by n.key;
  return null;
end;
$$;

revoke execute on function public.log_medical_history_changes() from public, anon, authenticated;

create trigger patient_medical_history_log_changes
  after update on public.patient_medical_history
  for each row execute function public.log_medical_history_changes();

-- =============================================================================
-- 4. Sin expediente abierto no hay consultas
-- =============================================================================

create or replace function public.require_open_patient_record()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- service_role es el backend de confianza (jobs, mantenimiento); ningún
  -- usuario ni cliente de la app llega aquí con ese rol.
  if coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;
  if not exists (select 1 from public.patient_records r where r.patient_id = new.patient_id) then
    raise exception 'El paciente no tiene el expediente abierto: un médico debe abrirlo antes de registrar consultas.'
      using errcode = 'P0001', hint = 'record_not_open';
  end if;
  return new;
end;
$$;

revoke execute on function public.require_open_patient_record() from public, anon, authenticated;

create trigger encounters_require_record
  before insert on public.encounters
  for each row execute function public.require_open_patient_record();

-- =============================================================================
-- 5. Funciones: abrir y completar/corregir
-- =============================================================================

-- Aplica cambios (solo las claves presentes) a la historia vigente. Interna.
create or replace function public.apply_medical_history(p_patient_id uuid, p_data jsonb, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allowed text[] := array[
    'family_history', 'pathological_history', 'non_pathological_history', 'surgical_history',
    'gyneco_obstetric_history', 'toxic_tobacco', 'toxic_alcohol', 'toxic_other_substances',
    'diet_habits', 'physical_activity', 'vaccines', 'other_notes'
  ];
  v_key text;
  v_val jsonb;
begin
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'Datos de historia inválidos.' using errcode = '22023';
  end if;
  for v_key, v_val in select * from jsonb_each(p_data) loop
    if not (v_key = any (v_allowed)) then
      raise exception 'Campo desconocido en la historia general: %.', v_key using errcode = '22023';
    end if;
    if jsonb_typeof(v_val) not in ('string', 'null') then
      raise exception 'El campo % debe ser texto.', v_key using errcode = '22023';
    end if;
    if char_length(coalesce(v_val #>> '{}', '')) > 5000 then
      raise exception 'El campo % es demasiado largo (máximo 5000 caracteres).', v_key using errcode = '22023';
    end if;
  end loop;

  perform set_config('cuido.history_reason', coalesce(btrim(p_reason), ''), true);

  update public.patient_medical_history h set
    family_history = case when p_data ? 'family_history' then nullif(btrim(p_data ->> 'family_history'), '') else h.family_history end,
    pathological_history = case when p_data ? 'pathological_history' then nullif(btrim(p_data ->> 'pathological_history'), '') else h.pathological_history end,
    non_pathological_history = case when p_data ? 'non_pathological_history' then nullif(btrim(p_data ->> 'non_pathological_history'), '') else h.non_pathological_history end,
    surgical_history = case when p_data ? 'surgical_history' then nullif(btrim(p_data ->> 'surgical_history'), '') else h.surgical_history end,
    gyneco_obstetric_history = case when p_data ? 'gyneco_obstetric_history' then nullif(btrim(p_data ->> 'gyneco_obstetric_history'), '') else h.gyneco_obstetric_history end,
    toxic_tobacco = case when p_data ? 'toxic_tobacco' then nullif(btrim(p_data ->> 'toxic_tobacco'), '') else h.toxic_tobacco end,
    toxic_alcohol = case when p_data ? 'toxic_alcohol' then nullif(btrim(p_data ->> 'toxic_alcohol'), '') else h.toxic_alcohol end,
    toxic_other_substances = case when p_data ? 'toxic_other_substances' then nullif(btrim(p_data ->> 'toxic_other_substances'), '') else h.toxic_other_substances end,
    diet_habits = case when p_data ? 'diet_habits' then nullif(btrim(p_data ->> 'diet_habits'), '') else h.diet_habits end,
    physical_activity = case when p_data ? 'physical_activity' then nullif(btrim(p_data ->> 'physical_activity'), '') else h.physical_activity end,
    vaccines = case when p_data ? 'vaccines' then nullif(btrim(p_data ->> 'vaccines'), '') else h.vaccines end,
    other_notes = case when p_data ? 'other_notes' then nullif(btrim(p_data ->> 'other_notes'), '') else h.other_notes end,
    updated_by = auth.uid(),
    updated_at = now()
  where h.patient_id = p_patient_id;

  perform set_config('cuido.history_reason', '', true);
end;
$$;

revoke execute on function public.apply_medical_history(uuid, jsonb, text) from public, anon, authenticated;

-- «Abrir Expediente»: crea el expediente y guarda la historia general en una
-- sola operación atómica (o todo, o nada).
create or replace function public.open_patient_record(p_patient_id uuid, p_history jsonb default '{}'::jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  p record;
  v_record_id uuid;
begin
  select pt.clinic_id, pt.voided_at into p from public.patients pt where pt.id = p_patient_id;
  if not found or auth.uid() is null or not public.is_clinician_of_active_clinic(p.clinic_id) then
    raise exception 'No tienes permiso para abrir expedientes.' using errcode = '42501';
  end if;
  if p.voided_at is not null then
    raise exception 'El paciente está anulado: reactívalo antes de abrir su expediente.' using errcode = '22023';
  end if;
  if exists (select 1 from public.patient_records r where r.patient_id = p_patient_id) then
    raise exception 'Este paciente ya tiene el expediente abierto.' using errcode = '22023';
  end if;

  insert into public.patient_records (clinic_id, patient_id, opened_by)
  values (p.clinic_id, p_patient_id, auth.uid())
  returning id into v_record_id;

  perform public.apply_medical_history(p_patient_id, coalesce(p_history, '{}'::jsonb), 'Apertura del expediente');
  return v_record_id;
end;
$$;

-- Completar o corregir la historia en cualquier momento (cada cambio deja su revisión).
create or replace function public.save_medical_history(p_patient_id uuid, p_changes jsonb, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p record;
begin
  select pt.clinic_id, pt.voided_at into p from public.patients pt where pt.id = p_patient_id;
  if not found or auth.uid() is null or not public.is_clinician_of_active_clinic(p.clinic_id) then
    raise exception 'No tienes permiso para editar expedientes.' using errcode = '42501';
  end if;
  if p.voided_at is not null then
    raise exception 'El paciente está anulado: reactívalo antes de editar su expediente.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.patient_records r where r.patient_id = p_patient_id) then
    raise exception 'El paciente no tiene el expediente abierto.' using errcode = '22023';
  end if;

  perform public.apply_medical_history(p_patient_id, p_changes, p_reason);
end;
$$;

revoke execute on function public.open_patient_record(uuid, jsonb) from public, anon;
revoke execute on function public.save_medical_history(uuid, jsonb, text) from public, anon;
grant execute on function public.open_patient_record(uuid, jsonb) to authenticated, service_role;
grant execute on function public.save_medical_history(uuid, jsonb, text) to authenticated, service_role;

-- =============================================================================
-- 6. Alergias y medicamentos: quién y cuándo
-- =============================================================================
-- Hasta ahora solo guardaban la fecha, no el autor. Las filas anteriores
-- quedan con autor desconocido (null).

alter table public.allergies
  add column recorded_by uuid references auth.users (id) on delete set null,
  add column status_changed_at timestamptz,
  add column status_changed_by uuid references auth.users (id) on delete set null;
alter table public.medications
  add column created_by uuid references auth.users (id) on delete set null,
  add column status_changed_at timestamptz,
  add column status_changed_by uuid references auth.users (id) on delete set null;

create or replace function public.stamp_allergy_author()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.recorded_by := coalesce(auth.uid(), new.recorded_by);
  elsif new.status is distinct from old.status then
    new.status_changed_at := now();
    new.status_changed_by := auth.uid();
  end if;
  return new;
end;
$$;

create or replace function public.stamp_medication_author()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
  elsif new.status is distinct from old.status then
    new.status_changed_at := now();
    new.status_changed_by := auth.uid();
  end if;
  return new;
end;
$$;

revoke execute on function public.stamp_allergy_author() from public, anon, authenticated;
revoke execute on function public.stamp_medication_author() from public, anon, authenticated;

create trigger allergies_stamp_author before insert or update on public.allergies
  for each row execute function public.stamp_allergy_author();
create trigger medications_stamp_author before insert or update on public.medications
  for each row execute function public.stamp_medication_author();

-- =============================================================================
-- 7. Pacientes que ya existían: expediente creado (vacío, «migrado»)
-- =============================================================================
-- A quien ya tiene consultas, alergias o medicamentos se le crea el expediente
-- para no bloquearlo ni esconder sus datos; el médico lo completa cuando quiera.
-- Los demás pacientes esperan a que un médico use «Abrir Expediente».

do $migrate$
begin
  perform set_config('cuido.allow_readonly_write', 'on', true);
  insert into public.patient_records (clinic_id, patient_id, opened_by, migrated)
  select p.clinic_id, p.id, null, true
  from public.patients p
  where exists (select 1 from public.encounters e where e.patient_id = p.id)
     or exists (select 1 from public.allergies a where a.patient_id = p.id)
     or exists (select 1 from public.medications m where m.patient_id = p.id);
end
$migrate$;

-- =============================================================================
-- 8. Eliminar sin actividad: un expediente con contenido cuenta como actividad
-- =============================================================================

create or replace function public.patient_deletion_blockers(p_patient_id uuid, p_mode text)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v text[] := '{}';
begin
  if exists (select 1 from public.fiscal_documents f where f.patient_id = p_patient_id) then
    v := v || 'tiene comprobantes fiscales (e-CF)'::text;
  end if;
  if exists (
       select 1 from public.insurance_claims c
       join public.encounters e on e.id = c.encounter_id
       where e.patient_id = p_patient_id
     )
     or exists (
       select 1 from public.insurance_claims c
       join public.patient_insurers i on i.id = c.patient_insurer_id
       where i.patient_id = p_patient_id
     ) then
    v := v || 'tiene reclamaciones a la ARS'::text;
  end if;

  if p_mode = 'error' then
    if exists (select 1 from public.encounters e where e.patient_id = p_patient_id) then
      v := v || 'tiene consultas'::text;
    end if;
    if exists (select 1 from public.consents c where c.patient_id = p_patient_id) then
      v := v || 'tiene consentimientos informados firmados'::text;
    end if;
    if exists (select 1 from public.appointments a where a.patient_id = p_patient_id and a.status = 'completada') then
      v := v || 'tiene citas completadas'::text;
    end if;
    if exists (select 1 from public.allergies a where a.patient_id = p_patient_id)
       or exists (select 1 from public.medications m where m.patient_id = p_patient_id) then
      v := v || 'tiene alergias o medicamentos registrados'::text;
    end if;
    if exists (
         select 1 from public.patient_medical_history h
         where h.patient_id = p_patient_id
           and (h.family_history is not null or h.pathological_history is not null
                or h.non_pathological_history is not null or h.surgical_history is not null
                or h.gyneco_obstetric_history is not null or h.toxic_tobacco is not null
                or h.toxic_alcohol is not null or h.toxic_other_substances is not null
                or h.diet_habits is not null or h.physical_activity is not null
                or h.vaccines is not null or h.other_notes is not null)
       ) then
      v := v || 'tiene una historia clínica registrada en su expediente'::text;
    end if;
    if exists (select 1 from public.eligibility_checks q where q.patient_id = p_patient_id) then
      v := v || 'tiene verificaciones de cobertura'::text;
    end if;
    if exists (select 1 from public.sensitive_specialty_access_grants g where g.patient_id = p_patient_id) then
      v := v || 'tiene accesos a especialidades sensibles registrados'::text;
    end if;
    if exists (select 1 from public.patient_messaging_consents m where m.patient_id = p_patient_id)
       or exists (select 1 from public.whatsapp_messages w where w.patient_id = p_patient_id) then
      v := v || 'tiene consentimientos o mensajes de WhatsApp registrados'::text;
    end if;
  end if;
  return v;
end;
$$;

revoke execute on function public.patient_deletion_blockers(uuid, text) from public, anon, authenticated;
