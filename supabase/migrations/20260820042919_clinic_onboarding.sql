-- Fase 1 (kickoff) — RPC de autoprovisión de clínica.
--
-- Fase 0 dejó `clinics`/`clinic_members` sin política de INSERT para
-- `authenticated` a propósito: el alta de una clínica nueva necesita un
-- proceso controlado, no un INSERT libre. Esta función es ese proceso.
--
-- SECURITY DEFINER, pero el usuario NUNCA puede pasar un user_id ni un rol:
-- ambos los fija la función a partir de auth.uid() y al valor fijo 'admin'.
-- No hay forma de que un usuario se autoasigne a la clínica de otro ni se
-- ponga un rol distinto a admin al crear su propia clínica. El tenant sigue
-- sin derivarse jamás de un valor enviado por el cliente sin control.

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
  values (clinic_name, clinic_province, clinic_business_model)
  returning id into new_clinic_id;

  insert into public.clinic_members (clinic_id, user_id, role)
  values (new_clinic_id, caller, 'admin');

  return new_clinic_id;
end;
$$;

comment on function public.create_clinic_with_admin is
  'Único camino para que un usuario autenticado cree una clínica: crea la '
  'fila en clinics y se autoasigna como admin en clinic_members, en la '
  'misma transacción. user_id y role nunca vienen del cliente.';

revoke execute on function public.create_clinic_with_admin(text, text, public.clinic_business_model) from public;
grant execute on function public.create_clinic_with_admin(text, text, public.clinic_business_model) to authenticated;
