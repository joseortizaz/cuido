-- Eliminación de datos de una clínica a solicitud (y por vencimiento de la
-- conservación). Términos de Servicio v3, cláusulas 9.3-9.5.
--
-- Reglas (decididas por José, con consulta legal):
--   * La solicita el ADMIN de la clínica dentro de la app, tras aceptar una
--     advertencia obligatoria (irrecuperable + liberación de Narnia/Cuido).
--   * Se elimina 30 días después de que se cumplan las dos condiciones:
--     solicitud hecha Y información descargada (descarga del libro completo
--     REGISTRADA por el sistema + confirmación del admin de haber verificado
--     el archivo). Los 30 días cuentan desde esa confirmación.
--   * Los e-CF se conservan ARCHIVADOS 5 años, solo lo fiscal y SIN vínculo con
--     paciente, consulta ni expediente. Todo lo demás se elimina.
--   * Inactividad por falta de pago: la conservación de 2 años ya se calcula
--     (retention_until, migración 20261009100000); al vencer, la eliminación es
--     una acción EXPLÍCITA del operador. Nada se elimina solo, nunca.
--   * La ejecución es SOLO del operador, con el nombre de la clínica tipeado.
--
-- Todas las tablas nuevas llevan RLS + FORCE RLS en esta misma migración y no
-- admiten escritura directa: solo las RPC de abajo.

-- =============================================================================
-- 1. Plazos en un solo lugar
-- =============================================================================

create or replace function public.data_deletion_offsets()
returns table (wait_days integer, fiscal_archive_years integer)
language sql
immutable
set search_path = public
as $$
  select 30, 5;
$$;

comment on function public.data_deletion_offsets() is
  'Días de espera entre la confirmación de la descarga y la eliminación, y '
  'años que se archivan los e-CF tras eliminar una clínica.';

-- =============================================================================
-- 2. clinic_deletion_requests -- solicitud + constancia permanente
-- =============================================================================
-- Sobrevive a la clínica: clinic_id pasa a NULL al borrarla, y la fila queda
-- como constancia (nombre, quién pidió, texto aceptado, qué se eliminó).
-- No guarda datos de pacientes.

create table public.clinic_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid references public.clinics (id) on delete set null,
  clinic_name text not null,
  requested_by_email text not null check (char_length(btrim(requested_by_email)) > 0),
  channel text not null check (channel in ('app', 'correo', 'conservacion_vencida')),
  -- Texto EXACTO que se mostró y se aceptó, y su huella.
  warning_text text not null check (char_length(btrim(warning_text)) > 0),
  warning_hash text not null,
  note text,
  requested_at timestamptz not null default now(),
  export_confirmed_at timestamptz,
  scheduled_for date,
  status text not null default 'solicitada' check (status in ('solicitada', 'desistida', 'ejecutada')),
  withdrawn_at timestamptz,
  executed_at timestamptz,
  executed_by_email text,
  deletion_summary jsonb check (deletion_summary is null or jsonb_typeof(deletion_summary) = 'object'),
  created_at timestamptz not null default now()
);

-- Una sola solicitud abierta por clínica.
create unique index clinic_deletion_requests_one_open_idx
  on public.clinic_deletion_requests (clinic_id) where status = 'solicitada';
create index clinic_deletion_requests_clinic_idx on public.clinic_deletion_requests (clinic_id);

comment on table public.clinic_deletion_requests is
  'Solicitud de eliminación de los datos de una clínica y, tras ejecutarse, '
  'su constancia (clinic_id queda NULL). Sin escritura directa: solo RPC.';

alter table public.clinic_deletion_requests enable row level security;
alter table public.clinic_deletion_requests force row level security;

-- El admin ve su propia solicitud aunque la clínica esté bloqueada (para saber
-- en qué va); el operador ve todas.
create policy clinic_deletion_requests_select
  on public.clinic_deletion_requests for select to authenticated
  using ((clinic_id is not null and public.is_clinic_admin(clinic_id)) or public.is_platform_operator());

grant select on public.clinic_deletion_requests to authenticated;
grant select, insert, update, delete on public.clinic_deletion_requests to service_role;

