-- Período de prueba y suscripciones -- Fase 2: bloqueo REAL de escritura en
-- modo solo lectura, y cupos de médicos.
--
-- Diseño aprobado antes de implementar. Orden obligatorio cumplido: esquema
-- y funciones (20261006/20261007100000) -> backfill (20261007110000) ->
-- ESTE trigger. Reglas: una clínica en `solo_lectura` (o `suspendida`) no
-- puede escribir; leer y descargar quedan intactos.
--
-- Un TRIGGER genérico y no 41 políticas reescritas: un solo punto de
-- lógica, cero cambio en las políticas ya probadas, y frena también a las
-- RPC SECURITY DEFINER (p. ej. generate_fiscal_document -> la emisión de
-- e-CF queda bloqueada sin código extra) y a la Edge Function sign-consent
-- (service_role) -- justamente lo que NO debe poder esquivar el bloqueo.

-- =============================================================================
-- 1. El guard
-- =============================================================================
-- AFTER ... FOR EACH ROW, no BEFORE, a propósito: varias tablas derivan
-- clinic_id en un trigger BEFORE INSERT (set_clinic_id_from_patient, etc.)
-- que se ejecuta en orden alfabético respecto a cualquier otro BEFORE. Un
-- guard BEFORE podría correr ANTES de esa derivación y mirar el clinic_id
-- que mandó el cliente: bastaría pasar el id de una clínica con acceso para
-- escribir en una en solo lectura (RLS valida la fila FINAL, así que no lo
-- impediría). Un guard AFTER ve siempre la fila definitiva.
--
-- SECURITY DEFINER porque is_clinic_writable() no es ejecutable por
-- `authenticated` (es interna).

create or replace function public.enforce_clinic_writable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinic_id uuid;
  v_old_clinic_id uuid;
begin
  -- Bypass EXPLÍCITO y solo por GUC de transacción: lo fijan migraciones o
  -- mantenimiento (`set local cuido.allow_readonly_write = 'on'`). No hay
  -- bypass por rol: service_role y las RPC definer son exactamente lo que
  -- debe quedar bloqueado. Un cliente PostgREST no puede fijar este GUC.
  if current_setting('cuido.allow_readonly_write', true) = 'on' then
    return null;
  end if;

  -- UPDATE/DELETE disparados por OTRO trigger (pg_trigger_depth() > 1): son
  -- acciones de integridad referencial -- ON DELETE CASCADE al eliminar la
  -- clínica o un usuario, ON DELETE SET NULL sobre whatsapp_messages -- no
  -- una escritura de un usuario, y bloquearlas impediría eliminar una
  -- clínica en solo lectura. Los INSERT nunca se exentan. Riesgo asumido:
  -- una escritura futura hecha desde dentro de otro trigger quedaría exenta;
  -- hoy ningún trigger de negocio modifica filas de otras tablas guardadas.
  if tg_op in ('UPDATE', 'DELETE') and pg_trigger_depth() > 1 then
    return null;
  end if;

  if tg_op = 'DELETE' then
    v_clinic_id := old.clinic_id;
  else
    v_clinic_id := new.clinic_id;
    if tg_op = 'UPDATE' then
      v_old_clinic_id := old.clinic_id;
    end if;
  end if;

  -- clinic_id nulo (whatsapp_messages de prueba del operador): no hay
  -- clínica a la que aplicar el bloqueo.
  if v_clinic_id is not null and not public.is_clinic_writable(v_clinic_id) then
    raise exception 'La clínica está en modo solo lectura. Contacte a Narnia Tech Solution: info@narniats.com / WhatsApp 829-374-8878.'
      using errcode = 'P0001', hint = 'clinic_readonly';
  end if;
  if v_old_clinic_id is not null and v_old_clinic_id is distinct from v_clinic_id
     and not public.is_clinic_writable(v_old_clinic_id) then
    raise exception 'La clínica está en modo solo lectura. Contacte a Narnia Tech Solution: info@narniats.com / WhatsApp 829-374-8878.'
      using errcode = 'P0001', hint = 'clinic_readonly';
  end if;

  return null;
end;
$$;

revoke execute on function public.enforce_clinic_writable() from public, anon, authenticated;

-- =============================================================================
-- 2. Lista EXPLÍCITA de tablas sin guard (única fuente de verdad)
-- =============================================================================
-- Con clinic_id pero exentas: las escribe el operador por RPC, y una clínica
-- en solo lectura debe poder renovarse. Sin clinic_id: cada una con su razón.
--   clinics                -- set_clinic_active_status / update_clinic_plan
--                             deben seguir funcionando.
--   fiscal_document_items  -- hija de fiscal_documents: authenticated solo
--                             tiene SELECT y solo la RPC definer la escribe,
--                             insertando antes el padre, que SÍ tiene guard.
--   specialty_templates, consent_templates, platform_operators
--                          -- catálogos globales, sin datos de clínica.
-- Una tabla nueva debe llamar a attach_readonly_guard() en SU migración o
-- agregarse aquí con una decisión escrita: el test de CI lo exige.

