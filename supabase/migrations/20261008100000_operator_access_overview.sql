-- Período de prueba y suscripciones -- Fase 5 (panel del operador).
--
-- 1. operator_clinic_access_overview(): el estado de acceso de TODAS las
--    clínicas para la lista del operador. clinic_access_state() es interna
--    (ejecutable solo por service_role), así que el panel no puede llamarla
--    directamente; en vez de duplicar su lógica en TypeScript -- dos fuentes
--    de verdad para algo que decide si una clínica puede escribir -- se
--    expone esta función SECURITY DEFINER que se autogatea con
--    is_platform_operator() (mismo patrón que el resto de RPC del operador).
--    Solo devuelve estado, fechas y conteos de la suscripción, que el
--    operador ya puede leer por RLS: no abre ningún dato clínico.
--
-- 2. Se ELIMINA update_clinic_payment_status(): permitía fijar a mano
--    next_payment_due_on -- que desde la Fase 1 es el vencimiento REAL, o sea
--    lo que decide cuándo una clínica pasa a solo lectura -- sin dejar rastro
--    ni pasar por el historial. El vencimiento ahora solo cambia por
--    set_clinic_plan_period (fija el plan) y register_clinic_payment (avanza
--    el vencimiento con un pago contabilizado), ambas con historial.
--    `payment_status` queda como columna vestigial que register_clinic_payment
--    pone en 'al_dia'; ya no interviene en el acceso ni se edita a mano.

create or replace function public.operator_clinic_access_overview()
returns table (
  clinic_id uuid,
  state text,
  due_on date,
  days_to_expiry integer,
  days_to_readonly integer,
  seats_used integer
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
    public.clinic_access_due_on(c.id),
    public.clinic_access_due_on(c.id) - v_today,
    public.clinic_access_due_on(c.id) + 31 - v_today,
    public.clinician_seats_used(c.id)
  from public.clinics c;
end;
$$;

revoke execute on function public.operator_clinic_access_overview() from public, anon;
grant execute on function public.operator_clinic_access_overview() to authenticated;

drop function public.update_clinic_payment_status(uuid, text, date);
