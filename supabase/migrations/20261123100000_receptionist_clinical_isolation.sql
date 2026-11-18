-- Recepción sin datos clínicos (PR 4b del plan de expediente clínico; decisión 2).
--
-- Recepción crea pacientes, maneja la agenda, firma consentimientos, factura (e-CF)
-- y prepara reclamaciones, pero NO lee consultas, signos vitales, alergias ni
-- medicamentos. Hasta ahora cualquier miembro de la clínica los leía.
--
--   * SELECT de encounters, vital_signs, allergies y medications: solo admin y
--     médicos (is_clinician_of_active_clinic). En encounters se mantiene además
--     el acceso reforzado de las especialidades sensibles (Salud Mental).
--   * encounter_stubs(): lo MÍNIMO de una consulta que recepción necesita para
--     seguir trabajando -- id, paciente, fecha, cita enlazada y quién la atendió.
--     Nunca motivo, notas, diagnóstico, signos vitales ni especialidad. Verifica
--     pertenencia a la clínica activa y no devuelve las consultas de
--     especialidades sensibles a quien no tiene acceso a ellas.
--   * set_clinic_id_from_encounter pasa a security definer: es el trigger que
--     deriva la clínica de una reclamación a partir de su consulta (no
--     falsificable) y recepción, que crea reclamaciones, ya no ve esa tabla.
--     Sigue siendo seguro: solo devuelve un clinic_id, y el WITH CHECK de RLS de
--     cada tabla rechaza una consulta de otra clínica exactamente igual que antes.
--
-- Políticas RLS (descritas en la PR):
--   encounters / vital_signs / allergies / medications SELECT (modificadas):
--       is_member_of_active_clinic -> is_clinician_of_active_clinic. INSERT y
--       UPDATE no cambian (ya eran de admin y médicos).
--   Sin tablas nuevas. patient_insurers, claims, e-CF, citas y consentimientos
--       siguen visibles para recepción (no contienen datos clínicos); los
--       diagnósticos CIE de una reclamación se mantienen visibles para armar el
--       paquete de la ARS.

-- =============================================================================
-- 1. Lectura de datos clínicos: solo admin y médicos
-- =============================================================================

drop policy encounters_select_own_tenant on public.encounters;
create policy encounters_select_own_tenant
  on public.encounters for select to authenticated
  using (
    public.is_clinician_of_active_clinic(clinic_id)
    and public.can_access_sensitive_encounter(clinic_id, patient_id, specialty_template_id, provider_id)
  );

drop policy vital_signs_select_own_tenant on public.vital_signs;
create policy vital_signs_select_own_tenant
  on public.vital_signs for select to authenticated
  using (public.is_clinician_of_active_clinic(clinic_id));

drop policy allergies_select_own_tenant on public.allergies;
create policy allergies_select_own_tenant
  on public.allergies for select to authenticated
  using (public.is_clinician_of_active_clinic(clinic_id));

drop policy medications_select_own_tenant on public.medications;
create policy medications_select_own_tenant
  on public.medications for select to authenticated
  using (public.is_clinician_of_active_clinic(clinic_id));

-- =============================================================================
-- 2. Lo mínimo de una consulta para facturar, agendar y firmar consentimientos
-- =============================================================================

create or replace function public.encounter_stubs(
  p_patient_id uuid default null,
  p_encounter_ids uuid[] default null,
  p_appointment_ids uuid[] default null
)
returns table (
  id uuid,
  patient_id uuid,
  encounter_date timestamptz,
  appointment_id uuid,
  provider_id uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.patient_id, e.encounter_date, e.appointment_id, e.provider_id
  from public.encounters e
  join public.specialty_templates t on t.id = e.specialty_template_id
  where public.is_member_of_active_clinic(e.clinic_id)
    and (
      not t.requires_explicit_access
      or public.can_access_sensitive_encounter(e.clinic_id, e.patient_id, e.specialty_template_id, e.provider_id)
    )
    and (p_patient_id is null or e.patient_id = p_patient_id)
    and (p_encounter_ids is null or e.id = any (p_encounter_ids))
    and (p_appointment_ids is null or e.appointment_id = any (p_appointment_ids))
    -- Siempre con algún filtro: no es un listado libre de consultas.
    and (p_patient_id is not null or p_encounter_ids is not null or p_appointment_ids is not null);
$$;

revoke execute on function public.encounter_stubs(uuid, uuid[], uuid[]) from public, anon;
grant execute on function public.encounter_stubs(uuid, uuid[], uuid[]) to authenticated, service_role;

-- =============================================================================
-- 3. Reclamaciones desde recepción: la clínica se deriva sin leer la consulta
-- =============================================================================

create or replace function public.set_clinic_id_from_encounter()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select e.clinic_id into new.clinic_id from public.encounters e where e.id = new.encounter_id;
  return new;
end;
$$;

revoke execute on function public.set_clinic_id_from_encounter() from public, anon, authenticated;
