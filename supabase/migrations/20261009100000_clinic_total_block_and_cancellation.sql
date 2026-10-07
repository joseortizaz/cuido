-- Bloqueo total y cancelación automáticos (estado `bloqueada`).
--
-- Decisión de José (términos v3/v4): a los 90 días en solo lectura la clínica
-- se BLOQUEA por completo y su suscripción se CANCELA, en el mismo momento:
-- vencimiento + 30 (gracia) + 90 (solo lectura) + 1 = vencimiento + 121. Salvo
-- acuerdo con Narnia (el operador difiere el bloqueo). La cancelación inicia
-- el periodo de conservación de 2 años, que SOLO se muestra: ninguna función
-- de aquí borra datos.
--
-- Como el resto del acceso, el estado se DERIVA de fechas (sin cron): un pago
-- que mueve el vencimiento reactiva la clínica al instante.
--
-- El bloqueo se aplica donde ya se aplica la suspensión: las funciones "de
-- clínica activa" que usan las políticas RLS de casi todas las tablas
-- clínicas. Se redefinen con CREATE OR REPLACE (cero políticas reescritas para
-- esas tablas). Además se corrigen las políticas que NUNCA pasaron por esas
-- funciones (lista abajo): entre ellas appointment_surgical_checklist, que
-- hasta hoy tampoco se bloqueaba en una clínica suspendida.

-- =============================================================================
-- 1. Plazos en un solo lugar
-- =============================================================================

create or replace function public.clinic_lifecycle_offsets()
returns table (grace_days integer, readonly_days integer, retention_years integer)
language sql
immutable
set search_path = public
as $$
  select 30, 90, 2;
$$;

comment on function public.clinic_lifecycle_offsets() is
  'Plazos del ciclo de vida de la suscripción: días de gracia tras el '
  'vencimiento, días en solo lectura antes del bloqueo total/cancelación, y '
  'años de conservación desde la cancelación. Cambiar un plazo = cambiar aquí.';

-- =============================================================================
-- 2. Acuerdo del operador (difiere el bloqueo)
-- =============================================================================

alter table public.clinic_subscriptions
  add column block_deferred_until date;

comment on column public.clinic_subscriptions.block_deferred_until is
  'Acuerdo con Narnia: hasta esta fecha (inclusive) la clínica NO pasa a '
  'bloqueada y se queda en solo lectura (donde puede exportar). Pasada la '
  'fecha, el bloqueo se aplica solo. Solo lo fija el operador '
  '(set_clinic_block_agreement); un pago registrado la limpia.';

alter table public.clinic_subscription_events
  drop constraint clinic_subscription_events_kind_check;
alter table public.clinic_subscription_events
  add constraint clinic_subscription_events_kind_check
  check (kind in (
    'trial_started', 'trial_extended', 'plan_set', 'exempt_changed',
    'seats_changed', 'backfill', 'block_agreement'
  ));

