-- Fase 1 — Rol "operador de plataforma" (Nivel 1): gestión operativa/
-- comercial de clínicas, SIN acceso a datos clínicos de pacientes.
--
-- Diseño acordado con el usuario antes de escribir esta migración (ver
-- hilo de conversación): tablas nuevas de negocio + historial obligatorio
-- vía RPC dedicadas, más un endurecimiento de RLS en las tablas clínicas
-- existentes para que una clínica desactivada quede realmente bloqueada
-- para sus propios miembros — no solo oculta en la UI.
--
-- No se toca ninguna migración histórica: todo lo que sigue son ALTER/
-- CREATE OR REPLACE/DROP+CREATE POLICY nuevos sobre objetos existentes.

-- =============================================================================
-- 1. platform_operators — presencia en la tabla = es operador.
-- =============================================================================
-- `role` como texto (no booleano) a propósito: hoy solo existe
-- 'operador_nivel_1', deja espacio para un Nivel 2 futuro sin migrar el
-- tipo de columna.

create table public.platform_operators (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'operador_nivel_1' check (role in ('operador_nivel_1')),
  created_at timestamptz not null default now()
);

comment on table public.platform_operators is
  'Rol de plataforma (Nivel 1: gestión operativa/comercial, SIN acceso a '
  'datos clínicos). Se otorga EXCLUSIVAMENTE vía service_role '
  '(scripts/grant-platform-operator.ts) -- nunca autoservicio, mismo '
  'principio que create_clinic_with_admin usa para evitar auto-escalamiento.';

alter table public.platform_operators enable row level security;
alter table public.platform_operators force row level security;
-- Deliberadamente SIN ninguna política para `authenticated`: deny-by-
-- default total. Todo acceso pasa por is_platform_operator() abajo, que
-- ve esta tabla con privilegios elevados (SECURITY DEFINER).

grant select, insert, update, delete on public.platform_operators to service_role;

create or replace function public.is_platform_operator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.platform_operators po where po.user_id = auth.uid()
  );
$$;

revoke execute on function public.is_platform_operator() from public;
grant execute on function public.is_platform_operator() to authenticated;

-- =============================================================================
-- 2. clinics.is_active — el interruptor real de "clínica desactivada".
-- =============================================================================

alter table public.clinics add column is_active boolean not null default true;

-- Endurecimiento de permisos: hoy clinics_update_own_tenant_admin permite
-- a un admin de clínica actualizar TODA la fila de su clínica (incluido
-- business_model), aunque ninguna pantalla lo expone todavía. Con este
-- feature, cambiar plan/estado activo debe ser EXCLUSIVO del operador vía
-- RPC. Grant a nivel de columna (nativo de Postgres): el admin conserva
-- poder editar nombre/provincia de su propia clínica (RLS ya lo scopea a
-- la suya), pero business_model/is_active quedan fuera de su alcance a
-- nivel de permisos, no solo de UI. service_role conserva UPDATE completo.
revoke update on public.clinics from authenticated;
grant update (name, province) on public.clinics to authenticated;

-- =============================================================================
-- 3. Helpers "de clínica activa" — capa nueva, NO se mete dentro de
-- is_clinic_member/is_clinic_admin (esas siguen igual: una clínica
-- desactivada debe seguir siendo VISIBLE para su propio admin -- si no,
-- ni se enteraría de que la desactivaron -- y él mismo debe poder seguir
-- viendo el roster de su equipo). Solo los datos CLÍNICOS se bloquean.
-- =============================================================================

