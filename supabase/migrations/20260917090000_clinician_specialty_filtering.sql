-- Filtrado de especialidades al crear consulta -- dos mecanismos
-- INDEPENDIENTES, propuestos y confirmados con el usuario antes de
-- implementar (regla no negociable de CLAUDE.md para cambios de RLS/
-- esquema en tablas clínicas):
--
--   1. clinic_member_preferred_specialties -- preferencia de UI,
--      autogestionada por el propio médico, NO restrictiva. Solo
--      afecta qué se muestra primero en el picker de "Nueva consulta".
--   2. clinic_member_disabled_specialties -- restricción REAL,
--      exclusiva del admin, con aplicación server-side vía RLS en el
--      INSERT de encounters, no solo en la interfaz.
--
-- Precedencia: el mecanismo 2 siempre gana. No requiere lógica
-- especial -- el picker calcula primero la lista de especialidades
-- habilitadas (activas MENOS deshabilitadas) y solo DENTRO de esa
-- lista ya filtrada aplica el resaltado de "habituales" (mecanismo 1).
-- Una especialidad deshabilitada nunca entra a la lista base, así que
-- es imposible que aparezca ni siquiera en "ver todas".
--
-- Por qué NO son columnas en clinic_members (decisión de diseño
-- deliberada, no solo estilo): clinic_members hoy tiene un
-- `grant update` SIN restricción de columnas
-- (20260820040232_grant_table_privileges.sql) y su única política de
-- UPDATE es admin-only. Agregar una columna de preferencia + una
-- política nueva de "el médico puede actualizar su propia fila"
-- permitiría, con el grant de tabla completa ya existente, que ese
-- mismo médico reescribiera `role` o `clinic_id` de su propia fila en
-- la misma sentencia -- una escalada de privilegios real. Dos tablas
-- nuevas, enfocadas y con su propia RLS, evitan tocar el modelo de
-- permisos de clinic_members por completo -- mismo criterio que ya se
-- usó para sensitive_specialty_access_grants en vez de columnas en
-- encounters.

-- ---------------------------------------------------------------------------
-- Trigger nuevo: derivar clinic_id desde clinic_member_id
-- ---------------------------------------------------------------------------
-- Tercera variante de este patrón (set_clinic_id_from_patient,
-- set_clinic_id_from_encounter, 20260820111106_clinical_core_and_templates.sql)
-- -- primera vez que se necesita derivar desde clinic_members en vez de
-- patients/encounters. Reusada por ambas tablas nuevas de abajo.

create or replace function public.set_clinic_id_from_clinic_member()
returns trigger
language plpgsql
as $$
begin
  select clinic_id into new.clinic_id from public.clinic_members where id = new.clinic_member_id;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Mecanismo 1: clinic_member_preferred_specialties
-- ---------------------------------------------------------------------------

create table public.clinic_member_preferred_specialties (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  clinic_member_id uuid not null references public.clinic_members (id) on delete cascade,
  specialty_template_id uuid not null references public.specialty_templates (id),
  created_at timestamptz not null default now(),
  unique (clinic_member_id, specialty_template_id)
);

comment on table public.clinic_member_preferred_specialties is
  'Preferencia de UI autogestionada: especialidades que un médico marca '
  'como habituales para verlas primero en "Nueva consulta". NO es '
  'restrictiva -- nunca bloquea crear una consulta de una especialidad '
  'no marcada. Ver clinic_member_disabled_specialties para la '
  'restricción real (exclusiva del admin).';

create index preferred_specialties_clinic_member_idx
  on public.clinic_member_preferred_specialties (clinic_member_id);

create trigger preferred_specialties_set_clinic_id
  before insert on public.clinic_member_preferred_specialties
  for each row execute function public.set_clinic_id_from_clinic_member();

alter table public.clinic_member_preferred_specialties enable row level security;
alter table public.clinic_member_preferred_specialties force row level security;

-- select/insert/delete: el propio dueño de la fila -- responsabilidad
-- exclusiva del médico sobre su propia preferencia, sin admin de por
-- medio (confirmado con el usuario). Se agrega select adicional para
-- is_clinic_admin: solo lectura, cero riesgo (dato no clínico), útil si
-- el equipo quiere ver qué marcó cada médico. Sin política de UPDATE --
-- marcar/desmarcar es insertar o borrar una fila, no editarla.
create policy preferred_specialties_select
  on public.clinic_member_preferred_specialties for select to authenticated
  using (
    public.is_clinic_admin(clinic_id)
    or exists (
      select 1 from public.clinic_members cm
      where cm.id = clinic_member_id and cm.user_id = auth.uid()
    )
  );

create policy preferred_specialties_insert
  on public.clinic_member_preferred_specialties for insert to authenticated
  with check (
    exists (
      select 1 from public.clinic_members cm
      where cm.id = clinic_member_id and cm.user_id = auth.uid()
    )
  );

create policy preferred_specialties_delete
  on public.clinic_member_preferred_specialties for delete to authenticated
  using (
    exists (
      select 1 from public.clinic_members cm
      where cm.id = clinic_member_id and cm.user_id = auth.uid()
    )
  );

grant select, insert, delete on public.clinic_member_preferred_specialties to authenticated;

