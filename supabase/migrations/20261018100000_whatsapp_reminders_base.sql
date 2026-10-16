-- WhatsApp Fase 2A: consentimiento del paciente, interruptor por clínica y selección de los
-- recordatorios de citas. ESTA migración no envía nada: deja los datos, los permisos y la función
-- que decide a quién se le debe recordar (el envío y las respuestas son el PR 2B).
--
-- Decisiones (acordadas con José):
--   - El consentimiento lo registra el personal (verbal o escrito) en la ficha del paciente; se guarda
--     para un TELÉFONO concreto (si el paciente cambia de número, hay que registrarlo de nuevo).
--   - Un lote diario (9:00 a. m. de RD) con las citas de mañana, más las de hoy agendadas después
--     (si faltan 2 horas o más). Un solo recordatorio por cita.
--   - Las especialidades de acceso explícito (Salud Mental / Psicología) NUNCA reciben recordatorio
--     automático.
--   - Interruptor por clínica, apagado por defecto: lo activa el admin de la clínica.
--
-- RLS habilitada y forzada, y guard de solo lectura, en CADA tabla nueva y en este mismo archivo, como
-- exige CLAUDE.md. clinic_id lo deriva un trigger del paciente o de la cita: nunca llega del cliente.

-- =============================================================================
-- 1. clinic_whatsapp_settings: interruptor por clínica
-- =============================================================================