create or replace function public.readonly_guard_exempt_tables()
returns text[]
language sql
immutable
as $$
  select array[
    'clinic_subscriptions',
    'clinic_subscription_events',
    'clinic_payments',
    'clinic_plan_changes',
    'clinic_status_changes',
    'clinic_internal_notes',
    'clinics',
    'fiscal_document_items',
    'specialty_templates',
    'consent_templates',
    'platform_operators'
  ]::text[];
$$;

create or replace function public.attach_readonly_guard(p_table regclass)
returns void
language plpgsql
as $$
begin
  execute format('drop trigger if exists readonly_guard on %s', p_table);
  execute format(
    'create trigger readonly_guard after insert or update or delete on %s '
    'for each row execute function public.enforce_clinic_writable()',
    p_table
  );
end;
$$;

revoke execute on function public.attach_readonly_guard(regclass) from public, anon, authenticated;

-- Adjunta el guard a TODA tabla pública con columna clinic_id que no esté
-- exenta (hoy 20).
do $$
declare
  r record;
begin
  for r in
    select c.table_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public'
      and c.column_name = 'clinic_id'
      and t.table_type = 'BASE TABLE'
      and c.table_name <> all (public.readonly_guard_exempt_tables())
  loop
    perform public.attach_readonly_guard(format('public.%I', r.table_name)::regclass);
  end loop;
end;
$$;

-- Para el test de CI: toda tabla pública sin guard y que no esté en la lista
-- explícita. Debe devolver CERO filas siempre.
create or replace function public.list_unguarded_tables()
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select c.relname::text
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')
    and c.relname <> all (public.readonly_guard_exempt_tables())
    and not exists (
      select 1 from pg_trigger t
      where t.tgrelid = c.oid and not t.tgisinternal and t.tgname = 'readonly_guard'
    )
  order by 1;
$$;

revoke execute on function public.list_unguarded_tables() from public, anon, authenticated;
grant execute on function public.list_unguarded_tables() to service_role;

-- =============================================================================
-- 3. Cupos de médicos
-- =============================================================================
-- BEFORE INSERT y BEFORE UPDATE OF role en clinic_members: cubre
-- inviteMember y los cambios de rol, no solo el formulario (la UI es
-- cortesía; esta es la barrera real). Cuentan 'admin' y 'medico' (ver
-- clinician_seats_used). clinic_members no tiene columna `active`: los
-- miembros se eliminan, no se desactivan.
--
-- Serializado con SELECT ... FOR UPDATE sobre la fila de suscripción: dos
-- invitaciones simultáneas no pueden colarse las dos en el último cupo.

create or replace function public.enforce_clinician_seats()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seats integer;
  v_used integer;
begin
  if new.role not in ('admin', 'medico') then
    return new;
  end if;
  -- admin <-> medico en la misma clínica no cambia el consumo.
  if tg_op = 'UPDATE' and old.role in ('admin', 'medico') and old.clinic_id = new.clinic_id then
    return new;
  end if;

  select cs.included_clinician_seats into v_seats
  from public.clinic_subscriptions cs
  where cs.clinic_id = new.clinic_id
  for update;

  if v_seats is null then
    return new;
  end if;

  -- La fila nueva todavía no cuenta (BEFORE); en un UPDATE desde recepcion
  -- tampoco, porque su rol anterior no consumía cupo.
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

create trigger seat_limit
  before insert or update of role on public.clinic_members
  for each row execute function public.enforce_clinician_seats();

-- El operador sube el cupo tras confirmar el pago del médico adicional.
-- NULL = ilimitado.
create or replace function public.set_clinic_clinician_seats(
  target_clinic_id uuid,
  p_seats integer,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_previous integer;
begin
  if not public.is_platform_operator() then
    raise exception 'Solo un operador de plataforma puede cambiar el cupo de médicos.';
  end if;
  if p_seats is not null and p_seats < 0 then
    raise exception 'El cupo no puede ser negativo.';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'El motivo es requerido.';
  end if;
  if not exists (select 1 from public.clinics where id = target_clinic_id) then
    raise exception 'Clínica no encontrada.';
  end if;

  select included_clinician_seats into v_previous
  from public.clinic_subscriptions where clinic_id = target_clinic_id;

  insert into public.clinic_subscriptions (clinic_id, included_clinician_seats)
  values (target_clinic_id, p_seats)
  on conflict (clinic_id) do update
    set included_clinician_seats = excluded.included_clinician_seats, updated_at = now();

  insert into public.clinic_subscription_events (clinic_id, kind, details, changed_by)
  values (
    target_clinic_id, 'seats_changed',
    jsonb_build_object('previous_seats', v_previous, 'new_seats', p_seats, 'reason', p_reason),
    auth.uid()
  );
end;
$$;

revoke execute on function public.set_clinic_clinician_seats(uuid, integer, text) from public, anon;
grant execute on function public.set_clinic_clinician_seats(uuid, integer, text) to authenticated;