create or replace function public.set_clinic_block_agreement(
  target_clinic_id uuid,
  p_until date,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_previous date;
begin
  if not public.is_platform_operator() then
    raise exception 'Solo un operador de plataforma puede pactar un acuerdo de bloqueo.';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'El motivo es requerido.';
  end if;
  if p_until is not null and p_until < public.dr_today() then
    raise exception 'La fecha del acuerdo no puede estar en el pasado.';
  end if;

  select block_deferred_until into v_previous
  from public.clinic_subscriptions where clinic_id = target_clinic_id
  for update;
  if not found then
    raise exception 'Clínica no encontrada.';
  end if;

  update public.clinic_subscriptions
    set block_deferred_until = p_until, updated_at = now()
    where clinic_id = target_clinic_id;

  insert into public.clinic_subscription_events (clinic_id, kind, details, changed_by)
  values (
    target_clinic_id, 'block_agreement',
    jsonb_build_object('previous_until', v_previous, 'new_until', p_until, 'reason', p_reason),
    auth.uid()
  );
end;
$$;

revoke execute on function public.set_clinic_block_agreement(uuid, date, text) from public, anon;
grant execute on function public.set_clinic_block_agreement(uuid, date, text) to authenticated;

-- =============================================================================
-- 3. Fechas del ciclo de vida y estado de acceso
-- =============================================================================

-- Fechas derivadas. blocked_on = primer día bloqueado = cancelación;
-- retention_until = fin del periodo de conservación (informativo: nada se
-- elimina solo). NULL en una clínica exenta o sin fechas.
create or replace function public.clinic_lifecycle_dates(p_clinic_id uuid)
returns table (
  due_on date,
  readonly_from date,
  blocked_on date,
  retention_until date,
  block_deferred_until date
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.clinic_subscriptions%rowtype;
  o record;
  v_due date;
  v_blocked date;
begin
  select * into s from public.clinic_subscriptions where clinic_id = p_clinic_id;
  if not found then
    return;
  end if;
  select * into o from public.clinic_lifecycle_offsets();

  v_due := greatest(s.trial_ends_at, s.next_payment_due_on);
  if v_due is null or s.access_exempt then
    return query select v_due, null::date, null::date, null::date, s.block_deferred_until;
    return;
  end if;

  -- greatest ignora NULL: sin acuerdo vale la fecha calculada.
  v_blocked := greatest(v_due + o.grace_days + o.readonly_days + 1, s.block_deferred_until + 1);

  return query select
    v_due,
    v_due + o.grace_days + 1,
    v_blocked,
    (v_blocked + make_interval(years => o.retention_years))::date,
    s.block_deferred_until;
end;
$$;

-- Estado de acceso: igual que antes y, tras los días de solo lectura, `bloqueada`.
--   solo_lectura  desde vencimiento + 31 hasta el día anterior a blocked_on
--   bloqueada     desde blocked_on (vencimiento + 121, o el día siguiente al
--                 acuerdo si este es posterior): sin lectura ni escritura
-- Precedencia sin cambios: sin_plan > suspendida > exenta > fechas.
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
  o record;
  v_active boolean;
  v_due date;
  v_paid boolean;
  v_window integer;
  v_blocked date;
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

  select * into o from public.clinic_lifecycle_offsets();

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
    if v_window is not null and p_today >= v_due - v_window then
      return 'por_renovar';
    end if;
    return 'activa';
  elsif p_today <= v_due + o.grace_days then
    return 'vencida_en_gracia';
  end if;

  v_blocked := greatest(v_due + o.grace_days + o.readonly_days + 1, s.block_deferred_until + 1);
  if p_today < v_blocked then
    return 'solo_lectura';
  end if;
  return 'bloqueada';
end;
$$;

revoke execute on function public.clinic_lifecycle_dates(uuid) from public, anon, authenticated;
revoke execute on function public.clinic_access_state(uuid, date) from public, anon, authenticated;

-- Una clínica bloqueada tampoco escribe (defensa en profundidad: en la
-- práctica ya ni lee).
create or replace function public.is_clinic_writable(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.clinic_access_state(p_clinic_id) not in ('solo_lectura', 'suspendida', 'bloqueada');
$$;

revoke execute on function public.is_clinic_writable(uuid) from public, anon, authenticated;

-- "Clínica con acceso": activa (no suspendida) y no bloqueada. Se evalúa
-- is_active explícitamente porque clinic_access_state devuelve sin_plan, no
-- suspendida, para una clínica sin fila de suscripción.
create or replace function public.clinic_is_accessible(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select c.is_active and public.clinic_access_state(c.id) <> 'bloqueada'
  from public.clinics c
  where c.id = p_clinic_id;
$$;

revoke execute on function public.clinic_is_accessible(uuid) from public, anon, authenticated;

-- =============================================================================
-- 4. Funciones "de clínica activa" (las que usan las políticas RLS)
-- =============================================================================
-- Mismas firmas y mismo comportamiento + AND clinic_is_accessible: una clínica
-- bloqueada se comporta como una suspendida. is_clinic_member/is_clinic_admin
-- (base) NO cambian: el admin sigue viendo su clínica, el equipo, su
-- suscripción y pagos, para saber por qué y cómo regularizar.

create or replace function public.is_member_of_active_clinic(target_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_clinic_member(target_clinic_id)
    and public.clinic_is_accessible(target_clinic_id);
$$;

create or replace function public.is_clinician_of_active_clinic(target_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_clinic_clinician(target_clinic_id)
    and public.clinic_is_accessible(target_clinic_id);
$$;

create or replace function public.is_billing_staff_of_active_clinic(target_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.clinic_members cm
    join public.clinics c on c.id = cm.clinic_id
    where cm.clinic_id = target_clinic_id
      and cm.user_id = auth.uid()
      and cm.role in ('admin', 'recepcion')
      and c.is_active
  ) and public.clinic_is_accessible(target_clinic_id);
$$;

-- Nueva: admin de una clínica con acceso, para las tablas de configuración
-- que hoy solo usan is_clinic_admin.
create or replace function public.is_admin_of_active_clinic(target_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_clinic_admin(target_clinic_id)
    and public.clinic_is_accessible(target_clinic_id);
$$;

revoke execute on function public.is_admin_of_active_clinic(uuid) from public, anon;
grant execute on function public.is_admin_of_active_clinic(uuid) to authenticated;

-- =============================================================================
-- 5. Políticas que NO pasaban por las funciones "de clínica activa"
-- =============================================================================
-- Detectadas comparando pg_policies de producción. Misma lógica que antes + el
-- AND de clínica con acceso; nada más cambia.

-- 5.1 Lista de verificación quirúrgica (clínico). Hasta hoy tampoco se
-- bloqueaba en una clínica suspendida.
drop policy appointment_surgical_checklist_select on public.appointment_surgical_checklist;
create policy appointment_surgical_checklist_select
  on public.appointment_surgical_checklist for select to authenticated
  using (public.is_clinician_of_active_clinic(clinic_id));

drop policy appointment_surgical_checklist_insert on public.appointment_surgical_checklist;
create policy appointment_surgical_checklist_insert
  on public.appointment_surgical_checklist for insert to authenticated
  with check (public.is_clinician_of_active_clinic(clinic_id));

drop policy appointment_surgical_checklist_update on public.appointment_surgical_checklist;
create policy appointment_surgical_checklist_update
  on public.appointment_surgical_checklist for update to authenticated
  using (public.is_clinician_of_active_clinic(clinic_id))
  with check (public.is_clinician_of_active_clinic(clinic_id));

-- 5.2 Perfil fiscal (RNC, dirección) y secuencias e-CF.
drop policy clinic_fiscal_profiles_select_own_tenant_admin on public.clinic_fiscal_profiles;
create policy clinic_fiscal_profiles_select_own_tenant_admin
  on public.clinic_fiscal_profiles for select to authenticated
  using (public.is_admin_of_active_clinic(clinic_id));

drop policy clinic_ecf_sequences_select_own_tenant_admin on public.clinic_ecf_sequences;
create policy clinic_ecf_sequences_select_own_tenant_admin
  on public.clinic_ecf_sequences for select to authenticated
  using (public.is_admin_of_active_clinic(clinic_id));

-- 5.3 Lotes de importación.
drop policy bulk_import_batches_select_by_admin on public.bulk_import_batches;
create policy bulk_import_batches_select_by_admin
  on public.bulk_import_batches for select to authenticated
  using (public.is_admin_of_active_clinic(clinic_id));

drop policy bulk_import_batches_insert_by_admin on public.bulk_import_batches;
create policy bulk_import_batches_insert_by_admin
  on public.bulk_import_batches for insert to authenticated
  with check (public.is_admin_of_active_clinic(clinic_id));

drop policy bulk_import_batches_update_by_admin on public.bulk_import_batches;
create policy bulk_import_batches_update_by_admin
  on public.bulk_import_batches for update to authenticated
  using (public.is_admin_of_active_clinic(clinic_id))
  with check (public.is_admin_of_active_clinic(clinic_id));

-- 5.4 Concesiones de acceso a especialidades sensibles.
drop policy sensitive_grants_select on public.sensitive_specialty_access_grants;
create policy sensitive_grants_select
  on public.sensitive_specialty_access_grants for select to authenticated
  using (
    public.is_member_of_active_clinic(clinic_id)
    and (public.is_clinic_admin(clinic_id) or granted_to_user_id = auth.uid())
  );

-- 5.5 Preferencias y restricciones de especialidad por médico.
drop policy preferred_specialties_select on public.clinic_member_preferred_specialties;
create policy preferred_specialties_select
  on public.clinic_member_preferred_specialties for select to authenticated
  using (
    public.is_member_of_active_clinic(clinic_id)
    and (
      public.is_clinic_admin(clinic_id)
      or exists (
        select 1 from public.clinic_members cm
        where cm.id = clinic_member_preferred_specialties.clinic_member_id and cm.user_id = auth.uid()
      )
    )
  );

drop policy preferred_specialties_insert on public.clinic_member_preferred_specialties;
create policy preferred_specialties_insert
  on public.clinic_member_preferred_specialties for insert to authenticated
  with check (
    public.is_member_of_active_clinic(clinic_id)
    and exists (
      select 1 from public.clinic_members cm
      where cm.id = clinic_member_preferred_specialties.clinic_member_id and cm.user_id = auth.uid()
    )
  );

drop policy preferred_specialties_delete on public.clinic_member_preferred_specialties;
create policy preferred_specialties_delete
  on public.clinic_member_preferred_specialties for delete to authenticated
  using (
    public.is_member_of_active_clinic(clinic_id)
    and exists (
      select 1 from public.clinic_members cm
      where cm.id = clinic_member_preferred_specialties.clinic_member_id and cm.user_id = auth.uid()
    )
  );

drop policy disabled_specialties_select on public.clinic_member_disabled_specialties;
create policy disabled_specialties_select
  on public.clinic_member_disabled_specialties for select to authenticated
  using (
    public.is_member_of_active_clinic(clinic_id)
    and (
      public.is_clinic_admin(clinic_id)
      or exists (
        select 1 from public.clinic_members cm
        where cm.id = clinic_member_disabled_specialties.clinic_member_id and cm.user_id = auth.uid()
      )
    )
  );

drop policy disabled_specialties_insert on public.clinic_member_disabled_specialties;
create policy disabled_specialties_insert
  on public.clinic_member_disabled_specialties for insert to authenticated
  with check (public.is_admin_of_active_clinic(clinic_id));

drop policy disabled_specialties_delete on public.clinic_member_disabled_specialties;
create policy disabled_specialties_delete
  on public.clinic_member_disabled_specialties for delete to authenticated
  using (public.is_admin_of_active_clinic(clinic_id));

-- =============================================================================
-- 6. Cobertura estructural para CI
-- =============================================================================
-- Toda política pública debe pasar por una función "de clínica activa", ser
-- exclusiva del operador, o estar en esta lista explícita y justificada:
--   clinics, clinic_members       el admin debe ver su clínica y su equipo aun
--                                 bloqueada (saber por qué y a quién llamar)
--   clinic_subscriptions,         ídem: el admin ve su plan y sus pagos para
--   clinic_payments               regularizar (sin datos clínicos)
--   specialty_templates,          catálogos globales, sin datos de ninguna clínica
--   consent_templates
-- Debe devolver CERO filas siempre.
create or replace function public.list_policies_open_when_blocked()
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select p.tablename || '.' || p.policyname
  from pg_policies p
  where p.schemaname = 'public'
    and p.tablename <> all (array[
      'clinics', 'clinic_members', 'clinic_subscriptions', 'clinic_payments',
      'specialty_templates', 'consent_templates'
    ])
    and coalesce(p.qual, '') || coalesce(p.with_check, '') !~ 'of_active_clinic'
    and btrim(coalesce(p.qual, '')) <> 'is_platform_operator()'
  order by 1;
$$;

revoke execute on function public.list_policies_open_when_blocked() from public, anon, authenticated;
grant execute on function public.list_policies_open_when_blocked() to service_role;

-- =============================================================================
-- 7. RPC y panel: días para el bloqueo, fechas de cancelación y conservación
-- =============================================================================

-- Un pago reactiva la clínica y cierra el acuerdo de bloqueo. Mismo cuerpo que
-- antes (20261007100000) + limpiar el acuerdo + gracia desde los plazos.
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
  o record;
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

  select * into o from public.clinic_lifecycle_offsets();

  v_prev_due := greatest(s.trial_ends_at, s.next_payment_due_on);
  if v_prev_due is null or p_paid_on > v_prev_due + o.grace_days then
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
        block_deferred_until = null,
        updated_at = now()
    where clinic_id = target_clinic_id;
end;
$$;

revoke execute on function public.register_clinic_payment(uuid, date, numeric, text) from public, anon;
grant execute on function public.register_clinic_payment(uuid, date, numeric, text) to authenticated;

-- get_my_clinic_access: + days_to_block (0 = primer día bloqueado; un miembro
-- bloqueado igual la puede consultar: lee clinic_members/suscripción, no datos
-- clínicos). Cambia el RETURNS TABLE: DROP + CREATE.
drop function public.get_my_clinic_access();
create function public.get_my_clinic_access()
returns table (
  clinic_id uuid,
  state text,
  days_to_expiry integer,
  days_to_readonly integer,
  seats_used integer,
  seats_included integer,
  days_to_block integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_clinic_id uuid;
  v_today date := public.dr_today();
  v_is_admin boolean;
  v_state text;
  d record;
begin
  select cm.clinic_id into v_clinic_id
  from public.clinic_members cm
  where cm.user_id = auth.uid()
  limit 1;

  if v_clinic_id is null then
    return;
  end if;

  select * into d from public.clinic_lifecycle_dates(v_clinic_id);
  v_is_admin := public.is_clinic_admin(v_clinic_id);
  v_state := public.clinic_access_state(v_clinic_id, v_today);
  if v_state = 'por_renovar' and not v_is_admin then
    v_state := 'activa';
  end if;

  return query
  select
    v_clinic_id,
    v_state,
    case when d.due_on is null then null else d.due_on - v_today end,
    case when d.readonly_from is null then null else d.readonly_from - v_today end,
    case when v_is_admin then public.clinician_seats_used(v_clinic_id) end,
    case when v_is_admin then
      (select cs.included_clinician_seats from public.clinic_subscriptions cs where cs.clinic_id = v_clinic_id)
    end,
    case when d.blocked_on is null then null else d.blocked_on - v_today end;
end;
$$;

revoke execute on function public.get_my_clinic_access() from public, anon;
grant execute on function public.get_my_clinic_access() to authenticated;

-- Panel del operador: + días para el bloqueo, fecha de bloqueo/cancelación, fin
-- de la conservación y acuerdo vigente.
drop function public.operator_clinic_access_overview();
create function public.operator_clinic_access_overview()
returns table (
  clinic_id uuid,
  state text,
  due_on date,
  days_to_expiry integer,
  days_to_readonly integer,
  seats_used integer,
  days_to_block integer,
  blocked_on date,
  retention_until date,
  block_deferred_until date
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today date := public.dr_today();
begin
  if not public.is_platform_operator() then
    raise exception 'Solo un operador de plataforma puede ver el estado de acceso de las clínicas.';
  end if;

  return query
  select
    c.id,
    public.clinic_access_state(c.id, v_today),
    d.due_on,
    d.due_on - v_today,
    d.readonly_from - v_today,
    public.clinician_seats_used(c.id),
    d.blocked_on - v_today,
    d.blocked_on,
    d.retention_until,
    d.block_deferred_until
  from public.clinics c
  left join lateral public.clinic_lifecycle_dates(c.id) d on true;
end;
$$;

revoke execute on function public.operator_clinic_access_overview() from public, anon;
grant execute on function public.operator_clinic_access_overview() to authenticated;
