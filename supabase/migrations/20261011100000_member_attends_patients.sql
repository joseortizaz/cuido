-- Cupo de médicos: solo cuentan los administradores que ATIENDEN pacientes, y
-- eso lo fija el OPERADOR (no el propio administrador).
--
-- Decisión de José: en los planes con cupo, cada usuario con rol `medico` y cada
-- `admin` que atienda pacientes ocupa un cupo; recepción y los administradores
-- que no atienden no. Los médicos independientes serán sus propios
-- administradores, así que su administrador SÍ atiende y cuenta.
--
-- Si lo decidiera el administrador, bastaría con marcar "no atiendo" para
-- evadir el cupo. Por eso la columna solo la cambia una RPC del operador y el
-- rol `authenticated` pierde el permiso de escribirla (permisos por columna).
--
-- Sin tablas nuevas (clinic_members ya tiene RLS + FORCE). El valor por defecto
-- es true: ninguna clínica existente cambia de comportamiento (hoy solo ICE
-- tiene cupo y su administrador es el médico tratante).

-- =============================================================================
-- 1. Columna
-- =============================================================================

alter table public.clinic_members
  add column attends_patients boolean not null default true;

comment on column public.clinic_members.attends_patients is
  'Solo importa para role = admin: si atiende pacientes y por tanto ocupa un '
  'cupo de médico. El rol medico siempre cuenta. Solo la cambia el operador '
  '(set_member_attends_patients); authenticated no tiene permiso de escribirla.';

-- =============================================================================
-- 2. Permisos por columna: el admin no puede evadir el cupo
-- =============================================================================
-- Hoy `authenticated` tiene INSERT/UPDATE de tabla completa (privilegios por
-- defecto de Supabase); RLS limita las FILAS, no las columnas. Se reduce a lo
-- que la aplicación usa de verdad (src/app/(clinic)/team/actions.ts): invitar
-- (clinic_id, user_id, role) y cambiar el rol. service_role y las RPC definer
-- conservan todo.

revoke insert, update on public.clinic_members from authenticated, anon;
grant insert (clinic_id, user_id, role) on public.clinic_members to authenticated;
grant update (role) on public.clinic_members to authenticated;

-- =============================================================================
-- 3. Qué cuenta como cupo
-- =============================================================================

create or replace function public.clinician_seats_used(p_clinic_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.clinic_members cm
  where cm.clinic_id = p_clinic_id
    and (cm.role = 'medico' or (cm.role = 'admin' and cm.attends_patients));
$$;

revoke execute on function public.clinician_seats_used(uuid) from public, anon, authenticated;

-- El trigger de cupos ahora razona en términos de CONSUMO (medico, o admin que
-- atiende), no de rol: dispara también al cambiar attends_patients.
create or replace function public.enforce_clinician_seats()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seats integer;
  v_used integer;
  v_new_consumes boolean :=
    new.role = 'medico' or (new.role = 'admin' and new.attends_patients);
  v_old_consumes boolean;
begin
  if not v_new_consumes then
    return new;
  end if;

  -- Ya ocupaba cupo en la misma clínica y lo sigue ocupando: no cambia el consumo.
  if tg_op = 'UPDATE' then
    v_old_consumes :=
      old.role = 'medico' or (old.role = 'admin' and old.attends_patients);
    if v_old_consumes and old.clinic_id = new.clinic_id then
      return new;
    end if;
  end if;

  select cs.included_clinician_seats into v_seats
  from public.clinic_subscriptions cs
  where cs.clinic_id = new.clinic_id
  for update;

  if v_seats is null then
    return new;
  end if;

  -- La fila nueva todavía no cuenta (BEFORE); en un UPDATE de una fila que antes
  -- no consumía tampoco, porque su estado anterior no consumía cupo.
  v_used := public.clinician_seats_used(new.clinic_id);
  if v_used + 1 > v_seats then
    raise exception 'Plan actual incluye % %; contacte a Narnia para ampliar: info@narniats.com / WhatsApp 829-374-8878.',
      v_seats, case when v_seats = 1 then 'médico' else 'médicos' end
      using errcode = 'P0001', hint = 'clinician_seats_exceeded';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_clinician_seats() from public, anon, authenticated;

drop trigger seat_limit on public.clinic_members;
create trigger seat_limit
  before insert or update of role, attends_patients on public.clinic_members
  for each row execute function public.enforce_clinician_seats();

-- =============================================================================
-- 4. RPC del operador
-- =============================================================================
-- Fija si un administrador atiende pacientes. Re-valida el cupo (el trigger):
-- no se puede marcar "atiende" si ya no hay cupo. Funciona también con la
-- clínica en solo lectura o bloqueada (mecanismo de mantenimiento del
-- readonly_guard: es una decisión comercial del operador, no una escritura de
-- la clínica). Queda en el historial.

create or replace function public.set_member_attends_patients(
  target_clinic_id uuid,
  target_user_id uuid,
  p_attends boolean,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.clinic_members%rowtype;
begin
  if not public.is_platform_operator() then
    raise exception 'Solo un operador de plataforma puede cambiar si un administrador atiende pacientes.';
  end if;
  if p_attends is null then
    raise exception 'Indica si atiende pacientes.';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'El motivo es requerido.';
  end if;

  select * into m
  from public.clinic_members cm
  where cm.clinic_id = target_clinic_id and cm.user_id = target_user_id
  for update;
  if not found then
    raise exception 'Miembro no encontrado.';
  end if;
  if m.role <> 'admin' then
    raise exception 'Solo aplica a administradores: un médico siempre ocupa cupo y recepción nunca.';
  end if;
  if m.attends_patients = p_attends then
    return;
  end if;

  perform set_config('cuido.allow_readonly_write', 'on', true);

  update public.clinic_members
    set attends_patients = p_attends
    where id = m.id;

  insert into public.clinic_subscription_events (clinic_id, kind, details, changed_by)
  values (
    target_clinic_id, 'seats_changed',
    jsonb_build_object(
      'member_user_id', target_user_id,
      'previous_attends_patients', m.attends_patients,
      'new_attends_patients', p_attends,
      'reason', p_reason
    ),
    auth.uid()
  );
end;
$$;

revoke execute on function public.set_member_attends_patients(uuid, uuid, boolean, text) from public, anon;
grant execute on function public.set_member_attends_patients(uuid, uuid, boolean, text) to authenticated;
