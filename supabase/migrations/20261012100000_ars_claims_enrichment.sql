-- Reclamaciones a ARS -- Bloque A.1 a A.3 (docs/plan-reclamaciones-ars.md).
--
--   A1  Vincular la reclamación con el comprobante fiscal (e-CF) y registrar
--       número de autorización, monto aprobado y monto pagado.
--   A2  Diagnóstico codificado (CIE-10 por defecto, CIE-11 permitido) EN LA
--       RECLAMACIÓN. No se toca el diagnóstico de las consultas (texto libre
--       dentro de specialty_data, distinto por plantilla): codificarlo ahí es
--       el cambio transversal de CIE-11 que CLAUDE.md dejó pendiente.
--   A3  Catálogo de ARS en lugar de texto libre.
--
-- Además cierra un hueco: que la aseguradora de una reclamación pertenezca al
-- MISMO paciente de la consulta solo se validaba en la aplicación; la base de
-- datos solo garantizaba misma clínica. Ahora lo exige un trigger.
--
-- RLS habilitada y forzada en todas las tablas nuevas, en este mismo archivo,
-- como exige CLAUDE.md.

-- =============================================================================
-- 1. Normalización de nombres de aseguradora (para el catálogo y el backfill)
-- =============================================================================
-- Minúsculas, sin acentos, sin puntuación, espacios colapsados y sin el
-- prefijo «ARS»: «ARS Humano», «Humano» y «ars  HUMANO.» coinciden.

create or replace function public.normalize_insurer_name(p_name text)
returns text
language sql
immutable
set search_path = public
as $$
  select btrim(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          translate(lower(coalesce(p_name, '')), 'áéíóúüñ', 'aeiouun'),
          '[^a-z0-9 ]', ' ', 'g'
        ),
        '\s+', ' ', 'g'
      ),
      '^\s*ars\s+', ''
    )
  );
$$;

-- =============================================================================
-- 2. insurers -- catálogo global de ARS (A3)
-- =============================================================================
-- Sin datos de ninguna clínica (como specialty_templates): lo lee cualquier
-- usuario autenticado y solo lo gestiona el operador, por la RPC de abajo.

