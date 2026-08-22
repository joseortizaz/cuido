-- Fase 3 — aislamiento de acceso a especialidades sensibles (Salud
-- Mental / Psicología es la primera, pero el mecanismo es genérico:
-- cualquier especialidad futura marcada como sensible lo reutiliza sin
-- otra migración de esquema).
--
-- Diseño propuesto y CONFIRMADO por el usuario antes de escribir esta
-- migración (regla no negociable de CLAUDE.md para cambios de RLS/
-- autenticación): en vez de bifurcar en una tabla `mental_health_notes`
-- separada (que duplicaría todo el motor de plantillas/UI genérico --
-- encounter-form.tsx, la página de detalle, groupFieldsBySection --
-- para una sola especialidad), se extiende la política de `encounters`
-- existente con una condición adicional cuando la especialidad del
-- encounter está marcada `requires_explicit_access`.
--
-- Requisito de origen (CLAUDE.md, decisión de producto preexistente):
-- "un médico general de la clínica no debe poder leer notas de
-- psicología de otro profesional sin permiso explícito, incluso dentro
-- del mismo tenant". El propio profesional tratante (provider_id)
-- siempre puede leer lo suyo; cualquier otro clínico necesita una
-- concesión explícita, revocable, registrada con motivo.
--
-- RLS habilitada y forzada en la tabla nueva, en este mismo archivo,
-- como exige CLAUDE.md.

-- ---------------------------------------------------------------------------
-- Flag reusable en el catálogo global de especialidades
-- ---------------------------------------------------------------------------

alter table public.specialty_templates
  add column requires_explicit_access boolean not null default false;

comment on column public.specialty_templates.requires_explicit_access is
  'Si es true, los encounters de esta especialidad solo son legibles/'
  'editables por su provider_id o por alguien con una concesión activa '
  'en sensitive_specialty_access_grants -- ver esa tabla y las políticas '
  'de encounters más abajo.';

