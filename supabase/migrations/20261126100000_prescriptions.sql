-- Recetas digitales con impresión en A6 (PR 7 del plan de expediente clínico).
--
-- El médico emite una receta desde una consulta o desde el expediente; se IMPRIME en A6 (105 × 148 mm)
-- con el timbrado de la clínica (o del médico) arriba y, al pie, su nombre, especialidad y exequátur, con
-- espacio en blanco para la firma y el sello físicos. El sistema NO firma digitalmente: la receta es un
-- documento impreso que el médico firma y sella.
--
--   * clinic_members.professional_name / professional_title / exequatur -- datos del médico que salen en la
--     receta (no se emite sin nombre y exequátur).
--   * clinic_letterhead            -- timbrado de la clínica: nombre, dirección, teléfonos, correo, RNC y logo.
--   * prescriptions / prescription_items -- la receta y sus medicamentos. Una receta EMITIDA no se edita: se
--     ANULA con motivo y se emite otra. Guarda una copia (snapshot) del médico, del timbrado y del paciente al
--     momento de emitirla, para que reimprimirla años después salga idéntica aunque cambien los datos.
--   * prescription_prints          -- cada impresión; las reimpresiones salen marcadas «COPIA».
--   * clinic_prescription_counters -- número consecutivo por clínica (nunca se reutiliza).
--   * bucket privado «clinic-letterhead» (logo del timbrado) -- Storage, ver abajo.
--
-- ============================ STORAGE ============================
--   Bucket:   clinic-letterhead, PRIVADO, 2 MB, solo image/png e image/jpeg.
--   Ruta:     {clinic_id}/{uuid}-{nombre_saneado} (2 niveles; la genera el servidor).
--   Políticas sobre storage.objects (solo este bucket):
--       SELECT : letterhead_file_access(name, false) -- admin o médico de la clínica activa dueña de la ruta.
--       INSERT : letterhead_file_access(name, true)  -- solo el ADMIN de esa clínica, con la clínica no en solo lectura.
--       UPDATE / DELETE: ninguna política (el servidor retira el logo anterior al cambiarlo).
--   El logo se muestra con una URL firmada de corta duración generada en el servidor: nunca una URL pública.
--
-- Políticas RLS (descritas en la PR):
--   prescriptions, prescription_items, prescription_prints, clinic_letterhead: SELECT solo admin y médicos de la
--       clínica activa (y, si la receta cuelga de una consulta, solo si esa consulta les es visible: Salud
--       Mental con acceso reforzado). Sin INSERT/UPDATE/DELETE directos: todo por issue_prescription,
--       void_prescription, log_prescription_print y save_clinic_letterhead (security definer, search_path = '').
--       ENABLE + FORCE RLS, guard de solo lectura, inmutables por trigger. Recepción no tiene acceso.
--   clinic_members: sin cambio de políticas; el médico completa SUS datos profesionales con
--       update_my_professional_profile (solo su propia fila).

-- =============================================================================
-- 1. Datos profesionales del médico
-- =============================================================================

alter table public.clinic_members
  add column professional_name text check (professional_name is null or char_length(btrim(professional_name)) between 1 and 120),
  add column professional_title text check (professional_title is null or char_length(professional_title) <= 120),
  add column exequatur text check (exequatur is null or char_length(btrim(exequatur)) between 1 and 30);

comment on column public.clinic_members.professional_name is 'Nombre del médico tal como sale impreso en sus recetas.';
comment on column public.clinic_members.professional_title is 'Especialidad que figura en la receta (texto libre), p. ej. «Medicina Interna y Nutrición Clínica».';
comment on column public.clinic_members.exequatur is 'Exequátur del médico; sin él no se emiten recetas.';

