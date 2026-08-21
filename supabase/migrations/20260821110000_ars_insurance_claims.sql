-- Fase 2 (parte 3) — ARS/SENASA: elegibilidad y reclamaciones semi-manuales.
-- Sin integración de API en vivo con ninguna aseguradora -- tres registros
-- que el personal de la clínica llena a mano.
--
-- A diferencia de e-CF (supabase/migrations/20260821090000_ecf_billing.sql),
-- ninguna de estas tres tablas protege un recurso compartido tipo
-- correlativo legal -- no hacen falta RPCs, INSERT/UPDATE directo con RLS
-- acotada alcanza (mismo criterio pedido explícitamente para esta ronda).
-- La única regla con algo de estructura ("una sola aseguradora vigente por
-- paciente") la resuelve un índice único parcial de Postgres, no una
-- transacción a mano.
--
-- Reusa helpers/triggers ya existentes: set_clinic_id_from_patient(),
-- set_clinic_id_from_encounter(), is_member_of_active_clinic(),
-- is_billing_staff_of_active_clinic() (esta última creada en la migración
-- de e-CF -- ver esa migración para el razonamiento de por qué admin +
-- recepción, sin médico, cuenta como "personal de facturación/seguros").
--
-- RLS habilitada y forzada en todas las tablas nuevas, en este mismo
-- archivo, como exige CLAUDE.md.

-- ---------------------------------------------------------------------------
-- Tabla: patient_insurers (aseguradora + afiliado, historial por paciente)
-- ---------------------------------------------------------------------------

create table public.patient_insurers (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  patient_id uuid not null references public.patients (id) on delete cascade,
  -- Texto libre (ARS Humano, ARS Palic, SENASA, etc.) -- mismo criterio
  -- que allergies.substance/medications.name: sin catálogo fijo en Fase 1.
  insurer_name text not null check (char_length(trim(insurer_name)) > 0),
  affiliate_number text not null check (char_length(trim(affiliate_number)) > 0),
  is_current boolean not null default true,
  recorded_by uuid not null references auth.users (id),
  recorded_at timestamptz not null default now()
);

comment on table public.patient_insurers is
  'Aseguradora + número de afiliado de un paciente, con historial (cambios '
  'de trabajo, etc.). Solo una fila puede estar is_current=true por '
  'paciente -- ver patient_insurers_one_current_idx.';

create index patient_insurers_clinic_id_idx on public.patient_insurers (clinic_id);
create index patient_insurers_patient_id_idx on public.patient_insurers (patient_id);

-- Garantía real de "solo una vigente a la vez" -- Postgres la hace cumplir
-- sin importar el orden en que lleguen los INSERT/UPDATE, no depende de
-- que la app coordine una transacción.
create unique index patient_insurers_one_current_idx
  on public.patient_insurers (patient_id) where is_current;

create trigger patient_insurers_set_clinic_id
  before insert on public.patient_insurers
  for each row
  execute function public.set_clinic_id_from_patient();

alter table public.patient_insurers enable row level security;
alter table public.patient_insurers force row level security;

create policy patient_insurers_select_own_tenant
  on public.patient_insurers for select to authenticated
  using (public.is_member_of_active_clinic(clinic_id));

create policy patient_insurers_insert_by_billing_staff
  on public.patient_insurers for insert to authenticated
  with check (public.is_billing_staff_of_active_clinic(clinic_id));

create policy patient_insurers_update_by_billing_staff
  on public.patient_insurers for update to authenticated
  using (public.is_billing_staff_of_active_clinic(clinic_id))
  with check (public.is_billing_staff_of_active_clinic(clinic_id));

-- Sin política de DELETE -- historial, no se borra.

grant select, insert, update on public.patient_insurers to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Tabla: eligibility_checks (constancia de verificación MANUAL -- log de
-- auditoría, no "estado actual" -- nunca se edita una vez creada)
-- ---------------------------------------------------------------------------

create table public.eligibility_checks (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  patient_id uuid not null references public.patients (id) on delete cascade,
  patient_insurer_id uuid not null references public.patient_insurers (id),
  result text not null check (result in ('elegible', 'no_elegible', 'pendiente')),
  notes text,
  checked_by uuid not null references auth.users (id),
  checked_at timestamptz not null default now()
);

comment on table public.eligibility_checks is
  'Constancia de que alguien del personal llamó a la aseguradora o revisó '
  'su portal y anotó el resultado -- NO es una consulta automática. '
  'Solo-inserción: si el resultado cambia, se registra una verificación '
  'nueva, no se edita la anterior (mismo espíritu que consents).';

create index eligibility_checks_clinic_id_idx on public.eligibility_checks (clinic_id);
create index eligibility_checks_patient_id_idx on public.eligibility_checks (patient_id);

create trigger eligibility_checks_set_clinic_id
  before insert on public.eligibility_checks
  for each row
  execute function public.set_clinic_id_from_patient();

alter table public.eligibility_checks enable row level security;
alter table public.eligibility_checks force row level security;

create policy eligibility_checks_select_own_tenant
  on public.eligibility_checks for select to authenticated
  using (public.is_member_of_active_clinic(clinic_id));

create policy eligibility_checks_insert_by_billing_staff
  on public.eligibility_checks for insert to authenticated
  with check (public.is_billing_staff_of_active_clinic(clinic_id));

-- Sin política de UPDATE ni DELETE -- registro de auditoría inmutable.
--
-- Nota sobre el mecanismo real de esta protección (confirmado con una
-- prueba manual durante el desarrollo): a diferencia de INSERT -- que
-- rechaza con un error explícito si ninguna política WITH CHECK aprueba
-- la fila nueva --, un UPDATE/DELETE sin ninguna política aplicable NO
-- lanza error: Postgres simplemente no encuentra ninguna fila visible
-- para esa operación y el comando "tiene éxito" afectando 0 filas. El
-- efecto práctico es idéntico (la fila nunca cambia), pero un intento de
-- verificar esto con "¿devolvió error?" da un falso negativo -- hay que
-- verificar el estado real de la fila antes/después.

grant select, insert on public.eligibility_checks to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Tabla: insurance_claims (reclamación asociada a un encounter)
-- ---------------------------------------------------------------------------

create table public.insurance_claims (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  encounter_id uuid not null references public.encounters (id) on delete cascade,
  patient_insurer_id uuid not null references public.patient_insurers (id),
  status text not null default 'pendiente'
    check (status in ('pendiente', 'enviada', 'aprobada', 'rechazada')),
  -- Requerido a nivel app cuando status='rechazada' -- validado en la
  -- Server Action, mismo criterio que otros campos condicionales del
  -- proyecto (no se fuerza con CHECK en SQL).
  rejection_reason text,
  claimed_amount numeric(12, 2),
  notes text,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  status_updated_by uuid references auth.users (id),
  status_updated_at timestamptz,
  updated_at timestamptz not null default now()
);

comment on table public.insurance_claims is
  'Reclamación ante una aseguradora, asociada a un encounter. El '
  'diagnóstico que la sustenta ya vive en el encounter (lo escribió el '
  'médico) -- esto es el sobre administrativo de seguimiento, sin envío '
  'automatizado en esta ronda.';

create index insurance_claims_clinic_id_idx on public.insurance_claims (clinic_id);
create index insurance_claims_encounter_id_idx on public.insurance_claims (encounter_id);
create index insurance_claims_status_idx on public.insurance_claims (clinic_id, status);

create trigger insurance_claims_set_clinic_id
  before insert on public.insurance_claims
  for each row
  execute function public.set_clinic_id_from_encounter();

create trigger insurance_claims_set_updated_at
  before update on public.insurance_claims
  for each row
  execute function public.set_updated_at();

alter table public.insurance_claims enable row level security;
alter table public.insurance_claims force row level security;

create policy insurance_claims_select_own_tenant
  on public.insurance_claims for select to authenticated
  using (public.is_member_of_active_clinic(clinic_id));

create policy insurance_claims_insert_by_billing_staff
  on public.insurance_claims for insert to authenticated
  with check (public.is_billing_staff_of_active_clinic(clinic_id));

-- UPDATE de fila completa para admin/recepción: a diferencia de
-- fiscal_documents (que sí necesitó un grant de columna acotado porque
-- e_ncf/totales tenían un invariante estricto que proteger), aquí no hay
-- ningún campo con esa exigencia -- USING/WITH CHECK normal alcanza. La
-- UI simplemente no expone encounter_id/patient_insurer_id como editables
-- después de creado.
create policy insurance_claims_update_by_billing_staff
  on public.insurance_claims for update to authenticated
  using (public.is_billing_staff_of_active_clinic(clinic_id))
  with check (public.is_billing_staff_of_active_clinic(clinic_id));

-- Sin política de DELETE -- registro de seguimiento, no se borra.

grant select, insert, update on public.insurance_claims to authenticated, service_role;