-- =============================================================================
-- 3. clinic_export_log -- cada descarga del libro completo
-- =============================================================================

create table public.clinic_export_log (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('all')),
  created_at timestamptz not null default now()
);

create index clinic_export_log_clinic_idx on public.clinic_export_log (clinic_id, created_at desc);

comment on table public.clinic_export_log is
  'Descargas del libro completo de la clínica. Prueba, para la eliminación a '
  'solicitud, de que la información fue descargada. Sin escritura directa.';

alter table public.clinic_export_log enable row level security;
alter table public.clinic_export_log force row level security;

create policy clinic_export_log_select
  on public.clinic_export_log for select to authenticated
  using (public.is_clinic_admin(clinic_id) or public.is_platform_operator());

grant select on public.clinic_export_log to authenticated;
grant select, insert, update, delete on public.clinic_export_log to service_role;

-- =============================================================================
-- 4. Archivo fiscal (e-CF) -- sin clínica, sin paciente
-- =============================================================================
-- Solo lo fiscal. NO se copian patient_id, encounter_id, email ni dirección del
-- comprador: se corta el vínculo con el expediente. Lectura solo del operador
-- (no hay política para las clínicas: la clínica ya no existe).

create table public.archived_fiscal_documents (
  id uuid primary key, -- el mismo id del comprobante original
  deletion_request_id uuid not null references public.clinic_deletion_requests (id),
  source_clinic_id uuid not null, -- sin FK: la clínica ya no existe
  clinic_name text not null,
  emisor_rnc text,
  e_ncf text,
  tipo_ecf text not null,
  issued_at timestamptz not null,
  fecha_vencimiento_secuencia date,
  status text not null,
  monto_gravado_total numeric(12, 2) not null,
  monto_exento numeric(12, 2) not null,
  total_itbis numeric(12, 2) not null,
  monto_total numeric(12, 2) not null,
  dgii_track_id text,
  comprador_nombre text not null,
  comprador_rnc_cedula text,
  voided_at timestamptz,
  voided_reason text,
  xml text,
  xml_is_signed boolean not null default false,
  retain_until date not null,
  archived_at timestamptz not null default now()
);

create index archived_fiscal_documents_source_idx on public.archived_fiscal_documents (source_clinic_id);
create index archived_fiscal_documents_retain_idx on public.archived_fiscal_documents (retain_until);

create table public.archived_fiscal_document_items (
  id uuid primary key,
  fiscal_document_id uuid not null references public.archived_fiscal_documents (id) on delete cascade,
  line_number integer not null,
  description text not null,
  quantity numeric(10, 2) not null,
  unit_price numeric(12, 2) not null,
  itbis_indicator text not null,
  line_total numeric(12, 2) not null
);

create index archived_fiscal_document_items_doc_idx on public.archived_fiscal_document_items (fiscal_document_id);

comment on table public.archived_fiscal_documents is
  'e-CF conservados tras eliminar una clínica (años: data_deletion_offsets()). '
  'Solo datos fiscales; sin vínculo con paciente, consulta ni expediente.';

alter table public.archived_fiscal_documents enable row level security;
alter table public.archived_fiscal_documents force row level security;
alter table public.archived_fiscal_document_items enable row level security;
alter table public.archived_fiscal_document_items force row level security;

create policy archived_fiscal_documents_select_by_operator
  on public.archived_fiscal_documents for select to authenticated
  using (public.is_platform_operator());
create policy archived_fiscal_document_items_select_by_operator
  on public.archived_fiscal_document_items for select to authenticated
  using (public.is_platform_operator());

grant select on public.archived_fiscal_documents, public.archived_fiscal_document_items to authenticated;
grant select, insert, update, delete
  on public.archived_fiscal_documents, public.archived_fiscal_document_items to service_role;

-- =============================================================================
-- 5. Guard de solo lectura y cobertura de CI
-- =============================================================================
-- Exentas, cada una con su razón:
--   clinic_deletion_requests, clinic_export_log  la exportación y la solicitud
--       deben funcionar en solo lectura (ahí es donde la clínica se lleva sus
--       datos); solo las escriben RPC definer que se autogatean.
--   archived_fiscal_documents(+_items)  sin clinic_id: archivo posterior a la
--       clínica; solo lo escribe execute_clinic_data_deletion.

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
    'archived_fiscal_document_items'
  ]::text[];
