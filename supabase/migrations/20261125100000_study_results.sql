-- Resultados de estudios y analíticas (PR 6 del plan de expediente clínico).
--
-- Dentro del expediente, una lista de estudios (laboratorio, imagen, cardiología,
-- patología, otro) con su resultado en texto, valores con unidad y rango de
-- referencia, la interpretación del médico y archivos adjuntos (PDF, JPG, PNG de
-- hasta 10 MB). Un estudio se puede indicar desde una consulta (queda «pendiente»)
-- y completar cuando llega el resultado.
--
-- Los resultados NO se editan ni se borran sin dejar huella: cada cambio crea una
-- revisión inmutable (campo, antes, después, quién, cuándo, motivo) -- la misma idea
-- que el historial de ajustes del expediente -- y «anular» es un cambio de estado con
-- motivo. Lo único que existe es el estado vigente más su historial.
--
--   * study_results            -- el estudio (estado vigente)
--   * study_result_revisions   -- todos los cambios (inmutable)
--   * study_attachments        -- metadatos de cada archivo (el archivo vive en Storage)
--   * bucket privado «study-results» en Supabase Storage (NUEVO en el proyecto)
--
-- ============================ STORAGE (revisar antes de fusionar) ============================
--   Bucket:    study-results, PRIVADO (public = false), límite 10 MB y solo
--              application/pdf, image/jpeg e image/png (lo hace cumplir Storage).
--   Ruta:      {clinic_id}/{patient_id}/{study_id}/{uuid}-{nombre_saneado}. La genera el
--              servidor; el cliente nunca elige la ruta.
--   Políticas sobre storage.objects (solo para este bucket):
--       SELECT  : study_file_access(name, false) -- admin o médico de la clínica ACTIVA
--                 dueña de la ruta, y que el estudio exista en esa clínica y paciente
--                 (y, si cuelga de una consulta de una especialidad sensible, que tenga
--                 acceso a ella).
--       INSERT  : study_file_access(name, true) -- lo mismo, más: clínica NO en solo
--                 lectura y estudio no anulado.
--       UPDATE / DELETE: ninguna política => nadie borra ni reemplaza un archivo desde la
--                 app. Un adjunto equivocado se «retira» (se oculta, con motivo) pero el
--                 archivo se conserva.
--   Descargas: SIEMPRE con URL firmada de 60 segundos, generada en el servidor con la
--              sesión del usuario (si RLS no le deja leer el archivo, no hay URL).
--              Nunca hay URL pública permanente (CLAUDE.md).
--   Los metadatos se registran con register_study_attachment(), que verifica que el
--   archivo exista de verdad en el bucket, que la ruta corresponda al estudio, el tipo y
--   el tamaño, y limita a 10 adjuntos por estudio.
--
-- Políticas RLS (descritas en la PR):
--   Las 3 tablas nuevas: SELECT solo admin y médicos de la clínica activa (y, si el
--       estudio cuelga de una consulta, solo si esa consulta es visible para el usuario:
--       Salud Mental con acceso reforzado); NINGÚN INSERT/UPDATE/DELETE directo de
--       usuarios -- todo por create_study_result / update_study_result /
--       void_study_result / register_study_attachment / void_study_attachment (security
--       definer, search_path = ''). ENABLE + FORCE RLS, guard de solo lectura,
--       revisiones inmutables. Recepción no tiene acceso.

-- =============================================================================
-- 1. Tablas
-- =============================================================================