-- ---------------------------------------------------------------------------
-- Tabla: sensitive_specialty_access_grants (concesión explícita, revocable)
-- ---------------------------------------------------------------------------
-- Granularidad: por paciente + especialidad sensible, no por encounter
-- individual -- coincide con la pregunta real ("¿puede el Dr. X ver la
-- historia psiquiátrica de esta paciente?") sin fricción de re-otorgar
-- en cada consulta nueva.

create table public.sensitive_specialty_access_grants (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  patient_id uuid not null references public.patients (id) on delete cascade,
  specialty_template_id uuid not null references public.specialty_templates (id),
  granted_to_user_id uuid not null references auth.users (id),
  -- Siempre auth.uid() puesto por el RPC, nunca un campo de formulario --
  -- mismo principio que provider_id/recorded_by en el resto del proyecto.
  granted_by_user_id uuid not null references auth.users (id),
  -- Obligatorio -- trazabilidad exigida por Ley 172-13 para justificar
  -- por qué se le dio acceso a datos sensibles a un tercero.
  reason text not null check (char_length(trim(reason)) > 0),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by_user_id uuid references auth.users (id),
  revoked_reason text,
  created_at timestamptz not null default now()
);

comment on table public.sensitive_specialty_access_grants is
  'Concesión explícita y revocable de acceso a los encounters de una '
  'especialidad marcada requires_explicit_access, para un paciente '
  'concreto. Solo un admin de la clínica puede otorgar/revocar -- ver '
  'los RPCs grant_sensitive_specialty_access/revoke_sensitive_specialty_access. '
  'Nunca se otorga vía INSERT directo desde el cliente.';

create index sensitive_grants_clinic_id_idx on public.sensitive_specialty_access_grants (clinic_id);
create index sensitive_grants_patient_id_idx on public.sensitive_specialty_access_grants (patient_id);
create index sensitive_grants_granted_to_idx on public.sensitive_specialty_access_grants (granted_to_user_id);

-- Solo una concesión activa por (paciente, especialidad, usuario) -- evita
-- filas duplicadas de "acceso vigente" para la misma combinación.
create unique index sensitive_grants_active_unique_idx
  on public.sensitive_specialty_access_grants (clinic_id, patient_id, specialty_template_id, granted_to_user_id)
  where revoked_at is null;

create trigger sensitive_grants_set_clinic_id
  before insert on public.sensitive_specialty_access_grants
  for each row
  execute function public.set_clinic_id_from_patient();

-- Integridad: no permitir crear un grant para una especialidad que no
-- está marcada como sensible (evita ruido/confusión -- un grant "de
-- mentira" para medicina_interna, que nadie necesita).
create or replace function public.check_grant_targets_sensitive_specialty()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from public.specialty_templates
    where id = new.specialty_template_id and requires_explicit_access
  ) then
    raise exception 'Esta especialidad no requiere concesión explícita de acceso.';
  end if;
  return new;
end;
$$;

create trigger sensitive_grants_check_specialty
  before insert on public.sensitive_specialty_access_grants
  for each row
  execute function public.check_grant_targets_sensitive_specialty();

alter table public.sensitive_specialty_access_grants enable row level security;
alter table public.sensitive_specialty_access_grants force row level security;

-- SELECT: el admin que administra accesos ve todos los de su clínica;
-- cualquier clínico ve SOLO los suyos (para saber a qué pacientes tiene
-- acceso él mismo) -- no puede navegar los grants de otros, sería fuga
-- de metadata ("el Dr. Y tiene acceso psiquiátrico a la paciente Z").
create policy sensitive_grants_select
  on public.sensitive_specialty_access_grants for select to authenticated
  using (public.is_clinic_admin(clinic_id) or granted_to_user_id = auth.uid());

-- Sin política de INSERT/UPDATE para `authenticated`: todo pasa por los
-- RPCs de más abajo (mismo patrón que consents/revoke_consent) -- nunca
-- un INSERT/UPDATE directo desde el cliente.
-- Sin política de DELETE -- se revoca (revoked_at), no se borra.

grant select on public.sensitive_specialty_access_grants to authenticated;
grant select, insert, update on public.sensitive_specialty_access_grants to service_role;

-- ---------------------------------------------------------------------------
-- Helper: ¿puede auth.uid() acceder a este encounter?
-- ---------------------------------------------------------------------------
-- true si la especialidad no es sensible, o si es el propio profesional
-- tratante, o si existe una concesión activa para (paciente, especialidad,
-- usuario actual).

create or replace function public.can_access_sensitive_encounter(
  target_clinic_id uuid,
  target_patient_id uuid,
  target_specialty_template_id uuid,
  target_provider_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    not exists (
      select 1 from public.specialty_templates
      where id = target_specialty_template_id and requires_explicit_access
    )
    or target_provider_id = auth.uid()
    or exists (
      select 1 from public.sensitive_specialty_access_grants g
      where g.clinic_id = target_clinic_id
        and g.patient_id = target_patient_id
        and g.specialty_template_id = target_specialty_template_id
        and g.granted_to_user_id = auth.uid()
        and g.revoked_at is null
    );
$$;

revoke execute on function public.can_access_sensitive_encounter(uuid, uuid, uuid, uuid) from public;
grant execute on function public.can_access_sensitive_encounter(uuid, uuid, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RPCs: otorgar/revocar acceso -- solo admin, nunca médico
-- ---------------------------------------------------------------------------
-- Deliberado: si cualquier médico pudiera crear grants, un médico
-- general sin relación con el paciente podría auto-concederse acceso --
-- exactamente el bypass que el requisito de aislamiento quiere impedir.
-- Un admin (aunque no sea clínico) SOLO administra el proceso de
-- concesión (dos UUIDs + paciente + especialidad); la política de
-- encounters de más abajo NO le da ningún bypass de lectura de
-- contenido clínico -- sigue necesitando ser provider_id o tener su
-- propio grant, exactamente igual que cualquier otro usuario.

-- Nota: los parámetros de motivo se llaman `p_reason` (no `reason`) a
-- propósito -- `sensitive_specialty_access_grants` tiene una columna
-- `reason` propia (el motivo de la concesión original), y un parámetro
-- de función con el mismo nombre sin calificar sería ambiguo dentro de
-- un UPDATE/INSERT sobre esa tabla (encontrado en pruebas: Postgres
-- rechaza la función con "column reference \"reason\" is ambiguous").

create or replace function public.grant_sensitive_specialty_access(
  target_patient_id uuid,
  target_specialty_template_id uuid,
  target_user_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinic_id uuid;
  v_grant_id uuid;
begin
  select clinic_id into v_clinic_id from public.patients where id = target_patient_id;
  if v_clinic_id is null then
    raise exception 'Paciente no encontrado';
  end if;

  if not public.is_clinic_admin(v_clinic_id) then
    raise exception 'Solo un admin de la clínica puede conceder este acceso';
  end if;

  if not exists (select 1 from public.clinics where id = v_clinic_id and is_active) then
    raise exception 'La clínica no está activa';
  end if;

  if not exists (
    select 1 from public.clinic_members
    where clinic_id = v_clinic_id and user_id = target_user_id
  ) then
    raise exception 'El usuario destino no es miembro de esta clínica';
  end if;

  if p_reason is null or char_length(trim(p_reason)) = 0 then
    raise exception 'El motivo de la concesión es requerido';
  end if;

  insert into public.sensitive_specialty_access_grants
    (patient_id, specialty_template_id, granted_to_user_id, granted_by_user_id, reason)
  values (target_patient_id, target_specialty_template_id, target_user_id, auth.uid(), p_reason)
  returning id into v_grant_id;

  return v_grant_id;
end;
$$;

revoke execute on function public.grant_sensitive_specialty_access(uuid, uuid, uuid, text) from public;
grant execute on function public.grant_sensitive_specialty_access(uuid, uuid, uuid, text) to authenticated;

create or replace function public.revoke_sensitive_specialty_access(target_grant_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinic_id uuid;
begin
  select clinic_id into v_clinic_id from public.sensitive_specialty_access_grants where id = target_grant_id;

  if v_clinic_id is null then
    raise exception 'Concesión no encontrada';
  end if;

  if not public.is_clinic_admin(v_clinic_id) then
    raise exception 'Solo un admin de la clínica puede revocar este acceso';
  end if;

  if p_reason is null or char_length(trim(p_reason)) = 0 then
    raise exception 'El motivo de la revocación es requerido';
  end if;

  update public.sensitive_specialty_access_grants
  set revoked_at = now(),
      revoked_by_user_id = auth.uid(),
      revoked_reason = p_reason
  where id = target_grant_id
    and revoked_at is null;

  if not found then
    raise exception 'La concesión no existe o ya fue revocada';
  end if;
end;
$$;

revoke execute on function public.revoke_sensitive_specialty_access(uuid, text) from public;
grant execute on function public.revoke_sensitive_specialty_access(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Políticas de `encounters` -- reemplazan las 3 de
-- 20260820111106_clinical_core_and_templates.sql
-- ---------------------------------------------------------------------------

drop policy encounters_select_own_tenant on public.encounters;
create policy encounters_select_own_tenant
  on public.encounters for select to authenticated
  using (
    public.is_member_of_active_clinic(clinic_id)
    and public.can_access_sensitive_encounter(clinic_id, patient_id, specialty_template_id, provider_id)
  );

-- INSERT: sin cambio en quién puede crear (admin/médico, igual que
-- siempre) + refuerzo de defensa en profundidad: si la especialidad es
-- sensible, provider_id debe ser auth.uid(). No cambia ningún
-- comportamiento actual -- confirmado en actions.ts: provider_id ya es
-- SIEMPRE user.id puesto server-side para cualquier especialidad, nunca
-- viene del formulario. Esto cierra la puerta a que alguien "enmarque"
-- a otro profesional como autor de una nota que ese profesional no
-- podrá leer después (si algún día se agrega otra vía de inserción).
drop policy encounters_insert_by_clinician on public.encounters;
create policy encounters_insert_by_clinician
  on public.encounters for insert to authenticated
  with check (
    public.is_clinician_of_active_clinic(clinic_id)
    and (
      not exists (
        select 1 from public.specialty_templates
        where id = specialty_template_id and requires_explicit_access
      )
      or provider_id = auth.uid()
    )
  );

-- UPDATE: cierra un hueco real que existía antes de esta migración --
-- sin esto, un médico sin grant no podía LEER una nota sensible pero SÍ
-- podía sobreescribirla a ciegas con un UPDATE directo (el USING
-- anterior solo verificaba rol, no acceso). Restringido SOLO para
-- especialidades marcadas como sensibles -- el problema más general de
-- que cualquier admin/médico pueda editar cualquier encounter de
-- CUALQUIER especialidad es preexistente y queda fuera de esta tarea
-- (que pide aislamiento de lectura para salud mental específicamente).
drop policy encounters_update_by_clinician on public.encounters;
create policy encounters_update_by_clinician
  on public.encounters for update to authenticated
  using (
    public.is_clinician_of_active_clinic(clinic_id)
    and public.can_access_sensitive_encounter(clinic_id, patient_id, specialty_template_id, provider_id)
  )
  with check (
    public.is_clinician_of_active_clinic(clinic_id)
    and public.can_access_sensitive_encounter(clinic_id, patient_id, specialty_template_id, provider_id)
  );
