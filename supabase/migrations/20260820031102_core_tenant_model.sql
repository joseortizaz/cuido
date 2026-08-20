-- Fase 0 — núcleo de aislamiento multi-tenant.
--
-- Tablas: clinics (tenant) y clinic_members (pertenencia usuario-clinica-rol).
-- RLS habilitada y con políticas en el mismo archivo/commit, tal como exige
-- CLAUDE.md: ninguna tabla nueva se crea sin su política de RLS correspondiente.
--
-- El tenant de cada fila NUNCA se deriva de un valor enviado por el cliente:
-- se deriva de auth.uid() vía la tabla clinic_members, consultada a través de
-- funciones SECURITY DEFINER que evitan tanto la recursión de RLS sobre
-- clinic_members como fugas de información entre tenants.

-- ---------------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------------

create type public.clinic_business_model as enum (
  'modelo_c', -- setup fee + suscripción por tramo de tamaño de clínica
  'modelo_e', -- canal asociativo/franquicia (colegios médicos, asociaciones provinciales)
  'modelo_f'  -- freemium con upsell a módulos de pago
);

create type public.clinic_member_role as enum (
  'admin',
  'medico',
  'recepcion'
);

-- ---------------------------------------------------------------------------
-- Función utilitaria: mantener updated_at
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tabla: clinics (tenant)
-- ---------------------------------------------------------------------------

create table public.clinics (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) > 0),
  -- Provincia de República Dominicana (31 provincias + Distrito Nacional).
  -- TEXT + CHECK en vez de ENUM: la división provincial es administrativa,
  -- no estructural, y un CHECK es más simple de evolucionar en una migración
  -- futura que un ALTER TYPE sobre un enum.
  province text not null check (
    province in (
      'Azua', 'Bahoruco', 'Barahona', 'Dajabón', 'Distrito Nacional', 'Duarte',
      'El Seibo', 'Elías Piña', 'Espaillat', 'Hato Mayor', 'Hermanas Mirabal',
      'Independencia', 'La Altagracia', 'La Romana', 'La Vega',
      'María Trinidad Sánchez', 'Monseñor Nouel', 'Monte Cristi', 'Monte Plata',
      'Pedernales', 'Peravia', 'Puerto Plata', 'Samaná', 'San Cristóbal',
      'San José de Ocoa', 'San Juan', 'San Pedro de Macorís',
      'Sánchez Ramírez', 'Santiago', 'Santiago Rodríguez', 'Santo Domingo',
      'Valverde'
    )
  ),
  business_model public.clinic_business_model not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.clinics is
  'Tenant raíz de la plataforma. Toda tabla con datos clínicos o fiscales '
  'referencia (directa o indirectamente) una fila de esta tabla.';

create trigger clinics_set_updated_at
  before update on public.clinics
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Tabla: clinic_members (pertenencia usuario-clínica-rol)
-- ---------------------------------------------------------------------------

create table public.clinic_members (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.clinic_member_role not null,
  created_at timestamptz not null default now(),
  unique (clinic_id, user_id)
);

comment on table public.clinic_members is
  'Relación usuario de auth.users <-> clinic con rol. Fuente de verdad del '
  'tenant de un usuario: NUNCA confiar en un tenant_id enviado por el cliente, '
  'siempre derivarlo de esta tabla vía auth.uid().';

create index clinic_members_user_id_idx on public.clinic_members (user_id);
create index clinic_members_clinic_id_idx on public.clinic_members (clinic_id);

-- ---------------------------------------------------------------------------
-- Funciones SECURITY DEFINER para evaluar membresía sin recursión de RLS
-- ---------------------------------------------------------------------------
--
-- Estas funciones corren con los privilegios de su dueño (bypassan RLS
-- internamente), por lo que es seguro usarlas DENTRO de las políticas de
-- clinic_members sin causar recursión infinita ni resultados inconsistentes.
-- search_path fijo explícitamente para evitar hijacking de esquema.

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
  );
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
  );
$$;

revoke execute on function public.is_clinic_member(uuid) from public;
revoke execute on function public.is_clinic_admin(uuid) from public;
grant execute on function public.is_clinic_member(uuid) to authenticated;
grant execute on function public.is_clinic_admin(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS: clinics
-- ---------------------------------------------------------------------------

alter table public.clinics enable row level security;
alter table public.clinics force row level security;

-- Lectura: solo miembros de la clínica.
create policy clinics_select_own_tenant
  on public.clinics
  for select
  to authenticated
  using (public.is_clinic_member(id));

-- Actualización: solo admins de esa clínica, y no pueden "saltar" la fila
-- a un tenant donde no son admin (el check se evalúa sobre el id de la fila,
-- que es inmutable en la práctica ya que es la propia PK).
create policy clinics_update_own_tenant_admin
  on public.clinics
  for update
  to authenticated
  using (public.is_clinic_admin(id))
  with check (public.is_clinic_admin(id));

-- Sin política de INSERT ni DELETE para `authenticated`: el alta de una
-- clínica nueva (y de su primer admin en clinic_members) es un proceso de
-- aprovisionamiento server-side controlado (service_role), no una operación
-- que un usuario final ejecute directo contra la tabla. Se diseñará en Fase 1
-- junto con el flujo de onboarding. Por ahora, INSERT/DELETE quedan
-- denegados por defecto para `authenticated`.

-- ---------------------------------------------------------------------------
-- RLS: clinic_members
-- ---------------------------------------------------------------------------

alter table public.clinic_members enable row level security;
alter table public.clinic_members force row level security;

-- Lectura: cualquier miembro de la clínica puede ver el roster de su propia
-- clínica (no expone nada de otros tenants).
create policy clinic_members_select_own_tenant
  on public.clinic_members
  for select
  to authenticated
  using (public.is_clinic_member(clinic_id));

-- Alta de miembros: solo un admin de esa clínica puede agregar miembros a
-- ELLA MISMA. (El primer miembro/admin de una clínica nueva se crea vía
-- service_role durante el aprovisionamiento — ver nota en clinics arriba.)
create policy clinic_members_insert_by_admin
  on public.clinic_members
  for insert
  to authenticated
  with check (public.is_clinic_admin(clinic_id));

-- Modificación de rol: solo un admin de la clínica, y solo dentro de la
-- misma clínica (using valida el estado actual, with check el estado nuevo).
create policy clinic_members_update_by_admin
  on public.clinic_members
  for update
  to authenticated
  using (public.is_clinic_admin(clinic_id))
  with check (public.is_clinic_admin(clinic_id));

-- Baja de miembros: solo un admin de esa clínica.
create policy clinic_members_delete_by_admin
  on public.clinic_members
  for delete
  to authenticated
  using (public.is_clinic_admin(clinic_id));
