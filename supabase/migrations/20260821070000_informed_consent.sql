-- Fase 2 (parte 1) — firma electrónica SIMPLE de consentimiento informado
-- (Ley 126-02, Ley 42-01). Deliberadamente sin PKI/certificado digital: el
-- certificado tributario PSC/INDOTEL sigue en trámite (ver CLAUDE.md), así
-- que esta pieza es la que NO depende de él. La ruta hacia firma avanzada
-- certificada por INDOTEL queda para cuando el certificado esté listo.
--
-- Genérico a propósito: consent_type/consent_template no se acoplan a una
-- especialidad, y encounter_id es NULLABLE porque Fase 3 (salud mental)
-- necesitará poder colgar un consentimiento de una acción que no sea una
-- consulta. RLS habilitada y forzada en todas las tablas nuevas, en este
-- mismo archivo, como exige CLAUDE.md.

-- ---------------------------------------------------------------------------
-- Tabla: consent_templates (catálogo GLOBAL, mismo patrón que
-- specialty_templates -- Narnia lo mantiene, no cada clínica)
-- ---------------------------------------------------------------------------

create table public.consent_templates (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  title text not null,
  -- Texto completo mostrado al firmante. Se resuelve como snapshot
  -- inmutable dentro de cada fila de `consents` al momento de firmar --
  -- editar esta plantilla después NUNCA cambia un consentimiento ya
  -- firmado (ver document_content más abajo).
  body text not null check (char_length(trim(body)) > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.consent_templates is
  'Catálogo global de textos de consentimiento. Agregar un tipo nuevo '
  '(p. ej. Fase 3 salud mental) es una fila, no una migración de esquema.';

alter table public.consent_templates enable row level security;
alter table public.consent_templates force row level security;

create policy consent_templates_select_any_authenticated
  on public.consent_templates for select to authenticated
  using (true);

grant select on public.consent_templates to authenticated;
grant select, insert, update on public.consent_templates to service_role;

-- Siembra: UNA plantilla mínima para que el flujo funcione de punta a
-- punta hoy. BORRADOR -- pendiente de revisión legal antes de usarse con
-- pacientes reales; no es un texto certificado ni revisado por asesoría
-- jurídica.
-- Nota sobre el string literal de abajo: un '\n\n' dentro de comillas
-- simples normales NO se interpreta como salto de línea en Postgres (no
-- es un E'' escape string) -- quedaría como los 4 caracteres literales
-- \, n, \, n. El salto de línea real de más abajo, dentro de las mismas
-- comillas, sí se guarda como salto de línea de verdad.
insert into public.consent_templates (code, title, body) values (
  'consentimiento_general',
  'Consentimiento informado general',
  'Declaro que he sido informado(a), en un lenguaje claro y comprensible, sobre mi situación de salud, el propósito de la atención médica a recibir en esta clínica, los procedimientos que razonablemente implica, sus riesgos y beneficios esperados, así como las alternativas disponibles. He tenido la oportunidad de hacer preguntas y estas fueron respondidas a mi satisfacción. Autorizo de forma libre y voluntaria la atención médica descrita.

[Texto borrador -- pendiente de revisión legal antes de uso con pacientes reales.]'
);

-- ---------------------------------------------------------------------------
-- Tabla: consents (registro firmado -- inmutable una vez creado)
-- ---------------------------------------------------------------------------

create table public.consents (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  patient_id uuid not null references public.patients (id) on delete cascade,
  -- Nullable a propósito: Fase 3 podrá asociar un consentimiento a algo
  -- que no sea un encounter. on delete set null -- borrar la consulta
  -- (no ocurre hoy, no hay política de DELETE) nunca debe borrar el
  -- registro legal de que se firmó un consentimiento.
  encounter_id uuid references public.encounters (id) on delete set null,
  consent_template_id uuid not null references public.consent_templates (id),

  -- Snapshot inmutable del template AL MOMENTO DE FIRMAR. Lo resuelve la
  -- Edge Function sign-consent server-side a partir de consent_template_id
  -- -- nunca confía en texto enviado por el cliente. Si la plantilla
  -- cambia después, este registro ya firmado no cambia.
  document_title text not null,
  document_content text not null,
  -- sha-256 hex de un JSON canónico que ata el documento a QUIÉN firmó y
  -- CUÁNDO (document_title, document_content, patient_id, signer_name,
  -- signer_national_id, signer_relationship, signed_at) -- no solo el
  -- texto. Ver Edge Function para el cálculo exacto.
  document_hash text not null,

  signer_name text not null check (char_length(trim(signer_name)) > 0),
  signer_national_id text,
  signer_relationship text not null default 'paciente'
    check (signer_relationship in ('paciente', 'tutor', 'representante')),

  -- Trazabilidad de la firma electrónica simple (Ley 126-02): no prueba
  -- identidad criptográfica (eso requiere el certificado PSC/INDOTEL,
  -- todavía en trámite), prueba la fiabilidad del proceso.
  signed_at timestamptz not null default now(),
  signer_ip inet,
  signer_user_agent text,
  -- Quién de la clínica operó el flujo (recepción, médico) -- NO
  -- necesariamente quien firma. Siempre auth.uid() puesto por la Edge
  -- Function, nunca un campo de formulario.
  recorded_by uuid not null references auth.users (id),

  status text not null default 'firmado' check (status in ('firmado', 'revocado')),
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id),
  revoked_reason text,

  created_at timestamptz not null default now()
);

comment on table public.consents is
  'Registro de firma electrónica simple de consentimiento informado. '
  'Inmutable tras crearse -- ni siquiera un admin puede editar el '
  'contenido/firma vía UPDATE (sin política de UPDATE para authenticated); '
  'revocar es la única transición permitida, y pasa por el RPC '
  'revoke_consent, nunca por un UPDATE directo.';

create index consents_clinic_id_idx on public.consents (clinic_id);
create index consents_patient_id_idx on public.consents (patient_id);
create index consents_encounter_id_idx on public.consents (encounter_id);

create trigger consents_set_clinic_id
  before insert on public.consents
  for each row
  execute function public.set_clinic_id_from_patient();

-- ---------------------------------------------------------------------------
-- RLS: consents
-- ---------------------------------------------------------------------------

alter table public.consents enable row level security;
alter table public.consents force row level security;

-- Lectura: cualquier miembro de una clínica ACTIVA (mismo criterio que el
-- resto de tablas clínicas desde platform_operators -- una clínica
-- desactivada pierde acceso a datos clínicos, no solo a esta tabla).
create policy consents_select_own_tenant
  on public.consents for select to authenticated
  using (public.is_member_of_active_clinic(clinic_id));

-- Sin política de INSERT para `authenticated`: el único camino es la Edge
-- Function sign-consent (usa service_role tras verificar membresía
-- internamente) -- protege el rastro de auditoría (hash/IP/timestamp) de
-- cualquier posibilidad de manipulación desde el cliente. Mismo principio
-- que platform_operators nunca se otorga vía RPC autoservicio.
--
-- Sin política de UPDATE para `authenticated` tampoco -- ni siquiera para
-- revocar. Revocar pasa por el RPC revoke_consent (más abajo), que solo
-- puede tocar status/revoked_* y nunca el contenido/firma. Más estricto
-- que el patrón de `clinics` (que sí permite UPDATE de columnas concretas
-- vía grant): acá el objetivo es que el contenido firmado sea
-- inmutable a nivel de permisos, no solo "protegido por RLS".
--
-- Sin política de DELETE -- registro legal, no se borra (mismo principio
-- que el resto del expediente clínico).

grant select on public.consents to authenticated;
grant select, insert, update on public.consents to service_role;

-- ---------------------------------------------------------------------------
-- RPC: revoke_consent -- única forma de cambiar el estado de un consents
-- ---------------------------------------------------------------------------

create or replace function public.revoke_consent(target_consent_id uuid, reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinic_id uuid;
begin
  select clinic_id into v_clinic_id from public.consents where id = target_consent_id;

  if v_clinic_id is null then
    raise exception 'Consentimiento no encontrado';
  end if;

  -- Deliberadamente más estricto que quién puede firmar (cualquier
  -- miembro, vía la Edge Function): revocar requiere ser admin o médico
  -- de la clínica.
  if not public.is_clinic_clinician(v_clinic_id) then
    raise exception 'Solo un admin o médico de la clínica puede revocar un consentimiento';
  end if;

  if reason is null or char_length(trim(reason)) = 0 then
    raise exception 'El motivo de revocación es requerido';
  end if;

  update public.consents
  set status = 'revocado',
      revoked_at = now(),
      revoked_by = auth.uid(),
      revoked_reason = reason
  where id = target_consent_id
    and status = 'firmado';

  if not found then
    raise exception 'El consentimiento no existe o ya fue revocado';
  end if;
end;
$$;

revoke execute on function public.revoke_consent(uuid, text) from public;
grant execute on function public.revoke_consent(uuid, text) to authenticated;
