-- Fase 2 (parte 3) — Agenda de citas. Pendiente de Fase 2 y dependencia
-- directa de Fase 4 (WhatsApp, en pausa por documentación de Meta): el
-- futuro recordatorio automático de citas necesitará leer fecha/hora/
-- paciente/clínica desde esta tabla. No se construye nada de WhatsApp
-- aquí -- solo se diseñan los campos pensando en ese consumidor futuro
-- (scheduled_at/patient_id/clinic_id ya alcanzan; whatsapp_messages ya
-- tiene clinic_id/patient_id nullable, así que ese job futuro no
-- necesitará ningún ALTER sobre esta tabla).
--
-- Diseño acordado con el usuario antes de escribir esta migración (ver
-- hilo de conversación):
--   1. La cita fija la ESPECIALIDAD desde que se agenda (una de las
--      specialty_templates existentes) -- no es una cita genérica.
--   2. Solo admin/recepción crean y gestionan citas -- trabajo
--      administrativo, mismo criterio de rol que ya usa e-CF. El médico
--      solo LEE su propia agenda (las citas donde es provider_id).

-- =============================================================================
-- 1. appointments
-- =============================================================================

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  patient_id uuid not null references public.patients (id) on delete cascade,
  -- Médico asignado. Puede ser un admin que también atiende (un solo
  -- rol por miembro, sin duplicar fila) -- mismo criterio que
  -- provider_id en encounters, que también acepta admin o médico.
  provider_id uuid not null references auth.users (id),
  -- Especialidad fijada al agendar -- "convertir a consulta" nunca
  -- vuelve a preguntar cuál es.
  specialty_template_id uuid not null references public.specialty_templates (id),
  scheduled_at timestamptz not null,
  reason text,
  status text not null default 'pendiente'
    check (status in ('pendiente', 'confirmada', 'completada', 'cancelada', 'no_show')),
  -- Quién agendó -- SIEMPRE auth.uid() puesto por la Server Action,
  -- nunca un campo de formulario (mismo principio que provider_id en
  -- encounters/clinic_members.user_id).
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.appointments is
  'Citas agendadas por admin/recepción, con especialidad fijada desde el '
  'agendamiento. Sin política de DELETE -- una cita que no se realiza se '
  'marca cancelada/no_show, no se borra (conserva el historial, útil '
  'cuando Fase 4/WhatsApp necesite auditar recordatorios enviados).';

create index appointments_clinic_scheduled_idx on public.appointments (clinic_id, scheduled_at);
create index appointments_provider_scheduled_idx on public.appointments (provider_id, scheduled_at);
create index appointments_patient_id_idx on public.appointments (patient_id);

-- Reusa el trigger genérico que ya usa encounters -- deriva clinic_id
-- del paciente, nunca confía en lo que mande el cliente.
create trigger appointments_set_clinic_id
  before insert on public.appointments
  for each row execute function public.set_clinic_id_from_patient();

create trigger appointments_set_updated_at
  before update on public.appointments
  for each row execute function public.set_updated_at();

alter table public.appointments enable row level security;
alter table public.appointments force row level security;

-- Reusa is_billing_staff_of_active_clinic (admin+recepción+clínica
-- activa, supabase/migrations/20260821090000_ecf_billing.sql) tal cual,
-- en vez de duplicar una función idéntica solo por prolijidad de
-- nombre -- el conjunto de roles que gestiona citas es exactamente el
-- mismo que gestiona facturación. Si algún día diverge, se separa
-- entonces.

-- Lectura: admin/recepción ven toda la agenda de la clínica. El médico
-- SOLO ve las citas donde es el proveedor asignado -- de solo lectura
-- porque no hay política de INSERT/UPDATE para él más abajo, no porque
-- el SELECT lo restrinja a nivel de columna.
create policy appointments_select
  on public.appointments for select to authenticated
  using (
    public.is_billing_staff_of_active_clinic(clinic_id)
    or (public.is_clinician_of_active_clinic(clinic_id) and provider_id = auth.uid())
  );

create policy appointments_insert
  on public.appointments for insert to authenticated
  with check (public.is_billing_staff_of_active_clinic(clinic_id));

create policy appointments_update
  on public.appointments for update to authenticated
  using (public.is_billing_staff_of_active_clinic(clinic_id))
  with check (public.is_billing_staff_of_active_clinic(clinic_id));

grant select, insert, update on public.appointments to authenticated;

-- =============================================================================
-- 2. encounters.appointment_id -- trazabilidad cita → consulta.
-- =============================================================================
-- Nullable: la mayoría de encounters (existentes y futuros, visitas no
-- agendadas) no vienen de una cita. No requiere tocar las políticas RLS
-- de encounters -- siguen gateadas por clinic_id/especialidad sensible
-- exactamente igual que hoy.

alter table public.encounters
  add column appointment_id uuid references public.appointments (id) on delete set null;

create index encounters_appointment_id_idx on public.encounters (appointment_id);

-- =============================================================================
-- 3. complete_appointment_with_encounter -- "convertir a consulta".
-- =============================================================================
-- El médico NO tiene UPDATE sobre appointments (es de solo lectura por
-- diseño), pero SÍ debe poder, en un solo paso al guardar la consulta,
-- marcar la cita completada y enlazar el encounter. Un RPC security
-- definer con su propio chequeo de autorización -- mismo patrón que
-- grant_sensitive_specialty_access/set_clinic_active_status -- en vez
-- de usar el cliente admin (service_role) dentro de la Server Action,
-- que rompería el principio ya documentado en src/lib/supabase/admin.ts
-- ("el INSERT/UPDATE/DELETE real en tablas de tenant sigue haciéndose
-- con el cliente normal... para que RLS lo valide de forma
-- independiente").
--
-- Gateado a is_clinician_of_active_clinic (admin+médico) a propósito:
-- es exactamente quien ya puede crear encounters hoy
-- (src/app/(clinic)/patients/[id]/encounters/new/[templateId]/actions.ts)
-- -- recepción nunca llega a este código porque esa Server Action ya la
-- bloquea antes.

create or replace function public.complete_appointment_with_encounter(
  target_appointment_id uuid,
  target_encounter_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinic_id uuid;
begin
  select clinic_id into v_clinic_id from public.appointments where id = target_appointment_id;
  if v_clinic_id is null then
    raise exception 'Cita no encontrada.';
  end if;

  if not public.is_clinician_of_active_clinic(v_clinic_id) then
    raise exception 'No tienes permiso para completar esta cita.';
  end if;

  -- El encounter debe pertenecer a la misma clínica y paciente que la
  -- cita -- evita enlazar un encounter arbitrario de otro paciente.
  if not exists (
    select 1 from public.encounters e
    join public.appointments a on a.id = target_appointment_id
    where e.id = target_encounter_id
      and e.clinic_id = a.clinic_id
      and e.patient_id = a.patient_id
  ) then
    raise exception 'La consulta no corresponde a esta cita.';
  end if;

  update public.appointments
    set status = 'completada', updated_at = now()
    where id = target_appointment_id;

  update public.encounters
    set appointment_id = target_appointment_id
    where id = target_encounter_id;
end;
$$;

revoke execute on function public.complete_appointment_with_encounter(uuid, uuid) from public;
grant execute on function public.complete_appointment_with_encounter(uuid, uuid) to authenticated;
