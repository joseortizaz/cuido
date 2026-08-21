-- Fase 2 (parte 2) — esquema y RPCs de e-CF (Comprobante Fiscal Electrónico,
-- DGII, Ley 32-23). TODO excepto firmar y enviar: ese paso queda aislado en
-- src/lib/domain/ecf-signing.ts (signAndSubmitECF), que hoy siempre falla
-- con un mensaje claro -- el certificado digital tributario PSC/INDOTEL
-- sigue en trámite (ver CLAUDE.md).
--
-- Campos y tags XML verificados contra "Formato Comprobante Fiscal
-- Electrónico (e-CF) Versión 1.0" (DGII, octubre 2025) -- no inventados.
-- Esta ronda solo cubre e-CF tipo 32 (Factura de Consumo Electrónica), el
-- que aplica a una clínica cobrando directo al paciente; el esquema
-- soporta otros tipos vía la columna tipo_ecf sin rediseño futuro.
--
-- RLS habilitada y forzada en todas las tablas nuevas, en este mismo
-- archivo, como exige CLAUDE.md.

-- ---------------------------------------------------------------------------
-- Helper de rol: quién puede generar/anular un e-CF -- admin o recepción
-- de una clínica ACTIVA. Facturación es trabajo administrativo, no
-- clínico -- deliberadamente distinto de is_clinician_of_active_clinic
-- (admin/médico), que gatea contenido clínico.
-- ---------------------------------------------------------------------------

create or replace function public.is_billing_staff_of_active_clinic(target_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.clinic_members cm
    join public.clinics c on c.id = cm.clinic_id
    where cm.clinic_id = target_clinic_id
      and cm.user_id = auth.uid()
      and cm.role in ('admin', 'recepcion')
      and c.is_active
  );
$$;

