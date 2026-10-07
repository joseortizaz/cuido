-- Corrige el inicio de la ventana de recordatorio (por_renovar).
--
-- plan-periodo-prueba-y-suscripciones.md es ambiguo: define la ventana como
-- "últimos 5 días, inclusive del día de vencimiento" (eso daría vencimiento
-- - 4), pero su ejemplo concreto dice "plan de 30 días con vencimiento el
-- 31-oct: recordatorio desde el 26-oct" (vencimiento - 5). Se sigue el
-- EJEMPLO, que es lo más específico: la ventana va de (vencimiento -
-- ventana) hasta el día de vencimiento, ambos inclusive. Plan de 30 días ->
-- desde 5 días antes; 90 -> 15; 180 y 365 -> 30. Sin otro cambio.

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
    if v_window is not null and p_today >= v_due - v_window then
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
