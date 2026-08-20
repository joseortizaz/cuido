-- Fase 1 (incremento 2) — núcleo clínico común + motor de plantillas por
-- especialidad + Medicina Interna como primera especialidad real.
--
-- Principio de CLAUDE.md aplicado aquí: "la especialidad es configuración,
-- no código" — specialty_templates.schema (jsonb) define los campos
-- dinámicos de cada especialidad; encounters.specialty_data guarda los
-- valores. Agregar una especialidad nueva es una fila, no una tabla ni una
-- migración de esquema.
--
-- RLS habilitada y forzada en todas las tablas nuevas, en este mismo
-- archivo, como exige CLAUDE.md.

-- ---------------------------------------------------------------------------
-- Helper de rol: clínico (admin o médico) vs. cualquier miembro
-- ---------------------------------------------------------------------------
-- Recepción puede leer y registrar pacientes, pero no escribir contenido
-- clínico (encuentros, vitales, alergias, medicamentos).

create or replace function public.is_clinic_clinician(target_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.clinic_members cm
    where cm.clinic_id = target_clinic_id
      and cm.user_id = auth.uid()
      and cm.role in ('admin', 'medico')
  );
$$;

revoke execute on function public.is_clinic_clinician(uuid) from public;
grant execute on function public.is_clinic_clinician(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Triggers: derivar clinic_id del padre, NUNCA confiar en el valor del
-- cliente. Mismo principio no negociable de CLAUDE.md que en clinics/
-- clinic_members, aplicado un nivel más abajo del árbol de tenant: sin
-- esto, alguien podría enviar patient_id de OTRO tenant junto a su propio
-- clinic_id y pasar el check de membresía aunque el paciente no sea suyo.
-- Postgres corre los triggers BEFORE INSERT antes de evaluar el WITH CHECK
-- de RLS, así que si patient_id/encounter_id es de otro tenant, el trigger
-- deriva ESE otro clinic_id y is_clinic_member() lo rechaza correctamente.
-- ---------------------------------------------------------------------------

create or replace function public.set_clinic_id_from_patient()
returns trigger
language plpgsql
as $$
begin
  select clinic_id into new.clinic_id from public.patients where id = new.patient_id;
  return new;
end;
$$;

create or replace function public.set_clinic_id_from_encounter()
returns trigger
language plpgsql
as $$
begin
  select clinic_id into new.clinic_id from public.encounters where id = new.encounter_id;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tabla: patients (núcleo demográfico)
-- ---------------------------------------------------------------------------

create table public.patients (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  first_name text not null check (char_length(trim(first_name)) > 0),
  last_name text not null check (char_length(trim(last_name)) > 0),
  -- Cédula o pasaporte. Sin validación de formato estricta todavía
  -- (extranjeros, pasaportes) — solo unicidad por clínica cuando se provee.
  national_id text,
  date_of_birth date not null,
  -- Sexo biológico para cálculos clínicos (rangos de referencia de signos
  -- vitales, aplicabilidad de módulos como embarazo en GO). No es un campo
  -- de identidad de género.
  sex text not null check (sex in ('femenino', 'masculino')),
  phone text,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.patients is
  'Núcleo demográfico del expediente clínico. Compartido por todas las '
  'especialidades — nunca se duplica por especialidad.';

create index patients_clinic_id_idx on public.patients (clinic_id);
create unique index patients_clinic_national_id_idx
  on public.patients (clinic_id, national_id)
  where national_id is not null;

create trigger patients_set_updated_at
  before update on public.patients
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Tabla: specialty_templates (catálogo GLOBAL de la plataforma)
-- ---------------------------------------------------------------------------
-- Sin clinic_id a propósito: en Fase 1 las plantillas las define Narnia,
-- no cada clínica. Personalización por clínica queda para una fase
-- posterior si se necesita.

create table public.specialty_templates (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  -- { "fields": [{ key, label, type, required, options? }, ...] }
  -- type ∈ text | textarea | number | select | date
  schema jsonb not null check (jsonb_typeof(schema) = 'object'),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.specialty_templates is
  'Catálogo de especialidades como configuración: agregar una especialidad '
  'nueva es una fila en esta tabla, no una tabla ni una migración de '
  'esquema nuevas.';

-- ---------------------------------------------------------------------------
-- Tabla: encounters (consulta/visita — ancla de los datos clínicos)
-- ---------------------------------------------------------------------------

create table public.encounters (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  patient_id uuid not null references public.patients (id) on delete cascade,
  -- Quién atendió. SIEMPRE auth.uid() puesto por la Server Action, nunca un
  -- campo de formulario -- mismo principio que clinic_members.user_id.
  provider_id uuid not null references auth.users (id),
  specialty_template_id uuid not null references public.specialty_templates (id),
  chief_complaint text,
  -- Campos dinámicos de la especialidad, validados en la app (Zod
  -- construido desde specialty_templates.schema) antes de llegar aquí.
  specialty_data jsonb not null default '{}'::jsonb
    check (jsonb_typeof(specialty_data) = 'object'),
  encounter_date timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.encounters is
  'Una consulta/visita clínica. Ancla de vital_signs y del contenido '
  'específico de la especialidad (specialty_data).';

create index encounters_clinic_id_idx on public.encounters (clinic_id);
create index encounters_patient_id_idx on public.encounters (patient_id);

create trigger encounters_set_clinic_id
  before insert on public.encounters
  for each row
  execute function public.set_clinic_id_from_patient();

create trigger encounters_set_updated_at
  before update on public.encounters
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Tabla: vital_signs (signos vitales por consulta)
-- ---------------------------------------------------------------------------

create table public.vital_signs (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  encounter_id uuid not null references public.encounters (id) on delete cascade,
  systolic_bp integer,
  diastolic_bp integer,
  heart_rate integer,
  respiratory_rate integer,
  temperature_celsius numeric(4, 1),
  oxygen_saturation integer,
  weight_kg numeric(5, 2),
  height_cm numeric(5, 1),
  recorded_at timestamptz not null default now()
);

create index vital_signs_clinic_id_idx on public.vital_signs (clinic_id);
create index vital_signs_encounter_id_idx on public.vital_signs (encounter_id);

create trigger vital_signs_set_clinic_id
  before insert on public.vital_signs
  for each row
  execute function public.set_clinic_id_from_encounter();

-- ---------------------------------------------------------------------------
-- Tabla: allergies (lista viva por paciente, no por consulta)
-- ---------------------------------------------------------------------------

create table public.allergies (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  patient_id uuid not null references public.patients (id) on delete cascade,
  substance text not null,
  reaction text,
  severity text check (severity in ('leve', 'moderada', 'severa')),
  status text not null default 'activa' check (status in ('activa', 'resuelta')),
  recorded_at timestamptz not null default now()
);

create index allergies_clinic_id_idx on public.allergies (clinic_id);
create index allergies_patient_id_idx on public.allergies (patient_id);

create trigger allergies_set_clinic_id
  before insert on public.allergies
  for each row
  execute function public.set_clinic_id_from_patient();

-- ---------------------------------------------------------------------------
-- Tabla: medications (medicamentos activos, lista viva por paciente)
-- ---------------------------------------------------------------------------

create table public.medications (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  patient_id uuid not null references public.patients (id) on delete cascade,
  name text not null,
  dose text,
  frequency text,
  status text not null default 'activo' check (status in ('activo', 'descontinuado')),
  started_at date,
  discontinued_at date,
  created_at timestamptz not null default now()
);

create index medications_clinic_id_idx on public.medications (clinic_id);
create index medications_patient_id_idx on public.medications (patient_id);

create trigger medications_set_clinic_id
  before insert on public.medications
  for each row
  execute function public.set_clinic_id_from_patient();

-- ---------------------------------------------------------------------------
-- RLS + GRANTs
-- ---------------------------------------------------------------------------
-- Recordatorio de Fase 0: las tablas nuevas de `public` NO se auto-exponen
-- a los roles de la Data API. GRANT explícito en el mismo archivo que RLS,
-- para no repetir el error de la migración de GRANTs de Fase 0.

-- patients: cualquier miembro de la clínica lee/registra (recepción incluida).
alter table public.patients enable row level security;
alter table public.patients force row level security;

create policy patients_select_own_tenant
  on public.patients for select to authenticated
  using (public.is_clinic_member(clinic_id));

create policy patients_insert_own_tenant
  on public.patients for insert to authenticated
  with check (public.is_clinic_member(clinic_id));

create policy patients_update_own_tenant
  on public.patients for update to authenticated
  using (public.is_clinic_member(clinic_id))
  with check (public.is_clinic_member(clinic_id));

grant select, insert, update on public.patients to authenticated, service_role;

-- specialty_templates: catálogo global de solo lectura para authenticated.
alter table public.specialty_templates enable row level security;
alter table public.specialty_templates force row level security;

create policy specialty_templates_select_any_authenticated
  on public.specialty_templates for select to authenticated
  using (true);

grant select on public.specialty_templates to authenticated;
grant select, insert, update on public.specialty_templates to service_role;

-- encounters/vital_signs/allergies/medications: cualquier miembro lee;
-- solo admin/médico escribe contenido clínico.
alter table public.encounters enable row level security;
alter table public.encounters force row level security;

create policy encounters_select_own_tenant
  on public.encounters for select to authenticated
  using (public.is_clinic_member(clinic_id));

create policy encounters_insert_by_clinician
  on public.encounters for insert to authenticated
  with check (public.is_clinic_clinician(clinic_id));

create policy encounters_update_by_clinician
  on public.encounters for update to authenticated
  using (public.is_clinic_clinician(clinic_id))
  with check (public.is_clinic_clinician(clinic_id));

grant select, insert, update on public.encounters to authenticated, service_role;

alter table public.vital_signs enable row level security;
alter table public.vital_signs force row level security;

create policy vital_signs_select_own_tenant
  on public.vital_signs for select to authenticated
  using (public.is_clinic_member(clinic_id));

create policy vital_signs_insert_by_clinician
  on public.vital_signs for insert to authenticated
  with check (public.is_clinic_clinician(clinic_id));

grant select, insert on public.vital_signs to authenticated, service_role;

alter table public.allergies enable row level security;
alter table public.allergies force row level security;

create policy allergies_select_own_tenant
  on public.allergies for select to authenticated
  using (public.is_clinic_member(clinic_id));

create policy allergies_insert_by_clinician
  on public.allergies for insert to authenticated
  with check (public.is_clinic_clinician(clinic_id));

create policy allergies_update_by_clinician
  on public.allergies for update to authenticated
  using (public.is_clinic_clinician(clinic_id))
  with check (public.is_clinic_clinician(clinic_id));

grant select, insert, update on public.allergies to authenticated, service_role;

alter table public.medications enable row level security;
alter table public.medications force row level security;

create policy medications_select_own_tenant
  on public.medications for select to authenticated
  using (public.is_clinic_member(clinic_id));

create policy medications_insert_by_clinician
  on public.medications for insert to authenticated
  with check (public.is_clinic_clinician(clinic_id));

create policy medications_update_by_clinician
  on public.medications for update to authenticated
  using (public.is_clinic_clinician(clinic_id))
  with check (public.is_clinic_clinician(clinic_id));

grant select, insert, update on public.medications to authenticated, service_role;

-- Ninguna de las tablas anteriores tiene política de DELETE: registro
-- clínico no se borra, se marca resuelto/descontinuado vía `status`
-- (mismo principio que `clinics` en Fase 0).

-- ---------------------------------------------------------------------------
-- Siembra: Medicina Interna (primera especialidad de Fase 1, CLAUDE.md)
-- ---------------------------------------------------------------------------

insert into public.specialty_templates (code, name, schema) values (
  'medicina_interna',
  'Medicina Interna',
  '{
    "fields": [
      { "key": "evaluacion", "label": "Evaluación / hallazgos", "type": "textarea", "required": true },
      { "key": "diagnostico", "label": "Diagnóstico", "type": "text", "required": true },
      { "key": "plan_tratamiento", "label": "Plan de tratamiento", "type": "textarea", "required": false },
      { "key": "seguimiento", "label": "Seguimiento", "type": "select", "required": false,
        "options": ["1 semana", "2 semanas", "1 mes", "No requiere"] }
    ]
  }'::jsonb
);
