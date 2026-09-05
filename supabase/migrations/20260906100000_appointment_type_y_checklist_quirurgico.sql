-- Punto 4 de la ronda de enriquecimiento de Ortopedia y Traumatología:
-- tipo de evento de cita (consulta vs. procedimiento quirúrgico) +
-- checklist prequirúrgico. Toca `appointments`, tabla compartida por
-- todas las especialidades -- diseño propuesto y confirmado con el
-- usuario antes de implementar (ver hilo de conversación).
--
-- Explícitamente NO exclusivo de Ortopedia: cualquier especialidad que
-- agende procedimientos quirúrgicos (Cirugía General, Ginecología,
-- etc.) se beneficia igual.

-- =============================================================================
-- 1. appointments.appointment_type
-- =============================================================================
-- Columna additiva en una tabla ya cubierta por RLS
-- (appointments_select/insert/update, 20260824100000_appointments.sql).
-- Ninguna de esas tres políticas referencia columnas específicas -- las
-- tres siguen aplicando igual sin ningún cambio. Pensada para que
-- /appointments pueda diferenciar visualmente (ícono/color) cada fila.

alter table public.appointments
  add column appointment_type text not null default 'consulta'
    check (appointment_type in ('consulta', 'procedimiento_quirurgico'));

comment on column public.appointments.appointment_type is
  'Tipo de evento de la cita -- consulta ambulatoria o procedimiento '
  'quirúrgico. Determina si /appointments muestra el checklist '
  'prequirúrgico (appointment_surgical_checklist) para esa cita.';

-- =============================================================================
-- 2. appointment_surgical_checklist
-- =============================================================================
-- Tabla NUEVA (no columnas sueltas en appointments) -- decisión
-- deliberada, no estética. appointments tiene UNA sola política de
-- UPDATE (appointments_update), gateada a
-- is_billing_staff_of_active_clinic (admin+recepción). El checklist
-- prequirúrgico es contenido clínico/de seguridad (evaluación
-- cardiovascular, analíticas, implantes) que un MÉDICO debe poder
-- marcar -- meterlo en appointments mismo forzaría ampliar
-- appointments_update a is_clinic_clinician, dándole a un médico UPDATE
-- sobre TODA la fila de la cita (fecha, paciente, estado), permiso que
-- hoy es deliberadamente exclusivo de admin/recepción y que no se pidió
-- cambiar. Una tabla propia tiene su propia política de UPDATE sin
-- tocar en absoluto la de appointments.

