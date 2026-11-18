-- Editar paciente + historial de cambios (PR 2 del plan de expediente clínico).
--
--   * patient_change_log: una fila por campo que cambia en `patients`, escrita
--     SOLO por un trigger AFTER UPDATE (quién, cuándo, campo, valor anterior y
--     nuevo). Inmutable: nadie la edita ni la borra directamente.
--   * Editar un paciente pasa a ser de admin y médicos. Recepción ya no
--     actualiza `patients` directo: su única edición (teléfono y correo, que
--     usa para registrar el consentimiento de WhatsApp) va por la función
--     update_patient_contact().
--   * Si cambia el teléfono, el consentimiento de WhatsApp vigente de ese
--     paciente (que es de OTRO número) se revoca en la misma operación: los
--     recordatorios usan el número del consentimiento, no el de la ficha, así
--     que sin esto seguirían saliendo al número viejo.
--
-- Políticas RLS (descritas en la PR):
--   patients UPDATE                : antes cualquier miembro de la clínica;
--       ahora solo admin y médicos (is_clinician_of_active_clinic), en USING y
--       en WITH CHECK. SELECT e INSERT no cambian (recepción sigue creando
--       pacientes y viéndolos).
--   patient_change_log SELECT      : admin y médicos de la clínica activa.
--       Sin políticas ni privilegios de INSERT/UPDATE/DELETE para los usuarios.
--   Guard de solo lectura en patient_change_log, ENABLE + FORCE RLS.

-- =============================================================================
-- 1. patient_change_log
-- =============================================================================

create table public.patient_change_log (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  patient_id uuid not null references public.patients (id) on delete cascade,
  changed_by uuid references auth.users (id) on delete set null,
  changed_at timestamptz not null default now(),
  field text not null,
  old_value text,
  new_value text
);

comment on table public.patient_change_log is
  'Historial de cambios de los datos del paciente: una fila por campo modificado. La escribe el trigger '
  'log_patient_changes; no se edita ni se borra (solo desaparece junto con el paciente o la clínica).';

create index patient_change_log_patient_idx on public.patient_change_log (patient_id, changed_at desc);
create index patient_change_log_clinic_idx on public.patient_change_log (clinic_id);

alter table public.patient_change_log enable row level security;
alter table public.patient_change_log force row level security;

create policy patient_change_log_select
  on public.patient_change_log for select to authenticated
  using (public.is_clinician_of_active_clinic(clinic_id));

revoke all on public.patient_change_log from anon, authenticated;
grant select on public.patient_change_log to authenticated;
grant select on public.patient_change_log to service_role;

select public.attach_readonly_guard('public.patient_change_log'::regclass);

-- Inmutable también frente a service_role: un UPDATE nunca, un DELETE directo
-- nunca. El borrado en cascada (al eliminar el paciente o la clínica) lo
-- dispara otro trigger (profundidad > 1) y sí se permite.
create or replace function public.enforce_patient_change_log_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'El historial de cambios del paciente no se puede modificar ni borrar.'
    using errcode = 'P0001';
end;
$$;

revoke execute on function public.enforce_patient_change_log_append_only() from public, anon, authenticated;

create trigger patient_change_log_append_only
  before update or delete on public.patient_change_log
  for each row execute function public.enforce_patient_change_log_append_only();

-- =============================================================================
-- 2. Trigger que registra los cambios
-- =============================================================================
-- Genérico sobre las columnas de `patients` (compara to_jsonb(old) con
-- to_jsonb(new)), así las columnas que se agreguen después (paciente de
-- prueba, anulado…) quedan registradas sin tocar el trigger. No se registran
-- las que no son un dato editado: id, clinic_id, created_at, updated_at y
-- record_number (este último ni siquiera se puede cambiar).

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
    and o.key not in ('id', 'clinic_id', 'created_at', 'updated_at', 'record_number')
  order by o.key;
  return null;
end;
$$;

revoke execute on function public.log_patient_changes() from public, anon, authenticated;

create trigger patients_log_changes
  after update on public.patients
  for each row execute function public.log_patient_changes();

-- =============================================================================
-- 3. Editar pacientes: solo admin y médicos
-- =============================================================================

drop policy patients_update_own_tenant on public.patients;
create policy patients_update_own_tenant
  on public.patients for update to authenticated
  using (public.is_clinician_of_active_clinic(clinic_id))
  with check (public.is_clinician_of_active_clinic(clinic_id));

-- =============================================================================
-- 4. Contacto del paciente y consentimiento de WhatsApp
-- =============================================================================

-- Revoca el consentimiento vigente si es de un número distinto al indicado
-- (null = el paciente ya no tiene un número dominicano válido). Interna.
create or replace function public.revoke_stale_messaging_consent(p_patient_id uuid, p_phone_e164 text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.patient_messaging_consents
    set revoked_at = now(), revoke_source = 'personal'
    where patient_id = p_patient_id
      and revoked_at is null
      and phone_e164 is distinct from p_phone_e164;
  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;

revoke execute on function public.revoke_stale_messaging_consent(uuid, text) from public, anon, authenticated;

-- Para quien edita el paciente por la pantalla de edición (admin y médicos)
-- después de cambiar el teléfono.
create or replace function public.revoke_stale_patient_consent(p_patient_id uuid, p_phone_e164 text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic_id uuid;
begin
  select clinic_id into v_clinic_id from public.patients where id = p_patient_id;
  if v_clinic_id is null or not public.is_clinician_of_active_clinic(v_clinic_id) then
    raise exception 'No tienes permiso para esto.' using errcode = '42501';
  end if;
  return public.revoke_stale_messaging_consent(p_patient_id, p_phone_e164);
end;
$$;

revoke execute on function public.revoke_stale_patient_consent(uuid, text) from public, anon;
grant execute on function public.revoke_stale_patient_consent(uuid, text) to authenticated, service_role;

-- Teléfono y correo desde recepción (admin y recepción), que ya no actualizan
-- `patients` directo. El cambio queda en el historial con quien lo hizo.
create or replace function public.update_patient_contact(
  p_patient_id uuid,
  p_phone text,
  p_email text,
  p_phone_e164 text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic_id uuid;
begin
  select clinic_id into v_clinic_id from public.patients where id = p_patient_id;
  if v_clinic_id is null or auth.uid() is null or not public.is_billing_staff_of_active_clinic(v_clinic_id) then
    raise exception 'No tienes permiso para editar el contacto del paciente.' using errcode = '42501';
  end if;

  update public.patients
    set phone = nullif(btrim(p_phone), ''), email = nullif(btrim(p_email), '')
    where id = p_patient_id;

  return public.revoke_stale_messaging_consent(p_patient_id, p_phone_e164);
end;
$$;

revoke execute on function public.update_patient_contact(uuid, text, text, text) from public, anon;
grant execute on function public.update_patient_contact(uuid, text, text, text) to authenticated, service_role;
