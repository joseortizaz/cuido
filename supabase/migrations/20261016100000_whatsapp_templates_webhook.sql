-- WhatsApp Fase 1: catálogo de plantillas, deduplicación del webhook y estados de entrega.
--
-- Meta avisa por webhook (a) cuándo aprueba, rechaza o pausa una plantilla y (b) cuándo un
-- mensaje se entrega o se lee. Este archivo agrega lo que Cuido necesita para registrarlo:
--
--   1. whatsapp_templates: catálogo de las plantillas de la cuenta de WhatsApp de Narnia (una
--      sola cuenta compartida, "opción A" del plan; `waba_id` queda para poder pasar a una
--      cuenta por clínica sin reescribir). Global, sin clinic_id, solo lo lee el operador.
--   2. whatsapp_webhook_events: claves de deduplicación (Meta reintenta durante 7 días). NO guarda
--      el cuerpo del evento ni teléfonos.
--   3. whatsapp_messages: el estado pasa de sent|failed a sent|delivered|read|failed, con fechas.
--   4. record_whatsapp_message_status(): único camino para actualizar el estado de un mensaje.
--      Solo avanza (sent -> delivered -> read; failed es final), es idempotente y funciona aunque
--      la clínica esté en solo lectura (un acuse de entrega de un mensaje ya enviado no es
--      "escribir datos de la clínica").
--
-- Los mensajes entrantes de pacientes NO se guardan en esta fase.
--
-- RLS habilitada y forzada en cada tabla nueva, en este mismo archivo, como exige CLAUDE.md.
-- Ningún usuario autenticado escribe en estas tablas: solo service_role (webhook y operador
-- desde Server Actions ya autorizadas).

-- =============================================================================
-- 1. whatsapp_templates
-- =============================================================================

create table public.whatsapp_templates (
  id uuid primary key default gen_random_uuid(),
  -- Cuenta de WhatsApp Business (WABA) a la que pertenece la plantilla.
  waba_id text not null check (char_length(btrim(waba_id)) > 0),
  -- Identificador de la plantilla en Meta.
  meta_template_id text not null unique check (char_length(btrim(meta_template_id)) > 0),
  name text not null check (name ~ '^[a-z0-9_]{1,512}$'),
  language text not null check (char_length(btrim(language)) > 0),
  category text not null check (category in ('UTILITY', 'MARKETING', 'AUTHENTICATION')),
  -- APPROVED, PENDING, REJECTED, PAUSED, DISABLED, IN_APPEAL, PENDING_DELETION, DELETED, ...
  -- Texto libre a propósito: Meta agrega estados sin avisar y no queremos rechazar un evento.
  status text not null check (char_length(btrim(status)) > 0),
  quality_score text,
  rejected_reason text,
  components jsonb not null default '[]'::jsonb check (jsonb_typeof(components) = 'array'),
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (waba_id, name, language)
);

comment on table public.whatsapp_templates is
  'Plantillas de la cuenta de WhatsApp de Narnia (global, sin clinic_id). La escribe solo '
  'service_role: el webhook de Meta y la sincronización del operador.';

alter table public.whatsapp_templates enable row level security;
alter table public.whatsapp_templates force row level security;

create policy whatsapp_templates_select_by_operator
  on public.whatsapp_templates for select to authenticated
  using (public.is_platform_operator());

grant select on public.whatsapp_templates to authenticated;
grant select, insert, update on public.whatsapp_templates to service_role;

-- =============================================================================
-- 2. whatsapp_webhook_events (deduplicación)
-- =============================================================================

create table public.whatsapp_webhook_events (
  id uuid primary key default gen_random_uuid(),
  -- Hash del evento (campo + identificadores + estado + marca de tiempo). No contiene datos
  -- personales y no permite reconstruirlos.
  event_key text not null unique check (char_length(event_key) between 16 and 128),
  field text not null check (char_length(btrim(field)) > 0),
  received_at timestamptz not null default now()
);

comment on table public.whatsapp_webhook_events is
  'Claves de eventos del webhook de WhatsApp ya procesados (Meta reintenta durante 7 días). '
  'No guarda el cuerpo ni teléfonos. La escribe solo service_role.';

create index whatsapp_webhook_events_received_at_idx on public.whatsapp_webhook_events (received_at);

alter table public.whatsapp_webhook_events enable row level security;
alter table public.whatsapp_webhook_events force row level security;

