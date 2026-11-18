-- Diagnósticos codificados CIE-11 en las consultas (PR A de la codificación CIE-11).
--
-- El diagnóstico de la consulta sigue siendo el texto libre de la plantilla (specialty_data): no se migra
-- ni se reescribe nada. Esta tabla lo COMPLEMENTA con el código de la clasificación (CIE-11, MMS) elegido
-- por el médico, de forma transversal a las 24 plantillas, para poder consultar, exportar y reportar sin
-- recorrer el JSON de cada una.
--
--   * encounter_diagnoses -- un diagnóstico codificado de una consulta: presuntivo o definitivo, con su
--     código y título OFICIALES tal como los devuelve la OMS (no se modifican: licencia CC BY-ND 3.0 IGO),
--     el URI de la entidad, la versión de la clasificación y si vino del catálogo (verified) o se escribió
--     a mano porque la API de la OMS no estaba disponible. Un matiz del médico va aparte (doctor_note).
--   * INMUTABLE, como el resto del registro clínico (Reglamento del Expediente Clínico: trazabilidad): sin
--     UPDATE ni DELETE. Corregir = agregar una fila nueva y marcar la anterior como reemplazada
--     (superseded_*), con motivo; lo ya codificado se conserva. Quitar un código equivocado = reemplazarlo
--     sin sustituto. Lo único que cambia en una fila es ese marcado, y solo por correct_encounter_diagnosis().
--   * Un solo diagnóstico principal VIGENTE por consulta y tipo; el mismo código no se repite vigente en
--     la misma consulta y tipo.
--   * Solo CIE-11: CIE-10 sigue existiendo únicamente en las reclamaciones a ARS (entrada manual).
--
-- Escritura SOLO por funciones (security definer, search_path = ''), que verifican rol, clínica, que la
-- consulta sea del paciente y que el usuario tenga acceso a ella (Salud Mental con acceso reforzado):
--   add_encounter_diagnoses(consulta, lista)       -- agrega diagnósticos a una consulta existente
--   correct_encounter_diagnosis(id, motivo, nuevo) -- reemplaza o quita uno, con motivo
--   create_encounter_with_diagnoses(...)           -- crea la consulta Y sus diagnósticos en UNA transacción
--                                                     (si algo falla, no queda una consulta a medias)
--
-- Políticas RLS (descritas en la PR):
--   encounter_diagnoses_select: admin y médicos de la clínica activa, y solo si la consulta les es visible
--       (la subconsulta pasa por la RLS de encounters: Salud Mental solo con acceso). Recepción: ninguna.
--       Sin INSERT/UPDATE/DELETE para usuarios; ENABLE + FORCE RLS; guard de solo lectura.

-- =============================================================================
-- 1. Tabla
-- =============================================================================

create table public.encounter_diagnoses (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  encounter_id uuid not null references public.encounters (id) on delete cascade,
  patient_id uuid not null references public.patients (id) on delete cascade,
  kind text not null check (kind in ('presuntivo', 'definitivo')),
  is_primary boolean not null default false,
  -- Por ahora solo CIE-11; la restricción se relajará cuando exista entrada manual de CIE-10 en consulta.
  code_system text not null default 'CIE-11' check (code_system = 'CIE-11'),
  -- Código MMS, con posible postcoordinación: 5A11, 1A00.1, 2C25.Z&XA2UD3, 2C25.Z/XA2UD3.
  code text not null check (
    char_length(code) <= 80
    and code ~ '^[0-9A-Z][0-9A-Z]{3}(\.[0-9A-Z]{1,2})?([&/][0-9A-Z]{4,6}(\.[0-9A-Z]{1,2})?)*$'
  ),
  -- Título oficial tal como lo devolvió la OMS (sin modificar).
  title text not null check (char_length(btrim(title)) between 1 and 400),
  language text not null default 'es' check (language = 'es'),
  -- Versión de la clasificación consultada (p. ej. 2026-01).
  icd_release text not null check (icd_release ~ '^[0-9]{4}-[0-9]{2}$'),
  entity_uri text check (entity_uri is null or (char_length(entity_uri) <= 500 and entity_uri like 'http://id.who.int/icd/release/11/%')),
  -- true = elegido del catálogo de la OMS (tiene entity_uri); false = escrito a mano (API no disponible).
  verified boolean not null default false,
  doctor_note text check (doctor_note is null or char_length(doctor_note) <= 500),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  -- Reemplazo / retiro (única parte que cambia en una fila).
  superseded_at timestamptz,
  superseded_by uuid references public.encounter_diagnoses (id) deferrable initially deferred,
  superseded_by_user uuid references auth.users (id) on delete set null,
  superseded_reason text,
  check (verified = (entity_uri is not null)),
  check ((superseded_at is null) = (superseded_reason is null)),
  check (superseded_by is null or superseded_at is not null)
);