create table public.study_results (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  patient_id uuid not null references public.patients (id) on delete cascade,
  encounter_id uuid references public.encounters (id) on delete set null,
  category text not null check (category in ('laboratorio', 'imagen', 'cardiologia', 'patologia', 'otro')),
  study_name text not null check (char_length(btrim(study_name)) between 1 and 200),
  ordered_at date,
  performed_at date,
  result_text text check (result_text is null or char_length(result_text) <= 10000),
  -- [{ "name": "Glucosa", "value": "98", "unit": "mg/dL", "reference_range": "70-100" }, ...]
  result_values jsonb not null default '[]'::jsonb check (jsonb_typeof(result_values) = 'array'),
  interpretation text check (interpretation is null or char_length(interpretation) <= 5000),
  status text not null default 'pendiente' check (status in ('pendiente', 'recibido', 'anulado')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

comment on table public.study_results is
  'Estudios y analíticas del paciente (estado vigente). Se escribe solo con create_study_result / update_study_result / '
  'void_study_result; cada cambio deja una revisión inmutable.';

create index study_results_patient_idx on public.study_results (patient_id, created_at desc);
create index study_results_clinic_idx on public.study_results (clinic_id);
create index study_results_encounter_idx on public.study_results (encounter_id) where encounter_id is not null;

create table public.study_result_revisions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  patient_id uuid not null references public.patients (id) on delete cascade,
  study_id uuid not null references public.study_results (id) on delete cascade,
  field text not null,
  old_value text,
  new_value text,
  changed_by uuid references auth.users (id) on delete set null,
  changed_at timestamptz not null default now(),
  reason text
);

create index study_result_revisions_study_idx on public.study_result_revisions (study_id, changed_at desc);
create index study_result_revisions_clinic_idx on public.study_result_revisions (clinic_id);

create table public.study_attachments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  patient_id uuid not null references public.patients (id) on delete cascade,
  study_id uuid not null references public.study_results (id) on delete cascade,
  storage_path text not null unique,
  file_name text not null check (char_length(file_name) between 1 and 200),
  mime_type text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png')),
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 10485760),
  uploaded_by uuid references auth.users (id) on delete set null,
  uploaded_at timestamptz not null default now(),
  -- Un adjunto equivocado se retira (se oculta con motivo); el archivo se conserva.
  removed_at timestamptz,
  removed_by uuid references auth.users (id) on delete set null,
  removed_reason text,
  check ((removed_at is null) = (removed_reason is null))
);

create index study_attachments_study_idx on public.study_attachments (study_id);
create index study_attachments_clinic_idx on public.study_attachments (clinic_id);

-- =============================================================================
-- 2. RLS: solo lectura para admin y médicos; todo lo demás por las funciones
-- =============================================================================

alter table public.study_results enable row level security;
alter table public.study_results force row level security;
alter table public.study_result_revisions enable row level security;
alter table public.study_result_revisions force row level security;
alter table public.study_attachments enable row level security;
alter table public.study_attachments force row level security;

-- Si el estudio cuelga de una consulta, solo se ve cuando esa consulta es visible para el usuario
-- (la subconsulta pasa por la RLS de encounters: Salud Mental con acceso reforzado).
create policy study_results_select
  on public.study_results for select to authenticated
  using (
    public.is_clinician_of_active_clinic(clinic_id)
    and (
      encounter_id is null
      or exists (select 1 from public.encounters e where e.id = study_results.encounter_id)
    )
  );

create policy study_result_revisions_select
  on public.study_result_revisions for select to authenticated
  using (
    public.is_clinician_of_active_clinic(clinic_id)
    and exists (select 1 from public.study_results s where s.id = study_result_revisions.study_id)
  );

create policy study_attachments_select
  on public.study_attachments for select to authenticated
  using (
    public.is_clinician_of_active_clinic(clinic_id)
    and exists (select 1 from public.study_results s where s.id = study_attachments.study_id)
  );

revoke all on public.study_results, public.study_result_revisions, public.study_attachments from anon, authenticated;
grant select on public.study_results, public.study_result_revisions, public.study_attachments to authenticated;
grant select on public.study_results, public.study_result_revisions, public.study_attachments to service_role;

select public.attach_readonly_guard('public.study_results'::regclass);
select public.attach_readonly_guard('public.study_result_revisions'::regclass);
select public.attach_readonly_guard('public.study_attachments'::regclass);