create policy whatsapp_webhook_events_select_by_operator
  on public.whatsapp_webhook_events for select to authenticated
  using (public.is_platform_operator());

grant select on public.whatsapp_webhook_events to authenticated;
grant select, insert, delete on public.whatsapp_webhook_events to service_role;

-- =============================================================================
-- 3. whatsapp_messages: estados de entrega
-- =============================================================================

alter table public.whatsapp_messages drop constraint whatsapp_messages_status_check;
alter table public.whatsapp_messages
  add constraint whatsapp_messages_status_check
  check (status in ('sent', 'delivered', 'read', 'failed'));

alter table public.whatsapp_messages
  add column status_updated_at timestamptz,
  add column delivered_at timestamptz,
  add column read_at timestamptz,
  add column meta_error_code text;

create index whatsapp_messages_meta_message_id_idx
  on public.whatsapp_messages (meta_message_id)
  where meta_message_id is not null;

-- =============================================================================
-- 4. record_whatsapp_message_status()
-- =============================================================================
-- Devuelve true si cambió el estado del mensaje. Reglas:
--   - Solo avanza: sent(1) -> delivered(2) -> read(3). Un 'delivered' tardío no baja un 'read'.
--   - 'failed' solo puede reemplazar a 'sent' (el mensaje nunca llegó); no pisa delivered/read ni
--     vuelve a escribirse, y una vez fallido ningún estado posterior lo cambia (final).
--   - Un estado repetido o más viejo no cambia nada (idempotente).
--   - Una entrega sin 'sent' previo registrado sube directo a delivered/read y rellena las fechas.
--   - Mantenimiento: el acuse de un mensaje ya enviado se registra aunque la clínica esté en
--     solo lectura (bypass de transacción, igual que otras migraciones).

create or replace function public.record_whatsapp_message_status(
  p_meta_message_id text,
  p_status text,
  p_occurred_at timestamptz,
  p_error_code text default null,
  p_error_message text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.whatsapp_messages%rowtype;
  v_old_rank integer;
  v_new_rank integer;
  v_at timestamptz := coalesce(p_occurred_at, now());
begin
  if p_meta_message_id is null or btrim(p_meta_message_id) = '' then
    return false;
  end if;
  if p_status not in ('sent', 'delivered', 'read', 'failed') then
    raise exception 'Estado de mensaje de WhatsApp no válido: %', p_status;
  end if;

  select * into m
  from public.whatsapp_messages
  where meta_message_id = p_meta_message_id
  for update;

  if not found then
    return false;
  end if;

  -- 'failed' es final: un estado posterior de Meta no lo cambia.
  if m.status = 'failed' then
    return false;
  end if;

  v_old_rank := case m.status when 'sent' then 1 when 'delivered' then 2 when 'read' then 3 else 0 end;
  v_new_rank := case p_status when 'sent' then 1 when 'delivered' then 2 when 'read' then 3 else 0 end;

  if p_status = 'failed' then
    if m.status <> 'sent' then
      return false;
    end if;
  elsif v_new_rank <= v_old_rank then
    return false;
  end if;

  perform set_config('cuido.allow_readonly_write', 'on', true);

  update public.whatsapp_messages
  set status = p_status,
      status_updated_at = v_at,
      delivered_at = case
        when p_status in ('delivered', 'read') then coalesce(delivered_at, v_at)
        else delivered_at
      end,
      read_at = case when p_status = 'read' then coalesce(read_at, v_at) else read_at end,
      meta_error_code = case when p_status = 'failed' then left(p_error_code, 100) else meta_error_code end,
      error_message = case when p_status = 'failed' then left(p_error_message, 1000) else error_message end
  where id = m.id;

  return true;
end;
$$;

revoke execute on function public.record_whatsapp_message_status(text, text, timestamptz, text, text)
  from public, anon, authenticated;
grant execute on function public.record_whatsapp_message_status(text, text, timestamptz, text, text)
  to service_role;

-- =============================================================================
-- 5. Tablas globales de operador exentas del guard de solo lectura
-- =============================================================================
-- Sin clinic_id y sin datos de clínica. Misma lista vigente (20261015110000) + las dos tablas.

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
    'insurers',
    'mfa_reset_log',
    'whatsapp_templates',
    'whatsapp_webhook_events'
  ]::text[];
$$;
