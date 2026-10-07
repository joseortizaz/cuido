-- Período de prueba y suscripciones -- Fase 1 (datos y funciones).
--
-- Diseño presentado y aprobado antes de escribir esta migración (regla
-- de CLAUDE.md para cambios de RLS/esquema). Esta migración es SOLO la
-- parte aditiva y de lectura: define el estado de acceso de una clínica
-- (prueba / activa / gracia / solo_lectura) a partir de FECHAS, y lo
-- expone. Todavía NO bloquea ninguna escritura -- el trigger de solo
-- lectura es la Fase 2 y va DESPUÉS del backfill de las clínicas
-- existentes (orden obligatorio: 1 esquema/funciones -> 2 backfill ->
-- 3 trigger), para que ninguna clínica existente quede bloqueada por
-- haberse creado antes de que existieran las fechas.
--
-- Reglas (decisiones cerradas): aplican a TODOS los modelos de negocio;
-- el día de vencimiento todavía es válido; hay 30 días de gracia después
-- del vencimiento (la prueba incluida -- una sola regla); desde el día 31
-- la clínica queda en solo lectura. Todas las fechas son de calendario en
-- America/Santo_Domingo, no instantes UTC.

-- =============================================================================
-- 1. Columnas nuevas en clinic_subscriptions
-- =============================================================================

alter table public.clinic_subscriptions
  add column trial_ends_at date,
  add column period_started_on date,
  add column included_clinician_seats integer
    check (included_clinician_seats is null or included_clinician_seats >= 0);

comment on column public.clinic_subscriptions.trial_ends_at is
  'Último día VÁLIDO de la prueba (calendario America/Santo_Domingo).';
comment on column public.clinic_subscriptions.period_started_on is
  'Inicio del plan pagado vigente (calendario America/Santo_Domingo).';
comment on column public.clinic_subscriptions.included_clinician_seats is
  'Médicos incluidos en el plan (rol medico en clinic_members). NULL = '
  'ilimitado. Lo aplica el trigger de cupos (Fase 2); el operador lo sube '
  'con set_clinic_clinician_seats() tras confirmar el pago del médico '
  'adicional.';
-- next_payment_due_on YA existe (platform_operators). Se reusa como la
-- fecha de VENCIMIENTO del plan pagado en vez de crear otra columna con
-- el mismo significado -- dos fuentes de verdad para lo mismo es como se
-- desincroniza un sistema de cobro. payment_status sigue siendo una
-- etiqueta comercial manual del operador: el acceso se deriva SOLO de
-- fechas, nunca de esa etiqueta.
comment on column public.clinic_subscriptions.next_payment_due_on is
  'Fecha de VENCIMIENTO del plan pagado (último día válido). Con '
  'trial_ends_at determina el estado de acceso -- ver clinic_access_state().';

-- =============================================================================
-- 2. clinic_subscription_events -- historial de lo que cambia el acceso
-- =============================================================================
-- Mismo patrón que clinic_plan_changes/clinic_status_changes: solo el
-- operador lee, y solo las funciones SECURITY DEFINER escriben.