comment on table public.encounter_diagnoses is
  'Diagnóstico codificado (CIE-11) de una consulta. Complementa el texto libre de la plantilla. Inmutable: se corrige con una fila nueva y el marcado de la anterior.';
comment on column public.encounter_diagnoses.title is
  'Título oficial de la OMS tal como lo devolvió la API, sin modificar (licencia CC BY-ND 3.0 IGO).';
comment on column public.encounter_diagnoses.verified is
  'true = elegido del catálogo de la OMS; false = escrito a mano porque la API no estaba disponible.';

-- Un solo principal vigente por consulta y tipo; el mismo código no se repite vigente.
create unique index encounter_diagnoses_one_primary
  on public.encounter_diagnoses (encounter_id, kind) where is_primary and superseded_at is null;
create unique index encounter_diagnoses_no_repeat
  on public.encounter_diagnoses (encounter_id, kind, code) where superseded_at is null;
create index encounter_diagnoses_clinic_code_idx on public.encounter_diagnoses (clinic_id, code);
create index encounter_diagnoses_patient_idx on public.encounter_diagnoses (patient_id);
create index encounter_diagnoses_encounter_idx on public.encounter_diagnoses (encounter_id);

-- =============================================================================
-- 2. RLS
-- =============================================================================

alter table public.encounter_diagnoses enable row level security;
alter table public.encounter_diagnoses force row level security;

create policy encounter_diagnoses_select
  on public.encounter_diagnoses for select to authenticated
  using (
    public.is_clinician_of_active_clinic(clinic_id)
    and exists (select 1 from public.encounters e where e.id = encounter_diagnoses.encounter_id)
  );

revoke all on public.encounter_diagnoses from anon, authenticated;
grant select on public.encounter_diagnoses to authenticated, service_role;

select public.attach_readonly_guard('public.encounter_diagnoses'::regclass);

create trigger encounter_diagnoses_block_voided before insert on public.encounter_diagnoses
  for each row execute function public.block_writes_for_voided_patient();

-- Integridad: la clínica y el paciente son los de la consulta (también para service_role).
create or replace function public.enforce_encounter_diagnosis_links()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  e record;
begin
  select en.clinic_id, en.patient_id into e from public.encounters en where en.id = new.encounter_id;
  if not found then
    raise exception 'La consulta del diagnóstico no existe.' using errcode = '23503';
  end if;
  if new.clinic_id <> e.clinic_id or new.patient_id <> e.patient_id then
    raise exception 'El diagnóstico no corresponde al paciente ni a la clínica de la consulta.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke execute on function public.enforce_encounter_diagnosis_links() from public, anon, authenticated;

create trigger encounter_diagnoses_enforce_links before insert on public.encounter_diagnoses
  for each row execute function public.enforce_encounter_diagnosis_links();