-- Un paciente anulado no recibe estudios nuevos.
create trigger study_results_block_voided before insert on public.study_results
  for each row execute function public.block_writes_for_voided_patient();

-- Revisiones inmutables (solo desaparecen en cascada con el estudio, el paciente o la clínica).
create or replace function public.enforce_study_result_revisions_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'El historial de un resultado de estudio no se puede modificar ni borrar.' using errcode = 'P0001';
end;
$$;

revoke execute on function public.enforce_study_result_revisions_append_only() from public, anon, authenticated;

create trigger study_result_revisions_append_only
  before update or delete on public.study_result_revisions
  for each row execute function public.enforce_study_result_revisions_append_only();

-- Los adjuntos no se borran directo (solo en cascada); retirar = marcar.
create or replace function public.enforce_study_attachments_no_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'Un adjunto no se borra: se retira con un motivo.' using errcode = 'P0001';
end;
$$;

revoke execute on function public.enforce_study_attachments_no_delete() from public, anon, authenticated;

create trigger study_attachments_no_delete
  before delete on public.study_attachments
  for each row execute function public.enforce_study_attachments_no_delete();

-- =============================================================================
-- 3. Cada cambio deja su revisión
-- =============================================================================

create or replace function public.log_study_result_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := nullif(btrim(coalesce(current_setting('cuido.study_reason', true), '')), '');
begin
  insert into public.study_result_revisions (clinic_id, patient_id, study_id, field, old_value, new_value, changed_by, reason)
  select new.clinic_id, new.patient_id, new.id, n.key, o.value #>> '{}', n.value #>> '{}', auth.uid(), v_reason
  from jsonb_each(to_jsonb(new)) n
  join jsonb_each(to_jsonb(old)) o on o.key = n.key
  where o.value is distinct from n.value
    and n.key in ('category', 'study_name', 'ordered_at', 'performed_at', 'result_text', 'result_values', 'interpretation', 'status', 'encounter_id')
  order by n.key;
  return null;
end;
$$;

revoke execute on function public.log_study_result_changes() from public, anon, authenticated;

create trigger study_results_log_changes
  after update on public.study_results
  for each row execute function public.log_study_result_changes();

-- =============================================================================
-- 4. Funciones de escritura
-- =============================================================================

-- Valida los valores del resultado: [{name, value, unit?, reference_range?}], hasta 100.
create or replace function public.validate_study_values(p_values jsonb)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_item jsonb;
  v_key text;
begin
  if p_values is null or jsonb_typeof(p_values) <> 'array' then
    raise exception 'Los valores del resultado deben ser una lista.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_values) > 100 then
    raise exception 'Un resultado admite como máximo 100 valores.' using errcode = '22023';
  end if;
  for v_item in select * from jsonb_array_elements(p_values) loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Cada valor debe tener nombre y valor.' using errcode = '22023';
    end if;
    for v_key in select jsonb_object_keys(v_item) loop
      if v_key not in ('name', 'value', 'unit', 'reference_range') then
        raise exception 'Campo desconocido en un valor del resultado: %.', v_key using errcode = '22023';
      end if;
    end loop;
    if jsonb_typeof(v_item -> 'name') is distinct from 'string' or char_length(btrim(v_item ->> 'name')) not between 1 and 100 then
      raise exception 'Cada valor necesita un nombre (hasta 100 caracteres).' using errcode = '22023';
    end if;
    if jsonb_typeof(v_item -> 'value') is distinct from 'string' or char_length(btrim(v_item ->> 'value')) not between 1 and 200 then
      raise exception 'El valor «%» necesita un resultado (hasta 200 caracteres).', v_item ->> 'name' using errcode = '22023';
    end if;
    if char_length(coalesce(v_item ->> 'unit', '')) > 30 or char_length(coalesce(v_item ->> 'reference_range', '')) > 100 then
      raise exception 'La unidad (30) o el rango de referencia (100) es demasiado largo en «%».', v_item ->> 'name' using errcode = '22023';
    end if;
  end loop;