-- ---------------------------------------------------------------------------
-- Mecanismo 2: clinic_member_disabled_specialties
-- ---------------------------------------------------------------------------
-- Existencia de fila = especialidad deshabilitada para ese miembro.
-- AUSENCIA de fila = habilitada -- comportamiento por defecto: una
-- clínica que nunca usa esta función se comporta EXACTAMENTE igual que
-- hoy (ninguna fila que consultar, is_specialty_enabled_for_clinician
-- de más abajo siempre devuelve true).

create table public.clinic_member_disabled_specialties (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  clinic_member_id uuid not null references public.clinic_members (id) on delete cascade,
  specialty_template_id uuid not null references public.specialty_templates (id),
  disabled_by_user_id uuid not null references auth.users (id),
  disabled_at timestamptz not null default now(),
  unique (clinic_member_id, specialty_template_id)
);

comment on table public.clinic_member_disabled_specialties is
  'Restricción REAL, exclusiva del admin: especialidades que un médico '
  'concreto NO puede usar para crear consultas nuevas. Aplicada en el '
  'INSERT de encounters vía is_specialty_enabled_for_clinician(), no '
  'solo ocultada en la interfaz. Ausencia de fila = habilitada '
  '(comportamiento por defecto sin cambios).';

create index disabled_specialties_clinic_member_idx
  on public.clinic_member_disabled_specialties (clinic_member_id);

create trigger disabled_specialties_set_clinic_id
  before insert on public.clinic_member_disabled_specialties
  for each row execute function public.set_clinic_id_from_clinic_member();

alter table public.clinic_member_disabled_specialties enable row level security;
alter table public.clinic_member_disabled_specialties force row level security;

-- select/insert/delete de gestión: solo is_clinic_admin. Select
-- adicional para el propio dueño de la fila -- el médico necesita
-- poder leer sus propias especialidades deshabilitadas para que su
-- picker de "Nueva consulta" las oculte de entrada (RLS ya bloquea el
-- INSERT real de todos modos, pero mostrarlas y luego rechazarlas sería
-- mala experiencia). Sin política de UPDATE -- alternar es insertar o
-- borrar la fila, no editarla.
create policy disabled_specialties_select
  on public.clinic_member_disabled_specialties for select to authenticated
  using (
    public.is_clinic_admin(clinic_id)
    or exists (
      select 1 from public.clinic_members cm
      where cm.id = clinic_member_id and cm.user_id = auth.uid()
    )
  );

create policy disabled_specialties_insert
  on public.clinic_member_disabled_specialties for insert to authenticated
  with check (public.is_clinic_admin(clinic_id));

create policy disabled_specialties_delete
  on public.clinic_member_disabled_specialties for delete to authenticated
  using (public.is_clinic_admin(clinic_id));

grant select, insert, delete on public.clinic_member_disabled_specialties to authenticated;

-- ---------------------------------------------------------------------------
-- Helper: ¿puede este usuario crear un encounter de esta especialidad?
-- ---------------------------------------------------------------------------
-- Mismo estilo que can_access_sensitive_encounter
-- (20260822010000_sensitive_specialty_access.sql).

create or replace function public.is_specialty_enabled_for_clinician(
  target_clinic_id uuid,
  target_user_id uuid,
  target_specialty_template_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1
    from public.clinic_member_disabled_specialties d
    join public.clinic_members cm on cm.id = d.clinic_member_id
    where cm.clinic_id = target_clinic_id
      and cm.user_id = target_user_id
      and d.specialty_template_id = target_specialty_template_id
  );
$$;

revoke execute on function public.is_specialty_enabled_for_clinician(uuid, uuid, uuid) from public;
grant execute on function public.is_specialty_enabled_for_clinician(uuid, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Política de encounters -- reemplaza encounters_insert_by_clinician
-- (20260822010000_sensitive_specialty_access.sql), agrega UNA condición
-- nueva unida con AND, sin tocar las dos que ya existen.
-- ---------------------------------------------------------------------------
-- provider_id ya es SIEMPRE auth.uid() puesto server-side (nunca un
-- campo de formulario, ver
-- src/app/(clinic)/patients/[id]/encounters/new/[templateId]/actions.ts)
-- -- la condición nueva evalúa exactamente al médico que intenta crear
-- la consulta, sin forma de "crear como otro" para sortearla.
--
-- Deliberadamente NO se toca la política de UPDATE de encounters: una
-- especialidad deshabilitada DESPUÉS de crear una nota no debe revocar
-- la capacidad de editar notas ya existentes y legítimas -- no fue
-- pedido y sería un comportamiento sorprendente.
--
-- Fuera de alcance (documentado a propósito): appointments_insert no se
-- toca -- ahí quien elige la especialidad es admin/recepción al
-- agendar, no el médico, y el pedido es específicamente sobre qué
-- especialidades ve un médico al CREAR UNA CONSULTA.

drop policy encounters_insert_by_clinician on public.encounters;
create policy encounters_insert_by_clinician
  on public.encounters for insert to authenticated
  with check (
    public.is_clinician_of_active_clinic(clinic_id)
    and (
      not exists (
        select 1 from public.specialty_templates
        where id = specialty_template_id and requires_explicit_access
      )
      or provider_id = auth.uid()
    )
    and public.is_specialty_enabled_for_clinician(clinic_id, provider_id, specialty_template_id)
  );
