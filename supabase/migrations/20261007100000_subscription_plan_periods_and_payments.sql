-- Período de prueba y suscripciones -- Fase 1, reconciliación con
-- plan-periodo-prueba-y-suscripciones.md.
--
-- 20261006100000 se escribió y aplicó ANTES de poder leer ese plan (el
-- archivo no estaba en la máquina). Esta migración lo reconcilia sin
-- tocar la anterior: agrega lo que el plan define y esa migración no
-- tenía (periodo de facturación, exención, pagos contabilizados, los RPC
-- del operador, estado por_renovar/suspendida) y ajusta dos cosas por
-- decisiones posteriores de José:
--   * la prueba vencida TAMBIÉN tiene 30 días de gracia (el plan decía
--     prueba_vencida = solo lectura inmediata; manda la decisión
--     posterior), así que ese estado no existe: una prueba vencida pasa a
--     vencida_en_gracia igual que un plan pagado;
--   * el cupo de médicos cuenta al admin (ICE Brens: su admin es el
--     médico tratante, la secretaria no consume cupo, otro médico se paga).

-- =============================================================================
-- 1. Columnas
-- =============================================================================

-- Mismo nombre que el plan (plan_started_on). Nada la lee todavía.
alter table public.clinic_subscriptions
  rename column period_started_on to plan_started_on;

alter table public.clinic_subscriptions
  add column billing_period_days integer
    check (billing_period_days is null or billing_period_days in (30, 90, 180, 365)),
  add column access_exempt boolean not null default false;

comment on column public.clinic_subscriptions.billing_period_days is
  'Periodo de facturación del plan pagado (30/90/180/365). Determina la '
  'ventana de recordatorio de renovación (por_renovar): 30 -> 5 días, '
  '90 -> 15, 180 y 365 -> 30, contando el día de vencimiento.';
comment on column public.clinic_subscriptions.access_exempt is
  'Clínica exenta de las reglas de prueba/vencimiento (piloto, demo, '
  'acuerdo especial). Solo el operador la cambia, con historial '
  '(set_clinic_access_exempt).';

-- =============================================================================
-- 2. Historial: tipos de evento del plan
-- =============================================================================

alter table public.clinic_subscription_events
  drop constraint clinic_subscription_events_kind_check;
alter table public.clinic_subscription_events
  add constraint clinic_subscription_events_kind_check
  check (kind in (
    'trial_started', 'trial_extended', 'plan_set', 'exempt_changed',
    'seats_changed', 'backfill'
  ));

-- =============================================================================
-- 3. clinic_payments -- la "contabilización" de pagos
-- =============================================================================
-- RLS: el operador lee todo; el admin de la clínica solo los suyos; sin
-- INSERT/UPDATE/DELETE directo (solo register_clinic_payment) -- mismo
-- patrón que clinic_plan_changes.

create table public.clinic_payments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  amount numeric(12, 2) not null check (amount >= 0),
  paid_on date not null,
  period_days integer not null check (period_days in (30, 90, 180, 365)),
  resulting_due_on date not null,
  note text,
  registered_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);

create index clinic_payments_clinic_idx on public.clinic_payments (clinic_id, paid_on desc);

alter table public.clinic_payments enable row level security;
alter table public.clinic_payments force row level security;

create policy clinic_payments_select
  on public.clinic_payments for select to authenticated
  using (public.is_clinic_admin(clinic_id) or public.is_platform_operator());

grant select on public.clinic_payments to authenticated;
grant select, insert on public.clinic_payments to service_role;

-- =============================================================================
-- 4. Estado de acceso, versión del plan
-- =============================================================================
--   prueba             dentro de la prueba
--   activa             plan vigente, fuera de la ventana de recordatorio
--   por_renovar        plan vigente, dentro de la ventana de recordatorio
--   vencida_en_gracia  vencida (plan O prueba), hasta 30 días después
--   solo_lectura       desde el día 31 después del vencimiento
--   suspendida         clinics.is_active = false (bloqueo total, ya existía)
--   exenta             access_exempt = true: nunca cae en solo lectura
--   sin_plan           sin fila o sin fechas: estado SEGURO, no bloquea
-- Precedencia: sin_plan > suspendida > exenta > fechas.

