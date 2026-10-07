-- Período de prueba y suscripciones -- Fase 1, paso 2: backfill de las
-- clínicas que existían ANTES de las fechas de acceso.
--
-- Mapeo confirmado por José clínica por clínica (por UUID, no por nombre),
-- con fecha base 2026-10-06 (America/Santo_Domingo). Orden obligatorio:
-- 1 esquema/funciones -> 2 ESTE backfill -> 3 trigger de solo lectura
-- (Fase 2). Sin este paso, activar el trigger dejaría a las clínicas
-- existentes sin fechas.
--
-- Idempotente (UPDATE por UUID + evento con NOT EXISTS) y NO-OP en
-- cualquier base que no tenga estas clínicas (CI levanta un Supabase local
-- desde cero). `price` no se toca: queda null en ICE y TEST; el operador lo
-- fija después con set_clinic_plan_period.

-- Plan de 180 días: inicio 2026-10-06, vence 2027-04-04 (inicio + 180),
-- solo lectura desde 2027-05-05. ICE Brens incluye 1 médico (el admin es
-- el médico tratante y ocupa ese cupo); todo médico adicional se paga.
update public.clinic_subscriptions
set plan_started_on = date '2026-10-06',
    billing_period_days = 180,
    next_payment_due_on = date '2026-10-06' + 180,
    trial_ends_at = null,
    included_clinician_seats = 1,
    updated_at = now()
where clinic_id = 'f563b088-17b6-46f9-9679-4029f8f7e7b8'; -- ICE -Brens

-- Las 2 clínicas [TEST]: mismo plan de 180 días, sin límite de cupos.
update public.clinic_subscriptions
set plan_started_on = date '2026-10-06',
    billing_period_days = 180,
    next_payment_due_on = date '2026-10-06' + 180,
    trial_ends_at = null,
    included_clinician_seats = null,
    updated_at = now()
where clinic_id in (
  '1eeb48c7-ab79-4889-9dad-ab04b1b5b264', -- [TEST] Clínica WhatsApp RLS
  'e36b657d-f166-4347-a37d-4aa79b908fe2'  -- [TEST] Clínica Dashboard
);

-- Las 3 restantes: prueba de 14 días desde la fecha base (vence 2026-10-20).
update public.clinic_subscriptions
set trial_ends_at = date '2026-10-06' + 14,
    updated_at = now()
where clinic_id in (
  'bd1c5ea2-03d0-48f0-94e0-2b90a7c92aa2', -- CEGED
  '27f40edf-4670-4bf0-9294-08d1e60a6039', -- Cliniquita
  '978151aa-547b-4be0-99ba-58d49491820a'  -- Centro de salud SS
);

insert into public.clinic_subscription_events (clinic_id, kind, details)
select s.clinic_id, 'backfill',
  jsonb_build_object(
    'base_date', '2026-10-06',
    'trial_ends_at', s.trial_ends_at,
    'plan_started_on', s.plan_started_on,
    'next_payment_due_on', s.next_payment_due_on,
    'billing_period_days', s.billing_period_days,
    'included_clinician_seats', s.included_clinician_seats
  )
from public.clinic_subscriptions s
where s.clinic_id in (
  'f563b088-17b6-46f9-9679-4029f8f7e7b8',
  '1eeb48c7-ab79-4889-9dad-ab04b1b5b264',
  'e36b657d-f166-4347-a37d-4aa79b908fe2',
  'bd1c5ea2-03d0-48f0-94e0-2b90a7c92aa2',
  '27f40edf-4670-4bf0-9294-08d1e60a6039',
  '978151aa-547b-4be0-99ba-58d49491820a'
)
and not exists (
  select 1 from public.clinic_subscription_events e
  where e.clinic_id = s.clinic_id and e.kind = 'backfill'
);
