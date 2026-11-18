-- Eliminar y anular pacientes (PR 3 del plan de expediente clínico).
--
-- Tres casos, TODOS solo para el administrador y solo por funciones
-- `security definer` (no existe ninguna política de DELETE en `patients`):
--   A. Paciente de PRUEBA (datos ficticios, marcado con is_test): se elimina
--      definitivamente con todo lo suyo, salvo que tenga e-CF o reclamaciones.
--   B. Paciente creado por ERROR, sin actividad: se elimina si no tiene
--      consultas, consentimientos, e-CF, reclamaciones ni citas completadas
--      (ni otros registros que cuenten como actividad, ver
--      patient_deletion_blockers); hay que escribir su nombre y un motivo.
--   C. ANULAR (reversible) a un paciente real con registros: queda oculto de
--      listas, búsquedas y agenda (el admin lo ve en el filtro «Anulados»), no
--      admite movimientos nuevos y sus citas futuras se cancelan.
-- Toda eliminación queda en patient_deletion_log (inmutable, solo lo lee el admin).
--
-- Revisión de TODAS las llaves foráneas hacia `patients` (qué las cubre):
--   encounters (+ vital_signs, insurance_claims y sus hijas, por cascada)
--       -> A: se borran; B: bloquean; claims bloquean siempre.
--   allergies, medications                   -> A: se borran; B: bloquean.
--   consents                                 -> A: se borran; B: bloquean.
--   fiscal_documents (+ items)               -> bloquean SIEMPRE (valor fiscal).
--   patient_insurers                         -> se borran; sus reclamaciones bloquean.
--   eligibility_checks                       -> A: se borran; B: bloquean.
--   sensitive_specialty_access_grants        -> A: se borran; B: bloquean.
--   appointments (+ checklist, recordatorios)-> A: se borran; B: bloquean solo las
--       completadas, las demás se borran con el paciente.
--   patient_messaging_consents               -> A: se borran; B: bloquean.
--   whatsapp_messages (SET NULL)             -> A: se borran las del paciente;
--       B: bloquean (si se le envió algo, ya hubo actividad).
--   patient_change_log (cascada)             -> se borra con el paciente.
--
-- Políticas RLS (descritas en la PR):
--   patients UPDATE (modificada): además de ser admin/médico, solo filas NO
--       anuladas (voided_at is null). Un trigger impide cambiar is_test o los
--       campos de anulación fuera de las funciones de esta migración.
--   patient_deletion_log: SELECT solo admin de la clínica activa; sin
--       INSERT/UPDATE/DELETE para usuarios; inmutable (trigger); guard de solo
--       lectura; ENABLE + FORCE RLS.
--   Triggers BEFORE INSERT que rechazan movimientos nuevos de un paciente
--       anulado en encounters, appointments, fiscal_documents, allergies,
--       medications y consents.
-- Las funciones verifican admin y clínica ADENTRO y respetan el modo solo
-- lectura (el guard también las alcanza).

-- =============================================================================
-- 1. Columnas
-- =============================================================================

alter table public.patients
  add column is_test boolean not null default false,
  add column voided_at timestamptz,
  add column voided_by uuid references auth.users (id) on delete set null,
  add column void_reason text,
  add constraint patients_void_consistent check ((voided_at is null) = (void_reason is null));

comment on column public.patients.is_test is
  'Paciente de prueba (datos ficticios): código PRUEBA-NNN con contador aparte; se excluye de exportaciones y reportes.';
comment on column public.patients.voided_at is
  'Paciente anulado (reversible): oculto de listas, búsquedas y agenda. Lo fija void_patient().';

-- =============================================================================
-- 2. Código de los pacientes de prueba: PRUEBA-NNN con contador aparte
-- =============================================================================

drop function public.next_patient_code(uuid, timestamptz);

