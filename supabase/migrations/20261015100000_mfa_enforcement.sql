-- Autenticación de dos pasos (2FA con app de autenticación) -- regla en la base de datos.
--
-- Supabase marca cada sesión con un nivel: aal1 (solo contraseña) o aal2 (contraseña +
-- código de la app). El nivel va dentro del JWT (claim "aal"). Una pantalla de «introduce
-- tu código» NO basta: con la contraseña robada se puede llamar a la API REST directamente.
-- Por eso la regla vive aquí: si el usuario tiene un factor VERIFICADO y su sesión no es
-- aal2, las funciones de RLS lo tratan como si no fuera miembro de nada.
--
-- Un usuario sin factor verificado no cambia en nada (mfa_satisfied() = true), ni uno con
-- un enrolamiento a medias (factor sin verificar). service_role/postgres tampoco cambian
-- (no hay auth.uid()).
--
-- Todas las políticas de datos clínicos, fiscales y de operador pasan por is_clinic_member /
-- is_clinic_admin / is_clinic_clinician / is_platform_operator (directa o indirectamente vía
-- las *_of_active_clinic) o por is_billing_staff_of_active_clinic, que lee clinic_members
-- por su cuenta; se actualizan estas cinco más my_admin_clinic_id (exportación completa).
-- Mismos cuerpos y mismos permisos que antes + AND mfa_satisfied().
--
-- RLS habilitada y forzada en la tabla nueva (mfa_reset_log), en este mismo archivo, como
-- exige CLAUDE.md.

-- =============================================================================
-- 1. mfa_satisfied()
-- =============================================================================

create or replace function public.mfa_satisfied()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
    or not exists (
      select 1
      from auth.mfa_factors f
      where f.user_id = auth.uid()
        and f.status = 'verified'
    );
$$;

-- Solo la llaman otras funciones SECURITY DEFINER (corren como su dueño).
revoke execute on function public.mfa_satisfied() from public, anon, authenticated;

comment on function public.mfa_satisfied() is
  'true si la sesión es aal2 o el usuario no tiene ningún factor MFA verificado. Interna: '
  'la usan las funciones de RLS para exigir el segundo paso a quien lo activó.';

-- =============================================================================
-- 2. Funciones base de RLS (+ AND mfa_satisfied())
-- =============================================================================

create or replace function public.is_clinic_member(target_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.clinic_members cm
    where cm.clinic_id = target_clinic_id
      and cm.user_id = auth.uid()
  ) and public.mfa_satisfied();
$$;

create or replace function public.is_clinic_admin(target_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.clinic_members cm
    where cm.clinic_id = target_clinic_id
      and cm.user_id = auth.uid()
      and cm.role = 'admin'
  ) and public.mfa_satisfied();
$$;

create or replace function public.is_clinic_clinician(target_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.clinic_members cm
    where cm.clinic_id = target_clinic_id
      and cm.user_id = auth.uid()
      and cm.role in ('admin', 'medico')
  ) and public.mfa_satisfied();
$$;

create or replace function public.is_platform_operator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.platform_operators po where po.user_id = auth.uid()
  ) and public.mfa_satisfied();
$$;

-- Lee clinic_members por su cuenta (no pasa por is_clinic_member): mismo cuerpo que en
-- 20261009100000 + AND mfa_satisfied().
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
  ) and public.clinic_is_accessible(target_clinic_id) and public.mfa_satisfied();
$$;

-- Clínica de la que el usuario es admin (exportación completa): sin segundo paso, nada.
create or replace function public.my_admin_clinic_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select cm.clinic_id
  from public.clinic_members cm
  where cm.user_id = auth.uid() and cm.role = 'admin' and public.mfa_satisfied()
  limit 1;
$$;

-- =============================================================================
-- 3. mfa_reset_log: auditoría de los restablecimientos hechos por un operador
-- =============================================================================
-- Un usuario que pierde su teléfono no puede entrar. Un operador de plataforma, tras verificar
-- su identidad por otro medio, le quita el 2FA desde el panel (API de administración de
-- Auth, con service_role). Cada restablecimiento deja una fila aquí con el motivo.
-- Sin escritura para usuarios: la escribe solo el servidor (service_role) tras comprobar
-- que quien llama es operador. Tabla global de operador, sin clinic_id.

create table public.mfa_reset_log (
  id uuid primary key default gen_random_uuid(),
  -- Persona a la que se le quitó el 2FA. Sin FK: la fila de auditoría sobrevive a la
  -- eliminación de la cuenta.
  user_id uuid not null,
  user_email text,
  reset_by uuid references auth.users (id) on delete set null,
  reason text not null check (char_length(btrim(reason)) >= 10),
  factors_removed integer not null default 0 check (factors_removed >= 0),
  created_at timestamptz not null default now()
);

create index mfa_reset_log_user_idx on public.mfa_reset_log (user_id, created_at desc);

comment on table public.mfa_reset_log is
  'Restablecimientos de 2FA hechos por un operador de plataforma (quién, a quién, motivo). '
  'Solo la escribe el servidor con service_role.';

alter table public.mfa_reset_log enable row level security;
alter table public.mfa_reset_log force row level security;

create policy mfa_reset_log_select_by_operator
  on public.mfa_reset_log
  for select
  to authenticated
  using (public.is_platform_operator());

revoke all on public.mfa_reset_log from anon;
revoke insert, update, delete, truncate on public.mfa_reset_log from authenticated;