create or replace function public.update_my_professional_profile(
  p_clinic_id uuid,
  p_name text,
  p_title text,
  p_exequatur text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_clinician_of_active_clinic(p_clinic_id) then
    raise exception 'Solo los médicos y el administrador tienen datos profesionales.' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 3 and 120 then
    raise exception 'El nombre debe tener entre 3 y 120 caracteres.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_exequatur, ''))) not between 3 and 30 then
    raise exception 'El exequátur debe tener entre 3 y 30 caracteres.' using errcode = '22023';
  end if;
  if char_length(coalesce(p_title, '')) > 120 then
    raise exception 'La especialidad es demasiado larga (máximo 120 caracteres).' using errcode = '22023';
  end if;

  update public.clinic_members
    set professional_name = btrim(p_name),
        professional_title = nullif(btrim(coalesce(p_title, '')), ''),
        exequatur = btrim(p_exequatur)
    where clinic_id = p_clinic_id and user_id = auth.uid();
end;
$$;

revoke execute on function public.update_my_professional_profile(uuid, text, text, text) from public, anon;
grant execute on function public.update_my_professional_profile(uuid, text, text, text) to authenticated, service_role;

-- =============================================================================
-- 2. Timbrado de la clínica
-- =============================================================================

create table public.clinic_letterhead (
  clinic_id uuid primary key references public.clinics (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 150),
  address text check (address is null or char_length(address) <= 300),
  phones text check (phones is null or char_length(phones) <= 100),
  email text check (email is null or char_length(email) <= 150),
  rnc text check (rnc is null or char_length(rnc) <= 20),
  -- Ruta del logo en el bucket clinic-letterhead (null = sin logo).
  logo_path text,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

comment on table public.clinic_letterhead is
  'Timbrado de la clínica (o del médico, si la clínica es de un médico independiente) que se imprime en las recetas.';

-- =============================================================================
-- 3. Recetas
-- =============================================================================

create table public.clinic_prescription_counters (
  clinic_id uuid primary key references public.clinics (id) on delete cascade,
  last_value integer not null default 0 check (last_value >= 0)
);

create table public.prescriptions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  patient_id uuid not null references public.patients (id) on delete cascade,
  encounter_id uuid references public.encounters (id) on delete set null,
  provider_id uuid references auth.users (id) on delete set null,
  number integer not null check (number >= 1),
  issued_at timestamptz not null default now(),
  status text not null default 'emitida' check (status in ('emitida', 'anulada')),
  notes text check (notes is null or char_length(notes) <= 2000),
  -- Copia de lo que salía impreso al emitirla (no cambia aunque después cambien el perfil, el timbrado o el paciente).
  provider_name text not null,
  provider_title text,
  provider_exequatur text not null,
  letterhead jsonb not null,
  patient_snapshot jsonb not null,
  voided_at timestamptz,
  voided_by uuid references auth.users (id) on delete set null,
  void_reason text,
  unique (clinic_id, number),
  check ((status = 'anulada') = (void_reason is not null))
);

comment on table public.prescriptions is
  'Receta emitida. No se edita: se anula con motivo y se emite otra. Se escribe solo con issue_prescription / void_prescription.';

create index prescriptions_patient_idx on public.prescriptions (patient_id, issued_at desc);
create index prescriptions_clinic_idx on public.prescriptions (clinic_id);

create table public.prescription_items (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  prescription_id uuid not null references public.prescriptions (id) on delete cascade,
  position integer not null check (position >= 1),
  medication text not null check (char_length(btrim(medication)) between 1 and 200),
  dose text check (dose is null or char_length(dose) <= 200),
  route text check (route is null or char_length(route) <= 200),
  frequency text check (frequency is null or char_length(frequency) <= 200),
  duration text check (duration is null or char_length(duration) <= 200),
  quantity text check (quantity is null or char_length(quantity) <= 200),
  instructions text check (instructions is null or char_length(instructions) <= 500),
  unique (prescription_id, position)
);

create index prescription_items_rx_idx on public.prescription_items (prescription_id);
create index prescription_items_clinic_idx on public.prescription_items (clinic_id);

create table public.prescription_prints (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  patient_id uuid not null references public.patients (id) on delete cascade,
  prescription_id uuid not null references public.prescriptions (id) on delete cascade,
  printed_by uuid references auth.users (id) on delete set null,
  printed_at timestamptz not null default now(),
  is_copy boolean not null,
  format text not null check (format in ('a6', 'a4'))
);

create index prescription_prints_rx_idx on public.prescription_prints (prescription_id, printed_at);
create index prescription_prints_clinic_idx on public.prescription_prints (clinic_id);

-- =============================================================================
-- 4. RLS
-- =============================================================================

alter table public.clinic_letterhead enable row level security;
alter table public.clinic_letterhead force row level security;
alter table public.clinic_prescription_counters enable row level security;
alter table public.clinic_prescription_counters force row level security;
alter table public.prescriptions enable row level security;
alter table public.prescriptions force row level security;
alter table public.prescription_items enable row level security;
alter table public.prescription_items force row level security;
alter table public.prescription_prints enable row level security;
alter table public.prescription_prints force row level security;

create policy clinic_letterhead_select
  on public.clinic_letterhead for select to authenticated
  using (public.is_clinician_of_active_clinic(clinic_id));

-- Si la receta cuelga de una consulta, solo se ve cuando esa consulta es visible para el usuario.
create policy prescriptions_select
  on public.prescriptions for select to authenticated
  using (
    public.is_clinician_of_active_clinic(clinic_id)
    and (encounter_id is null or exists (select 1 from public.encounters e where e.id = prescriptions.encounter_id))
  );

create policy prescription_items_select
  on public.prescription_items for select to authenticated
  using (
    public.is_clinician_of_active_clinic(clinic_id)
    and exists (select 1 from public.prescriptions p where p.id = prescription_items.prescription_id)
  );

create policy prescription_prints_select
  on public.prescription_prints for select to authenticated
  using (
    public.is_clinician_of_active_clinic(clinic_id)
    and exists (select 1 from public.prescriptions p where p.id = prescription_prints.prescription_id)
  );

-- clinic_prescription_counters: sin políticas para authenticated (solo las funciones).
revoke all on public.clinic_letterhead, public.clinic_prescription_counters, public.prescriptions,
  public.prescription_items, public.prescription_prints from anon, authenticated;
grant select on public.clinic_letterhead, public.prescriptions, public.prescription_items, public.prescription_prints to authenticated;
grant select on public.clinic_letterhead, public.prescriptions, public.prescription_items, public.prescription_prints to service_role;
grant select on public.clinic_prescription_counters to service_role;

select public.attach_readonly_guard('public.clinic_letterhead'::regclass);
select public.attach_readonly_guard('public.clinic_prescription_counters'::regclass);
select public.attach_readonly_guard('public.prescriptions'::regclass);
select public.attach_readonly_guard('public.prescription_items'::regclass);
select public.attach_readonly_guard('public.prescription_prints'::regclass);

create trigger prescriptions_block_voided before insert on public.prescriptions
  for each row execute function public.block_writes_for_voided_patient();

-- Inmutables: una receta solo cambia de estado por void_prescription; los renglones y las impresiones, nunca; el
-- borrado solo ocurre en cascada (al eliminar el paciente o la clínica).
create or replace function public.protect_prescriptions()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then
      return old;
    end if;
    raise exception 'Una receta no se borra: se anula con un motivo.' using errcode = 'P0001';
  end if;
  if coalesce(current_setting('cuido.prescription_void', true), '') <> 'on' then
    raise exception 'Una receta emitida no se edita: anúlala con un motivo y emite otra.' using errcode = 'P0001';
  end if;
  -- Aun anulándola solo cambia su estado.
  if to_jsonb(new) - 'status' - 'voided_at' - 'voided_by' - 'void_reason'
     is distinct from to_jsonb(old) - 'status' - 'voided_at' - 'voided_by' - 'void_reason' then
    raise exception 'Una receta emitida no se edita: anúlala con un motivo y emite otra.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create or replace function public.protect_prescription_children()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'Los renglones y las impresiones de una receta no se modifican ni se borran.' using errcode = 'P0001';
end;
$$;

revoke execute on function public.protect_prescriptions() from public, anon, authenticated;
revoke execute on function public.protect_prescription_children() from public, anon, authenticated;

create trigger prescriptions_protect before update or delete on public.prescriptions
  for each row execute function public.protect_prescriptions();
create trigger prescription_items_protect before update or delete on public.prescription_items
  for each row execute function public.protect_prescription_children();
create trigger prescription_prints_protect before update or delete on public.prescription_prints
  for each row execute function public.protect_prescription_children();

-- =============================================================================
-- 5. Emitir, anular e imprimir
-- =============================================================================

create or replace function public.issue_prescription(
  p_patient_id uuid,
  p_items jsonb,
  p_notes text default null,
  p_encounter_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  p record;
  m record;
  e record;
  lh record;
  v_item jsonb;
  v_key text;
  v_pos integer := 0;
  v_number integer;
  v_id uuid;
  v_letterhead jsonb;
begin
  select pt.clinic_id, pt.voided_at, pt.first_name, pt.last_name, pt.date_of_birth, pt.record_number into p
  from public.patients pt where pt.id = p_patient_id;
  if not found or auth.uid() is null or not public.is_clinician_of_active_clinic(p.clinic_id) then
    raise exception 'No tienes permiso para emitir recetas.' using errcode = '42501';
  end if;
  if p.voided_at is not null then
    raise exception 'El paciente está anulado: reactívalo antes de emitir recetas.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.patient_records r where r.patient_id = p_patient_id) then
    raise exception 'El paciente no tiene el expediente abierto.' using errcode = '22023';
  end if;

  select cm.professional_name, cm.professional_title, cm.exequatur into m
  from public.clinic_members cm where cm.clinic_id = p.clinic_id and cm.user_id = auth.uid();
  if not found or coalesce(btrim(m.professional_name), '') = '' or coalesce(btrim(m.exequatur), '') = '' then
    raise exception 'Completa tu nombre y tu exequátur en tu perfil profesional antes de emitir recetas.'
      using errcode = '22023', hint = 'profile_incomplete';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 30 then
    raise exception 'La receta necesita entre 1 y 30 medicamentos.' using errcode = '22023';
  end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Cada medicamento debe tener al menos su nombre.' using errcode = '22023';
    end if;
    for v_key in select jsonb_object_keys(v_item) loop
      if v_key not in ('medication', 'dose', 'route', 'frequency', 'duration', 'quantity', 'instructions') then
        raise exception 'Campo desconocido en un medicamento: %.', v_key using errcode = '22023';
      end if;
    end loop;
    if jsonb_typeof(v_item -> 'medication') is distinct from 'string' or char_length(btrim(v_item ->> 'medication')) not between 1 and 200 then
      raise exception 'Cada medicamento necesita un nombre (hasta 200 caracteres).' using errcode = '22023';
    end if;
    for v_key in select unnest(array['dose', 'route', 'frequency', 'duration', 'quantity']) loop
      if char_length(coalesce(v_item ->> v_key, '')) > 200 then
        raise exception 'El campo % de «%» es demasiado largo (máximo 200).', v_key, v_item ->> 'medication' using errcode = '22023';
      end if;
    end loop;
    if char_length(coalesce(v_item ->> 'instructions', '')) > 500 then
      raise exception 'Las indicaciones de «%» son demasiado largas (máximo 500).', v_item ->> 'medication' using errcode = '22023';
    end if;
  end loop;
  if char_length(coalesce(p_notes, '')) > 2000 then
    raise exception 'Las indicaciones generales son demasiado largas (máximo 2000 caracteres).' using errcode = '22023';
  end if;

  if p_encounter_id is not null then
    select en.patient_id, en.clinic_id, en.specialty_template_id, en.provider_id into e
    from public.encounters en where en.id = p_encounter_id;
    if not found or e.patient_id <> p_patient_id or e.clinic_id <> p.clinic_id then
      raise exception 'La consulta indicada no corresponde a este paciente.' using errcode = '22023';
    end if;
    if not public.can_access_sensitive_encounter(e.clinic_id, e.patient_id, e.specialty_template_id, e.provider_id) then
      raise exception 'No tienes acceso a esa consulta.' using errcode = '42501';
    end if;
  end if;

  -- Timbrado vigente (o, si la clínica aún no lo configuró, solo su nombre).
  select l.name, l.address, l.phones, l.email, l.rnc, l.logo_path into lh
  from public.clinic_letterhead l where l.clinic_id = p.clinic_id;
  if found then
    v_letterhead := jsonb_build_object('name', lh.name, 'address', lh.address, 'phones', lh.phones, 'email', lh.email, 'rnc', lh.rnc, 'logo_path', lh.logo_path);
  else
    v_letterhead := jsonb_build_object('name', (select c.name from public.clinics c where c.id = p.clinic_id));
  end if;

  insert into public.clinic_prescription_counters as c (clinic_id, last_value)
  values (p.clinic_id, 1)
  on conflict (clinic_id) do update set last_value = c.last_value + 1
  returning c.last_value into v_number;

  insert into public.prescriptions (
    clinic_id, patient_id, encounter_id, provider_id, number, notes,
    provider_name, provider_title, provider_exequatur, letterhead, patient_snapshot
  ) values (
    p.clinic_id, p_patient_id, p_encounter_id, auth.uid(), v_number, nullif(btrim(coalesce(p_notes, '')), ''),
    btrim(m.professional_name), nullif(btrim(coalesce(m.professional_title, '')), ''), btrim(m.exequatur), v_letterhead,
    jsonb_build_object(
      'name', btrim(p.first_name || ' ' || p.last_name),
      'date_of_birth', p.date_of_birth,
      'record_number', p.record_number
    )
  ) returning id into v_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_pos := v_pos + 1;
    insert into public.prescription_items (clinic_id, prescription_id, position, medication, dose, route, frequency, duration, quantity, instructions)
    values (
      p.clinic_id, v_id, v_pos, btrim(v_item ->> 'medication'),
      nullif(btrim(coalesce(v_item ->> 'dose', '')), ''), nullif(btrim(coalesce(v_item ->> 'route', '')), ''),
      nullif(btrim(coalesce(v_item ->> 'frequency', '')), ''), nullif(btrim(coalesce(v_item ->> 'duration', '')), ''),
      nullif(btrim(coalesce(v_item ->> 'quantity', '')), ''), nullif(btrim(coalesce(v_item ->> 'instructions', '')), '')
    );
  end loop;
  return v_id;
end;
$$;

create or replace function public.void_prescription(p_prescription_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  select rx.clinic_id, rx.provider_id, rx.status, rx.encounter_id into r from public.prescriptions rx where rx.id = p_prescription_id;
  if not found or auth.uid() is null or not public.is_clinician_of_active_clinic(r.clinic_id) then
    raise exception 'No tienes permiso para anular esta receta.' using errcode = '42501';
  end if;
  -- Quien la emitió o el administrador.
  if r.provider_id is distinct from auth.uid() and not public.is_admin_of_active_clinic(r.clinic_id) then
    raise exception 'Solo quien emitió la receta o el administrador puede anularla.' using errcode = '42501';
  end if;
  if r.encounter_id is not null and not exists (
       select 1 from public.encounters en where en.id = r.encounter_id
         and public.can_access_sensitive_encounter(en.clinic_id, en.patient_id, en.specialty_template_id, en.provider_id)
     ) then
    raise exception 'No tienes acceso a la consulta de esta receta.' using errcode = '42501';
  end if;
  if r.status = 'anulada' then
    raise exception 'La receta ya está anulada.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Indica el motivo de la anulación (al menos 3 caracteres).' using errcode = '22023';
  end if;

  perform set_config('cuido.prescription_void', 'on', true);
  update public.prescriptions
    set status = 'anulada', voided_at = now(), voided_by = auth.uid(), void_reason = btrim(p_reason)
    where id = p_prescription_id;
  perform set_config('cuido.prescription_void', '', true);
end;
$$;

-- Registra una impresión; devuelve true si es una COPIA (ya se había impreso antes).
create or replace function public.log_prescription_print(p_prescription_id uuid, p_format text default 'a6')
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_copy boolean;
begin
  select rx.clinic_id, rx.patient_id, rx.status, rx.encounter_id into r from public.prescriptions rx where rx.id = p_prescription_id;
  if not found or auth.uid() is null or not public.is_clinician_of_active_clinic(r.clinic_id) then
    raise exception 'No tienes permiso para imprimir esta receta.' using errcode = '42501';
  end if;
  if r.encounter_id is not null and not exists (
       select 1 from public.encounters en where en.id = r.encounter_id
         and public.can_access_sensitive_encounter(en.clinic_id, en.patient_id, en.specialty_template_id, en.provider_id)
     ) then
    raise exception 'No tienes acceso a la consulta de esta receta.' using errcode = '42501';
  end if;
  if r.status = 'anulada' then
    raise exception 'Una receta anulada no se imprime.' using errcode = '22023';
  end if;
  if p_format not in ('a6', 'a4') then
    raise exception 'Formato de impresión inválido.' using errcode = '22023';
  end if;

  v_copy := exists (select 1 from public.prescription_prints pp where pp.prescription_id = p_prescription_id);
  insert into public.prescription_prints (clinic_id, patient_id, prescription_id, printed_by, is_copy, format)
  values (r.clinic_id, r.patient_id, p_prescription_id, auth.uid(), v_copy, p_format);
  return v_copy;
end;
$$;

revoke execute on function public.issue_prescription(uuid, jsonb, text, uuid) from public, anon;
revoke execute on function public.void_prescription(uuid, text) from public, anon;
revoke execute on function public.log_prescription_print(uuid, text) from public, anon;
grant execute on function public.issue_prescription(uuid, jsonb, text, uuid) to authenticated, service_role;
grant execute on function public.void_prescription(uuid, text) to authenticated, service_role;
grant execute on function public.log_prescription_print(uuid, text) to authenticated, service_role;

-- =============================================================================
-- 6. Timbrado y logo (Storage)
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('clinic-letterhead', 'clinic-letterhead', false, 2097152, array['image/png', 'image/jpeg'])
on conflict (id) do update
  set public = false, file_size_limit = 2097152, allowed_mime_types = array['image/png', 'image/jpeg'];

create or replace function public.letterhead_file_access(p_name text, p_write boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
  v_clinic uuid;
begin
  if coalesce(array_length(v_parts, 1), 0) <> 2 or auth.uid() is null then
    return false;
  end if;
  begin
    v_clinic := v_parts[1]::uuid;
  exception when others then
    return false;
  end;
  if p_write then
    return public.is_admin_of_active_clinic(v_clinic) and public.is_clinic_writable(v_clinic);
  end if;
  return public.is_clinician_of_active_clinic(v_clinic);
end;
$$;

revoke execute on function public.letterhead_file_access(text, boolean) from public, anon;
grant execute on function public.letterhead_file_access(text, boolean) to authenticated, service_role;

create policy letterhead_files_select on storage.objects for select to authenticated
  using (bucket_id = 'clinic-letterhead' and public.letterhead_file_access(name, false));

create policy letterhead_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'clinic-letterhead' and public.letterhead_file_access(name, true));

create or replace function public.save_clinic_letterhead(
  p_clinic_id uuid,
  p_name text,
  p_address text default null,
  p_phones text default null,
  p_email text default null,
  p_rnc text default null,
  p_logo_path text default null,
  p_remove_logo boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_logo text;
  v_logo text;
begin
  if auth.uid() is null or not public.is_admin_of_active_clinic(p_clinic_id) then
    raise exception 'Solo el administrador de la clínica puede cambiar el timbrado.' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 150 then
    raise exception 'El nombre del timbrado es obligatorio (hasta 150 caracteres).' using errcode = '22023';
  end if;
  if char_length(coalesce(p_address, '')) > 300 or char_length(coalesce(p_phones, '')) > 100
     or char_length(coalesce(p_email, '')) > 150 or char_length(coalesce(p_rnc, '')) > 20 then
    raise exception 'Algún dato del timbrado es demasiado largo.' using errcode = '22023';
  end if;
  if coalesce(btrim(p_email), '') <> '' and p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'El correo del timbrado no es válido.' using errcode = '22023';
  end if;

  select l.logo_path into v_old_logo from public.clinic_letterhead l where l.clinic_id = p_clinic_id;
  v_logo := v_old_logo;
  if p_remove_logo then
    v_logo := null;
  elsif p_logo_path is not null then
    if p_logo_path not like (p_clinic_id::text || '/%') then
      raise exception 'La ruta del logo no corresponde a esta clínica.' using errcode = '22023';
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'clinic-letterhead' and o.name = p_logo_path) then
      raise exception 'El logo no se encontró en el almacenamiento.' using errcode = '22023';
    end if;
    v_logo := p_logo_path;
  end if;

  insert into public.clinic_letterhead as l (clinic_id, name, address, phones, email, rnc, logo_path, updated_by, updated_at)
  values (
    p_clinic_id, btrim(p_name), nullif(btrim(coalesce(p_address, '')), ''), nullif(btrim(coalesce(p_phones, '')), ''),
    nullif(btrim(coalesce(p_email, '')), ''), nullif(btrim(coalesce(p_rnc, '')), ''), v_logo, auth.uid(), now()
  )
  on conflict (clinic_id) do update
    set name = excluded.name, address = excluded.address, phones = excluded.phones, email = excluded.email,
        rnc = excluded.rnc, logo_path = excluded.logo_path, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
end;
$$;

revoke execute on function public.save_clinic_letterhead(uuid, text, text, text, text, text, text, boolean) from public, anon;
grant execute on function public.save_clinic_letterhead(uuid, text, text, text, text, text, text, boolean) to authenticated, service_role;

-- =============================================================================
-- 7. Eliminar sin actividad: una receta cuenta como actividad
-- =============================================================================

create or replace function public.patient_deletion_blockers(p_patient_id uuid, p_mode text)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v text[] := '{}';
begin
  if exists (select 1 from public.fiscal_documents f where f.patient_id = p_patient_id) then
    v := v || 'tiene comprobantes fiscales (e-CF)'::text;
  end if;
  if exists (
       select 1 from public.insurance_claims c
       join public.encounters e on e.id = c.encounter_id
       where e.patient_id = p_patient_id
     )
     or exists (
       select 1 from public.insurance_claims c
       join public.patient_insurers i on i.id = c.patient_insurer_id
       where i.patient_id = p_patient_id
     ) then
    v := v || 'tiene reclamaciones a la ARS'::text;
  end if;

  if p_mode = 'error' then
    if exists (select 1 from public.encounters e where e.patient_id = p_patient_id) then
      v := v || 'tiene consultas'::text;
    end if;
    if exists (select 1 from public.consents c where c.patient_id = p_patient_id) then
      v := v || 'tiene consentimientos informados firmados'::text;
    end if;
    if exists (select 1 from public.appointments a where a.patient_id = p_patient_id and a.status = 'completada') then
      v := v || 'tiene citas completadas'::text;
    end if;
    if exists (select 1 from public.allergies a where a.patient_id = p_patient_id)
       or exists (select 1 from public.medications m where m.patient_id = p_patient_id) then
      v := v || 'tiene alergias o medicamentos registrados'::text;
    end if;
    if exists (
         select 1 from public.patient_medical_history h
         where h.patient_id = p_patient_id
           and (h.family_history is not null or h.pathological_history is not null
                or h.non_pathological_history is not null or h.surgical_history is not null
                or h.gyneco_obstetric_history is not null or h.toxic_tobacco is not null
                or h.toxic_alcohol is not null or h.toxic_other_substances is not null
                or h.diet_habits is not null or h.physical_activity is not null
                or h.vaccines is not null or h.other_notes is not null)
       ) then
      v := v || 'tiene una historia clínica registrada en su expediente'::text;
    end if;
    if exists (select 1 from public.study_results s where s.patient_id = p_patient_id) then
      v := v || 'tiene estudios o resultados registrados'::text;
    end if;
    if exists (select 1 from public.prescriptions rx where rx.patient_id = p_patient_id) then
      v := v || 'tiene recetas emitidas'::text;
    end if;
    if exists (select 1 from public.eligibility_checks q where q.patient_id = p_patient_id) then
      v := v || 'tiene verificaciones de cobertura'::text;
    end if;
    if exists (select 1 from public.sensitive_specialty_access_grants g where g.patient_id = p_patient_id) then
      v := v || 'tiene accesos a especialidades sensibles registrados'::text;
    end if;
    if exists (select 1 from public.patient_messaging_consents m where m.patient_id = p_patient_id)
       or exists (select 1 from public.whatsapp_messages w where w.patient_id = p_patient_id) then
      v := v || 'tiene consentimientos o mensajes de WhatsApp registrados'::text;
    end if;
  end if;
  return v;
end;
$$;

revoke execute on function public.patient_deletion_blockers(uuid, text) from public, anon, authenticated;