create or replace function public.next_patient_code(
  p_clinic_id uuid,
  p_at timestamptz default now(),
  p_is_test boolean default false
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  s record;
  v_format text := '{AAAA}-{NNNN}';
  v_start integer := 1;
  v_yearly boolean := true;
  v_year text;
  v_period text;
  v_next integer;
  v_code text;
  v_tries integer := 0;
begin
  v_year := to_char(p_at at time zone 'America/Santo_Domingo', 'YYYY');

  if p_is_test then
    -- Contador propio: nunca consume el consecutivo real de la clínica.
    v_format := 'PRUEBA-{NNN}';
    v_period := 'prueba';
  else
    select cs.format, cs.start_number, cs.reset_yearly into s
    from public.clinic_patient_code_settings cs
    where cs.clinic_id = p_clinic_id;
    if found then
      v_format := s.format;
      v_start := s.start_number;
      v_yearly := s.reset_yearly;
    end if;
    v_period := case when v_yearly then v_year else 'total' end;
  end if;

  loop
    insert into public.clinic_patient_code_counters as c (clinic_id, period, last_value)
    values (p_clinic_id, v_period, v_start)
    on conflict (clinic_id, period)
      do update set last_value = c.last_value + 1
    returning c.last_value into v_next;

    v_code := public.render_patient_code(v_format, v_year, v_next);

    exit when not exists (
      select 1 from public.patients p
      where p.clinic_id = p_clinic_id and p.record_number = v_code
    );
    v_tries := v_tries + 1;
    if v_tries > 1000 then
      raise exception 'No se pudo generar un código de paciente único.';
    end if;
  end loop;

  return v_code;
end;
$$;

revoke execute on function public.next_patient_code(uuid, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.next_patient_code(uuid, timestamptz, boolean) to service_role;

create or replace function public.assign_patient_record_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Siempre se ignora lo que mande el cliente: el código lo asigna la base, y
  -- un paciente nuevo nunca nace anulado.
  new.record_number := public.next_patient_code(new.clinic_id, now(), new.is_test);
  new.voided_at := null;
  new.voided_by := null;
  new.void_reason := null;
  return new;
end;
$$;

-- =============================================================================
-- 3. El estado (prueba / anulado) solo lo cambian las funciones de esta migración
-- =============================================================================

create or replace function public.protect_patient_state()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.is_test is distinct from old.is_test
      or new.voided_at is distinct from old.voided_at
      or new.voided_by is distinct from old.voided_by
      or new.void_reason is distinct from old.void_reason)
     and coalesce(current_setting('cuido.patient_state_change', true), '') <> 'on' then
    raise exception 'El estado del paciente (prueba o anulado) solo lo cambia el administrador desde la ficha.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke execute on function public.protect_patient_state() from public, anon, authenticated;

create trigger patients_protect_state
  before update on public.patients
  for each row execute function public.protect_patient_state();

-- Un paciente anulado no se edita (la pantalla de edición tampoco lo ofrece).
drop policy patients_update_own_tenant on public.patients;
create policy patients_update_own_tenant
  on public.patients for update to authenticated
  using (public.is_clinician_of_active_clinic(clinic_id) and voided_at is null)
  with check (public.is_clinician_of_active_clinic(clinic_id));

-- El historial de cambios no muestra quién anuló (ya dice quién cambió cada fila).
create or replace function public.log_patient_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.patient_change_log (clinic_id, patient_id, changed_by, field, old_value, new_value)
  select
    new.clinic_id,
    new.id,
    auth.uid(),
    o.key,
    o.value #>> '{}',
    n.value #>> '{}'
  from jsonb_each(to_jsonb(old)) o
  join jsonb_each(to_jsonb(new)) n on n.key = o.key
  where o.value is distinct from n.value
    and o.key not in ('id', 'clinic_id', 'created_at', 'updated_at', 'record_number', 'voided_by')
  order by o.key;
  return null;
end;
$$;

-- =============================================================================
-- 4. Pacientes anulados: sin movimientos nuevos
-- =============================================================================

create or replace function public.block_writes_for_voided_patient()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.patients p where p.id = new.patient_id and p.voided_at is not null) then
    raise exception 'El paciente está anulado: reactívalo para registrar movimientos nuevos.'
      using errcode = 'P0001', hint = 'patient_voided';
  end if;
  return new;
end;
$$;

revoke execute on function public.block_writes_for_voided_patient() from public, anon, authenticated;

create trigger encounters_block_voided before insert on public.encounters
  for each row execute function public.block_writes_for_voided_patient();
create trigger appointments_block_voided before insert on public.appointments
  for each row execute function public.block_writes_for_voided_patient();
create trigger fiscal_documents_block_voided before insert on public.fiscal_documents
  for each row execute function public.block_writes_for_voided_patient();
create trigger allergies_block_voided before insert on public.allergies
  for each row execute function public.block_writes_for_voided_patient();
create trigger medications_block_voided before insert on public.medications
  for each row execute function public.block_writes_for_voided_patient();
create trigger consents_block_voided before insert on public.consents
  for each row execute function public.block_writes_for_voided_patient();

-- =============================================================================
-- 5. Registro de eliminaciones
-- =============================================================================