create table public.clinic_subscription_events (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  kind text not null
    check (kind in ('trial_started', 'renewal', 'seats_changed', 'backfill')),
  details jsonb not null default '{}'::jsonb
    check (jsonb_typeof(details) = 'object'),
  -- NULL cuando lo origina el sistema (alta de clínica, backfill).
  changed_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create index clinic_subscription_events_clinic_idx
  on public.clinic_subscription_events (clinic_id, created_at desc);

alter table public.clinic_subscription_events enable row level security;
alter table public.clinic_subscription_events force row level security;

create policy clinic_subscription_events_select_by_operator
  on public.clinic_subscription_events for select to authenticated
  using (public.is_platform_operator());
-- Sin política de INSERT/UPDATE/DELETE para `authenticated`: solo las
-- funciones de abajo escriben aquí.

grant select on public.clinic_subscription_events to authenticated;
grant select, insert on public.clinic_subscription_events to service_role;

-- =============================================================================
-- 3. Funciones de estado
-- =============================================================================

-- "Hoy" para una clínica dominicana. date, no timestamptz: el vencimiento
-- es un día de calendario, y a las 11:30 pm del último día válido en
-- Santo Domingo ya son las 3:30 am del día siguiente en UTC.
create or replace function public.dr_today(p_ts timestamptz default now())
returns date
language sql
immutable
set search_path = public
as $$
  select (p_ts at time zone 'America/Santo_Domingo')::date;
$$;

-- Último día válido efectivo: el más tardío entre fin de prueba y
-- vencimiento del plan pagado (greatest ignora los NULL). Así un
-- vencimiento mal cargado ANTERIOR al fin de la prueba nunca le quita a
-- una clínica días que ya tenía.
create or replace function public.clinic_access_due_on(p_clinic_id uuid)
returns date
language sql
stable
security definer
set search_path = public
as $$
  select greatest(cs.trial_ends_at, cs.next_payment_due_on)
  from public.clinic_subscriptions cs
  where cs.clinic_id = p_clinic_id;
$$;

-- Estado de acceso. p_today es parámetro para poder probar los bordes
-- (día de vencimiento, día 30/31 de gracia, cambio de día UTC vs
-- Santo Domingo) con fechas explícitas, sin viajar en el tiempo.
--
--   prueba        -> dentro de la prueba (sin plan pagado vigente)
--   activa        -> dentro del plan pagado
--   gracia        -> vencida, hasta 30 días después del vencimiento
--   solo_lectura  -> desde el día 31 después del vencimiento
--   sin_plan      -> sin fila o sin ninguna fecha: estado SEGURO (no
--                    bloquea por un error de datos) pero se registra
--
-- Deliberadamente ORTOGONAL a clinics.is_active: esa es la suspensión
-- manual del operador y ya la resuelve RLS por su cuenta.
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
  v_due date;
  v_paid boolean;
begin
  select * into s from public.clinic_subscriptions where clinic_id = p_clinic_id;
  if not found then
    raise log 'clinic_access_state: la clínica % no tiene fila en clinic_subscriptions', p_clinic_id;
    return 'sin_plan';
  end if;

  v_due := greatest(s.trial_ends_at, s.next_payment_due_on);
  if v_due is null then
    raise log 'clinic_access_state: la clínica % no tiene ninguna fecha de prueba ni de vencimiento', p_clinic_id;
    return 'sin_plan';
  end if;

  v_paid := s.next_payment_due_on is not null
    and (s.trial_ends_at is null or s.next_payment_due_on >= s.trial_ends_at);

  if p_today <= v_due then
    return case when v_paid then 'activa' else 'prueba' end;
  elsif p_today <= v_due + 30 then
    return 'gracia';
  else
    return 'solo_lectura';
  end if;
end;
$$;

create or replace function public.is_clinic_writable(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.clinic_access_state(p_clinic_id) <> 'solo_lectura';
$$;

-- Médicos que consumen cupo: miembros con rol 'medico'. SUPUESTO POR
-- DEFECTO: el admin NO consume cupo. Si el admin de una clínica con cupo
-- es además su médico tratante y debe contar, basta cambiar la condición
-- a `role in ('admin', 'medico')`.
create or replace function public.clinician_seats_used(p_clinic_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.clinic_members cm
  where cm.clinic_id = p_clinic_id and cm.role = 'medico';
$$;

-- Estado y días de la clínica del usuario actual, para CUALQUIER miembro
-- (resto del equipo: solo estado y días). Los cupos solo se devuelven al
-- admin. NUNCA devuelve montos ni fechas de renovación -- esos viven en
-- clinic_subscriptions, que solo lee el admin (ver política más abajo).
-- days_to_expiry es negativo una vez vencida; days_to_readonly es 0 el
-- primer día de solo lectura.
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

  return query
  select
    v_clinic_id,
    public.clinic_access_state(v_clinic_id, v_today),
    case when v_due is null then null else v_due - v_today end,
    case when v_due is null then null else (v_due + 31) - v_today end,
    case when v_is_admin then public.clinician_seats_used(v_clinic_id) end,
    case when v_is_admin then
      (select cs.included_clinician_seats from public.clinic_subscriptions cs where cs.clinic_id = v_clinic_id)
    end;
end;
$$;

-- Las funciones de estado son internas: ejecutables por service_role (tests,
-- scripts) y por otras funciones SECURITY DEFINER, pero NO por un usuario
-- autenticado, que podría consultar el estado de una clínica ajena. Lo
-- que sí ve cualquier miembro de su propia clínica es get_my_clinic_access().
-- Se revoca de anon/authenticated de forma EXPLÍCITA además de public: en
-- Supabase los privilegios por defecto del esquema public le otorgan
-- EXECUTE a esos roles directamente, así que `from public` solo no basta.
revoke execute on function public.clinic_access_due_on(uuid) from public, anon, authenticated;
revoke execute on function public.clinic_access_state(uuid, date) from public, anon, authenticated;
revoke execute on function public.is_clinic_writable(uuid) from public, anon, authenticated;
revoke execute on function public.clinician_seats_used(uuid) from public, anon, authenticated;
revoke execute on function public.get_my_clinic_access() from public, anon;
grant execute on function public.clinic_access_due_on(uuid) to service_role;
grant execute on function public.clinic_access_state(uuid, date) to service_role;
grant execute on function public.is_clinic_writable(uuid) to service_role;
grant execute on function public.clinician_seats_used(uuid) to service_role;
grant execute on function public.get_my_clinic_access() to authenticated;

-- =============================================================================
-- 4. RPC del operador: renovar una suscripción
-- =============================================================================
-- Mismo patrón que update_clinic_plan: SECURITY DEFINER, se autogatea con
-- is_platform_operator(), deja rastro en el historial. Una renovación es
-- la forma de sacar a una clínica de gracia/solo lectura.

create or replace function public.renew_clinic_subscription(
  target_clinic_id uuid,
  new_due_on date,
  new_price numeric,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_previous_due date;
begin
  if not public.is_platform_operator() then
    raise exception 'Solo un operador de plataforma puede renovar una suscripción.';
  end if;
  if new_due_on is null then
    raise exception 'La nueva fecha de vencimiento es requerida.';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'El motivo es requerido.';
  end if;
  if not exists (select 1 from public.clinics where id = target_clinic_id) then
    raise exception 'Clínica no encontrada.';
  end if;

  v_previous_due := public.clinic_access_due_on(target_clinic_id);

  insert into public.clinic_subscriptions (clinic_id, next_payment_due_on, period_started_on, price, payment_status)
  values (target_clinic_id, new_due_on, public.dr_today(), new_price, 'al_dia')
  on conflict (clinic_id) do update
    set next_payment_due_on = excluded.next_payment_due_on,
        period_started_on = excluded.period_started_on,
        price = coalesce(excluded.price, public.clinic_subscriptions.price),
        payment_status = 'al_dia',
        updated_at = now();

  insert into public.clinic_subscription_events (clinic_id, kind, details, changed_by)
  values (
    target_clinic_id,
    'renewal',
    jsonb_build_object(
      'previous_due_on', v_previous_due,
      'new_due_on', new_due_on,
      'price', new_price,
      'reason', p_reason
    ),
    auth.uid()
  );
end;
$$;

revoke execute on function public.renew_clinic_subscription(uuid, date, numeric, text) from public, anon;
grant execute on function public.renew_clinic_subscription(uuid, date, numeric, text) to authenticated;

-- =============================================================================
-- 5. RLS: montos y renovación visibles SOLO para el admin (+ operador)
-- =============================================================================
-- Antes: cualquier miembro. Recepción y médicos ya no leen esta tabla;
-- ven estado y días vía get_my_clinic_access(). El dashboard de la clínica
-- (que recepción comparte con admin) se ajusta en esta misma PR.

drop policy clinic_subscriptions_select on public.clinic_subscriptions;
create policy clinic_subscriptions_select
  on public.clinic_subscriptions for select to authenticated
  using (public.is_clinic_admin(clinic_id) or public.is_platform_operator());

-- =============================================================================
-- 6. Toda clínica nace con prueba de 14 días
-- =============================================================================
-- Un trigger en `clinics` (no solo create_clinic_with_admin) para que una
-- clínica creada por un script de service_role tampoco quede sin fila de
-- suscripción -- el estado `sin_plan` existe como red de seguridad, pero
-- no debería ser alcanzable por una clínica nueva.

create or replace function public.create_default_clinic_subscription()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trial_ends date := public.dr_today() + 14;
  v_inserted integer;
begin
  insert into public.clinic_subscriptions (clinic_id, trial_ends_at)
  values (new.id, v_trial_ends)
  on conflict (clinic_id) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted > 0 then
    insert into public.clinic_subscription_events (clinic_id, kind, details)
    values (new.id, 'trial_started', jsonb_build_object('trial_ends_at', v_trial_ends));
  end if;

  return new;
end;
$$;

create trigger clinics_create_default_subscription
  after insert on public.clinics
  for each row execute function public.create_default_clinic_subscription();

-- create_clinic_with_admin: el business_model ya NO lo decide el cliente.
-- Se conserva la firma de 3 argumentos (el test de aislamiento y otros
-- scripts la llaman así) pero el valor recibido se IGNORA: toda clínica
-- nace como modelo_c, y el operador la reasigna después con
-- update_clinic_plan(). Los modelos E y F son acuerdos comerciales (canal
-- asociativo, freemium), no algo que un usuario deba autoasignarse. La
-- fila de suscripción con la prueba de 14 días la crea el trigger de
-- arriba.
create or replace function public.create_clinic_with_admin(
  clinic_name text,
  clinic_province text,
  clinic_business_model public.clinic_business_model
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_clinic_id uuid;
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'Debe iniciar sesión para crear una clínica.';
  end if;

  insert into public.clinics (name, province, business_model)
  values (clinic_name, clinic_province, 'modelo_c')
  returning id into new_clinic_id;

  insert into public.clinic_members (clinic_id, user_id, role)
  values (new_clinic_id, caller, 'admin');

  return new_clinic_id;
end;
$$;
