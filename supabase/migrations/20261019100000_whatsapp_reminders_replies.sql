-- WhatsApp Fase 2B: envío de los recordatorios, respuestas del paciente y baja.
--
-- Funciones SECURITY DEFINER que solo ejecuta el servidor (service_role); ningún usuario las llama.
-- Sin tablas nuevas: usan las de 20261018100000. Cada una abre el bypass de mantenimiento de la
-- transacción (cuido.allow_readonly_write) SOLO donde registrar el hecho no debe depender de que la
-- clínica esté al día: que se mandó un mensaje, que el paciente respondió, que el paciente se dio de
-- baja. Lo que SÍ depende de que la clínica pueda escribir (cambiar el estado de la cita) se hace
-- ANTES de abrir el bypass y solo si is_clinic_writable().
--
--   record_reminder_send        registra el mensaje enviado (o el fallo) y cierra el recordatorio.
--   apply_reminder_response     «Confirmar» / «Cancelar»: actualiza la cita (si la clínica puede
--                               escribir) y deja la respuesta en el recordatorio.
--   revoke_whatsapp_consent_by_phone  BAJA: revoca todos los consentimientos de ese teléfono.
--   expire_stuck_appointment_reminders  recordatorios que quedaron «en_envio» sin resultado
--                               (el proceso se cortó) pasan a «fallido»; NUNCA se reenvían solos, para
--                               no mandar el mismo recordatorio dos veces.

-- =============================================================================
-- 1. record_reminder_send
-- =============================================================================