$$;

-- list_policies_open_when_blocked: las dos tablas nuevas de la clínica son
-- legibles por su admin aun bloqueada (como la suscripción y los pagos): para
-- saber en qué va su solicitud y poder descargar bajo un acuerdo.
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
      'specialty_templates', 'consent_templates'
    ])
    and coalesce(p.qual, '') || coalesce(p.with_check, '') !~ 'of_active_clinic'
    and btrim(coalesce(p.qual, '')) <> 'is_platform_operator()'
  order by 1;
$$;

revoke execute on function public.list_policies_open_when_blocked() from public, anon, authenticated;
grant execute on function public.list_policies_open_when_blocked() to service_role;

-- =============================================================================
-- 6. RPC
-- =============================================================================

-- Correo del usuario autenticado (auth.users no está expuesto por la Data API).
create or replace function public.current_user_email()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select u.email::text from auth.users u where u.id = auth.uid();
$$;

revoke execute on function public.current_user_email() from public, anon, authenticated;

-- Clínica de la que el usuario autenticado es admin (misma convención que
-- get_my_clinic_access: la primera membresía).
create or replace function public.my_admin_clinic_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select cm.clinic_id
  from public.clinic_members cm
  where cm.user_id = auth.uid() and cm.role = 'admin'
  limit 1;
$$;

revoke execute on function public.my_admin_clinic_id() from public, anon, authenticated;