-- Inmutable: la fila no se edita ni se borra; solo se marca como reemplazada (por correct_encounter_diagnosis,
-- con el ajuste cuido.diagnosis_supersede) y solo se borra en cascada (al eliminar el paciente o la clínica).
create or replace function public.protect_encounter_diagnoses()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then
      return old;
    end if;
    raise exception 'Un diagnóstico codificado no se borra: se reemplaza o se retira con un motivo.' using errcode = 'P0001';
  end if;
  if coalesce(current_setting('cuido.diagnosis_supersede', true), '') <> 'on'
     or old.superseded_at is not null
     or to_jsonb(new) - 'superseded_at' - 'superseded_by' - 'superseded_by_user' - 'superseded_reason'
        is distinct from to_jsonb(old) - 'superseded_at' - 'superseded_by' - 'superseded_by_user' - 'superseded_reason' then
    raise exception 'Un diagnóstico codificado no se edita: se corrige con uno nuevo y un motivo.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke execute on function public.protect_encounter_diagnoses() from public, anon, authenticated;

create trigger encounter_diagnoses_protect before update or delete on public.encounter_diagnoses
  for each row execute function public.protect_encounter_diagnoses();

-- =============================================================================
-- 3. Escritura
-- =============================================================================

-- Valida un elemento de la lista y lo inserta. Interna (no ejecutable por usuarios).
create or replace function public.insert_encounter_diagnosis_row(
  p_encounter_id uuid,
  p_clinic_id uuid,
  p_patient_id uuid,
  p_item jsonb,
  p_release text,
  p_new_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_kind text;
  v_code text;
  v_title text;
  v_uri text;
  v_primary boolean;
  v_note text;
  v_id uuid;
begin
  if jsonb_typeof(p_item) <> 'object' then
    raise exception 'Cada diagnóstico debe tener su código y su título.' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_item) loop
    if v_key not in ('kind', 'code', 'title', 'entity_uri', 'is_primary', 'doctor_note') then
      raise exception 'Campo desconocido en un diagnóstico: %.', v_key using errcode = '22023';
    end if;
  end loop;

  v_kind := p_item ->> 'kind';
  if v_kind is null or v_kind not in ('presuntivo', 'definitivo') then
    raise exception 'El tipo del diagnóstico debe ser presuntivo o definitivo.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_item -> 'code') is distinct from 'string' then
    raise exception 'Cada diagnóstico necesita su código CIE-11.' using errcode = '22023';
  end if;
  v_code := upper(btrim(p_item ->> 'code'));
  if v_code !~ '^[0-9A-Z][0-9A-Z]{3}(\.[0-9A-Z]{1,2})?([&/][0-9A-Z]{4,6}(\.[0-9A-Z]{1,2})?)*$' or char_length(v_code) > 80 then
    raise exception 'El código «%» no tiene un formato CIE-11 válido.', left(coalesce(p_item ->> 'code', ''), 40) using errcode = '22023';
  end if;
  if jsonb_typeof(p_item -> 'title') is distinct from 'string' or char_length(btrim(p_item ->> 'title')) not between 1 and 400 then
    raise exception 'Cada diagnóstico necesita su título (hasta 400 caracteres).' using errcode = '22023';
  end if;
  v_title := btrim(p_item ->> 'title');
  v_uri := nullif(btrim(coalesce(p_item ->> 'entity_uri', '')), '');
  if v_uri is not null and (v_uri not like 'http://id.who.int/icd/release/11/%' or char_length(v_uri) > 500) then
    raise exception 'La dirección de la entidad de la OMS no es válida.' using errcode = '22023';
  end if;
  if p_item ? 'is_primary' and jsonb_typeof(p_item -> 'is_primary') <> 'boolean' then
    raise exception 'El campo «principal» debe ser verdadero o falso.' using errcode = '22023';
  end if;
  v_primary := coalesce((p_item ->> 'is_primary')::boolean, false);
  v_note := nullif(btrim(coalesce(p_item ->> 'doctor_note', '')), '');
  if char_length(coalesce(v_note, '')) > 500 then
    raise exception 'La nota del médico es demasiado larga (máximo 500 caracteres).' using errcode = '22023';
  end if;

  if v_primary and exists (
       select 1 from public.encounter_diagnoses d
       where d.encounter_id = p_encounter_id and d.kind = v_kind and d.is_primary and d.superseded_at is null
     ) then
    raise exception 'Esta consulta ya tiene un diagnóstico % principal: corrígelo en lugar de agregar otro.', v_kind using errcode = '22023';
  end if;
  if exists (
       select 1 from public.encounter_diagnoses d
       where d.encounter_id = p_encounter_id and d.kind = v_kind and d.code = v_code and d.superseded_at is null
     ) then
    raise exception 'El código % ya está registrado como diagnóstico % en esta consulta.', v_code, v_kind using errcode = '22023';
  end if;

  insert into public.encounter_diagnoses (
    id, clinic_id, encounter_id, patient_id, kind, is_primary, code, title, icd_release, entity_uri, verified, doctor_note, created_by
  ) values (
    coalesce(p_new_id, gen_random_uuid()), p_clinic_id, p_encounter_id, p_patient_id, v_kind, v_primary,
    v_code, v_title, p_release, v_uri, v_uri is not null, v_note, auth.uid()
  ) returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.insert_encounter_diagnosis_row(uuid, uuid, uuid, jsonb, text, uuid) from public, anon, authenticated;