create or replace function public.is_member_of_active_clinic(target_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_clinic_member(target_clinic_id)
    and exists (select 1 from public.clinics c where c.id = target_clinic_id and c.is_active);
$$;

create or replace function public.is_clinician_of_active_clinic(target_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_clinic_clinician(target_clinic_id)
    and exists (select 1 from public.clinics c where c.id = target_clinic_id and c.is_active);
$$;

revoke execute on function public.is_member_of_active_clinic(uuid) from public;
revoke execute on function public.is_clinician_of_active_clinic(uuid) from public;
grant execute on function public.is_member_of_active_clinic(uuid) to authenticated;
grant execute on function public.is_clinician_of_active_clinic(uuid) to authenticated;

-- Operadores NO necesitan bypass en las políticas de abajo: nunca tienen
-- fila en clinic_members, así que is_clinic_member()/is_clinic_clinician()
-- ya les da `false` de por sí -- consistente con "SIN acceso a datos
-- clínicos" (ni de clínicas activas, mucho menos de las desactivadas).

-- Reemplazo (DROP + CREATE, mismo nombre) de las 14 políticas de las 5
-- tablas clínicas -- únicamente cambia la función usada, nada más de la
-- lógica. No afecta la prueba de aislamiento entre tenants: esa prueba
-- nunca desactiva ninguna clínica, así que is_member_of_active_clinic se
-- comporta idéntico a is_clinic_member en ese escenario (es un AND
-- agregado, no un reemplazo del scoping por tenant).

drop policy patients_select_own_tenant on public.patients;
create policy patients_select_own_tenant
  on public.patients for select to authenticated
  using (public.is_member_of_active_clinic(clinic_id));

drop policy patients_insert_own_tenant on public.patients;
create policy patients_insert_own_tenant
  on public.patients for insert to authenticated
  with check (public.is_member_of_active_clinic(clinic_id));

drop policy patients_update_own_tenant on public.patients;
create policy patients_update_own_tenant
  on public.patients for update to authenticated
  using (public.is_member_of_active_clinic(clinic_id))
  with check (public.is_member_of_active_clinic(clinic_id));

drop policy encounters_select_own_tenant on public.encounters;
create policy encounters_select_own_tenant
  on public.encounters for select to authenticated
  using (public.is_member_of_active_clinic(clinic_id));

drop policy encounters_insert_by_clinician on public.encounters;
create policy encounters_insert_by_clinician
  on public.encounters for insert to authenticated
  with check (public.is_clinician_of_active_clinic(clinic_id));

drop policy encounters_update_by_clinician on public.encounters;
create policy encounters_update_by_clinician
  on public.encounters for update to authenticated
  using (public.is_clinician_of_active_clinic(clinic_id))
  with check (public.is_clinician_of_active_clinic(clinic_id));

drop policy vital_signs_select_own_tenant on public.vital_signs;
create policy vital_signs_select_own_tenant
  on public.vital_signs for select to authenticated
  using (public.is_member_of_active_clinic(clinic_id));

drop policy vital_signs_insert_by_clinician on public.vital_signs;
create policy vital_signs_insert_by_clinician
  on public.vital_signs for insert to authenticated
  with check (public.is_clinician_of_active_clinic(clinic_id));

drop policy allergies_select_own_tenant on public.allergies;
create policy allergies_select_own_tenant
  on public.allergies for select to authenticated
  using (public.is_member_of_active_clinic(clinic_id));

drop policy allergies_insert_by_clinician on public.allergies;
create policy allergies_insert_by_clinician
  on public.allergies for insert to authenticated
  with check (public.is_clinician_of_active_clinic(clinic_id));

drop policy allergies_update_by_clinician on public.allergies;
create policy allergies_update_by_clinician
  on public.allergies for update to authenticated
  using (public.is_clinician_of_active_clinic(clinic_id))
  with check (public.is_clinician_of_active_clinic(clinic_id));

drop policy medications_select_own_tenant on public.medications;
create policy medications_select_own_tenant
  on public.medications for select to authenticated
  using (public.is_member_of_active_clinic(clinic_id));

drop policy medications_insert_by_clinician on public.medications;
create policy medications_insert_by_clinician
  on public.medications for insert to authenticated
  with check (public.is_clinician_of_active_clinic(clinic_id));

drop policy medications_update_by_clinician on public.medications;
create policy medications_update_by_clinician
  on public.medications for update to authenticated
  using (public.is_clinician_of_active_clinic(clinic_id))
  with check (public.is_clinician_of_active_clinic(clinic_id));

-- =============================================================================
-- 4. Visibilidad del operador sobre clinics/clinic_members -- políticas
-- NUEVAS que se SUMAN a las existentes (RLS es permisivo/OR), no las
-- reemplazan. Los miembros de una clínica siguen viendo su propia clínica
-- exactamente igual que antes.
-- =============================================================================

create policy clinics_select_by_operator
  on public.clinics for select to authenticated
  using (public.is_platform_operator());

create policy clinic_members_select_by_operator
  on public.clinic_members for select to authenticated
  using (public.is_platform_operator());

-- =============================================================================
-- 5. clinic_subscriptions -- estado comercial ACTUAL (1:1 con clinics).
-- Visible también por el admin de esa clínica, SOLO lectura -- no pediste
-- que esté a ciegas de su propia cuenta. Todo cambio pasa por RPC.
-- =============================================================================

create table public.clinic_subscriptions (
  clinic_id uuid primary key references public.clinics (id) on delete cascade,
  price numeric(12, 2),
  plan_conditions text,
  next_payment_due_on date,
  payment_status text not null default 'al_dia'
    check (payment_status in ('al_dia', 'pendiente', 'vencido')),
  updated_at timestamptz not null default now()
);

alter table public.clinic_subscriptions enable row level security;
alter table public.clinic_subscriptions force row level security;

create policy clinic_subscriptions_select
  on public.clinic_subscriptions for select to authenticated
  using (public.is_clinic_member(clinic_id) or public.is_platform_operator());
-- Sin política de INSERT/UPDATE/DELETE para `authenticated`: todo cambio
-- pasa por update_clinic_plan()/update_clinic_payment_status() (abajo).

grant select on public.clinic_subscriptions to authenticated;
grant select, insert, update on public.clinic_subscriptions to service_role;

create trigger clinic_subscriptions_set_updated_at
  before update on public.clinic_subscriptions
  for each row
  execute function public.set_updated_at();

-- =============================================================================
-- 6. clinic_internal_notes -- operator-only. El admin de la clínica JAMÁS
-- ve esto (a diferencia de clinic_subscriptions). Log de solo-inserción.
-- =============================================================================

create table public.clinic_internal_notes (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  note text not null,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);

alter table public.clinic_internal_notes enable row level security;
alter table public.clinic_internal_notes force row level security;

create policy clinic_internal_notes_select_by_operator
  on public.clinic_internal_notes for select to authenticated
  using (public.is_platform_operator());
-- Sin política de INSERT directa para `authenticated`: solo
-- add_clinic_internal_note() (abajo) escribe aquí.

grant select on public.clinic_internal_notes to authenticated;
grant select, insert on public.clinic_internal_notes to service_role;

-- =============================================================================
-- 7. clinic_status_changes -- historial OBLIGATORIO de activar/desactivar.
-- =============================================================================

create table public.clinic_status_changes (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  is_active boolean not null,
  reason text not null,
  changed_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);

alter table public.clinic_status_changes enable row level security;
alter table public.clinic_status_changes force row level security;

create policy clinic_status_changes_select_by_operator
  on public.clinic_status_changes for select to authenticated
  using (public.is_platform_operator());
-- Sin política de INSERT directa: solo set_clinic_active_status() (abajo).

grant select on public.clinic_status_changes to authenticated;
grant select, insert on public.clinic_status_changes to service_role;

-- =============================================================================
-- 8. clinic_plan_changes -- historial de cambios de plan/condiciones.
-- Guarda el estado RESULTANTE de cada cambio (no un diff explícito) -- la
-- fila anterior de la misma clínica ya es "el antes" si hace falta comparar.
-- =============================================================================

create table public.clinic_plan_changes (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  business_model public.clinic_business_model not null,
  price numeric(12, 2),
  plan_conditions text,
  changed_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);

alter table public.clinic_plan_changes enable row level security;
alter table public.clinic_plan_changes force row level security;

create policy clinic_plan_changes_select_by_operator
  on public.clinic_plan_changes for select to authenticated
  using (public.is_platform_operator());
-- Sin política de INSERT directa: solo update_clinic_plan() (abajo).

grant select on public.clinic_plan_changes to authenticated;
grant select, insert on public.clinic_plan_changes to service_role;

-- =============================================================================
-- 9. RPCs de operador -- mismo patrón que create_clinic_with_admin:
-- SECURITY DEFINER, se autogatean con is_platform_operator(), nunca
-- confían en nada que no sea auth.uid().
-- =============================================================================

create or replace function public.set_clinic_active_status(
  target_clinic_id uuid,
  new_is_active boolean,
  reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_platform_operator() then
    raise exception 'Solo un operador de plataforma puede activar o desactivar una clínica.';
  end if;
  if reason is null or btrim(reason) = '' then
    raise exception 'El motivo es requerido.';
  end if;
  if not exists (select 1 from public.clinics where id = target_clinic_id) then
    raise exception 'Clínica no encontrada.';
  end if;

  update public.clinics set is_active = new_is_active where id = target_clinic_id;

  insert into public.clinic_status_changes (clinic_id, is_active, reason, changed_by)
  values (target_clinic_id, new_is_active, reason, auth.uid());
end;
$$;

create or replace function public.update_clinic_plan(
  target_clinic_id uuid,
  new_business_model public.clinic_business_model,
  new_price numeric,
  new_conditions text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_platform_operator() then
    raise exception 'Solo un operador de plataforma puede cambiar el plan de una clínica.';
  end if;
  if not exists (select 1 from public.clinics where id = target_clinic_id) then
    raise exception 'Clínica no encontrada.';
  end if;

  update public.clinics set business_model = new_business_model where id = target_clinic_id;

  insert into public.clinic_subscriptions (clinic_id, price, plan_conditions)
  values (target_clinic_id, new_price, new_conditions)
  on conflict (clinic_id) do update
    set price = excluded.price,
        plan_conditions = excluded.plan_conditions,
        updated_at = now();

  insert into public.clinic_plan_changes (clinic_id, business_model, price, plan_conditions, changed_by)
  values (target_clinic_id, new_business_model, new_price, new_conditions, auth.uid());
end;
$$;

create or replace function public.update_clinic_payment_status(
  target_clinic_id uuid,
  new_payment_status text,
  new_next_payment_due_on date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_platform_operator() then
    raise exception 'Solo un operador de plataforma puede actualizar el estado de pago de una clínica.';
  end if;
  if new_payment_status not in ('al_dia', 'pendiente', 'vencido') then
    raise exception 'Estado de pago inválido.';
  end if;

  insert into public.clinic_subscriptions (clinic_id, payment_status, next_payment_due_on)
  values (target_clinic_id, new_payment_status, new_next_payment_due_on)
  on conflict (clinic_id) do update
    set payment_status = excluded.payment_status,
        next_payment_due_on = excluded.next_payment_due_on,
        updated_at = now();
end;
$$;

create or replace function public.add_clinic_internal_note(
  target_clinic_id uuid,
  note text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_platform_operator() then
    raise exception 'Solo un operador de plataforma puede agregar notas internas.';
  end if;
  if note is null or btrim(note) = '' then
    raise exception 'La nota no puede estar vacía.';
  end if;
  if not exists (select 1 from public.clinics where id = target_clinic_id) then
    raise exception 'Clínica no encontrada.';
  end if;

  insert into public.clinic_internal_notes (clinic_id, note, created_by)
  values (target_clinic_id, note, auth.uid());
end;
$$;

revoke execute on function public.set_clinic_active_status(uuid, boolean, text) from public;
revoke execute on function public.update_clinic_plan(uuid, public.clinic_business_model, numeric, text) from public;
revoke execute on function public.update_clinic_payment_status(uuid, text, date) from public;
revoke execute on function public.add_clinic_internal_note(uuid, text) from public;

grant execute on function public.set_clinic_active_status(uuid, boolean, text) to authenticated;
grant execute on function public.update_clinic_plan(uuid, public.clinic_business_model, numeric, text) to authenticated;
grant execute on function public.update_clinic_payment_status(uuid, text, date) to authenticated;
grant execute on function public.add_clinic_internal_note(uuid, text) to authenticated;

-- =============================================================================
-- 10. create_clinic_with_admin (existente, Fase 1) -- se redefine para
-- sembrar también una fila por defecto en clinic_subscriptions: así toda
-- clínica tiene exactamente una fila de suscripción desde el día uno, sin
-- nulls que manejar en la vista del operador. No cambia su firma ni su
-- comportamiento de cara al llamador.
-- =============================================================================

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

  insert into public.clinic_subscriptions (clinic_id)
  values (new_clinic_id);

  return new_clinic_id;
end;
$$;