create table public.clinic_whatsapp_settings (
  clinic_id uuid primary key references public.clinics (id) on delete cascade,
  reminders_enabled boolean not null default false,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

comment on table public.clinic_whatsapp_settings is
  'Ajustes de WhatsApp de cada clínica. reminders_enabled (apagado por defecto) lo activa el admin.';

-- updated_by / updated_at SIEMPRE los fija la base de datos con la sesión (no se puede falsear).
create or replace function public.stamp_clinic_whatsapp_settings()
returns trigger
language plpgsql
as $$
begin
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;

create trigger clinic_whatsapp_settings_stamp
  before insert or update on public.clinic_whatsapp_settings
  for each row execute function public.stamp_clinic_whatsapp_settings();

alter table public.clinic_whatsapp_settings enable row level security;
alter table public.clinic_whatsapp_settings force row level security;

create policy clinic_whatsapp_settings_select
  on public.clinic_whatsapp_settings for select to authenticated
  using (public.is_member_of_active_clinic(clinic_id));

create policy clinic_whatsapp_settings_insert
  on public.clinic_whatsapp_settings for insert to authenticated
  with check (public.is_admin_of_active_clinic(clinic_id));

create policy clinic_whatsapp_settings_update
  on public.clinic_whatsapp_settings for update to authenticated
  using (public.is_admin_of_active_clinic(clinic_id))
  with check (public.is_admin_of_active_clinic(clinic_id));

grant select, insert, update on public.clinic_whatsapp_settings to authenticated;
grant select, insert, update, delete on public.clinic_whatsapp_settings to service_role;

select public.attach_readonly_guard('public.clinic_whatsapp_settings'::regclass);

-- =============================================================================
-- 2. patient_messaging_consents: consentimiento del paciente (por teléfono)
-- =============================================================================

create table public.patient_messaging_consents (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  patient_id uuid not null references public.patients (id) on delete cascade,
  channel text not null default 'whatsapp' check (channel in ('whatsapp')),
  category text not null default 'recordatorio_citas' check (category in ('recordatorio_citas')),
  -- Teléfono al que se consintió, ya normalizado (E.164).
  phone_e164 text not null check (phone_e164 ~ '^[+][1-9][0-9]{7,14}$'),
  granted_at timestamptz not null default now(),
  granted_by uuid references auth.users (id) on delete set null,
  source text not null check (source in ('verbal', 'escrito', 'otro')),
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete set null,
  revoke_source text check (revoke_source in ('personal', 'baja_paciente')),
  created_at timestamptz not null default now(),
  check (
    (revoked_at is null and revoke_source is null)
    or (revoked_at is not null and revoke_source is not null)
  )
);

comment on table public.patient_messaging_consents is
  'Consentimiento del paciente para recibir mensajes por un canal, para un teléfono concreto. No se '
  'borra: se revoca (revoked_at), para conservar el historial. Un consentimiento activo por paciente '
  'y categoría.';

create unique index patient_messaging_consents_one_active
  on public.patient_messaging_consents (patient_id, channel, category)
  where revoked_at is null;
create index patient_messaging_consents_clinic_idx on public.patient_messaging_consents (clinic_id);
create index patient_messaging_consents_phone_idx
  on public.patient_messaging_consents (phone_e164)
  where revoked_at is null;

create trigger patient_messaging_consents_set_clinic_id
  before insert on public.patient_messaging_consents
  for each row execute function public.set_clinic_id_from_patient();

-- Quién lo concedió y quién lo revocó los pone la base con la sesión; el historial no se reescribe:
-- solo se puede revocar (una vez), nunca editar teléfono, fecha ni fuente ni «des-revocar».
create or replace function public.enforce_patient_messaging_consent_rules()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.granted_by := coalesce(auth.uid(), new.granted_by);
    new.granted_at := now();
    new.revoked_at := null;
    new.revoked_by := null;
    new.revoke_source := null;
    return new;
  end if;

  if old.revoked_at is not null then
    raise exception 'Un consentimiento revocado no se puede modificar; registra uno nuevo.';
  end if;
  if new.clinic_id is distinct from old.clinic_id
     or new.patient_id is distinct from old.patient_id
     or new.channel is distinct from old.channel
     or new.category is distinct from old.category
     or new.phone_e164 is distinct from old.phone_e164
     or new.granted_at is distinct from old.granted_at
     or new.granted_by is distinct from old.granted_by
     or new.source is distinct from old.source then
    raise exception 'Solo se puede revocar un consentimiento; para otro teléfono registra uno nuevo.';
  end if;
  if new.revoked_at is not null then
    new.revoked_at := now();
    new.revoked_by := coalesce(auth.uid(), new.revoked_by);
  end if;
  return new;
end;
$$;

create trigger patient_messaging_consents_rules
  before insert or update on public.patient_messaging_consents
  for each row execute function public.enforce_patient_messaging_consent_rules();

alter table public.patient_messaging_consents enable row level security;
alter table public.patient_messaging_consents force row level security;

create policy patient_messaging_consents_select
  on public.patient_messaging_consents for select to authenticated
  using (public.is_member_of_active_clinic(clinic_id));

-- Admin y recepción (el personal que atiende al paciente en recepción) registran y revocan.
create policy patient_messaging_consents_insert
  on public.patient_messaging_consents for insert to authenticated
  with check (public.is_billing_staff_of_active_clinic(clinic_id));

create policy patient_messaging_consents_update
  on public.patient_messaging_consents for update to authenticated
  using (public.is_billing_staff_of_active_clinic(clinic_id))
  with check (public.is_billing_staff_of_active_clinic(clinic_id));
-- Sin política de DELETE: el historial se conserva.

grant select, insert, update on public.patient_messaging_consents to authenticated;
grant select, insert, update, delete on public.patient_messaging_consents to service_role;

select public.attach_readonly_guard('public.patient_messaging_consents'::regclass);

-- =============================================================================
-- 3. whatsapp_messages: envíos automáticos (sin usuario) ligados a una cita
-- =============================================================================

alter table public.whatsapp_messages alter column sent_by drop not null;

alter table public.whatsapp_messages
  add column purpose text not null default 'prueba' check (purpose in ('prueba', 'recordatorio_cita')),
  add column appointment_id uuid references public.appointments (id) on delete set null;

-- Un envío manual del operador siempre tiene usuario; solo el recordatorio automático puede no tenerlo.
alter table public.whatsapp_messages
  add constraint whatsapp_messages_sent_by_required
  check (sent_by is not null or purpose = 'recordatorio_cita');

create index whatsapp_messages_appointment_idx
  on public.whatsapp_messages (appointment_id)
  where appointment_id is not null;

-- =============================================================================
-- 4. appointment_reminders: un recordatorio por cita (y qué respondió el paciente)
-- =============================================================================

create table public.appointment_reminders (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  -- UNIQUE: un solo recordatorio por cita (ni un reintento ni dos ejecuciones simultáneas lo repiten).
  appointment_id uuid not null unique references public.appointments (id) on delete cascade,
  consent_id uuid references public.patient_messaging_consents (id) on delete set null,
  whatsapp_message_id uuid references public.whatsapp_messages (id) on delete set null,
  status text not null default 'en_envio' check (status in ('en_envio', 'enviado', 'omitido', 'fallido')),
  skip_reason text,
  claimed_at timestamptz not null default now(),
  sent_at timestamptz,
  response text check (response in ('confirmar', 'cancelar')),
  responded_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.appointment_reminders is
  'Recordatorio de WhatsApp de cada cita y la respuesta del paciente. Solo lo escriben las funciones '
  'del servidor (service_role); los usuarios solo lo leen.';

create index appointment_reminders_clinic_idx on public.appointment_reminders (clinic_id, claimed_at desc);

alter table public.appointment_reminders enable row level security;
alter table public.appointment_reminders force row level security;

-- Personal de facturación (admin/recepción) ve los de su clínica; el médico, solo los de SUS citas.
create policy appointment_reminders_select
  on public.appointment_reminders for select to authenticated
  using (
    public.is_billing_staff_of_active_clinic(clinic_id)
    or (
      public.is_clinician_of_active_clinic(clinic_id)
      and exists (
        select 1 from public.appointments a
        where a.id = appointment_reminders.appointment_id and a.provider_id = auth.uid()
      )
    )
  );
-- Sin política de INSERT / UPDATE / DELETE para authenticated.

grant select on public.appointment_reminders to authenticated;
grant select, insert, update, delete on public.appointment_reminders to service_role;

select public.attach_readonly_guard('public.appointment_reminders'::regclass);

-- =============================================================================
-- 5. claim_due_appointment_reminders(): a quién se le recuerda hoy
-- =============================================================================
-- La llama el proceso diario (service_role). En UNA transacción, con FOR UPDATE SKIP LOCKED y el
-- índice único (appointment_id), elige las citas elegibles y deja una fila `en_envio` por cada una:
-- así dos ejecuciones simultáneas o un reintento nunca mandan el mismo recordatorio dos veces.
--
-- Elegible =
--   - cita de MAÑANA (día de RD), o de hoy con 2 horas o más de anticipación;
--   - estado pendiente o confirmada;
--   - clínica con acceso y que puede escribir (ni solo lectura, ni suspendida, ni bloqueada);
--   - interruptor de la clínica activo;
--   - consentimiento activo del paciente (con su teléfono);
--   - especialidad SIN acceso explícito (nunca Salud Mental);
--   - sin recordatorio previo.
-- Los parámetros de salida llevan prefijo `out_` para no chocar con los nombres de columna.

create or replace function public.claim_due_appointment_reminders(
  p_now timestamptz default now(),
  p_limit integer default 500
)
returns table (
  out_reminder_id uuid,
  out_appointment_id uuid,
  out_clinic_id uuid,
  out_clinic_name text,
  out_scheduled_at timestamptz,
  out_phone_e164 text,
  out_consent_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dr_today date := (p_now at time zone 'America/Santo_Domingo')::date;
  v_tomorrow_start timestamptz := ((v_dr_today + 1)::timestamp at time zone 'America/Santo_Domingo');
  v_tomorrow_end timestamptz := ((v_dr_today + 2)::timestamp at time zone 'America/Santo_Domingo');
begin
  if p_limit is null or p_limit < 1 or p_limit > 5000 then
    raise exception 'p_limit fuera de rango';
  end if;

  return query
  with candidates as (
    select a.id as appointment_id, a.clinic_id, a.scheduled_at, cons.id as consent_id, cons.phone_e164
    from public.appointments a
    join public.clinic_whatsapp_settings s
      on s.clinic_id = a.clinic_id and s.reminders_enabled
    join public.specialty_templates st
      on st.id = a.specialty_template_id and not st.requires_explicit_access
    join lateral (
      select pc.id, pc.phone_e164
      from public.patient_messaging_consents pc
      where pc.patient_id = a.patient_id
        and pc.channel = 'whatsapp'
        and pc.category = 'recordatorio_citas'
        and pc.revoked_at is null
      order by pc.granted_at desc
      limit 1
    ) cons on true
    where a.status in ('pendiente', 'confirmada')
      and not exists (select 1 from public.appointment_reminders r where r.appointment_id = a.id)
      and public.clinic_is_accessible(a.clinic_id)
      and public.is_clinic_writable(a.clinic_id)
      and (
        (a.scheduled_at >= v_tomorrow_start and a.scheduled_at < v_tomorrow_end)
        or (a.scheduled_at >= p_now + interval '2 hours' and a.scheduled_at < v_tomorrow_start)
      )
    order by a.scheduled_at
    limit p_limit
    for update of a skip locked
  ),
  claimed as (
    insert into public.appointment_reminders (clinic_id, appointment_id, consent_id)
    select c.clinic_id, c.appointment_id, c.consent_id from candidates c
    on conflict (appointment_id) do nothing
    returning id, appointment_id, clinic_id, consent_id
  )
  select cl.id, cl.appointment_id, cl.clinic_id, clinics.name, c.scheduled_at, c.phone_e164, cl.consent_id
  from claimed cl
  join candidates c on c.appointment_id = cl.appointment_id
  join public.clinics on clinics.id = cl.clinic_id
  order by c.scheduled_at;
end;
$$;

revoke execute on function public.claim_due_appointment_reminders(timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.claim_due_appointment_reminders(timestamptz, integer) to service_role;