create table public.appointment_surgical_checklist (
  appointment_id uuid primary key references public.appointments (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  evaluacion_cardiovascular text not null default 'pendiente'
    check (evaluacion_cardiovascular in ('pendiente', 'si', 'no')),
  analiticas_sangre text not null default 'pendiente'
    check (analiticas_sangre in ('pendiente', 'si', 'no')),
  implantes_aprobados_seguro text not null default 'pendiente'
    check (implantes_aprobados_seguro in ('pendiente', 'si', 'no')),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);

comment on table public.appointment_surgical_checklist is
  'Checklist prequirúrgico de seguridad (evaluación cardiovascular, '
  'analíticas de sangre, implantes aprobados por el seguro) para citas '
  'con appointment_type = ''procedimiento_quirurgico''. El estado del '
  'consentimiento informado NO vive aquí -- se consulta en vivo contra '
  '`consents` por patient_id (ver Server Component de /appointments), '
  'porque consents no tiene ni necesita un vínculo a appointments hoy.';

-- El consentimiento informado del checklist deliberadamente NO es
-- columna de esta tabla: se verifica contra la tabla `consents` ya
-- existente (Fase 2) por patient_id de la cita, en vez de un booleano
-- desconectado que el admin/médico marcaría sin verificación real
-- (requisito explícito del usuario). consents no tiene columna
-- appointment_id ni la necesita para esto -- un consentimiento es
-- per-paciente, no per-visita (uno firmado la semana pasada sigue
-- siendo válido hoy), así que filtrar por patient_id ya responde la
-- pregunta real sin ninguna migración de esquema sobre consents.

create trigger appointment_surgical_checklist_set_updated_at
  before update on public.appointment_surgical_checklist
  for each row execute function public.set_updated_at();

alter table public.appointment_surgical_checklist enable row level security;
alter table public.appointment_surgical_checklist force row level security;

-- select/insert/update: is_clinic_clinician (admin+médico) -- contenido
-- clínico, recepción no lo gestiona. Sin política de DELETE -- se
-- corrige actualizando el valor, no borrando la fila (mismo criterio ya
-- usado en el resto del expediente clínico).
create policy appointment_surgical_checklist_select
  on public.appointment_surgical_checklist for select to authenticated
  using (public.is_clinic_clinician(clinic_id));

create policy appointment_surgical_checklist_insert
  on public.appointment_surgical_checklist for insert to authenticated
  with check (public.is_clinic_clinician(clinic_id));

create policy appointment_surgical_checklist_update
  on public.appointment_surgical_checklist for update to authenticated
  using (public.is_clinic_clinician(clinic_id))
  with check (public.is_clinic_clinician(clinic_id));

grant select, insert, update on public.appointment_surgical_checklist to authenticated;

-- =============================================================================
-- 3. Creación automática del checklist al marcar una cita como quirúrgica
-- =============================================================================
-- Ajuste pedido explícitamente por el usuario sobre la propuesta
-- original (que creaba la fila "on-demand", al primer INSERT desde la
-- UI): una cita quirúrgica SIN fila de checklist todavía podría leerse
-- como "no aplica" en vez de "pendiente de completar" -- en seguridad
-- prequirúrgica, la alerta debe existir siempre que la cita es
-- quirúrgica, no depender de que alguien abra el checklist primero.
--
-- security definer porque quien crea/edita la cita (admin/recepción,
-- vía appointments_insert/update) no necesariamente tiene permiso de
-- INSERT directo sobre appointment_surgical_checklist (eso es
-- is_clinic_clinician, no is_billing_staff_of_active_clinic) -- el
-- trigger corre con los privilegios del dueño de la función, no del rol
-- que disparó el INSERT/UPDATE en appointments, así que la fila se
-- crea sin importar qué rol agendó la cirugía.
--
-- Si el tipo cambia de vuelta a 'consulta' después de creado el
-- checklist, la fila se conserva (no se borra) -- decisión explícita
-- del usuario: no hay razón de seguridad para perder el registro de lo
-- que ya se verificó, y conservarla es más simple que limpiarla.

create or replace function public.create_surgical_checklist_if_needed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.appointment_type = 'procedimiento_quirurgico' then
    insert into public.appointment_surgical_checklist (appointment_id, clinic_id)
    values (new.id, new.clinic_id)
    on conflict (appointment_id) do nothing;
  end if;
  return new;
end;
$$;

create trigger appointments_create_surgical_checklist
  after insert or update of appointment_type on public.appointments
  for each row execute function public.create_surgical_checklist_if_needed();

-- =============================================================================
-- 4. Consentimiento quirúrgico específico (opcional, aprobado por el usuario)
-- =============================================================================
-- Fila de datos pura sobre consent_templates (catálogo global ya
-- existente, Fase 2) -- cero riesgo, cero cambio de esquema. Permite que
-- la UI del checklist distinga "hay un consentimiento firmado" de "hay
-- un consentimiento QUIRÚRGICO firmado" -- más preciso que solo mirar
-- si existe cualquier consents.status = 'firmado' para el paciente.
-- Mismo aviso que la plantilla sembrada en 20260821070000_informed_consent.sql:
-- BORRADOR, pendiente de revisión legal antes de uso con pacientes reales.

insert into public.consent_templates (code, title, body) values (
  'consentimiento_quirurgico',
  'Consentimiento informado para procedimiento quirúrgico',
  'Declaro que he sido informado(a), en un lenguaje claro y comprensible, sobre el procedimiento quirúrgico propuesto, su objetivo, la técnica a emplear, los riesgos previstos (incluyendo los relacionados con la anestesia), las complicaciones posibles, los beneficios esperados y las alternativas disponibles, incluyendo la de no realizar el procedimiento. He tenido la oportunidad de hacer preguntas y estas fueron respondidas a mi satisfacción. Autorizo de forma libre y voluntaria la realización del procedimiento quirúrgico descrito.

[Texto borrador -- pendiente de revisión legal antes de uso con pacientes reales.]'
);