create or replace function public.record_reminder_send(
  p_reminder_id uuid,
  p_ok boolean,
  p_meta_message_id text,
  p_error text,
  p_to_phone text,
  p_template_name text,
  p_template_language text,
  p_variables jsonb,
  p_environment text,
  p_meta_app_id text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.appointment_reminders%rowtype;
  a public.appointments%rowtype;
  v_message_id uuid;
begin
  select * into r from public.appointment_reminders where id = p_reminder_id for update;
  if not found then
    raise exception 'Recordatorio no encontrado';
  end if;
  -- Idempotente: un recordatorio ya cerrado no se vuelve a registrar.
  if r.status <> 'en_envio' then
    return r.whatsapp_message_id;
  end if;

  select * into a from public.appointments where id = r.appointment_id;

  perform set_config('cuido.allow_readonly_write', 'on', true);

  insert into public.whatsapp_messages (
    clinic_id, patient_id, appointment_id, to_phone_number, template_name, template_language,
    template_variables, environment, meta_app_id, status, meta_message_id, error_message,
    sent_by, purpose
  )
  values (
    r.clinic_id, a.patient_id, r.appointment_id, p_to_phone, p_template_name, p_template_language,
    coalesce(p_variables, '[]'::jsonb), p_environment, p_meta_app_id,
    case when p_ok then 'sent' else 'failed' end,
    case when p_ok then p_meta_message_id else null end,
    case when p_ok then null else left(coalesce(p_error, 'Error desconocido'), 1000) end,
    null, 'recordatorio_cita'
  )
  returning id into v_message_id;

  update public.appointment_reminders
  set status = case when p_ok then 'enviado' else 'fallido' end,
      sent_at = case when p_ok then now() else null end,
      whatsapp_message_id = v_message_id,
      skip_reason = case when p_ok then null else left(coalesce(p_error, 'Error desconocido'), 200) end
  where id = r.id;

  return v_message_id;
end;
$$;

-- =============================================================================
-- 2. apply_reminder_response
-- =============================================================================
-- Devuelve: 'aplicada' (la cita cambió de estado), 'sin_cambio' (la cita ya estaba en otro estado),
-- 'clinica_solo_lectura' (la respuesta se registró pero la cita no se tocó), 'telefono_distinto'
-- (el que responde no es el del consentimiento: se ignora) o 'no_encontrado'.
-- Un paciente puede cambiar de opinión: la última respuesta queda registrada, pero la cita solo se
-- mueve en el sentido permitido (pendiente -> confirmada; pendiente/confirmada -> cancelada).

create or replace function public.apply_reminder_response(
  p_reminder_id uuid,
  p_response text,
  p_from_phone text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.appointment_reminders%rowtype;
  a public.appointments%rowtype;
  c public.patient_messaging_consents%rowtype;
  v_result text := 'sin_cambio';
begin
  if p_response not in ('confirmar', 'cancelar') then
    raise exception 'Respuesta no válida: %', p_response;
  end if;

  select * into r from public.appointment_reminders where id = p_reminder_id for update;
  if not found then
    return 'no_encontrado';
  end if;

  -- Defensa en profundidad: quien responde debe ser el teléfono al que se envió el recordatorio.
  if p_from_phone is not null then
    select * into c from public.patient_messaging_consents where id = r.consent_id;
    if not found or c.phone_e164 is distinct from p_from_phone then
      return 'telefono_distinto';
    end if;
  end if;

  select * into a from public.appointments where id = r.appointment_id for update;
  if found then
    if public.is_clinic_writable(a.clinic_id) then
      if p_response = 'confirmar' and a.status = 'pendiente' then
        update public.appointments set status = 'confirmada' where id = a.id;
        v_result := 'aplicada';
      elsif p_response = 'cancelar' and a.status in ('pendiente', 'confirmada') then
        update public.appointments set status = 'cancelada' where id = a.id;
        v_result := 'aplicada';
      end if;
    else
      v_result := 'clinica_solo_lectura';
    end if;
  end if;

  -- Registrar lo que respondió el paciente nunca depende de que la clínica esté al día.
  perform set_config('cuido.allow_readonly_write', 'on', true);
  update public.appointment_reminders
  set response = p_response, responded_at = now()
  where id = r.id;

  return v_result;
end;
$$;

-- =============================================================================
-- 3. revoke_whatsapp_consent_by_phone
-- =============================================================================
-- BAJA: revoca TODOS los consentimientos activos de ese teléfono (un teléfono familiar compartido
-- queda fuera de los recordatorios de todos, lo conservador). Devuelve cuántos revocó.

create or replace function public.revoke_whatsapp_consent_by_phone(
  p_phone text,
  p_source text default 'baja_paciente'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if p_phone is null or p_phone !~ '^[+][1-9][0-9]{7,14}$' then
    return 0;
  end if;

  -- La baja del paciente se respeta siempre, aunque la clínica esté en solo lectura.
  perform set_config('cuido.allow_readonly_write', 'on', true);
  update public.patient_messaging_consents
  set revoked_at = now(), revoke_source = p_source
  where phone_e164 = p_phone and revoked_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- =============================================================================
-- 4. expire_stuck_appointment_reminders
-- =============================================================================

create or replace function public.expire_stuck_appointment_reminders(
  p_older_than interval default interval '1 hour'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  perform set_config('cuido.allow_readonly_write', 'on', true);
  update public.appointment_reminders
  set status = 'fallido', skip_reason = 'sin_resultado'
  where status = 'en_envio' and claimed_at < now() - p_older_than;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- =============================================================================
-- Permisos: solo el servidor
-- =============================================================================

revoke execute on function public.record_reminder_send(uuid, boolean, text, text, text, text, text, jsonb, text, text)
  from public, anon, authenticated;
grant execute on function public.record_reminder_send(uuid, boolean, text, text, text, text, text, jsonb, text, text)
  to service_role;

revoke execute on function public.apply_reminder_response(uuid, text, text) from public, anon, authenticated;
grant execute on function public.apply_reminder_response(uuid, text, text) to service_role;

revoke execute on function public.revoke_whatsapp_consent_by_phone(text, text) from public, anon, authenticated;
grant execute on function public.revoke_whatsapp_consent_by_phone(text, text) to service_role;

revoke execute on function public.expire_stuck_appointment_reminders(interval) from public, anon, authenticated;
grant execute on function public.expire_stuck_appointment_reminders(interval) to service_role;
