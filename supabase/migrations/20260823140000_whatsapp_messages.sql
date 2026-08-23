-- Fase 4 — WhatsApp Business API: registro de envíos.
--
-- Diseño acordado con el usuario antes de escribir esta migración (ver
-- hilo de conversación): validación inicial contra la cuenta y App DE
-- PRUEBA de Meta ("Cuido - Test1", App ID 1346275041895125, "Test
-- WhatsApp Business Account", +1 555-669-0076) -- la App real ("Cuido",
-- App ID 1088516603521677, conectada a la cuenta real de WhatsApp
-- Business de Narnia Tech) sigue pendiente de que Meta apruebe un
-- permiso de plantillas.
--
-- Una sola tabla para prueba y producción (no "whatsapp_test_messages"),
-- distinguidas por la columna `environment` -- así la misma tabla sirve
-- cuando se conecte la cuenta real, sin duplicar esquema, y sin mezclar
-- nunca datos de prueba con reales gracias a esa columna.
--
-- Visibilidad operator-only por ahora (is_platform_operator()), NO
-- admin de clínica: esta ronda usa credenciales de plataforma, no de
-- ninguna clínica en particular (clinic_id es nullable -- un envío de
-- validación manual no está atado a ninguna). Cuando exista el disparo
-- automático desde citas, revisar si conviene que el admin de la
-- clínica también vea sus propios envíos (patrón de
-- clinic_subscriptions: is_clinic_member(clinic_id) or
-- is_platform_operator()) -- no se agrega ahora porque hoy ningún envío
-- está ligado a una clínica real.

create table public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  -- Nullable a propósito: un envío manual de validación no está atado a
  -- una clínica/paciente real. El futuro disparo automático desde citas
  -- sí llenará estos dos campos.
  clinic_id uuid references public.clinics (id) on delete set null,
  patient_id uuid references public.patients (id) on delete set null,
  to_phone_number text not null check (char_length(trim(to_phone_number)) > 0),
  template_name text not null check (char_length(trim(template_name)) > 0),
  template_language text not null check (char_length(trim(template_language)) > 0),
  -- Variables capturadas manualmente en el formulario de validación,
  -- como array posicional -- refleja 1:1 el array `parameters` del
  -- componente "body" de una plantilla en la Graph API de Meta (a
  -- diferencia de encounters.specialty_data, que es un objeto con
  -- claves con nombre porque ahí sí hay claves reales del formulario).
  template_variables jsonb not null default '[]'::jsonb
    check (jsonb_typeof(template_variables) = 'array'),
  environment text not null check (environment in ('test', 'production')),
  -- App ID de Meta usada para el envío (1346275041895125 en prueba,
  -- 1088516603521677 cuando se conecte la cuenta real) -- trazabilidad
  -- explícita de qué App/cuenta originó cada fila, más granular que
  -- `environment` solo.
  meta_app_id text not null check (char_length(trim(meta_app_id)) > 0),
  status text not null check (status in ('sent', 'failed')),
  meta_message_id text,  -- wamid devuelto por Meta cuando status = 'sent'.
  error_message text,    -- detalle del error de Meta cuando status = 'failed'.
  sent_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);

comment on table public.whatsapp_messages is
  'Registro de cada intento de envío vía WhatsApp Cloud API (Meta), de '
  'prueba y de producción distinguidos por `environment`. Escritura '
  'exclusiva vía service_role desde la Server Action de envío -- nunca '
  'INSERT directo del cliente.';

create index whatsapp_messages_clinic_id_idx on public.whatsapp_messages (clinic_id);
create index whatsapp_messages_created_at_idx on public.whatsapp_messages (created_at desc);

alter table public.whatsapp_messages enable row level security;
alter table public.whatsapp_messages force row level security;

-- Solo operador de plataforma puede leer -- mismo patrón que
-- clinic_status_changes/clinic_internal_notes. Sin política de
-- INSERT/UPDATE/DELETE para `authenticated`: la Server Action de envío
-- ya validó is_platform_operator() antes de llamar, y escribe el
-- resultado con el cliente admin (service_role).
create policy whatsapp_messages_select_by_operator
  on public.whatsapp_messages for select to authenticated
  using (public.is_platform_operator());

grant select on public.whatsapp_messages to authenticated;
grant select, insert on public.whatsapp_messages to service_role;