create table public.insurers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) > 0),
  -- Formas cortas o alternativas con las que el personal suele escribirla.
  aliases text[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index insurers_name_unique_idx on public.insurers (public.normalize_insurer_name(name));

comment on table public.insurers is
  'Catálogo global de ARS / aseguradoras. Lectura: cualquier usuario autenticado. '
  'Escritura: solo el operador (upsert_insurer).';

alter table public.insurers enable row level security;
alter table public.insurers force row level security;

create policy insurers_select_authenticated
  on public.insurers for select to authenticated
  using (true);

grant select on public.insurers to authenticated;
grant select, insert, update, delete on public.insurers to service_role;

-- Coincidencia de un texto libre con el catálogo (nombre o alias). NULL si no hay.
create or replace function public.match_insurer(p_name text)
returns uuid
language sql
stable
set search_path = public
as $$
  select i.id
  from public.insurers i
  where public.normalize_insurer_name(i.name) = public.normalize_insurer_name(p_name)
     or exists (
       select 1 from unnest(i.aliases) a
       where public.normalize_insurer_name(a) = public.normalize_insurer_name(p_name)
     )
  order by (public.normalize_insurer_name(i.name) = public.normalize_insurer_name(p_name)) desc, i.name
  limit 1;
$$;

revoke execute on function public.match_insurer(text) from public, anon;
grant execute on function public.match_insurer(text) to authenticated, service_role;

-- Alta y edición, solo operador.
create or replace function public.upsert_insurer(
  p_name text,
  p_aliases text[],
  p_is_active boolean,
  p_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_aliases text[] := coalesce(
    (select array_agg(distinct btrim(a)) from unnest(coalesce(p_aliases, '{}')) a where btrim(a) <> ''),
    '{}'
  );
begin
  if not public.is_platform_operator() then
    raise exception 'Solo un operador de plataforma puede gestionar el catálogo de ARS.';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'El nombre es requerido.';
  end if;

  begin
    if p_id is null then
      insert into public.insurers (name, aliases, is_active)
      values (btrim(p_name), v_aliases, coalesce(p_is_active, true))
      returning id into v_id;
    else
      update public.insurers
        set name = btrim(p_name), aliases = v_aliases, is_active = coalesce(p_is_active, true), updated_at = now()
        where id = p_id
        returning id into v_id;
      if v_id is null then
        raise exception 'Aseguradora no encontrada.';
      end if;
    end if;
  exception when unique_violation then
    raise exception 'Ya existe una aseguradora con ese nombre.';
  end;

  return v_id;
end;
$$;

revoke execute on function public.upsert_insurer(text, text[], boolean, uuid) from public, anon;
grant execute on function public.upsert_insurer(text, text[], boolean, uuid) to authenticated;

-- Aseguradoras escritas a mano que no están en el catálogo (nombre y cuántas veces), para
-- que el operador las agregue o las ponga como alias. Solo agregados: el operador no lee
-- las filas de pacientes (RLS), y esta función tampoco devuelve ningún dato de paciente.
create or replace function public.operator_unmatched_insurers()
returns table (insurer_name text, uses bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_platform_operator() then
    raise exception 'Solo un operador de plataforma puede ver esto.';
  end if;
  return query
  select pi.insurer_name, count(*)::bigint
  from public.patient_insurers pi
  where pi.insurer_id is null
  group by pi.insurer_name
  order by count(*) desc, pi.insurer_name;
end;
$$;

revoke execute on function public.operator_unmatched_insurers() from public, anon;
grant execute on function public.operator_unmatched_insurers() to authenticated;

-- Lista inicial (borrador a confirmar; el operador puede corregirla desde su panel).
insert into public.insurers (name, aliases) values
  ('SENASA', array['Seguro Nacional de Salud', 'ARS SENASA']),
  ('ARS Humano', array['Humano']),
  ('ARS Universal', array['Universal']),
  ('ARS Palic Salud', array['Palic', 'Palic Salud']),
  ('ARS Reservas', array['Reservas']),
  ('ARS Monumental', array['Monumental']),
  ('ARS Mapfre Salud', array['Mapfre', 'Mapfre Salud']),
  ('ARS Futuro', array['Futuro']),
  ('ARS Simag', array['Simag']),
  ('ARS Yunen', array['Yunen']),
  ('ARS Renacer', array['Renacer']),
  ('ARS CMD', array['CMD']),
  ('ARS Asemap', array['Asemap']),
  ('ARS Meta Salud', array['Meta Salud']),
  ('ARS APS', array['APS'])
on conflict do nothing;

-- =============================================================================
-- 3. patient_insurers.insurer_id (A3)
-- =============================================================================
-- insurer_name se CONSERVA como instantánea: con insurer_id, un trigger la
-- rellena con el nombre del catálogo. «Otra aseguradora» sigue permitida
-- (insurer_id nulo + nombre libre).

alter table public.patient_insurers
  add column insurer_id uuid references public.insurers (id) on delete restrict;

create index patient_insurers_insurer_id_idx on public.patient_insurers (insurer_id);

create or replace function public.sync_patient_insurer_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.insurer_id is not null then
    select i.name into new.insurer_name from public.insurers i where i.id = new.insurer_id;
  end if;
  return new;
end;
$$;

revoke execute on function public.sync_patient_insurer_name() from public, anon, authenticated;

create trigger patient_insurers_sync_insurer_name
  before insert or update of insurer_id on public.patient_insurers
  for each row execute function public.sync_patient_insurer_name();

-- Backfill idempotente: lo que no coincida queda con insurer_id nulo (no se pierde
-- nada). El UPDATE pasa por el guard de solo lectura; es mantenimiento, así que se
-- usa el mecanismo previsto (GUC de transacción) para no fallar en clínicas
-- en solo lectura o bloqueadas.
do $$
begin
  perform set_config('cuido.allow_readonly_write', 'on', true);
  update public.patient_insurers pi
    set insurer_id = public.match_insurer(pi.insurer_name)
    where pi.insurer_id is null and public.match_insurer(pi.insurer_name) is not null;
end;
$$;

-- =============================================================================
-- 4. insurance_claims: comprobante, autorización, aprobado y pagado (A1)
-- =============================================================================

alter table public.insurance_claims
  add column fiscal_document_id uuid references public.fiscal_documents (id),
  add column authorization_number text,
  add column approved_amount numeric(12, 2) check (approved_amount is null or approved_amount >= 0),
  add column paid_amount numeric(12, 2) check (paid_amount is null or paid_amount >= 0),
  add column paid_on date,
  add constraint insurance_claims_paid_pair_check check ((paid_amount is null) = (paid_on is null));

create index insurance_claims_fiscal_document_idx on public.insurance_claims (fiscal_document_id);

comment on column public.insurance_claims.fiscal_document_id is
  'Comprobante fiscal (e-CF) con el que se factura esta reclamación. Debe ser del '
  'mismo paciente y de la misma clínica (enforce_claim_links).';
comment on column public.insurance_claims.paid_amount is
  'Total cobrado de la ARS (un solo valor acumulado; el detalle de pagos parciales '
  'no está modelado todavía) y paid_on, la fecha del cobro.';

-- Integridad entre la reclamación, la consulta, la aseguradora y el comprobante.
-- RLS solo garantiza misma clínica; esto garantiza MISMO PACIENTE, también para
-- service_role y las RPC.
create or replace function public.enforce_claim_links()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_patient uuid;
  v_clinic uuid;
begin
  select e.patient_id, e.clinic_id into v_patient, v_clinic
  from public.encounters e where e.id = new.encounter_id;
  if not found then
    raise exception 'La consulta de la reclamación no existe.';
  end if;

  if not exists (
    select 1 from public.patient_insurers pi
    where pi.id = new.patient_insurer_id and pi.patient_id = v_patient
  ) then
    raise exception 'La aseguradora seleccionada no pertenece al paciente de esta consulta.'
      using errcode = 'P0001', hint = 'claim_insurer_mismatch';
  end if;

  if new.fiscal_document_id is not null and not exists (
    select 1 from public.fiscal_documents d
    where d.id = new.fiscal_document_id and d.clinic_id = v_clinic and d.patient_id = v_patient
  ) then
    raise exception 'El comprobante fiscal no pertenece al paciente de esta consulta.'
      using errcode = 'P0001', hint = 'claim_document_mismatch';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_claim_links() from public, anon, authenticated;

create trigger insurance_claims_enforce_links
  before insert or update of encounter_id, patient_insurer_id, fiscal_document_id on public.insurance_claims
  for each row execute function public.enforce_claim_links();

-- =============================================================================
-- 5. insurance_claim_diagnoses -- diagnósticos codificados de una reclamación (A2)
-- =============================================================================

create table public.insurance_claim_diagnoses (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  claim_id uuid not null references public.insurance_claims (id) on delete cascade,
  code_system text not null default 'CIE-10' check (code_system in ('CIE-10', 'CIE-11')),
  code text not null check (char_length(btrim(code)) > 0),
  description text not null check (char_length(btrim(description)) > 0),
  is_primary boolean not null default false,
  position integer not null default 1 check (position > 0),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  -- Formato de CIE-10 (J00, E11.9, S72.001A). CIE-11 solo se exige no vacío.
  constraint insurance_claim_diagnoses_cie10_format
    check (code_system <> 'CIE-10' or code ~ '^[A-Z][0-9]{2}(\.[0-9A-Z]{1,4})?$'),
  unique (claim_id, code_system, code)
);

-- Un solo diagnóstico principal por reclamación.
create unique index insurance_claim_diagnoses_one_primary_idx
  on public.insurance_claim_diagnoses (claim_id) where is_primary;
create index insurance_claim_diagnoses_clinic_idx on public.insurance_claim_diagnoses (clinic_id);
create index insurance_claim_diagnoses_claim_idx on public.insurance_claim_diagnoses (claim_id);

comment on table public.insurance_claim_diagnoses is
  'Diagnósticos codificados (CIE-10 por defecto, CIE-11 permitido) que sustentan una '
  'reclamación. El diagnóstico clínico original sigue siendo el texto del médico en la '
  'consulta; esto es el código que exige la ARS.';

-- clinic_id se deriva SIEMPRE de la reclamación, nunca del cliente.
create or replace function public.set_clinic_id_from_claim()
returns trigger
language plpgsql
as $$
begin
  select clinic_id into new.clinic_id from public.insurance_claims where id = new.claim_id;
  return new;
end;
$$;

create trigger insurance_claim_diagnoses_set_clinic_id
  before insert on public.insurance_claim_diagnoses
  for each row execute function public.set_clinic_id_from_claim();

alter table public.insurance_claim_diagnoses enable row level security;
alter table public.insurance_claim_diagnoses force row level security;

create policy insurance_claim_diagnoses_select_own_tenant
  on public.insurance_claim_diagnoses for select to authenticated
  using (public.is_member_of_active_clinic(clinic_id));

create policy insurance_claim_diagnoses_insert_by_billing_staff
  on public.insurance_claim_diagnoses for insert to authenticated
  with check (public.is_billing_staff_of_active_clinic(clinic_id));

create policy insurance_claim_diagnoses_update_by_billing_staff
  on public.insurance_claim_diagnoses for update to authenticated
  using (public.is_billing_staff_of_active_clinic(clinic_id))
  with check (public.is_billing_staff_of_active_clinic(clinic_id));

-- Corregir el código de una reclamación pendiente es legítimo: se permite borrar.
create policy insurance_claim_diagnoses_delete_by_billing_staff
  on public.insurance_claim_diagnoses for delete to authenticated
  using (public.is_billing_staff_of_active_clinic(clinic_id));

grant select, insert, update, delete on public.insurance_claim_diagnoses to authenticated, service_role;

-- Guard de solo lectura (el test de cobertura de CI lo exige para toda tabla con clinic_id).
select public.attach_readonly_guard('public.insurance_claim_diagnoses'::regclass);

-- =============================================================================
-- 6. Guard de solo lectura y cobertura de CI para el catálogo
-- =============================================================================
-- insurers: catálogo global sin clinic_id y sin datos de clínica; solo lo escribe
-- el operador por RPC (como specialty_templates y consent_templates).

create or replace function public.readonly_guard_exempt_tables()
returns text[]
language sql
immutable
as $$
  select array[
    'clinic_subscriptions',
    'clinic_subscription_events',
    'clinic_payments',
    'clinic_plan_changes',
    'clinic_status_changes',
    'clinic_internal_notes',
    'clinics',
    'fiscal_document_items',
    'specialty_templates',
    'consent_templates',
    'platform_operators',
    'clinic_deletion_requests',
    'clinic_export_log',
    'archived_fiscal_documents',
    'archived_fiscal_document_items',
    'insurers'
  ]::text[];
$$;

create or replace function public.list_policies_open_when_blocked()
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select p.tablename || '.' || p.policyname
  from pg_policies p
  where p.schemaname = 'public'
    and p.tablename <> all (array[
      'clinics', 'clinic_members', 'clinic_subscriptions', 'clinic_payments',
      'clinic_deletion_requests', 'clinic_export_log',
      'specialty_templates', 'consent_templates', 'insurers'
    ])
    and coalesce(p.qual, '') || coalesce(p.with_check, '') !~ 'of_active_clinic'
    and btrim(coalesce(p.qual, '')) <> 'is_platform_operator()'
  order by 1;
$$;

revoke execute on function public.list_policies_open_when_blocked() from public, anon, authenticated;
grant execute on function public.list_policies_open_when_blocked() to service_role;