end;
$$;

revoke execute on function public.validate_study_values(jsonb) from public, anon, authenticated;

-- Estudio nuevo: ya con resultado (recibido) o solo indicado (pendiente).
create or replace function public.create_study_result(
  p_patient_id uuid,
  p_category text,
  p_study_name text,
  p_ordered_at date default null,
  p_performed_at date default null,
  p_result_text text default null,
  p_result_values jsonb default '[]'::jsonb,
  p_interpretation text default null,
  p_status text default 'pendiente',
  p_encounter_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  p record;
  e record;
  v_id uuid;
begin
  select pt.clinic_id, pt.voided_at into p from public.patients pt where pt.id = p_patient_id;
  if not found or auth.uid() is null or not public.is_clinician_of_active_clinic(p.clinic_id) then
    raise exception 'No tienes permiso para registrar estudios.' using errcode = '42501';
  end if;
  if p.voided_at is not null then
    raise exception 'El paciente está anulado: reactívalo antes de registrar estudios.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.patient_records r where r.patient_id = p_patient_id) then
    raise exception 'El paciente no tiene el expediente abierto.' using errcode = '22023';
  end if;
  if p_status not in ('pendiente', 'recibido') then
    raise exception 'Un estudio nuevo solo puede quedar pendiente o recibido.' using errcode = '22023';
  end if;
  if p_category is null or p_category not in ('laboratorio', 'imagen', 'cardiologia', 'patologia', 'otro') then
    raise exception 'Elige la categoría del estudio.' using errcode = '22023';
  end if;
  if p_study_name is null or char_length(btrim(p_study_name)) not between 1 and 200 then
    raise exception 'El nombre del estudio es obligatorio (hasta 200 caracteres).' using errcode = '22023';
  end if;
  if p_ordered_at is not null and p_performed_at is not null and p_performed_at < p_ordered_at then
    raise exception 'La fecha de realización no puede ser anterior a la de indicación.' using errcode = '22023';
  end if;
  if char_length(coalesce(p_result_text, '')) > 10000 or char_length(coalesce(p_interpretation, '')) > 5000 then
    raise exception 'El resultado (10000) o la interpretación (5000) es demasiado largo.' using errcode = '22023';
  end if;
  perform public.validate_study_values(coalesce(p_result_values, '[]'::jsonb));

  if p_encounter_id is not null then
    select en.patient_id, en.clinic_id, en.specialty_template_id, en.provider_id into e
    from public.encounters en where en.id = p_encounter_id;
    if not found or e.patient_id <> p_patient_id or e.clinic_id <> p.clinic_id then
      raise exception 'La consulta indicada no corresponde a este paciente.' using errcode = '22023';
    end if;
    if not public.can_access_sensitive_encounter(e.clinic_id, e.patient_id, e.specialty_template_id, e.provider_id) then
      raise exception 'No tienes acceso a esa consulta.' using errcode = '42501';
    end if;
  end if;

  insert into public.study_results (
    clinic_id, patient_id, encounter_id, category, study_name, ordered_at, performed_at,
    result_text, result_values, interpretation, status, created_by, updated_by
  ) values (
    p.clinic_id, p_patient_id, p_encounter_id, p_category, btrim(p_study_name), p_ordered_at, p_performed_at,
    nullif(btrim(coalesce(p_result_text, '')), ''), coalesce(p_result_values, '[]'::jsonb),
    nullif(btrim(coalesce(p_interpretation, '')), ''), p_status, auth.uid(), auth.uid()
  ) returning id into v_id;
  return v_id;
end;
$$;

-- Completar o corregir un estudio (solo cambian las claves enviadas). Si el estudio ya estaba
-- «recibido», el motivo es obligatorio: es una corrección de un resultado.
create or replace function public.update_study_result(p_study_id uuid, p_changes jsonb, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s record;
  v_key text;
  v_val jsonb;
  v_allowed text[] := array['category', 'study_name', 'ordered_at', 'performed_at', 'result_text', 'result_values', 'interpretation', 'status'];
  v_status text;
  v_ordered date;
  v_performed date;
begin
  select sr.clinic_id, sr.patient_id, sr.encounter_id, sr.status, sr.ordered_at, sr.performed_at into s
  from public.study_results sr where sr.id = p_study_id;
  if not found or auth.uid() is null or not public.is_clinician_of_active_clinic(s.clinic_id) then
    raise exception 'No tienes permiso para editar este estudio.' using errcode = '42501';
  end if;
  if exists (select 1 from public.patients pt where pt.id = s.patient_id and pt.voided_at is not null) then
    raise exception 'El paciente está anulado: reactívalo antes de editar sus estudios.' using errcode = '22023';
  end if;
  if s.status = 'anulado' then
    raise exception 'Un estudio anulado no se modifica.' using errcode = '22023';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' then
    raise exception 'Datos de estudio inválidos.' using errcode = '22023';
  end if;
  if s.encounter_id is not null and not exists (select 1 from public.encounters en where en.id = s.encounter_id
       and public.can_access_sensitive_encounter(en.clinic_id, en.patient_id, en.specialty_template_id, en.provider_id)) then
    raise exception 'No tienes acceso a la consulta de este estudio.' using errcode = '42501';
  end if;

  for v_key, v_val in select * from jsonb_each(p_changes) loop
    if not (v_key = any (v_allowed)) then
      raise exception 'Campo desconocido en el estudio: %.', v_key using errcode = '22023';
    end if;
  end loop;
  if p_changes ? 'category' and (p_changes ->> 'category') not in ('laboratorio', 'imagen', 'cardiologia', 'patologia', 'otro') then
    raise exception 'Categoría inválida.' using errcode = '22023';
  end if;
  if p_changes ? 'status' and (p_changes ->> 'status') not in ('pendiente', 'recibido') then
    raise exception 'El estado solo puede ser pendiente o recibido (para anular, usa la anulación).' using errcode = '22023';
  end if;
  if p_changes ? 'study_name' and char_length(btrim(coalesce(p_changes ->> 'study_name', ''))) not between 1 and 200 then
    raise exception 'El nombre del estudio es obligatorio (hasta 200 caracteres).' using errcode = '22023';
  end if;
  if p_changes ? 'result_values' then
    perform public.validate_study_values(p_changes -> 'result_values');
  end if;
  if char_length(coalesce(p_changes ->> 'result_text', '')) > 10000 or char_length(coalesce(p_changes ->> 'interpretation', '')) > 5000 then
    raise exception 'El resultado (10000) o la interpretación (5000) es demasiado largo.' using errcode = '22023';
  end if;
  if s.status = 'recibido' and char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Corregir un resultado ya recibido exige un motivo (al menos 3 caracteres).' using errcode = '22023';
  end if;

  v_ordered := case when p_changes ? 'ordered_at' then nullif(p_changes ->> 'ordered_at', '')::date else s.ordered_at end;
  v_performed := case when p_changes ? 'performed_at' then nullif(p_changes ->> 'performed_at', '')::date else s.performed_at end;
  if v_ordered is not null and v_performed is not null and v_performed < v_ordered then
    raise exception 'La fecha de realización no puede ser anterior a la de indicación.' using errcode = '22023';
  end if;

  perform set_config('cuido.study_reason', coalesce(btrim(p_reason), ''), true);
  update public.study_results r set
    category = case when p_changes ? 'category' then p_changes ->> 'category' else r.category end,
    study_name = case when p_changes ? 'study_name' then btrim(p_changes ->> 'study_name') else r.study_name end,
    ordered_at = v_ordered,
    performed_at = v_performed,
    result_text = case when p_changes ? 'result_text' then nullif(btrim(coalesce(p_changes ->> 'result_text', '')), '') else r.result_text end,
    result_values = case when p_changes ? 'result_values' then p_changes -> 'result_values' else r.result_values end,
    interpretation = case when p_changes ? 'interpretation' then nullif(btrim(coalesce(p_changes ->> 'interpretation', '')), '') else r.interpretation end,
    status = case when p_changes ? 'status' then p_changes ->> 'status' else r.status end,
    updated_by = auth.uid(),
    updated_at = now()
  where r.id = p_study_id;
  perform set_config('cuido.study_reason', '', true);
end;
$$;

-- Anular un estudio (reversible solo por una corrección explícita no existe: queda anulado, con su motivo).
create or replace function public.void_study_result(p_study_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s record;
begin
  select sr.clinic_id, sr.patient_id, sr.encounter_id, sr.status into s from public.study_results sr where sr.id = p_study_id;
  if not found or auth.uid() is null or not public.is_clinician_of_active_clinic(s.clinic_id) then
    raise exception 'No tienes permiso para anular este estudio.' using errcode = '42501';
  end if;
  if s.status = 'anulado' then
    raise exception 'El estudio ya está anulado.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Indica el motivo de la anulación (al menos 3 caracteres).' using errcode = '22023';
  end if;
  if s.encounter_id is not null and not exists (select 1 from public.encounters en where en.id = s.encounter_id
       and public.can_access_sensitive_encounter(en.clinic_id, en.patient_id, en.specialty_template_id, en.provider_id)) then
    raise exception 'No tienes acceso a la consulta de este estudio.' using errcode = '42501';
  end if;

  perform set_config('cuido.study_reason', btrim(p_reason), true);
  update public.study_results set status = 'anulado', updated_by = auth.uid(), updated_at = now() where id = p_study_id;
  perform set_config('cuido.study_reason', '', true);
end;
$$;

-- =============================================================================
-- 5. Archivos adjuntos: Storage
-- =============================================================================

-- Bucket privado, 10 MB, solo PDF / JPG / PNG.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('study-results', 'study-results', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = false,
      file_size_limit = 10485760,
      allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png'];

-- ¿Puede quien llama leer (p_write = false) o subir (p_write = true) este archivo? La ruta debe ser
-- {clinic_id}/{patient_id}/{study_id}/{archivo} y corresponder a un estudio real de esa clínica y paciente.
create or replace function public.study_file_access(p_name text, p_write boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
  v_clinic uuid;
  v_patient uuid;
  v_study uuid;
  s record;
begin
  if coalesce(array_length(v_parts, 1), 0) <> 4 or auth.uid() is null then
    return false;
  end if;
  begin
    v_clinic := v_parts[1]::uuid;
    v_patient := v_parts[2]::uuid;
    v_study := v_parts[3]::uuid;
  exception when others then
    return false;
  end;

  select sr.clinic_id, sr.patient_id, sr.encounter_id, sr.status into s from public.study_results sr where sr.id = v_study;
  if not found or s.clinic_id <> v_clinic or s.patient_id <> v_patient then
    return false;
  end if;
  if not public.is_clinician_of_active_clinic(v_clinic) then
    return false;
  end if;
  if s.encounter_id is not null and not exists (
       select 1 from public.encounters en
       where en.id = s.encounter_id
         and public.can_access_sensitive_encounter(en.clinic_id, en.patient_id, en.specialty_template_id, en.provider_id)
     ) then
    return false;
  end if;
  if p_write and (s.status = 'anulado' or not public.is_clinic_writable(v_clinic)) then
    return false;
  end if;
  return true;
end;
$$;

revoke execute on function public.study_file_access(text, boolean) from public, anon;
grant execute on function public.study_file_access(text, boolean) to authenticated, service_role;

create policy study_files_select on storage.objects for select to authenticated
  using (bucket_id = 'study-results' and public.study_file_access(name, false));

create policy study_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'study-results' and public.study_file_access(name, true));

-- Sin políticas de UPDATE ni DELETE: nadie reemplaza ni borra un archivo desde la app.

-- Registra los metadatos de un archivo YA subido.
create or replace function public.register_study_attachment(
  p_study_id uuid,
  p_storage_path text,
  p_file_name text,
  p_mime_type text,
  p_size_bytes integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  s record;
  v_id uuid;
begin
  select sr.clinic_id, sr.patient_id, sr.status into s from public.study_results sr where sr.id = p_study_id;
  if not found or auth.uid() is null or not public.study_file_access(p_storage_path, true) then
    raise exception 'No tienes permiso para adjuntar archivos a este estudio.' using errcode = '42501';
  end if;
  if p_storage_path not like (s.clinic_id::text || '/' || s.patient_id::text || '/' || p_study_id::text || '/%') then
    raise exception 'La ruta del archivo no corresponde a este estudio.' using errcode = '22023';
  end if;
  if p_mime_type not in ('application/pdf', 'image/jpeg', 'image/png') then
    raise exception 'Solo se admiten archivos PDF, JPG o PNG.' using errcode = '22023';
  end if;
  if p_size_bytes is null or p_size_bytes < 1 or p_size_bytes > 10485760 then
    raise exception 'El archivo no puede pasar de 10 MB.' using errcode = '22023';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'study-results' and o.name = p_storage_path) then
    raise exception 'El archivo no se encontró en el almacenamiento.' using errcode = '22023';
  end if;
  if (select count(*) from public.study_attachments a where a.study_id = p_study_id and a.removed_at is null) >= 10 then
    raise exception 'Un estudio admite como máximo 10 adjuntos.' using errcode = '22023';
  end if;

  insert into public.study_attachments (clinic_id, patient_id, study_id, storage_path, file_name, mime_type, size_bytes, uploaded_by)
  values (s.clinic_id, s.patient_id, p_study_id, p_storage_path, left(btrim(p_file_name), 200), p_mime_type, p_size_bytes, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.void_study_attachment(p_attachment_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a record;
begin
  select at.clinic_id, at.storage_path, at.removed_at into a from public.study_attachments at where at.id = p_attachment_id;
  if not found or auth.uid() is null or not public.study_file_access(a.storage_path, true) then
    raise exception 'No tienes permiso para retirar este adjunto.' using errcode = '42501';
  end if;
  if a.removed_at is not null then
    raise exception 'El adjunto ya está retirado.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Indica el motivo (al menos 3 caracteres).' using errcode = '22023';
  end if;
  update public.study_attachments
    set removed_at = now(), removed_by = auth.uid(), removed_reason = btrim(p_reason)
    where id = p_attachment_id;
end;
$$;

revoke execute on function public.create_study_result(uuid, text, text, date, date, text, jsonb, text, text, uuid) from public, anon;
revoke execute on function public.update_study_result(uuid, jsonb, text) from public, anon;
revoke execute on function public.void_study_result(uuid, text) from public, anon;
revoke execute on function public.register_study_attachment(uuid, text, text, text, integer) from public, anon;
revoke execute on function public.void_study_attachment(uuid, text) from public, anon;
grant execute on function public.create_study_result(uuid, text, text, date, date, text, jsonb, text, text, uuid) to authenticated, service_role;
grant execute on function public.update_study_result(uuid, jsonb, text) to authenticated, service_role;
grant execute on function public.void_study_result(uuid, text) to authenticated, service_role;
grant execute on function public.register_study_attachment(uuid, text, text, text, integer) to authenticated, service_role;
grant execute on function public.void_study_attachment(uuid, text) to authenticated, service_role;

-- =============================================================================
-- 6. Eliminar sin actividad: un estudio cuenta como actividad
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
    if exists (select 1 from public.study_results s where s.patient_id = p_patient_id) then
      v := v || 'tiene estudios o resultados registrados'::text;
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