-- Verifica que quien llama puede codificar esa consulta; devuelve su fila.
create or replace function public.encounter_for_diagnosis(p_encounter_id uuid)
returns table (enc_id uuid, enc_clinic_id uuid, enc_patient_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  e record;
begin
  select en.id, en.clinic_id, en.patient_id, en.specialty_template_id, en.provider_id into e
  from public.encounters en where en.id = p_encounter_id;
  if not found or auth.uid() is null or not public.is_clinician_of_active_clinic(e.clinic_id) then
    raise exception 'No tienes permiso para codificar diagnósticos de esta consulta.' using errcode = '42501';
  end if;
  if not public.can_access_sensitive_encounter(e.clinic_id, e.patient_id, e.specialty_template_id, e.provider_id) then
    raise exception 'No tienes acceso a esa consulta.' using errcode = '42501';
  end if;
  return query select e.id, e.clinic_id, e.patient_id;
end;
$$;

revoke execute on function public.encounter_for_diagnosis(uuid) from public, anon, authenticated;

create or replace function public.add_encounter_diagnoses(p_encounter_id uuid, p_items jsonb, p_release text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  e record;
  v_item jsonb;
  v_count integer := 0;
begin
  select * into e from public.encounter_for_diagnosis(p_encounter_id);
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 20 then
    raise exception 'Indica entre 1 y 20 diagnósticos.' using errcode = '22023';
  end if;
  if coalesce(p_release, '') !~ '^[0-9]{4}-[0-9]{2}$' then
    raise exception 'La versión de la clasificación no es válida.' using errcode = '22023';
  end if;
  if (select count(*) from public.encounter_diagnoses d where d.encounter_id = e.enc_id and d.superseded_at is null) + jsonb_array_length(p_items) > 20 then
    raise exception 'Una consulta admite como máximo 20 diagnósticos codificados vigentes.' using errcode = '22023';
  end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    perform public.insert_encounter_diagnosis_row(e.enc_id, e.enc_clinic_id, e.enc_patient_id, v_item, p_release);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Reemplaza (con p_new) o retira (sin p_new) un diagnóstico vigente, con motivo. El anterior se conserva marcado.
create or replace function public.correct_encounter_diagnosis(p_diagnosis_id uuid, p_reason text, p_new jsonb default null, p_release text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  d record;
  e record;
  v_new_id uuid := null;
begin
  select dg.id, dg.encounter_id, dg.superseded_at into d from public.encounter_diagnoses dg where dg.id = p_diagnosis_id;
  if not found then
    raise exception 'No tienes permiso para corregir este diagnóstico.' using errcode = '42501';
  end if;
  select * into e from public.encounter_for_diagnosis(d.encounter_id);
  if d.superseded_at is not null then
    raise exception 'Ese diagnóstico ya fue reemplazado o retirado.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Indica el motivo de la corrección (al menos 3 caracteres).' using errcode = '22023';
  end if;
  if char_length(p_reason) > 500 then
    raise exception 'El motivo es demasiado largo (máximo 500 caracteres).' using errcode = '22023';
  end if;
  if p_new is not null and coalesce(p_release, '') !~ '^[0-9]{4}-[0-9]{2}$' then
    raise exception 'La versión de la clasificación no es válida.' using errcode = '22023';
  end if;

  if p_new is not null then
    v_new_id := gen_random_uuid();
  end if;
  -- Primero se marca el anterior (así el nuevo puede ser el principal vigente) y luego se inserta el nuevo.
  perform set_config('cuido.diagnosis_supersede', 'on', true);
  update public.encounter_diagnoses
    set superseded_at = now(), superseded_by = v_new_id, superseded_by_user = auth.uid(), superseded_reason = btrim(p_reason)
    where id = p_diagnosis_id;
  perform set_config('cuido.diagnosis_supersede', '', true);
  if p_new is not null then
    perform public.insert_encounter_diagnosis_row(e.enc_id, e.enc_clinic_id, e.enc_patient_id, p_new, p_release, v_new_id);
  end if;
  return v_new_id;
end;
$$;

-- La consulta y sus diagnósticos en UNA transacción. SECURITY INVOKER a propósito: el INSERT de la consulta
-- pasa por las mismas políticas y triggers de siempre (con los permisos de quien llama); solo los diagnósticos
-- se escriben con la función definer de arriba.
create or replace function public.create_encounter_with_diagnoses(
  p_patient_id uuid,
  p_template_id uuid,
  p_encounter_type public.encounter_type,
  p_chief_complaint text,
  p_present_illness text,
  p_specialty_data jsonb,
  p_diagnoses jsonb default null,
  p_release text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_id uuid;
begin
  select pt.clinic_id into v_clinic from public.patients pt where pt.id = p_patient_id;
  if v_clinic is null then
    raise exception 'No se encontró el paciente.' using errcode = '42501';
  end if;
  insert into public.encounters (clinic_id, patient_id, provider_id, specialty_template_id, chief_complaint, present_illness, encounter_type, specialty_data)
  values (v_clinic, p_patient_id, auth.uid(), p_template_id, nullif(p_chief_complaint, ''), nullif(p_present_illness, ''), p_encounter_type, p_specialty_data)
  returning id into v_id;
  -- Sin diagnósticos (NULL, JSON null o lista vacía) la consulta se guarda sola; cualquier otra cosa que no sea una
  -- lista se rechaza (y con ella la consulta: nada queda a medias).
  if p_diagnoses is not null and jsonb_typeof(p_diagnoses) <> 'null' then
    if jsonb_typeof(p_diagnoses) <> 'array' then
      raise exception 'Los diagnósticos codificados deben ser una lista.' using errcode = '22023';
    end if;
    if jsonb_array_length(p_diagnoses) > 0 then
      perform public.add_encounter_diagnoses(v_id, p_diagnoses, p_release);
    end if;
  end if;
  return v_id;
end;
$$;

revoke execute on function public.add_encounter_diagnoses(uuid, jsonb, text) from public, anon;
revoke execute on function public.correct_encounter_diagnosis(uuid, text, jsonb, text) from public, anon;
revoke execute on function public.create_encounter_with_diagnoses(uuid, uuid, public.encounter_type, text, text, jsonb, jsonb, text) from public, anon;
grant execute on function public.add_encounter_diagnoses(uuid, jsonb, text) to authenticated, service_role;
grant execute on function public.correct_encounter_diagnosis(uuid, text, jsonb, text) to authenticated, service_role;
grant execute on function public.create_encounter_with_diagnoses(uuid, uuid, public.encounter_type, text, text, jsonb, jsonb, text) to authenticated, service_role;