create table public.patient_deletion_log (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  record_number text not null,
  patient_name text not null,
  deleted_by uuid references auth.users (id) on delete set null,
  deleted_at timestamptz not null default now(),
  reason text not null,
  deletion_case text not null check (deletion_case in ('prueba', 'error'))
);

comment on table public.patient_deletion_log is
  'Constancia de cada paciente eliminado definitivamente (código, nombre, quién, cuándo y por qué). La escriben '
  'delete_test_patient / delete_empty_patient; no se edita ni se borra.';

create index patient_deletion_log_clinic_idx on public.patient_deletion_log (clinic_id, deleted_at desc);

alter table public.patient_deletion_log enable row level security;
alter table public.patient_deletion_log force row level security;

create policy patient_deletion_log_select
  on public.patient_deletion_log for select to authenticated
  using (public.is_admin_of_active_clinic(clinic_id));

revoke all on public.patient_deletion_log from anon, authenticated;
grant select on public.patient_deletion_log to authenticated;
grant select on public.patient_deletion_log to service_role;

select public.attach_readonly_guard('public.patient_deletion_log'::regclass);

create or replace function public.enforce_patient_deletion_log_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'El registro de eliminaciones no se puede modificar ni borrar.' using errcode = 'P0001';
end;
$$;

revoke execute on function public.enforce_patient_deletion_log_append_only() from public, anon, authenticated;

create trigger patient_deletion_log_append_only
  before update or delete on public.patient_deletion_log
  for each row execute function public.enforce_patient_deletion_log_append_only();

-- =============================================================================
-- 6. Qué impide eliminar a un paciente
-- =============================================================================
-- p_mode 'prueba': solo lo fiscal. 'error': además toda actividad.

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

-- Para la pantalla: qué se puede hacer con este paciente (solo admin).
create or replace function public.patient_deletion_status(p_patient_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p record;
begin
  select pt.clinic_id, pt.is_test into p from public.patients pt where pt.id = p_patient_id;
  if not found or auth.uid() is null or not public.is_admin_of_active_clinic(p.clinic_id) then
    raise exception 'No tienes permiso para esto.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'is_test', p.is_test,
    'test_blockers', to_jsonb(public.patient_deletion_blockers(p_patient_id, 'prueba')),
    'empty_blockers', to_jsonb(public.patient_deletion_blockers(p_patient_id, 'error'))
  );
end;
$$;

revoke execute on function public.patient_deletion_status(uuid) from public, anon;
grant execute on function public.patient_deletion_status(uuid) to authenticated, service_role;

-- =============================================================================
-- 7. Funciones de eliminación y anulación (solo admin)
-- =============================================================================