revoke execute on function public.is_billing_staff_of_active_clinic(uuid) from public;
grant execute on function public.is_billing_staff_of_active_clinic(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Tabla: clinic_fiscal_profiles (1:1 con clinics -- datos del Emisor)
-- ---------------------------------------------------------------------------

create table public.clinic_fiscal_profiles (
  clinic_id uuid primary key references public.clinics (id) on delete cascade,
  -- RNC (9 dígitos) o cédula (11 dígitos) del emisor.
  rnc text not null check (rnc ~ '^[0-9]{9}$' or rnc ~ '^[0-9]{11}$'),
  business_name text not null check (char_length(trim(business_name)) > 0),
  commercial_name text,
  fiscal_address text not null check (char_length(trim(fiscal_address)) > 0),
  economic_activity text not null check (char_length(trim(economic_activity)) > 0),
  phone text,
  email text,
  updated_at timestamptz not null default now()
);

comment on table public.clinic_fiscal_profiles is
  'Datos del Emisor para e-CF (RNC, razón social, dirección, actividad '
  'económica). Separado de clinics -- mismo criterio que clinic_subscriptions: '
  'dato de un dominio específico, no todas las clínicas lo configuran el día 1.';

create trigger clinic_fiscal_profiles_set_updated_at
  before update on public.clinic_fiscal_profiles
  for each row
  execute function public.set_updated_at();

alter table public.clinic_fiscal_profiles enable row level security;
alter table public.clinic_fiscal_profiles force row level security;

create policy clinic_fiscal_profiles_select_own_tenant_admin
  on public.clinic_fiscal_profiles for select to authenticated
  using (public.is_clinic_admin(clinic_id));

-- Sin política de INSERT/UPDATE para `authenticated`: todo cambio pasa por
-- upsert_clinic_fiscal_profile (más abajo), mismo criterio que
-- clinic_subscriptions/consents -- nunca un UPDATE directo del cliente.

grant select on public.clinic_fiscal_profiles to authenticated;
grant select, insert, update on public.clinic_fiscal_profiles to service_role;

-- ---------------------------------------------------------------------------
-- Tabla: clinic_ecf_sequences (rango de eNCF autorizado por la DGII)
-- ---------------------------------------------------------------------------

create table public.clinic_ecf_sequences (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  tipo_ecf text not null check (
    tipo_ecf in ('31', '32', '33', '34', '41', '43', '44', '45', '46', '47')
  ),
  range_start bigint not null check (range_start > 0),
  range_end bigint not null check (range_end >= range_start),
  next_number bigint not null check (next_number >= range_start),
  valid_until date not null,
  created_at timestamptz not null default now(),
  -- Una secuencia activa por tipo, por clínica -- Fase 1. La DGII podría
  -- autorizar un rango nuevo antes de agotar el actual; ese caso ("varias
  -- secuencias vigentes por tipo") queda para cuando haga falta.
  unique (clinic_id, tipo_ecf)
);

comment on table public.clinic_ecf_sequences is
  'Rango de e-NCF autorizado por la DGII, capturado a mano por ahora. '
  'next_number SOLO avanza dentro de generate_fiscal_document -- nunca por '
  'UPDATE directo del cliente, para que un e-NCF nunca se repita ni se salte.';

alter table public.clinic_ecf_sequences enable row level security;
alter table public.clinic_ecf_sequences force row level security;

create policy clinic_ecf_sequences_select_own_tenant_admin
  on public.clinic_ecf_sequences for select to authenticated
  using (public.is_clinic_admin(clinic_id));

-- Sin política de INSERT/UPDATE para `authenticated`: se crea/actualiza
-- por service_role (alta manual del rango asignado por la DGII) y
-- next_number avanza únicamente dentro de generate_fiscal_document.

grant select on public.clinic_ecf_sequences to authenticated;
grant select, insert, update on public.clinic_ecf_sequences to service_role;

-- ---------------------------------------------------------------------------
-- Tabla: fiscal_documents (el e-CF)
-- ---------------------------------------------------------------------------

create table public.fiscal_documents (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  patient_id uuid not null references public.patients (id) on delete cascade,
  -- Nullable: se puede facturar sin consulta asociada (ej. venta de un
  -- servicio suelto, no ligado a un encounter).
  encounter_id uuid references public.encounters (id) on delete set null,

  -- CHECK acotado a lo que la UI soporta hoy (32 -- Factura de Consumo).
  -- Ampliar el check es la migración del día que se agregue el 31.
  tipo_ecf text not null default '32' check (tipo_ecf in ('32')),
  -- Null mientras el documento sigue en 'borrador'; lo asigna
  -- generate_fiscal_document desde clinic_ecf_sequences.
  e_ncf text,
  fecha_vencimiento_secuencia date,

  -- Comprador -- todo opcional salvo comprador_nombre; la DGII exige RNC
  -- del comprador solo si el total es >= RD$250,000 (validado en la app,
  -- no aquí -- ver src/lib/domain/ecf.ts).
  comprador_rnc_cedula text,
  comprador_nombre text not null check (char_length(trim(comprador_nombre)) > 0),
  comprador_email text,
  comprador_direccion text,

  -- Totales -- snapshot calculado por generate_fiscal_document a partir de
  -- fiscal_document_items, inmutable después (igual que consents: no se
  -- recalcula solo, se anula y se genera un documento nuevo si algo
  -- estaba mal).
  monto_gravado_total numeric(12, 2) not null default 0,
  monto_exento numeric(12, 2) not null default 0,
  total_itbis numeric(12, 2) not null default 0,
  monto_total numeric(12, 2) not null default 0,

  -- XML completo hasta <FechaHoraFirma> -- lo genera
  -- buildUnsignedECFXml() en TypeScript y lo guarda una Server Action con
  -- un UPDATE acotado a esta sola columna (grant de columna, mismo patrón
  -- que clinics.business_model en la migración de operador).
  xml_sin_firmar text,
  -- NULL hasta que exista firma real -- lo llena signAndSubmitECF cuando
  -- el certificado esté listo. Hoy siempre NULL.
  xml_firmado text,
  -- Respuesta de la DGII al enviar. Hoy siempre NULL.
  dgii_track_id text,

  status text not null default 'borrador' check (
    status in ('borrador', 'generado', 'firmado', 'enviado', 'aceptado', 'rechazado', 'anulado')
  ),
  voided_at timestamptz,
  voided_by uuid references auth.users (id),
  voided_reason text,

  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.fiscal_documents is
  'e-CF de una clínica. El alta y la asignación de e-NCF pasan SIEMPRE por '
  'generate_fiscal_document -- sin esa disciplina un e-NCF podría repetirse '
  'o saltarse, lo cual la DGII no permite.';

create index fiscal_documents_clinic_id_idx on public.fiscal_documents (clinic_id);
create index fiscal_documents_patient_id_idx on public.fiscal_documents (patient_id);
create index fiscal_documents_encounter_id_idx on public.fiscal_documents (encounter_id);

create trigger fiscal_documents_set_updated_at
  before update on public.fiscal_documents
  for each row
  execute function public.set_updated_at();

alter table public.fiscal_documents enable row level security;
alter table public.fiscal_documents force row level security;

-- Lectura: cualquier miembro de una clínica ACTIVA puede consultar el
-- estado de una factura -- útil para todo el equipo, no solo quien la
-- generó.
create policy fiscal_documents_select_own_tenant
  on public.fiscal_documents for select to authenticated
  using (public.is_member_of_active_clinic(clinic_id));

-- Sin política de INSERT ni UPDATE para `authenticated`: el alta pasa por
-- generate_fiscal_document (asigna e_ncf de forma segura), el guardado del
-- XML pasa por un grant de columna (ver más abajo) y el único cambio de
-- estado posible por RPC directo es anular (void_fiscal_document).

grant select on public.fiscal_documents to authenticated;
grant select, insert, update on public.fiscal_documents to service_role;

-- Grant de columna: la Server Action que arma el XML en TypeScript (no se
-- puede/debe hacer en plpgsql) necesita guardarlo, pero SOLO esa columna
-- -- nunca puede tocar e_ncf, totales, ni status por esta vía. Mismo
-- patrón que clinics (name, province) en la migración de operador.
grant update (xml_sin_firmar) on public.fiscal_documents to authenticated;

-- El grant de columna de arriba NO basta por sí solo -- Postgres exige
-- también una política RLS que autorice el UPDATE de la fila; sin esta
-- política, el grant de columna sería letra muerta (mismo patrón
-- combinado que clinics.business_model en la migración de operador).
create policy fiscal_documents_update_xml_by_billing_staff
  on public.fiscal_documents for update to authenticated
  using (public.is_billing_staff_of_active_clinic(clinic_id))
  with check (public.is_billing_staff_of_active_clinic(clinic_id));

-- ---------------------------------------------------------------------------
-- Tabla: fiscal_document_items (líneas -- DetallesItem/<Item> del e-CF)
-- ---------------------------------------------------------------------------

create table public.fiscal_document_items (
  id uuid primary key default gen_random_uuid(),
  fiscal_document_id uuid not null references public.fiscal_documents (id) on delete cascade,
  line_number integer not null check (line_number > 0),
  description text not null check (char_length(trim(description)) > 0),
  quantity numeric(10, 2) not null default 1 check (quantity > 0),
  unit_price numeric(12, 2) not null check (unit_price >= 0),
  -- IndicadorFacturacion: 0 no facturable, 1=ITBIS 18%, 2=ITBIS 16%,
  -- 3=ITBIS 0%, E=exento.
  itbis_indicator text not null default '1' check (itbis_indicator in ('0', '1', '2', '3', 'E')),
  line_total numeric(12, 2) not null check (line_total >= 0),
  unique (fiscal_document_id, line_number)
);

comment on table public.fiscal_document_items is
  'Líneas de un e-CF (DetallesItem/<Item> en el XML). 100% manuales -- no '
  'existe todavía un catálogo de precios/servicios en el núcleo clínico.';

create index fiscal_document_items_fiscal_document_id_idx
  on public.fiscal_document_items (fiscal_document_id);

alter table public.fiscal_document_items enable row level security;
alter table public.fiscal_document_items force row level security;

create policy fiscal_document_items_select_own_tenant
  on public.fiscal_document_items for select to authenticated
  using (
    exists (
      select 1 from public.fiscal_documents fd
      where fd.id = fiscal_document_id
        and public.is_member_of_active_clinic(fd.clinic_id)
    )
  );

-- Sin política de INSERT/UPDATE para `authenticated`: las líneas se crean
-- únicamente dentro de generate_fiscal_document, junto con el documento.

grant select on public.fiscal_document_items to authenticated;
grant select, insert on public.fiscal_document_items to service_role;

-- ---------------------------------------------------------------------------
-- RPC: upsert_clinic_fiscal_profile
-- ---------------------------------------------------------------------------

create or replace function public.upsert_clinic_fiscal_profile(
  target_clinic_id uuid,
  rnc text,
  business_name text,
  commercial_name text,
  fiscal_address text,
  economic_activity text,
  phone text,
  email text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_clinic_admin(target_clinic_id) then
    raise exception 'Solo un admin de la clínica puede configurar los datos fiscales';
  end if;

  insert into public.clinic_fiscal_profiles (
    clinic_id, rnc, business_name, commercial_name, fiscal_address, economic_activity, phone, email
  ) values (
    target_clinic_id, rnc, business_name, commercial_name, fiscal_address, economic_activity, phone, email
  )
  on conflict (clinic_id) do update set
    rnc = excluded.rnc,
    business_name = excluded.business_name,
    commercial_name = excluded.commercial_name,
    fiscal_address = excluded.fiscal_address,
    economic_activity = excluded.economic_activity,
    phone = excluded.phone,
    email = excluded.email,
    updated_at = now();
end;
$$;

revoke execute on function public.upsert_clinic_fiscal_profile(uuid, text, text, text, text, text, text, text) from public;
grant execute on function public.upsert_clinic_fiscal_profile(uuid, text, text, text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: generate_fiscal_document -- único camino de alta de un e-CF
-- ---------------------------------------------------------------------------

create or replace function public.generate_fiscal_document(
  target_patient_id uuid,
  target_encounter_id uuid,
  comprador_rnc_cedula text,
  comprador_nombre text,
  comprador_email text,
  comprador_direccion text,
  items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinic_id uuid;
  v_sequence record;
  v_new_document_id uuid;
  v_e_ncf text;
  v_item jsonb;
  v_line_number integer := 0;
  v_quantity numeric(10, 2);
  v_unit_price numeric(12, 2);
  v_itbis_indicator text;
  v_line_total numeric(12, 2);
  v_monto_gravado numeric(12, 2) := 0;
  v_monto_exento numeric(12, 2) := 0;
  v_total_itbis numeric(12, 2) := 0;
  v_itbis_rate numeric(4, 2);
begin
  select clinic_id into v_clinic_id from public.patients where id = target_patient_id;
  if v_clinic_id is null then
    raise exception 'Paciente no encontrado';
  end if;

  if not public.is_billing_staff_of_active_clinic(v_clinic_id) then
    raise exception 'Solo un admin o recepción de la clínica puede generar un e-CF';
  end if;

  if target_encounter_id is not null then
    if not exists (
      select 1 from public.encounters
      where id = target_encounter_id and patient_id = target_patient_id
    ) then
      raise exception 'La consulta indicada no pertenece a este paciente';
    end if;
  end if;

  if not exists (select 1 from public.clinic_fiscal_profiles where clinic_id = v_clinic_id) then
    raise exception 'Configura los datos fiscales de tu clínica antes de generar un e-CF';
  end if;

  if comprador_nombre is null or char_length(trim(comprador_nombre)) = 0 then
    raise exception 'El nombre del comprador es requerido';
  end if;

  if items is null or jsonb_array_length(items) = 0 then
    raise exception 'El e-CF necesita al menos una línea';
  end if;

  -- Bloquea la fila de secuencia para evitar que dos generaciones
  -- concurrentes tomen el mismo e-NCF.
  select * into v_sequence
  from public.clinic_ecf_sequences
  where clinic_id = v_clinic_id and tipo_ecf = '32'
  for update;

  if v_sequence is null then
    raise exception 'No hay una secuencia de e-NCF configurada para esta clínica';
  end if;
  if v_sequence.next_number > v_sequence.range_end then
    raise exception 'Secuencia de e-NCF agotada -- solicita un rango nuevo a la DGII';
  end if;
  if v_sequence.valid_until < current_date then
    raise exception 'Secuencia de e-NCF vencida -- solicita un rango nuevo a la DGII';
  end if;

  v_e_ncf := 'E32' || lpad(v_sequence.next_number::text, 10, '0');

  update public.clinic_ecf_sequences
  set next_number = next_number + 1
  where id = v_sequence.id;

  insert into public.fiscal_documents (
    clinic_id, patient_id, encounter_id, tipo_ecf, e_ncf, fecha_vencimiento_secuencia,
    comprador_rnc_cedula, comprador_nombre, comprador_email, comprador_direccion,
    status, created_by
  ) values (
    v_clinic_id, target_patient_id, target_encounter_id, '32', v_e_ncf, v_sequence.valid_until,
    comprador_rnc_cedula, comprador_nombre, comprador_email, comprador_direccion,
    'generado', auth.uid()
  )
  returning id into v_new_document_id;

  for v_item in select * from jsonb_array_elements(items)
  loop
    v_line_number := v_line_number + 1;
    v_quantity := (v_item ->> 'quantity')::numeric(10, 2);
    v_unit_price := (v_item ->> 'unit_price')::numeric(12, 2);
    v_itbis_indicator := coalesce(v_item ->> 'itbis_indicator', '1');
    v_line_total := round(v_quantity * v_unit_price, 2);

    insert into public.fiscal_document_items (
      fiscal_document_id, line_number, description, quantity, unit_price, itbis_indicator, line_total
    ) values (
      v_new_document_id, v_line_number, v_item ->> 'description', v_quantity, v_unit_price, v_itbis_indicator, v_line_total
    );

    v_itbis_rate := case v_itbis_indicator
      when '1' then 0.18
      when '2' then 0.16
      when '3' then 0.00
      else null
    end;

    if v_itbis_rate is not null then
      v_monto_gravado := v_monto_gravado + v_line_total;
      v_total_itbis := v_total_itbis + round(v_line_total * v_itbis_rate, 2);
    else
      v_monto_exento := v_monto_exento + v_line_total;
    end if;
  end loop;

  update public.fiscal_documents
  set monto_gravado_total = v_monto_gravado,
      monto_exento = v_monto_exento,
      total_itbis = v_total_itbis,
      monto_total = v_monto_gravado + v_monto_exento + v_total_itbis
  where id = v_new_document_id;

  return v_new_document_id;
end;
$$;

revoke execute on function public.generate_fiscal_document(uuid, uuid, text, text, text, text, jsonb) from public;
grant execute on function public.generate_fiscal_document(uuid, uuid, text, text, text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: void_fiscal_document -- única forma de anular (local, pre-envío)
-- ---------------------------------------------------------------------------

create or replace function public.void_fiscal_document(target_fiscal_document_id uuid, reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinic_id uuid;
  v_status text;
begin
  select clinic_id, status into v_clinic_id, v_status
  from public.fiscal_documents where id = target_fiscal_document_id;

  if v_clinic_id is null then
    raise exception 'Documento fiscal no encontrado';
  end if;

  if not public.is_billing_staff_of_active_clinic(v_clinic_id) then
    raise exception 'Solo un admin o recepción de la clínica puede anular un e-CF';
  end if;

  if reason is null or char_length(trim(reason)) = 0 then
    raise exception 'El motivo de anulación es requerido';
  end if;

  if v_status not in ('borrador', 'generado') then
    raise exception 'Solo se puede anular un e-CF que todavía no fue firmado ni enviado';
  end if;

  update public.fiscal_documents
  set status = 'anulado',
      voided_at = now(),
      voided_by = auth.uid(),
      voided_reason = reason
  where id = target_fiscal_document_id;
end;
$$;

revoke execute on function public.void_fiscal_document(uuid, text) from public;
grant execute on function public.void_fiscal_document(uuid, text) to authenticated;