create or replace function public.clinic_access_state(
  p_clinic_id uuid,
  p_today date default public.dr_today()
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.clinic_subscriptions%rowtype;
  v_active boolean;
  v_due date;
  v_paid boolean;
  v_window integer;
begin
  select * into s from public.clinic_subscriptions where clinic_id = p_clinic_id;
  if not found then
    raise log 'clinic_access_state: la clínica % no tiene fila en clinic_subscriptions', p_clinic_id;
    return 'sin_plan';
  end if;

  select c.is_active into v_active from public.clinics c where c.id = p_clinic_id;
  if v_active is false then
    return 'suspendida';
  end if;

  if s.access_exempt then
    return 'exenta';
  end if;

  v_due := greatest(s.trial_ends_at, s.next_payment_due_on);
  if v_due is null then
    raise log 'clinic_access_state: la clínica % no tiene ninguna fecha de prueba ni de vencimiento', p_clinic_id;
    return 'sin_plan';
  end if;

  v_paid := s.next_payment_due_on is not null
    and (s.trial_ends_at is null or s.next_payment_due_on >= s.trial_ends_at);

  if p_today <= v_due then
    if not v_paid then
      return 'prueba';
    end if;
    v_window := case s.billing_period_days
      when 30 then 5
      when 90 then 15
      when 180 then 30
      when 365 then 30
      else null
    end;
    -- La ventana incluye el día de vencimiento: plan de 30 días que vence
    -- el 31-oct => recordatorio desde el 26-oct (últimos 5 días).
    if v_window is not null and p_today >= v_due - (v_window - 1) then
      return 'por_renovar';
    end if;
    return 'activa';
  elsif p_today <= v_due + 30 then
    return 'vencida_en_gracia';
  else
    return 'solo_lectura';
  end if;
end;
$$;

-- Una clínica suspendida no escribe (el bloqueo total ya lo da RLS para
-- leer; aquí se vuelve consistente para el trigger de la Fase 2).
create or replace function public.is_clinic_writable(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.clinic_access_state(p_clinic_id) not in ('solo_lectura', 'suspendida');
$$;

-- Cupo de médicos: cuentan 'admin' y 'medico'. Decisión de José para ICE
-- Brens: el admin es el médico tratante y ocupa el cupo incluido; la
-- secretaria (recepcion) no consume cupo; cualquier otro médico se paga.
-- Consecuencia asumida: en una clínica CON cupo, un segundo admin también
-- cuenta -- hoy solo ICE tiene cupo (included_clinician_seats no es null).
create or replace function public.clinician_seats_used(p_clinic_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.clinic_members cm
  where cm.clinic_id = p_clinic_id and cm.role in ('admin', 'medico');
$$;

-- get_my_clinic_access: ahora con estado por_renovar. Los recordatorios de
-- renovación son SOLO del admin (decisión 4): al resto del equipo, un plan
-- por_renovar se le muestra como activa.
create or replace function public.get_my_clinic_access()
returns table (
  clinic_id uuid,
  state text,
  days_to_expiry integer,
  days_to_readonly integer,
  seats_used integer,
  seats_included integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_clinic_id uuid;
  v_due date;
  v_today date := public.dr_today();
  v_is_admin boolean;
  v_state text;
begin
  select cm.clinic_id into v_clinic_id
  from public.clinic_members cm
  where cm.user_id = auth.uid()
  limit 1;

  if v_clinic_id is null then
    return;
  end if;

  v_due := public.clinic_access_due_on(v_clinic_id);
  v_is_admin := public.is_clinic_admin(v_clinic_id);
  v_state := public.clinic_access_state(v_clinic_id, v_today);
  if v_state = 'por_renovar' and not v_is_admin then
    v_state := 'activa';
  end if;

  return query
  select
    v_clinic_id,
    v_state,
    case when v_due is null then null else v_due - v_today end,
    case when v_due is null then null else (v_due + 31) - v_today end,
    case when v_is_admin then public.clinician_seats_used(v_clinic_id) end,
    case when v_is_admin then
      (select cs.included_clinician_seats from public.clinic_subscriptions cs where cs.clinic_id = v_clinic_id)
    end;
end;
$$;

-- =============================================================================
-- 5. RPC del operador (reemplazan a renew_clinic_subscription)
-- =============================================================================
-- Mismo patrón que update_clinic_plan: SECURITY DEFINER, se autogatean con
-- is_platform_operator(), historial obligatorio.

drop function public.renew_clinic_subscription(uuid, date, numeric, text);

-- Fija periodo, monto e inicio del plan; vencimiento = inicio + periodo.
create or replace function public.set_clinic_plan_period(
  target_clinic_id uuid,
  p_period_days integer,
  p_amount numeric,
  p_start_on date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_platform_operator() then
    raise exception 'Solo un operador de plataforma puede fijar el plan de una clínica.';
  end if;
  if p_period_days is null or p_period_days not in (30, 90, 180, 365) then
    raise exception 'El periodo debe ser de 30, 90, 180 o 365 días.';
  end if;
  if p_start_on is null then
    raise exception 'La fecha de inicio es requerida.';
  end if;
  if p_amount is not null and p_amount < 0 then
    raise exception 'El monto no puede ser negativo.';
  end if;
  if not exists (select 1 from public.clinics where id = target_clinic_id) then
    raise exception 'Clínica no encontrada.';
  end if;

  insert into public.clinic_subscriptions
    (clinic_id, billing_period_days, price, plan_started_on, next_payment_due_on)
  values
    (target_clinic_id, p_period_days, p_amount, p_start_on, p_start_on + p_period_days)
  on conflict (clinic_id) do update
    set billing_period_days = excluded.billing_period_days,
        price = excluded.price,
        plan_started_on = excluded.plan_started_on,
        next_payment_due_on = excluded.next_payment_due_on,
        updated_at = now();

  insert into public.clinic_subscription_events (clinic_id, kind, details, changed_by)
  values (
    target_clinic_id, 'plan_set',
    jsonb_build_object(
      'period_days', p_period_days, 'amount', p_amount,
      'start_on', p_start_on, 'due_on', p_start_on + p_period_days
    ),
    auth.uid()
  );
end;
$$;

-- Registra un pago y avanza el vencimiento. Regla del plan: nuevo
-- vencimiento = vencimiento anterior + periodo (pagar tarde no regala
-- días, pagar temprano no los quita); si a la fecha del pago la clínica ya
-- había caído en solo lectura, fecha de pago + periodo.
create or replace function public.register_clinic_payment(
  target_clinic_id uuid,
  p_paid_on date,
  p_amount numeric,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.clinic_subscriptions%rowtype;
  v_prev_due date;
  v_base date;
  v_new_due date;
begin
  if not public.is_platform_operator() then
    raise exception 'Solo un operador de plataforma puede registrar un pago.';
  end if;
  if p_paid_on is null then
    raise exception 'La fecha de pago es requerida.';
  end if;
  if p_amount is null or p_amount < 0 then
    raise exception 'El monto del pago es requerido y no puede ser negativo.';
  end if;

  select * into s from public.clinic_subscriptions where clinic_id = target_clinic_id;
  if not found then
    raise exception 'Clínica no encontrada.';
  end if;
  if s.billing_period_days is null then
    raise exception 'Primero fija el periodo del plan (set_clinic_plan_period).';
  end if;

  v_prev_due := greatest(s.trial_ends_at, s.next_payment_due_on);
  if v_prev_due is null or p_paid_on > v_prev_due + 30 then
    v_base := p_paid_on;
  else
    v_base := v_prev_due;
  end if;
  v_new_due := v_base + s.billing_period_days;

  insert into public.clinic_payments
    (clinic_id, amount, paid_on, period_days, resulting_due_on, note, registered_by)
  values
    (target_clinic_id, p_amount, p_paid_on, s.billing_period_days, v_new_due, p_note, auth.uid());

  update public.clinic_subscriptions
    set next_payment_due_on = v_new_due,
        plan_started_on = case when v_base = p_paid_on then p_paid_on else coalesce(plan_started_on, p_paid_on) end,
        payment_status = 'al_dia',
        updated_at = now()
    where clinic_id = target_clinic_id;
end;
$$;

-- Extiende la prueba: desde el fin actual si todavía corre, desde hoy si
-- ya había vencido (extender desde una fecha ya pasada no daría nada).
create or replace function public.extend_clinic_trial(
  target_clinic_id uuid,
  p_days integer,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev date;
  v_new date;
begin
  if not public.is_platform_operator() then
    raise exception 'Solo un operador de plataforma puede extender una prueba.';
  end if;
  if p_days is null or p_days < 1 or p_days > 365 then
    raise exception 'Los días de extensión deben estar entre 1 y 365.';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'El motivo es requerido.';
  end if;
  if not exists (select 1 from public.clinics where id = target_clinic_id) then
    raise exception 'Clínica no encontrada.';
  end if;

  select trial_ends_at into v_prev from public.clinic_subscriptions where clinic_id = target_clinic_id;
  v_new := greatest(coalesce(v_prev, public.dr_today()), public.dr_today()) + p_days;

  insert into public.clinic_subscriptions (clinic_id, trial_ends_at)
  values (target_clinic_id, v_new)
  on conflict (clinic_id) do update
    set trial_ends_at = excluded.trial_ends_at, updated_at = now();

  insert into public.clinic_subscription_events (clinic_id, kind, details, changed_by)
  values (
    target_clinic_id, 'trial_extended',
    jsonb_build_object('previous_trial_ends_at', v_prev, 'new_trial_ends_at', v_new, 'days', p_days, 'reason', p_reason),
    auth.uid()
  );
end;
$$;

create or replace function public.set_clinic_access_exempt(
  target_clinic_id uuid,
  p_exempt boolean,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_platform_operator() then
    raise exception 'Solo un operador de plataforma puede cambiar la exención de una clínica.';
  end if;
  if p_exempt is null then
    raise exception 'Indica si la clínica queda exenta o no.';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'El motivo es requerido.';
  end if;
  if not exists (select 1 from public.clinics where id = target_clinic_id) then
    raise exception 'Clínica no encontrada.';
  end if;

  insert into public.clinic_subscriptions (clinic_id, access_exempt)
  values (target_clinic_id, p_exempt)
  on conflict (clinic_id) do update
    set access_exempt = excluded.access_exempt, updated_at = now();

  insert into public.clinic_subscription_events (clinic_id, kind, details, changed_by)
  values (
    target_clinic_id, 'exempt_changed',
    jsonb_build_object('exempt', p_exempt, 'reason', p_reason),
    auth.uid()
  );
end;
$$;

revoke execute on function public.set_clinic_plan_period(uuid, integer, numeric, date) from public, anon;
revoke execute on function public.register_clinic_payment(uuid, date, numeric, text) from public, anon;
revoke execute on function public.extend_clinic_trial(uuid, integer, text) from public, anon;
revoke execute on function public.set_clinic_access_exempt(uuid, boolean, text) from public, anon;
grant execute on function public.set_clinic_plan_period(uuid, integer, numeric, date) to authenticated;
grant execute on function public.register_clinic_payment(uuid, date, numeric, text) to authenticated;
grant execute on function public.extend_clinic_trial(uuid, integer, text) to authenticated;
grant execute on function public.set_clinic_access_exempt(uuid, boolean, text) to authenticated;