create or replace function public.delete_test_patient(p_patient_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p record;
  v_blockers text[];
begin
  select pt.clinic_id, pt.record_number, pt.first_name, pt.last_name, pt.is_test into p
  from public.patients pt where pt.id = p_patient_id;
  if not found or auth.uid() is null or not public.is_admin_of_active_clinic(p.clinic_id) then
    raise exception 'No tienes permiso para esto.' using errcode = '42501';
  end if;
  if not p.is_test then
    raise exception 'Solo se pueden eliminar así los pacientes marcados como de prueba.' using errcode = '22023';
  end if;
  v_blockers := public.patient_deletion_blockers(p_patient_id, 'prueba');
  if cardinality(v_blockers) > 0 then
    raise exception 'No se puede eliminar: %.', array_to_string(v_blockers, ' y ') using errcode = '22023';
  end if;

  insert into public.patient_deletion_log (clinic_id, record_number, patient_name, deleted_by, reason, deletion_case)
  values (p.clinic_id, p.record_number, btrim(p.first_name || ' ' || p.last_name), auth.uid(), 'Paciente de prueba', 'prueba');

  delete from public.whatsapp_messages where patient_id = p_patient_id;
  delete from public.patients where id = p_patient_id;
end;
$$;

create or replace function public.delete_empty_patient(p_patient_id uuid, p_confirm_name text, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p record;
  v_blockers text[];
  v_full_name text;
begin
  select pt.clinic_id, pt.record_number, pt.first_name, pt.last_name, pt.is_test into p
  from public.patients pt where pt.id = p_patient_id;
  if not found or auth.uid() is null or not public.is_admin_of_active_clinic(p.clinic_id) then
    raise exception 'No tienes permiso para esto.' using errcode = '42501';
  end if;
  if p.is_test then
    raise exception 'Este paciente es de prueba: elimínalo como paciente de prueba.' using errcode = '22023';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    raise exception 'Indica el motivo (al menos 3 caracteres).' using errcode = '22023';
  end if;
  v_full_name := btrim(p.first_name || ' ' || p.last_name);
  -- Se compara sin importar mayúsculas ni espacios repetidos (en ambos lados).
  if lower(regexp_replace(btrim(coalesce(p_confirm_name, '')), '\s+', ' ', 'g'))
     <> lower(regexp_replace(v_full_name, '\s+', ' ', 'g')) then
    raise exception 'El nombre escrito no coincide con el del paciente.' using errcode = '22023';
  end if;
  v_blockers := public.patient_deletion_blockers(p_patient_id, 'error');
  if cardinality(v_blockers) > 0 then
    raise exception 'No se puede eliminar: %. Anúlalo en su lugar.', array_to_string(v_blockers, ', ') using errcode = '22023';
  end if;

  insert into public.patient_deletion_log (clinic_id, record_number, patient_name, deleted_by, reason, deletion_case)
  values (p.clinic_id, p.record_number, v_full_name, auth.uid(), btrim(p_reason), 'error');

  delete from public.patients where id = p_patient_id;
end;
$$;

create or replace function public.void_patient(p_patient_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p record;
begin
  select pt.clinic_id, pt.voided_at into p from public.patients pt where pt.id = p_patient_id;
  if not found or auth.uid() is null or not public.is_admin_of_active_clinic(p.clinic_id) then
    raise exception 'No tienes permiso para esto.' using errcode = '42501';
  end if;
  if p.voided_at is not null then
    raise exception 'El paciente ya está anulado.' using errcode = '22023';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    raise exception 'Indica el motivo de la anulación (al menos 3 caracteres).' using errcode = '22023';
  end if;

  perform set_config('cuido.patient_state_change', 'on', true);
  update public.patients
    set voided_at = now(), voided_by = auth.uid(), void_reason = btrim(p_reason)
    where id = p_patient_id;
  perform set_config('cuido.patient_state_change', '', true);

  -- Sus citas futuras ya no tienen sentido (ni deben recibir recordatorios).
  update public.appointments
    set status = 'cancelada', updated_at = now()
    where patient_id = p_patient_id
      and status in ('pendiente', 'confirmada')
      and scheduled_at >= now();
end;
$$;

create or replace function public.unvoid_patient(p_patient_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p record;
begin
  select pt.clinic_id, pt.voided_at into p from public.patients pt where pt.id = p_patient_id;
  if not found or auth.uid() is null or not public.is_admin_of_active_clinic(p.clinic_id) then
    raise exception 'No tienes permiso para esto.' using errcode = '42501';
  end if;
  if p.voided_at is null then
    raise exception 'El paciente no está anulado.' using errcode = '22023';
  end if;

  perform set_config('cuido.patient_state_change', 'on', true);
  update public.patients
    set voided_at = null, voided_by = null, void_reason = null
    where id = p_patient_id;
  perform set_config('cuido.patient_state_change', '', true);
end;
$$;

-- Marcar o desmarcar a un paciente como de prueba (el código ya asignado no cambia).
create or replace function public.set_patient_test_flag(p_patient_id uuid, p_is_test boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p record;
begin
  select pt.clinic_id into p from public.patients pt where pt.id = p_patient_id;
  if not found or auth.uid() is null or not public.is_admin_of_active_clinic(p.clinic_id) then
    raise exception 'No tienes permiso para esto.' using errcode = '42501';
  end if;

  perform set_config('cuido.patient_state_change', 'on', true);
  update public.patients set is_test = coalesce(p_is_test, false) where id = p_patient_id;
  perform set_config('cuido.patient_state_change', '', true);
end;
$$;

revoke execute on function public.delete_test_patient(uuid) from public, anon;
revoke execute on function public.delete_empty_patient(uuid, text, text) from public, anon;
revoke execute on function public.void_patient(uuid, text) from public, anon;
revoke execute on function public.unvoid_patient(uuid) from public, anon;
revoke execute on function public.set_patient_test_flag(uuid, boolean) from public, anon;
grant execute on function public.delete_test_patient(uuid) to authenticated, service_role;
grant execute on function public.delete_empty_patient(uuid, text, text) to authenticated, service_role;
grant execute on function public.void_patient(uuid, text) to authenticated, service_role;
grant execute on function public.unvoid_patient(uuid) to authenticated, service_role;
grant execute on function public.set_patient_test_flag(uuid, boolean) to authenticated, service_role;