-- ---- registrar una descarga del libro completo ------------------------------
create or replace function public.log_clinic_export(p_kind text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinic uuid := public.my_admin_clinic_id();
begin
  if v_clinic is null then
    raise exception 'Solo el administrador de la clínica puede exportar.';
  end if;
  if p_kind is distinct from 'all' then
    raise exception 'Tipo de exportación no válido.';
  end if;
  insert into public.clinic_export_log (clinic_id, user_id, kind)
  values (v_clinic, auth.uid(), p_kind);
end;
$$;

revoke execute on function public.log_clinic_export(text) from public, anon;
grant execute on function public.log_clinic_export(text) to authenticated;

-- ---- solicitar la eliminación (admin, dentro de la app) ---------------------
create or replace function public.request_clinic_data_deletion(
  p_warning_text text,
  p_accepted boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinic uuid := public.my_admin_clinic_id();
  v_name text;
  v_id uuid;
begin
  if v_clinic is null then
    raise exception 'Solo el administrador de la clínica puede solicitar la eliminación de sus datos.';
  end if;
  if p_accepted is distinct from true then
    raise exception 'Debes aceptar la advertencia para solicitar la eliminación.';
  end if;
  if p_warning_text is null or btrim(p_warning_text) = '' then
    raise exception 'Falta el texto de la advertencia aceptada.';
  end if;
  if not public.clinic_is_accessible(v_clinic) then
    raise exception 'Tu clínica está bloqueada: solicita la eliminación por correo a info@narniats.com.';
  end if;

  select c.name into v_name from public.clinics c where c.id = v_clinic;

  begin
    insert into public.clinic_deletion_requests
      (clinic_id, clinic_name, requested_by_email, channel, warning_text, warning_hash)
    values
      (v_clinic, v_name, public.current_user_email(), 'app', p_warning_text,
       encode(sha256(convert_to(p_warning_text, 'UTF8')), 'hex'))
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Ya hay una solicitud de eliminación en curso para tu clínica.';
  end;

  return v_id;
end;
$$;

revoke execute on function public.request_clinic_data_deletion(text, boolean) from public, anon;
grant execute on function public.request_clinic_data_deletion(text, boolean) to authenticated;

-- ---- confirmar que descargó y verificó la información -----------------------
-- Exige un registro de descarga completa POSTERIOR a la solicitud. Desde aquí
-- corren los días de espera.
create or replace function public.confirm_deletion_export(p_request_id uuid)
returns date
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.clinic_deletion_requests%rowtype;
  o record;
  v_when date;
begin
  select * into r from public.clinic_deletion_requests where id = p_request_id for update;
  if not found or r.clinic_id is null or not public.is_clinic_admin(r.clinic_id) then
    raise exception 'Solicitud no encontrada.';
  end if;
  if r.status <> 'solicitada' then
    raise exception 'Esta solicitud ya no está abierta.';
  end if;
  if r.export_confirmed_at is not null then
    raise exception 'La descarga ya fue confirmada.';
  end if;
  if not exists (
    select 1 from public.clinic_export_log l
    where l.clinic_id = r.clinic_id and l.kind = 'all' and l.created_at > r.requested_at
  ) then
    raise exception 'Primero descarga el libro completo de la clínica (después de haber hecho la solicitud).';
  end if;

  select * into o from public.data_deletion_offsets();
  v_when := public.dr_today() + o.wait_days;

  update public.clinic_deletion_requests
    set export_confirmed_at = now(), scheduled_for = v_when
    where id = p_request_id;

  return v_when;
end;
$$;

revoke execute on function public.confirm_deletion_export(uuid) from public, anon;
grant execute on function public.confirm_deletion_export(uuid) to authenticated;

-- ---- desistir (admin u operador) -------------------------------------------
create or replace function public.withdraw_clinic_data_deletion(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.clinic_deletion_requests%rowtype;
begin
  select * into r from public.clinic_deletion_requests where id = p_request_id for update;
  if not found
     or not (public.is_platform_operator() or (r.clinic_id is not null and public.is_clinic_admin(r.clinic_id))) then
    raise exception 'Solicitud no encontrada.';
  end if;
  if r.status <> 'solicitada' then
    raise exception 'Esta solicitud ya no está abierta.';
  end if;

  update public.clinic_deletion_requests
    set status = 'desistida', withdrawn_at = now()
    where id = p_request_id;
end;
$$;

revoke execute on function public.withdraw_clinic_data_deletion(uuid) from public, anon;
grant execute on function public.withdraw_clinic_data_deletion(uuid) to authenticated;

-- ---- el operador registra una solicitud recibida por correo ------------------
-- Para clínicas bloqueadas, que no pueden abrir la app. El operador verificó la
-- identidad y envió la advertencia por escrito (warning_text). La descarga se
-- habilita con un acuerdo de bloqueo; el admin la confirma después en la app.
create or replace function public.operator_register_deletion_request(
  target_clinic_id uuid,
  p_requester_email text,
  p_warning_text text,
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_id uuid;
begin
  if not public.is_platform_operator() then
    raise exception 'Solo un operador de plataforma puede registrar una solicitud de eliminación.';
  end if;
  if p_requester_email is null or btrim(p_requester_email) = '' then
    raise exception 'El correo de quien solicita es requerido.';
  end if;
  if p_warning_text is null or btrim(p_warning_text) = '' then
    raise exception 'El texto de la advertencia enviada es requerido.';
  end if;

  select c.name into v_name from public.clinics c where c.id = target_clinic_id;
  if v_name is null then
    raise exception 'Clínica no encontrada.';
  end if;

  begin
    insert into public.clinic_deletion_requests
      (clinic_id, clinic_name, requested_by_email, channel, warning_text, warning_hash, note)
    values
      (target_clinic_id, v_name, btrim(p_requester_email), 'correo', p_warning_text,
       encode(sha256(convert_to(p_warning_text, 'UTF8')), 'hex'), p_note)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Ya hay una solicitud de eliminación en curso para esta clínica.';
  end;

  return v_id;
end;
$$;

revoke execute on function public.operator_register_deletion_request(uuid, text, text, text) from public, anon;
grant execute on function public.operator_register_deletion_request(uuid, text, text, text) to authenticated;

-- ---- vencimiento de la conservación (2 años) --------------------------------
-- Solo si la clínica está bloqueada (suscripción cancelada) y ya pasó
-- retention_until. Crea la solicitud lista para ejecutar; la ejecución sigue
-- siendo una acción aparte del operador.
create or replace function public.operator_start_expired_retention_deletion(target_clinic_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_retention date;
  v_text constant text :=
    'Eliminación por vencimiento del periodo de conservación de 2 años posterior a la cancelación '
    'de la suscripción por falta de pago (Términos de Servicio, cláusula 9.3).';
  v_id uuid;
begin
  if not public.is_platform_operator() then
    raise exception 'Solo un operador de plataforma puede iniciar esta eliminación.';
  end if;

  select c.name into v_name from public.clinics c where c.id = target_clinic_id;
  if v_name is null then
    raise exception 'Clínica no encontrada.';
  end if;
  if public.clinic_access_state(target_clinic_id) <> 'bloqueada' then
    raise exception 'La clínica no está bloqueada (suscripción cancelada).';
  end if;

  select d.retention_until into v_retention from public.clinic_lifecycle_dates(target_clinic_id) d;
  if v_retention is null or v_retention > public.dr_today() then
    raise exception 'El periodo de conservación no ha vencido (vence el %).', coalesce(v_retention::text, 'sin fecha');
  end if;

  begin
    insert into public.clinic_deletion_requests
      (clinic_id, clinic_name, requested_by_email, channel, warning_text, warning_hash, scheduled_for)
    values
      (target_clinic_id, v_name, public.current_user_email(), 'conservacion_vencida', v_text,
       encode(sha256(convert_to(v_text, 'UTF8')), 'hex'), public.dr_today())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Ya hay una solicitud de eliminación en curso para esta clínica.';
  end;

  return v_id;
end;
$$;

revoke execute on function public.operator_start_expired_retention_deletion(uuid) from public, anon;
grant execute on function public.operator_start_expired_retention_deletion(uuid) to authenticated;

-- ---- EJECUTAR la eliminación (solo operador, irreversible) --------------------
-- Una sola transacción: archiva los e-CF, borra los mensajes de WhatsApp (su FK
-- es SET NULL: quedarían huérfanos con teléfonos y contenido), anota la
-- constancia y borra la clínica (todo lo demás cae por ON DELETE CASCADE).
-- Devuelve los ids de usuario de miembros que no pertenecen a ninguna otra
-- clínica ni son operadores: la acción del servidor los elimina de auth.users.
create or replace function public.execute_clinic_data_deletion(
  p_request_id uuid,
  p_confirm_name text
)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.clinic_deletion_requests%rowtype;
  o record;
  v_clinic uuid;
  v_name text;
  v_rnc text;
  v_retain date;
  v_orphans uuid[];
  v_counts jsonb;
  v_payments jsonb;
  v_retention date;
begin
  if not public.is_platform_operator() then
    raise exception 'Solo un operador de plataforma puede ejecutar una eliminación.';
  end if;

  select * into r from public.clinic_deletion_requests where id = p_request_id for update;
  if not found then
    raise exception 'Solicitud no encontrada.';
  end if;
  if r.status <> 'solicitada' or r.clinic_id is null then
    raise exception 'Esta solicitud ya no está abierta.';
  end if;
  v_clinic := r.clinic_id;

  select c.name into v_name from public.clinics c where c.id = v_clinic;
  if v_name is null then
    raise exception 'Clínica no encontrada.';
  end if;
  if p_confirm_name is null or btrim(p_confirm_name) <> v_name then
    raise exception 'El nombre escrito no coincide con el de la clínica.';
  end if;

  if r.channel = 'conservacion_vencida' then
    select d.retention_until into v_retention from public.clinic_lifecycle_dates(v_clinic) d;
    if public.clinic_access_state(v_clinic) <> 'bloqueada' or v_retention is null or v_retention > public.dr_today() then
      raise exception 'El periodo de conservación no ha vencido o la clínica ya no está bloqueada.';
    end if;
  else
    if r.export_confirmed_at is null or r.scheduled_for is null then
      raise exception 'La clínica todavía no confirmó la descarga de su información.';
    end if;
    if r.scheduled_for > public.dr_today() then
      raise exception 'Todavía no se cumple la espera: la eliminación procede a partir del %.', r.scheduled_for;
    end if;
  end if;

  -- A partir de aquí se escribe en una clínica que puede estar en solo lectura o
  -- bloqueada: mecanismo de mantenimiento (GUC de transacción) del readonly_guard.
  perform set_config('cuido.allow_readonly_write', 'on', true);

  select * into o from public.data_deletion_offsets();
  v_retain := (public.dr_today() + make_interval(years => o.fiscal_archive_years))::date;
  select p.rnc into v_rnc from public.clinic_fiscal_profiles p where p.clinic_id = v_clinic;

  select coalesce(array_agg(cm.user_id), '{}') into v_orphans
  from public.clinic_members cm
  where cm.clinic_id = v_clinic
    and not exists (select 1 from public.clinic_members x where x.user_id = cm.user_id and x.clinic_id <> v_clinic)
    and not exists (select 1 from public.platform_operators po where po.user_id = cm.user_id);

  -- Archivo fiscal: solo lo fiscal, sin patient_id ni encounter_id.
  insert into public.archived_fiscal_documents
    (id, deletion_request_id, source_clinic_id, clinic_name, emisor_rnc, e_ncf, tipo_ecf, issued_at,
     fecha_vencimiento_secuencia, status, monto_gravado_total, monto_exento, total_itbis, monto_total,
     dgii_track_id, comprador_nombre, comprador_rnc_cedula, voided_at, voided_reason,
     xml, xml_is_signed, retain_until)
  select
    d.id, r.id, v_clinic, v_name, v_rnc, d.e_ncf, d.tipo_ecf, d.created_at,
    d.fecha_vencimiento_secuencia, d.status, d.monto_gravado_total, d.monto_exento, d.total_itbis, d.monto_total,
    d.dgii_track_id, d.comprador_nombre, d.comprador_rnc_cedula, d.voided_at, d.voided_reason,
    coalesce(d.xml_firmado, d.xml_sin_firmar), d.xml_firmado is not null, v_retain
  from public.fiscal_documents d
  where d.clinic_id = v_clinic;

  insert into public.archived_fiscal_document_items
    (id, fiscal_document_id, line_number, description, quantity, unit_price, itbis_indicator, line_total)
  select i.id, i.fiscal_document_id, i.line_number, i.description, i.quantity, i.unit_price,
         i.itbis_indicator, i.line_total
  from public.fiscal_document_items i
  join public.fiscal_documents d on d.id = i.fiscal_document_id
  where d.clinic_id = v_clinic;

  -- Constancia: cuántas filas se eliminan (sin contenido) y los pagos (registros
  -- contables de Narnia, que no deben perderse con la clínica).
  v_counts := jsonb_build_object(
    'patients', (select count(*) from public.patients where clinic_id = v_clinic),
    'encounters', (select count(*) from public.encounters where clinic_id = v_clinic),
    'appointments', (select count(*) from public.appointments where clinic_id = v_clinic),
    'consents', (select count(*) from public.consents where clinic_id = v_clinic),
    'insurance_claims', (select count(*) from public.insurance_claims where clinic_id = v_clinic),
    'whatsapp_messages', (select count(*) from public.whatsapp_messages where clinic_id = v_clinic),
    'members', (select count(*) from public.clinic_members where clinic_id = v_clinic),
    'fiscal_documents_archived', (select count(*) from public.fiscal_documents where clinic_id = v_clinic)
  );
  select coalesce(
           jsonb_agg(jsonb_build_object(
             'paid_on', pm.paid_on, 'amount', pm.amount,
             'period_days', pm.period_days, 'resulting_due_on', pm.resulting_due_on
           ) order by pm.paid_on),
           '[]'::jsonb)
    into v_payments
  from public.clinic_payments pm where pm.clinic_id = v_clinic;

  delete from public.whatsapp_messages where clinic_id = v_clinic;

  update public.clinic_deletion_requests
    set status = 'ejecutada',
        executed_at = now(),
        executed_by_email = public.current_user_email(),
        deletion_summary = jsonb_build_object(
          'deleted_rows', v_counts,
          'payments', v_payments,
          'fiscal_archive_until', v_retain
        )
    where id = p_request_id;

  delete from public.clinics where id = v_clinic;

  return v_orphans;
end;
$$;

revoke execute on function public.execute_clinic_data_deletion(uuid, text) from public, anon;
grant execute on function public.execute_clinic_data_deletion(uuid, text) to authenticated;
